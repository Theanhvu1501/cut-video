import path from "path";
import { todayStr, computeRemaining, recordRendered } from "./runner-state.js";

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
    config, sheetsApi, downloader, renderer, listBackgrounds,
    ensureDirs, stateStore, emit, now, pLimitFn, rand, unlink, detectChroma, sleep,
    uploadQueue,
  } = deps;
  let timer = null;
  let running = false;

  async function runChannel(ch, today) {
    if (!ch.enabled) return;
    try {
      const channelRoot = path.join(config.channelsRoot, ch.sheetName);
      const { backgroundsDir, overlaysDir, outputDir } = ensureDirs(channelRoot);
      const backgrounds = listBackgrounds(backgroundsDir);
      if (!backgrounds.length) {
        emit({ type: "error", channel: ch.sheetName, message: "Chưa có background (.mp4) trong folder kênh." });
        return;
      }
      const state = stateStore.load();
      const remaining = computeRemaining(state[ch.sheetName], ch.videosPerDay, today);
      if (remaining <= 0) { emit({ type: "channel-status", channel: ch.sheetName, status: "đủ hôm nay" }); return; }

      const urls = await sheetsApi.readChannelUrls(ch.sheetName);
      const pending = urls.filter((u) => u.status === "").slice(0, remaining);
      if (!pending.length) { emit({ type: "channel-status", channel: ch.sheetName, status: "hết URL mới" }); return; }

      const limit = pLimitFn(config.renderConcurrency || 2);
      const downloadLimit = pLimitFn(1);
      let firstDownload = true;
      await Promise.all(pending.map((item) => limit(async () => {
        try {
          emit({ type: "channel-status", channel: ch.sheetName, status: "đang tải", url: item.url });
          // Tải nối tiếp 1-cái-một; giãn cách trước mỗi lần tải (trừ lần đầu) để tránh bị nghi là bot.
          const dl = await downloadLimit(async () => {
            if (!firstDownload) {
              const delay = pickDownloadDelay(config, rand);
              if (delay > 0 && sleep) {
                emit({ type: "channel-status", channel: ch.sheetName, status: `chờ ${Math.round(delay / 1000)}s trước khi tải`, url: item.url });
                await sleep(delay);
              }
            }
            firstDownload = false;
            return downloader(item.url, overlaysDir, { proxy: ch.proxy });
          });
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
          emit({ type: "channel-status", channel: ch.sheetName, status: "đang render", url: item.url });
          await renderer({
            overlayFile: dl.filePath, backgroundFile: path.join(backgroundsDir, bg),
            outputPath, renderMode: ch.renderMode, cfg,
            useGPU: config.useGPU, gpuVideoCodec: config.gpuVideoCodec,
          });
          await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, "done");
          // stateStore.load/save are synchronous — no await between them, so concurrent
          // pLimit tasks cannot interleave this load-modify-save (no lost increments).
          const s = stateStore.load();
          recordRendered(s, ch.sheetName, today);
          stateStore.save(s);
          try { unlink(dl.filePath); } catch { /* ignore */ }
          emit({ type: "video-rendered", channel: ch.sheetName, outputPath, sourceUrl: item.url, title: dl.title });
          // Nếu bật GPM và kênh có profile + giờ đăng → xếp hàng upload (serial theo kênh).
          if (uploadQueue && config.gpmEnabled && ch.gpmProfileId && ch.postTimes) {
            uploadQueue.enqueue({
              sheetName: ch.sheetName,
              gpmHost: config.gpmHost,
              profileId: ch.gpmProfileId,
              videoPath: outputPath,
              overlaysDir,
              title: dl.title,
              postTimes: ch.postTimes,
              locale: config.gpmLocale,
              rowIndex: item.rowIndex,
              sourceUrl: item.url,
            });
          }
        } catch (e) {
          const msg = String(e?.message || e).slice(0, 200);
          try { await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, `error: ${msg}`); } catch { /* ignore */ }
          emit({ type: "error", channel: ch.sheetName, url: item.url, message: msg });
        }
      })));
    } catch (e) {
      emit({ type: "error", channel: ch.sheetName, message: String(e?.message || e).slice(0, 200) });
    }
  }

  async function runNow(sheetName) {
    if (running) {
      emit({ type: "log", message: "Bỏ qua: lượt chạy trước chưa xong" });
      return;
    }
    running = true;
    try {
      const today = todayStr(now());
      let channels = await sheetsApi.readConfigSheet();
      if (sheetName) channels = channels.filter((c) => c.sheetName === sheetName);
      for (const ch of channels) await runChannel(ch, today);
      emit({ type: "done" });
    } finally {
      running = false;
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
