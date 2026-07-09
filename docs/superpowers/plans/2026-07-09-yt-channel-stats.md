# Theo dõi kênh YouTube + auto lấy URL nguồn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đọc sub/tổng view/số video của kênh đích qua YouTube Data API v3 rồi ghi vào `⚙config` và hiện thành bảng trong app; đồng thời tự nối URL video từ kênh nguồn vào cột A của tab kênh.

**Architecture:** Một module mới `sheet/youtube-api.js` là nơi duy nhất chạm YouTube API — client YouTube được truyền vào làm tham số nên test bơm object giả, không cần mạng. `sheet/sheets-service.js` nhận thêm các hàm đọc/ghi cột mới. `sheet/sheet-runner.js` nhận một dep `refreshStats` tùy chọn, gọi sau khi lượt render xong. `electron-main.js` ghép các mảnh lại và mở hai IPC; `renderer.js` vẽ bảng.

**Tech Stack:** Node ESM, `googleapis` (đã có trong deps), `node --test` + `node:assert/strict`, Electron IPC.

## Global Constraints

- Toàn bộ code là ESM (`import`/`export`). Repo không có TypeScript.
- Không thêm dependency mới. `googleapis` đã có sẵn.
- Chạy test bằng `npm test` (= `node --test 'tests/*.test.js'`).
- Mọi chuỗi hiện ra giao diện đều bằng tiếng Việt.
- Test không được gọi mạng thật và không được cần API key.
- Dấu thời gian dùng định dạng `dd/mm/yyyy hh:mm`.
- Tên tab cấu hình luôn là `⚙config`.
- App **không bao giờ tạo cột mới** trong Sheet. Cột không tồn tại thì bỏ qua khi ghi.
- Commit sau mỗi task.

---

### Task 1: Hàm thuần trong `sheet/youtube-api.js`

Ba hàm thuần, không chạm mạng. Đây là nền cho mọi task sau.

**Files:**
- Create: `sheet/youtube-api.js`
- Test: `tests/youtube-api.test.js`

**Interfaces:**
- Consumes: không có.
- Produces:
  - `parseChannelRef(input: string) → { type: "handle"|"id", value: string } | null`
  - `videoIdOf(url: string) → string | null`
  - `pickNewUrls(existing: string[], fetched: string[]) → string[]`
  - `parseDuration(iso: string) → number` (giây)
  - `DEFAULT_YT_API_KEY: string`

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/youtube-api.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChannelRef, videoIdOf, pickNewUrls, parseDuration } from "../sheet/youtube-api.js";

test("parseChannelRef nhận 4 dạng hợp lệ", () => {
  assert.deepEqual(parseChannelRef("@line4091"), { type: "handle", value: "@line4091" });
  assert.deepEqual(parseChannelRef("line4091"), { type: "handle", value: "@line4091" });
  assert.deepEqual(parseChannelRef("https://www.youtube.com/@line4091"), { type: "handle", value: "@line4091" });
  assert.deepEqual(parseChannelRef("https://youtube.com/@line4091/videos?x=1"), { type: "handle", value: "@line4091" });
  assert.deepEqual(parseChannelRef("https://www.youtube.com/channel/UCBR8-60-B28hp2BmDPdntcQ"), { type: "id", value: "UCBR8-60-B28hp2BmDPdntcQ" });
  assert.deepEqual(parseChannelRef("UCBR8-60-B28hp2BmDPdntcQ"), { type: "id", value: "UCBR8-60-B28hp2BmDPdntcQ" });
});

test("parseChannelRef trả null với rác", () => {
  assert.equal(parseChannelRef(""), null);
  assert.equal(parseChannelRef("   "), null);
  assert.equal(parseChannelRef(undefined), null);
  assert.equal(parseChannelRef("kênh của tôi"), null);
  assert.equal(parseChannelRef("https://www.youtube.com/c/SomeOldName"), null);
  assert.equal(parseChannelRef("https://youtu.be/dQw4w9WgXcQ"), null);
});

