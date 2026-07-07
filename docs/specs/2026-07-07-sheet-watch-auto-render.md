# Spec: Tab "Theo dõi Sheet" — auto download + render đa kênh

**Ngày:** 2026-07-07
**Repo:** vid-master
**Trạng thái:** Design (chờ review)

## 1. Mục đích

Thêm một tab mới trong vid-master cho phép vận hành **nhiều kênh YouTube** từ **một Google Sheet duy nhất**. Người dùng vất một đống URL vào từng sub-sheet (mỗi sub-sheet = 1 kênh), cấu hình mỗi kênh "chạy bao nhiêu video/ngày" trong một bảng config chung, rồi app **tự động tải về và render** đúng số lượng đó mỗi ngày.

Tab này **chỉ để theo dõi** — mọi cấu hình kênh nằm trong Google Sheet, không nhét vào UI (vì ~20 kênh mà config trong app thì cực).

## 2. Bối cảnh & tài sản tái dụng

vid-master đã có sẵn:
- **Render engine** (`render.js`): 4 mode composite overlay lên background — `topTransparent`, `chromaKey`, `crop`, `keepColor` (các hàm `complexFilter*` + `processVideo`, hỗ trợ GPU nvenc/qsv/amf + CPU libx264).
- **Downloader** (`download.js`): tải yt-dlp qua `youtube-dl-exec`, hỗ trợ proxy/cookies, tải kèm thumbnail, đặt tên theo `%(title)s.%(ext)s`.
- **Deps sẵn có**: `googleapis`, `xlsx`, `p-limit`, `youtube-dl-exec`, telegram bot.
- Hạ tầng Electron: IPC handlers, project system, dashboard, auto-updater.

Feature này **chỉ tận dụng lại phần render (và download)**; **bỏ hoàn toàn** logic "ngày 1 / ngày 2 / cycleDays / calculateStartIndex" của `render.js`/`schedule.js`.

Port sang từ voxable: logic đọc/ghi Google Sheet (tham khảo `voxable/electron-app/services/sheets-service.js`, ~180 dòng).

## 3. Phạm vi

### Trong phạm vi
- Tab UI mới "Theo dõi Sheet" (connect + trạng thái + log, không config kênh).
- Đọc config đa kênh từ 1 sheet `⚙config`.
- Đọc URL từ từng sub-sheet, ghi status ngược lại.
- Orchestrator: quota N video/ngày/kênh, tải → render, idempotent + resume.
- Trích lõi composite của `render.js` thành hàm dùng lại được (`render-core.js`).

### Ngoài phạm vi (làm sau)
- Auto-upload YouTube qua GPM, thay thumbnail, lên lịch (chỉ chừa hook `{channel, outputPath, sourceUrl, title}`).
- Tạo/sửa background, thumbnail, concat (đã có sẵn trong vid-master, không đụng).
- Không sửa hành vi render.js hiện có của các tab cũ.

## 4. Kiến trúc

```
Tab "Theo dõi Sheet" (renderer)
      │  IPC: start-watch / stop-watch / run-now / status events
      ▼
sheet-runner.js (orchestrator, main process)
      │
      ├─ sheets-service.js   → đọc ⚙config + URL sub-sheet, ghi status cột B
      ├─ channel-download.js → wrap download.js (1 URL, config kênh) → overlays/*.mp4
      ├─ render-core.js      → renderOne(overlay ⊕ background) → output/*.mp4
      └─ runner-state.json   → { [sheetName]: {lastRunDate, countToday} }
```

### 4.1 `sheets-service.js` (port từ voxable)
- `createSheetsClient(credentialsPath)` — service account auth, scope `spreadsheets`.
- `listSheetTabs(spreadsheetId)` — liệt kê tên tab.
- `readConfigSheet(spreadsheetId)` — đọc tab `⚙config` → mảng `ChannelConfig`.
- `readChannelUrls(spreadsheetId, sheetName)` — đọc cột A (URL) + B (status).
- `setUrlStatus(spreadsheetId, sheetName, rowIndex, status)` — ghi cột B.

### 4.2 `render-core.js` (trích từ `render.js`)
Trích **thuần** phần build filter + render 1 file, nhận config qua **tham số** (không dùng biến global/env như bản gốc):

```js
// Trả về mảng complexFilter cho ffmpeg theo mode + params.
buildComplexFilter(renderMode, cfg) // cfg: {opacity, chromaColor, chromaSimilarity,
                                    //       keepColors[], keepCrop, keepHeight, keepYOffset,
                                    //       cropHeight, cropYOffset, videoSpeed}

// Render 1 cặp overlay⊕background → output. Bọc ffmpeg + GPU/CPU codec như render.js.
async renderOne({ overlayFile, backgroundFile, outputPath, renderMode, cfg,
                  useGPU, gpuVideoCodec, onProgress })
```

