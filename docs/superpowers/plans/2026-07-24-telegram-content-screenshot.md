# Ảnh trang Nội dung Studio kèm digest Telegram — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi hàng đợi upload rảnh, chụp trang Nội dung YouTube Studio của từng kênh vừa đăng video và gửi ảnh vào Telegram kèm digest, để người dùng biết kênh nào thumbnail không lên mà không phải ngồi vào máy.

**Architecture:** Thêm một module chụp thuần (`sheet/yt-capture.js`) nhận `page` Playwright có sẵn; thêm `sendTelegramPhoto` cạnh `sendTelegram`; `upload-queue.js` gọi cả hai ngay sau khi gửi digest, tại đúng điểm `scheduleFlush()` đang chạy. Không mở thêm trình duyệt, không thêm cài đặt mới.

**Tech Stack:** Node 18 (qua Electron 28), ESM, `playwright-core` (CDP tới GPM), `node:test`, global `fetch`/`FormData`/`Blob`.

**Spec:** `docs/superpowers/specs/2026-07-24-telegram-content-screenshot-design.md`

## Global Constraints

- ESM thuần (`"type": "module"`), import kèm đuôi `.js`.
- Chạy test: `npm test` (= `node --test 'tests/*.test.js'`). Không thêm thư viện test mới, không fake timers.
- Máy dev này không có `node` trong PATH; dùng `~/.nvm/versions/node/v22.0.0/bin/node` cho mọi lệnh `node`.
- Mọi dep phụ trợ (`fetch`, `sleep`, `capture`, `log`) phải tiêm được qua tham số để test không chạm mạng và không chờ thật.
- Log và comment viết tiếng Việt, bám giọng file hiện có.
- Ảnh hỏng **không bao giờ** được làm hỏng digest hay làm sập hàng đợi: mọi lỗi khâu chụp/gửi ảnh chỉ ghi `log`.
- Tuyệt đối không tự mở lại profile GPM chỉ để chụp ảnh — chỉ tái dùng kết nối đang mở.
- Giới hạn caption Telegram: 1024 ký tự.

---

### Task 1: `sendTelegramPhoto` + `buildShotCaption`

**Files:**
- Modify: `sheet/telegram-notify.js` (thêm 2 hàm, không đụng `sendTelegram`/`buildDigest`)
- Test: `tests/telegram-notify.test.js` (thêm test vào cuối file)

**Interfaces:**
- Consumes: không có.
- Produces:
  - `sendTelegramPhoto(token: string, chatId: string, photo: Buffer, caption: string, deps?: {fetch}) → Promise<{ok: boolean, error?: string}>`
  - `buildShotCaption(sheetName: string, results: Array<{sheetName, ok}>) → string`

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `tests/telegram-notify.test.js`:

```js
test("sendTelegramPhoto gửi multipart đúng field, báo lỗi thiếu token", async () => {
  assert.deepEqual(
    await sendTelegramPhoto("", "1", Buffer.from("x"), "c"),
    { ok: false, error: "thiếu token/chatId" },
  );

  let calledUrl, calledOpt;
  const fetch = async (url, opt) => {
    calledUrl = url;
    calledOpt = opt;
    return { json: async () => ({ ok: true }) };
  };
  const r = await sendTelegramPhoto("TOK", "42", Buffer.from("PNGDATA"), "xin chào", { fetch });
  assert.equal(r.ok, true);
  assert.match(calledUrl, /^https:\/\/api\.telegram\.org\/botTOK\/sendPhoto$/);
  assert.equal(calledOpt.method, "POST");
  // KHÔNG được tự đặt Content-Type: fetch phải sinh boundary của multipart.
  assert.equal(calledOpt.headers, undefined);
  assert.ok(calledOpt.body instanceof FormData);
  assert.equal(calledOpt.body.get("chat_id"), "42");
  assert.equal(calledOpt.body.get("caption"), "xin chào");
  const photo = calledOpt.body.get("photo");
  assert.equal(typeof photo.arrayBuffer, "function", "photo phải là Blob/File");
  assert.equal(photo.name, "content.png");
  assert.equal(Buffer.from(await photo.arrayBuffer()).toString(), "PNGDATA");
});

test("sendTelegramPhoto cắt caption dài quá giới hạn 1024 của Telegram", async () => {
  let calledOpt;
  const fetch = async (url, opt) => { calledOpt = opt; return { json: async () => ({ ok: true }) }; };
  await sendTelegramPhoto("TOK", "42", Buffer.from("x"), "a".repeat(2000), { fetch });
  assert.equal(calledOpt.body.get("caption").length, 1024);
});

test("sendTelegramPhoto trả lỗi khi Telegram từ chối", async () => {
  const fetch = async () => ({ json: async () => ({ ok: false, description: "PHOTO_INVALID_DIMENSIONS" }) });
  const r = await sendTelegramPhoto("TOK", "42", Buffer.from("x"), "c", { fetch });
  assert.deepEqual(r, { ok: false, error: "PHOTO_INVALID_DIMENSIONS" });
});

test("buildShotCaption chỉ đếm kết quả của đúng kênh đó", () => {
  const batch = [
    { sheetName: "line", title: "A", ok: true },
    { sheetName: "line", title: "B", ok: false, error: "x" },
    { sheetName: "truyen", title: "C", ok: true },
  ];
  assert.equal(buildShotCaption("line", batch), "📋 line — ✅ 1 lên lịch, ❌ 1 lỗi");
  assert.equal(buildShotCaption("truyen", batch), "📋 truyen — ✅ 1 lên lịch, ❌ 0 lỗi");
});
```