test("videoIdOf chuẩn hoá mọi dạng URL video", () => {
  assert.equal(videoIdOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(videoIdOf("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(videoIdOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"), "dQw4w9WgXcQ");
  assert.equal(videoIdOf("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(videoIdOf("https://example.com/abc"), null);
  assert.equal(videoIdOf(""), null);
});

test("pickNewUrls bỏ trùng kể cả khi hai URL khác dạng cùng trỏ một video", () => {
  const existing = ["https://youtu.be/aaaaaaaaaaa"];
  const fetched = [
    "https://www.youtube.com/watch?v=aaaaaaaaaaa", // trùng existing, khác dạng
    "https://www.youtube.com/watch?v=bbbbbbbbbbb",
    "https://www.youtube.com/watch?v=bbbbbbbbbbb", // trùng trong chính fetched
  ];
  assert.deepEqual(pickNewUrls(existing, fetched), ["https://www.youtube.com/watch?v=bbbbbbbbbbb"]);
});

test("pickNewUrls: trùng hoàn toàn trả mảng rỗng, không trùng trả nguyên danh sách", () => {
  const a = ["https://www.youtube.com/watch?v=aaaaaaaaaaa"];
  assert.deepEqual(pickNewUrls(a, a), []);
  assert.deepEqual(pickNewUrls([], a), a);
  assert.deepEqual(pickNewUrls(undefined, a), a);
});

test("parseDuration đổi ISO 8601 sang giây", () => {
  assert.equal(parseDuration("PT10M30S"), 630);
  assert.equal(parseDuration("PT1H2M3S"), 3723);
  assert.equal(parseDuration("PT45S"), 45);
  assert.equal(parseDuration(""), 0);
});
```

- [ ] **Step 2: Chạy test cho nó đỏ**

Run: `npm test 2>&1 | head -20`
Expected: FAIL — `Cannot find module '.../sheet/youtube-api.js'`

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `sheet/youtube-api.js`:

```js
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
```

- [ ] **Step 4: Chạy test cho nó xanh**

Run: `npm test 2>&1 | tail -12`
Expected: PASS — tất cả test trong `youtube-api.test.js` xanh, các file test cũ vẫn xanh.

- [ ] **Step 5: Commit**

```bash
git add sheet/youtube-api.js tests/youtube-api.test.js
git commit -m "feat(yt): hàm thuần parseChannelRef/videoIdOf/pickNewUrls"
```

---

### Task 2: `fetchChannelStats`

Lấy sub/view/số video. Gộp các `UC…` vào một lần gọi; `@handle` phải gọi lẻ vì `forHandle` chỉ nhận một handle.

**Files:**
- Modify: `sheet/youtube-api.js`
- Test: `tests/youtube-api.test.js`

**Interfaces:**
- Consumes: `parseChannelRef` (Task 1).
- Produces: `fetchChannelStats(yt, refs: string[]) → Promise<Array<Stat | ErrStat>>`, cùng thứ tự và cùng độ dài với `refs`.
  - `Stat = { ref, channelId, title, subscribers: number|null, views: number, videoCount: number, hidden: boolean }`
  - `ErrStat = { ref, error: string }`
  - `subscribers` là `null` khi `hidden === true`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `tests/youtube-api.test.js`:

```js
import { fetchChannelStats } from "../sheet/youtube-api.js";

// Client YouTube giả: ghi lại mọi tham số truyền vào channels.list.
function fakeYt({ items = [], throwOn = null } = {}) {
  const calls = [];
  return {
    calls,
    channels: {
      list: async (params) => {
        calls.push(params);
        if (throwOn && throwOn(params)) throw new Error("quotaExceeded");
        const wanted = params.id
          ? items.filter((it) => params.id.includes(it.id))
          : items.filter((it) => it._handle === params.forHandle);
        return { data: { items: wanted } };
      },
    },
  };
}

const CHAN = (id, handle, subs, views, vids, hidden = false) => ({
  id,
  _handle: handle,
  snippet: { title: `Kênh ${id}` },
  statistics: hidden
    ? { viewCount: String(views), videoCount: String(vids), hiddenSubscriberCount: true }
    : { subscriberCount: String(subs), viewCount: String(views), videoCount: String(vids) },
});

test("fetchChannelStats gộp các UC… vào một lần gọi, tách @handle thành gọi lẻ", async () => {
  const yt = fakeYt({
    items: [
      CHAN("UCBR8-60-B28hp2BmDPdntcQ", null, 100, 2000, 30),
      CHAN("UCaaaaaaaaaaaaaaaaaaaaaa", null, 200, 3000, 40),
      CHAN("UCbbbbbbbbbbbbbbbbbbbbbb", "@line4091", 300, 4000, 50),
    ],
  });
  const out = await fetchChannelStats(yt, [
    "UCBR8-60-B28hp2BmDPdntcQ",
    "https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa",
    "@line4091",
  ]);

  const idCalls = yt.calls.filter((c) => c.id);
  const handleCalls = yt.calls.filter((c) => c.forHandle);
  assert.equal(idCalls.length, 1, "hai UC… phải gộp vào đúng một lần gọi");
  assert.deepEqual(idCalls[0].id, ["UCBR8-60-B28hp2BmDPdntcQ", "UCaaaaaaaaaaaaaaaaaaaaaa"]);
  assert.equal(handleCalls.length, 1);
  assert.equal(handleCalls[0].forHandle, "@line4091");

  assert.equal(out.length, 3);
  assert.equal(out[0].subscribers, 100);
  assert.equal(out[1].views, 3000);
  assert.equal(out[2].videoCount, 50);
  assert.equal(out[2].title, "Kênh UCbbbbbbbbbbbbbbbbbbbbbb");
});

test("fetchChannelStats: ref hỏng không kéo sập các ref còn lại", async () => {
  const yt = fakeYt({ items: [CHAN("UCBR8-60-B28hp2BmDPdntcQ", null, 100, 2000, 30)] });
  const out = await fetchChannelStats(yt, ["kênh của tôi", "UCBR8-60-B28hp2BmDPdntcQ", "@khong-ton-tai"]);
  assert.equal(out[0].error, "Link kênh không hợp lệ");
  assert.equal(out[1].subscribers, 100);
  assert.equal(out[2].error, "Không tìm thấy kênh");
});

test("fetchChannelStats: kênh ẩn sub trả subscribers null, hidden true", async () => {
  const yt = fakeYt({ items: [CHAN("UCBR8-60-B28hp2BmDPdntcQ", null, 0, 2000, 30, true)] });
  const [s] = await fetchChannelStats(yt, ["UCBR8-60-B28hp2BmDPdntcQ"]);
  assert.equal(s.subscribers, null);
  assert.equal(s.hidden, true);
  assert.equal(s.views, 2000);
});

test("fetchChannelStats: API ném lỗi thì mọi ref trong lô đó nhận error", async () => {
  const yt = fakeYt({ items: [], throwOn: () => true });
  const out = await fetchChannelStats(yt, ["UCBR8-60-B28hp2BmDPdntcQ", "@line4091"]);
  assert.match(out[0].error, /quotaExceeded/);
  assert.match(out[1].error, /quotaExceeded/);
});
```

- [ ] **Step 2: Chạy test cho nó đỏ**

Run: `node --test tests/youtube-api.test.js 2>&1 | tail -12`
Expected: FAIL — `fetchChannelStats is not a function` hoặc `not exported`

- [ ] **Step 3: Viết implementation**

Thêm vào `sheet/youtube-api.js`:

```js
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
```

- [ ] **Step 4: Chạy test cho nó xanh**

Run: `npm test 2>&1 | tail -12`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sheet/youtube-api.js tests/youtube-api.test.js
git commit -m "feat(yt): fetchChannelStats gộp lô id, gọi lẻ handle"
```

---

### Task 3: `fetchSourceVideos` + refactor `get-url.js`

Lấy danh sách video của kênh nguồn. `get-url.js` bỏ phần gọi API, dùng module chung, nhưng vẫn là CLI ghi `.xlsx` như cũ.

**Files:**
- Modify: `sheet/youtube-api.js`
- Modify: `get-url.js` (thay dòng 1–12 và hàm `getVideoUrls`)
- Test: `tests/youtube-api.test.js`

**Interfaces:**
- Consumes: `parseChannelRef`, `parseDuration`, `createYoutubeClient`, `DEFAULT_YT_API_KEY` (Task 1).
- Produces: `fetchSourceVideos(yt, handle: string, opts?: { minSeconds?: number }) → Promise<Array<{ url, title, viewCount: number, publishedAt: string }>>`. Mặc định `minSeconds = 600`. Ném `Error` nếu handle hỏng hoặc không tìm thấy kênh.

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `tests/youtube-api.test.js`:

```js
import { fetchSourceVideos } from "../sheet/youtube-api.js";

// Client giả có đủ channels/playlistItems/videos, hỗ trợ 2 trang.
function fakeSourceYt() {
  return {
    channels: {
      list: async () => ({ data: { items: [{ contentDetails: { relatedPlaylists: { uploads: "UUxxx" } } }] } }),
    },
    playlistItems: {
      list: async ({ pageToken }) =>
        pageToken === "p2"
          ? { data: { items: [{ snippet: { resourceId: { videoId: "ccccccccccc" } } }] } }
          : {
              data: {
                items: [
                  { snippet: { resourceId: { videoId: "aaaaaaaaaaa" } } },
                  { snippet: { resourceId: { videoId: "bbbbbbbbbbb" } } },
                ],
                nextPageToken: "p2",
              },
            },
    },
    videos: {
      list: async ({ id }) => ({
        data: {
          items: id.map((vid) => ({
            id: vid,
            // "bbbbbbbbbbb" ngắn hơn 10 phút -> phải bị lọc bỏ
            contentDetails: { duration: vid === "bbbbbbbbbbb" ? "PT5M0S" : "PT12M0S" },
            statistics: { viewCount: "1234" },
            snippet: { title: `Video ${vid}`, publishedAt: "2026-07-01T00:00:00Z" },
          })),
        },
      }),
    },
  };
}

test("fetchSourceVideos duyệt hết trang và lọc video <= 10 phút", async () => {
  const out = await fetchSourceVideos(fakeSourceYt(), "@line4091");
  assert.deepEqual(out.map((v) => v.url), [
    "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    "https://www.youtube.com/watch?v=ccccccccccc",
  ]);
  assert.equal(out[0].title, "Video aaaaaaaaaaa");
  assert.equal(out[0].viewCount, 1234);
  assert.equal(out[0].publishedAt, "2026-07-01T00:00:00Z");
});

test("fetchSourceVideos tôn trọng minSeconds", async () => {
  const out = await fetchSourceVideos(fakeSourceYt(), "@line4091", { minSeconds: 0 });
  assert.equal(out.length, 3);
});

test("fetchSourceVideos ném lỗi khi handle hỏng hoặc kênh không tồn tại", async () => {
  await assert.rejects(() => fetchSourceVideos(fakeSourceYt(), "kênh của tôi"), /không hợp lệ/);
  const empty = { channels: { list: async () => ({ data: { items: [] } }) } };
  await assert.rejects(() => fetchSourceVideos(empty, "@line4091"), /Không tìm thấy kênh nguồn/);
});
```

- [ ] **Step 2: Chạy test cho nó đỏ**

Run: `node --test tests/youtube-api.test.js 2>&1 | tail -12`
Expected: FAIL — `fetchSourceVideos is not a function`

- [ ] **Step 3: Viết implementation**

Thêm vào `sheet/youtube-api.js`:

```js
// Lấy mọi video của kênh nguồn qua playlist uploads, lọc theo thời lượng.
// minSeconds = 600 -> chỉ giữ video dài hơn 10 phút (giống hành vi get-url.js cũ).
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
  return out;
}
```

- [ ] **Step 4: Chạy test cho nó xanh**

Run: `npm test 2>&1 | tail -12`
Expected: PASS

- [ ] **Step 5: Refactor `get-url.js` dùng module chung**

Thay dòng 1–12 của `get-url.js` (khối import + hằng `apiKey`/`minSeconds`) bằng:

```js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { createYoutubeClient, fetchSourceVideos, DEFAULT_YT_API_KEY } from "./sheet/youtube-api.js";

// __dirname trong ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const apiKey = process.env.YT_API_KEY || DEFAULT_YT_API_KEY;
const minSeconds = 60 * 10; // chỉ lấy video >10 phút
```

Xoá hàm `parseDuration` trong `get-url.js` (đã chuyển vào `youtube-api.js`), rồi thay toàn bộ thân hàm `getVideoUrls` — từ `const youtube = google.youtube({` cho tới hết vòng `do…while` và dòng `// === B3` — bằng:

```js
async function getVideoUrls(handle) {
  const youtube = createYoutubeClient(apiKey);

  const directoryPath = path.join(outputBaseFolder, handle.replace(/^@/, ""));
  if (!fs.existsSync(directoryPath)) fs.mkdirSync(directoryPath, { recursive: true });
  const filePath = path.join(directoryPath, "youtube.xlsx");

  console.log("Đang lấy dữ liệu video...");
  const videosData = await fetchSourceVideos(youtube, handle, { minSeconds });
```

Phần còn lại của hàm (khối `// === B4: Ghi file Excel` trở xuống, kể cả `if (videosData.length > 0)` và `else`) **giữ nguyên không đổi** — `fetchSourceVideos` trả đúng các field `url`, `title`, `viewCount`, `publishedAt` mà khối đó đang đọc.

- [ ] **Step 6: Kiểm tra `get-url.js` vẫn chạy**

Run: `node --check get-url.js && node get-url.js 2>&1 | head -3`
Expected: không có lỗi cú pháp; chạy không tham số in ra `Vui lòng nhập tên channel handle, ví dụ:`

- [ ] **Step 7: Commit**

```bash
git add sheet/youtube-api.js tests/youtube-api.test.js get-url.js
git commit -m "feat(yt): fetchSourceVideos; get-url.js dùng module chung"
```

---

### Task 4: Đọc cột mới trong `⚙config`

Thêm alias cột, trả `rowIndex`/`channelUrl`/`sourceHandle`, và `findStatsColumns`. Nới range đọc từ `A:Z` lên `A:AZ` — 18 cột cũ cộng 6 cột mới là 24, sát trần 26 của `A:Z`.

**Files:**
- Modify: `sheet/sheets-service.js`
- Test: `tests/sheets-service.test.js`

**Interfaces:**
- Consumes: không có.
- Produces:
  - `parseConfigRows(values)` — mỗi channel có thêm `rowIndex: number` (1-based, dùng thẳng làm số dòng trong A1 notation), `channelUrl: string`, `sourceHandle: string`.
  - `findStatsColumns(values) → { headerRowIndex: number, cols: { subscribers?, totalViews?, videoCount?, statsUpdatedAt? } }` — `cols[key]` là chỉ số cột 0-based; key vắng mặt nghĩa là Sheet không có cột đó. `headerRowIndex = -1` khi không tìm thấy header.
  - `readConfigValues(sheets, spreadsheetId, configTab?) → Promise<any[][]>` — đọc thô, để caller chỉ tốn một lần gọi API cho cả `parseConfigRows` lẫn `findStatsColumns`.
  - `STATS_KEYS: string[]` = `["subscribers", "totalViews", "videoCount", "statsUpdatedAt"]`

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `tests/sheets-service.test.js`:

```js
import { findStatsColumns, STATS_KEYS } from "../sheet/sheets-service.js";

// Header có dòng nhóm-mode phía trên, đúng như Sheet thật.
const CONFIG_VALUES = [
  ["", "", "", "Nhóm render", "", ""],
  ["Tên kênh", "Bật", "Link kênh", "@handle nguồn", "Sub", "Tổng view", "Số video", "Cập nhật lúc"],
  ["Kênh A", "true", "https://www.youtube.com/@kenha", "@nguona", "1230", "45678", "120", "09/07/2026 14:32"],
  ["Kênh B", "true", "", "", "", "", "", ""],
];

test("parseConfigRows trả rowIndex, channelUrl, sourceHandle", () => {
  const rows = parseConfigRows(CONFIG_VALUES);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rowIndex, 3, "dòng 'Kênh A' là dòng thứ 3 trong Sheet (1-based)");
  assert.equal(rows[0].channelUrl, "https://www.youtube.com/@kenha");
  assert.equal(rows[0].sourceHandle, "@nguona");
  assert.equal(rows[1].rowIndex, 4);
  assert.equal(rows[1].channelUrl, "");
  assert.equal(rows[1].sourceHandle, "");
});

test("findStatsColumns tìm đủ 4 cột", () => {
  const { headerRowIndex, cols } = findStatsColumns(CONFIG_VALUES);
  assert.equal(headerRowIndex, 1);
  assert.deepEqual(cols, { subscribers: 4, totalViews: 5, videoCount: 6, statsUpdatedAt: 7 });
  assert.deepEqual(STATS_KEYS, ["subscribers", "totalViews", "videoCount", "statsUpdatedAt"]);
});

test("findStatsColumns bỏ qua cột thiếu", () => {
  const values = [["Tên kênh", "Bật", "Sub", "Số video"]];
  const { cols } = findStatsColumns(values);
  assert.deepEqual(cols, { subscribers: 2, videoCount: 3 });
});

test("findStatsColumns khi không có cột stats nào và khi không có header", () => {
  assert.deepEqual(findStatsColumns([["Tên kênh", "Bật"]]).cols, {});
  assert.deepEqual(findStatsColumns([["Linh tinh"]]), { headerRowIndex: -1, cols: {} });
  assert.deepEqual(findStatsColumns([]), { headerRowIndex: -1, cols: {} });
});
```

Nếu `tests/sheets-service.test.js` chưa import `parseConfigRows`, thêm nó vào dòng import sẵn có.

- [ ] **Step 2: Chạy test cho nó đỏ**

Run: `node --test tests/sheets-service.test.js 2>&1 | tail -12`
Expected: FAIL — `findStatsColumns is not a function`, và `rows[0].rowIndex` là `undefined`

- [ ] **Step 3: Viết implementation**

Trong `sheet/sheets-service.js`, thêm 6 dòng vào cuối object `HEADER_ALIASES` (sau `postTimes`, dòng 56):

```js
  channelUrl: ["link kênh", "url kênh"],
  sourceHandle: ["@handle nguồn", "handle nguồn", "kênh nguồn"],
  subscribers: ["sub", "subs", "người đăng ký"],
  totalViews: ["tổng view", "tổng lượt xem"],
  videoCount: ["số video"],
  statsUpdatedAt: ["cập nhật lúc"],
```

Trong `parseConfigRows`, thêm 3 field vào object `channel` (sau `postTimes`, dòng 120):

```js
      rowIndex: r + 1, // 1-based, dùng thẳng trong A1 notation
      channelUrl: col(row, "channelUrl"),
      sourceHandle: col(row, "sourceHandle"),
```

Thêm ngay sau `parseConfigRows`:

```js
export const STATS_KEYS = ["subscribers", "totalViews", "videoCount", "statsUpdatedAt"];

// Tìm chỉ số cột (0-based) của 4 cột stats. Cột không có trong Sheet thì vắng
// mặt trong `cols` — app không bao giờ tự tạo cột.
export function findStatsColumns(values) {
  if (!Array.isArray(values) || !values.length) return { headerRowIndex: -1, cols: {} };
  const snNorms = acceptedNorms("sheetName");
  const hIdx = values.findIndex((row) =>
    Array.isArray(row) && row.some((c) => snNorms.includes(norm(c))));
  if (hIdx < 0) return { headerRowIndex: -1, cols: {} };
  const headerRow = values[hIdx] || [];
  const cols = {};
  for (const name of STATS_KEYS) {
    const accepted = acceptedNorms(name);
    const i = headerRow.findIndex((c) => accepted.includes(norm(c)));
    if (i >= 0) cols[name] = i;
  }
  return { headerRowIndex: hIdx, cols };
}
```

Thay `readConfigSheet` (dòng 154–157) bằng hai hàm, và nới range lên `A:AZ`:

```js
// Đọc thô tab ⚙config. Range A:AZ (không phải A:Z) vì bảng cấu hình đã có 24 cột.
export async function readConfigValues(sheets, spreadsheetId, configTab = "⚙config") {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${configTab}!A:AZ` });
  return res.data.values || [];
}

