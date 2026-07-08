# chromaKeyAuto + app-level GPU/videoSpeed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm chế độ render `chromaKeyAuto` (tự dò màu chroma key per-video từ palette) cho hệ Theo dõi Sheet, và đưa `useGPU`/`videoSpeed` thành cấu hình toàn cục ở giao diện app.

**Architecture:** Tách logic dò màu cũ (`get-video-chroma.js`: frame đầu → RGB trung bình → màu palette gần nhất) thành module `sheet/chroma-detect.js` dùng lại cho một video, inject vào `sheet-runner` qua deps. `useGPU`/`videoSpeed` đọc từ `sheet-settings.json` (giao diện app), truyền qua `config` của runner xuống `renderOne`.

**Tech Stack:** Node ESM, `node:test`, `sharp` (^0.33.5, đã có trong deps), `fluent-ffmpeg`/ffmpeg qua `resolveFfmpegPaths()`, Electron IPC.

## Global Constraints

- ESM only (`package.json` `type: module`) — dùng `import`/`export`, không `require`.
- Test runner: `node --test 'tests/*.test.js'`. Test dùng `import { test } from "node:test"` + `import assert from "node:assert/strict"`.
- Dependency injection: hàm nhận IO (spawn/sharp/renderer/detectChroma) qua tham số/`deps` để test không đụng ffmpeg thật.
- Mã hex lưu **không** có dấu `#`, uppercase.
- Không phá vỡ chữ ký `parseConfigRows` hiện có: chỉ thêm khoá `chromaPalette` vào object **khi** cột có giá trị (giữ `deepEqual` cũ pass).
- Fallback an toàn: `chromaKeyAuto` thiếu palette hoặc `detectChroma` lỗi → dùng `chromaColor` cố định, không làm hỏng lượt render.

---

### Task 1: Module `sheet/chroma-detect.js`

**Files:**
- Create: `sheet/chroma-detect.js`
- Test: `tests/chroma-detect.test.js`

**Interfaces:**
- Consumes: `resolveFfmpegPaths` từ `sheet/render-core.js` (chỉ dùng ở lớp wiring electron-main, không trong module này).
- Produces:
  - `hexToRgb(hex: string) → {r,g,b}`
  - `rgbToHex({r,g,b}) → string` (6 ký tự hoa, không `#`)
  - `mapToNearest(rgb: {r,g,b}, paletteHex: string[]) → string` (hex không `#`)
  - `extractFirstFrameBuffer(videoPath: string, ffmpegPath: string, { spawn }) → Promise<Buffer>`
  - `averageColor(buffer: Buffer, { sharp }) → Promise<{r,g,b}>`
  - `detectChromaColor(videoPath: string, paletteHex: string[], { ffmpegPath, spawn, sharp }) → Promise<string>` (hex không `#`)

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/chroma-detect.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hexToRgb, rgbToHex, mapToNearest, averageColor, detectChromaColor,
} from "../sheet/chroma-detect.js";

test("hexToRgb parses with and without #", () => {
  assert.deepEqual(hexToRgb("#FF8000"), { r: 255, g: 128, b: 0 });
  assert.deepEqual(hexToRgb("00FF10"), { r: 0, g: 255, b: 16 });
});

test("rgbToHex pads and uppercases without #", () => {
  assert.equal(rgbToHex({ r: 0, g: 255, b: 16 }), "00FF10");
});

test("mapToNearest picks closest palette color by RGB distance", () => {
  const palette = ["22BDD6", "2B4052", "7FBFDE", "7097B8"];
  // gần 2B4052 (tối) nhất
  assert.equal(mapToNearest({ r: 40, g: 62, b: 80 }, palette), "2B4052");
  // gần 22BDD6 (xanh sáng) nhất
  assert.equal(mapToNearest({ r: 34, g: 189, b: 210 }, palette), "22BDD6");
});

