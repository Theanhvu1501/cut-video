import path from "path";
import { todayStr, computeRemaining, recordRendered } from "./runner-state.js";
import { decideAction, skipText, ST, MAX_ATTEMPTS } from "./resume-plan.js";
import { getEntry, setEntry, clearEntry } from "./resume-state.js";
import { normalizeProxy } from "./proxy.js";
import { loadPreset, applySlotOverrides } from "./preset-store.js";
import { validatePreset } from "./layer-compiler.js";
import { resetGpuState } from "./render-core.js";

export function pickRandomBackground(files, rand = Math.random) {
  if (!files.length) return null;
  return files[Math.min(files.length - 1, Math.floor(rand() * files.length))];
}

// Khoảng chờ ngẫu nhiên (ms) giữa các lần tải để tránh bị nghi là bot.
// Mặc định 60–120s; đặt downloadDelayMaxMs<=0 để tắt.
export function pickDownloadDelay(config = {}, rand = Math.random) {
  const min = config.downloadDelayMinMs ?? 60000;
  const max = config.downloadDelayMaxMs ?? 120000;
  if (max <= 0) return 0;
  if (max <= min) return Math.max(0, min);
  return Math.floor(min + rand() * (max - min));
}

export function createSheetRunner(deps) {
  const {
    config, sheetsApi, downloader, copyLocalOverlay, listLocalInputs, renderer, listBackgrounds,
    ensureDirs, stateStore, emit, now, pLimitFn, rand, unlink, detectChroma, sleep,
    uploadQueue, refreshStats, resumeStore, fileExists, checkGpm,
  } = deps;
  let timer = null;
  let running = false;
  // Kết quả preflight GPM của lượt hiện tại: null = chưa hỏi/không cần hỏi,
  // chuỗi = lý do GPM không dùng được (dùng luôn làm nội dung ghi vào cột C).
  let gpmDownReason = null;

  // "enqueued" | "skipped" (kênh/cấu hình không đủ) | "gpm-down" (hạ tầng chết) | "upload-disabled" (kênh tắt upload).
  function enqueueUpload(ch, item, info, overlaysDir) {
    // Kiểm tra uploadEnabled trước - nếu kênh không bật upload thì bỏ qua
    if (ch.uploadEnabled === false) return "upload-disabled";
    if (!(uploadQueue && config.gpmEnabled && ch.gpmProfileId && ch.postTimes)) return "skipped";
    if (gpmDownReason) return "gpm-down";
    uploadQueue.enqueue({
      sheetName: ch.sheetName,
      gpmHost: config.gpmHost,
      profileId: ch.gpmProfileId,
      videoPath: info.outputPath,
      overlaysDir,
      title: info.title,
      postTimes: ch.postTimes,
      locale: config.gpmLocale,
      rowIndex: item.rowIndex,
      sourceUrl: item.url,
    });
    return "enqueued";
  }

  // Video đã render xong nhưng chưa upload được vì lý do ngoài nó (GPM chưa mở…).
  // Bắt buộc phải ghi dấu vào cột C: để trống thì decideAction trả "skip" và video
  // biến mất khỏi mọi lượt sau, dù file output vẫn còn nguyên.
  async function markUploadWaiting(sheetName, rowIndex, reason) {
    try {
      await sheetsApi.setUploadStatus(sheetName, rowIndex, `${ST.WAIT_UPLOAD} ${reason}`);
    } catch { /* ignore */ }
  }

  // yt-dlp lưu thumb cùng basename với video: <title>.mp4 -> <title>.jpg
  function thumbOf(videoPath) {
    return String(videoPath).replace(/\.[^.]+$/, ".jpg");
  }

  // Tăng biến đếm rồi lưu. load/save đồng bộ, KHÔNG await ở giữa: pLimit chạy
  // song song, await ở giữa sẽ mất lượt tăng.
  function bumpAttempts(sheetName, url, field) {
    const rs = resumeStore.load();
    const prev = getEntry(rs, sheetName, url);
    const next = setEntry(rs, sheetName, url, { [field]: (prev?.[field] ?? 0) + 1 });
    resumeStore.save(rs);
    return next[field];
  }

  function patchEntry(sheetName, url, patch) {
    const rs = resumeStore.load();
    setEntry(rs, sheetName, url, patch);
    resumeStore.save(rs);
  }

  function dropEntry(sheetName, url) {
    const rs = resumeStore.load();
    clearEntry(rs, sheetName, url);
    resumeStore.save(rs);
  }

  async function runChannel(ch, today) {
    if (!ch.enabled) return;
    // finally ở cuối hàm: mọi đường thoát sớm (proxy sai, không có background…) đều
    // phải báo hàng đợi rằng lượt này hết job cho kênh, để nó chốt tin của kênh.
    try {
      // Proxy hỏng -> dừng kênh. Tải thẳng bằng IP thật là kết cục tệ nhất cho
      // người dùng đang dựa vào proxy để né bot-check.
      let proxy = "";
      if (ch.videoSource !== "local" && String(ch.proxy ?? "").trim()) {
        try {
          proxy = normalizeProxy(ch.proxy);
        } catch (err) {
          emit({ type: "error", channel: ch.sheetName, message: String(err?.message || err) });
          return;
        }
      }

      const channelRoot = path.join(config.channelsRoot, ch.sheetName);
      const { backgroundsDir, overlaysDir, outputDir, inputsDir } = ensureDirs(channelRoot);
      const backgrounds = listBackgrounds(backgroundsDir);
      if (!backgrounds.length) {
        emit({ type: "error", channel: ch.sheetName, message: "Chưa có background (.mp4) trong folder kênh." });
        return;
      }

      // Kênh local: tự điền tên file trong inputs/ vào cột A (như fetchSourceUrlsFor
      // làm với URL). Người dùng chỉ thả file, không gõ tay.
      if (ch.videoSource === "local") {
        const localFiles = listLocalInputs(inputsDir);
        // Dedup theo tên file (khớp chuỗi tuyệt đối) — KHÔNG dùng pickNewUrls vì nó
        // rút video-id từ URL YouTube, không hiểu tên file .mp4.
        const existing = new Set((await sheetsApi.readChannelUrls(ch.sheetName)).map((r) => r.url));
        const fresh = localFiles.filter((f) => !existing.has(f));
        if (fresh.length) await sheetsApi.appendUrls(ch.sheetName, fresh);
      }

      const state = stateStore.load();
      const remaining = computeRemaining(state[ch.sheetName], ch.videosPerDay, today);

      const urls = await sheetsApi.readChannelUrls(ch.sheetName);
      const rs = resumeStore.load();
      const planned = urls.map((item) => {
        const entry = getEntry(rs, ch.sheetName, item.url);
        const action = decideAction({
          statusB: item.status,
          statusC: item.uploadStatus,
          attempts: entry?.attempts ?? 0,
          uploadAttempts: entry?.uploadAttempts ?? 0,
          overlayExists: !!(entry?.filePath && fileExists(entry.filePath)),
          outputExists: !!(entry?.outputPath && fileExists(entry.outputPath)),
        });
        return { item, entry, action };
      });

      // Dọn dẹp TRƯỚC khi lập renderWork.
      // 1) Ô B bị xoá tay (statusB === "") -> người dùng muốn làm lại từ đầu: xoá overlay
      //    cũ (nếu còn) + xoá hẳn entry resume (reset attempts). Không làm bước này thì
      //    action "full" sau đó tải đè lên file đã tồn tại -> yt-dlp (noOverwrites) bỏ
      //    qua, không tạo file mới -> downloadOne không tìm thấy file vừa tải -> kẹt mãi.
      //    KHÔNG áp dụng cho "render-only": nó cần chính overlay đó để render.
      // 2) Phòng thủ thêm: mọi action "full" khác mà overlay cũ vẫn còn trên đĩa cũng bị
      //    xoá trước khi tải lại — idempotent (lỗi tải: filePath đã null; đã tải + file
      //    mất thì unlink là no-op).
      // 3) Video hoàn tất trọn vẹn (B=done, C bắt đầu "✅") -> entry resume không còn tác
      //    dụng gì nữa: xoá entry (KHÔNG xoá file — output/overlay do người dùng tự dọn).
      for (const { item, entry, action } of planned) {
        if (action === "render-only") continue;
        if (item.status === "" && entry) {
          if (entry.filePath) {
            for (const f of [entry.filePath, thumbOf(entry.filePath)]) {
              if (fileExists(f)) { try { unlink(f); } catch { /* ignore */ } }
            }
          }
          const rsClear = resumeStore.load();
          clearEntry(rsClear, ch.sheetName, item.url);
          resumeStore.save(rsClear);
        } else if (action === "full" && entry?.filePath && fileExists(entry.filePath)) {
          for (const f of [entry.filePath, thumbOf(entry.filePath)]) {
            if (fileExists(f)) { try { unlink(f); } catch { /* ignore */ } }
          }
        } else if (item.status === ST.DONE && String(item.uploadStatus ?? "").trim().startsWith("✅") && entry) {
          dropEntry(ch.sheetName, item.url);
        }
      }

      // upload-only KHÔNG tốn quota render: chạy hết, không qua slice(0, remaining).
      for (const { item, entry, action } of planned) {
        if (action === "upload-exhausted") {
          const reason = String(item.uploadStatus).replace(/^❌\s*lỗi:\s*/i, "").trim();
          try { await sheetsApi.setUploadStatus(ch.sheetName, item.rowIndex, skipText(reason)); } catch { /* ignore */ }
          emit({ type: "log", message: `[${ch.sheetName}] bỏ upload sau ${MAX_ATTEMPTS} lần: ${entry?.title ?? item.url}` });
          continue;
        }
        if (action !== "upload-only" && action !== "upload-wait") continue;
        const res = enqueueUpload(ch, item, { outputPath: entry.outputPath, title: entry.title }, overlaysDir);
        if (res === "enqueued") {
          // upload-wait = lỗi hạ tầng lượt trước, không phải lỗi của video này → không tính lượt.
          if (action === "upload-only") bumpAttempts(ch.sheetName, item.url, "uploadAttempts");
          emit({ type: "channel-status", channel: ch.sheetName, status: "thử lại upload", url: item.url });
        } else if (res === "gpm-down") {
          await markUploadWaiting(ch.sheetName, item.rowIndex, gpmDownReason);
          emit({ type: "log", message: `[${ch.sheetName}] hoãn upload lại (${gpmDownReason}): ${entry?.title ?? item.url}` });
        } else {
          emit({ type: "log", message: `[${ch.sheetName}] bỏ qua upload lại (GPM tắt hoặc kênh thiếu profile/giờ đăng): ${entry?.title ?? item.url}` });
        }
      }

      // Việc render bị quota cắt; việc upload-only thì không (Task 7 dùng tiếp).
      const renderWork = planned
        .filter((p) => p.action === "full" || p.action === "render-only")
        .slice(0, remaining);

      if (!renderWork.length) {
        emit({ type: "channel-status", channel: ch.sheetName, status: remaining <= 0 ? "đủ hôm nay" : "hết URL mới" });
        return;
      }

      // Composer: nạp + KIỂM preset MỘT LẦN cho cả kênh, TRƯỚC khi tải video nào (bản vá
      // theo review — I1a). Trước đây việc này nằm trong vòng lặp per-item, SAU khi mỗi video
      // đã tải xong (stage đã là "render"): một tên preset gõ sai làm mất hết lượt tải yt-dlp,
      // băng thông proxy và hạn mức rate-limit của cả renderWork trước khi thất bại lần lượt
      // từng video. Nạp sớm ở đây thì hỏng preset chỉ tốn một lần kiểm, không tốn lượt tải nào
      // — đúng spec "Preset không tồn tại/không có đúng 1 lớp overlay -> bỏ qua KÊNH đó".
      let composerPreset = null;
      if (ch.renderMode === "composer") {
        const preset = loadPreset(config.presetsDir, ch.presetName);
        const check = preset ? validatePreset(preset) : null;
        const msg = !preset
          ? `không đọc được preset "${ch.presetName || "(trống)"}"`
          : !check.ok
            ? `preset "${ch.presetName || "(trống)"}" không hợp lệ: ${check.errors.join("; ")}`
            : null;
        if (msg) {
          emit({ type: "error", channel: ch.sheetName, message: msg });
          emit({ type: "channel-status", channel: ch.sheetName, status: "lỗi preset" });
          // Ghi rõ trạng thái lỗi vào ô Sheet của TỪNG item đã lên kế hoạch, dù CHƯA tải video
          // nào của chúng — giữ tính hiển thị trong Sheet, đúng như trước đây, nhưng không đổi
          // bằng một lượt tải lãng phí mỗi item.
          for (const { item } of renderWork) {
            try {
              await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, `${ST.ERR_RENDER} ${msg}`.slice(0, 200));
            } catch { /* ignore */ }
          }
          return;
        }
        composerPreset = preset;
      }

      const limit = pLimitFn(config.renderConcurrency || 2);
      const downloadLimit = pLimitFn(1);
      let firstDownload = true;

      await Promise.all(renderWork.map(({ item, entry, action }) => limit(async () => {
        let stage = "download";
        let dl = null;
        try {
          if (action === "render-only") {
            dl = { filePath: entry.filePath, title: entry.title };
          } else if (ch.videoSource === "local") {
            // Kênh local: item.url = tên file ở cột A. Copy inputs/<file> làm overlay.
            emit({ type: "channel-status", channel: ch.sheetName, status: "đang lấy file", url: item.url });
            dl = copyLocalOverlay(item.url, inputsDir, overlaysDir);
            patchEntry(ch.sheetName, item.url, { stage: "downloaded", filePath: dl.filePath, title: dl.title });
            await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, ST.DOWNLOADED);
          } else {
            emit({ type: "channel-status", channel: ch.sheetName, status: "đang tải", url: item.url });
            dl = await downloadLimit(async () => {
              if (!firstDownload) {
                const delay = pickDownloadDelay(config, rand);
                if (delay > 0 && sleep) {
                  emit({ type: "channel-status", channel: ch.sheetName, status: `chờ ${Math.round(delay / 1000)}s trước khi tải`, url: item.url });
                  await sleep(delay);
                }
              }
              firstDownload = false;
              return downloader(item.url, overlaysDir, { proxy });
            });
            patchEntry(ch.sheetName, item.url, { stage: "downloaded", filePath: dl.filePath, title: dl.title });
            await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, ST.DOWNLOADED);
          }

          stage = "render";
          const bg = pickRandomBackground(backgrounds, rand);
          const outputPath = path.join(outputDir, `${dl.title}.mp4`);
          const cfg = { ...ch.cfg };
          if (config.videoSpeed != null) cfg.videoSpeed = config.videoSpeed;
          if (ch.renderMode === "chromaKeyAuto" && ch.chromaPalette?.length) {
            try {
              cfg.chromaColor = await detectChroma(dl.filePath, ch.chromaPalette);
            } catch (err) {
              emit({ type: "log", message: `Dò màu thất bại (${ch.sheetName}), dùng chromaColor cố định: ${String(err?.message || err).slice(0, 120)}` });
            }
          }
          if (ch.renderMode === "composer") {
            // Preset đã được nạp + kiểm MỘT LẦN cho cả kênh, trước Promise.all (xem khối
            // composerPreset phía trên) — ở đây chỉ còn việc áp ghi đè theo khe cho item này.
            cfg.preset = applySlotOverrides(composerPreset, ch.slotOverrides);
          }
          emit({ type: "channel-status", channel: ch.sheetName, status: "đang render", url: item.url });
          await renderer({
            overlayFile: dl.filePath, backgroundFile: path.join(backgroundsDir, bg),
            outputPath, renderMode: ch.renderMode, cfg,
            useGPU: config.useGPU, gpuVideoCodec: config.gpuVideoCodec,
            onProgress: (m) => {
              // renderOne đẩy CẢ mọi dòng stderr của ffmpeg qua onProgress, nên phải lọc —
              // nối thẳng là log ngập. Mọi cảnh báo trong codebase đều mở đầu bằng "⚠️".
              if (String(m).startsWith("⚠️")) {
                emit({ type: "log", message: `[${ch.sheetName}] ${m}` });
              }
            },
          });

          await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, ST.DONE);
          // stateStore.load/save are synchronous — no await between them, so concurrent
          // pLimit tasks cannot interleave this load-modify-save (no lost increments).
          const s = stateStore.load();
          recordRendered(s, ch.sheetName, today);
          stateStore.save(s);
          patchEntry(ch.sheetName, item.url, { stage: "rendered", outputPath, title: dl.title });
          try { unlink(dl.filePath); } catch { /* ignore */ }
          emit({ type: "video-rendered", channel: ch.sheetName, outputPath, sourceUrl: item.url, title: dl.title });
          if (enqueueUpload(ch, item, { outputPath, title: dl.title }, overlaysDir) === "gpm-down") {
            await markUploadWaiting(ch.sheetName, item.rowIndex, gpmDownReason);
          }
        } catch (e) {
          const msg = String(e?.message || e).slice(0, 200);
          const attempts = bumpAttempts(ch.sheetName, item.url, "attempts");
          if (stage === "download") {
            // Tải hỏng: bỏ mọi dấu vết file (mp4 lẫn thumb) để lượt sau tải lại sạch.
            // (.part dở dang do yt-dlp tự nối tiếp, không đụng tới.)
            const rs2 = resumeStore.load();
            const e2 = getEntry(rs2, ch.sheetName, item.url);
            if (e2?.filePath) {
              for (const p of [e2.filePath, thumbOf(e2.filePath)]) {
                try { unlink(p); } catch { /* ignore */ }
              }
            }
            setEntry(rs2, ch.sheetName, item.url, { stage: null, filePath: null });
            resumeStore.save(rs2);
          }
          const prefix = stage === "download" ? ST.ERR_DL : ST.ERR_RENDER;
          const text = attempts >= MAX_ATTEMPTS ? skipText(msg) : `${prefix} ${msg}`;
          try { await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, text); } catch { /* ignore */ }
          emit({ type: "error", channel: ch.sheetName, url: item.url, message: msg });
        }
      })));
    } catch (e) {
      emit({ type: "error", channel: ch.sheetName, message: String(e?.message || e).slice(0, 200) });
    } finally {
      // Không await: việc chụp+gửi chạy nền để runner đi tiếp kênh sau ngay.
      if (uploadQueue) uploadQueue.endChannel(ch.sheetName);
    }
  }

  async function runNow(sheetName) {
    if (running) {
      emit({ type: "log", message: "Bỏ qua: lượt chạy trước chưa xong" });
      return;
    }
    running = true;
    if (uploadQueue) uploadQueue.beginRun(); // tạm ngưng gửi digest trong lúc chạy
    // gpuBroken (render-core.js) là biến mức MODULE: GPU hỏng ở video đầu tiên của lượt trước
    // sẽ tắt GPU cho toàn bộ phần đời còn lại của tiến trình Electron, kể cả những kênh có
    // preset/cấu hình hoàn toàn đúng ở lượt SAU. resetGpuState() là cơ chế duy nhất khoanh
    // vùng thiệt hại đó — gọi lại ở ĐẦU MỖI LƯỢT để một lần GPU chết không lỗi tận số vĩnh
    // viễn tới cuối phiên làm việc; nếu GPU vẫn hỏng thật thì lượt này lại tự tắt nó y như cũ.
    resetGpuState();
    try {
      const today = todayStr(now());
      // Hỏi GPM MỘT lần cho cả lượt. GPM chết mà cứ enqueue thì mỗi video phải chờ
      // 10 lần thử CDP × 1s rồi mới hỏng — và người dùng nhận N thông báo lỗi giống
      // nhau thay vì một câu "chưa mở GPM".
      gpmDownReason = null;
      if (config.gpmEnabled && checkGpm) {
        try {
          if ((await checkGpm()) === false) gpmDownReason = "chưa kết nối được GPM";
        } catch (e) {
          gpmDownReason = `chưa kết nối được GPM (${String(e?.message || e).slice(0, 120)})`;
        }
        if (gpmDownReason) emit({ type: "error", message: `${gpmDownReason} — video sẽ render bình thường và tự upload ở lượt sau.` });
      }
      let channels = await sheetsApi.readConfigSheet();
      if (sheetName) channels = channels.filter((c) => c.sheetName === sheetName);
      for (const ch of channels) await runChannel(ch, today);
      emit({ type: "done" });
      // Làm mới số liệu kênh SAU khi lượt render đã tính là xong. Lỗi ở đây chỉ
      // ghi log — không được làm lượt chạy trông như thất bại.
      if (refreshStats) {
        try {
          await refreshStats();
        } catch (e) {
          emit({ type: "log", message: `Làm mới số liệu kênh thất bại: ${String(e?.message || e).slice(0, 200)}` });
        }
      }
    } finally {
      running = false;
      // Lượt chạy xong → digest sẽ gửi 1 lần khi hàng đợi upload cũng rỗng.
      if (uploadQueue) uploadQueue.endRun();
    }
  }

  function start(intervalMs) {
    stop();
    runNow().catch((e) => emit({ type: "error", message: String(e?.message || e) }));
    timer = setInterval(() => runNow().catch((e) => emit({ type: "error", message: String(e?.message || e) })), intervalMs);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  return { runNow, start, stop };
}