export async function readConfigSheet(sheets, spreadsheetId, configTab = "⚙config") {
  return parseConfigRows(await readConfigValues(sheets, spreadsheetId, configTab));
}
```

- [ ] **Step 4: Chạy test cho nó xanh**

Run: `npm test 2>&1 | tail -12`
Expected: PASS — mọi test cũ trong `sheets-service.test.js` vẫn xanh (ba field mới không phá object cũ)

- [ ] **Step 5: Commit**

```bash
git add sheet/sheets-service.js tests/sheets-service.test.js
git commit -m "feat(sheet): đọc cột Link kênh/@handle nguồn + findStatsColumns"
```

---

### Task 5: Ghi ngược vào Sheet

`writeChannelStats` ghi 4 ô, `appendUrls` nối cột A, `formatStamp` tạo dấu thời gian.

**Files:**
- Modify: `sheet/sheets-service.js`
- Modify: `sheet/schedule-slots.js`
- Test: `tests/sheets-service.test.js`
- Test: `tests/schedule-slots.test.js`

**Interfaces:**
- Consumes: `STATS_KEYS` (Task 4).
- Produces:
  - `formatStamp(d: Date) → string` (`"dd/mm/yyyy hh:mm"`), export từ `sheet/schedule-slots.js` — cùng chỗ với `formatSchedule`, nơi repo đã đặt code định dạng ngày giờ.
  - `writeChannelStats(sheets, spreadsheetId, configTab, rowIndex, cols, stats) → Promise<number>` — trả số ô đã ghi. `stats = { subscribers, views, videoCount, hidden, updatedAt }`. Kênh ẩn sub ghi `"—"` vào cột Sub.
  - `appendUrls(sheets, spreadsheetId, sheetName, urls: string[]) → Promise<number>` — trả số URL đã nối. Mảng rỗng thì không gọi API.
  - `colLetter(i: number) → string` — 0→`"A"`, 26→`"AA"`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `tests/schedule-slots.test.js`:

```js
import { formatStamp } from "../sheet/schedule-slots.js";