test("averageColor computes mean RGB from injected sharp", async () => {
  // fake sharp: 4 pixel, RGB tăng dần, trung bình = (2, 3, 4)... dùng số tròn
  const fakeSharp = () => ({
    resize: () => ({ removeAlpha: () => ({ raw: () => ({
      toBuffer: async () => ({
        data: Buffer.from([0, 0, 0, 4, 6, 8]), // 2 pixel: (0,0,0) & (4,6,8)
        info: { width: 2, height: 1, channels: 3 },
      }),
    }) }) }),
  });
  const avg = await averageColor(Buffer.from([]), { sharp: fakeSharp });
  assert.deepEqual(avg, { r: 2, g: 3, b: 4 });
});

test("detectChromaColor maps a frame's average color to nearest palette", async () => {
  const fakeSpawn = () => {
    const handlers = {};
    const proc = {
      stdout: { on: (ev, cb) => { if (ev === "data") cb(Buffer.from([1])); } },
      stderr: { on: () => {} },
      on: (ev, cb) => { handlers[ev] = cb; if (ev === "close") cb(0); },
    };
    return proc;
  };
  const fakeSharp = () => ({
    resize: () => ({ removeAlpha: () => ({ raw: () => ({
      toBuffer: async () => ({ data: Buffer.from([40, 62, 80]), info: { width: 1, height: 1, channels: 3 } }),
    }) }) }),
  });
  const hex = await detectChromaColor("/v.mp4", ["22BDD6", "2B4052"], {
    ffmpegPath: "ffmpeg", spawn: fakeSpawn, sharp: fakeSharp,
  });
  assert.equal(hex, "2B4052");
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `node --test tests/chroma-detect.test.js`
Expected: FAIL — `Cannot find module '../sheet/chroma-detect.js'`.

- [ ] **Step 3: Viết module tối thiểu**

Tạo `sheet/chroma-detect.js`:

```js
export function hexToRgb(hex) {
  const num = parseInt(String(hex).replace("#", ""), 16);
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

export function rgbToHex({ r, g, b }) {
  return [r, g, b]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function distanceSq(a, b) {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

export function mapToNearest(rgb, paletteHex) {
  const palette = paletteHex.map((hex) => ({ hex: hex.replace("#", "").toUpperCase(), rgb: hexToRgb(hex) }));
  let best = palette[0];
  let bestDist = distanceSq(rgb, best.rgb);
  for (let i = 1; i < palette.length; i++) {
    const d = distanceSq(rgb, palette[i].rgb);
    if (d < bestDist) { best = palette[i]; bestDist = d; }
  }
  return best.hex;
}

export function extractFirstFrameBuffer(videoPath, ffmpegPath, { spawn }) {
  return new Promise((resolve, reject) => {
    const args = ["-ss", "0", "-i", videoPath, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"];
    const ff = spawn(ffmpegPath, args);
    const chunks = [];
    let stderr = "";
    ff.stdout.on("data", (d) => chunks.push(d));
    ff.stderr.on("data", (d) => { stderr += d.toString(); });
    ff.on("error", (e) => reject(e));
    ff.on("close", (code) => {
      if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exit ${code} khi trích frame ${videoPath}: ${stderr}`));
    });
  });
}

export async function averageColor(buffer, { sharp }) {
  const { data, info } = await sharp(buffer)
    .resize(64, 64, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let rSum = 0, gSum = 0, bSum = 0;
  const total = width * height;
  for (let i = 0; i < data.length; i += channels) {
    rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2];
  }
  return { r: Math.round(rSum / total), g: Math.round(gSum / total), b: Math.round(bSum / total) };
}

