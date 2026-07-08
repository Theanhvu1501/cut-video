import fs from "fs";
import path from "path";
import { create as createYoutubeDl } from "youtube-dl-exec";

export function pickDownloadedFile(dirBefore, dirAfter) {
  const beforeSet = new Set(dirBefore);
  const added = dirAfter.filter((f) => !beforeSet.has(f));
  const mp4 = added.find((f) => f.toLowerCase().endsWith(".mp4"));
  return mp4 || null;
}

function isValidProxy(p) {
  return typeof p === "string" && /^(http|https|socks5):\/\//i.test(p.trim());
}

export async function downloadOne(url, outputDir, { proxy, cookiesFile, ytdlpPath } = {}) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const before = fs.readdirSync(outputDir);

  const ytdl = createYoutubeDl(ytdlpPath);
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
  if (isValidProxy(proxy)) options.proxy = proxy.trim();

  await ytdl(url, options);

  const after = fs.readdirSync(outputDir);
  const newMp4 = pickDownloadedFile(before, after);
  if (!newMp4) throw new Error(`Không tìm thấy file tải về cho URL: ${url}`);
  const filePath = path.join(outputDir, newMp4);
  const title = path.basename(newMp4, ".mp4");
  const thumbCandidate = path.join(outputDir, `${title}.jpg`);
  return { filePath, title, thumbPath: fs.existsSync(thumbCandidate) ? thumbCandidate : null };
}