test("formatStamp: Date -> dd/mm/yyyy hh:mm", () => {
  assert.equal(formatStamp(new Date(2026, 6, 9, 14, 32)), "09/07/2026 14:32");
  assert.equal(formatStamp(new Date(2026, 11, 1, 8, 5)), "01/12/2026 08:05");
});
```

Thêm vào cuối `tests/sheets-service.test.js`:

```js
import { writeChannelStats, appendUrls, colLetter } from "../sheet/sheets-service.js";

// Client Sheets giả: ghi lại mọi tham số của batchUpdate/append.
function fakeSheets() {
  const calls = { batchUpdate: [], append: [] };
  return {
    calls,
    spreadsheets: {
      values: {
        batchUpdate: async (p) => { calls.batchUpdate.push(p); return { data: {} }; },
        append: async (p) => { calls.append.push(p); return { data: {} }; },
      },
    },
  };
}

test("colLetter: 0->A, 25->Z, 26->AA, 51->AZ", () => {
  assert.equal(colLetter(0), "A");
  assert.equal(colLetter(25), "Z");
  assert.equal(colLetter(26), "AA");
  assert.equal(colLetter(51), "AZ");
});

test("writeChannelStats ghi đúng 4 ô vào đúng dòng", async () => {
  const sheets = fakeSheets();
  const cols = { subscribers: 4, totalViews: 5, videoCount: 6, statsUpdatedAt: 7 };
  const n = await writeChannelStats(sheets, "SID", "⚙config", 3, cols, {
    subscribers: 1230, views: 45678, videoCount: 120, hidden: false, updatedAt: "09/07/2026 14:32",
  });
  assert.equal(n, 4);
  const { data, valueInputOption } = sheets.calls.batchUpdate[0].requestBody;
  assert.equal(valueInputOption, "RAW");
  assert.deepEqual(data.map((d) => d.range), [
    "⚙config!E3", "⚙config!F3", "⚙config!G3", "⚙config!H3",
  ]);
  assert.deepEqual(data.map((d) => d.values[0][0]), [1230, 45678, 120, "09/07/2026 14:32"]);
});

