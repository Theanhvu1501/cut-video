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

const MAX_IDS_PER_CALL = 50; // giới hạn của channels.list khi truyền `id`

function toStats(ref, item) {
  const st = item.statistics || {};
  const hidden = !!st.hiddenSubscriberCount;
  return {
    ref,
    channelId: item.id,
    title: item.snippet?.title || "",
    subscribers: hidden ? null : Number(st.subscriberCount || 0),
    views: Number(st.viewCount || 0),
    videoCount: Number(st.videoCount || 0),
    hidden,
  };
}

// Trả mảng cùng thứ tự và cùng độ dài với `refs`. Ref hỏng trả { ref, error }
// thay vì ném, để một kênh hỏng không làm hỏng cả bảng.
export async function fetchChannelStats(yt, refs) {
  const list = (refs || []).map((ref) => ({ ref, parsed: parseChannelRef(ref) }));
  const results = new Map();

  for (const { ref, parsed } of list) {
    if (!parsed) results.set(ref, { ref, error: "Link kênh không hợp lệ" });
  }

  const ids = list.filter((x) => x.parsed?.type === "id");
  const handles = list.filter((x) => x.parsed?.type === "handle");

  for (let i = 0; i < ids.length; i += MAX_IDS_PER_CALL) {
    const batch = ids.slice(i, i + MAX_IDS_PER_CALL);
    try {
      const res = await yt.channels.list({
        part: ["snippet", "statistics"],
        id: batch.map((b) => b.parsed.value),
        maxResults: MAX_IDS_PER_CALL,
      });
      const byId = new Map((res.data.items || []).map((it) => [it.id, it]));
      for (const b of batch) {
        const item = byId.get(b.parsed.value);
        results.set(b.ref, item ? toStats(b.ref, item) : { ref: b.ref, error: "Không tìm thấy kênh" });
      }
    } catch (err) {
      const msg = String(err?.message || err);
      for (const b of batch) results.set(b.ref, { ref: b.ref, error: msg });
    }
  }

  // forHandle chỉ nhận một handle mỗi lần gọi — không gộp lô được.
  for (const h of handles) {
    try {
      const res = await yt.channels.list({ part: ["snippet", "statistics"], forHandle: h.parsed.value });
      const item = (res.data.items || [])[0];
      results.set(h.ref, item ? toStats(h.ref, item) : { ref: h.ref, error: "Không tìm thấy kênh" });
    } catch (err) {
      results.set(h.ref, { ref: h.ref, error: String(err?.message || err) });
    }
  }

  return (refs || []).map((ref) => results.get(ref));
}

// Lấy mọi video của kênh nguồn qua playlist uploads, lọc theo thời lượng.
// minSeconds = 600 -> chỉ giữ video dài hơn 10 phút (giống hành vi get-url.js cũ).
// Kết quả sắp xếp view giảm dần; video cùng view giữ thứ tự playlist (mới nhất trước).
export async function fetchSourceVideos(yt, handle, { minSeconds = 600 } = {}) {
  const ref = parseChannelRef(handle);
  if (!ref) throw new Error("@handle nguồn không hợp lệ");

  const chRes = await yt.channels.list(
    ref.type === "handle"
      ? { part: ["contentDetails"], forHandle: ref.value }
      : { part: ["contentDetails"], id: [ref.value] },
  );
  const ch = (chRes.data.items || [])[0];
  if (!ch) throw new Error("Không tìm thấy kênh nguồn");
  const playlistId = ch.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) throw new Error("Kênh nguồn không có playlist uploads");

  const out = [];
  let pageToken;
  do {
    const pl = await yt.playlistItems.list({ part: ["snippet"], playlistId, maxResults: 50, pageToken });
    const ids = (pl.data.items || []).map((it) => it.snippet?.resourceId?.videoId).filter(Boolean);
    if (ids.length) {
      const vres = await yt.videos.list({ part: ["contentDetails", "statistics", "snippet"], id: ids });
      for (const v of vres.data.items || []) {
        if (parseDuration(v.contentDetails?.duration) <= minSeconds) continue;
        out.push({
          url: `https://www.youtube.com/watch?v=${v.id}`,
          title: v.snippet?.title || "",
          viewCount: Number(v.statistics?.viewCount || 0),
          publishedAt: v.snippet?.publishedAt || "",
        });
      }
    }
    pageToken = pl.data.nextPageToken;
  } while (pageToken);
  out.sort((a, b) => b.viewCount - a.viewCount);
  return out;
}
