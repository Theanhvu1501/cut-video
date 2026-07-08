# GPM Connect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép vid-master kết nối tới trình duyệt GPM của từng kênh (start profile → CDP → mở YouTube Studio), có toggle bật/tắt, mapping kênh→profile đọc từ Sheet `⚙config`.

**Architecture:** Thêm service `sheet/gpm-client.js` (rút gọn từ `../voxable/electron-app/services/gemini-browser.js`) gọi GPM HTTP API + `playwright-core.connectOverCDP`. Parser Sheet đọc thêm cột `gpmProfileId`. 3 IPC handler (`gpm:test`, `gpm:list-channels`, `gpm:connect`) nối vào preload dưới namespace `electronAPI.sheet`. UI nằm trong tab "Theo dõi Sheet".

**Tech Stack:** Electron (ESM, `"type":"module"`), `playwright-core`, `googleapis`, `node --test`.

## Global Constraints

- Ngôn ngữ UI & log: tiếng Việt (khớp code hiện tại).
- ESM: mọi file dùng `import`/`export` (package.json có `"type": "module"`). `preload.cjs` là CommonJS.
- GPM API base: `http://{gpmHost}/api/v3`. `gpmHost` mặc định `"127.0.0.1:19995"`.
- Chỉ dùng `connectOverCDP` (KHÔNG launch Chrome, KHÔNG tải browser của playwright).
- Test chạy bằng `npm test` (`node --test 'tests/*.test.js'`). Test inject dependency (theo mẫu `chroma-detect.test.js` inject `sharp`).
- Preload expose API dưới `window.electronAPI.sheet` (renderer dùng alias `const api = window.electronAPI?.sheet` tại `renderer.js:4121`).
- Giữ nguồn sự thật kênh ở Sheet `⚙config` (tab mặc định `"⚙config"`).

---

### Task 1: Parser đọc cột `gpmProfileId` từ Sheet

**Files:**
- Modify: `sheet/sheets-service.js` (HEADER_ALIASES ~dòng 37–55; object channel ~dòng 110–119)
- Test: `tests/sheets-service.test.js` (thêm test mới vào cuối)

**Interfaces:**
- Consumes: `parseConfigRows(values)` (đã có) — nhận mảng 2 chiều các dòng Sheet.
- Produces: mỗi phần tử channel có thêm field `gpmProfileId: string` (rỗng `""` nếu không có cột/giá trị).

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `tests/sheets-service.test.js`:

```js
test("parseConfigRows đọc cột gpmProfileId qua alias tiếng Việt", () => {
  const rows = [
    ["Tên kênh", "Video mỗi ngày", "GPM Profile ID"],
    ["kenh-a", "2", "  abc123  "],
    ["kenh-b", "1", ""],
  ];
  const out = parseConfigRows(rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].gpmProfileId, "abc123");
  assert.equal(out[1].gpmProfileId, "");
});

test("parseConfigRows gpmProfileId rỗng khi không có cột", () => {
  const rows = [
    ["Tên kênh", "Video mỗi ngày"],
    ["kenh-a", "2"],
  ];
  const out = parseConfigRows(rows);
  assert.equal(out[0].gpmProfileId, "");
});
```

Nếu file test chưa import `parseConfigRows`, đảm bảo dòng import đầu file có nó:
`import { parseConfigRows } from "../sheet/sheets-service.js";` (kiểm tra và bổ sung nếu thiếu — không trùng lặp import).

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — `out[0].gpmProfileId` là `undefined`, không bằng `"abc123"`.

- [ ] **Step 3: Thêm alias**

Trong `sheet/sheets-service.js`, trong object `HEADER_ALIASES`, thêm 1 dòng (đặt sau `proxy:`):

```js
  proxy: ["proxy tải", "proxy"],
  gpmProfileId: ["gpm profile id", "gpm", "profile gpm"],
```

- [ ] **Step 4: Thêm field vào channel object**