test("writeChannelStats chỉ ghi các cột có thật, kênh ẩn sub ghi dấu gạch", async () => {
  const sheets = fakeSheets();
  const n = await writeChannelStats(sheets, "SID", "⚙config", 5, { subscribers: 2, videoCount: 9 }, {
    subscribers: null, views: 100, videoCount: 8, hidden: true, updatedAt: "09/07/2026 14:32",
  });
  assert.equal(n, 2);
  const { data } = sheets.calls.batchUpdate[0].requestBody;
  assert.deepEqual(data.map((d) => d.range), ["⚙config!C5", "⚙config!J5"]);
  assert.equal(data[0].values[0][0], "—");
  assert.equal(data[1].values[0][0], 8);
});

test("writeChannelStats không gọi API khi Sheet thiếu cả 4 cột", async () => {
  const sheets = fakeSheets();
  assert.equal(await writeChannelStats(sheets, "SID", "⚙config", 3, {}, { updatedAt: "x" }), 0);
  assert.equal(sheets.calls.batchUpdate.length, 0);
});

test("appendUrls nối vào cột A, không đụng cột B/C", async () => {
  const sheets = fakeSheets();
  const n = await appendUrls(sheets, "SID", "Kênh A", ["u1", "u2"]);
  assert.equal(n, 2);
  const p = sheets.calls.append[0];
  assert.equal(p.range, "Kênh A!A:A");
  assert.equal(p.insertDataOption, "INSERT_ROWS");
  assert.equal(p.valueInputOption, "RAW");
  assert.deepEqual(p.requestBody.values, [["u1"], ["u2"]]);
});

test("appendUrls không gọi API khi danh sách rỗng", async () => {
  const sheets = fakeSheets();
  assert.equal(await appendUrls(sheets, "SID", "Kênh A", []), 0);
  assert.equal(await appendUrls(sheets, "SID", "Kênh A", undefined), 0);
  assert.equal(sheets.calls.append.length, 0);
});
```

- [ ] **Step 2: Chạy test cho nó đỏ**

Run: `npm test 2>&1 | tail -12`
Expected: FAIL — `writeChannelStats is not a function`, `formatStamp is not a function`

- [ ] **Step 3: Viết implementation**

Thêm vào `sheet/schedule-slots.js`, ngay sau `formatSchedule` (dòng 26):

```js
// Date -> "09/07/2026 14:32" (dấu thời gian cho cột "Cập nhật lúc").
export function formatStamp(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

Thêm vào cuối `sheet/sheets-service.js`:

```js
// Chỉ số cột 0-based -> chữ cái cột A1 notation. 0->"A", 26->"AA".
export function colLetter(i) {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

// Ghi 4 ô stats vào dòng `rowIndex` của tab ⚙config. Chỉ chạm các cột có trong
// `cols` — app không tạo cột mới. Trả số ô đã ghi.
export async function writeChannelStats(sheets, spreadsheetId, configTab, rowIndex, cols, stats) {
  const data = [];
  const push = (key, value) => {
    if (cols[key] === undefined) return;
    data.push({ range: `${configTab}!${colLetter(cols[key])}${rowIndex}`, values: [[value]] });
  };
  push("subscribers", stats.hidden ? "—" : stats.subscribers);
  push("totalViews", stats.views);
  push("videoCount", stats.videoCount);
  push("statsUpdatedAt", stats.updatedAt);
  if (!data.length) return 0;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });
  return data.length;
}

// Nối URL vào cuối cột A của tab kênh. Cột B (trạng thái render) và C (trạng
// thái upload) không bị đụng, nên chạy lại nhiều lần là an toàn.
export async function appendUrls(sheets, spreadsheetId, sheetName, urls) {
  if (!urls?.length) return 0;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:A`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: urls.map((u) => [u]) },
  });
  return urls.length;
}
```

- [ ] **Step 4: Chạy test cho nó xanh**

Run: `npm test 2>&1 | tail -12`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sheet/sheets-service.js sheet/schedule-slots.js tests/sheets-service.test.js tests/schedule-slots.test.js
git commit -m "feat(sheet): writeChannelStats, appendUrls, formatStamp"
```

---

### Task 6: Auto-refresh sau mỗi lượt chạy

`sheet-runner` nhận dep `refreshStats` tùy chọn. Gọi **sau** khi đã emit `done`, và nuốt lỗi — một lần refresh hỏng không được làm lượt render trông như thất bại.

**Files:**
- Modify: `sheet/sheet-runner.js:19-24` (destructure deps), `sheet/sheet-runner.js:115-133` (`runNow`)
- Test: `tests/sheet-runner.test.js`

**Interfaces:**
- Consumes: không có.
- Produces: `createSheetRunner(deps)` nhận thêm `deps.refreshStats?: () => Promise<void>`. Không truyền thì bỏ qua lặng lẽ.

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `tests/sheet-runner.test.js`:

