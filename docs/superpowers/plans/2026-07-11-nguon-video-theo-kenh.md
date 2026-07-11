# Nguồn video theo kênh (tải / lấy tại máy) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho mỗi kênh chọn nguồn video trong `⚙config`: "tải" (như cũ) hoặc "lấy tại máy" (dùng file trong `inputs/` làm overlay), giữ nguyên toàn bộ cơ chế Sheet/retry.

**Architecture:** Kênh local dùng Sheet y hệt kênh tải. Runner tự quét `inputs/*.mp4` và append tên file vào cột A (như `fetchSourceUrlsFor` làm với URL). Bước "download" trong `runChannel` rẽ nhánh: local → copy file từ `inputs/` sang `overlays/` làm overlay; ngược lại → `yt-dlp` như cũ. Từ overlay trở đi (render, upload, retry, slot lịch) dùng chung code, không đổi.

**Tech Stack:** Node.js ESM, `node:test` + `node:assert/strict`, Google Sheets API (googleapis), Electron main process.

## Global Constraints

- Ngôn ngữ hiển thị/log: tiếng Việt (khớp code hiện tại).
- `renderer.js` là classic script — KHÔNG dùng `node --check renderer.js` (báo lỗi giả do khai báo trùng). Task này không đụng `renderer.js`.
- Không đổi luồng kênh tải ngoài các rẽ nhánh `videoSource === "local"` đã nêu.
- Chạy test: `node --test tests/<file>` cho từng file; `npm test` chạy toàn bộ.
- `videoSource` chỉ nhận `"local"` hoặc `"download"`; giá trị mặc định khi trống là `"download"`.

---

## File Structure

- `sheet/sheets-service.js` — thêm alias cột `videoSource` + parse trong `parseConfigRows`.
- `sheet/channel-download.js` — thêm hàm thuần `copyLocalOverlay`.
- `sheet/sheet-runner.js` — auto-sync `inputs/`→Sheet + rẽ nhánh local ở bước download + bỏ proxy/delay cho local.
- `sheet/youtube-api.js` — nguồn của `pickNewUrls` (đã có, chỉ import lại).
- `electron-main.js` — `ensureDirs` thêm `inputsDir`; tiêm `copyLocalOverlay`, `listLocalInputs`, `sheetsApi.appendUrls`.
- Tests: `tests/sheets-service.test.js`, `tests/channel-download.test.js`, `tests/sheet-runner.test.js`.

---

## Task 1: `parseConfigRows` đọc cột "Nguồn video" → `videoSource`

**Files:**
- Modify: `sheet/sheets-service.js:37-63` (HEADER_ALIASES), `sheet/sheets-service.js:132-144` (channel object)
- Test: `tests/sheets-service.test.js`

**Interfaces:**
- Produces: `channel.videoSource: "local" | "download"` trên mỗi phần tử `parseConfigRows` trả về.

- [ ] **Step 1: Sửa test cũ đang deepEqual cả object (sẽ vỡ khi thêm khóa mới)**

Trong `tests/sheets-service.test.js`, test `"parseConfigRows maps columns and defaults enabled=true when blank"`, thêm `videoSource: "download"` vào object kỳ vọng của `out[0]`:

```js
  assert.deepEqual(out[0], {
    sheetName: "Kênh A", enabled: true, videosPerDay: 3, renderMode: "topTransparent",
    cfg: { opacity: 0.7 }, proxy: "", gpmProfileId: "", postTimes: "",
    rowIndex: 2, channelUrl: "", sourceHandle: "", videoSource: "download",
  });
```

- [ ] **Step 2: Viết test mới cho cột "Nguồn video"**

Thêm vào cuối `tests/sheets-service.test.js`:

```js
test("parseConfigRows đọc cột Nguồn video → videoSource", () => {
  const header = ["sheetName","videosPerDay","Nguồn video"];
  const rows = [header,
    ["Kênh A","3","tại máy"],
    ["Kênh B","3","local"],
    ["Kênh C","3",""],
    ["Kênh D","3","tải"],
    ["Kênh E","3","MÁY"],
  ];
  const out = parseConfigRows(rows);
  assert.equal(out[0].videoSource, "local");
  assert.equal(out[1].videoSource, "local");
  assert.equal(out[2].videoSource, "download");
  assert.equal(out[3].videoSource, "download");
  assert.equal(out[4].videoSource, "local");
});
```

