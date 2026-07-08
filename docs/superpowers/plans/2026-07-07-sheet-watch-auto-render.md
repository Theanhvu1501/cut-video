# Tab "Theo dõi Sheet" — Auto Download + Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm 1 tab trong vid-master theo dõi 1 Google Sheet đa kênh, tự động tải N video/ngày/kênh và render (overlay composite) dùng lại engine `render.js`.

**Architecture:** Một module subsystem mới trong `sheet/` (parsers Google Sheet, lõi render trích từ `render.js`, wrapper download, orchestrator quota/ngày với dependency injection). Wiring qua IPC (`electron-main.js` + `preload.cjs`) và UI tab mới (`renderer.html` + `renderer.js`). Không sửa hành vi `render.js`/`download.js` gốc.

**Tech Stack:** Node.js ESM, Electron, `fluent-ffmpeg`, `youtube-dl-exec`, `googleapis`, `p-limit` (đều đã có trong `package.json`). Test bằng `node --test` (built-in, không thêm dep).

## Global Constants

Copy verbatim từ spec + code gốc — mọi task ngầm áp dụng:

- **Render dims:** `1280x720`. **FPS:** `FIXED_FPS = 30`. **GOP:** `FIXED_GOP = 60`. **Audio:** `AUDIO_FREQ = 44100`, 2 channels, codec `aac`. **CRF/CQ:** `VIDEO_QUALITY = 23`. **videoSpeed default:** `0.95`.
- **Render modes:** `topTransparent` | `chromaKey` | `crop` | `keepColor`. Mode không hợp lệ → fallback `topTransparent`.
- **Sheet config tab name:** `⚙config` (đọc từ dòng 2). **URL sub-sheet:** cột `A` = URL, cột `B` = status (`""`=chưa xử lý, `done`, `error: <lý do>`).
- **Folder convention:** `<channels-root>/<sheetName>/{backgrounds,overlays,output}`. `backgrounds/` phải có ≥1 `.mp4`.
- **Nền tảng chạy thật:** Windows (binary `bin/yt-dlp.exe`, `bin/ffmpeg.exe`, `bin/ffprobe.exe`). Dev/máy hiện tại là macOS → **download & render integration test chạy tay trên Windows**; unit test (logic thuần) chạy mọi nơi.
- **Google auth:** service account JSON, scope `https://www.googleapis.com/auth/spreadsheets`.
- **Concurrency:** render limit mặc định `2`, download limit mặc định `3`.
- **Ngôn ngữ UI/log:** tiếng Việt (theo codebase).

---

## File Structure

**Tạo mới (subsystem `sheet/`):**
- `sheet/render-core.js` — `buildComplexFilter(renderMode, cfg)` (thuần) + `renderOne(opts)` (ffmpeg wrapper). Trích từ `render.js`.
- `sheet/runner-state.js` — helper quota/ngày thuần + load/save `runner-state.json`.
- `sheet/sheets-service.js` — parser thuần (`parseConfigRows`, `parseUrlRows`) + client Google + I/O.
- `sheet/channel-download.js` — `downloadOne(url, dir, opts)` wrap `youtube-dl-exec`.
- `sheet/sheet-runner.js` — `createSheetRunner(deps)` orchestrator (DI, phát event).

**Test mới (`tests/`):**
- `tests/render-core.test.js`, `tests/runner-state.test.js`, `tests/sheets-service.test.js`, `tests/sheet-runner.test.js`.

**Sửa:**
- `package.json` — thêm script `test`.
- `electron-main.js` — IPC handlers + khởi tạo runner + auto-run khi mở app.
- `preload.cjs` — expose API sheet-watch.
- `renderer.html` — nút tab + panel tab.
- `renderer.js` — logic tab (form kết nối, bảng trạng thái, log).

---

## Task 1: Test infra + runner-state (quota/ngày + state I/O)

**Files:**
- Modify: `package.json` (thêm `scripts.test`)
- Create: `sheet/runner-state.js`
- Test: `tests/runner-state.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `todayStr(now = new Date()): string` — `"YYYY-MM-DD"` theo giờ local.
  - `shouldResetQuota(channelState, today): boolean`
  - `computeRemaining(channelState, videosPerDay, today): number` (≥0)
  - `recordRendered(state, sheetName, today): void` — mutate: reset nếu ngày mới, `countToday++`, set `lastRunDate`.
  - `loadState(statePath): object` — `{}` nếu thiếu/hỏng.
  - `saveState(statePath, state): void`

- [ ] **Step 1: Add test script to package.json**

Sửa `package.json`, thay dòng `"test": "echo \"Error: no test specified\" && exit 1"` thành:

```json
    "test": "node --test tests/"
```

- [ ] **Step 2: Write the failing test**

Create `tests/runner-state.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  todayStr, shouldResetQuota, computeRemaining, recordRendered,
  loadState, saveState,
} from "../sheet/runner-state.js";

test("todayStr formats local date as YYYY-MM-DD", () => {
  const d = new Date(2026, 6, 7, 15, 30); // 2026-07-07 local
  assert.equal(todayStr(d), "2026-07-07");
});

test("shouldResetQuota true when no state or different day", () => {
  assert.equal(shouldResetQuota(undefined, "2026-07-07"), true);
  assert.equal(shouldResetQuota({ lastRunDate: "2026-07-06", countToday: 3 }, "2026-07-07"), true);
  assert.equal(shouldResetQuota({ lastRunDate: "2026-07-07", countToday: 3 }, "2026-07-07"), false);
});

test("computeRemaining resets on new day, clamps at 0", () => {
  assert.equal(computeRemaining(undefined, 3, "2026-07-07"), 3);
  assert.equal(computeRemaining({ lastRunDate: "2026-07-06", countToday: 5 }, 3, "2026-07-07"), 3);
  assert.equal(computeRemaining({ lastRunDate: "2026-07-07", countToday: 2 }, 3, "2026-07-07"), 1);
  assert.equal(computeRemaining({ lastRunDate: "2026-07-07", countToday: 5 }, 3, "2026-07-07"), 0);
});

test("recordRendered resets on new day then increments", () => {
  const state = { "Kênh A": { lastRunDate: "2026-07-06", countToday: 5 } };
  recordRendered(state, "Kênh A", "2026-07-07");
  assert.deepEqual(state["Kênh A"], { lastRunDate: "2026-07-07", countToday: 1 });
  recordRendered(state, "Kênh A", "2026-07-07");
  assert.equal(state["Kênh A"].countToday, 2);
  recordRendered(state, "Kênh B", "2026-07-07");
  assert.deepEqual(state["Kênh B"], { lastRunDate: "2026-07-07", countToday: 1 });
});

