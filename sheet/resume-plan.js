// Bộ quyết định thuần: đọc hai cột trạng thái của Sheet + sự tồn tại của file
// trên đĩa, trả về việc cần làm. Không I/O, không phụ thuộc — test được độc lập.

export const MAX_ATTEMPTS = 3;

export const ST = {
  DOWNLOADED: "đã tải",
  DONE: "done",
  ERR_DL: "lỗi tải:",
  ERR_RENDER: "lỗi render:",
  SKIP: "bỏ qua:",
};

export function skipText(msg) {
  return `${ST.SKIP} ${msg} (đã thử ${MAX_ATTEMPTS} lần)`;
}

export function decideAction({
  statusB = "", statusC = "",
  attempts = 0, uploadAttempts = 0,
  overlayExists = false, outputExists = false,
} = {}) {
  const b = String(statusB ?? "").trim();
  const c = String(statusC ?? "").trim();

  if (b.startsWith(ST.SKIP)) return "skip";

  if (b === ST.DONE) {
    if (!c.startsWith("❌")) return "skip";       // chưa upload, đang upload, hoặc đã xong
    if (!outputExists) return "skip";             // mất file render -> không upload lại được
    return uploadAttempts >= MAX_ATTEMPTS ? "upload-exhausted" : "upload-only";
  }

  // Ô rỗng = người dùng muốn làm lại từ đầu; biến đếm cũ không còn ý nghĩa.
  if (b === "") return "full";

  if (attempts >= MAX_ATTEMPTS) return "skip";

  if (b === ST.DOWNLOADED || b.startsWith(ST.ERR_RENDER)) {
    return overlayExists ? "render-only" : "full";
  }
  if (b.startsWith(ST.ERR_DL)) return "full";

  return "skip"; // trạng thái lạ: không đoán
}