Sửa dòng import ở đầu file (dòng 3) thành:

```js
import { buildDigest, sendTelegram, sendTelegramPhoto, buildShotCaption } from "../sheet/telegram-notify.js";
```

- [ ] **Step 2: Chạy test để chắc là nó đỏ**

Run: `node --test --test-name-pattern="sendTelegramPhoto|buildShotCaption" tests/telegram-notify.test.js`
Expected: FAIL — `SyntaxError: The requested module '../sheet/telegram-notify.js' does not provide an export named 'buildShotCaption'`

- [ ] **Step 3: Viết implementation tối thiểu**

Thêm vào cuối `sheet/telegram-notify.js`:

```js
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
```

- [ ] **Step 4: Chạy test để chắc là nó xanh**

Run: `node --test --test-name-pattern="sendTelegramPhoto|buildShotCaption" tests/telegram-notify.test.js`
Expected: PASS — 4 test mới xanh.

Sau đó chạy cả suite để chắc không vỡ gì: `npm test`
Expected: toàn bộ PASS.

- [ ] **Step 5: Commit**

```bash
git add sheet/telegram-notify.js tests/telegram-notify.test.js
git commit -m "feat(telegram): sendTelegramPhoto + buildShotCaption"
```

---

### Task 2: `captureContentPage` — chụp trang Nội dung Studio

**Files:**
- Create: `sheet/yt-capture.js`
- Test: `tests/yt-capture.test.js`

**Interfaces:**
- Consumes: không có (nhận `page` Playwright từ người gọi).
- Produces: `captureContentPage(page, opts?: {settleMs?: number, timeoutMs?: number, log?: fn, sleep?: fn}) → Promise<Buffer>`
  - `page` phải có: `goto(url, opts)`, `url()`, `waitForSelector(sel, opts)`, `screenshot(opts)`.
  - Ném `Error` nếu URL Studio không chứa `/channel/<ID>`.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/yt-capture.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { captureContentPage } from "../sheet/yt-capture.js";

// page giả: ghi lại mọi URL đã goto, trả url() theo kịch bản.
function fakePage({ url = "https://studio.youtube.com/channel/UC123", waitThrows = false } = {}) {
  const gotos = [];
  let shots = 0;
  return {
    gotos,
    get shots() { return shots; },
    goto: async (u) => { gotos.push(u); },
    url: () => url,
    waitForSelector: async () => { if (waitThrows) throw new Error("timeout"); },
    screenshot: async () => { shots++; return Buffer.from("PNG"); },
  };
}

const noSleep = async () => {};

test("captureContentPage: vào Studio, lấy channel ID, chụp trang Nội dung", async () => {
  const page = fakePage();
  const buf = await captureContentPage(page, { sleep: noSleep });
  assert.equal(page.gotos[0], "https://studio.youtube.com");
  assert.equal(page.gotos[1], "https://studio.youtube.com/channel/UC123/videos/upload");
  assert.equal(page.gotos.length, 2);
  assert.equal(buf.toString(), "PNG");
});

test("captureContentPage: chưa login (URL không có /channel/) -> ném lỗi, không chụp", async () => {
  const page = fakePage({ url: "https://accounts.google.com/signin" });
  await assert.rejects(
    () => captureContentPage(page, { sleep: noSleep }),
    /channel ID/,
  );
  assert.equal(page.shots, 0, "chưa login thì không được chụp");
});

