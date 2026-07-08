# Design: chromaKeyAuto + app-level GPU/videoSpeed cho hệ Theo dõi Sheet

Ngày: 2026-07-08

## Bối cảnh

Hệ "Theo dõi Sheet" hiện render video theo cấu hình per-kênh đọc từ tab `⚙config`
của Google Sheet (`sheet/sheets-service.js` → `sheet/sheet-runner.js` → `sheet/render-core.js`).
`render-core.js` hỗ trợ 4 `renderMode`: `topTransparent`, `chromaKey`, `crop`, `keepColor`.
Chế độ `chromaKey` hiện chỉ nhận **một** màu cố định (`chromaColor`).

App cũ (`render.js` + `get-video-chroma.js`, nút UI `autoDetectChromaKeyFromVideos`
trong `renderer.js:2080`) có logic **tự dò màu chroma key theo từng video**: trích frame
đầu → tính màu trung bình → map về màu gần nhất trong một palette do người dùng cung cấp.
Logic lõi nằm ở `get-video-chroma.js` (average color + nearest-palette).

## Mục tiêu

1. Thêm chế độ render mới `chromaKeyAuto` cho hệ Sheet: trước khi render **mỗi** video,
   tự dò màu chroma key từ palette 4 màu (hoặc n màu) khai báo trong Sheet, theo đúng
   logic cũ của `get-video-chroma.js`.
2. Đưa `useGPU` và `videoSpeed` thành cấu hình **toàn cục ở giao diện app** (tab Theo dõi
   Sheet), áp cho mọi kênh — vì đây là thuộc tính của máy/toàn cục, không phải per-kênh.

Non-goals: chế độ đọc màu từ file (`chromaKeyMode: "file"`) — không port sang hệ Sheet.
Bản Python `get-color.py` (dominant color) — không dùng.

## Phân chia cấu hình

### A. Giao diện app (lưu `sheet-settings.json`, áp mọi kênh)

| Field | Kiểu | Mặc định |
|---|---|---|
| `useGPU` | boolean (checkbox "Dùng GPU (NVENC)") | `false` |
| `videoSpeed` | number (ô "Tốc độ video") | `0.95` |
| `gpuVideoCodec` | string, cố định | `h264_nvenc` (không thêm ô UI) |

### B. Google Sheet `⚙config` (per kênh)

| Cột | Ghi chú |
|---|---|
| `renderMode` | thêm giá trị hợp lệ `chromaKeyAuto` |
| `chromaPalette` | danh sách hex cách nhau dấu phẩy, vd `22BDD6,2B4052,7FBFDE,7097B8`; chỉ dùng khi `renderMode=chromaKeyAuto` |
| `chromaColor`, `chromaSimilarity`, `opacity`, `keepColors`, `cropHeight`, `cropYOffset` | giữ nguyên |

Bỏ `videoSpeed`/`useGPU`/`gpuVideoCodec` khỏi Sheet (đã chuyển lên app).

## Kiến trúc & luồng dữ liệu

### Module mới: `sheet/chroma-detect.js`

Tách logic lõi từ `get-video-chroma.js` thành các hàm dùng lại cho **một** video:

- `hexToRgb(hex)`, `rgbToHex(rgb)`, `distanceSq(a, b)` — tiện ích màu (thuần).
- `mapToNearest(rgb, paletteRgb)` → hex — chọn màu palette gần nhất theo khoảng cách Euclid bình phương (thuần, dễ test).
- `extractFirstFrameBuffer(videoPath, ffmpegPath, { spawn })` → Promise<Buffer> — trích frame đầu bằng ffmpeg (`-ss 0 -frames:v 1 -f image2pipe -vcodec png pipe:1`).
- `averageColor(buffer, { sharp })` → Promise<rgb> — resize 64×64, removeAlpha, tính RGB trung bình.
- `detectChromaColor(videoPath, paletteHex, { ffmpegPath, spawn, sharp })` → Promise<string> — ghép 3 bước trên, trả về hex không có `#`. Nếu `paletteHex` rỗng → throw (caller xử lý fallback).

ffmpeg path lấy từ `resolveFfmpegPaths()` của `render-core.js` (chạy được macOS + Windows).

### `sheet/sheets-service.js` — `parseConfigRows`

- Thêm helper `boolFalse(v)`: trống/`false`/`0`/`no` → `false`; `true`/`1`/`yes` → `true`.
  (Khác `truthy` hiện tại dùng cho `enabled`, nơi trống = bật.)
- Parse cột `chromaPalette` → `ch.chromaPalette` = mảng hex hợp lệ (6 ký tự), đã bỏ `#`, uppercase; giá trị không hợp lệ bị loại.
- `renderMode`: giữ nguyên cách đọc; `chromaKeyAuto` chỉ là một chuỗi hợp lệ mới (không cần validate cứng).
- Không còn parse `videoSpeed`/`useGPU` ở đây.

