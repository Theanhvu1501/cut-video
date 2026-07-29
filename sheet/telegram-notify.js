// Gửi thông báo Telegram (chỉ sendMessage, không cần bot polling).

const CAPTION_MAX = 1024;
const ALBUM_MAX = 10; // Telegram: mỗi sendMediaGroup tối đa 10 ảnh
const SEND_ATTEMPTS = 3;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Telegram giới hạn ~1 tin/giây cho mỗi chat. Gửi liên tiếp nhiều ảnh là dính
// 429 kèm parameters.retry_after — trước đây ảnh bị vứt luôn. Chờ đúng số giây
// Telegram yêu cầu rồi gửi lại. buildBody là hàm vì FormData không dùng lại được.
async function postWithRetry(url, buildBody, { fetchFn, sleep, attempts = SEND_ATTEMPTS }) {
  let last = { ok: false, error: "không gửi được" };

  for (let i = 1; i <= attempts; i++) {
    let data;
    try {
      const res = await fetchFn(url, { method: "POST", body: buildBody() });
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
    { fetchFn, sleep },
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

// Gửi NHIỀU ảnh trong một request (album). Gửi từng tấm liên tiếp bằng sendPhoto
// sẽ dính 429 và mất ảnh; một sendMediaGroup 10 ảnh chỉ tính là một tin.
// items: [{ photo: Buffer, caption?: string }] → { ok, error?, sent }
export async function sendTelegramMediaGroup(token, chatId, items, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const sleep = deps.sleep || defaultSleep;
  if (!token || !chatId) return { ok: false, error: "thiếu token/chatId", sent: 0 };

  const list = (items || []).filter((it) => it && it.photo);
  if (!list.length) return { ok: true, sent: 0 };

  let sent = 0;
  const errors = [];

  for (let i = 0; i < list.length; i += ALBUM_MAX) {
    const chunk = list.slice(i, i + ALBUM_MAX);

    // Album phải có từ 2 ảnh trở lên; lẻ đúng 1 tấm thì gửi kiểu thường.
    const r =
      chunk.length === 1
        ? await sendTelegramPhoto(token, chatId, chunk[0].photo, chunk[0].caption, deps)
        : await postWithRetry(
            `https://api.telegram.org/bot${token}/sendMediaGroup`,
            () => {
              const form = new FormData();
              form.append("chat_id", chatId);
              form.append(
                "media",
                JSON.stringify(
                  chunk.map((it, n) => ({
                    type: "photo",
                    media: `attach://photo${n}`,
                    ...(it.caption ? { caption: String(it.caption).slice(0, CAPTION_MAX) } : {}),
                  })),
                ),
              );
              chunk.forEach((it, n) =>
                form.append(`photo${n}`, new Blob([it.photo], { type: "image/png" }), `photo${n}.png`),
              );
              return form;
            },
            { fetchFn, sleep },
          );

    if (r.ok) sent += chunk.length;
    else errors.push(r.error || "?");
  }

  return errors.length ? { ok: false, error: errors.join("; "), sent } : { ok: true, sent };
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