- [ ] **Step 3: Chạy test, xác nhận FAIL**

Run: `node --test tests/sheets-service.test.js`
Expected: FAIL — `out[0].videoSource` là `undefined`, không khớp `"local"`.

- [ ] **Step 4: Thêm alias cột**

Trong `sheet/sheets-service.js`, thêm dòng vào `HEADER_ALIASES` (ngay sau `sourceHandle`):

```js
  sourceHandle: ["@handle nguồn", "handle nguồn", "kênh nguồn", "nguồn kênh chính", "nguồn kênh"],
  videoSource: ["nguồn video", "kiểu nguồn"],
```

- [ ] **Step 5: Parse `videoSource` trong `parseConfigRows`**

Trong `sheet/sheets-service.js`, ngay TRƯỚC dòng `const channel = {`, thêm:

```js
    const vsNorm = norm(col(row, "videoSource"));
    const videoSource = ["tai may", "local", "may", "file"].includes(vsNorm) ? "local" : "download";
```

Rồi thêm `videoSource,` vào object `channel` (sau `sourceHandle: col(row, "sourceHandle"),`):

```js
      channelUrl: col(row, "channelUrl"),
      sourceHandle: col(row, "sourceHandle"),
      videoSource,
    };
```

- [ ] **Step 6: Chạy test, xác nhận PASS**

Run: `node --test tests/sheets-service.test.js`
Expected: PASS toàn bộ (cả test cũ đã sửa ở Step 1).

- [ ] **Step 7: Commit**

```bash
git add sheet/sheets-service.js tests/sheets-service.test.js
git commit -m "feat(sheet): đọc cột Nguồn video → videoSource trong ⚙config"
```

---

## Task 2: Hàm thuần `copyLocalOverlay`

**Files:**
- Modify: `sheet/channel-download.js` (thêm export cuối file)
- Test: `tests/channel-download.test.js`

**Interfaces:**
- Produces: `copyLocalOverlay(fileName: string, inputsDir: string, overlaysDir: string): { filePath: string, title: string }`. Ném lỗi nếu `inputsDir/<fileName>` không tồn tại. Copy sang `overlaysDir/<fileName>`; nếu có `inputsDir/<title>.jpg` thì copy kèm. `title` = tên file bỏ đuôi. Cùng shape trả về với `downloadOne` (`{ filePath, title }`).

- [ ] **Step 1: Viết test (dùng temp dir thật, khớp style file này)**

Thêm vào `tests/channel-download.test.js`:

