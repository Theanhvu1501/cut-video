// Gửi thông báo Telegram (chỉ sendMessage/sendPhoto, không cần bot polling).

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

// Tin báo của MỘT kênh: đúng một dòng đếm, dùng làm caption cho ảnh trang Nội
// dung của kênh đó. Không liệt kê từng video — tiêu đề, giờ lịch và lý do lỗi
// đều đã nằm ở cột C của tab kênh, nhắc lại chỉ làm tin dài.
// Rỗng khi kênh không có kết quả nào.
export function buildChannelReport(sheetName, results) {
  const mine = (results || []).filter((r) => r.sheetName === sheetName);
  if (!mine.length) return "";
  const ok = mine.filter((r) => r.ok).length;
  return `📋 ${sheetName} — ✅ ${ok} lên lịch, ❌ ${mine.length - ok} lỗi`;
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
  // Không liệt kê chi tiết video nào — kể cả video lỗi. Số đếm theo kênh ở trên
  // là đủ; tiêu đề và lý do lỗi của từng video đã có ở cột C của tab kênh.
  return lines.join("\n");
}