export async function detectChromaColor(videoPath, paletteHex, { ffmpegPath, spawn, sharp }) {
  if (!paletteHex || !paletteHex.length) throw new Error("chromaPalette rỗng");
  const buf = await extractFirstFrameBuffer(videoPath, ffmpegPath, { spawn });
  const avg = await averageColor(buf, { sharp });
  return mapToNearest(avg, paletteHex);
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --test tests/chroma-detect.test.js`
Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add sheet/chroma-detect.js tests/chroma-detect.test.js
git commit -m "feat(sheet): chroma-detect module (avg color -> nearest palette)"
```

---

### Task 2: Parse cột `chromaPalette` trong `parseConfigRows`

**Files:**
- Modify: `sheet/sheets-service.js` (hàm `parseConfigRows`, khoảng dòng 45-53)
- Test: `tests/sheets-service.test.js`

**Interfaces:**
- Consumes: —
- Produces: object kênh có thêm khoá `chromaPalette: string[]` **chỉ khi** cột `chromaPalette` có ≥1 hex hợp lệ; ngược lại không có khoá này.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `tests/sheets-service.test.js`:

```js
test("parseConfigRows parses chromaPalette and chromaKeyAuto mode", () => {
  const header = ["sheetName","enabled","videosPerDay","renderMode","chromaPalette"];
  const rows = [header,
    ["Kênh A","","5","chromaKeyAuto","22BDD6, 2b4052 , zzz, 7097B8"],
    ["Kênh B","","5","chromaKey",""],
  ];
  const out = parseConfigRows(rows);
  assert.equal(out[0].renderMode, "chromaKeyAuto");
  assert.deepEqual(out[0].chromaPalette, ["22BDD6", "2B4052", "7097B8"]); // bỏ 'zzz', uppercase, trim
  assert.equal("chromaPalette" in out[1], false); // trống -> không có khoá
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `node --test tests/sheets-service.test.js`
Expected: FAIL — `out[0].chromaPalette` là `undefined`.

- [ ] **Step 3: Sửa `parseConfigRows`**

Trong `sheet/sheets-service.js`, ngay trước `out.push({ ... })` (sau khối `cropYOffset`), thêm:

```js
    const paletteRaw = col(row, "chromaPalette");
    const chromaPalette = paletteRaw
      .split(",")
      .map((p) => p.trim().replace("#", "").toUpperCase())
      .filter((p) => /^[0-9A-F]{6}$/.test(p));
```

Rồi sửa object push để thêm palette có điều kiện:

```js
    const channel = {
      sheetName,
      enabled: truthy(col(row, "enabled")),
      videosPerDay: num(col(row, "videosPerDay")) || 0,
      renderMode: col(row, "renderMode") || "topTransparent",
      cfg,
      proxy: col(row, "proxy"),
    };
    if (chromaPalette.length) channel.chromaPalette = chromaPalette;
    out.push(channel);
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --test tests/sheets-service.test.js`
Expected: PASS (test mới + các test cũ vẫn xanh, gồm `deepEqual(out[0], {...})` không có `chromaPalette`).

- [ ] **Step 5: Commit**

```bash
git add sheet/sheets-service.js tests/sheets-service.test.js
git commit -m "feat(sheet): parse chromaPalette column for chromaKeyAuto"
```

---

### Task 3: `render-core` hỗ trợ `chromaKeyAuto`

**Files:**
- Modify: `sheet/render-core.js` (`buildComplexFilter`, dòng 115-124)
- Test: `tests/render-core.test.js`

**Interfaces:**
- Consumes: `cfg.chromaColor` (đã được runner gán = màu dò được).
- Produces: `buildComplexFilter("chromaKeyAuto", cfg)` trả về đúng filter như `chromaKey(cfg)`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `tests/render-core.test.js`:

```js
test("chromaKeyAuto uses same filter as chromaKey (color already resolved)", () => {
  const cfg = { chromaColor: "2B4052", chromaSimilarity: 0.3 };
  const auto = buildComplexFilter("chromaKeyAuto", cfg);
  const manual = buildComplexFilter("chromaKey", cfg);
  assert.deepEqual(auto, manual);
  assert.match(auto.join("|"), /colorkey=0x2B4052:0\.3:0\.1/);
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `node --test tests/render-core.test.js`
Expected: FAIL — `chromaKeyAuto` rơi vào default `topTransparent`, khác `chromaKey`.

- [ ] **Step 3: Sửa `buildComplexFilter`**

Trong `sheet/render-core.js`, thêm `case "chromaKeyAuto"` vào `switch`:

```js
  switch (renderMode) {
    case "chromaKeyAuto":
    case "chromaKey": return chromaKey(cfg);
    case "crop": return crop(cfg);
    case "keepColor": return keepColor(cfg);
    case "topTransparent":
    default: return topTransparent(cfg);
  }
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --test tests/render-core.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sheet/render-core.js tests/render-core.test.js
git commit -m "feat(sheet): render-core chromaKeyAuto reuses chromaKey filter"
```

---

### Task 4: `sheet-runner` — detectChroma + videoSpeed/useGPU từ config

**Files:**
- Modify: `sheet/sheet-runner.js` (`createSheetRunner` deps destructure + `runChannel` render call, dòng 9-13 và 37-55)
- Test: `tests/sheet-runner.test.js`

**Interfaces:**
- Consumes:
  - `deps.detectChroma(videoPath: string, paletteHex: string[]) → Promise<string>` (hex không `#`)
  - `config.videoSpeed?: number`, `config.useGPU?: boolean`, `config.gpuVideoCodec?: string`
  - kênh có thể có `ch.chromaPalette?: string[]`
- Produces: gọi `renderer({ overlayFile, backgroundFile, outputPath, renderMode, cfg, useGPU, gpuVideoCodec })` với `cfg.videoSpeed` = `config.videoSpeed` (nếu có) và `cfg.chromaColor` = màu dò được khi `chromaKeyAuto`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `tests/sheet-runner.test.js` (makeDeps đã có sẵn; override từng test):

```js
test("chromaKeyAuto: detectChroma sets cfg.chromaColor and gpu/speed pass through", async () => {
  const detectCalls = [];
  const renderCalls = [];
  const { deps } = makeDeps({
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/s.json", renderConcurrency: 2,
      videoSpeed: 0.8, useGPU: true, gpuVideoCodec: "h264_nvenc" },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 1, renderMode: "chromaKeyAuto",
          cfg: { chromaColor: "FALLBACK", chromaSimilarity: 0.3 }, chromaPalette: ["22BDD6","2B4052"], proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "" }],
      setUrlStatus: async () => {},
    },
    detectChroma: async (videoPath, palette) => { detectCalls.push({ videoPath, palette }); return "2B4052"; },
    renderer: async (opts) => { renderCalls.push(opts); return { outputPath: opts.outputPath }; },
  });
  await createSheetRunner(deps).runNow();
  assert.equal(detectCalls.length, 1);
  assert.deepEqual(detectCalls[0].palette, ["22BDD6","2B4052"]);
  assert.equal(renderCalls[0].cfg.chromaColor, "2B4052");   // dò được, không phải FALLBACK
  assert.equal(renderCalls[0].cfg.videoSpeed, 0.8);          // từ config
  assert.equal(renderCalls[0].useGPU, true);
  assert.equal(renderCalls[0].gpuVideoCodec, "h264_nvenc");
});

test("chromaKeyAuto without palette falls back to cfg.chromaColor, no detectChroma call", async () => {
  const detectCalls = [];
  const renderCalls = [];
  const { deps } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 1, renderMode: "chromaKeyAuto",
          cfg: { chromaColor: "FALLBACK" }, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "" }],
      setUrlStatus: async () => {},
    },
    detectChroma: async () => { detectCalls.push(1); return "XXX"; },
    renderer: async (opts) => { renderCalls.push(opts); return { outputPath: opts.outputPath }; },
  });
  await createSheetRunner(deps).runNow();
  assert.equal(detectCalls.length, 0);
  assert.equal(renderCalls[0].cfg.chromaColor, "FALLBACK");
});
```

Cập nhật `makeDeps` mặc định: thêm `detectChroma: async () => "000000"` vào object `deps` (để test cũ không lỗi khi runner gọi — thực tế chỉ gọi khi chromaKeyAuto, nhưng thêm cho an toàn).

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `node --test tests/sheet-runner.test.js`
Expected: FAIL — `renderCalls[0].cfg.chromaColor` là `"FALLBACK"` (chưa dò), `useGPU`/`videoSpeed` `undefined`.

- [ ] **Step 3: Sửa `sheet-runner.js`**

3a. Trong destructure deps (dòng 10-13), thêm `detectChroma`:

```js
  const {
    config, sheetsApi, downloader, renderer, listBackgrounds,
    ensureDirs, stateStore, emit, now, pLimitFn, rand, unlink, detectChroma,
  } = deps;
```

3b. Trong `runChannel`, thay khối tính `bg`/`outputPath`/gọi `renderer` (dòng 41-47) bằng:

```js
          const bg = pickRandomBackground(backgrounds, rand);
          const outputPath = path.join(outputDir, `${dl.title}.mp4`);
          const cfg = { ...ch.cfg };
          if (config.videoSpeed != null) cfg.videoSpeed = config.videoSpeed;
          if (ch.renderMode === "chromaKeyAuto" && ch.chromaPalette?.length) {
            try {
              cfg.chromaColor = await detectChroma(dl.filePath, ch.chromaPalette);
            } catch (err) {
              emit({ type: "log", message: `Dò màu thất bại (${ch.sheetName}), dùng chromaColor cố định: ${String(err?.message || err).slice(0, 120)}` });
            }
          }
          emit({ type: "channel-status", channel: ch.sheetName, status: "đang render", url: item.url });
          await renderer({
            overlayFile: dl.filePath, backgroundFile: path.join(backgroundsDir, bg),
            outputPath, renderMode: ch.renderMode, cfg,
            useGPU: config.useGPU, gpuVideoCodec: config.gpuVideoCodec,
          });
```

(Xoá dòng `emit(... "đang render" ...)` và lệnh `renderer({...})` cũ ở vị trí trước đó để không lặp.)

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --test tests/sheet-runner.test.js`
Expected: PASS (2 test mới + các test cũ vẫn xanh).

- [ ] **Step 5: Commit**

```bash
git add sheet/sheet-runner.js tests/sheet-runner.test.js
git commit -m "feat(sheet): runner detectChroma for chromaKeyAuto + gpu/videoSpeed from config"
```

---

### Task 5: Nối dây `electron-main.js` (settings + runner)

**Files:**
- Modify: `electron-main.js` (`loadSheetSettings` ~1333-1336, `buildSheetRunner` ~1342-1372)

**Interfaces:**
- Consumes: `detectChromaColor` từ `sheet/chroma-detect.js`; `resolveFfmpegPaths` từ `sheet/render-core.js`; `sharp`; `spawn` từ `child_process`.
- Produces: runner config có `useGPU`/`gpuVideoCodec`/`videoSpeed`; deps có `detectChroma`.

- [ ] **Step 1: Thêm import**

Ở đầu `electron-main.js`, cạnh các import sheet hiện có, thêm:

```js
import { spawn } from "child_process";
import sharp from "sharp";
import { detectChromaColor } from "./sheet/chroma-detect.js";
import { resolveFfmpegPaths } from "./sheet/render-core.js";
```

(Nếu `spawn`/`sharp`/`resolveFfmpegPaths` đã được import ở nơi khác trong file thì bỏ dòng trùng — kiểm tra bằng `grep -n "import.*spawn\|import sharp\|resolveFfmpegPaths\|createSheetsClient" electron-main.js` trước khi thêm.)

- [ ] **Step 2: Cập nhật default settings**

Sửa `loadSheetSettings` (dòng 1335) — nhánh catch trả object mặc định, thêm 3 khoá:

```js
  catch { return { spreadsheetId: "", credentialsPath: "", channelsRoot: "", pollSec: 300, autoRunOnOpen: false, useGPU: false, videoSpeed: 0.95, gpuVideoCodec: "h264_nvenc" }; }
```

- [ ] **Step 3: Cập nhật `buildSheetRunner`**

Sửa object `config` (dòng 1347) và thêm `detectChroma` vào deps:

```js
    config: {
      spreadsheetId: s.spreadsheetId, channelsRoot: s.channelsRoot, statePath, renderConcurrency: 2,
      useGPU: !!s.useGPU,
      gpuVideoCodec: s.gpuVideoCodec || "h264_nvenc",
      videoSpeed: (typeof s.videoSpeed === "number" && s.videoSpeed > 0) ? s.videoSpeed : 0.95,
    },
```

Thêm dòng deps (cạnh `renderer:`):

```js
    detectChroma: (videoPath, palette) =>
      detectChromaColor(videoPath, palette, { ffmpegPath: resolveFfmpegPaths().ffmpegPath, spawn, sharp }),
```

- [ ] **Step 4: Kiểm tra cú pháp**

Run: `node --check electron-main.js`
Expected: không in gì (cú pháp hợp lệ).

- [ ] **Step 5: Chạy toàn bộ test**

Run: `npm test`
Expected: tất cả test PASS (không có regression).

- [ ] **Step 6: Commit**

```bash
git add electron-main.js
git commit -m "feat(sheet): wire detectChroma + useGPU/videoSpeed into sheet runner"
```

---

### Task 6: UI — checkbox GPU + ô videoSpeed (tab Theo dõi Sheet)

**Files:**
- Modify: `renderer.html` (form tab `#sheet-watch`, sau ô Poll ~dòng 3743-3745)
- Modify: `renderer.js` (`loadSettings` ~4145-4152, `currentSettings` ~4153-4161)

**Interfaces:**
- Consumes: `sheet:load-settings` trả `useGPU`/`videoSpeed`.
- Produces: `sheet:save-settings` nhận thêm `useGPU: boolean`, `videoSpeed: number`.

- [ ] **Step 1: Thêm control vào `renderer.html`**

Ngay sau `form-group` chứa `sw-poll` (trước `form-group` của `sw-auto-open`), chèn:

```html
          <div class="form-group">
            <label>Tốc độ video (videoSpeed)</label>
            <input id="sw-video-speed" type="number" step="0.01" min="0.1" value="0.95" style="width:100px">
          </div>
          <div class="form-group">
            <label style="display:flex;align-items:center;gap:8px;font-weight:normal;">
              <input id="sw-use-gpu" type="checkbox"> Dùng GPU (NVENC)
            </label>
          </div>
```

- [ ] **Step 2: Đổ giá trị khi load — `renderer.js` `loadSettings`**

Thêm vào cuối hàm `loadSettings` (sau dòng `sw-auto-open`):

```js
    $("sw-video-speed").value = (typeof s.videoSpeed === "number" && s.videoSpeed > 0) ? s.videoSpeed : 0.95;
    $("sw-use-gpu").checked = !!s.useGPU;
```

- [ ] **Step 3: Đọc giá trị khi save — `renderer.js` `currentSettings`**

Thêm 2 khoá vào object return của `currentSettings`:

```js
      videoSpeed: parseFloat($("sw-video-speed").value) > 0 ? parseFloat($("sw-video-speed").value) : 0.95,
      useGPU: $("sw-use-gpu").checked,
```

- [ ] **Step 4: Kiểm tra thủ công**

Run: `npm start` (hoặc lệnh khởi động Electron của dự án).
Kiểm tra: tab "Theo dõi Sheet" hiển thị ô "Tốc độ video" + checkbox "Dùng GPU (NVENC)". Bấm "Lưu cấu hình", mở lại app → giá trị được giữ (đọc `sheet-settings.json` để xác nhận `useGPU`/`videoSpeed` đã ghi).

- [ ] **Step 5: Commit**

```bash
git add renderer.html renderer.js
git commit -m "feat(sheet): UI GPU checkbox + videoSpeed input for sheet watch"
```

---

## Self-Review

**Spec coverage:**
- App-level `useGPU`/`videoSpeed` → Task 5 (settings/wiring) + Task 6 (UI). ✅
- Sheet `chromaKeyAuto` + `chromaPalette` → Task 2 (parse) + Task 3 (filter) + Task 4 (detect/apply). ✅
- Module `chroma-detect` từ logic `get-video-chroma.js` → Task 1. ✅
- Fallback thiếu palette / lỗi dò → Task 4 (try/catch + nhánh no-palette). ✅
- `gpuVideoCodec` mặc định `h264_nvenc`, không thêm ô UI → Task 5. ✅
- Test: chroma-detect (T1), parseConfigRows (T2), render-core (T3), sheet-runner (T4). ✅

**Placeholder scan:** không có TBD/TODO; mọi step có code/lệnh cụ thể. ✅

**Type consistency:** `detectChroma(videoPath, paletteHex)` dùng nhất quán ở Task 1 (`detectChromaColor`), Task 4 (deps.detectChroma), Task 5 (wiring). `chromaPalette: string[]` nhất quán Task 2↔4. `config.videoSpeed/useGPU/gpuVideoCodec` nhất quán Task 4↔5. Hex không `#`, uppercase — nhất quán. ✅

**Rủi ro đã lưu ý:** `sharp` đã có trong deps (^0.33.5) — xác nhận ở Task 1. `useGPU` cần máy có NVENC; lỗi render đã được per-video try/catch ghi `error:` vào Sheet (hành vi sẵn có).