```js
import { copyLocalOverlay } from "../sheet/channel-download.js";

test("copyLocalOverlay copies file to overlays and derives title", () => {
  const inputs = tmpDir();
  const overlays = tmpDir();
  fs.writeFileSync(path.join(inputs, "video-a.mp4"), "DATA");
  const r = copyLocalOverlay("video-a.mp4", inputs, overlays);
  assert.equal(r.title, "video-a");
  assert.equal(r.filePath, path.join(overlays, "video-a.mp4"));
  assert.equal(fs.readFileSync(r.filePath, "utf-8"), "DATA");
});

test("copyLocalOverlay copies sibling <title>.jpg thumbnail when present", () => {
  const inputs = tmpDir();
  const overlays = tmpDir();
  fs.writeFileSync(path.join(inputs, "clip.mp4"), "V");
  fs.writeFileSync(path.join(inputs, "clip.jpg"), "IMG");
  copyLocalOverlay("clip.mp4", inputs, overlays);
  assert.equal(fs.readFileSync(path.join(overlays, "clip.jpg"), "utf-8"), "IMG");
});

test("copyLocalOverlay throws when source file missing", () => {
  const inputs = tmpDir();
  const overlays = tmpDir();
  assert.throws(() => copyLocalOverlay("nope.mp4", inputs, overlays), /nope\.mp4/);
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `node --test tests/channel-download.test.js`
Expected: FAIL — `copyLocalOverlay` chưa export (`is not a function`).

- [ ] **Step 3: Cài đặt `copyLocalOverlay`**

Thêm vào cuối `sheet/channel-download.js` (file đã `import fs from "fs"` và `import path from "path"`):

```js
// Kênh "lấy tại máy": copy file trong inputs/ sang overlays/ làm overlay, cùng shape
// trả về với downloadOne. File gốc trong inputs/ KHÔNG bị đụng (chỉ copy).
export function copyLocalOverlay(fileName, inputsDir, overlaysDir) {
  const src = path.join(inputsDir, fileName);
  if (!fs.existsSync(src)) throw new Error(`Không thấy file trong inputs: ${fileName}`);
  if (!fs.existsSync(overlaysDir)) fs.mkdirSync(overlaysDir, { recursive: true });
  const dest = path.join(overlaysDir, fileName);
  fs.copyFileSync(src, dest);
  const title = fileName.replace(/\.[^.]+$/, "");
  const jpg = path.join(inputsDir, `${title}.jpg`);
  if (fs.existsSync(jpg)) fs.copyFileSync(jpg, path.join(overlaysDir, `${title}.jpg`));
  return { filePath: dest, title };
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `node --test tests/channel-download.test.js`
Expected: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add sheet/channel-download.js tests/channel-download.test.js
git commit -m "feat(sheet): copyLocalOverlay — lấy file inputs/ làm overlay"
```

---

## Task 3: Auto-sync `inputs/` → Sheet trong `runChannel`

**Files:**
- Modify: `sheet/sheet-runner.js:1-5` (import), `sheet/sheet-runner.js:23-27` (deps), `sheet/sheet-runner.js:90-101` (thân runChannel)
- Test: `tests/sheet-runner.test.js`

**Interfaces:**
- Consumes: `sheetsApi.appendUrls(sheetName, urls: string[]): Promise<any>`, dep `listLocalInputs(inputsDir): string[]`, `ensureDirs(root)` nay trả thêm `inputsDir`, `pickNewUrls(existing, candidates)` từ `./youtube-api.js`.
- Produces: khi `ch.videoSource === "local"`, các tên file mới trong `inputs/` được append vào cột A trước khi lập kế hoạch render.

- [ ] **Step 1: Viết test auto-sync**

Thêm vào `tests/sheet-runner.test.js`:

```js
test("kênh local: tự quét inputs/ và append tên file mới vào Sheet (dedup)", async () => {
  const appended = [];
  const { deps } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 0, renderMode: "topTransparent", cfg: {}, proxy: "", videoSource: "local" },
      ],
      // "a.mp4" đã có sẵn trong Sheet → chỉ "b.mp4","c.mp4" là mới
      readChannelUrls: async () => [{ rowIndex: 2, url: "a.mp4", status: "done", uploadStatus: "✅" }],
      setUrlStatus: async () => {},
      appendUrls: async (name, urls) => { appended.push({ name, urls }); },
    },
    listLocalInputs: () => ["a.mp4", "b.mp4", "c.mp4"],
    ensureDirs: () => ({ backgroundsDir: "/bg", overlaysDir: "/ov", outputDir: "/out", inputsDir: "/in" }),
  });
  await createSheetRunner(deps).runNow();
  assert.equal(appended.length, 1);
  assert.equal(appended[0].name, "Kênh A");
  assert.deepEqual(appended[0].urls, ["b.mp4", "c.mp4"]);
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `node --test tests/sheet-runner.test.js`
Expected: FAIL — `appendUrls` không được gọi (`appended.length` là 0), hoặc lỗi `listLocalInputs is not a function`.

- [ ] **Step 3: Import `pickNewUrls`**

Trong `sheet/sheet-runner.js`, thêm sau dòng import `normalizeProxy`:

```js
import { normalizeProxy } from "./proxy.js";
import { pickNewUrls } from "./youtube-api.js";
```

- [ ] **Step 4: Thêm `copyLocalOverlay`, `listLocalInputs` vào deps destructure**

Sửa khối destructure đầu `createSheetRunner` (dòng 23-27) — thêm hai dep (Task 3 dùng `listLocalInputs`, Task 4 dùng `copyLocalOverlay`; khai báo luôn ở đây):

```js
  const {
    config, sheetsApi, downloader, copyLocalOverlay, listLocalInputs, renderer, listBackgrounds,
    ensureDirs, stateStore, emit, now, pLimitFn, rand, unlink, detectChroma, sleep,
    uploadQueue, refreshStats, resumeStore, fileExists,
  } = deps;
```

- [ ] **Step 5: Lấy `inputsDir` từ `ensureDirs` + chèn auto-sync**

Sửa dòng destructure `ensureDirs` (dòng 91):

```js
      const { backgroundsDir, overlaysDir, outputDir, inputsDir } = ensureDirs(channelRoot);
```

