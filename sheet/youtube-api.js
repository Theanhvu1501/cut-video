// Nơi duy nhất chạm YouTube Data API v3. Client được truyền vào làm tham số
// (không tạo bên trong) để test bơm object giả, không cần mạng.
import { google } from "googleapis";

// Key cũ từ get-url.js. Đã lộ trong lịch sử git — người dùng nên tự tạo key
// riêng và dán vào ô "YouTube API key" trong tab Theo dõi Sheet.
export const DEFAULT_YT_API_KEY = "AIzaSyDZTsPGvG0u5du3t7YGueGgnNi7IiulMus";

const CHANNEL_ID_RE = /^UC[\w-]{22}$/;
const HANDLE_RE = /^[A-Za-z0-9._-]{3,30}$/;

// Nhận "@handle", "handle", "youtube.com/@handle", "youtube.com/channel/UC…", "UC…".
// Dạng cũ /c/Name và /user/Name không được hỗ trợ (API v3 đã bỏ forUsername cho hầu hết kênh).
export function parseChannelRef(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(.+)$/i);
  const rest = (m ? m[1] : s).split(/[?#]/)[0];

  const chan = rest.match(/^channel\/(UC[\w-]{22})(?:\/.*)?$/);
  if (chan) return { type: "id", value: chan[1] };

  const at = rest.match(/^@([A-Za-z0-9._-]{3,30})(?:\/.*)?$/);
  if (at) return { type: "handle", value: `@${at[1]}` };

  if (CHANNEL_ID_RE.test(rest)) return { type: "id", value: rest };
  if (HANDLE_RE.test(rest)) return { type: "handle", value: `@${rest}` };
  return null;
}

// Mọi dạng URL video -> videoId, để so trùng không phụ thuộc dạng URL.
export function videoIdOf(url) {
  const s = String(url ?? "").trim();
  return (
    s.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] ??
    s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)?.[1] ??
    s.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/)?.[1] ??
    null
  );
}

// Giữ nguyên thứ tự của `fetched`; bỏ URL đã có trong `existing` và bỏ trùng nội bộ.
export function pickNewUrls(existing, fetched) {
  const seen = new Set();
  for (const u of existing || []) {
    const id = videoIdOf(u);
    if (id) seen.add(id);
  }
  const out = [];
  for (const u of fetched || []) {
    const id = videoIdOf(u);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(u);
  }
  return out;
}

// "PT1H2M3S" -> 3723
export function parseDuration(duration) {
  const m = String(duration ?? "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

export function createYoutubeClient(apiKey) {
  return google.youtube({ version: "v3", auth: apiKey });
}
