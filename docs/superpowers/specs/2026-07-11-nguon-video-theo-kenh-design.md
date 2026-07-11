# Nguồn video theo từng kênh: tải mạng / lấy tại máy

**Ngày:** 2026-07-11
**Trạng thái:** Thiết kế, chờ duyệt

## Mục tiêu

Cho phép mỗi kênh chọn nguồn video độc lập:

- **Kênh tải** (hiện tại): tải video nguồn từ URL YouTube trong tab kênh, làm overlay.
- **Kênh lấy tại máy** (mới): lấy file video có sẵn trên máy làm overlay, không tải mạng, không cần Sheet.

Từ bước overlay trở đi (ghép lên background, chroma tự dò, cắt, render, upload) hai loại kênh **dùng chung code**.

## Quyết định thiết kế (đã chốt qua trao đổi)

1. File tại máy đóng vai trò **overlay** — vẫn render lên background như kênh tải, không phải video thành phẩm để upload thẳng.
2. Kênh local **quản theo folder**, không dùng Sheet: thả file vào `inputs/`, xong thì file tự chuyển sang `inputs/done/`.
3. **Done = file nằm trong `inputs/done/`.** Còn trong `inputs/` = chưa làm hoặc đang chờ thử lại.
4. Không xóa file (chuyển, không xóa) để giữ khả năng render lại và không mất nguồn khi upload hỏng.
5. Khai báo mode bằng **cột mới trong ⚙config**, không đoán mò theo nội dung.

## Cấu hình: cột "Nguồn video" trong ⚙config

Thêm canonical `videoSource` vào `HEADER_ALIASES` (sheets-service.js):

```
videoSource: ["nguồn video", "kiểu nguồn"],
```

Trong `parseConfigRows`, đọc ô và chuẩn hóa (bỏ dấu, thường hóa — dùng `norm` sẵn có):

- ô ∈ `{"tai may", "local", "may", "file"}` → `channel.videoSource = "local"`
- còn lại (kể cả trống) → `channel.videoSource = "download"`

Các kênh hiện có để trống cột này → `"download"` → hành vi cũ giữ nguyên. Kênh nào không muốn thêm cột cũng không sao.

## Thư mục kênh local

`ensureDirs(channelRoot)` (electron-main.js) trả thêm:

```
inputsDir:     channelRoot/<kênh>/inputs
inputsDoneDir: channelRoot/<kênh>/inputs/done
```

Tạo `inputsDir` + `inputsDoneDir` (mkdir recursive) như đã làm với `overlaysDir`/`outputDir`. `runLocalChannel` là nơi dùng chúng; kênh tải không đụng tới.

Người dùng thả `<tên>.mp4` (và tùy chọn `<tên>.jpg` làm thumbnail) vào `inputs/`.

## Luồng runner: tách nhánh `runLocalChannel`

Đầu `runChannel`, sau khi kiểm `ch.enabled`:

```js
if (ch.videoSource === "local") return runLocalChannel(ch, today);
```

Nhánh download giữ nguyên hoàn toàn.

### `runLocalChannel(ch, today)`

1. `ensureDirs` → lấy `backgroundsDir, overlaysDir, outputDir, inputsDir, inputsDoneDir`.
2. Kiểm background (giống download): không có `.mp4` trong `backgrounds/` → emit lỗi, dừng kênh.
3. `remaining = computeRemaining(state[ch.sheetName], ch.videosPerDay, today)`.
4. Liệt kê video chưa làm: `.mp4` trong `inputsDir` (KHÔNG đệ quy vào `done/`), sắp theo tên (ổn định, test được), rồi `slice(0, remaining)`.
5. Rỗng → emit `channel-status` (`"đủ hôm nay"` nếu `remaining <= 0`, ngược lại `"hết video mới"`), dừng.
6. Với mỗi file (giới hạn song song `pLimitFn(config.renderConcurrency)`):
   - `title` = tên file bỏ đuôi. `outputPath = output/<title>.mp4`.
   - `overlayFile` = `inputs/<file>` (dùng thẳng, KHÔNG copy — sẽ chuyển đi, không xóa).
   - Ghép `cfg` từ `ch.cfg` + `config.videoSpeed`; nếu `renderMode === "chromaKeyAuto"` và có `chromaPalette` thì `detectChroma(overlayFile, palette)` (bọc try/catch như download).
   - emit `"đang render"` → `renderer({ overlayFile, backgroundFile, outputPath, renderMode, cfg, useGPU, gpuVideoCodec })`.
   - Render xong:
     - `recordRendered(state, ch.sheetName, today)` + save (tính vào hạn mức/ngày, khóa load-modify-save đồng bộ như download).
     - **Chuyển** `inputs/<file>` → `inputs/done/<file>`. Nếu có `inputs/<title>.jpg`: copy sang `overlays/<title>.jpg` (để `prepareJob` tìm thấy thumb) **rồi** chuyển bản gốc jpg sang `done/`.
     - emit `video-rendered`.
     - `enqueueUploadLocal(ch, { outputPath, title }, overlaysDir)` (xem dưới).
   - Render lỗi: emit `error`, **để nguyên file trong `inputs/`** (tự thử lại lượt sau). Không dùng resume-state, không bump attempts — folder chính là hàng chờ.