test("loadState returns {} when missing or corrupt, saveState round-trips", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-"));
  const p = path.join(dir, "runner-state.json");
  assert.deepEqual(loadState(p), {});
  fs.writeFileSync(p, "{ not json");
  assert.deepEqual(loadState(p), {});
  const state = { "Kênh A": { lastRunDate: "2026-07-07", countToday: 2 } };
  saveState(p, state);
  assert.deepEqual(loadState(p), state);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/runner-state.test.js`
Expected: FAIL — `Cannot find module '../sheet/runner-state.js'`.

- [ ] **Step 4: Write minimal implementation**

Create `sheet/runner-state.js`:

```js
import fs from "fs";
import path from "path";

export function todayStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shouldResetQuota(channelState, today) {
  if (!channelState) return true;
  return channelState.lastRunDate !== today;
}

export function computeRemaining(channelState, videosPerDay, today) {
  const n = parseInt(videosPerDay, 10) || 0;
  const count = shouldResetQuota(channelState, today) ? 0 : (channelState.countToday || 0);
  return Math.max(0, n - count);
}

export function recordRendered(state, sheetName, today) {
  const cur = state[sheetName];
  if (!cur || cur.lastRunDate !== today) {
    state[sheetName] = { lastRunDate: today, countToday: 1 };
  } else {
    cur.countToday = (cur.countToday || 0) + 1;
  }
}

export function loadState(statePath) {
  try {
    if (!fs.existsSync(statePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveState(statePath, state) {
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/runner-state.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json sheet/runner-state.js tests/runner-state.test.js
git commit -m "feat(sheet): quota/state helpers + node:test infra"
```

---

## Task 2: render-core — buildComplexFilter (4 mode, thuần)

**Files:**
- Create: `sheet/render-core.js` (chỉ phần `buildComplexFilter` ở task này)
- Test: `tests/render-core.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `buildComplexFilter(renderMode, cfg): string[]` — trả mảng filter (kết thúc bằng `[combined_video]` và `[overlay_audio]`), CHƯA gồm setpts/atempo. `cfg` mặc định:
    `{ opacity:0.9, chromaColor:"D4F9D7", chromaSimilarity:0.3, keepColors:["FBFF02"], keepSimilarity:0.2, keepCrop:false, keepHeight:220, keepYOffset:490, keepAddDarkLayer:false, cropHeight:220, cropYOffset:490 }`.
  - `DEFAULT_RENDER_CFG` — object default trên.

- [ ] **Step 1: Write the failing test**

Create `tests/render-core.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComplexFilter } from "../sheet/render-core.js";

test("topTransparent uses opacity and overlay at 0:0", () => {
  const f = buildComplexFilter("topTransparent", { opacity: 0.7 });
  const joined = f.join("|");
  assert.match(joined, /colorchannelmixer=aa=0\.7\[top_video\]/);
  assert.ok(f.includes("[base_video][top_video]overlay=0:0[combined_video]"));
  assert.ok(f.includes("[1:a]volume=1.0[overlay_audio]"));
});

test("chromaKey embeds color + similarity, overlay at H-h", () => {
  const f = buildComplexFilter("chromaKey", { chromaColor: "D4F9D7", chromaSimilarity: 0.3 });
  assert.match(f.join("|"), /colorkey=0xD4F9D7:0\.3:0\.1,format=yuva420p\[overlay_video\]/);
  assert.ok(f.includes("[0:v][overlay_video]overlay=0:H-h[combined_video]"));
});

test("crop uses cropHeight/cropYOffset", () => {
  const f = buildComplexFilter("crop", { cropHeight: 150, cropYOffset: 550 });
  assert.match(f.join("|"), /crop=1280:150:0:550\[cropped\]/);
  assert.ok(f.includes("[0:v][overlay_video]overlay=0:H-h[combined_video]"));
});

test("keepColor builds per-color masks and alphamerge", () => {
  const f = buildComplexFilter("keepColor", { keepColors: ["F6FF00"], keepSimilarity: 0.2 });
  const joined = f.join("|");
  assert.match(joined, /colorkey=0xF6FF00:0\.2:0\.1,alphaextract,negate\[mask_0\]/);
  assert.match(joined, /\[src_main\]\[mask_0\]alphamerge\[final_isolated\]/);
});

test("invalid mode falls back to topTransparent", () => {
  const f = buildComplexFilter("nope", {});
  assert.ok(f.some((s) => s.includes("[base_video][top_video]overlay=0:0[combined_video]")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/render-core.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `sheet/render-core.js` (phần filter — port thuần từ `render.js`, dùng `cfg` thay biến global):

```js
export const DEFAULT_RENDER_CFG = {
  opacity: 0.9,
  chromaColor: "D4F9D7",
  chromaSimilarity: 0.3,
  keepColors: ["FBFF02"],
  keepSimilarity: 0.2,
  keepCrop: false,
  keepHeight: 220,
  keepYOffset: 490,
  keepAddDarkLayer: false,
  cropHeight: 220,
  cropYOffset: 490,
  videoSpeed: 0.95,
};

function topTransparent(cfg) {
  const filter = [
    `[0:v]scale=1280:720,format=yuva420p,colorchannelmixer=aa=${cfg.opacity}[top_video]`,
    "[1:v]scale=1280:720[base_video]",
  ];
  return [
    filter.join(";"),
    "[base_video][top_video]overlay=0:0[combined_video]",
    "[1:a]volume=1.0[overlay_audio]",
  ];
}

function chromaKey(cfg) {
  const color = String(cfg.chromaColor).replace("#", "");
  const filter = [
    `[1:v]scale=1280:720,colorkey=0x${color}:${cfg.chromaSimilarity}:0.1,format=yuva420p[overlay_video]`,
  ];
  return [
    filter.join(";"),
    "[0:v][overlay_video]overlay=0:H-h[combined_video]",
    "[1:a]volume=1.0[overlay_audio]",
  ];
}

function crop(cfg) {
  const filter = [
    `[1:v]scale=1280:720,crop=1280:${cfg.cropHeight}:0:${cfg.cropYOffset}[cropped]`,
    "[cropped]eq=brightness=-1.0:contrast=3.0:gamma=1.2:saturation=0[filtered]",
    "[filtered]format=yuva420p,colorchannelmixer=aa=0.8[overlay_video]",
  ];
  return [
    filter.join(";"),
    "[0:v][overlay_video]overlay=0:H-h[combined_video]",
    "[1:a]volume=1.0[overlay_audio]",
  ];
}

function keepColor(cfg) {
  const colors = (cfg.keepColors || []).map((c) => String(c).replace("#", "")).filter(Boolean);
  const count = colors.length;
  if (count === 0) {
    return [
      "[1:v]scale=1280:720[final_isolated]",
      "[0:v][final_isolated]overlay=0:H-h[combined_video]",
      "[1:a]volume=1.0[overlay_audio]",
    ];
  }
  const filters = [];
  let baseFilter = "[1:v]scale=1280:720";
  if (cfg.keepCrop) {
    baseFilter += `,crop=1280:${cfg.keepHeight || 720}:0:${cfg.keepYOffset || 0}`;
  }
  let splitOutputs = "[src_main]";
  for (let i = 0; i < count; i++) splitOutputs += `[src_${i}_detect]`;
  filters.push(`${baseFilter},split=${count + 1}${splitOutputs}`);

  const maskNames = [];
  const similarity = cfg.keepSimilarity || 0.1;
  colors.forEach((hex, index) => {
    filters.push(`[src_${index}_detect]colorkey=0x${hex}:${similarity}:0.1,alphaextract,negate[mask_${index}]`);
    maskNames.push(`[mask_${index}]`);
  });
  let currentMask = maskNames[0];
  for (let i = 1; i < maskNames.length; i++) {
    filters.push(`${currentMask}${maskNames[i]}blend=all_expr='max(A,B)'[combined_mask_${i}]`);
    currentMask = `[combined_mask_${i}]`;
  }
  filters.push(`[src_main]${currentMask}alphamerge[final_isolated]`);

  if (cfg.keepCrop && cfg.keepAddDarkLayer) {
    const h = cfg.keepHeight || 720;
    filters.push(
      `[1:v]scale=1280:720,crop=1280:${h}:0:${cfg.keepYOffset || 0},geq=r=0:g=0:b=0:a=300,format=yuva420p[black_layer]`,
      "[0:v][black_layer]overlay=0:H-h:shortest=1[bg_with_black]",
      "[bg_with_black][final_isolated]overlay=0:H-h:shortest=1[combined_video]",
    );
    return [filters.join(";"), "[1:a]volume=1.0[overlay_audio]"];
  }
  return [
    filters.join(";"),
    "[0:v][final_isolated]overlay=0:H-h:shortest=1[combined_video]",
    "[1:a]volume=1.0[overlay_audio]",
  ];
}

export function buildComplexFilter(renderMode, cfgIn = {}) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  switch (renderMode) {
    case "chromaKey": return chromaKey(cfg);
    case "crop": return crop(cfg);
    case "keepColor": return keepColor(cfg);
    case "topTransparent":
    default: return topTransparent(cfg);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/render-core.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add sheet/render-core.js tests/render-core.test.js
git commit -m "feat(sheet): buildComplexFilter — 4 render modes (pure, from render.js)"
```

---

## Task 3: render-core — renderOne (ffmpeg wrapper)

**Files:**
- Modify: `sheet/render-core.js` (thêm `renderOne` + resolve ffmpeg path)

**Interfaces:**
- Consumes: `buildComplexFilter` (Task 2)
- Produces:
  - `resolveFfmpegPaths(): { ffmpegPath, ffprobePath }` — dùng `bin/ffmpeg.exe`/`bin/ffprobe.exe` nếu tồn tại, else `@ffmpeg-installer/ffmpeg`.
  - `renderOne({ overlayFile, backgroundFile, outputPath, renderMode, cfg, useGPU=false, gpuVideoCodec="h264_nvenc", onProgress }): Promise<{ outputPath, durationSec }>`

**Note:** ffmpeg cần binary → **verify chạy tay trên Windows** (Task 11). Task này chỉ code + smoke test `resolveFfmpegPaths`.

- [ ] **Step 1: Add smoke test for resolveFfmpegPaths**

Thêm vào cuối `tests/render-core.test.js`:

```js
import { resolveFfmpegPaths } from "../sheet/render-core.js";

test("resolveFfmpegPaths returns string paths", () => {
  const { ffmpegPath, ffprobePath } = resolveFfmpegPaths();
  assert.equal(typeof ffmpegPath, "string");
  assert.equal(typeof ffprobePath, "string");
  assert.ok(ffmpegPath.length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/render-core.test.js`
Expected: FAIL — `resolveFfmpegPaths` is not exported.

- [ ] **Step 3: Implement renderOne + resolveFfmpegPaths**

Thêm đầu file `sheet/render-core.js` (imports) và cuối file (functions):

```js
// --- thêm vào ĐẦU file ---
import { path as installerFfmpeg } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

const FIXED_FPS = 30;
const FIXED_GOP = FIXED_FPS * 2;
const AUDIO_FREQ = 44100;
const VIDEO_QUALITY = 23;

export function resolveFfmpegPaths() {
  const binFfmpeg = path.join(REPO_ROOT, "bin", "ffmpeg.exe");
  const binFfprobe = path.join(REPO_ROOT, "bin", "ffprobe.exe");
  return {
    ffmpegPath: fs.existsSync(binFfmpeg) ? binFfmpeg : installerFfmpeg,
    ffprobePath: fs.existsSync(binFfprobe) ? binFfprobe : installerFfmpeg.replace("ffmpeg", "ffprobe"),
  };
}
```

```js
// --- thêm vào CUỐI file ---
export function renderOne({
  overlayFile, backgroundFile, outputPath,
  renderMode, cfg: cfgIn = {}, useGPU = false, gpuVideoCodec = "h264_nvenc",
  onProgress,
}) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  const { ffmpegPath, ffprobePath } = resolveFfmpegPaths();
  ffmpeg.setFfmpegPath(ffmpegPath);
  ffmpeg.setFfprobePath(ffprobePath);

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(overlayFile, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata.format.duration;
      const newDuration = duration / cfg.videoSpeed;

      const filterConfig = buildComplexFilter(renderMode, cfg);
      filterConfig.push(`[combined_video]setpts=PTS/${cfg.videoSpeed}[final_video_speed]`);
      filterConfig.push(`[overlay_audio]atempo=${cfg.videoSpeed}[final_audio_speed]`);

      const command = ffmpeg(backgroundFile)
        .inputOptions(["-stream_loop", "-1"])
        .input(overlayFile)
        .complexFilter(filterConfig)
        .outputOptions("-t", String(newDuration))
        .audioCodec("aac")
        .audioFrequency(AUDIO_FREQ)
        .audioChannels(2)
        .map("[final_video_speed]")
        .map("[final_audio_speed]");

      if (useGPU && gpuVideoCodec.includes("nvenc")) {
        command.videoCodec(gpuVideoCodec).outputOptions([
          "-pix_fmt yuv420p", `-r ${FIXED_FPS}`, `-g ${FIXED_GOP}`, `-keyint_min ${FIXED_GOP}`,
          "-sc_threshold 0", "-preset medium", `-cq:v ${VIDEO_QUALITY}`, "-rc:v vbr", "-movflags +faststart",
        ]);
      } else if (useGPU) {
        command.videoCodec(gpuVideoCodec).outputOptions(["-pix_fmt", "yuv420p", "-movflags", "+faststart"]);
      } else {
        command.videoCodec("libx264").outputOptions([
          "-preset ultrafast", "-pix_fmt yuv420p", `-r ${FIXED_FPS}`, `-g ${FIXED_GOP}`,
          `-keyint_min ${FIXED_GOP}`, "-sc_threshold 0", `-crf ${VIDEO_QUALITY}`, "-movflags +faststart",
        ]);
      }

      command
        .on("stderr", (line) => { if (onProgress) onProgress(line); })
        .on("end", () => resolve({ outputPath, durationSec: newDuration }))
        .on("error", (e) => reject(e))
        .save(outputPath);
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/render-core.test.js`
Expected: PASS (6 tests — filter tests + smoke test).

- [ ] **Step 5: Commit**

```bash
git add sheet/render-core.js tests/render-core.test.js
git commit -m "feat(sheet): renderOne ffmpeg wrapper + ffmpeg path resolver"
```

---

## Task 4: sheets-service — parsers thuần

**Files:**
- Create: `sheet/sheets-service.js` (chỉ parsers ở task này)
- Test: `tests/sheets-service.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `parseConfigRows(values): ChannelConfig[]` — `values` = 2D array (dòng 0 = header). Header khớp không phân biệt hoa/thường. `ChannelConfig = { sheetName, enabled, videosPerDay, renderMode, cfg, proxy }` với `cfg = { opacity, chromaColor, chromaSimilarity, keepColors, cropHeight, cropYOffset }` (chỉ set field có giá trị; số parse bằng `parseFloat`; `keepColors` split theo dấu phẩy). Bỏ dòng thiếu `sheetName`. `enabled`: `"true"/"1"/"yes"` (không hoa/thường) → true; trống → true; còn lại false.
  - `parseUrlRows(values): {rowIndex, url, status}[]` — `rowIndex` 1-based. Bỏ ô A trống. Bỏ dòng 1 nếu A1 không chứa `http`.

- [ ] **Step 1: Write the failing test**

Create `tests/sheets-service.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfigRows, parseUrlRows } from "../sheet/sheets-service.js";

const HEADER = ["sheetName","enabled","videosPerDay","renderMode","opacity","chromaColor","chromaSimilarity","keepColors","cropHeight","cropYOffset","proxy"];

test("parseConfigRows maps columns and defaults enabled=true when blank", () => {
  const rows = [HEADER,
    ["Kênh A","TRUE","3","topTransparent","0.7","","","","","",""],
    ["Kênh B","","5","chromaKey","","D4F9D7","0.3","","","","socks5://1.2.3.4:1080"],
    ["Kênh C","FALSE","2","keepColor","","","","F6FF00, FBFF02","150","550",""],
  ];
  const out = parseConfigRows(rows);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], {
    sheetName: "Kênh A", enabled: true, videosPerDay: 3, renderMode: "topTransparent",
    cfg: { opacity: 0.7 }, proxy: "",
  });
  assert.equal(out[1].enabled, true);
  assert.equal(out[1].proxy, "socks5://1.2.3.4:1080");
  assert.deepEqual(out[1].cfg, { chromaColor: "D4F9D7", chromaSimilarity: 0.3 });
  assert.equal(out[2].enabled, false);
  assert.deepEqual(out[2].cfg, { keepColors: ["F6FF00", "FBFF02"], cropHeight: 150, cropYOffset: 550 });
});

test("parseConfigRows skips rows without sheetName", () => {
  const rows = [HEADER, ["","TRUE","3","topTransparent","","","","","","",""]];
  assert.equal(parseConfigRows(rows).length, 0);
});

test("parseUrlRows keeps 1-based index, skips blanks and header", () => {
  const rows = [
    ["URL","status"],
    ["https://youtu.be/a",""],
    ["",""],
    ["https://youtu.be/b","done"],
  ];
  const out = parseUrlRows(rows);
  assert.deepEqual(out, [
    { rowIndex: 2, url: "https://youtu.be/a", status: "" },
    { rowIndex: 4, url: "https://youtu.be/b", status: "done" },
  ]);
});

test("parseUrlRows treats first row as data if it is a URL", () => {
  const out = parseUrlRows([["https://youtu.be/x",""]]);
  assert.deepEqual(out, [{ rowIndex: 1, url: "https://youtu.be/x", status: "" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sheets-service.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write parsers**

Create `sheet/sheets-service.js`:

```js
function truthy(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "") return true; // trống = bật
  return s === "true" || s === "1" || s === "yes";
}

function num(v) {
  const s = String(v ?? "").trim();
  if (s === "") return undefined;
  const n = parseFloat(s);
  return Number.isNaN(n) ? undefined : n;
}

export function parseConfigRows(values) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const header = values[0].map((h) => String(h ?? "").trim().toLowerCase());
  const idx = (name) => header.indexOf(name.toLowerCase());
  const col = (row, name) => {
    const i = idx(name);
    return i >= 0 ? String(row[i] ?? "").trim() : "";
  };
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    const sheetName = col(row, "sheetName");
    if (!sheetName) continue;
    const cfg = {};
    const opacity = num(col(row, "opacity"));
    if (opacity !== undefined) cfg.opacity = opacity;
    const chromaColor = col(row, "chromaColor");
    if (chromaColor) cfg.chromaColor = chromaColor;
    const chromaSim = num(col(row, "chromaSimilarity"));
    if (chromaSim !== undefined) cfg.chromaSimilarity = chromaSim;
    const keepColors = col(row, "keepColors");
    if (keepColors) cfg.keepColors = keepColors.split(",").map((s) => s.trim()).filter(Boolean);
    const cropHeight = num(col(row, "cropHeight"));
    if (cropHeight !== undefined) cfg.cropHeight = cropHeight;
    const cropYOffset = num(col(row, "cropYOffset"));
    if (cropYOffset !== undefined) cfg.cropYOffset = cropYOffset;
    out.push({
      sheetName,
      enabled: truthy(col(row, "enabled")),
      videosPerDay: num(col(row, "videosPerDay")) || 0,
      renderMode: col(row, "renderMode") || "topTransparent",
      cfg,
      proxy: col(row, "proxy"),
    });
  }
  return out;
}

export function parseUrlRows(values) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    const url = String(row[0] ?? "").trim();
    if (r === 0 && !/https?:\/\//i.test(url)) continue; // dòng header
    if (!url) continue;
    out.push({ rowIndex: r + 1, url, status: String(row[1] ?? "").trim() });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sheets-service.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add sheet/sheets-service.js tests/sheets-service.test.js
git commit -m "feat(sheet): parse ⚙config + URL rows (pure)"
```

---

## Task 5: sheets-service — Google client + I/O

**Files:**
- Modify: `sheet/sheets-service.js` (thêm client + I/O methods)

**Interfaces:**
- Consumes: `parseConfigRows`, `parseUrlRows` (Task 4)
- Produces (đều async, `sheets` = google sheets client):
  - `createSheetsClient(credentialsPath)` → sheets client (service account).
  - `listSheetTabs(sheets, spreadsheetId): Promise<string[]>`
  - `readConfigSheet(sheets, spreadsheetId, configTab="⚙config"): Promise<ChannelConfig[]>`
  - `readChannelUrls(sheets, spreadsheetId, sheetName): Promise<{rowIndex,url,status}[]>`
  - `setUrlStatus(sheets, spreadsheetId, sheetName, rowIndex, status): Promise<void>`

**Note:** Cần network + credentials → test tay (Task 11). Task này chỉ code (port từ `voxable/electron-app/services/sheets-service.js`, đổi phần đọc/ghi cho layout mới).

- [ ] **Step 1: Implement client + I/O**

Thêm vào `sheet/sheets-service.js`:

```js
// --- ĐẦU file ---
import { google } from "googleapis";
import fs from "fs";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

export function createSheetsClient(credentialsPath) {
  if (!fs.existsSync(credentialsPath))
    throw new Error(`Không tìm thấy file credentials: ${credentialsPath}`);
  const key = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
  const auth = new google.auth.GoogleAuth({ credentials: key, scopes: SCOPES });
  return google.sheets({ version: "v4", auth });
}

export async function listSheetTabs(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  return (res.data.sheets || []).map((s) => s.properties.title);
}

export async function readConfigSheet(sheets, spreadsheetId, configTab = "⚙config") {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${configTab}!A:Z` });
  return parseConfigRows(res.data.values || []);
}

export async function readChannelUrls(sheets, spreadsheetId, sheetName) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:B` });
  return parseUrlRows(res.data.values || []);
}

export async function setUrlStatus(sheets, spreadsheetId, sheetName, rowIndex, status) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!B${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [[status]] },
  });
}
```

- [ ] **Step 2: Verify existing tests still pass (no regression)**

Run: `node --test tests/sheets-service.test.js`
Expected: PASS (4 tests — parsers unaffected).

- [ ] **Step 3: Commit**

```bash
git add sheet/sheets-service.js
git commit -m "feat(sheet): Google Sheets client + config/url read + status write"
```

---

## Task 6: channel-download — downloadOne

**Files:**
- Create: `sheet/channel-download.js`
- Test: `tests/sheets-service.test.js` (thêm 1 test cho `pickDownloadedFile`)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `pickDownloadedFile(dirBefore, dirAfter): string | null` — trả file `.mp4` mới xuất hiện (chênh lệch 2 snapshot tên file).
  - `downloadOne(url, outputDir, { proxy, cookiesFile, ytdlpPath }): Promise<{ filePath, title, thumbPath }>`

**Note:** yt-dlp cần binary → `downloadOne` test tay (Task 11). `pickDownloadedFile` thuần → TDD.

- [ ] **Step 1: Write failing test for pickDownloadedFile**

Thêm vào `tests/sheets-service.test.js`:

```js
import { pickDownloadedFile } from "../sheet/channel-download.js";

test("pickDownloadedFile returns the new mp4", () => {
  const before = ["old.mp4"];
  const after = ["old.mp4", "New Title.mp4", "New Title.jpg"];
  assert.equal(pickDownloadedFile(before, after), "New Title.mp4");
});

test("pickDownloadedFile returns null when no new mp4", () => {
  assert.equal(pickDownloadedFile(["a.mp4"], ["a.mp4"]), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sheets-service.test.js`
Expected: FAIL — `../sheet/channel-download.js` not found.

- [ ] **Step 3: Implement channel-download.js**

Create `sheet/channel-download.js`:

```js
import fs from "fs";
import path from "path";
import { create as createYoutubeDl } from "youtube-dl-exec";

export function pickDownloadedFile(dirBefore, dirAfter) {
  const beforeSet = new Set(dirBefore);
  const added = dirAfter.filter((f) => !beforeSet.has(f));
  const mp4 = added.find((f) => f.toLowerCase().endsWith(".mp4"));
  return mp4 || null;
}

function isValidProxy(p) {
  return typeof p === "string" && /^(http|https|socks5):\/\//i.test(p.trim());
}

export async function downloadOne(url, outputDir, { proxy, cookiesFile, ytdlpPath } = {}) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const before = fs.readdirSync(outputDir);

  const ytdl = createYoutubeDl(ytdlpPath);
  const options = {
    output: path.join(outputDir, "%(title)s.%(ext)s"),
    format: "bestvideo[height=720][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height=720][ext=mp4][vcodec^=avc]",
    mergeOutputFormat: "mp4",
    writeThumbnail: true,
    convertThumbnails: "jpg",
    noOverwrites: true,
    limitRate: "2M",
    addHeader: [
      "referer:youtube.com",
      "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    ],
    extractorArgs: ["youtube:player_client=default,-android_sdkless"],
  };
  if (cookiesFile && fs.existsSync(cookiesFile)) options.cookies = cookiesFile;
  if (isValidProxy(proxy)) options.proxy = proxy.trim();

  await ytdl(url, options);

  const after = fs.readdirSync(outputDir);
  const newMp4 = pickDownloadedFile(before, after);
  if (!newMp4) throw new Error(`Không tìm thấy file tải về cho URL: ${url}`);
  const filePath = path.join(outputDir, newMp4);
  const title = path.basename(newMp4, ".mp4");
  const thumbCandidate = path.join(outputDir, `${title}.jpg`);
  return { filePath, title, thumbPath: fs.existsSync(thumbCandidate) ? thumbCandidate : null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sheets-service.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add sheet/channel-download.js tests/sheets-service.test.js
git commit -m "feat(sheet): downloadOne single-URL wrapper + pickDownloadedFile"
```

---

## Task 7: sheet-runner — orchestrator (DI, quota, event)

**Files:**
- Create: `sheet/sheet-runner.js`
- Test: `tests/sheet-runner.test.js`

**Interfaces:**
- Consumes: `runner-state` helpers, và qua DI: `sheetsApi`, `downloader`, `renderer`, `listBackgrounds`, `emit`, `now`, `pLimitFn`.
- Produces:
  - `pickRandomBackground(files, rand = Math.random): string` — chọn 1 file.
  - `createSheetRunner(deps): { runNow(sheetName?), start(intervalMs), stop() }`

  `deps` (tất cả inject để test):
  ```
  {
    config: { spreadsheetId, channelsRoot, statePath, renderConcurrency=2 },
    sheetsApi: { readConfigSheet(), readChannelUrls(sheetName), setUrlStatus(sheetName,rowIndex,status) },
    downloader: (url, overlaysDir, {proxy}) => Promise<{filePath,title}>,
    renderer: ({overlayFile,backgroundFile,outputPath,renderMode,cfg}) => Promise<{outputPath}>,
    listBackgrounds: (dir) => string[],   // tên file .mp4
    ensureDirs: (channelRoot) => {backgroundsDir,overlaysDir,outputDir},
    stateStore: { load(): state, save(state): void },
    emit: (evt) => void,                  // {type,channel,...}
    now: () => Date,
    pLimitFn: (n) => limit,
    rand: () => number,
    unlink: (p) => void,                  // xóa overlay sau render
  }
  ```

  `runNow` cho mỗi kênh `enabled`: reset quota theo ngày → tính `remaining` → lấy `remaining` URL status rỗng → mỗi URL: download → render (background ngẫu nhiên) → `setUrlStatus(done)` → `recordRendered` + save → emit `video-rendered`; lỗi → `setUrlStatus("error: ...")`, emit `error`, không tăng count. Kênh thiếu background → emit `error`, bỏ qua.

- [ ] **Step 1: Write the failing test**

Create `tests/sheet-runner.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSheetRunner, pickRandomBackground } from "../sheet/sheet-runner.js";

test("pickRandomBackground picks by rand", () => {
  const files = ["a.mp4", "b.mp4", "c.mp4"];
  assert.equal(pickRandomBackground(files, () => 0), "a.mp4");
  assert.equal(pickRandomBackground(files, () => 0.99), "c.mp4");
});

function makeDeps(overrides = {}) {
  const calls = { status: [], rendered: [], errors: [], downloaded: [] };
  let savedState = {};
  const deps = {
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2 },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 2, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [
        { rowIndex: 2, url: "u1", status: "" },
        { rowIndex: 3, url: "u2", status: "" },
        { rowIndex: 4, url: "u3", status: "" },
        { rowIndex: 5, url: "u4", status: "done" },
      ],
      setUrlStatus: async (sheetName, rowIndex, status) => calls.status.push({ sheetName, rowIndex, status }),
    },
    downloader: async (url) => { calls.downloaded.push(url); return { filePath: `/ov/${url}.mp4`, title: url }; },
    renderer: async ({ outputPath }) => { calls.rendered.push(outputPath); return { outputPath }; },
    listBackgrounds: () => ["bg1.mp4"],
    ensureDirs: () => ({ backgroundsDir: "/bg", overlaysDir: "/ov", outputDir: "/out" }),
    stateStore: { load: () => savedState, save: (s) => { savedState = JSON.parse(JSON.stringify(s)); } },
    emit: (e) => { if (e.type === "error") calls.errors.push(e); },
    now: () => new Date(2026, 6, 7, 10, 0),
    pLimitFn: () => (fn) => fn(),
    rand: () => 0,
    unlink: () => {},
  };
  return { deps: { ...deps, ...overrides }, calls, getState: () => savedState };
}

test("runNow respects videosPerDay quota (2 of 3 pending)", async () => {
  const { deps, calls, getState } = makeDeps();
  const runner = createSheetRunner(deps);
  await runner.runNow();
  assert.equal(calls.downloaded.length, 2);
  assert.equal(calls.rendered.length, 2);
  assert.deepEqual(calls.status.map((s) => s.status), ["done", "done"]);
  assert.equal(getState()["Kênh A"].countToday, 2);
});

test("runNow does nothing when quota already met today", async () => {
  const { deps, calls } = makeDeps({
    stateStore: { load: () => ({ "Kênh A": { lastRunDate: "2026-07-07", countToday: 2 } }), save: () => {} },
  });
  await createSheetRunner(deps).runNow();
  assert.equal(calls.downloaded.length, 0);
});

test("runNow records error and skips count when render throws", async () => {
  const { deps, calls, getState } = makeDeps({
    renderer: async () => { throw new Error("ffmpeg boom"); },
  });
  await createSheetRunner(deps).runNow();
  assert.equal(calls.status.filter((s) => s.status.startsWith("error:")).length, 2);
  assert.equal(getState()["Kênh A"], undefined); // không render thành công nào
});

test("runNow errors channel with no backgrounds", async () => {
  const { deps, calls } = makeDeps({ listBackgrounds: () => [] });
  await createSheetRunner(deps).runNow();
  assert.equal(calls.downloaded.length, 0);
  assert.ok(calls.errors.some((e) => /background/i.test(e.message)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sheet-runner.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement sheet-runner.js**

Create `sheet/sheet-runner.js`:

```js
import path from "path";
import { todayStr, computeRemaining, recordRendered } from "./runner-state.js";

export function pickRandomBackground(files, rand = Math.random) {
  if (!files.length) return null;
  return files[Math.min(files.length - 1, Math.floor(rand() * files.length))];
}

export function createSheetRunner(deps) {
  const {
    config, sheetsApi, downloader, renderer, listBackgrounds,
    ensureDirs, stateStore, emit, now, pLimitFn, rand, unlink,
  } = deps;
  let timer = null;

  async function runChannel(ch, today) {
    if (!ch.enabled) return;
    const channelRoot = path.join(config.channelsRoot, ch.sheetName);
    const { backgroundsDir, overlaysDir, outputDir } = ensureDirs(channelRoot);
    const backgrounds = listBackgrounds(backgroundsDir);
    if (!backgrounds.length) {
      emit({ type: "error", channel: ch.sheetName, message: "Chưa có background (.mp4) trong folder kênh." });
      return;
    }
    const state = stateStore.load();
    const remaining = computeRemaining(state[ch.sheetName], ch.videosPerDay, today);
    if (remaining <= 0) { emit({ type: "channel-status", channel: ch.sheetName, status: "đủ hôm nay" }); return; }

    const urls = await sheetsApi.readChannelUrls(ch.sheetName);
    const pending = urls.filter((u) => u.status === "").slice(0, remaining);
    if (!pending.length) { emit({ type: "channel-status", channel: ch.sheetName, status: "hết URL mới" }); return; }

    const limit = pLimitFn(config.renderConcurrency || 2);
    await Promise.all(pending.map((item) => limit(async () => {
      try {
        emit({ type: "channel-status", channel: ch.sheetName, status: "đang tải", url: item.url });
        const dl = await downloader(item.url, overlaysDir, { proxy: ch.proxy });
        const bg = pickRandomBackground(backgrounds, rand);
        const outputPath = path.join(outputDir, `${dl.title}.mp4`);
        emit({ type: "channel-status", channel: ch.sheetName, status: "đang render", url: item.url });
        await renderer({
          overlayFile: dl.filePath, backgroundFile: path.join(backgroundsDir, bg),
          outputPath, renderMode: ch.renderMode, cfg: ch.cfg,
        });
        await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, "done");
        const s = stateStore.load();
        recordRendered(s, ch.sheetName, today);
        stateStore.save(s);
        try { unlink(dl.filePath); } catch { /* ignore */ }
        emit({ type: "video-rendered", channel: ch.sheetName, outputPath, sourceUrl: item.url, title: dl.title });
      } catch (e) {
        const msg = String(e?.message || e).slice(0, 200);
        try { await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, `error: ${msg}`); } catch { /* ignore */ }
        emit({ type: "error", channel: ch.sheetName, url: item.url, message: msg });
      }
    })));
  }

  async function runNow(sheetName) {
    const today = todayStr(now());
    let channels = await sheetsApi.readConfigSheet();
    if (sheetName) channels = channels.filter((c) => c.sheetName === sheetName);
    for (const ch of channels) await runChannel(ch, today);
    emit({ type: "done" });
  }

  function start(intervalMs) {
    stop();
    runNow().catch((e) => emit({ type: "error", message: String(e?.message || e) }));
    timer = setInterval(() => runNow().catch((e) => emit({ type: "error", message: String(e?.message || e) })), intervalMs);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  return { runNow, start, stop };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sheet-runner.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: PASS toàn bộ (render-core, runner-state, sheets-service, sheet-runner).

- [ ] **Step 6: Commit**

```bash
git add sheet/sheet-runner.js tests/sheet-runner.test.js
git commit -m "feat(sheet): orchestrator — quota-aware download+render per channel"
```

---

## Task 8: IPC handlers trong electron-main.js

**Files:**
- Modify: `electron-main.js` (thêm block IPC + wiring runner, gần các `ipcMain.handle` khác, vd sau handler `detect-gpu-codec` ~dòng 1246)

**Interfaces:**
- Consumes: `createSheetRunner`, `createSheetsClient`, `readConfigSheet` (Task 5,7), `renderOne` (Task 3), `downloadOne` (Task 6), `runner-state` load/save (Task 1).
- Produces IPC channels: `sheet:save-settings`, `sheet:load-settings`, `sheet:select-credentials`, `sheet:select-root`, `sheet:start`, `sheet:stop`, `sheet:run-now`. Event push: `sheet:event`.

- [ ] **Step 1: Add imports + settings helpers + wiring**

Thêm gần đầu `electron-main.js` (sau các import hiện có):

```js
import { createSheetRunner } from "./sheet/sheet-runner.js";
import { createSheetsClient, readConfigSheet, readChannelUrls, setUrlStatus } from "./sheet/sheets-service.js";
import { renderOne } from "./sheet/render-core.js";
import { downloadOne } from "./sheet/channel-download.js";
import { loadState, saveState } from "./sheet/runner-state.js";
```

Thêm block (sau handler `detect-gpu-codec`):

```js
// ===== Sheet-watch feature =====
function sheetSettingsPath() {
  return path.join(configDir, "sheet-settings.json"); // configDir đã có sẵn trong file
}
function loadSheetSettings() {
  try { return JSON.parse(fs.readFileSync(sheetSettingsPath(), "utf-8")); }
  catch { return { spreadsheetId: "", credentialsPath: "", channelsRoot: "", pollSec: 300, autoRunOnOpen: false }; }
}
function saveSheetSettings(s) { fs.writeFileSync(sheetSettingsPath(), JSON.stringify(s, null, 2), "utf-8"); }

const YTDLP_PATH = path.join(configDir, "..", "bin", "yt-dlp.exe"); // dùng chung bin của app
let sheetRunner = null;

function buildSheetRunner(win) {
  const s = loadSheetSettings();
  const sheets = createSheetsClient(s.credentialsPath);
  const statePath = path.join(s.channelsRoot, "runner-state.json");
  return createSheetRunner({
    config: { spreadsheetId: s.spreadsheetId, channelsRoot: s.channelsRoot, statePath, renderConcurrency: 2 },
    sheetsApi: {
      readConfigSheet: () => readConfigSheet(sheets, s.spreadsheetId),
      readChannelUrls: (name) => readChannelUrls(sheets, s.spreadsheetId, name),
      setUrlStatus: (name, row, status) => setUrlStatus(sheets, s.spreadsheetId, name, row, status),
    },
    downloader: (url, dir, opts) => downloadOne(url, dir, { ...opts, ytdlpPath: path.join(__dirname, "bin", "yt-dlp.exe") }),
    renderer: (opts) => renderOne(opts),
    listBackgrounds: (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".mp4")) : []),
    ensureDirs: (root) => {
      const dirs = {
        backgroundsDir: path.join(root, "backgrounds"),
        overlaysDir: path.join(root, "overlays"),
        outputDir: path.join(root, "output"),
      };
      for (const d of [dirs.overlaysDir, dirs.outputDir]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      return dirs;
    },
    stateStore: { load: () => loadState(statePath), save: (st) => saveState(statePath, st) },
    emit: (evt) => { if (win && !win.isDestroyed()) win.webContents.send("sheet:event", evt); },
    now: () => new Date(),
    pLimitFn: (n) => pLimit(n), // pLimit đã import trong file? nếu chưa: import pLimit from "p-limit";
    rand: () => Math.random(),
    unlink: (p) => { try { fs.unlinkSync(p); } catch { /* ignore */ } },
  });
}

ipcMain.handle("sheet:load-settings", async () => loadSheetSettings());
ipcMain.handle("sheet:save-settings", async (e, s) => { saveSheetSettings(s); return { success: true }; });
ipcMain.handle("sheet:select-credentials", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("sheet:select-root", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("sheet:start", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const s = loadSheetSettings();
  sheetRunner = buildSheetRunner(win);
  sheetRunner.start((s.pollSec || 300) * 1000);
  return { success: true };
});
ipcMain.handle("sheet:stop", async () => { if (sheetRunner) sheetRunner.stop(); return { success: true }; });
ipcMain.handle("sheet:run-now", async (e, sheetName) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const runner = sheetRunner || buildSheetRunner(win);
  await runner.runNow(sheetName || undefined);
  return { success: true };
});
```

**Lưu ý khi implement:** kiểm tra tên biến sẵn có trong `electron-main.js` — `configDir`, `__dirname`, `dialog`, `BrowserWindow`, `pLimit`. Nếu `pLimit` chưa import, thêm `import pLimit from "p-limit";`. Nếu `configDir` khác tên, dùng đúng biến chứa app config dir (nơi `getProjectsDir()` dựa vào).

- [ ] **Step 2: Sanity — app khởi động không lỗi**

Run (trên Windows hoặc mac dev): `npm start`
Expected: App mở, không có lỗi "createSheetRunner is not defined" / import lỗi trong console main. (Chưa có UI tab — chỉ verify IPC nạp được.)

- [ ] **Step 3: Commit**

```bash
git add electron-main.js
git commit -m "feat(sheet): IPC handlers + runner wiring in main process"
```

---

## Task 9: preload.cjs — expose API

**Files:**
- Modify: `preload.cjs`

**Interfaces:**
- Consumes: IPC channels từ Task 8.
- Produces: `window.electronAPI.sheet` object.

- [ ] **Step 1: Add sheet API to contextBridge**

Trong `preload.cjs`, thêm vào object `electronAPI` (trước dấu `});` cuối):

```js
  sheet: {
    loadSettings: () => ipcRenderer.invoke("sheet:load-settings"),
    saveSettings: (s) => ipcRenderer.invoke("sheet:save-settings", s),
    selectCredentials: () => ipcRenderer.invoke("sheet:select-credentials"),
    selectRoot: () => ipcRenderer.invoke("sheet:select-root"),
    start: () => ipcRenderer.invoke("sheet:start"),
    stop: () => ipcRenderer.invoke("sheet:stop"),
    runNow: (sheetName) => ipcRenderer.invoke("sheet:run-now", sheetName),
    onEvent: (cb) => ipcRenderer.on("sheet:event", (e, data) => cb(data)),
    removeEventListener: () => ipcRenderer.removeAllListeners("sheet:event"),
  },
```

- [ ] **Step 2: Verify preload loads (no syntax error)**

Run: `node -e "require('./preload.cjs')" 2>&1 | head -5` (chỉ để bắt lỗi cú pháp; `contextBridge` sẽ undefined ngoài Electron — bỏ qua lỗi runtime đó, chỉ quan tâm KHÔNG có SyntaxError).
Expected: Không có `SyntaxError`.

- [ ] **Step 3: Commit**

```bash
git add preload.cjs
git commit -m "feat(sheet): expose sheet-watch API in preload"
```

---

## Task 10: UI tab — renderer.html + renderer.js

**Files:**
- Modify: `renderer.html` (nút tab + panel)
- Modify: `renderer.js` (logic tab)

**Interfaces:**
- Consumes: `window.electronAPI.sheet` (Task 9).
- Produces: tab UI vận hành đầy đủ (connect form, Start/Stop, Chạy ngay, bảng trạng thái, log).

**Note:** Theo dõi cấu trúc tab hiện có trong `renderer.html`/`renderer.js`. Tìm nơi khai báo các tab-button + tab-panel và thêm tương ứng (khớp class/id hiện hành — đọc file trước khi thêm).

- [ ] **Step 1: Add tab button + panel to renderer.html**

Tìm khối chứa các nút tab hiện có, thêm nút:

```html
<button class="tab-btn" data-tab="sheet-watch">Theo dõi Sheet</button>
```

Thêm panel (khớp cấu trúc panel hiện có, class có thể khác — dùng đúng class các panel khác đang dùng):

```html
<section id="tab-sheet-watch" class="tab-panel" style="display:none">
  <h2>Theo dõi Sheet — tự động tải & render</h2>
  <div class="field"><label>Spreadsheet ID</label>
    <input id="sw-spreadsheet-id" type="text" style="width:100%"></div>
  <div class="field"><label>Service account JSON</label>
    <input id="sw-cred-path" type="text" readonly style="width:70%">
    <button id="sw-pick-cred">Chọn file…</button></div>
  <div class="field"><label>Channels root folder</label>
    <input id="sw-root" type="text" readonly style="width:70%">
    <button id="sw-pick-root">Chọn folder…</button></div>
  <div class="field"><label>Poll (giây)</label>
    <input id="sw-poll" type="number" value="300" style="width:100px"></div>
  <div class="field"><label><input id="sw-auto-open" type="checkbox"> Tự chạy khi mở app</label></div>
  <div class="field">
    <button id="sw-save">Lưu cấu hình</button>
    <button id="sw-start">Start theo dõi</button>
    <button id="sw-stop">Stop</button>
    <button id="sw-run-now">Chạy tất cả ngay</button>
  </div>
  <table id="sw-status-table" style="width:100%;border-collapse:collapse;margin-top:10px">
    <thead><tr><th>Kênh</th><th>Trạng thái</th><th>Hôm nay</th><th>Lỗi</th></tr></thead>
    <tbody></tbody>
  </table>
  <pre id="sw-log" style="height:200px;overflow:auto;background:#111;color:#0f0;padding:8px;margin-top:10px"></pre>
</section>
```

- [ ] **Step 2: Add tab logic to renderer.js**

Thêm vào cuối `renderer.js`:

```js
// ===== Tab Theo dõi Sheet =====
(function initSheetWatch() {
  const api = window.electronAPI?.sheet;
  if (!api) return;
  const $ = (id) => document.getElementById(id);
  const logEl = $("sw-log");
  const statusBody = $("sw-status-table")?.querySelector("tbody");
  const rows = new Map(); // channel -> {statusEl, todayEl, errEl}

  function log(msg) {
    if (!logEl) return;
    logEl.textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  function ensureRow(channel) {
    if (rows.has(channel)) return rows.get(channel);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${channel}</td><td class="st"></td><td class="td"></td><td class="er" style="color:#c00"></td>`;
    statusBody.appendChild(tr);
    const r = { statusEl: tr.querySelector(".st"), todayEl: tr.querySelector(".td"), errEl: tr.querySelector(".er") };
    rows.set(channel, r);
    return r;
  }

  async function loadSettings() {
    const s = await api.loadSettings();
    $("sw-spreadsheet-id").value = s.spreadsheetId || "";
    $("sw-cred-path").value = s.credentialsPath || "";
    $("sw-root").value = s.channelsRoot || "";
    $("sw-poll").value = s.pollSec || 300;
    $("sw-auto-open").checked = !!s.autoRunOnOpen;
  }
  function currentSettings() {
    return {
      spreadsheetId: $("sw-spreadsheet-id").value.trim(),
      credentialsPath: $("sw-cred-path").value.trim(),
      channelsRoot: $("sw-root").value.trim(),
      pollSec: parseInt($("sw-poll").value, 10) || 300,
      autoRunOnOpen: $("sw-auto-open").checked,
    };
  }

  $("sw-pick-cred")?.addEventListener("click", async () => {
    const p = await api.selectCredentials(); if (p) $("sw-cred-path").value = p;
  });
  $("sw-pick-root")?.addEventListener("click", async () => {
    const p = await api.selectRoot(); if (p) $("sw-root").value = p;
  });
  $("sw-save")?.addEventListener("click", async () => { await api.saveSettings(currentSettings()); log("Đã lưu cấu hình."); });
  $("sw-start")?.addEventListener("click", async () => { await api.saveSettings(currentSettings()); await api.start(); log("▶ Bắt đầu theo dõi."); });
  $("sw-stop")?.addEventListener("click", async () => { await api.stop(); log("⏹ Đã dừng."); });
  $("sw-run-now")?.addEventListener("click", async () => { await api.saveSettings(currentSettings()); log("Chạy tất cả ngay…"); await api.runNow(); });

  api.onEvent((evt) => {
    if (evt.type === "channel-status") {
      const r = ensureRow(evt.channel); r.statusEl.textContent = evt.status;
      log(`[${evt.channel}] ${evt.status}${evt.url ? " — " + evt.url : ""}`);
    } else if (evt.type === "video-rendered") {
      const r = ensureRow(evt.channel); r.statusEl.textContent = "xong";
      log(`[${evt.channel}] ✅ ${evt.title}`);
    } else if (evt.type === "error") {
      const r = evt.channel ? ensureRow(evt.channel) : null;
      if (r) r.errEl.textContent = evt.message;
      log(`❌ ${evt.channel ? "[" + evt.channel + "] " : ""}${evt.message}`);
    } else if (evt.type === "done") {
      log("— Hoàn tất lượt chạy —");
    }
  });

  loadSettings();
})();
```

- [ ] **Step 3: Manual smoke — tab hiển thị và lưu settings**

Run: `npm start`
- Click tab "Theo dõi Sheet" → panel hiển thị.
- Nhập Spreadsheet ID, chọn creds/root, bấm "Lưu cấu hình" → log "Đã lưu cấu hình."
- Đóng/mở lại app → settings được nạp lại.

Expected: Tab hoạt động, settings persist. (Chưa cần chạy download/render thật ở bước này.)

- [ ] **Step 4: Commit**

```bash
git add renderer.html renderer.js
git commit -m "feat(sheet): UI tab Theo dõi Sheet (connect, status table, log)"
```

---

## Task 11: Auto-run khi mở app + end-to-end manual verification (Windows)

**Files:**
- Modify: `electron-main.js` (gọi auto-run sau khi window sẵn sàng nếu `autoRunOnOpen`)

**Interfaces:**
- Consumes: `buildSheetRunner`, `loadSheetSettings` (Task 8).

- [ ] **Step 1: Wire auto-run on app open**

Trong `electron-main.js`, sau khi cửa sổ chính tạo xong (tìm nơi `mainWindow`/`win` được tạo trong `createWindow`/`app.whenReady`), thêm — bọc trong try/catch, delay để renderer kịp gắn listener:

```js
try {
  const sw = loadSheetSettings();
  if (sw.autoRunOnOpen && sw.spreadsheetId && sw.credentialsPath && sw.channelsRoot) {
    setTimeout(() => {
      try {
        sheetRunner = buildSheetRunner(win); // 'win' = biến cửa sổ chính vừa tạo
        sheetRunner.start((sw.pollSec || 300) * 1000);
      } catch (err) { console.error("Auto-run sheet-watch lỗi:", err); }
    }, 4000);
  }
} catch (err) { console.error(err); }
```

**Lưu ý:** dùng đúng tên biến cửa sổ chính trong `createWindow`. `buildSheetRunner`/`loadSheetSettings`/`sheetRunner` phải ở scope truy cập được (đã khai báo ở Task 8 trong module scope — nếu `createWindow` ở trên phần đó, chuyển khai báo `let sheetRunner` + `buildSheetRunner`/`loadSheetSettings` lên trước `createWindow`).

- [ ] **Step 2: Verify full suite still green**

Run: `npm test`
Expected: PASS toàn bộ.

- [ ] **Step 3: End-to-end manual test (trên máy Windows với bin/yt-dlp.exe + ffmpeg)**

Chuẩn bị:
- Google Sheet: 1 tab `⚙config` (header + 1 dòng `Kênh Test | TRUE | 2 | topTransparent | 0.7`), 1 tab `Kênh Test` với 3 URL YouTube ngắn ở cột A.
- Folder `<root>/Kênh Test/backgrounds/` có ≥1 file `.mp4`.
- Service account có quyền đọc/ghi Sheet (share sheet cho email service account).

Thực hiện:
1. Mở app → tab "Theo dõi Sheet" → nhập Spreadsheet ID + creds + root → Lưu.
2. Bấm "Chạy tất cả ngay".
3. **Kỳ vọng:** tải đúng **2** video (không phải 3), render ra `<root>/Kênh Test/output/*.mp4`, cột B của 2 dòng = `done`, `runner-state.json` có `{ "Kênh Test": { countToday: 2 } }`.
4. Bấm "Chạy tất cả ngay" lần nữa → **không** tải thêm (quota đủ hôm nay).
5. Sửa 1 URL sai (vd bỏ ký tự) → chạy → cột B dòng đó = `error: ...`, các dòng khác không ảnh hưởng.
6. Bật "Tự chạy khi mở app" → Lưu → mở lại app → tự chạy phần còn thiếu.

Ghi kết quả vào PR/commit message. Nếu lỗi → dùng superpowers:systematic-debugging.

- [ ] **Step 4: Commit**

```bash
git add electron-main.js
git commit -m "feat(sheet): auto-run on app open when enabled"
```

---

## Self-Review (đã thực hiện khi viết plan)

- **Spec coverage:** UI watch-only (Task 10) · ⚙config schema+parse (Task 4) · URL/status (Task 4,5) · folder convention (Task 8 `ensureDirs`) · logic quota bỏ ngày1/ngày2 (Task 1,7) · reuse render (Task 2,3) · download (Task 6) · concurrency chung (Task 7 `pLimitFn`) · state idempotent/resume (Task 1,7) · auto-run mở app (Task 11) · GPM hook `video-rendered` (Task 7). ✓
- **Placeholder scan:** không có TBD/TODO; mọi step có code/lệnh cụ thể. ✓
- **Type consistency:** `buildComplexFilter`/`renderOne`/`downloadOne`/`createSheetRunner`/`recordRendered`/`computeRemaining` dùng nhất quán qua các task. Event types (`channel-status`,`video-rendered`,`error`,`done`) khớp giữa Task 7 và Task 10. ✓
- **Gap đã lưu ý:** tên biến trong `electron-main.js` (`configDir`, `win`, `dialog`, `BrowserWindow`, `pLimit`) phải xác minh khi sửa (Task 8,11 đã ghi chú). Download/render chỉ verify được trên Windows (Task 11).
