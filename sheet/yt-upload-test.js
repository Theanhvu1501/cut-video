// TEST upload trực tiếp 1 video (KHÔNG qua download→render) — để debug SEL nhanh.
// Chạy trong thư mục dự án, GPM Login đang mở:
//
//   node sheet/yt-upload-test.js <profileId> "<đường-dẫn-video>" ["<đường-dẫn-thumb>"] [gpmHost]
//
// Ví dụ:
//   node sheet/yt-upload-test.js abc123 "D:\ch\output\A.mp4" "D:\ch\overlays\A.jpg"
//
// Lịch mặc định = 8:00 ngày mai. Mỗi bước in log rõ (✓/✗) để biết sai SEL hay sai path.

import { connectProfile } from "./gpm-client.js";
import { uploadAndSchedule } from "./yt-upload.js";
import { assignTomorrowSlots } from "./schedule-slots.js";

const profileId = process.argv[2];
const videoPath = process.argv[3];
const thumbnailPath = process.argv[4] || undefined;
const gpmHost = process.argv[5] || "127.0.0.1:19995";

if (!profileId || !videoPath) {
  console.error('Dùng: node sheet/yt-upload-test.js <profileId> "<video>" ["<thumb>"] [gpmHost]');
  process.exit(1);
}

// Lịch = slot đầu tiên của ngày mai (8:00 nếu không đổi).
const [scheduleISO] = assignTomorrowSlots(["08:00"], [], new Date(), 1);

const log = (m) => console.log(m);

console.log(`Kết nối profile ${profileId} qua ${gpmHost}…`);
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
