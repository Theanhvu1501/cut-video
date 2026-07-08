// TEST upload trực tiếp 1 video (KHÔNG qua download→render) — để debug SEL nhanh.
// Chạy trong thư mục dự án, GPM Login đang mở.
//
// CÁCH 1 (khuyên dùng trên Windows — khỏi gõ tên file Unicode dài):
//   node sheet/yt-upload-test.js <profileId> "<FOLDER KÊNH>" [gpmHost]
//   → tự lấy video .mp4 đầu tiên trong <FOLDER KÊNH>\output và thumb khớp trong \overlays
//   ví dụ: node sheet/yt-upload-test.js abc123 "D:\VidMaster\ToolSheet\line"
//
// CÁCH 2 (chỉ đường dẫn cụ thể):
//   node sheet/yt-upload-test.js <profileId> "<video.mp4>" "<thumb.jpg>" [gpmHost]
//
// Lịch mặc định = 8:00 ngày mai. Mỗi bước in log rõ (✓/✗) để biết sai SEL hay sai path.

import fs from "fs";
import path from "path";
import { connectProfile } from "./gpm-client.js";
import { uploadAndSchedule } from "./yt-upload.js";
import { assignTomorrowSlots } from "./schedule-slots.js";
import { findThumbnailForVideo } from "./thumb-match.js";

const profileId = process.argv[2];
const arg2 = process.argv[3]; // folder kênh HOẶC file video
let arg3 = process.argv[4]; // thumb HOẶC gpmHost
let gpmHost = process.argv[5] || "127.0.0.1:19995";

if (!profileId || !arg2) {
  console.error('Dùng: node sheet/yt-upload-test.js <profileId> "<FOLDER KÊNH | video.mp4>" ["<thumb.jpg>"] [gpmHost]');
  process.exit(1);
}

let videoPath;
let thumbnailPath;

if (fs.existsSync(arg2) && fs.statSync(arg2).isDirectory()) {
  // CÁCH 1: folder kênh → tự tìm video + thumb (fs đọc tên Unicode chuẩn, không lo mangle).
  const root = arg2;
  const outputDir = fs.existsSync(path.join(root, "output")) ? path.join(root, "output") : root;
  const overlaysDir = path.join(root, "overlays");
  const mp4s = fs.readdirSync(outputDir).filter((f) => f.toLowerCase().endsWith(".mp4"));
  if (!mp4s.length) {
    console.error(`Không thấy file .mp4 nào trong: ${outputDir}`);
    process.exit(1);
  }
  videoPath = path.join(outputDir, mp4s[0]);
  const overlayFiles = fs.existsSync(overlaysDir)
    ? fs.readdirSync(overlaysDir).map((f) => path.join(overlaysDir, f))
    : [];
  thumbnailPath = findThumbnailForVideo(videoPath, overlayFiles) || undefined;
  // Trong chế độ folder, arg3 (nếu có) là gpmHost.
  if (arg3) gpmHost = arg3;
  console.log(`Tự chọn:\n  video: ${videoPath}\n  thumb: ${thumbnailPath || "(không tìm thấy trong overlays)"}`);
} else {
  // CÁCH 2: đường dẫn cụ thể. arg3 = thumb (nếu trông giống ip:port thì coi là gpmHost).
  videoPath = arg2;
  thumbnailPath = arg3;
  if (arg3 && /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(arg3)) {
    thumbnailPath = undefined;
    gpmHost = arg3;
  }
}

// Lịch = slot đầu tiên của ngày mai (8:00 nếu không đổi).
const [scheduleISO] = assignTomorrowSlots(["08:00"], [], new Date(), 1);

const log = (m) => console.log(m);

console.log(`\nKết nối profile ${profileId} qua ${gpmHost}…`);
try {
  const { page } = await connectProfile(gpmHost, profileId);
  console.log("Đã kết nối. Bắt đầu chạy 4 bước:\n");
  await uploadAndSchedule({ page, videoPath, thumbnailPath, scheduleISO, title: "", locale: "vi", log });
  console.log("\n✅ HOÀN TẤT. Kiểm tra trên YouTube Studio xem đúng chưa.");
  process.exit(0);
} catch (e) {
  console.error(`\n❌ LỖI: ${e?.message || e}`);
  console.error(e?.stack || "");
  process.exit(1);
}
