// Chọn file thumbnail khớp với video theo title (tên file gốc).
// yt-dlp lưu thumbnail cùng basename với video (<title>.jpg cạnh <title>.mp4),
// bước xử lý overlay giữ nguyên tên → match theo basename là đúng.

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

export function basename(p) {
  return String(p ?? "").split(/[\\/]/).pop() || "";
}

function stem(name) {
  return basename(name).replace(/\.[^.]+$/, "");
}

function ext(name) {
  const m = basename(name).match(/\.[^.]+$/);
  return m ? m[0].toLowerCase() : "";
}

// Bỏ dấu tiếng Việt + hạ chữ thường + gộp khoảng trắng, để so title mềm dẻo.
function norm(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "d")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Tìm file ảnh thumbnail cho 1 video.
 * @param {string} videoFile - đường dẫn/tên video (vd "New Title.mp4")
 * @param {string[]} candidateFiles - danh sách file ảnh ứng viên (đường dẫn hoặc tên)
 * @returns {string|null} file ảnh khớp, hoặc null nếu không có.
 */
export function findThumbnailForVideo(videoFile, candidateFiles) {
  if (!videoFile || !Array.isArray(candidateFiles)) return null;
  const target = norm(stem(videoFile));
  if (!target) return null;
  const images = candidateFiles.filter((f) => IMAGE_EXTS.includes(ext(f)));
  // 1. Khớp basename chính xác (sau chuẩn hoá).
  const exact = images.find((f) => norm(stem(f)) === target);
  if (exact) return exact;
  return null;
}