### `sheet/render-core.js`

- `buildComplexFilter`: thêm `case "chromaKeyAuto": return chromaKey(cfg);` (dùng chung filter với `chromaKey`, vì `cfg.chromaColor` đã được runner gán = màu dò được).
- `renderOne` đã hỗ trợ sẵn `useGPU` + `gpuVideoCodec` + `cfg.videoSpeed` — không đổi.

### `sheet/sheet-runner.js`

- `createSheetRunner(deps)`: nhận thêm `deps.detectChroma(videoPath, paletteHex) → Promise<hex>`.
- `config` nhận thêm `useGPU`, `gpuVideoCodec`, `videoSpeed`.
- Trong `runChannel`, ngay trước khi gọi `renderer`:
  ```
  const baseCfg = { ...ch.cfg };
  if (config.videoSpeed != null) baseCfg.videoSpeed = config.videoSpeed;
  let cfg = baseCfg;
  if (ch.renderMode === "chromaKeyAuto" && ch.chromaPalette?.length) {
    try {
      const detected = await deps.detectChroma(dl.filePath, ch.chromaPalette);
      cfg = { ...baseCfg, chromaColor: detected };
    } catch (e) {
      // fallback: dùng chromaColor cố định; emit log cảnh báo
    }
  }
  await renderer({
    overlayFile: dl.filePath, backgroundFile, outputPath,
    renderMode: ch.renderMode, cfg,
    useGPU: config.useGPU, gpuVideoCodec: config.gpuVideoCodec,
  });
  ```
- Nếu `chromaKeyAuto` nhưng `chromaPalette` rỗng → không dò, dùng `chromaColor` cố định (filter `chromaKey` xử lý được), emit log cảnh báo một lần.

### `electron-main.js`

- `loadSheetSettings`: thêm default `useGPU: false`, `videoSpeed: 0.95`, `gpuVideoCodec: "h264_nvenc"`.
- `buildSheetRunner`:
  - `config` thêm `useGPU: s.useGPU`, `gpuVideoCodec: s.gpuVideoCodec || "h264_nvenc"`, `videoSpeed: s.videoSpeed`.
  - Nối `detectChroma: (videoPath, palette) => detectChromaColor(videoPath, palette, { ffmpegPath: resolveFfmpegPaths().ffmpegPath, spawn, sharp })`.

### `renderer.html` + `renderer.js` (tab Theo dõi Sheet)

- Thêm vào form settings: checkbox "Dùng GPU (NVENC)" (`sheet-use-gpu`) + ô số "Tốc độ video" (`sheet-video-speed`).
- Hàm load settings: đổ `useGPU`, `videoSpeed` vào 2 control.
- Hàm save settings: đọc 2 control vào object gửi `sheet:save-settings` (parse `videoSpeed` thành số, mặc định 0.95 nếu trống/không hợp lệ).

## Xử lý lỗi

- `detectChroma` lỗi (ffmpeg/sharp) → bắt trong `runChannel`, fallback `chromaColor` cố định, emit log; không làm hỏng cả lượt render kênh (đã có per-video try/catch sẵn).
- `chromaPalette` rỗng khi `chromaKeyAuto` → fallback + log cảnh báo.
- `videoSpeed` không hợp lệ ở UI → chuẩn hoá về 0.95 khi save.

## Kiểm thử (unit)

- `tests/chroma-detect.test.js`: `mapToNearest` chọn đúng màu gần nhất cho vài RGB mẫu; `hexToRgb`/`rgbToHex` round-trip. (`detectChromaColor` inject fake `spawn`/`sharp` để test ghép luồng nếu cần.)
- `tests/sheets-service.test.js` (hoặc file test config hiện có): `parseConfigRows` nhận `chromaPalette` (lọc hex hợp lệ) và `renderMode=chromaKeyAuto`.
- `tests/sheet-runner.test.js`: khi `renderMode=chromaKeyAuto` + có palette → `detectChroma` được gọi với `dl.filePath` và palette; `cfg.chromaColor` = màu dò được; `useGPU`/`gpuVideoCodec`/`videoSpeed` từ `config` truyền đúng xuống `renderer`. Khi palette rỗng → không gọi `detectChroma`, dùng `chromaColor`.

## Rủi ro / cần xác nhận khi triển khai

- `sharp` phải có trong `package.json` và đóng gói được cho Electron (get-video-chroma.js cũ đã import → khả năng cao có sẵn). Kiểm tra ở bước đầu plan.
- `renderOne` chạy CPU cố định `libx264 -preset ultrafast`; khi `useGPU` bật cần card NVIDIA + ffmpeg có NVENC, nếu không sẽ lỗi render (đã có per-video try/catch ghi `error:` vào Sheet).