test("captureContentPage: không thấy dòng video nào vẫn chụp và vẫn trả ảnh", async () => {
  const page = fakePage({ waitThrows: true });
  const logs = [];
  const buf = await captureContentPage(page, { sleep: noSleep, log: (m) => logs.push(m) });
  assert.equal(buf.toString(), "PNG");
  assert.equal(page.shots, 1);
  assert.ok(logs.some((m) => /không thấy dòng video/.test(m)));
});

test("captureContentPage: chờ settleMs trước khi chụp (ảnh thumbnail lazy-load)", async () => {
  const page = fakePage();
  const slept = [];
  await captureContentPage(page, { settleMs: 7000, sleep: async (ms) => { slept.push(ms); } });
  assert.deepEqual(slept, [7000]);
});
```

- [ ] **Step 2: Chạy test để chắc là nó đỏ**

Run: `node --test --test-name-pattern="captureContentPage" tests/yt-capture.test.js`
Expected: FAIL — `Cannot find module .../sheet/yt-capture.js`

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `sheet/yt-capture.js`:

```js
// Chụp trang Nội dung của YouTube Studio bằng page GPM đang mở (CDP).
// Dùng để gửi bằng chứng hình ảnh vào Telegram: thumbnail thật YouTube đang
// phục vụ + cột "Đã lên lịch" của loạt video vừa đăng.

const STUDIO = "https://studio.youtube.com";

/**
 * @param {import('playwright-core').Page} page - page từ trình duyệt GPM.
 * @param {object} [opts]
 * @param {number} [opts.settleMs=5000] - chờ ảnh thumbnail lazy-load xong mới chụp.
 * @param {number} [opts.timeoutMs=60000] - timeout cho mỗi lần điều hướng.
 * @returns {Promise<Buffer>} ảnh PNG của viewport.
 */