```js
test("refreshStats chạy một lần, sau khi đã emit done", async () => {
  const order = [];
  const { deps } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [],
      readChannelUrls: async () => [],
      setUrlStatus: async () => {},
    },
    emit: (e) => order.push(e.type),
    refreshStats: async () => { order.push("refresh"); },
  });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(order, ["done", "refresh"]);
});

test("không có refreshStats thì runNow vẫn chạy bình thường", async () => {
  const { deps, calls } = makeDeps();
  await createSheetRunner(deps).runNow();
  assert.equal(calls.downloaded.length, 2);
});

test("refreshStats ném lỗi: ghi log, lượt chạy vẫn done, runNow không reject", async () => {
  const events = [];
  const { deps } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [],
      readChannelUrls: async () => [],
      setUrlStatus: async () => {},
    },
    emit: (e) => events.push(e),
    refreshStats: async () => { throw new Error("quotaExceeded"); },
  });
  await createSheetRunner(deps).runNow(); // không được reject
  assert.ok(events.some((e) => e.type === "done"));
  assert.ok(events.some((e) => e.type === "log" && /quotaExceeded/.test(e.message)));
  assert.equal(events.filter((e) => e.type === "error").length, 0);
});
```

- [ ] **Step 2: Chạy test cho nó đỏ**

Run: `node --test tests/sheet-runner.test.js 2>&1 | tail -12`
Expected: FAIL — test đầu tiên: `order` là `["done"]`, thiếu `"refresh"`

- [ ] **Step 3: Viết implementation**

Trong `sheet/sheet-runner.js`, thêm `refreshStats` vào khối destructure ở dòng 20–24:

```js
  const {
    config, sheetsApi, downloader, renderer, listBackgrounds,
    ensureDirs, stateStore, emit, now, pLimitFn, rand, unlink, detectChroma, sleep,
    uploadQueue, refreshStats,
  } = deps;
```

Trong `runNow`, thay khối `try` (dòng 122–127) bằng:

```js
    try {
      const today = todayStr(now());
      let channels = await sheetsApi.readConfigSheet();
      if (sheetName) channels = channels.filter((c) => c.sheetName === sheetName);
      for (const ch of channels) await runChannel(ch, today);
      emit({ type: "done" });
      // Làm mới số liệu kênh SAU khi lượt render đã tính là xong. Lỗi ở đây chỉ
      // ghi log — không được làm lượt chạy trông như thất bại.
      if (refreshStats) {
        try {
          await refreshStats();
        } catch (e) {
          emit({ type: "log", message: `Làm mới số liệu kênh thất bại: ${String(e?.message || e).slice(0, 200)}` });
        }
      }
    } finally {
```

- [ ] **Step 4: Chạy test cho nó xanh**

Run: `npm test 2>&1 | tail -12`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sheet/sheet-runner.js tests/sheet-runner.test.js
git commit -m "feat(sheet): auto refresh số liệu kênh sau mỗi lượt chạy"
```

---

### Task 7: Ghép vào Electron main + preload

**Files:**
- Modify: `electron-main.js:12` (import), `electron-main.js:1339-1343` (settings), `electron-main.js:1382-1419` (`buildSheetRunner`), thêm hai IPC sau `electron-main.js:1458`
- Modify: `preload.cjs:52-62` (namespace `sheet`)

**Interfaces:**
- Consumes: `createYoutubeClient`, `fetchChannelStats`, `fetchSourceVideos`, `pickNewUrls`, `DEFAULT_YT_API_KEY` (Task 1–3); `readConfigValues`, `parseConfigRows`, `findStatsColumns`, `STATS_KEYS`, `writeChannelStats`, `appendUrls` (Task 4–5); `formatStamp` (Task 5); `deps.refreshStats` (Task 6).
- Produces:
  - IPC `yt:refresh-stats` → `{ ok: true, rows: StatsRow[], missing: string[] }` hoặc `{ ok: false, error: string }`
    - `StatsRow = { sheetName, sourceHandle, subscribers: number|null, views, videoCount, hidden, updatedAt }` hoặc `{ sheetName, sourceHandle, error: string }`
  - IPC `yt:fetch-source-urls` với payload `{ sheetName }` → `{ ok: true, added: number, skipped: number }` hoặc `{ ok: false, error: string }`
  - Sự kiện `sheet:event` kiểu mới: `{ type: "stats", ok, rows, missing }`
  - `window.electronAPI.sheet.refreshStats()`, `window.electronAPI.sheet.fetchSourceUrls(sheetName)`
  - Settings key mới: `ytApiKey: string` (rỗng = dùng `DEFAULT_YT_API_KEY`)

- [ ] **Step 1: Thêm import và settings mặc định**

Trong `electron-main.js`, sửa dòng 12 và thêm dòng 12b:

```js
import { createSheetsClient, readConfigSheet, readConfigValues, parseConfigRows, findStatsColumns, STATS_KEYS, writeChannelStats, appendUrls, readChannelUrls, setUrlStatus, setUploadStatus, readUploadStatuses, testSheetConnection } from "./sheet/sheets-service.js";
import { createYoutubeClient, fetchChannelStats, fetchSourceVideos, pickNewUrls, DEFAULT_YT_API_KEY } from "./sheet/youtube-api.js";
```

Sửa dòng 13 để import thêm `formatStamp`:

```js
import { parseScheduledISO, formatStamp } from "./sheet/schedule-slots.js";
```

Trong `loadSheetSettings` (dòng 1341), thêm `ytApiKey: ""` vào object mặc định:

```js
  catch { return { spreadsheetId: "", credentialsPath: "", channelsRoot: "", pollSec: 300, autoRunOnOpen: false, useGPU: false, videoSpeed: 0.95, gpuVideoCodec: "h264_nvenc", ytApiKey: "" }; }
