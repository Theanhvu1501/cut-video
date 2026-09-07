import fs from "fs";
import path from "path";
import { create as createYoutubeDl } from "youtube-dl-exec";
import { normalizeProxy } from "./proxy.js";
import { DEFAULT_EXTRACTOR_ARGS } from "./ytdlp-config.js";
import { buildYtdlOptions } from "./download-options.js";
import { createCookiePool } from "./cookie-pool.js";
import { downloadWithRetry } from "./download-retry.js";

export function pickDownloadedFile(dirBefore, dirAfter) {
  const beforeSet = new Set(dirBefore);
  const added = dirAfter.filter((f) => !beforeSet.has(f));
  const mp4 = added.find((f) => f.toLowerCase().endsWith(".mp4"));
  return mp4 || null;
}

export async function downloadOne(
  url,
  outputDir,
  {
    proxy,
    cookiesFile,
    cookiePool = null,
    downloadDrive = false,
    driveLanguage = "jp",
    descDir = null,
    jsRuntime = null,
    ytdlpPath,
    extractorArgs = DEFAULT_EXTRACTOR_ARGS,
    pluginDirs = null,
    potBaseUrl = null,
    potScriptPath = null,
    onRotate = null,
    ytdlFactory = createYoutubeDl,
  } = {},
) {
  // Proxy rỗng = cố ý tải thẳng. Proxy có giá trị mà hỏng -> ném lỗi trước khi
  // chạm mạng, không tải bằng IP thật (kết cục tệ nhất cho người né bot-check).
  // Proxy là thứ DUY NHẤT lấy từ Sheet (cột "proxy tải"); cookies/Drive/js-runtime
  // lấy từ cấu hình tải trong app, giống hệt luồng tải thủ công.
  const proxyUrl = String(proxy ?? "").trim() ? normalizeProxy(proxy) : null;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const before = fs.readdirSync(outputDir);

  const ytdl = ytdlFactory(ytdlpPath);

  // Không truyền pool thì dựng pool một cookie từ cookiesFile — lời gọi cũ và test cũ
  // giữ nguyên hành vi, chỉ là không có gì để xoay khi bị chặn.
  const pool = cookiePool ?? createCookiePool({ file: cookiesFile });

  // Bộ cờ dựng ở download-options.js — bản chép của luồng tải thủ công.
  // Dựng lại options mỗi lần thử vì cookie đổi theo từng lượt retry.
  await downloadWithRetry(
    (ck) =>
      ytdl(
        url,
        buildYtdlOptions({
          outputDir,
          cookiesFile: ck,
          proxyUrl,
          downloadDrive,
          driveLanguage,
          descDir,
          extractorArgs,
          jsRuntime,
          pluginDirs,
          potBaseUrl,
          potScriptPath,
        }),
      ),
    pool,
    { onRotate },
  );

  const after = fs.readdirSync(outputDir);
  const newMp4 = pickDownloadedFile(before, after);
  if (!newMp4) throw new Error(`Không tìm thấy file tải về cho URL: ${url}`);
  const filePath = path.join(outputDir, newMp4);
  const title = path.basename(newMp4, ".mp4");
  const thumbCandidate = path.join(outputDir, `${title}.jpg`);
  return { filePath, title, thumbPath: fs.existsSync(thumbCandidate) ? thumbCandidate : null };
}

// Kênh "lấy tại máy": copy file trong inputs/ sang overlays/ làm overlay, cùng shape
// trả về với downloadOne. File gốc trong inputs/ KHÔNG bị đụng (chỉ copy).
export function copyLocalOverlay(fileName, inputsDir, overlaysDir) {
  const src = path.join(inputsDir, fileName);
  if (!fs.existsSync(src)) throw new Error(`Không thấy file trong inputs: ${fileName}`);
  if (!fs.existsSync(overlaysDir)) fs.mkdirSync(overlaysDir, { recursive: true });
  const dest = path.join(overlaysDir, fileName);
  fs.copyFileSync(src, dest);
  const title = fileName.replace(/\.[^.]+$/, "");
  const jpg = path.join(inputsDir, `${title}.jpg`);
  if (fs.existsSync(jpg)) fs.copyFileSync(jpg, path.join(overlaysDir, `${title}.jpg`));
  return { filePath: dest, title };
}