export async function captureContentPage(page, {
  settleMs = 5000,
  timeoutMs = 60_000,
  log = () => {},
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  // studio.youtube.com chuyển hướng về /channel/<ID> của profile đang đăng nhập —
  // đọc URL là cách duy nhất biết channel ID mà không phải gọi API YouTube.
  await page.goto(STUDIO, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const m = /\/channel\/([^/?#]+)/.exec(page.url());
  if (!m) throw new Error(`Không lấy được channel ID từ URL Studio (${page.url()}) — có thể chưa login.`);

  await page.goto(`${STUDIO}/channel/${m[1]}/videos/upload`, {
    waitUntil: "domcontentloaded", timeout: timeoutMs,
  });

  // Selector hỏng (YouTube đổi giao diện) KHÔNG được chặn — ảnh trang lạ cũng là thông tin.
  try {
    await page.waitForSelector("ytcp-video-row", { timeout: 20_000 });
  } catch {
    log("   … không thấy dòng video nào trên trang Nội dung — vẫn chụp");
  }
  await sleep(settleMs);

  // Viewport, KHÔNG fullPage: connectOverCDP cho context viewport:null nên không đổi
  // được kích thước; fullPage sẽ ra ảnh cao 30 dòng và bị Telegram nén thành không đọc nổi.
  return await page.screenshot({ type: "png" });
}
```

- [ ] **Step 4: Chạy test để chắc là nó xanh**

Run: `node --test --test-name-pattern="captureContentPage" tests/yt-capture.test.js`
Expected: PASS — 4 test xanh.

- [ ] **Step 5: Commit**

```bash
git add sheet/yt-capture.js tests/yt-capture.test.js
git commit -m "feat(sheet): captureContentPage — chụp trang Nội dung Studio"
```

---

### Task 3: Nối dây vào hàng đợi + gửi ảnh thật

**Files:**
- Modify: `sheet/upload-queue.js` (import, dep mới, `lastProfile`, `sendShots`, sửa `scheduleFlush` ở dòng 121-129, thêm 1 dòng vào `runJob`)
- Modify: `electron-main.js:17` (import) và `electron-main.js:1386` (thêm `notifyShots` cạnh `notifyDigest`)
- Test: `tests/upload-queue.test.js` (thêm test vào cuối file)

**Interfaces:**
- Consumes: `captureContentPage(page, opts) → Promise<Buffer>` (Task 2); `sendTelegramPhoto(token, chatId, photo, caption, deps) → Promise<{ok,error}>` và `buildShotCaption(sheetName, results) → string` (Task 1).
- Produces: `createUploadQueue` nhận thêm 2 tuỳ chọn — `notifyShots: async (shots, batch) => void` với `shots: [{sheetName, image: Buffer}]`, và `capture = captureContentPage` (tiêm để test).

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `tests/upload-queue.test.js`:

```js
// Helper: hàng đợi tối giản có bật khâu chụp ảnh.
function shotQueue(over = {}) {
  const logs = [];
  const shotsSeen = [];
  const closed = [];
  let connects = 0;
  const q = createUploadQueue({
    readChannelUploads: emptyUploads,
    connect: async () => { connects++; return { page: {} }; },
    closeConn: async (host, id) => { closed.push(id); },
    runUpload: async () => {},
    now: () => NOW,
    listFiles: () => ["v1.jpg", "v2.jpg"],
    log: (m) => logs.push(m),
    notifyDigest: async () => {},
    notifyShots: async (shots, batch) => { shotsSeen.push({ shots, batch }); },
    capture: async () => Buffer.from("PNG"),
    flushMs: 1,
    ...over,
  });
  return { q, logs, shotsSeen, closed, connects: () => connects };
}

const jobOf = (sheetName, profileId, n) => ({
  sheetName, gpmHost: "h", profileId,
  videoPath: `/o/v${n}.mp4`, overlaysDir: "/ov", title: `v${n}`,
  postTimes: "8:00, 18:00", sourceUrl: `http://u/${sheetName}/${n}`,
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("shots: 1 ảnh cho mỗi kênh có video trong lượt", async () => {
  const { q, shotsSeen } = shotQueue();
  q.enqueue(jobOf("KenhA", "p1", 1));
  q.enqueue(jobOf("KenhA", "p1", 2));
  q.enqueue(jobOf("KenhB", "p2", 1));
  await q.drain();
  await wait(60);

  assert.equal(shotsSeen.length, 1, "notifyShots gọi đúng 1 lần cho cả lượt");
  const names = shotsSeen[0].shots.map((s) => s.sheetName).sort();
  assert.deepEqual(names, ["KenhA", "KenhB"], "mỗi kênh đúng 1 ảnh, không trùng");
  assert.equal(shotsSeen[0].shots[0].image.toString(), "PNG");
  assert.equal(shotsSeen[0].batch.length, 3, "batch mang đủ kết quả để dựng caption");
});

test("shots: trình duyệt đã đóng -> bỏ ảnh, KHÔNG mở lại profile, digest vẫn gửi", async () => {
  let digests = 0;
  const { q, logs, shotsSeen, connects } = shotQueue({
    idleCloseMs: 1,     // đóng trước khi flush
    flushMs: 40,
    notifyDigest: async () => { digests++; },
  });
  q.enqueue(jobOf("KenhA", "p1", 1));
  await q.drain();
  await wait(120);

  assert.equal(digests, 1, "digest vẫn phải gửi");
  assert.equal(shotsSeen.length, 0, "không có ảnh nào");
  assert.equal(connects(), 1, "KHÔNG được mở lại profile GPM chỉ để chụp");
  assert.ok(logs.some((m) => /trình duyệt GPM đã đóng/.test(m)));
});

test("shots: chụp lỗi ở 1 kênh thì kênh còn lại vẫn có ảnh", async () => {
  const { q, logs, shotsSeen } = shotQueue({
    capture: async (page) => { if (page.boom) throw new Error("page chết"); return Buffer.from("PNG"); },
    connect: async (host, id) => ({ page: { boom: id === "p1" } }),
  });
  q.enqueue(jobOf("KenhA", "p1", 1));
  q.enqueue(jobOf("KenhB", "p2", 1));
  await q.drain();
  await wait(60);

  assert.deepEqual(shotsSeen[0].shots.map((s) => s.sheetName), ["KenhB"]);
  assert.ok(logs.some((m) => /chụp trang Nội dung lỗi: page chết/.test(m)));
});

test("shots: notifyShots ném lỗi thì hàng đợi không sập", async () => {
  const { q, logs } = shotQueue({ notifyShots: async () => { throw new Error("mạng die"); } });
  q.enqueue(jobOf("KenhA", "p1", 1));
  await q.drain();
  await wait(60);

  assert.ok(logs.some((m) => /Lỗi gửi ảnh Telegram: mạng die/.test(m)));
  // Hàng đợi vẫn nhận job mới bình thường.
  await q.enqueue(jobOf("KenhA", "p1", 2));
});

test("shots: hẹn giờ đóng trình duyệt bị huỷ trong lúc đang chụp", async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { q, closed } = shotQueue({
    idleCloseMs: 5,
    capture: async () => { await held; return Buffer.from("PNG"); },
  });
  q.enqueue(jobOf("KenhA", "p1", 1));
  await q.drain();
  await wait(60);

  assert.deepEqual(closed, [], "đang chụp thì tuyệt đối không được đóng trình duyệt");
  release();
  await wait(60);
  assert.deepEqual(closed, ["p1"], "chụp xong mới hẹn lại giờ đóng");
});
```

- [ ] **Step 2: Chạy test để chắc là nó đỏ**

Run: `node --test --test-name-pattern="shots:" tests/upload-queue.test.js`
Expected: FAIL — `notifyShots gọi đúng 1 lần cho cả lượt: expected 0 to equal 1` (dep `notifyShots`/`capture` chưa được đọc).

- [ ] **Step 3: Sửa `sheet/upload-queue.js`**

3a. Thêm import cạnh các import sẵn có ở đầu file:

```js
import { captureContentPage } from "./yt-capture.js";
```

3b. Thêm 2 dep vào destructure của `createUploadQueue` (cạnh `notifyDigest` ở dòng 40):

```js
  notifyShots = null,                  // async (shots[], batch[]) — shots: [{ sheetName, image: Buffer }]
  capture = captureContentPage,        // (page, opts) → Buffer PNG (tiêm để test)
```

3c. Thêm state cạnh `const results = [];` (dòng 51):

```js
  const lastProfile = new Map();  // sheetName -> { gpmHost, profileId } (để biết chụp bằng profile nào)
```

3d. Trong `runJob`, ngay sau dòng destructure `const { sheetName, gpmHost, profileId, ... } = job;` (dòng 132), thêm:

```js
    lastProfile.set(sheetName, { gpmHost, profileId });
```

3e. Thay nguyên khối `scheduleFlush` (dòng 120-129) bằng:

```js
  // Khi hàng đợi rảnh → gửi 1 digest gộp các kết quả từ lượt bận, rồi ảnh trang Nội dung.
  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(async () => {
      if (runActive || pending > 0 || !results.length) return; // lượt chạy chưa xong → chưa gửi
      const batch = results.splice(0, results.length);
      if (notifyDigest) {
        try { await notifyDigest(batch); } catch (e) { log(`Lỗi gửi Telegram: ${e?.message || e}`); }
      }
      await sendShots(batch);
    }, flushMs);
  }

  // Chụp trang Nội dung Studio của từng kênh trong lượt rồi gửi kèm digest.
  // Mọi lỗi ở đây chỉ ghi log — digest đã gửi xong trước đó, không được để ảnh làm hỏng nó.
  async function sendShots(batch) {
    if (!notifyShots || closing) return;
    // Chụp mất ~20s/kênh. scheduleClose() đã chạy cùng lúc với scheduleFlush(), nên với
    // gpmIdleCloseMin nhỏ, closeIdleConns() có thể nổ giữa lúc đang chụp và giết page.
    cancelClose();
    const shots = [];
    for (const sheetName of new Set(batch.map((r) => r.sheetName))) {
      const p = lastProfile.get(sheetName);
      const c = p && conns.get(p.profileId);
      if (!c) { log(`[${sheetName}] không chụp được trang Nội dung — trình duyệt GPM đã đóng`); continue; }
      try {
        shots.push({ sheetName, image: await capture(c.page, { log }) });
      } catch (e) {
        log(`[${sheetName}] chụp trang Nội dung lỗi: ${e?.message || e}`);
      }
    }
    if (shots.length) {
      try { await notifyShots(shots, batch); } catch (e) { log(`Lỗi gửi ảnh Telegram: ${e?.message || e}`); }
    }
    scheduleClose(); // chụp xong mới tính lại giờ đóng trình duyệt
  }
```

- [ ] **Step 4: Chạy test để chắc là nó xanh**

Run: `node --test --test-name-pattern="shots:" tests/upload-queue.test.js`
Expected: PASS — 5 test xanh.

Sau đó cả suite: `npm test`
Expected: toàn bộ PASS (các test cũ của upload-queue không truyền `notifyShots` nên `sendShots` thoát ngay ở dòng đầu).

- [ ] **Step 5: Commit phần hàng đợi**

```bash
git add sheet/upload-queue.js tests/upload-queue.test.js
git commit -m "feat(sheet): chụp trang Nội dung từng kênh khi hàng đợi upload rảnh"
```

- [ ] **Step 6: Nối dây vào `electron-main.js`**

Sửa dòng 17 thành:

```js
import { sendTelegram, sendTelegramPhoto, buildDigest, buildShotCaption } from "./sheet/telegram-notify.js";
```

Thêm ngay sau khối `notifyDigest` (kết thúc ở dòng 1386, trước dấu `});` của `createUploadQueue`):

```js
    // Gửi ảnh trang Nội dung Studio của từng kênh, ngay sau digest. Phải bật RIÊNG ô
    // "Gửi kèm ảnh…"; không bật thì để null hẳn để hàng đợi khỏi tốn công chụp.
    // Đọc 1 lần lúc dựng runner — đổi cấu hình khi đang chạy thì phải Dừng → Chạy lại.
    notifyShots: !(s.gpmTelegramEnabled && s.gpmTelegramPhoto) ? null : async (shots, batch) => {
      if (!s.gpmTelegramToken || !s.gpmTelegramChatId) return;
      for (const { sheetName, image } of shots) {
        const r = await sendTelegramPhoto(
          s.gpmTelegramToken, s.gpmTelegramChatId, image, buildShotCaption(sheetName, batch));
        if (!r.ok) emitEvent({ type: "log", message: `Telegram ảnh lỗi: ${r.error || "?"}` });
      }
    },
```

Thêm công tắc riêng `gpmTelegramPhoto` (mặc định tắt) — bật Telegram không có nghĩa là muốn ảnh.

`renderer.html`, bên trong `#sw-gpm-tg-fields` (ngay sau `<span id="sw-gpm-tg-status">`):

```html
              <label style="display:flex;align-items:center;gap:8px;font-weight:normal;margin:0;width:100%;">
                <input id="sw-gpm-tg-photo" type="checkbox"> Gửi kèm ảnh trang Nội dung của kênh khi xong
              </label>
```

`renderer.js` — 3 chỗ:

```js
// trong loadSettings, cạnh sw-gpm-tg-chat:
$("sw-gpm-tg-photo").checked = !!s.gpmTelegramPhoto;

// trong currentSettings, cạnh gpmTelegramChatId:
gpmTelegramPhoto: $("sw-gpm-tg-photo").checked,

// thêm vào mảng listener change tự-lưu:
["sw-auto-open", "sw-use-gpu", "sw-gpm-enabled", "sw-gpm-tg-photo"].forEach((id) =>
  $(id)?.addEventListener("change", saveNow));
```

- [ ] **Step 7: Kiểm tra cú pháp + chạy lại toàn bộ test**

Run: `node --check electron-main.js && npm test`
Expected: `node --check` im lặng (không in gì), `npm test` toàn bộ PASS.

Lưu ý: **không** chạy `node --check renderer.js` — file đó luôn báo lỗi giả, không phải lỗi thật.

- [ ] **Step 8: Commit**

```bash
git add electron-main.js
git commit -m "feat(app): gửi ảnh trang Nội dung Studio kèm digest Telegram"
```

---

## Kiểm tra thủ công (sau khi cả 3 task xong)

Không tự động hoá được vì cần GPM + tài khoản YouTube thật:

1. Bật `npm start`, vào tab **Theo dõi Sheet** → ⚙ → bật **Thông báo Telegram**, điền token + chat ID, bấm nút test → phải nhận được tin text. Bật thêm ô **Gửi kèm ảnh trang Nội dung của kênh khi xong**.
2. Chạy một lượt có ít nhất 1 video lên lịch thành công cho 2 kênh khác nhau.
3. Sau khi lượt xong ~3 giây: Telegram phải nhận digest text, rồi 2 tin ảnh, mỗi ảnh là trang Nội dung của một kênh, caption `📋 <tên kênh> — ✅ n lên lịch, ❌ m lỗi`.
4. Soi ảnh: các video vừa đăng phải hiện thumbnail tuỳ chỉnh (không phải khung hình auto) và cột trạng thái `Đã lên lịch <giờ>`.
5. Tắt riêng ô **Gửi kèm ảnh** (giữ Telegram bật) → Dừng → Chạy lại → chỉ nhận digest text, không có ảnh, và log không có dòng nào về chụp trang Nội dung.
6. Tắt công tắc Telegram → chạy lại → không có tin nào, và log tab Theo dõi Sheet không có dòng lỗi nào.