Trong `parseConfigRows`, tại object `const channel = { ... }` (~dòng 110), thêm field `gpmProfileId`:

```js
    const channel = {
      sheetName,
      enabled: truthy(col(row, "enabled")),
      videosPerDay: num(col(row, "videosPerDay")) || 0,
      renderMode: col(row, "renderMode") || "topTransparent",
      cfg,
      proxy: col(row, "proxy"),
      gpmProfileId: col(row, "gpmProfileId"),
    };
```

(`col()` đã trả `""` khi không tìm thấy cột — đúng yêu cầu.)

- [ ] **Step 5: Chạy test để xác nhận PASS**

Run: `npm test`
Expected: PASS toàn bộ (bao gồm 2 test mới).

- [ ] **Step 6: Commit**

```bash
git add sheet/sheets-service.js tests/sheets-service.test.js
git commit -m "feat(gpm): parser đọc cột gpmProfileId từ Sheet ⚙config"
```

---

### Task 2: Service `sheet/gpm-client.js` + dependency

**Files:**
- Create: `sheet/gpm-client.js`
- Modify: `package.json` (dependencies)
- Test: `tests/gpm-client.test.js` (mới)

**Interfaces:**
- Produces:
  - `testGpmConnection(gpmHost, deps?) → Promise<Array<{id, name}>>` — `deps` mặc định `{ fetch: globalThis.fetch }` (để test inject).
  - `startProfile(gpmHost, profileId, deps?) → Promise<string>` — trả `remote_debugging_address` (`"127.0.0.1:port"`).
  - `connectAndOpenStudio(gpmHost, profileId) → Promise<{ ok: true }>` — start profile + CDP + mở Studio, giữ mở.
- Consumes: `playwright-core` (`import { chromium } from "playwright-core"`).

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/gpm-client.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { testGpmConnection, startProfile } from "../sheet/gpm-client.js";

function fakeFetch(status, body) {
  return async (url) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    _url: url,
  });
}

test("testGpmConnection map data -> {id,name} và gọi đúng URL", async () => {
  let called;
  const fetch = async (url) => { called = url; return { ok: true, status: 200,
    json: async () => ({ data: [{ id: "p1", name: "Kênh A" }, { id: "p2" }] }) }; };
  const out = await testGpmConnection("127.0.0.1:19995", { fetch });
  assert.match(called, /^http:\/\/127\.0\.0\.1:19995\/api\/v3\/profiles\?/);
  assert.deepEqual(out, [{ id: "p1", name: "Kênh A" }, { id: "p2", name: "p2" }]);
});

test("testGpmConnection ném lỗi khi HTTP không ok", async () => {
  await assert.rejects(
    () => testGpmConnection("h", { fetch: fakeFetch(500, {}) }),
    /GPM HTTP 500/,
  );
});

test("startProfile trả remote_debugging_address", async () => {
  const fetch = fakeFetch(200, { success: true, data: { remote_debugging_address: "127.0.0.1:1234" } });
  const addr = await startProfile("h", "p1", { fetch });
  assert.equal(addr, "127.0.0.1:1234");
});

