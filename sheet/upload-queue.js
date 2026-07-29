// Hàng đợi upload lên YouTube qua GPM — serial theo từng kênh.
// Render xong 1 video → enqueue → (tuần tự) lấy thumb trong overlays theo title,
// cấp giờ lịch (ngày mai), rồi upload+thumb+lịch bằng yt-upload.
// Một kênh chỉ xử lý 1 video tại một thời điểm; video sau chờ trong hàng đợi.
//
// Xong một kênh (runner gọi endChannel + chuỗi của kênh cạn) → chụp trang Nội dung
// của kênh đó và gửi MỘT tin mang cả ảnh lẫn kết quả của riêng kênh đó. Cuối lượt
// gửi thêm digest tổng. (Trước đây gộp mọi ảnh vào một album, nhưng Telegram chỉ
// hiển thị một caption cho cả album nên kết quả của các kênh còn lại bị ẩn.)

import path from "path";
import fs from "fs";
import { connectProfile, closeProfile } from "./gpm-client.js";
import { findThumbnailForVideo } from "./thumb-match.js";
import { assignTomorrowSlots, formatSchedule } from "./schedule-slots.js";
import { uploadAndSchedule } from "./yt-upload.js";
import { captureContentPage } from "./yt-capture.js";

/**
 * Chuẩn bị 1 job (thuần, test được): tìm thumbnail trong overlays theo title + cấp slot lịch.
 * @returns {{ videoPath, thumbnailPath: string|null, scheduleISO: string|null }}
 */
export function prepareJob({ videoPath, overlaysDir, postTimes, usedSlots, now, listFiles }) {
  const names = (listFiles(overlaysDir) || []);
  const files = names.map((f) => path.join(overlaysDir, f));
  const thumbnailPath = findThumbnailForVideo(videoPath, files); // khớp <title>.jpg trong overlays
  const [scheduleISO = null] = assignTomorrowSlots(postTimes, usedSlots || [], now, 1);
  return { videoPath, thumbnailPath, scheduleISO };
}

/**
 * Tạo hàng đợi upload. Các dep có thể bơm để test.
 * Nguồn sự thật là SHEET (cột C) — không dùng file JSON:
 *   readChannelUploads(sheetName) → { scheduledUrls: Set<string>, usedSlots: string[] }
 *   (đọc 1 lần/lượt/kênh rồi cache trong bộ nhớ; ghi cột C là lưu bền vững).
 */
