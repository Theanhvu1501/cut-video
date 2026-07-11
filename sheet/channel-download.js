import fs from "fs";
import path from "path";
import { create as createYoutubeDl } from "youtube-dl-exec";
import { normalizeProxy } from "./proxy.js";

export function pickDownloadedFile(dirBefore, dirAfter) {
  const beforeSet = new Set(dirBefore);
  const added = dirAfter.filter((f) => !beforeSet.has(f));
  const mp4 = added.find((f) => f.toLowerCase().endsWith(".mp4"));
  return mp4 || null;
}

export async function downloadOne(url, outputDir, { proxy, cookiesFile, ytdlpPath, ytdlFactory = createYoutubeDl } = {}) {
  // Proxy rỗng = cố ý tải thẳng. Proxy có giá trị mà hỏng -> ném lỗi trước khi
  // chạm mạng, không tải bằng IP thật (kết cục tệ nhất cho người né bot-check).
  const proxyUrl = String(proxy ?? "").trim() ? normalizeProxy(proxy) : null;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const before = fs.readdirSync(outputDir);

  const ytdl = ytdlFactory(ytdlpPath);
  const options = {
    output: path.join(outputDir, "%(title)s.%(ext)s"),
    format: "bestvideo[height=720][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height=720][ext=mp4][vcodec^=avc]",
    mergeOutputFormat: "mp4",
    writeThumbnail: true,
    convertThumbnails: "jpg",
    noOverwrites: true,
    limitRate: "2M",
    addHeader: [
      "referer:youtube.com",
      "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    ],
    extractorArgs: ["youtube:player_client=default,-android_sdkless"],
  };
  if (cookiesFile && fs.existsSync(cookiesFile)) options.cookies = cookiesFile;
  if (proxyUrl) options.proxy = proxyUrl;

  await ytdl(url, options);

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
