// Xoay vòng cookie để né bot-check.
//
// YouTube gắn cờ "not a bot" lên từng tài khoản/cookie chứ không lên máy, nên khi
// một cookie cháy thì cookie khác vẫn tải được. Bản portable dùng đúng cách này:
// bỏ 5-7 file cookie vào một thư mục, cháy cái nào thì nhảy sang cái kế tiếp.
//
// Không persist chỉ số đang dùng: một phiên chạy là đủ ngữ cảnh, còn ghi ra file
// thì lại thêm một file trạng thái phải dọn và phải lo hỏng.

import fs from "fs";
import path from "path";

// Thứ tự phải ổn định giữa các lần chạy, nếu không thì mỗi lần mở app lại bắt đầu
// từ một cookie khác và không đoán được cookie nào đang bị đốt. Sắp theo mã ký tự
// (không phải localeCompare) để không phụ thuộc locale của máy.
export function listCookieFiles(folder) {
  const dir = String(folder ?? "").trim();
  if (!dir) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".txt"))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    // Thư mục không tồn tại / không đọc được -> coi như không có cookie, để lời gọi
    // lùi về file đơn thay vì chết.
    return [];
  }
}

// folder có cookie -> xoay vòng cả thư mục.
// folder rỗng -> lùi về `file` đơn, đúng hành vi cũ để project cũ không vỡ.
// không có gì -> current() trả null, tải trần không cookies.
export function createCookiePool({ folder = null, file = null } = {}) {
  let files = listCookieFiles(folder);

  if (!files.length) {
    const single = String(file ?? "").trim();
    // Đường dẫn không tồn tại thì bỏ qua thay vì để yt-dlp chết vì --cookies trỏ vào
    // hư không — cùng cách xử lý với buildYtdlOptions.
    if (single && fs.existsSync(single)) files = [single];
  }

  let idx = 0;

  return {
    get size() {
      return files.length;
    },
    all: () => [...files],
    current: () => files[idx] ?? null,
    rotate() {
      if (files.length) idx = (idx + 1) % files.length;
    },
  };
}

// Luồng Sheet lấy cookie ở đâu.
//
// Có người CHỈ dùng Sheet, không bao giờ mở tab "Tải video", nên cookie phải set
// được ngay trong settings Sheet. Nhưng ai đang chạy Sheet bằng cookie ở tab Tải
// video thì không được mất cookie sau khi cập nhật -> settings Sheet trống mới lùi
// về đó.
//
// Sheet được lấy NGUYÊN CỤM (cả thư mục lẫn file, hoặc không gì cả): đặt file trong
// Sheet mà lại đi mượn thư mục của tab Tải video thì nhìn cấu hình không ai đoán
// được đang chạy bằng cookie nào.
const clean = (v) => {
  const s = String(v ?? "").trim();
  return s || null;
};

export function resolveSheetCookieSource(sheetSettings, downloadConfig) {
  const sheetFolder = clean(sheetSettings?.cookiesFolder);
  const sheetFile = clean(sheetSettings?.cookiesFile);
  if (sheetFolder || sheetFile) {
    return { folder: sheetFolder, file: sheetFile, source: "sheet" };
  }

  const dlFolder = clean(downloadConfig?.cookiesFolder);
  const dlFile = clean(downloadConfig?.cookiesFile);
  if (dlFolder || dlFile) {
    return { folder: dlFolder, file: dlFile, source: "download" };
  }

  return { folder: null, file: null, source: "none" };
}

// Dấu hiệu bị YouTube chặn, gom từ stderr yt-dlp:
// - "Sign in to confirm you're not a bot" (dấu nháy có thể thẳng hoặc cong)
// - 403 khi tải luồng media
// - "Requested format is not available": chặn trá hình — YouTube trả về danh sách
//   format rỗng/cụt thay vì báo lỗi thẳng, nên nhìn như lỗi chọn format.
const BOT_CHECK_PATTERNS = [
  /sign in to confirm/i,
  /not a bot/i,
  /http error 403/i,
  /requested format is not available/i,
];

export function isBotCheckError(err) {
  if (!err) return false;
  const msg =
    typeof err === "string"
      ? err
      : [err.message, err.stderr, err.shortMessage].filter(Boolean).join("\n");
  if (!msg) return false;
  return BOT_CHECK_PATTERNS.some((re) => re.test(msg));
}
