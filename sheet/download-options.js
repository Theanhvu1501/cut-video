// Bộ cờ yt-dlp cho luồng tải theo Sheet — CHÉP LẠI y hệt luồng tải thủ công
// (download.js) vì luồng đó đang tải được, còn bên Sheet trước đây khoá cứng 720p,
// không có cookies và không có JS runtime nên hay trượt.
//
// CỐ Ý CHÉP chứ không import ngược từ download.js: download.js là script chạy bằng
// tiến trình node riêng, đọc config qua biến môi trường và có state ở cấp module —
// nối nó vào tiến trình Electron chỉ để dùng chung vài hằng số là đổi luôn cả đường
// chạy đang ổn định. Sửa cờ tải thì sửa CẢ HAI FILE.
//
// Khác biệt duy nhất so với download.js là dạng tham số --js-runtime, xem jsRuntimeArg().

import fs from "fs";
import path from "path";
import { parseExtractorArgs } from "./ytdlp-config.js";

// Giống download.js: ưu tiên 1080p mp4/avc, rồi tụt dần. Chuỗi fallback là phần
// quan trọng — khoá cứng một mức (bản cũ để height=720) thì video không có đúng
// mức đó là trượt cả URL.
export const DOWNLOAD_FORMAT =
  "bestvideo[height<=1080][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4][vcodec^=avc]/bestvideo[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[ext=mp4][vcodec^=avc]";

export const DOWNLOAD_HEADERS = [
  "referer:youtube.com",
  "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
];

// Giới hạn byte cho tên file khi tải về Drive (Drive giới hạn 255 byte, tiếng Nhật/
// Trung/Hàn mỗi ký tự 3 byte nên phải cắt ngắn hơn).
const DRIVE_FILENAME_LIMITS = {
  jp: 240,
  cn: 240,
  kr: 240,
  th: 255,
  ar: 255,
  vi: 255,
  en: 255,
  default: 240,
};

export function getDriveFilenameLimit(language) {
  return DRIVE_FILENAME_LIMITS[language] || DRIVE_FILENAME_LIMITS.default;
}

// yt-dlp nhận --js-runtime RUNTIME[:PATH]. Truyền đường dẫn trần thì nó cắt ở dấu ":"
// đầu tiên và hiểu ổ đĩa "D" là tên runtime -> "Ignoring unsupported JavaScript
// runtime(s): d" -> "JS runtimes: none". Mất JS runtime thì YouTube chỉ trả về vài
// format và không có cảnh báo nào đáng chú ý, nên phải ghi rõ tên runtime là node.
export function jsRuntimeArg(nodePath) {
  const v = String(nodePath ?? "").trim();
  if (!v) return null;
  if (/^[A-Za-z0-9]+:(?![\\/])/.test(v)) return v; // đã ở dạng runtime[:path]
  if (!path.isAbsolute(v)) return v; // tên trần: "node", "deno"...
  return `node:${v}`;
}

// Chép từ download.js: bản đóng gói không có node hệ thống nên phải dùng bin/node.exe
// đi kèm; chạy dev thì "node" trong PATH.
export function getNodeExecutable(baseDir) {
  const dir = String(baseDir ?? "");
  const isPackaged = dir.includes("app.asar") || dir.includes("resources");
  if (!isPackaged) return "node";

  const candidates = [
    path.join(dir, "bin", "node.exe"),
    path.join(dir, "..", "bin", "node.exe"),
    path.join(dir, "..", "..", "bin", "node.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return path.normalize(p);
  }
  return "node";
}

// Đọc settings.download trong projects/<tên>.json — đúng nơi tab "Tải video" ghi
// xuống, để tải theo Sheet ăn cùng một cấu hình với tải thủ công.
// Thiếu file / JSON hỏng -> mặc định, không ném lỗi: cấu hình sai không được làm
// chết cả lượt chạy tự động.
export function loadDownloadConfig(projectsDir, projectName) {
  const fallback = {
    cookiesFile: null,
    downloadDrive: false,
    driveLanguage: "jp",
    descFolder: null,
    proxy: null,
  };
  try {
    const raw = fs.readFileSync(path.join(projectsDir, `${projectName}.json`), "utf-8");
    const cfg = JSON.parse(raw)?.settings?.download;
    if (!cfg) return fallback;

    const proxyRaw = typeof cfg.proxy === "string" ? cfg.proxy.trim() : cfg.proxy;
    const proxy =
      proxyRaw && proxyRaw !== "null" && proxyRaw !== "undefined" ? proxyRaw : null;

    return {
      cookiesFile: cfg.cookiesFile || null,
      downloadDrive: cfg.downloadDrive === undefined ? false : !!cfg.downloadDrive,
      driveLanguage: cfg.driveLanguage || "jp",
      descFolder: cfg.descFolder || null,
      proxy,
    };
  } catch {
    return fallback;
  }
}

export function buildOutputTemplate(outputDir, { downloadDrive = false, driveLanguage = "jp" } = {}) {
  if (!downloadDrive) return path.join(outputDir, "%(title)s.%(ext)s");
  return path.join(outputDir, `%(title).${getDriveFilenameLimit(driveLanguage)}B.%(ext)s`);
}

// Dựng object options cho youtube-dl-exec. Khoá nào không có giá trị thì KHÔNG đặt
// vào object — youtube-dl-exec dịch mọi khoá thành cờ dòng lệnh, đặt khoá rỗng là
// truyền cờ rỗng.
export function buildYtdlOptions({
  outputDir,
  cookiesFile = null,
  proxyUrl = null,
  downloadDrive = false,
  driveLanguage = "jp",
  descDir = null,
  extractorArgs,
  jsRuntime = null,
} = {}) {
  const options = {
    output: buildOutputTemplate(outputDir, { downloadDrive, driveLanguage }),
    format: DOWNLOAD_FORMAT,
    mergeOutputFormat: "mp4",
    writeThumbnail: true,
    convertThumbnails: "jpg",
    addHeader: [...DOWNLOAD_HEADERS],
    limitRate: "2M",
    noOverwrites: true,
  };

  const extractor = parseExtractorArgs(extractorArgs);
  if (extractor.length) options.extractorArgs = extractor;

  const runtime = jsRuntimeArg(jsRuntime);
  if (runtime) options.jsRuntime = runtime;

  // File cookies mất/đổi chỗ thì tải thẳng không cookies, hơn là để yt-dlp chết vì
  // đường dẫn không tồn tại.
  if (cookiesFile && fs.existsSync(cookiesFile)) options.cookies = cookiesFile;

  if (descDir && fs.existsSync(descDir)) options.writeDescription = true;

  if (proxyUrl) options.proxy = proxyUrl;

  return options;
}