```

- [ ] **Step 2: Thêm hàm `refreshChannelStats` và `fetchSourceUrlsFor`**

Chèn ngay trước `ipcMain.handle("sheet:test-connection"` (dòng 1422):

```js
// ===== Theo dõi kênh YouTube =====
function ytClientFrom(st) {
  return createYoutubeClient((st.ytApiKey || "").trim() || DEFAULT_YT_API_KEY);
}

function requireSheetSettings(st) {
  if (!st.spreadsheetId) return "Chưa nhập Spreadsheet ID.";
  if (!st.credentialsPath) return "Chưa chọn file service account JSON.";
  return null;
}

// Đọc ⚙config một lần, gọi API, ghi ngược từng dòng, trả bảng cho UI.
// Một kênh hỏng chỉ làm hỏng dòng của nó.
async function refreshChannelStats() {
  const st = loadSheetSettings();
  const bad = requireSheetSettings(st);
  if (bad) return { ok: false, error: bad };

  const sheets = createSheetsClient(st.credentialsPath);
  const values = await readConfigValues(sheets, st.spreadsheetId);
  const channels = parseConfigRows(values);
  const { cols } = findStatsColumns(values);
  const missing = STATS_KEYS.filter((k) => cols[k] === undefined);

  const targets = channels.filter((c) => c.channelUrl);
  const stats = targets.length
    ? await fetchChannelStats(ytClientFrom(st), targets.map((c) => c.channelUrl))
    : [];
  const statByName = new Map(targets.map((c, i) => [c.sheetName, stats[i]]));
  const updatedAt = formatStamp(new Date());

  const rows = [];
  for (const ch of channels) {
    const base = { sheetName: ch.sheetName, sourceHandle: ch.sourceHandle || "" };
    const s = statByName.get(ch.sheetName);
    if (!s) { rows.push({ ...base }); continue; } // kênh không khai Link kênh
    if (s.error) { rows.push({ ...base, error: s.error }); continue; }
    try {
      await writeChannelStats(sheets, st.spreadsheetId, "⚙config", ch.rowIndex, cols, { ...s, updatedAt });
    } catch (err) {
      rows.push({ ...base, error: String(err?.message || err) });
      continue;
    }
    rows.push({ ...base, subscribers: s.subscribers, views: s.views, videoCount: s.videoCount, hidden: s.hidden, updatedAt });
  }
  return { ok: true, rows, missing };
}

async function fetchSourceUrlsFor(sheetName) {
  const st = loadSheetSettings();
  const bad = requireSheetSettings(st);
  if (bad) return { ok: false, error: bad };

  const sheets = createSheetsClient(st.credentialsPath);
  const channels = await readConfigSheet(sheets, st.spreadsheetId);
  const ch = channels.find((c) => c.sheetName === sheetName);
  if (!ch) return { ok: false, error: `Không thấy kênh "${sheetName}" trong ⚙config.` };
  if (!ch.sourceHandle) return { ok: false, error: "Kênh chưa điền cột @handle nguồn." };

  const videos = await fetchSourceVideos(ytClientFrom(st), ch.sourceHandle);
  const existing = (await readChannelUrls(sheets, st.spreadsheetId, sheetName)).map((r) => r.url);
  const fresh = pickNewUrls(existing, videos.map((v) => v.url));
  await appendUrls(sheets, st.spreadsheetId, sheetName, fresh);
  return { ok: true, added: fresh.length, skipped: videos.length - fresh.length };
}
```

- [ ] **Step 3: Nối `refreshStats` vào runner và mở hai IPC**

Trong `buildSheetRunner`, thêm vào object truyền cho `createSheetRunner` (ngay sau `uploadQueue,` ở dòng 1383):

```js
    refreshStats: async () => {
      const r = await refreshChannelStats();
      emitEvent({ type: "stats", ...r });
      if (!r.ok) throw new Error(r.error);
    },
```

Chèn sau `ipcMain.handle("sheet:run-now"…)` (dòng 1458):

```js
ipcMain.handle("yt:refresh-stats", async () => {
  try { return await refreshChannelStats(); }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
});

ipcMain.handle("yt:fetch-source-urls", async (e, { sheetName } = {}) => {
  try { return await fetchSourceUrlsFor((sheetName || "").trim()); }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
});
```

- [ ] **Step 4: Mở API cho renderer**

Trong `preload.cjs`, thêm hai dòng vào object `sheet` (sau `runNow`, dòng 60):

```js
    refreshStats: () => ipcRenderer.invoke("yt:refresh-stats"),
    fetchSourceUrls: (sheetName) => ipcRenderer.invoke("yt:fetch-source-urls", { sheetName }),
```

- [ ] **Step 5: Kiểm tra cú pháp và test cũ**

Run: `node --check electron-main.js && node --check preload.cjs && npm test 2>&1 | tail -8`
Expected: không lỗi cú pháp; toàn bộ test xanh

- [ ] **Step 6: Commit**

```bash
git add electron-main.js preload.cjs
git commit -m "feat(app): IPC yt:refresh-stats và yt:fetch-source-urls"
```

---

### Task 8: Giao diện trong tab "Theo dõi Sheet"

Ô nhập API key, bảng số liệu, nút làm mới, nút lấy URL nguồn theo từng dòng.

**Files:**
- Modify: `renderer.html` (thêm ô API key sau dòng 3757; thêm bảng stats sau dòng 3813)
- Modify: `renderer.js:4159-4191` (`loadSettings`/`currentSettings`), `renderer.js:4197-4198` (auto-save), `renderer.js:4246-4269` (`api.onEvent`), thêm khối stats sau dòng 4244

**Interfaces:**
- Consumes: `window.electronAPI.sheet.refreshStats()`, `window.electronAPI.sheet.fetchSourceUrls(sheetName)`, sự kiện `{ type: "stats", ok, rows, missing }` (Task 7).
- Produces: không có (đây là task cuối).

- [ ] **Step 1: Thêm ô nhập API key vào panel cấu hình**

Trong `renderer.html`, chèn ngay sau khối `</div>` đóng form-group "Poll (giây) / Tốc độ video" (dòng 3757):

```html
          <div class="form-group">
            <label>YouTube API key (để trống = dùng key mặc định)</label>
            <input id="sw-yt-api-key" type="text" placeholder="AIza…" style="width:100%">
          </div>
```

- [ ] **Step 2: Thêm bảng số liệu**

Trong `renderer.html`, chèn ngay sau khối `<div class="action-buttons">…</div>` chứa `sw-run-now` (dòng 3813), tức là **trước** `<table id="sw-status-table"`:

```html
          <div style="display:flex;align-items:center;gap:10px;margin-top:20px;">
            <h3 style="margin:0;font-size:15px;">Số liệu kênh</h3>
            <button class="btn btn-secondary" id="sw-stats-refresh">🔄 Làm mới</button>
          </div>
          <div id="sw-stats-banner" style="display:none;margin-top:8px;padding:8px 12px;border-radius:6px;font-size:13px;"></div>
          <table id="sw-stats-table" style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">
            <thead>
              <tr style="background:#f8f9fa;border-bottom:2px solid #e2e8f0;">
                <th style="text-align:left;padding:10px 12px;">Kênh</th>
                <th style="text-align:right;padding:10px 12px;">Sub</th>
                <th style="text-align:right;padding:10px 12px;">Tổng view</th>
                <th style="text-align:right;padding:10px 12px;">Số video</th>
                <th style="text-align:left;padding:10px 12px;">Cập nhật lúc</th>
                <th style="text-align:left;padding:10px 12px;"></th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
```

- [ ] **Step 3: Nạp và lưu API key**

Trong `renderer.js`, thêm vào cuối hàm `loadSettings` (sau dòng 4174):

```js
    $("sw-yt-api-key").value = s.ytApiKey || "";
```

Thêm vào object trả về của `currentSettings` (sau `gpmTelegramChatId`, dòng 4189):

```js
      ytApiKey: $("sw-yt-api-key").value.trim(),
```

Thêm `"sw-yt-api-key"` vào mảng auto-save debounce (dòng 4197):

```js
  ["sw-spreadsheet-id", "sw-poll", "sw-video-speed", "sw-yt-api-key"].forEach((id) =>
    $(id)?.addEventListener("input", saveDebounced));
```

- [ ] **Step 4: Vẽ bảng và nối nút**

Trong `renderer.js`, chèn ngay sau dòng đăng ký `$("sw-run-now")` (dòng 4244):

```js
  // ===== Số liệu kênh =====
  const nf = new Intl.NumberFormat("vi-VN");

  function setStatsBanner(text, kind) {
    const el = $("sw-stats-banner");
    if (!el) return;
    if (!text) { el.style.display = "none"; return; }
    el.style.display = "";
    el.textContent = text;
    const red = kind === "error";
    el.style.background = red ? "#fdecea" : "#fff8e1";
    el.style.color = red ? "#c00" : "#7a5c00";
  }

  const MISSING_LABEL = {
    subscribers: "Sub", totalViews: "Tổng view",
    videoCount: "Số video", statsUpdatedAt: "Cập nhật lúc",
  };

  function renderStats(res) {
    const body = $("sw-stats-table")?.querySelector("tbody");
    if (!body) return;
    if (!res?.ok) { setStatsBanner(`❌ ${res?.error || "Làm mới số liệu thất bại"}`, "error"); return; }

    const allFailed = res.rows.length > 0 && res.rows.every((r) => r.error);
    if (allFailed) setStatsBanner(`❌ Mọi kênh đều lỗi: ${res.rows[0].error}`, "error");
    else if (res.missing?.length) setStatsBanner(`⚠️ Thiếu cột trong ⚙config: ${res.missing.map((k) => MISSING_LABEL[k]).join(", ")}`, "warn");
    else setStatsBanner("", null);

    body.innerHTML = "";
    for (const r of res.rows) {
      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid #eee";
      const num = (v) => (v === null || v === undefined ? "—" : nf.format(v));
      // Text từ Sheet và từ thông báo lỗi Google API luôn đặt bằng textContent,
      // không nội suy vào innerHTML.
      const cells = r.error
        ? `<td class="msg" colspan="4" style="padding:8px 12px;color:#c00;"></td>`
        : r.updatedAt
          ? `<td style="padding:8px 12px;text-align:right;">${num(r.subscribers)}</td>
             <td style="padding:8px 12px;text-align:right;">${num(r.views)}</td>
             <td style="padding:8px 12px;text-align:right;">${num(r.videoCount)}</td>
             <td class="msg" style="padding:8px 12px;"></td>`
          : `<td class="msg" colspan="4" style="padding:8px 12px;color:#888;"></td>`;
      tr.innerHTML = `<td class="ch" style="padding:8px 12px;"></td>${cells}<td style="padding:8px 12px;"></td>`;
      tr.querySelector(".ch").textContent = r.sheetName;
      tr.querySelector(".msg").textContent = r.error
        ? `⚠ ${r.error}`
        : r.updatedAt || "chưa điền cột Link kênh";

      const btn = document.createElement("button");
      btn.className = "btn btn-secondary";
      btn.textContent = "Lấy URL nguồn";
      btn.disabled = !r.sourceHandle;
      btn.title = r.sourceHandle ? `Lấy video từ ${r.sourceHandle}` : "Kênh chưa điền cột @handle nguồn";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = "⏳ đang lấy…";
        const out = await api.fetchSourceUrls(r.sheetName);
        btn.textContent = old;
        btn.disabled = false;
        if (out?.ok) log(`[${r.sheetName}] ✅ Đã thêm ${out.added} URL, bỏ qua ${out.skipped} trùng.`);
        else log(`[${r.sheetName}] ❌ ${out?.error || "lấy URL thất bại"}`);
      });
      tr.lastElementChild.appendChild(btn);
      body.appendChild(tr);
    }
  }

  $("sw-stats-refresh")?.addEventListener("click", async () => {
    const btn = $("sw-stats-refresh");
    btn.disabled = true;
    setStatsBanner("⏳ đang lấy số liệu…", "warn");
    try { renderStats(await api.refreshStats()); }
    finally { btn.disabled = false; }
  });