Không proxy, không delay tải, không đọc/ghi Sheet, không resume-state cho kênh local.

## Upload cho kênh local

`enqueueUpload` hiện gắn `rowIndex`/`sourceUrl` từ dòng Sheet. Kênh local không có, nên thêm biến thể (hoặc cho phép các trường null):

```js
uploadQueue.enqueue({
  sheetName: ch.sheetName, gpmHost: config.gpmHost, profileId: ch.gpmProfileId,
  videoPath: outputPath, overlaysDir, title, postTimes: ch.postTimes,
  locale: config.gpmLocale, rowIndex: null, sourceUrl: null, local: true,
});
```

Trong `upload-queue.js runJob`, các trường này đã an toàn khi null:
- `if (sourceUrl && ...)` — bỏ qua dedup theo URL (folder đã lo dedup: file đã ở `done/`).
- `writeStatus` đã `return` sớm khi `rowIndex == null` — không ghi Sheet.
- `if (sourceUrl) ch.scheduledUrls.add(...)` — bỏ qua.

Điều kiện enqueue vẫn cần GPM bật + `gpmProfileId` + `postTimes` (như download); thiếu thì không upload, nhưng video **vẫn** đã render + đã chuyển sang `done/` (render là phần đắt, coi như done).

### Slot lịch đăng: file phụ `.upload-state.json`

Vấn đề: kênh tải nhớ slot ngày mai đã chiếm bằng cách đọc lại cột C. Kênh local không có Sheet → chạy nhiều lượt/ngày dễ xếp trùng giờ.

Giải pháp: sidecar `channelRoot/<kênh>/.upload-state.json`:

```json
{ "date": "2026-07-11", "usedSlots": ["2026-07-12T08:00:00+07:00"] }
```

- `readChannelUploads(sheetName)` (dep của upload-queue, wire ở electron-main): với kênh **local**, đọc sidecar thay vì Sheet — trả `{ scheduledUrls: new Set(), usedSlots }` (bỏ qua `usedSlots` nếu `date` khác hôm nay).
- Khi upload thành công, upload-queue gọi callback mới `onScheduled?.({ sheetName, scheduleISO, local })`; electron-main ghi `scheduleISO` vào sidecar cho kênh local. Đây là seam nhỏ, rõ, không đụng đường ghi Sheet của kênh tải.

electron-main biết kênh nào local vì đã parse `⚙config` (tra `videoSource` theo `sheetName`).

## Hạn chế đã biết (v1)

Upload của kênh local chỉ thử lại **3 lần trong hàng đợi** (`retries`). Hỏng hẳn: video render nằm ở `output/`, nguồn ở `inputs/done/`, lỗi báo trên UI + digest Telegram — nhưng **không tự upload lại ở lượt sau** (file đã rời `inputs/`). Kênh tải có retry xuyên lượt nhờ cột C. Nếu cần retry upload xuyên lượt cho local, làm sau (ví dụ: theo dõi trạng thái upload trong sidecar và chuyển file về `inputs/` khi cần render lại).

## Kiểm thử

- **sheets-service.test.js**: `parseConfigRows` đọc cột "Nguồn video" → `videoSource` đúng (`local` cho các biến thể, `download` khi trống/khác).
- **sheet-runner.test.js**: `runLocalChannel` với dep bơm giả:
  - file tồn tại → render được gọi với `overlayFile = inputs/<file>`, `recordRendered` tăng, file chuyển sang `done/`, `enqueue` được gọi với `rowIndex/sourceUrl = null`.
  - render lỗi → file **vẫn** trong `inputs/`, không chuyển `done/`.
  - hạn mức: chỉ xử `remaining` file đầu.
  - thumbnail sibling `<title>.jpg` → copy vào `overlays/`, gốc chuyển `done/`.
- **upload-queue.test.js**: job `local: true` với `rowIndex/sourceUrl = null` không gọi `setUploadStatus`, không đụng `scheduledUrls`; `onScheduled` được gọi khi thành công.
- Slot sidecar: đọc/ghi `.upload-state.json`, reset khi `date` đổi (test đơn vị riêng cho hàm đọc/ghi sidecar).

## Phạm vi KHÔNG làm

- Không đổi luồng kênh tải.
- Không hỗ trợ upload thẳng (không render) — file local luôn là overlay.
- Không retry upload xuyên lượt cho local (xem Hạn chế).
- Không UI mới; kênh local hiện trên card như kênh thường (số liệu Sheet có thể trống — chấp nhận).
