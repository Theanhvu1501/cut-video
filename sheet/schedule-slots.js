// Tính giờ lên lịch đăng cho video — mô hình "cửa sổ 1 ngày".
// - Slot giờ lấy từ cột postTimes trong Sheet ⚙config (vd "8:00, 18:00").
// - Mỗi lần chỉ cấp slot TRỐNG của NGÀY MAI; video dư thì KHÔNG cấp (chờ lượt sau).
//   → tại mọi thời điểm chỉ có lịch tối đa 1 ngày tới, dễ kiểm soát, không mất video.
// - Hàm thuần, không phụ thuộc DOM/thời gian thực (bơm `now` để test).

function pad(n) {
  return String(n).padStart(2, "0");
}

// "8:00" | "08:00" -> "08:00"; không hợp lệ -> null
function normalizeTime(t) {
  const m = String(t ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

// "2026-07-09T08:00:00" -> "09/07/2026 08:00" (để hiển thị/thông báo).
export function formatSchedule(iso) {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return String(iso ?? "");
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}

// Trích giờ lịch ISO từ chuỗi trạng thái cột C ("✅ lên lịch 09/07/2026 08:00" -> "2026-07-09T08:00:00").
export function parseScheduledISO(statusText) {
  const m = String(statusText ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`;
}

export function parsePostTimes(raw) {
  if (Array.isArray(raw)) return raw.map(normalizeTime).filter(Boolean);
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeTime)
    .filter(Boolean);
}

// "YYYY-MM-DDTHH:MM:00" theo giờ local
function fmt(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function startOfTomorrow(now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d;
}

function atTime(dateOnly, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(dateOnly.getFullYear(), dateOnly.getMonth(), dateOnly.getDate(), h, m, 0, 0);
}

/**
 * Cấp các slot giờ TRỐNG của NGÀY MAI để gán cho video (cửa sổ 1 ngày).
 * @param {string[]|string} postTimes - giờ trong ngày, vd "8:00, 18:00".
 * @param {string[]} usedSlots - các slot ISO đã đặt (để không đặt trùng).
 * @param {Date} now - hiện tại (bơm để test).
 * @param {number} wantCount - số video đang chờ muốn lấy slot.
 * @returns {string[]} - tối đa wantCount slot ISO trống của ngày mai (theo thứ tự giờ);
 *   rỗng nếu hết slot / không có postTimes → video chờ lượt sau.
 */
export function assignTomorrowSlots(postTimes, usedSlots, now, wantCount) {
  const times = parsePostTimes(postTimes);
  const want = Number(wantCount) || 0;
  if (!times.length || want <= 0) return [];

  const tomorrow = startOfTomorrow(now);
  const used = new Set(usedSlots || []);
  const free = [];
  for (const t of times) {
    const iso = fmt(atTime(tomorrow, t));
    if (!used.has(iso)) free.push(iso);
    if (free.length >= want) break;
  }
  return free;
}
