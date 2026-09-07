// Chép bgutil (server sinh PO token + plugin yt-dlp) từ một bản YouTubeDownloader
// Portable sang bin/bgutil.
//
// Vì sao phải chép tay thay vì npm install: node_modules của bgutil có `canvas` —
// module native, build trên Windows cần Visual Studio build tools và hay vỡ lúc
// đóng gói. Bản portable đã có sẵn bản build chạy được, chép sang là xong.
//
// bin/ nằm trong .gitignore nên thư mục này KHÔNG vào git — máy mới phải chạy lại
// script này (hoặc copy bin/ từ máy cũ).
//
// Dùng:
//   node scripts/setup-bgutil.mjs
//   node scripts/setup-bgutil.mjs "D:\path\den\YouTubeDownloader_Portable\_internal"

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DEST = path.join(ROOT, "bin", "bgutil");

// Nơi hay để bản portable. Đưa đường dẫn qua tham số nếu bạn để chỗ khác.
const GUESSES = [
  "D:\\Code\\YouTubeDownloader_Portable_v1.1.1\\YouTubeDownloader_Portable_v1.1.1\\_internal",
  "C:\\YouTubeDownloader_Portable\\_internal",
];

function findSource() {
  const fromArg = process.argv[2];
  const candidates = fromArg ? [fromArg] : GUESSES;
  for (const c of candidates) {
    // Đủ điều kiện khi có CẢ server lẫn plugin — thiếu một trong hai thì chép sang
    // cũng không tải được, mà lỗi lại chỉ hiện lúc tải.
    if (fs.existsSync(path.join(c, "bgutil-server", "build", "main.js")) &&
        fs.existsSync(path.join(c, "yt_dlp_plugins", "extractor", "getpot_bgutil_http.py"))) {
      return c;
    }
  }
  return null;
}

const src = findSource();
if (!src) {
  console.error("❌ Không tìm thấy bản portable có bgutil.");
  console.error("   Truyền đường dẫn thư mục _internal vào:");
  console.error('   node scripts/setup-bgutil.mjs "D:\\...\\YouTubeDownloader_Portable\\_internal"');
  process.exit(1);
}

console.log(`📁 Nguồn: ${src}`);

// Layout đích PHẢI đúng như dưới đây. Đã đo trên yt-dlp.exe 2026.08.19: chỉ
// --plugin-dirs <DIR> với <DIR>/<tên-package>/yt_dlp_plugins/ là được nạp; để plugin
// thẳng trong <DIR>/yt_dlp_plugins/ thì yt-dlp báo "Plugin directories: none" mà
// không hề có lỗi nào khác.
const pluginDest = path.join(DEST, "plugins", "bgutil-pot");
const serverDest = path.join(DEST, "server");

// Windows khoá thư mục đang là cwd của một tiến trình: app đang mở (hoặc một server
// bgutil mồ côi từ lần chạy trước) thì rmSync ném EBUSY. Nói thẳng phải làm gì, chứ
// stack trace của rimraf không gợi ý được gì.
try {
  fs.rmSync(DEST, { recursive: true, force: true });
} catch (err) {
  if (err?.code === "EBUSY" || err?.code === "EPERM") {
    console.error(`❌ ${DEST} đang bị khoá — có tiến trình đang dùng nó.`);
    console.error("   Đóng VidMaster rồi chạy lại. Nếu vẫn lỗi, tắt server bgutil còn sót:");
    console.error(
      '   powershell "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | ' +
        "Where-Object { $_.CommandLine -like '*main.js --port*' } | " +
        'Stop-Process -Force"',
    );
    process.exit(1);
  }
  throw err;
}
fs.mkdirSync(pluginDest, { recursive: true });

console.log("📋 Chép plugin yt-dlp...");
fs.cpSync(path.join(src, "yt_dlp_plugins"), path.join(pluginDest, "yt_dlp_plugins"), {
  recursive: true,
});

console.log("📋 Chép server bgutil (~173MB, hơi lâu)...");
fs.cpSync(path.join(src, "bgutil-server"), serverDest, { recursive: true });

const ok =
  fs.existsSync(path.join(serverDest, "build", "main.js")) &&
  fs.existsSync(path.join(serverDest, "build", "generate_once.js")) &&
  fs.existsSync(path.join(pluginDest, "yt_dlp_plugins", "extractor", "getpot_bgutil_http.py"));

if (!ok) {
  console.error("❌ Chép xong nhưng thiếu file — kiểm tra lại thư mục nguồn.");
  process.exit(1);
}

console.log(`✅ Xong: ${DEST}`);
console.log("   Mở app là server PO token tự chạy. Kiểm tra nhanh:");
console.log(`   bin\\yt-dlp.exe --plugin-dirs "${path.join(DEST, "plugins")}" --simulate -v <URL>`);
console.log("   Dòng cần thấy: [pot] PO Token Providers: bgutil:http-... (external)");