`render.js` gốc **giữ nguyên** (các tab cũ vẫn chạy). `render-core` là bản trích độc lập cho pipeline mới. (Tương lai có thể refactor render.js dùng chung — ngoài phạm vi.)

### 4.3 `channel-download.js` (wrap `download.js`)
- `downloadOne(url, outputDir, { proxy, cookiesFile })` → tải 1 URL vào `outputDir`, trả `{ filePath, title, thumbPath }`.
- Tái dùng options của `download.js` (format 720p mp4, `noOverwrites`, `writeThumbnail`, addHeader). Vì `download.js` hiện dùng biến global, bản wrap gọi trực tiếp `youtube-dl-exec` với options tương đương, truyền proxy/cookies theo tham số (không đụng file gốc).

### 4.4 `sheet-runner.js` (orchestrator)
Vòng đời: `start(config)` → poll định kỳ; `stop()`; `runNow(sheetName?)`. Phát event cho renderer: `channel-status`, `log`, `error`, `done`.

## 5. Mô hình dữ liệu

### 5.1 Sheet `⚙config` (1 dòng = 1 kênh)
Header ở dòng 1, dữ liệu từ dòng 2. Ô trống → dùng default global vid-master.

| Cột | Ý nghĩa | Áp dụng mode |
|---|---|---|
| `sheetName` | Tên sub-sheet chứa URL của kênh (bắt buộc) | tất cả |
| `enabled` | `TRUE`/`FALSE` | tất cả |
| `videosPerDay` | Số video tải+render mỗi ngày | tất cả |
| `renderMode` | `topTransparent`\|`chromaKey`\|`crop`\|`keepColor` | tất cả |
| `opacity` | 0–1 | topTransparent |
| `chromaColor` | hex 6 ký tự (vd `D4F9D7`) | chromaKey |
| `chromaSimilarity` | vd `0.3` | chromaKey |
| `keepColors` | hex, nhiều màu cách nhau bằng dấu phẩy | keepColor |
| `cropHeight`, `cropYOffset` | số px | crop, keepColor(crop) |
| `proxy` | (tùy chọn) override proxy download | tất cả |

Ví dụ:
```
sheetName | enabled | videosPerDay | renderMode     | opacity | chromaColor | chromaSimilarity | keepColors | cropHeight | cropYOffset
Kênh A    | TRUE    | 3            | topTransparent | 0.7     |             |                  |            |            |
Kênh B    | TRUE    | 5            | chromaKey      |         | D4F9D7      | 0.3              |            |            |
Kênh C    | FALSE   | 2            | keepColor      |         |             |                  | F6FF00     | 150        | 550
```

### 5.2 Sub-sheet mỗi kênh (chỉ URL)
- Cột `A` = URL (mỗi dòng 1 URL). Không header bắt buộc (dòng 1 có thể là header, runner bỏ qua nếu ô A1 không phải URL).
- Cột `B` = status do app ghi: rỗng = chưa xử lý; `done` = xong; `error: <lý do>` = lỗi.

### 5.3 Folder theo quy ước
Đặt **channels-root** 1 lần trong tab. Mỗi kênh:
```
<channels-root>/<sheetName>/
    backgrounds/   ← user bỏ video nền vào (bắt buộc ≥1 file .mp4)
    overlays/      ← app tải video về đây
    output/        ← app xuất video render xong
```
Thêm kênh = tạo folder + sub-sheet + 1 dòng ⚙config. Không đụng path nào trong UI.

### 5.4 State local `runner-state.json`
Cạnh channels-root:
```jsonc
{ "Kênh A": { "lastRunDate": "2026-07-07", "countToday": 2 } }
```
Kết hợp với status cột B ⇒ idempotent (không tải/render lại URL đã `done`), resume sau crash. Quota reset khi `lastRunDate` ≠ ngày lịch máy hiện tại.

## 6. Logic chạy (per poll / per runNow)

Cho mỗi kênh `enabled` trong ⚙config:

