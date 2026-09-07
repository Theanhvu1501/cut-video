// Cấu hình yt-dlp sửa được ngay trong app.
// YouTube đổi cơ chế liên tục nên chuỗi --extractor-args phải nằm ở file config;
// hardcode trong code thì mỗi lần YouTube đổi lại phải build lại app.
//
// File: <configDir>/ytdlp-settings.json — DÙNG CHUNG cho cả tải thủ công (download.js)
// lẫn chạy tự động theo Sheet (channel-download.js), để chỉ phải sửa đúng một chỗ.

import fs from "fs";
import path from "path";

// Mặc định KHÔNG ép player_client. Có PO token (bgutil) rồi thì để yt-dlp tự chọn
// client là tốt nhất; ép cứng client nào cũng là tự bó tay khi YouTube đổi cơ chế.
//
// Đo trên máy này, cùng một video, cùng yt-dlp 2026.08.19:
//   ép player_client=android  -> "Downloading 1 format(s): 18"      (360p, không xin PO token)
//   không ép, có bgutil       -> "Downloading 1 format(s): 401+251" (2160p)
// Cờ android vừa làm PO token vô nghĩa (client android không dùng PO token web) vừa
// âm thầm kéo chất lượng xuống mà không báo lỗi gì.
export const DEFAULT_EXTRACTOR_ARGS = "";

const FILE_NAME = "ytdlp-settings.json";

export function ytdlpSettingsPath(dir) {
  return path.join(dir, FILE_NAME);
}

// Chuỗi người dùng gõ -> mảng cho youtube-dl-exec (mỗi dòng là một mục --extractor-args).
// Rỗng -> [] nghĩa là KHÔNG truyền cờ, để yt-dlp tự quyết.
export function parseExtractorArgs(raw) {
  return String(raw ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Thiếu file hoặc JSON hỏng -> mặc định (app vẫn tải được, không chết vì file config).
// Có khoá nhưng rỗng -> GIỮ rỗng: đó là lựa chọn cố ý "không truyền cờ", không được
// lặng lẽ nhét mặc định vào rồi người dùng tưởng mình đã tắt.
export function loadYtdlpSettings(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(ytdlpSettingsPath(dir), "utf-8"));
    const v = raw?.extractorArgs;
    return { extractorArgs: typeof v === "string" ? v : DEFAULT_EXTRACTOR_ARGS };
  } catch {
    return { extractorArgs: DEFAULT_EXTRACTOR_ARGS };
  }
}

export function saveYtdlpSettings(dir, settings) {
  const v = settings?.extractorArgs;
  const extractorArgs = typeof v === "string" ? v : DEFAULT_EXTRACTOR_ARGS;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ytdlpSettingsPath(dir), JSON.stringify({ extractorArgs }, null, 2), "utf-8");
  return { extractorArgs };
}
