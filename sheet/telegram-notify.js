// Gửi thông báo Telegram (chỉ sendMessage/sendPhoto, không cần bot polling).

import { formatSchedule } from "./schedule-slots.js";

const CAPTION_MAX = 1024;
const SEND_ATTEMPTS = 3;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Telegram giới hạn ~1 tin/giây cho mỗi chat. Gửi liên tiếp nhiều ảnh là dính
// 429 kèm parameters.retry_after — trước đây ảnh bị vứt luôn. Chờ đúng số giây
// Telegram yêu cầu rồi gửi lại. buildBody là hàm vì FormData không dùng lại được.
// headers: chỉ truyền cho body dạng chuỗi (JSON). Với FormData thì để undefined —
// fetch phải tự sinh Content-Type kèm boundary, đặt tay là hỏng multipart.
async function postWithRetry(url, buildBody, { fetchFn, sleep, headers, attempts = SEND_ATTEMPTS }) {
  let last = { ok: false, error: "không gửi được" };

  for (let i = 1; i <= attempts; i++) {
    let data;
    try {
      const res = await fetchFn(url, { method: "POST", body: buildBody(), ...(headers ? { headers } : {}) });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      // Lỗi mạng: thử lại chứ không để exception thoát ra giết cả lượt gửi.
      last = { ok: false, error: String(e?.message || e) };
      if (i === attempts) break;
      await sleep(1000 * i);
      continue;
    }

    if (data.ok) return { ok: true };
    last = { ok: false, error: data.description };

    const wait = Number(data?.parameters?.retry_after);
    if (!Number.isFinite(wait) || i === attempts) break;
    await sleep((wait + 1) * 1000);
  }

  return last;
}

export async function sendTelegram(token, chatId, text, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const sleep = deps.sleep || defaultSleep;
  if (!token || !chatId) return { ok: false, error: "thiếu token/chatId" };
  return postWithRetry(
    `https://api.telegram.org/bot${token}/sendMessage`,
    () => JSON.stringify({ chat_id: chatId, text }),
    { fetchFn, sleep, headers: { "Content-Type": "application/json" } },
  );
}

// Gửi ảnh (multipart). Telegram giới hạn caption 1024 ký tự.
export async function sendTelegramPhoto(token, chatId, photo, caption, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const sleep = deps.sleep || defaultSleep;
  if (!token || !chatId) return { ok: false, error: "thiếu token/chatId" };
  return postWithRetry(
    `https://api.telegram.org/bot${token}/sendPhoto`,
    () => {
      const form = new FormData();
      form.append("chat_id", chatId);
      if (caption) form.append("caption", caption.slice(0, CAPTION_MAX));
      form.append("photo", new Blob([photo], { type: "image/png" }), "content.png");
      return form;
    },
    { fetchFn, sleep },
  );
}

// Ghép các dòng chi tiết vào sau dòng tổng, giữ tổng độ dài trong CAPTION_MAX.
// Không cắt dở một dòng: hết chỗ thì dừng và ghi rõ còn bao nhiêu video nữa.
function fitCaption(head, lines) {
  let out = head;
  for (let i = 0; i < lines.length; i++) {
    const left = lines.length - i;
    // Nếu thêm dòng này thì phần còn lại là left-1 dòng, cần chỗ cho dòng "… và N nữa".
    const reserve = left > 1 ? `\n… và ${left - 1} video nữa`.length : 0;
    const next = `${out}\n${lines[i]}`;
    if (next.length + reserve > CAPTION_MAX) {
      const stopped = `${out}\n… và ${left} video nữa`;
      return stopped.length <= CAPTION_MAX ? stopped : out.slice(0, CAPTION_MAX);
    }
    out = next;
  }
  return out;
}

// Tin báo của MỘT kênh: dòng tổng + từng video kèm giờ lịch (hàm thuần).
// Dùng làm caption của ảnh trang Nội dung kênh đó. Rỗng khi kênh không có kết quả.
export function buildChannelReport(sheetName, results) {
  const mine = (results || []).filter((r) => r.sheetName === sheetName);
  if (!mine.length) return "";
  const ok = mine.filter((r) => r.ok);
  const err = mine.filter((r) => !r.ok);
  const head = `📋 ${sheetName} — ✅ ${ok.length} lên lịch, ❌ ${err.length} lỗi`;
  const lines = [
    ...ok.map((r) => `• ${r.title}${r.scheduleISO ? ` → ${formatSchedule(r.scheduleISO)}` : ""}`),
    ...err.map((r) => `• ❌ ${r.title}: ${r.error || "?"}`),
  ];
  return fitCaption(head, lines);
}

// Dựng tin digest dạng bảng từ danh sách kết quả upload (hàm thuần, test được).
// results: [{ sheetName, title, ok, error?, scheduleISO? }]
export function buildDigest(results) {
  if (!Array.isArray(results) || !results.length) return "";
  const byChannel = new Map();
  for (const r of results) {
    const c = byChannel.get(r.sheetName) || { ok: 0, err: 0 };
    if (r.ok) c.ok++;
    else c.err++;
    byChannel.set(r.sheetName, c);
  }
  const totalOk = results.filter((r) => r.ok).length;
  const totalErr = results.length - totalOk;

  const lines = [`📊 Kết quả upload — ✅ ${totalOk} lên lịch, ❌ ${totalErr} lỗi`, ""];
  for (const [ch, c] of byChannel) {
    lines.push(`• ${ch}: ✅ ${c.ok} | ❌ ${c.err}`);
  }
  // Không liệt kê chi tiết video đã lên lịch — số đếm theo kênh ở trên là đủ,
  // và giờ lịch của từng video đã có ở cột C của tab kênh.
  const errors = results.filter((r) => !r.ok);
  if (errors.length) {
    lines.push("", "❌ Chi tiết lỗi:");
    for (const e of errors) {
      lines.push(`— ${e.sheetName} · ${e.title}: ${e.error || "?"}`);
    }
  }
  return lines.join("\n");
}