export function createUploadQueue({
  readChannelUploads = async () => ({ scheduledUrls: new Set(), usedSlots: [] }),
  connect = connectProfile,
  closeConn = closeProfile,
  runUpload = uploadAndSchedule,
  now = () => new Date(),
  listFiles = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } },
  log = () => {},
  emit = () => {},                     // (evt) — phát sự kiện trạng thái lên UI ({type:"upload-status",...})
  notifyDigest = null,                 // async (results[]) — gửi digest tổng khi hàng đợi rảnh
  notifyChannel = null,                // async (sheetName, results[], image: Buffer|null) — tin của 1 kênh
  capture = captureContentPage,        // (page, opts) → Buffer PNG (tiêm để test)
  setUploadStatus = async () => {},    // async (sheetName, rowIndex, status) — ghi ngược vào Sheet
  retries = 3,                         // số lần thử lại khi lỗi (chỉ khi CHƯA bắt đầu upload)
  retryDelayMs = 3000,
  flushMs = 3000,                      // chờ rảnh bao lâu trước khi gửi digest
  idleCloseMs = 600_000,               // rảnh bao lâu thì đóng trình duyệt GPM (0 = không đóng)
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const chains = new Map();       // sheetName -> Promise (chuỗi serial theo kênh)
  const conns = new Map();        // profileId -> { browser, page, gpmHost } (tái dùng kết nối)
  const channelCache = new Map(); // sheetName -> { scheduledUrls, usedSlots } (đọc từ Sheet 1 lần/lượt)
  const results = [];             // kết quả từ lượt bận hiện tại (để gộp digest)
  const lastProfile = new Map();  // sheetName -> { gpmHost, profileId } (để biết chụp bằng profile nào)
  const pendingByChannel = new Map(); // sheetName -> số job đang chờ/chạy của kênh đó
  const channelEnded = new Set();     // sheetName — runner đã báo lượt này hết job cho kênh
  const reported = new Set();         // sheetName — đã gửi tin của kênh trong lượt này
  const reportTasks = new Set();      // Promise của các tin đang chụp/gửi
  let pending = 0;                // số job đang chờ/chạy
  let flushTimer = null;
  let idleTimer = null;           // hẹn giờ đóng trình duyệt khi rảnh
  let closing = null;             // Promise đang-đóng (chặn getConn mở lại giữa chừng)
  let runActive = false;          // lượt chạy (tải+render) còn đang diễn ra → chưa gửi digest

  // Đọc trạng thái upload của kênh từ Sheet (cache trong lượt); lần sau tái dùng.
  async function getChannelUploads(sheetName) {
    if (channelCache.has(sheetName)) return channelCache.get(sheetName);
    const data = await readChannelUploads(sheetName);
    const cache = {
      scheduledUrls: data.scheduledUrls instanceof Set ? data.scheduledUrls : new Set(data.scheduledUrls || []),
      usedSlots: [...(data.usedSlots || [])],
    };
    channelCache.set(sheetName, cache);
    return cache;
  }

  // Chờ lượt đóng đang diễn ra kết thúc rồi mới mở lại. Không có dòng `await closing`
  // thì một job tới đúng lúc closeIdleConns() đang await sẽ mở lại profile, và lời gọi
  // close đang bay dở hạ luôn tiến trình Chrome vừa mở.
  async function getConn(gpmHost, profileId) {
    if (closing) await closing;
    if (conns.has(profileId)) return conns.get(profileId);
    const c = await connect(gpmHost, profileId);
    conns.set(profileId, { ...c, gpmHost });
    return conns.get(profileId);
  }

  function cancelClose() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }

  async function closeIdleConns() {
    if (runActive || pending > 0) return; // hẹn giờ dài, lượt chạy mới có thể đã bắt đầu
    // Còn tin nào đang chụp thì tuyệt đối không giết trình duyệt của nó — hẹn lại.
    if (reportTasks.size) { scheduleClose(); return; }
    const entries = [...conns.entries()];
    conns.clear();                        // xoá TRƯỚC vòng await: không job nào đọc trúng browser sắp bị giết
    for (const [profileId, c] of entries) {
      try {
        await closeConn(c.gpmHost, profileId, c);
        log(`Đã đóng trình duyệt GPM (profile ${profileId})`);
      } catch (e) {
        log(`Đóng profile ${profileId} thất bại: ${e?.message || e}`);
      }
    }
  }

  // Rảnh → hẹn giờ đóng. Huỷ hẹn nếu có job mới trước khi hết giờ.
  function scheduleClose() {
    if (!idleCloseMs || !conns.size) return;
    cancelClose();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      closing = closeIdleConns().finally(() => { closing = null; });
    }, idleCloseMs);
    // unref: hẹn giờ 10 phút này KHÔNG được giữ tiến trình sống. Electron chạy sẵn nên
    // hẹn giờ vẫn nổ đúng lúc; còn tiến trình nào chỉ còn mỗi nó thì được phép thoát.
    idleTimer.unref?.();
  }

  async function writeStatus(sheetName, rowIndex, status) {
    if (rowIndex == null) return;
    try { await setUploadStatus(sheetName, rowIndex, status); } catch { /* ignore */ }
  }

  // Cập nhật cả UI (bảng) lẫn Sheet cùng lúc.
  function emitUpload(channel, status, extra = {}) {
    try { emit({ type: "upload-status", channel, status, ...extra }); } catch { /* ignore */ }
  }

  // Khi hàng đợi rảnh → gửi 1 digest gộp các kết quả từ lượt bận.
  // Chờ các tin từng kênh gửi xong trước, để digest tổng là tin CUỐI.
  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(async () => {
      if (runActive || pending > 0 || !results.length) return; // lượt chạy chưa xong → chưa gửi
      await Promise.all([...reportTasks].map((p) => p.catch(() => {})));
      const batch = results.splice(0, results.length);
      if (notifyDigest) {
        try { await notifyDigest(batch); } catch (e) { log(`Lỗi gửi Telegram: ${e?.message || e}`); }
      }
    }, flushMs);
  }

  // Kênh vừa xong → gửi tin của riêng kênh đó (ảnh trang Nội dung + kết quả).
  // Lọc `results` và ghi `reported` TRƯỚC mọi await: hai lời gọi tới cùng lúc (từ
  // endChannel và từ job cuối) không thể gửi hai lần, và digest có splice `results`
  // giữa chừng thì tin của kênh cũng đã giữ được bản sao của mình.
  function maybeReportChannel(sheetName) {
    if (!notifyChannel) return;                                  // tắt công tắc → khỏi tốn ~20s chụp
    if (!channelEnded.has(sheetName)) return;                    // runner chưa báo hết job
    if ((pendingByChannel.get(sheetName) ?? 0) > 0) return;       // còn video đang upload
    if (reported.has(sheetName)) return;
    const mine = results.filter((r) => r.sheetName === sheetName);
    if (!mine.length) return;                                    // không có video mới → không gửi
    reported.add(sheetName);

    const task = sendChannelReport(sheetName, mine).finally(() => reportTasks.delete(task));
    reportTasks.add(task);
  }

  // Chụp + gửi. Mọi lỗi chỉ ghi log: mất ảnh không được làm mất kết quả.
  async function sendChannelReport(sheetName, mine) {
    // Chụp mất ~20s. scheduleClose() vừa chạy ở finally của job cuối, nên với
    // gpmIdleCloseMin nhỏ, closeIdleConns() có thể nổ giữa lúc đang chụp và giết page.
    cancelClose();
    let image = null;
    const p = lastProfile.get(sheetName);
    const c = p && conns.get(p.profileId);
    if (!c) log(`[${sheetName}] không chụp được trang Nội dung — trình duyệt GPM đã đóng`);
    else {
      try { image = await capture(c.page, { log }); }
      catch (e) { log(`[${sheetName}] chụp trang Nội dung lỗi: ${e?.message || e}`); }
    }
    try { await notifyChannel(sheetName, mine, image); }
    catch (e) { log(`[${sheetName}] lỗi gửi Telegram: ${e?.message || e}`); }
    scheduleClose(); // gửi xong mới tính lại giờ đóng trình duyệt
  }

  // Runner báo: lượt này hết job cho kênh này (gọi ở finally của runChannel).
  // Đồng bộ và không bao giờ ném lỗi — runner gọi trong finally, không await.
  function endChannel(sheetName) {
    channelEnded.add(sheetName);
    try { maybeReportChannel(sheetName); } catch (e) { log(`[${sheetName}] lỗi báo kênh: ${e?.message || e}`); }
  }

  async function runJob(job) {
    const { sheetName, gpmHost, profileId, videoPath, overlaysDir, title, postTimes, locale, rowIndex, sourceUrl } = job;
    lastProfile.set(sheetName, { gpmHost, profileId });
    // Nguồn sự thật = Sheet cột C (đọc 1 lần/lượt, cache).
    const ch = await getChannelUploads(sheetName);

    // Đã lên lịch rồi (cột C của URL này là "✅ lên lịch…") → bỏ qua (tránh up trùng).
    if (sourceUrl && ch.scheduledUrls.has(sourceUrl)) {
      log(`[${sheetName}] bỏ qua (Sheet báo đã lên lịch): ${title}`);
      return;
    }

    const { thumbnailPath, scheduleISO } = prepareJob({
      videoPath, overlaysDir, postTimes, usedSlots: ch.usedSlots, now: now(), listFiles,
    });

    // Hết slot ngày mai → để video chờ lượt sau (không đánh dấu, không tính vào digest).
    if (!scheduleISO) {
      log(`[${sheetName}] hết slot ngày mai — để chờ: ${title}`);
      return;
    }

    log(`[${sheetName}] upload "${title}" → lịch ${scheduleISO}${thumbnailPath ? "" : " (⚠ không thấy thumb)"}`);
    emitUpload(sheetName, "⏳ đang upload", { title, url: sourceUrl });
    await writeStatus(sheetName, rowIndex, "⏳ đang upload");
    const { page } = await getConn(gpmHost, profileId);
    // Mỗi bước: cập nhật cả bảng UI lẫn Sheet.
    const onStep = (msg) => { emitUpload(sheetName, msg, { title, url: sourceUrl }); return writeStatus(sheetName, rowIndex, msg); };

    // Retry: chỉ thử lại khi CHƯA bắt đầu upload (tránh tạo bản nháp trùng trên YouTube).
    let uploaded = false;
    let lastErr = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await runUpload({
          page, videoPath, title, thumbnailPath, scheduleISO, locale, log,
          onUploaded: () => { uploaded = true; },
          onStep,
        });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (uploaded) break; // đã bắt đầu upload → không retry
        if (attempt < retries) {
          log(`[${sheetName}] lỗi (thử ${attempt}/${retries}): ${e?.message || e}`);
          await sleepFn(retryDelayMs * attempt);
        }
      }
    }

    if (lastErr) {
      const msg = String(lastErr?.message || lastErr).slice(0, 200);
      results.push({ sheetName, title, ok: false, error: msg });
      emitUpload(sheetName, `❌ lỗi: ${msg}`, { title, ok: false, url: sourceUrl });
      await writeStatus(sheetName, rowIndex, `❌ lỗi: ${msg}`);
      log(`❌ [${sheetName}] ${title}: ${msg}`);
      return;
    }

    // Thành công → cập nhật cache (để video kế cùng kênh lấy slot khác) + digest + ghi Sheet.
    ch.usedSlots.push(scheduleISO);
    if (sourceUrl) ch.scheduledUrls.add(sourceUrl);
    results.push({ sheetName, title, ok: true, scheduleISO });
    const schedText = `✅ lên lịch ${formatSchedule(scheduleISO)}`;
    emitUpload(sheetName, schedText, { title, ok: true, url: sourceUrl });
    await writeStatus(sheetName, rowIndex, schedText);
    log(`[${sheetName}] ✅ đã lên lịch: ${title}`);
  }

  // Enqueue 1 video; các video cùng kênh chạy TUẦN TỰ.
  function enqueue(job) {
    cancelClose(); // đồng bộ, trước mọi await: có việc mới thì đừng đóng trình duyệt
    pending++;
    pendingByChannel.set(job.sheetName, (pendingByChannel.get(job.sheetName) ?? 0) + 1);
    const prev = chains.get(job.sheetName) || Promise.resolve();
    const next = prev
      .then(() => runJob(job))
      .catch((e) => log(`❌ [${job.sheetName}] ${e?.message || e}`))
      .finally(() => {
        pending--;
        pendingByChannel.set(job.sheetName, (pendingByChannel.get(job.sheetName) ?? 1) - 1);
        if (pending === 0) { scheduleFlush(); scheduleClose(); } // rảnh → gửi digest + hẹn đóng
        // Sau scheduleClose: cancelClose() bên trong sẽ huỷ đúng cái hẹn vừa đặt.
        maybeReportChannel(job.sheetName);
      });
    chains.set(job.sheetName, next);
    return next;
  }

  // Đợi mọi hàng đợi + mọi tin đang gửi xong (test/shutdown).
  async function drain() {
    await Promise.all([...chains.values()].map((p) => p.catch(() => {})));
    await Promise.all([...reportTasks].map((p) => p.catch(() => {})));
  }

  // Runner báo: bắt đầu 1 lượt chạy (tải+render) → tạm ngưng gửi digest + đọc lại Sheet mới.
  function beginRun() {
    cancelClose();
    runActive = true;
    channelCache.clear();
    channelEnded.clear();
    reported.clear();
  }
  // Runner báo: lượt chạy xong → cho phép gửi digest khi upload cũng rỗng.
  function endRun() { runActive = false; if (pending === 0) { scheduleFlush(); scheduleClose(); } }

  return { enqueue, drain, prepareJob, beginRun, endRun, endChannel };
}
