// Kiểm tra nhanh: máy này còn tải được video YouTube không.
//
// Chạy đúng code path mà app dùng (pot-provider -> cookie-pool -> downloadOne), nên
// nó pass thì app tải được. Dùng khi YouTube đổi cơ chế và bắt đầu dính bot-check —
// chạy cái này trước để biết vấn đề nằm ở PO token, ở cookie, hay ở chỗ khác.
//
// Dùng:
//   node scripts/check-download.mjs
//   node scripts/check-download.mjs "https://youtu.be/<id>"

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { downloadOne } from "../sheet/channel-download.js";
import { startPotServer } from "../sheet/pot-provider.js";
import { createCookiePool } from "../sheet/cookie-pool.js";
import { getBgutilPaths, getNodeExecutable } from "../sheet/download-options.js";
import { loadYtdlpSettings } from "../sheet/ytdlp-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const URL_TEST = process.argv[2] || "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const bg = getBgutilPaths(ROOT);
console.log(`🔌 plugin bgutil : ${bg.pluginDir ?? "KHÔNG CÓ (chạy scripts/setup-bgutil.mjs)"}`);
console.log(`🔌 script dự phòng: ${bg.scriptPath ?? "không có"}`);

const { extractorArgs } = loadYtdlpSettings(ROOT);
console.log(`🧩 extractor-args : ${extractorArgs || "(không truyền — đúng như mong đợi)"}`);
if (/player_client=android/i.test(extractorArgs)) {
  console.log("⚠️  CẢNH BÁO: đang ép player_client=android — client này không dùng PO token");
  console.log("    web, YouTube sẽ trả về format 360p hoặc chặn thẳng. Nên để trống.");
}

const pool = createCookiePool({ folder: process.env.COOKIES_FOLDER, file: process.env.COOKIES_FILE });
console.log(`🍪 cookie         : ${pool.size} file`);

const server = await startPotServer({
  nodePath: getNodeExecutable(ROOT) === "node" ? path.join(ROOT, "bin", "node.exe") : getNodeExecutable(ROOT),
  serverDir: bg.serverDir,
  log: (m) => console.log(`   ${m}`),
});
console.log(`🔑 PO token server: ${server?.baseUrl ?? "không dựng được (sẽ dùng script mode)"}`);

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-check-"));
console.log(`\n⬇️  Thử tải: ${URL_TEST}`);

let failed = false;
try {
  const r = await downloadOne(URL_TEST, outDir, {
    cookiePool: pool,
    ytdlpPath: path.join(ROOT, "bin", "yt-dlp.exe"),
    jsRuntime: path.join(ROOT, "bin", "node.exe"),
    extractorArgs,
    pluginDirs: bg.pluginDir,
    potBaseUrl: server?.baseUrl ?? null,
    potScriptPath: bg.scriptPath,
    onRotate: ({ attempt, total }) => console.log(`   🔄 bị chặn, đổi cookie (${attempt}/${total})`),
  });
  const mb = (fs.statSync(r.filePath).size / 1024 / 1024).toFixed(1);
  console.log(`\n✅ TẢI ĐƯỢC — ${r.title} (${mb} MB)`);
} catch (err) {
  failed = true;
  const msg = String(err?.stderr || err?.message || err);
  console.error(`\n❌ TẢI HỎNG: ${msg.slice(0, 600)}`);
  if (/not a bot|Sign in to confirm/i.test(msg)) {
    console.error("   -> Vẫn dính bot-check. Bỏ thêm cookie .txt vào thư mục cookies,");
    console.error("      hoặc kiểm tra server PO token ở dòng trên có lên không.");
  }
} finally {
  await server?.stop?.();
  fs.rmSync(outDir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