Ngay SAU khối kiểm background (sau dòng `}` đóng `if (!backgrounds.length)`, tức trước `const state = stateStore.load();`), chèn:

```js
      // Kênh local: tự điền tên file trong inputs/ vào cột A (như fetchSourceUrlsFor
      // làm với URL). Người dùng chỉ thả file, không gõ tay.
      if (ch.videoSource === "local") {
        const localFiles = listLocalInputs(inputsDir);
        const existing = (await sheetsApi.readChannelUrls(ch.sheetName)).map((r) => r.url);
        const fresh = pickNewUrls(existing, localFiles);
        if (fresh.length) await sheetsApi.appendUrls(ch.sheetName, fresh);
      }
```

- [ ] **Step 6: Thêm default deps vào `makeDeps` để test cũ không vỡ**

Trong `tests/sheet-runner.test.js`, hàm `makeDeps`, thêm vào object `deps` (cạnh `downloader`):

```js
    listLocalInputs: () => [],
    copyLocalOverlay: (name) => ({ filePath: `/ov/${name}`, title: name.replace(/\.[^.]+$/, "") }),
```

Và trong `sheetsApi` mặc định của `makeDeps`, thêm:

```js
      appendUrls: async () => {},
```

- [ ] **Step 7: Chạy test, xác nhận PASS**

Run: `node --test tests/sheet-runner.test.js`
Expected: PASS toàn bộ (test mới + các test cũ).

- [ ] **Step 8: Commit**

```bash
git add sheet/sheet-runner.js tests/sheet-runner.test.js
git commit -m "feat(sheet): kênh local tự quét inputs/ điền tên file vào Sheet"
```

---

## Task 4: Rẽ nhánh local ở bước download + bỏ proxy/delay

**Files:**
- Modify: `sheet/sheet-runner.js:77-88` (proxy), `sheet/sheet-runner.js:186-197` (bước download)
- Test: `tests/sheet-runner.test.js`

**Interfaces:**
- Consumes: dep `copyLocalOverlay(fileName, inputsDir, overlaysDir)` (Task 2, đã khai báo destructure ở Task 3).
- Produces: khi `videoSource === "local"`, overlay được lấy bằng `copyLocalOverlay` thay vì `downloader`; không gọi `normalizeProxy`, không `sleep` delay.

- [ ] **Step 1: Viết test nhánh local render + không proxy/delay**

Thêm vào `tests/sheet-runner.test.js`:

```js
test("kênh local: dùng copyLocalOverlay, render, set DONE; không proxy/không delay", async () => {
  const copied = [];
  const slept = [];
  const rendered = [];
  const { deps, calls } = makeDeps({
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/s.json", renderConcurrency: 2, downloadDelayMinMs: 90000, downloadDelayMaxMs: 90000 },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "socks5://bad", videoSource: "local" },
      ],
      readChannelUrls: async () => [
        { rowIndex: 2, url: "a.mp4", status: "", uploadStatus: "" },
        { rowIndex: 3, url: "b.mp4", status: "", uploadStatus: "" },
      ],
      setUrlStatus: async (n, r, s) => calls.status.push({ rowIndex: r, status: s }),
      appendUrls: async () => {},
    },
    listLocalInputs: () => ["a.mp4", "b.mp4"],
    ensureDirs: () => ({ backgroundsDir: "/bg", overlaysDir: "/ov", outputDir: "/out", inputsDir: "/in" }),
    copyLocalOverlay: (name, inputsDir, overlaysDir) => { copied.push({ name, inputsDir, overlaysDir }); return { filePath: `/ov/${name}`, title: name.replace(/\.[^.]+$/, "") }; },
    renderer: async (opts) => { rendered.push(opts); return { outputPath: opts.outputPath }; },
    sleep: async (ms) => { slept.push(ms); },
  });
  await createSheetRunner(deps).runNow();
  assert.equal(copied.length, 2);
  assert.equal(copied[0].inputsDir, "/in");
  assert.equal(rendered.length, 2);
  assert.equal(rendered[0].overlayFile, "/ov/a.mp4");
  assert.equal(calls.status.filter((s) => s.status === ST.DONE).length, 2);
  assert.deepEqual(slept, []); // local KHÔNG delay dù cấu hình delay 90s
});

test("kênh local: proxy hỏng vẫn chạy (không dừng kênh)", async () => {
  const { deps, calls } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "socks5://bad", videoSource: "local" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "a.mp4", status: "", uploadStatus: "" }],
      setUrlStatus: async () => {},
      appendUrls: async () => {},
    },
    listLocalInputs: () => ["a.mp4"],
    ensureDirs: () => ({ backgroundsDir: "/bg", overlaysDir: "/ov", outputDir: "/out", inputsDir: "/in" }),
    copyLocalOverlay: (name) => ({ filePath: `/ov/${name}`, title: "a" }),
  });
  await createSheetRunner(deps).runNow();
  assert.equal(calls.errors.length, 0); // proxy "bad" KHÔNG làm kênh local dừng
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `node --test tests/sheet-runner.test.js`
Expected: FAIL — nhánh local chưa có: hoặc gọi `downloader` (không phải `copyLocalOverlay`), hoặc proxy "bad" ném lỗi làm `calls.errors` > 0.

- [ ] **Step 3: Bỏ qua kiểm proxy khi local**

Sửa khối proxy (dòng 80-88). Đổi điều kiện `if`:

```js
      let proxy = "";
      if (ch.videoSource !== "local" && String(ch.proxy ?? "").trim()) {
        try {
          proxy = normalizeProxy(ch.proxy);
        } catch (err) {
          emit({ type: "error", channel: ch.sheetName, message: String(err?.message || err) });
          return;
        }
      }
