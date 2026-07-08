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
} = {}) {
  const chains = new Map(); // sheetName -> Promise (chuỗi serial theo kênh)
  const conns = new Map();  // profileId -> { browser, page } (tái dùng kết nối)

  async function getConn(gpmHost, profileId) {
    if (conns.has(profileId)) return conns.get(profileId);
    const c = await connect(gpmHost, profileId);
    conns.set(profileId, c);
    return c;
  }

  async function runJob(job) {
    const { sheetName, gpmHost, profileId, videoPath, overlaysDir, title, postTimes, locale } = job;
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

    // Hết slot ngày mai → để video chờ lượt sau (không đánh dấu).
    if (!scheduleISO) {
      log(`[${sheetName}] hết slot ngày mai — để chờ: ${title}`);
      return;
    }

    log(`[${sheetName}] upload "${title}" → lịch ${scheduleISO}${thumbnailPath ? "" : " (⚠ không thấy thumb)"}`);
    const { page } = await getConn(gpmHost, profileId);
    await runUpload({ page, videoPath, title, thumbnailPath, scheduleISO, locale, log });

    // Ghi state: đánh dấu đã lên lịch + slot đã dùng.
    ch.usedSlots.push(scheduleISO);
    ch.videos[videoPath] = { title, status: "scheduled", scheduledAt: scheduleISO };
    saveState(state);
    log(`[${sheetName}] ✅ đã lên lịch: ${title}`);
  }

  // Enqueue 1 video; các video cùng kênh chạy TUẦN TỰ.
  function enqueue(job) {
    const prev = chains.get(job.sheetName) || Promise.resolve();
    const next = prev
      .then(() => runJob(job))
      .catch((e) => log(`❌ [${job.sheetName}] ${e?.message || e}`));
    chains.set(job.sheetName, next);
    return next;
  }

  // Đợi mọi hàng đợi xong (test/shutdown).
  async function drain() {
    await Promise.all([...chains.values()].map((p) => p.catch(() => {})));
  }

  return { enqueue, drain, prepareJob };
}