test("startProfile ném lỗi khi success=false", async () => {
  await assert.rejects(
    () => startProfile("h", "p1", { fetch: fakeFetch(200, { success: false, message: "x" }) }),
    /GPM error/,
  );
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npm test`
Expected: FAIL — không import được `../sheet/gpm-client.js` (chưa tồn tại).

- [ ] **Step 3: Cài dependency**

Thêm vào `package.json` mục `dependencies` (giữ thứ tự abc gần `p-limit`):

```json
    "p-limit": "^6.2.0",
    "playwright-core": "^1.44.0",
```

Rồi chạy:

```bash
npm install
```

Expected: `playwright-core` xuất hiện trong `node_modules/`.

- [ ] **Step 4: Viết service**

Tạo `sheet/gpm-client.js`:

```js
import { chromium } from "playwright-core";

// Map profileId -> { browser } để đóng phiên cũ trước khi mở lại (tránh khoá profile).
const openedBrowsers = new Map();

export async function testGpmConnection(gpmHost, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const res = await fetchFn(`http://${gpmHost}/api/v3/profiles?page=0&per_page=100`);
  if (!res.ok) throw new Error(`GPM HTTP ${res.status}`);
  const data = await res.json();
  return (data.data || data.profiles || []).map((p) => ({ id: p.id, name: p.name || p.id }));
}

export async function startProfile(gpmHost, profileId, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const res = await fetchFn(`http://${gpmHost}/api/v3/profiles/start/${profileId}`);
  if (!res.ok) throw new Error(`GPM HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(`GPM error: ${JSON.stringify(data)}`);
  return data.data.remote_debugging_address; // "127.0.0.1:port"
}

async function connectOverCDPWithRetry(address, retries = 10, intervalMs = 1000) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await chromium.connectOverCDP(`http://${address}`);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error(`Không thể kết nối CDP tới ${address}: ${lastErr.message}`);
}

export async function connectAndOpenStudio(gpmHost, profileId) {
  // Đóng phiên cũ của cùng profile nếu có (tránh khoá thư mục profile).
  const existing = openedBrowsers.get(profileId);
  if (existing) {
    try { await existing.browser.close(); } catch {}
    openedBrowsers.delete(profileId);
  }

  const address = await startProfile(gpmHost, profileId);
  const browser = await connectOverCDPWithRetry(address);
  openedBrowsers.set(profileId, { browser });

  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("https://studio.youtube.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
  return { ok: true };
}
```

- [ ] **Step 5: Chạy test để xác nhận PASS**

Run: `npm test`
Expected: PASS toàn bộ (4 test mới trong `gpm-client.test.js`).

- [ ] **Step 6: Commit**

```bash
git add sheet/gpm-client.js tests/gpm-client.test.js package.json package-lock.json
git commit -m "feat(gpm): service gpm-client (test/start/connectAndOpenStudio) + playwright-core"
```

---

### Task 3: IPC handlers + preload

**Files:**
- Modify: `electron-main.js` (import ~dòng 12–16; thêm handler cạnh nhóm `sheet:*` ~dòng 1415)
- Modify: `preload.cjs` (namespace `sheet`)

**Interfaces:**
- Consumes: `testGpmConnection`, `connectAndOpenStudio` từ `sheet/gpm-client.js`; `createSheetsClient`, `readConfigSheet` từ `sheet/sheets-service.js`; `loadSheetSettings()` (đã có trong electron-main.js).
- Produces (IPC):
  - `gpm:test ({ gpmHost }) → { ok, profiles } | { ok:false, error }`
  - `gpm:list-channels () → { ok, channels: [{ sheetName, gpmProfileId, videosPerDay }] } | { ok:false, error }`
  - `gpm:connect ({ gpmHost, profileId, sheetName }) → { ok } | { ok:false, error }`
- Produces (preload): `electronAPI.sheet.gpmTest(gpmHost)`, `electronAPI.sheet.gpmListChannels()`, `electronAPI.sheet.gpmConnect(args)`.

- [ ] **Step 1: Thêm import service**

Trong `electron-main.js`, ngay dưới dòng import `sheets-service` (dòng 12), thêm:

```js
import { testGpmConnection, connectAndOpenStudio } from "./sheet/gpm-client.js";
```

- [ ] **Step 2: Thêm 3 IPC handler**

Trong `electron-main.js`, ngay sau handler `ipcMain.handle("sheet:run-now", ...)` (kết thúc ~dòng 1420), thêm:

```js
ipcMain.handle("gpm:test", async (e, { gpmHost } = {}) => {
  try {
    const host = (gpmHost || "").trim() || "127.0.0.1:19995";
    const profiles = await testGpmConnection(host);
    return { ok: true, profiles };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("gpm:list-channels", async () => {
  try {
    const st = loadSheetSettings();
    if (!st.spreadsheetId) return { ok: false, error: "Chưa nhập Spreadsheet ID." };
    if (!st.credentialsPath) return { ok: false, error: "Chưa chọn file service account JSON." };
    const sheets = createSheetsClient(st.credentialsPath);
    const channels = await readConfigSheet(sheets, st.spreadsheetId);
    return {
      ok: true,
      channels: channels.map((c) => ({
        sheetName: c.sheetName,
        gpmProfileId: c.gpmProfileId || "",
        videosPerDay: c.videosPerDay || 0,
      })),
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("gpm:connect", async (e, { gpmHost, profileId } = {}) => {
  try {
    const host = (gpmHost || "").trim() || "127.0.0.1:19995";
    const pid = (profileId || "").trim();
    if (!pid) return { ok: false, error: "Kênh chưa có GPM Profile ID." };
    await connectAndOpenStudio(host, pid);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});
```

- [ ] **Step 3: Expose preload**

Trong `preload.cjs`, trong object `sheet: { ... }`, thêm 3 method (sau `removeEventListener`):

```js
    removeEventListener: () => ipcRenderer.removeAllListeners("sheet:event"),
    gpmTest: (gpmHost) => ipcRenderer.invoke("gpm:test", { gpmHost }),
    gpmListChannels: () => ipcRenderer.invoke("gpm:list-channels"),
    gpmConnect: (args) => ipcRenderer.invoke("gpm:connect", args),
```

- [ ] **Step 4: Kiểm tra app khởi động không lỗi**

Run: `npm start`
Expected: App mở cửa sổ bình thường, không có lỗi đỏ trong terminal/DevTools về `gpm-client` hay import. Đóng app.

- [ ] **Step 5: Commit**

```bash
git add electron-main.js preload.cjs
git commit -m "feat(gpm): IPC gpm:test/list-channels/connect + preload"
```

---

### Task 4: UI trong tab "Theo dõi Sheet"

**Files:**
- Modify: `renderer.html` (trong `#sheet-watch`, sau khối `action-buttons` ~dòng 3767)
- Modify: `renderer.js` (module sheet-watch: `loadSettings`/`currentSettings` ~dòng 4145–4174; thêm handlers cuối module)

**Interfaces:**
- Consumes: `api.gpmTest`, `api.gpmListChannels`, `api.gpmConnect` (alias `const api = window.electronAPI?.sheet` tại `renderer.js:4121`); `api.loadSettings`/`api.saveSettings` (đã có).
- Produces: các phần tử DOM id `sw-gpm-enabled`, `sw-gpm-host`, `sw-gpm-test`, `sw-gpm-test-status`, `sw-gpm-panel`, `sw-gpm-list`, `sw-gpm-connect-all`, `sw-gpm-table` (tbody).

- [ ] **Step 1: Thêm HTML khối GPM**

Trong `renderer.html`, ngay sau `</div>` đóng khối `<div class="action-buttons"> ... </div>` (kết thúc ~dòng 3767, trước `<table id="sw-status-table"`), chèn:

```html
          <div class="form-group" style="margin-top:20px;border-top:1px solid #e2e8f0;padding-top:16px;">
            <label style="display:flex;align-items:center;gap:8px;font-weight:600;">
              <input id="sw-gpm-enabled" type="checkbox"> Bật tự động GPM (đăng bằng trình duyệt GPM)
            </label>
          </div>
          <div id="sw-gpm-panel" style="display:none;">
            <div class="form-group" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <label style="margin:0;">GPM host</label>
              <input id="sw-gpm-host" type="text" value="127.0.0.1:19995" style="width:200px">
              <button id="sw-gpm-test" title="Kiểm tra kết nối GPM"
                style="border:1px solid #cbd5e0;background:#fff;border-radius:6px;cursor:pointer;font-size:16px;line-height:1;padding:5px 8px;">🔌</button>
              <span id="sw-gpm-test-status" style="font-size:13px;"></span>
            </div>
            <div class="action-buttons">
              <button class="btn btn-secondary" id="sw-gpm-list">Tải danh sách kênh</button>
              <button class="btn btn-primary" id="sw-gpm-connect-all">Connect tất cả</button>
            </div>
            <table id="sw-gpm-table" style="width:100%;border-collapse:collapse;margin-top:12px;font-size:13px">
              <thead>
                <tr style="background:#f8f9fa;border-bottom:2px solid #e2e8f0;">
                  <th style="text-align:left;padding:10px 12px;">Kênh</th>
                  <th style="text-align:left;padding:10px 12px;">GPM Profile ID</th>
                  <th style="text-align:left;padding:10px 12px;">Kết nối</th>
                  <th style="text-align:left;padding:10px 12px;">Trạng thái</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
```

- [ ] **Step 2: Load/save 2 trường mới**

Trong `renderer.js`, hàm `loadSettings` (~dòng 4145), thêm trước dấu `}` đóng hàm:

```js
    $("sw-gpm-enabled").checked = !!s.gpmEnabled;
    $("sw-gpm-host").value = s.gpmHost || "127.0.0.1:19995";
    $("sw-gpm-panel").style.display = s.gpmEnabled ? "" : "none";
```

Trong hàm `currentSettings` (~dòng 4155), thêm 2 field vào object trả về (trước `};`):

```js
      gpmEnabled: $("sw-gpm-enabled").checked,
      gpmHost: $("sw-gpm-host").value.trim() || "127.0.0.1:19995",
```

- [ ] **Step 3: Wiring toggle + auto-save**

Trong `renderer.js`, mảng listener auto-save (~dòng 4173) — thêm id mới. Đổi:

```js
  ["sw-auto-open", "sw-use-gpu"].forEach((id) =>
    $(id)?.addEventListener("change", saveNow));
```

thành:

```js
  ["sw-auto-open", "sw-use-gpu", "sw-gpm-enabled"].forEach((id) =>
    $(id)?.addEventListener("change", saveNow));
  $("sw-gpm-host")?.addEventListener("input", saveDebounced);
  $("sw-gpm-enabled")?.addEventListener("change", () => {
    $("sw-gpm-panel").style.display = $("sw-gpm-enabled").checked ? "" : "none";
  });
```

- [ ] **Step 4: Handlers Test / List / Connect**

Trong `renderer.js`, cuối module sheet-watch (ngay TRƯỚC dòng đóng module — tìm `})();` hoặc `}` cuối cùng của IIFE bao quanh `const api = window.electronAPI?.sheet`; đặt cùng cấp với các handler `$("sw-test")?.addEventListener` khác), thêm:

```js
  $("sw-gpm-test")?.addEventListener("click", async () => {
    const statusEl = $("sw-gpm-test-status");
    statusEl.textContent = "⏳ đang kiểm tra…"; statusEl.style.color = "#666";
    const r = await api.gpmTest($("sw-gpm-host").value.trim());
    if (r?.ok) { statusEl.textContent = `✅ ${r.profiles.length} profiles`; statusEl.style.color = "#1a7f37"; }
    else { statusEl.textContent = `❌ ${r?.error || "lỗi"}`; statusEl.style.color = "#c00"; }
  });

  function gpmRenderRow(ch) {
    const tb = $("sw-gpm-table").querySelector("tbody");
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #eee";
    tr.innerHTML = `
      <td style="padding:8px 12px;">${ch.sheetName}</td>
      <td style="padding:8px 12px;">${ch.gpmProfileId || '<span style="color:#c00;">(chưa có)</span>'}</td>
      <td style="padding:8px 12px;"><button class="btn btn-secondary gpm-connect-btn"${ch.gpmProfileId ? "" : " disabled"}>Connect</button></td>
      <td class="gpm-st" style="padding:8px 12px;"></td>`;
    const btn = tr.querySelector(".gpm-connect-btn");
    const st = tr.querySelector(".gpm-st");
    btn?.addEventListener("click", () => gpmConnectOne(ch, st, btn));
    tb.appendChild(tr);
    return { st, btn, ch };
  }

  async function gpmConnectOne(ch, st, btn) {
    if (!ch.gpmProfileId) return;
    if (btn) btn.disabled = true;
    st.textContent = "⏳ đang kết nối…"; st.style.color = "#666";
    const r = await api.gpmConnect({ gpmHost: $("sw-gpm-host").value.trim(), profileId: ch.gpmProfileId, sheetName: ch.sheetName });
    if (r?.ok) { st.textContent = "✅ đã mở Studio"; st.style.color = "#1a7f37"; }
    else { st.textContent = `❌ ${r?.error || "lỗi"}`; st.style.color = "#c00"; }
    if (btn) btn.disabled = false;
  }

  let gpmRows = [];
  $("sw-gpm-list")?.addEventListener("click", async () => {
    const tb = $("sw-gpm-table").querySelector("tbody");
    tb.innerHTML = "";
    gpmRows = [];
    const r = await api.gpmListChannels();
    if (!r?.ok) { alert(r?.error || "Không tải được danh sách kênh."); return; }
    gpmRows = r.channels.map((ch) => gpmRenderRow(ch));
  });

  $("sw-gpm-connect-all")?.addEventListener("click", async () => {
    for (const row of gpmRows) {
      if (row.ch.gpmProfileId) await gpmConnectOne(row.ch, row.st, row.btn);
    }
  });
```

- [ ] **Step 5: Kiểm thử thủ công**

Run: `npm start`
Kiểm tra theo thứ tự:
1. Tab "Theo dõi Sheet": khối GPM ẩn khi checkbox tắt; tick "Bật tự động GPM" → khối hiện; tắt → ẩn lại; đóng/mở app giữ đúng trạng thái (đã lưu).
2. Nút 🔌 Test (cần GPM đang chạy ở `127.0.0.1:19995`): hiện `✅ N profiles`. Nếu GPM tắt → hiện `❌ ...`.
3. "Tải danh sách kênh" (cần Sheet đã cấu hình + có cột GPM Profile ID): bảng hiện các kênh; kênh không có profile → nút Connect disabled + "(chưa có)".
4. Nút "Connect" một kênh: mở đúng trình duyệt GPM của profile đó tới `studio.youtube.com`, trạng thái `✅ đã mở Studio`.
5. "Connect tất cả": lần lượt connect các kênh có profile.

- [ ] **Step 6: Commit**

```bash
git add renderer.html renderer.js
git commit -m "feat(gpm): UI toggle + test + bảng kênh + connect trong tab Sheet"
```

---

## Self-Review

**Spec coverage:**
- Toggle bật/tắt auto GPM → Task 4 (`sw-gpm-enabled`, ẩn/hiện panel, lưu `gpmEnabled`). ✅
- `gpmEnabled`/`gpmHost` trong sheet-settings → Task 4 load/save (dùng `sheet:save-settings`/`load-settings` sẵn có). ✅
- Cột `gpmProfileId` + alias → Task 1. ✅
- Service GPM (test/start/CDP/openStudio) từ voxable → Task 2. ✅
- IPC test/list-channels/connect + preload → Task 3. ✅
- `playwright-core`, không cần Chrome → Task 2 (chỉ `connectOverCDP`). ✅
- UI: test host, bảng kênh, connect từng dòng + tất cả → Task 4. ✅
- Unit test parser + service → Task 1, Task 2. ✅

**Placeholder scan:** Không có TBD/TODO; mọi step có code/command cụ thể. ✅

**Type consistency:** `gpmProfileId` dùng nhất quán (parser → list-channels → UI). IPC tên khớp preload (`gpm:test`↔`gpmTest`, `gpm:list-channels`↔`gpmListChannels`, `gpm:connect`↔`gpmConnect`). `connectAndOpenStudio(gpmHost, profileId)` khớp giữa Task 2 và Task 3. ✅
