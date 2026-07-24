// Gửi thông báo Telegram (chỉ sendMessage, không cần bot polling).

export async function sendTelegram(token, chatId, text, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  if (!token || !chatId) return { ok: false, error: "thiếu token/chatId" };
  const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: !!data.ok, error: data.description };
}

// Gửi ảnh (multipart). Telegram giới hạn caption 1024 ký tự.
export async function sendTelegramPhoto(token, chatId, photo, caption, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  if (!token || !chatId) return { ok: false, error: "thiếu token/chatId" };
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption.slice(0, 1024));
  form.append("photo", new Blob([photo], { type: "image/png" }), "content.png");
  // KHÔNG đặt Content-Type thủ công — fetch phải tự sinh boundary cho multipart.
  const res = await fetchFn(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  return { ok: !!data.ok, error: data.description };
}

// Caption cho ảnh trang Nội dung của 1 kênh (hàm thuần).
export function buildShotCaption(sheetName, results) {
  const mine = (results || []).filter((r) => r.sheetName === sheetName);
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
