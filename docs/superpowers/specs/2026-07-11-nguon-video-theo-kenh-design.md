# Nguồn video theo từng kênh: tải mạng / lấy tại máy

**Ngày:** 2026-07-11
**Trạng thái:** Thiết kế, chờ duyệt

## Mục tiêu

Cho phép mỗi kênh chọn nguồn video độc lập:

- **Kênh tải** (hiện tại): tải video nguồn từ URL YouTube trong tab kênh, làm overlay.
- **Kênh lấy tại máy** (mới): lấy file video có sẵn trên máy làm overlay, không tải mạng.

Từ bước overlay trở đi (ghép lên background, chroma tự dò, cắt, render, upload) hai loại kênh **dùng chung code**.

## Nguyên tắc: kênh local = kênh tải, chỉ khác bước lấy overlay

Ưu tiên **đồng bộ tối đa với cơ chế Sheet** để retry hoạt động y như kênh tải. Kênh local dùng Sheet giống hệt kênh tải:

- **Tab kênh**: cột A = **tên file** (thay URL YouTube), cột B = trạng thái tải/render, cột C = trạng thái upload — không đổi cấu trúc.
- Toàn bộ máy móc sẵn có tái dùng nguyên vẹn: `decideAction`, resume-state, hạn mức/ngày, retry render (cột B), retry upload xuyên lượt (cột C), slot lịch (`readChannelUploads` đọc cột C).

**Chỗ khác duy nhất** so với kênh tải là bước "download" trong `runChannel`: thay vì `yt-dlp` tải URL thì copy file từ `inputs/` làm overlay.

## Quyết định thiết kế (đã chốt qua trao đổi)

1. File tại máy đóng vai trò **overlay** — vẫn render lên background như kênh tải, không phải video thành phẩm upload thẳng.
2. Kênh local **quản theo Sheet** như kênh tải (KHÔNG quản theo folder). "Done" nhận biết qua cột B ✅ + cột C ✅, nhất quán với kênh tải.
3. Khai báo mode bằng **cột mới trong ⚙config**, không đoán mò theo nội dung.
4. File nguồn trong `inputs/` chỉ được **copy** (không xóa, không di chuyển) — nguồn luôn còn để render lại.

## Cấu hình: cột "Nguồn video" trong ⚙config

Thêm canonical `videoSource` vào `HEADER_ALIASES` (sheets-service.js):

```
videoSource: ["nguồn video", "kiểu nguồn"],
```

Trong `parseConfigRows`, đọc ô và chuẩn hóa (bỏ dấu, thường hóa — dùng `norm` sẵn có):

- ô ∈ `{"tai may", "local", "may", "file"}` → `channel.videoSource = "local"`
- còn lại (kể cả trống) → `channel.videoSource = "download"`

Các kênh hiện có để trống cột này → `"download"` → hành vi cũ giữ nguyên. Kênh nào không thêm cột cũng không sao.

## Thư mục kênh

`ensureDirs(channelRoot)` (electron-main.js) trả thêm:

```
inputsDir: channelRoot/<kênh>/inputs
```

Tạo `inputsDir` (mkdir recursive) như đã làm với `overlaysDir`/`outputDir`. Người dùng thả `<tên>.mp4` (và tùy chọn `<tên>.jpg` làm thumbnail) vào `inputs/`, rồi ghi `<tên>.mp4` vào cột A của tab kênh.

## Luồng runner: rẽ nhánh tại bước lấy overlay

`runChannel` giữ nguyên toàn bộ khung: đọc URL sheet, `decideAction`, dọn dẹp, `upload-only`, `renderWork = slice(0, remaining)`, vòng render song song, retry, ghi cột B/C. Chỉ sửa hai điểm:

### 1. Proxy + delay: bỏ qua khi local

- Đầu `runChannel`, khối kiểm proxy (dừng kênh nếu proxy hỏng) chỉ chạy khi `videoSource !== "local"`. Proxy vô nghĩa với file tại máy.
- Trong vòng render, delay chống bot (`pickDownloadDelay`) chỉ áp cho kênh tải. Copy file local không cần delay.

### 2. Bước "download" (action `full`): rẽ theo `videoSource`