```

- [ ] **Step 4: Rẽ nhánh bước download**

Sửa khối bên trong `if (action === "render-only") { ... } else { ... }` — cụ thể nhánh `else` (dòng 185-200). Thay phần lấy `dl` bằng rẽ nhánh theo `videoSource`:

```js
          } else if (ch.videoSource === "local") {
            emit({ type: "channel-status", channel: ch.sheetName, status: "đang lấy file", url: item.url });
            dl = copyLocalOverlay(item.url, inputsDir, overlaysDir);
            patchEntry(ch.sheetName, item.url, { stage: "downloaded", filePath: dl.filePath, title: dl.title });
            await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, ST.DOWNLOADED);
          } else {
            emit({ type: "channel-status", channel: ch.sheetName, status: "đang tải", url: item.url });
            dl = await downloadLimit(async () => {
              if (!firstDownload) {
                const delay = pickDownloadDelay(config, rand);
                if (delay > 0 && sleep) {
                  emit({ type: "channel-status", channel: ch.sheetName, status: `chờ ${Math.round(delay / 1000)}s trước khi tải`, url: item.url });
                  await sleep(delay);
                }
              }
              firstDownload = false;
              return downloader(item.url, overlaysDir, { proxy });
            });
            patchEntry(ch.sheetName, item.url, { stage: "downloaded", filePath: dl.filePath, title: dl.title });
            await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, ST.DOWNLOADED);
          }
```

Lưu ý: khối `patchEntry(...)` + `setUrlStatus(...DOWNLOADED)` sau `dl = await downloadLimit(...)` gốc (2 dòng ngay dưới nó) đã được gộp vào cả hai nhánh ở trên — **xóa 2 dòng gốc đó** để không chạy hai lần.

- [ ] **Step 5: Chạy test, xác nhận PASS**

Run: `node --test tests/sheet-runner.test.js`
Expected: PASS toàn bộ.

- [ ] **Step 6: Chạy toàn bộ test suite**

Run: `npm test`
Expected: PASS toàn bộ — không hồi quy.

- [ ] **Step 7: Commit**

```bash
git add sheet/sheet-runner.js tests/sheet-runner.test.js
git commit -m "feat(sheet): kênh local copy overlay từ inputs/, bỏ proxy/delay"
```

---

## Task 5: Nối dây trong Electron (`electron-main.js`)

**Files:**
- Modify: `electron-main.js:20` (import), `electron-main.js:1404-1423` (wiring deps)

**Interfaces:**
- Consumes: `copyLocalOverlay` (Task 2), `appendUrls` (đã import sẵn tại `electron-main.js:12`), `parseConfigRows.videoSource` (Task 1).
- Produces: runner thật nhận `inputsDir`, `copyLocalOverlay`, `listLocalInputs`, `sheetsApi.appendUrls`.

- [ ] **Step 1: Import `copyLocalOverlay`**

Sửa `electron-main.js:20`:

```js
import { downloadOne, copyLocalOverlay } from "./sheet/channel-download.js";
```

- [ ] **Step 2: Thêm `appendUrls` vào `sheetsApi`**

Trong khối `sheetsApi: { ... }` (dòng 1404-1409), thêm:

```js
    sheetsApi: {
      readConfigSheet: () => readConfigSheet(sheets, s.spreadsheetId),
      readChannelUrls: (name) => readChannelUrls(sheets, s.spreadsheetId, name),
      setUrlStatus: (name, row, status) => setUrlStatus(sheets, s.spreadsheetId, name, row, status),
      setUploadStatus: (name, row, status) => setUploadStatus(sheets, s.spreadsheetId, name, row, status),
      appendUrls: (name, urls) => appendUrls(sheets, s.spreadsheetId, name, urls),
    },
