// Hàng đợi upload lên YouTube qua GPM — serial theo từng kênh.
// Render xong 1 video → enqueue → (tuần tự) lấy thumb trong overlays theo title,
// cấp giờ lịch (ngày mai), rồi upload+thumb+lịch bằng yt-upload.
// Một kênh chỉ xử lý 1 video tại một thời điểm; video sau chờ trong hàng đợi.

import path from "path";
import fs from "fs";
import { connectProfile } from "./gpm-client.js";
import { findThumbnailForVideo } from "./thumb-match.js";
import { assignTomorrowSlots } from "./schedule-slots.js";
import { uploadAndSchedule } from "./yt-upload.js";

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
 * loadState/saveState: đọc/ghi state gpm (mặc định caller cung cấp).
 */
export function createUploadQueue({
  loadState,
  saveState,
  connect = connectProfile,
  runUpload = uploadAndSchedule,
  now = () => new Date(),
  listFiles = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } },
  log = () => {},
  emit = () => {},                     // (evt) — phát sự kiện trạng thái lên UI ({type:"upload-status",...})
  notifyDigest = null,                 // async (results[]) — gửi digest khi hàng đợi rảnh
  setUploadStatus = async () => {},    // async (sheetName, rowIndex, status) — ghi ngược vào Sheet
  retries = 3,                         // số lần thử lại khi lỗi (chỉ khi CHƯA bắt đầu upload)
  retryDelayMs = 3000,
  flushMs = 3000,                      // chờ rảnh bao lâu trước khi gửi digest
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const chains = new Map(); // sheetName -> Promise (chuỗi serial theo kênh)
  const conns = new Map();  // profileId -> { browser, page } (tái dùng kết nối)
  const results = [];       // kết quả từ lượt bận hiện tại (để gộp digest)
  let pending = 0;          // số job đang chờ/chạy
  let flushTimer = null;

  async function getConn(gpmHost, profileId) {
    if (conns.has(profileId)) return conns.get(profileId);
    const c = await connect(gpmHost, profileId);
    conns.set(profileId, c);
    return c;
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
  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(async () => {
      if (pending > 0 || !results.length) return;
      const batch = results.splice(0, results.length);
      if (!notifyDigest) return;
      try { await notifyDigest(batch); } catch (e) { log(`Lỗi gửi Telegram: ${e?.message || e}`); }
    }, flushMs);
  }

  async function runJob(job) {
    const { sheetName, gpmHost, profileId, videoPath, overlaysDir, title, postTimes, locale, rowIndex } = job;
    const state = loadState() || {};
    const ch = state[sheetName] || (state[sheetName] = { usedSlots: [], videos: {} });

    // Đã lên lịch rồi → bỏ qua (resume/tránh trùng).
    if (ch.videos[videoPath]?.status === "scheduled") {
      log(`[${sheetName}] bỏ qua (đã lên lịch): ${title}`);
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
    emitUpload(sheetName, "⏳ đang upload", { title });
    await writeStatus(sheetName, rowIndex, "⏳ đang upload");
    const { page } = await getConn(gpmHost, profileId);
    // Mỗi bước: cập nhật cả bảng UI lẫn Sheet.
    const onStep = (msg) => { emitUpload(sheetName, msg, { title }); return writeStatus(sheetName, rowIndex, msg); };

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
      emitUpload(sheetName, `❌ lỗi: ${msg}`, { title, ok: false });
      await writeStatus(sheetName, rowIndex, `❌ lỗi: ${msg}`);
      log(`❌ [${sheetName}] ${title}: ${msg}`);
      return;
    }

    // Thành công → ghi state + digest + Sheet.
    ch.usedSlots.push(scheduleISO);
    ch.videos[videoPath] = { title, status: "scheduled", scheduledAt: scheduleISO };
    saveState(state);
    results.push({ sheetName, title, ok: true, scheduleISO });
    emitUpload(sheetName, `✅ lên lịch ${scheduleISO}`, { title, ok: true });
    await writeStatus(sheetName, rowIndex, `✅ lên lịch ${scheduleISO}`);
    log(`[${sheetName}] ✅ đã lên lịch: ${title}`);
  }

  // Enqueue 1 video; các video cùng kênh chạy TUẦN TỰ.
  function enqueue(job) {
    pending++;
    const prev = chains.get(job.sheetName) || Promise.resolve();
    const next = prev
      .then(() => runJob(job))
      .catch((e) => log(`❌ [${job.sheetName}] ${e?.message || e}`))
      .finally(() => {
        pending--;
        if (pending === 0) scheduleFlush(); // hàng đợi rảnh → gửi digest
      });
    chains.set(job.sheetName, next);
    return next;
  }

  // Đợi mọi hàng đợi xong (test/shutdown).
  async function drain() {
    await Promise.all([...chains.values()].map((p) => p.catch(() => {})));
  }

  return { enqueue, drain, prepareJob };
}