Hiện tại:

```js
dl = await downloadLimit(async () => { ...delay...; return downloader(item.url, overlaysDir, { proxy }); });
```

Thành:

```js
if (ch.videoSource === "local") {
  dl = copyLocalOverlay(item.url, inputsDir, overlaysDir); // item.url = tên file ở cột A
} else {
  dl = await downloadLimit(async () => { ...delay...; return downloader(item.url, overlaysDir, { proxy }); });
}
```

`copyLocalOverlay(fileName, inputsDir, overlaysDir)` (thuần, test được, inject qua deps):

- `src = inputsDir/<fileName>`. Không tồn tại → **ném lỗi** (`Không thấy file: <fileName>`). Lỗi này rơi vào nhánh catch `stage === "download"` sẵn có → ghi cột B lỗi, bump attempts, quá `MAX_ATTEMPTS` thì skipText. Hệt lỗi tải.
- `title` = tên file bỏ đuôi. `dest = overlaysDir/<fileName>`.
- Copy `src → dest`. Nếu `inputsDir/<title>.jpg` tồn tại → copy sang `overlaysDir/<title>.jpg` (để `prepareJob` tìm thấy thumb).
- Trả `{ filePath: dest, title }` — cùng shape với `downloader`.

Sau đó `patchEntry(... stage: "downloaded", filePath: dest ...)` và `setUrlStatus(... DOWNLOADED)` chạy y như kênh tải.

**File gốc trong `inputs/` không bị đụng.** Bản `overlays/<file>` bị `unlink` sau render (như kênh tải) không ảnh hưởng nguồn.

## Retry: dùng chung, không thêm gì

- **Render lỗi** → cột B lỗi → lượt sau `decideAction` → `full` → dọn overlay copy cũ + copy lại + render lại; `attempts` tăng, quá `MAX_ATTEMPTS` thì skip. Giống kênh tải.
- **Copy lỗi (thiếu file)** → cùng nhánh `stage === "download"`: xóa dấu vết filePath, ghi cột B lỗi, retry. Người dùng sửa tên file / thả file vào là lượt sau chạy tiếp.
- **Upload lỗi** → cột C lỗi → lượt sau `decideAction` → `upload-only` (overlay + output còn) → xếp lại upload **không render lại**. Đây là retry upload xuyên lượt, có sẵn nhờ cột C.
- **Slot lịch đăng**: `readChannelUploads` đọc cột C như thường → không double-book. Không cần sidecar.

## "Done" nhận biết ở đâu

Đúng như kênh tải: **cột B ✅ (đã render) + cột C ✅ (đã lên lịch)** trong tab kênh. Không có cơ chế mới, không đụng folder.

## Kiểm thử

- **sheets-service.test.js**: `parseConfigRows` đọc cột "Nguồn video" → `videoSource` đúng (`local` cho các biến thể, `download` khi trống/khác).
- **sheet-runner.test.js** (`runChannel` với dep bơm giả, `videoSource: "local"`):
  - file tồn tại → `copyLocalOverlay` được gọi, render nhận `overlayFile = overlays/<file>`, cột B set `DOWNLOADED` rồi `DONE`, `recordRendered` tăng, `enqueueUpload` được gọi. File gốc `inputs/` còn nguyên.
  - thiếu file → cột B ghi lỗi (prefix `ERR_DL`), attempts tăng; quá `MAX_ATTEMPTS` → skipText.
  - render lỗi → `upload-only`/retry ở lượt sau vẫn hoạt động (dùng lại test path sẵn có).
  - proxy/delay: kênh local không gọi `normalizeProxy`, không gọi `sleep` delay.
  - thumbnail sibling `<title>.jpg` → copy vào `overlays/`.
- Không cần test mới cho upload-queue (kênh local dùng đúng đường cột C như kênh tải).

## Phạm vi KHÔNG làm

- Không đổi luồng kênh tải (ngoài hai rẽ nhánh nhỏ trên).
- Không hỗ trợ upload thẳng (không render) — file local luôn là overlay.
- Không quản theo folder, không tự xóa/di chuyển file trong `inputs/`.
- Không UI mới; kênh local hiện trên card như kênh thường.