```

- [ ] **Step 5: Nhận sự kiện `stats` từ auto-refresh**

Trong `renderer.js`, thêm một nhánh vào `api.onEvent`, ngay trước nhánh `else if (evt.type === "error")` (dòng 4262):

```js
    } else if (evt.type === "stats") {
      renderStats(evt);
```

- [ ] **Step 6: Kiểm tra cú pháp**

Run: `node --check renderer.js && npm test 2>&1 | tail -6`
Expected: không lỗi cú pháp; toàn bộ test xanh

- [ ] **Step 7: Kiểm tra thật trong app**

Trước khi chạy, thêm 6 cột vào tab `⚙config` của Sheet: `Link kênh`, `@handle nguồn`, `Sub`, `Tổng view`, `Số video`, `Cập nhật lúc`. Điền `Link kênh` và `@handle nguồn` cho ít nhất một kênh.

Run: `npm start`

Kiểm tra theo thứ tự:
1. Mở tab "Theo dõi Sheet" → mở `⚙ Cấu hình` → thấy ô "YouTube API key".
2. Bấm `🔄 Làm mới` → bảng "Số liệu kênh" hiện sub/view/số video; mở Sheet thấy 4 cột đã được ghi và `Cập nhật lúc` là giờ hiện tại.
3. Kênh không điền `Link kênh` → dòng hiện `chưa điền cột Link kênh`, nút "Lấy URL nguồn" vẫn dùng được nếu có handle.
4. Điền `Link kênh` sai (vd `abc def`) → dòng hiện `⚠ Link kênh không hợp lệ`, các dòng khác vẫn có số.
5. Xoá cột `Sub` khỏi Sheet, bấm Làm mới → banner vàng `⚠️ Thiếu cột trong ⚙config: Sub`, ba cột còn lại vẫn ghi.
6. Bấm `Lấy URL nguồn` → log hiện `Đã thêm N URL, bỏ qua M trùng`; cột A của tab kênh dài thêm, cột B và C của các dòng cũ không đổi.
7. Bấm lại `Lấy URL nguồn` lần nữa → `Đã thêm 0 URL, bỏ qua N+M trùng`.
8. Bấm `Chạy tất cả ngay` → sau khi log hiện `— Hoàn tất lượt chạy —`, bảng số liệu tự cập nhật.

- [ ] **Step 8: Commit**

```bash
git add renderer.html renderer.js
git commit -m "feat(ui): bảng số liệu kênh + nút lấy URL nguồn"
```

---

## Ghi chú vận hành

Sau khi merge, người dùng nên vào Google Cloud Console tạo một API key mới, giới hạn nó chỉ gọi được YouTube Data API v3, rồi dán vào ô "YouTube API key". Key mặc định trong `sheet/youtube-api.js` đã nằm trong lịch sử git công khai — ai clone repo cũng dùng được và tiêu quota 10.000 đơn vị/ngày của dự án Cloud đứng sau nó.