```

- [ ] **Step 3: Tiêm `copyLocalOverlay` + `listLocalInputs`**

Ngay sau dòng `downloader:` (dòng 1410), thêm:

```js
    downloader: (url, dir, opts) => downloadOne(url, dir, { ...opts, ytdlpPath: YTDLP_PATH }),
    copyLocalOverlay,
    listLocalInputs: (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".mp4")).sort() : []),
```

- [ ] **Step 4: `ensureDirs` trả thêm `inputsDir` và tạo folder**

Sửa khối `ensureDirs` (dòng 1415-1423):

```js
    ensureDirs: (root) => {
      const dirs = {
        backgroundsDir: path.join(root, "backgrounds"),
        overlaysDir: path.join(root, "overlays"),
        outputDir: path.join(root, "output"),
        inputsDir: path.join(root, "inputs"),
      };
      for (const d of [dirs.overlaysDir, dirs.outputDir, dirs.inputsDir]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      return dirs;
    },
```

- [ ] **Step 5: Kiểm tra cú pháp (ESM parse, không resolve import)**

Run: `node --check electron-main.js`
Expected: không in gì, exit 0 (cú pháp hợp lệ).

- [ ] **Step 6: Chạy toàn bộ test suite**

Run: `npm test`
Expected: PASS toàn bộ.

- [ ] **Step 7: Commit**

```bash
git add electron-main.js
git commit -m "feat(app): nối dây nguồn video local vào runner (inputs/, copyLocalOverlay, appendUrls)"
```

---

## Xác minh thủ công (sau khi xong 5 task)

Không tự động hoá được vì cần Sheet + file thật:

1. Trong `⚙config`, thêm cột "Nguồn video", đặt một kênh = `tại máy`.
2. Tạo `channelsRoot/<kênh>/backgrounds/*.mp4` và thả vài `.mp4` vào `channelsRoot/<kênh>/inputs/`.
3. Mở app, chạy kênh đó. Kỳ vọng:
   - Tab kênh tự xuất hiện các dòng tên file ở cột A.
   - Cột B chuyển `đã tải` → `done`; cột C `✅ lên lịch` (nếu bật GPM + có giờ đăng).
   - File gốc trong `inputs/` còn nguyên; `overlays/` có bản copy (bị xoá sau render).
   - Kênh `tải` khác chạy y như trước, không đổi.

---

## Self-Review

**Spec coverage:**
- Cột "Nguồn video" → Task 1. ✓
- Thư mục `inputs/` + `ensureDirs` → Task 5 Step 4. ✓
- Auto-sync inputs→Sheet (không gõ tay) → Task 3. ✓
- Copy overlay từ inputs/ + thumbnail sibling → Task 2 + Task 4. ✓
- Bỏ proxy/delay cho local → Task 4. ✓
- Retry render (cột B) / upload (cột C) / slot lịch dùng chung — không cần task (dùng nguyên code hiện có; test hồi quy ở Task 4 Step 6 & Task 5 Step 6). ✓
- Kiểm thử `parseConfigRows`, `copyLocalOverlay`, `runChannel` local → Task 1/2/3/4. ✓

**Placeholder scan:** không có TBD/TODO; mọi step có code hoặc lệnh cụ thể. ✓

**Type consistency:** `copyLocalOverlay(fileName, inputsDir, overlaysDir) → { filePath, title }` nhất quán giữa Task 2 (định nghĩa), Task 3 (destructure dep), Task 4 (gọi), Task 5 (tiêm). `sheetsApi.appendUrls(name, urls)` nhất quán Task 3 (gọi) ↔ Task 5 (wire) ↔ `sheets-service.appendUrls(sheets, id, name, urls)`. `videoSource` giá trị `"local"|"download"` nhất quán Task 1 (sinh) ↔ Task 3/4 (đọc). ✓