1. **Validate**: folder `<root>/<sheetName>/backgrounds` tồn tại và có ≥1 `.mp4`; nếu không → báo lỗi kênh, bỏ qua.
2. **Reset quota**: nếu `state.lastRunDate ≠ hôm nay` → `countToday = 0`, `lastRunDate = hôm nay`.
3. **Tính hạn mức**: `remaining = videosPerDay − countToday`. Nếu ≤ 0 → kênh xong hôm nay.
4. **Lấy URL**: đọc sub-sheet, lấy tối đa `remaining` URL có status cột B rỗng.
5. Cho mỗi URL (qua hàng đợi concurrency chung `p-limit`):
   a. **Download** → `overlays/`. Lấy `title` từ tên file tải về.
   b. **Render**: chọn ngẫu nhiên 1 file trong `backgrounds/`; `renderOne(overlay ⊕ background)` → `output/<title>.mp4` theo `renderMode` + params của kênh.
   c. Ghi cột B = `done`; `countToday++`; lưu state.
   d. Emit `{channel, outputPath, sourceUrl, title}` (hook GPM tương lai).
   e. Xóa/giữ overlay tạm: **xóa** overlay sau khi render OK (tránh phình đĩa; output đã có bản render).
6. Lỗi ở bất kỳ bước nào cho 1 URL: ghi cột B = `error: <ngắn gọn>`, log chi tiết, **không** tính vào `countToday`, chuyển URL kế tiếp.

**Concurrency**: 1 hàng đợi render chung toàn app (giới hạn `maxConcurrentProcesses`, mặc định 2) để nhiều kênh không nghẽn CPU/GPU. Download có limit riêng (mặc định 3).

## 7. UI — Tab "Theo dõi Sheet"

Thành phần:
- **Khối kết nối** (config 1 lần, lưu vào settings vid-master, không phải per-kênh):
  - `Spreadsheet ID`
  - `Service account JSON` (nút chọn file → `credentialsPath`)
  - `Channels root folder` (nút chọn folder)
  - `Poll interval` (giây, mặc định 300)
  - Toggle **"Tự chạy khi mở app"**
- **Nút**: `Start theo dõi` / `Stop`, `Chạy tất cả ngay`, `Đồng bộ ⚙config` (đọc lại config + kiểm tra folder).
- **Bảng trạng thái** (1 dòng/kênh): tên · badge `renderMode` · `hôm nay 2/3` · trạng thái (`chờ`/`đang tải`/`đang render`/`xong`/`lỗi`) · lỗi gần nhất.
- **Log realtime** (khung log cuộn, tái dùng style log hiện có).

Trigger tự động: khi app khởi động, nếu toggle "tự chạy khi mở app" bật → gọi `runNow()` cho mọi kênh chưa đủ quota hôm nay.

## 8. Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| Sai credentials / mất mạng Sheet | Báo lỗi ở khối kết nối, không crash; retry ở poll kế |
| Thiếu tab `⚙config` | Báo lỗi rõ, dừng, hướng dẫn tạo tab |
| Kênh trỏ sub-sheet không tồn tại | Đánh dấu kênh lỗi, bỏ qua, tiếp kênh khác |
| `backgrounds/` trống | Đánh dấu kênh lỗi "chưa có background", bỏ qua |
| Download 1 URL lỗi (proxy/cookies/geo) | Ghi cột B `error: ...`, log, sang URL kế |
| Render 1 URL lỗi (ffmpeg) | Như trên; giữ overlay để debug |
| App tắt giữa chừng | State + cột B đảm bảo resume, không tải/render trùng |

Tùy chọn: gửi Telegram khi kênh xong/lỗi (tái dùng bot sẵn có) — bật/tắt trong settings.

## 9. Hook GPM (tương lai)

Sau bước render, `sheet-runner` emit sự kiện `video-rendered` với payload `{ channel, outputPath, sourceUrl, title, thumbPath }`. Module upload (file auto của user) đăng ký nghe sự kiện này — **không sửa lõi** sheet-runner.

## 10. Kiểm thử

- **Unit**: parse `⚙config` (ô trống → default, mode-specific columns), parse URL/status, tính `remaining`, reset quota theo ngày, chọn background ngẫu nhiên.
- **Unit `render-core`**: `buildComplexFilter` sinh đúng chuỗi filter cho từng mode (so khớp với `render.js` gốc trên vài case).
- **Integration (thủ công)**: 1 sheet test 2 kênh, mỗi kênh 2–3 URL ngắn, chạy end-to-end → kiểm tra output/*.mp4, status cột B, state, resume sau khi kill giữa chừng.

## 11. Câu hỏi mở

- Định dạng tên file output khi `title` trùng nhau giữa 2 URL? → hậu tố index hoặc rowIndex.
- Có cần giới hạn tổng đĩa / dọn `output/` cũ không? (tạm: không, để user tự quản.)
- `channels-root` trên nhiều máy khác nhau: hiện giả định 1 máy. Nếu multi-máy sau này, cân nhắc chuyển folder mapping vào ⚙config.
