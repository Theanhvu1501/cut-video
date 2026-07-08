// Tính giờ lên lịch đăng cho video.
// - Slot giờ lấy từ cột postTimes trong Sheet ⚙config (vd "8:00, 18:00").
// - Lịch LUÔN bắt đầu từ ngày mai (không đăng trong hôm nay/giờ đã qua).
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

function parseLocal(s) {
  const m = String(s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
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
 * Tính slot lịch cho video hiện tại và con trỏ cho video kế tiếp.
 * @param {string|null} nextScheduleAt - con trỏ đã lưu (local ISO) hoặc null/"" lần đầu.
 * @param {string[]|string} postTimes - mảng/CSV giờ trong ngày.
 * @param {Date} now - thời điểm hiện tại (bơm để test).
 * @returns {{slot: string, next: string}|null} - slot gán cho video này + con trỏ kế tiếp; null nếu không có postTimes.
 */
export function computeNextSlot(nextScheduleAt, postTimes, now) {
  const times = parsePostTimes(postTimes);
  if (!times.length) return null;

  const baseline = atTime(startOfTomorrow(now), times[0]);
  let slot = parseLocal(nextScheduleAt);
  // Luôn ≥ ngày mai: con trỏ rỗng hoặc rơi vào quá khứ/hôm nay -> kéo về slot đầu ngày mai.
  if (!slot || slot < baseline) slot = baseline;

  const slotDateOnly = new Date(slot.getFullYear(), slot.getMonth(), slot.getDate(), 0, 0, 0, 0);
  const slotHHMM = `${pad(slot.getHours())}:${pad(slot.getMinutes())}`;
  const idx = times.indexOf(slotHHMM);

  let next;
  if (idx >= 0 && idx < times.length - 1) {
    next = atTime(slotDateOnly, times[idx + 1]); // còn slot sau trong ngày
  } else {
    const nd = new Date(slotDateOnly);
    nd.setDate(nd.getDate() + 1); // hết slot -> sang ngày kế, slot đầu
    next = atTime(nd, times[0]);
  }
  return { slot: fmt(slot), next: fmt(next) };
}
