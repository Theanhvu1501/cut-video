# GPM Upload → Thumb → Schedule — Thiết kế (Giai đoạn 2)

Ngày: 2026-07-08
Nối tiếp: [Giai đoạn 1 — GPM Connect](2026-07-08-gpm-connect-design.md)

## Mục tiêu

Sau khi render xong video, tự động **upload lên YouTube (qua trình duyệt GPM của kênh) → thay thumbnail → lên lịch đăng**, theo một pipeline **serial** (mỗi kênh xử lý trọn vẹn 1 video rồi mới tới video kế). Bật/tắt qua toggle "Bật tự động GPM" đã có ở Giai đoạn 1.

## Quyết định thiết kế (đã chốt với user)

1. **Serial per-channel**: chỉ 1 video trong luồng YouTube tại một thời điểm cho mỗi kênh. Video render xong trong lúc đang bận thì xếp hàng đợi, KHÔNG upload song song. Chỉ khi video hiện tại đã lên lịch xong mới lấy video kế.
2. **Chờ đúng tín hiệu**: sau khi upload, phải **đợi tới lúc nút custom thumbnail thực sự enable** (không chỉ đợi thanh upload 100%), rồi mới thay thumb + lịch. Đây là chỗ hay vỡ nhất.
3. **Thumbnail match theo title**: chọn file thumb trong folder overlays của kênh khớp với title video.
4. **Slot giờ lấy từ Sheet `⚙config`**: thêm cột `postTimes` (vd `"8:00, 18:00"`) cho mỗi kênh.
5. **Lịch luôn bắt đầu từ ngày mai**: không bao giờ đăng trong hôm nay/giờ đã qua.
6. **State per-video** (`uploaded / thumbed / scheduled`) lưu local để resume/retry khi lỗi giữa chừng.

## Luồng

```
Mỗi kênh — hàng đợi render → upload (serial):
  Video render xong → enqueue

  Bộ upload (1 video/lần):
    1. Mở YouTube Studio (GPM profile của kênh) — dùng connect ở Giai đoạn 1
    2. Upload file video (set title từ tên file/title, desc nếu có)
    3. ĐỢI nút custom thumbnail enable (poll trạng thái)
    4. Thay thumbnail: chọn file trong overlays khớp title
    5. Lên lịch: slot kế tiếp (xem thuật toán) ở bước Visibility
    6. Bấm Xong → chờ xác nhận đã lưu
    → cập nhật state = scheduled, mới lấy video kế
```

## Mô hình dữ liệu

### Sheet `⚙config` — thêm 1 cột
- `postTimes` — alias: `"giờ đăng"`, `"lịch đăng"`, `"post times"`. Giá trị: danh sách giờ ngăn cách dấu phẩy, vd `"8:00, 18:00"`. Parser `sheets-service.js` đọc thành mảng chuẩn hoá `["08:00", "18:00"]`. Nên khớp số lượng với `videosPerDay` (không bắt buộc — nếu lệch thì dùng đúng số slot có).

### State file (local, cạnh state hiện có của sheet-runner)
Mỗi kênh:
```json
{
  "<sheetName>": {
    "nextScheduleAt": "2026-07-09T08:00:00+07:00",
    "videos": {
      "<videoKey>": { "title": "...", "file": "...", "status": "uploaded|thumbed|scheduled", "scheduledAt": "..." }
    }
  }
}
```
`videoKey` = đường dẫn file output (duy nhất). `status` cho phép resume: lỗi ở thumb → lần sau tiếp tục từ thumb; lỗi ở schedule → tiếp tục từ schedule.

## Thuật toán slot lịch (hàm thuần, unit-test được)

`computeNextSlot(nextScheduleAt, postTimes, now) -> { slotISO, newNextScheduleAt }`

- `postTimes` = mảng giờ trong ngày, vd `["08:00","18:00"]`.
- Baseline: slot sớm nhất hợp lệ là **ngày mai** (so với `now`). Nếu `nextScheduleAt` rỗng hoặc rơi vào quá khứ / hôm nay → đặt lại = **ngày mai + postTimes[0]**.
- Trả slot hiện tại (`slotISO`) và tính `newNextScheduleAt` = slot kế tiếp: cùng ngày nếu còn giờ sau trong `postTimes`, hết thì sang **ngày kế + postTimes[0]**.
- Tách bạch khỏi DOM → test bằng cách bơm `now` cố định (giống cách repo bơm `sharp`/`fetch` trong test).

Ví dụ: `postTimes=["08:00","18:00"]`, now=`2026-07-08 15:00`:
- video1 → `2026-07-09 08:00`, next=`2026-07-09 18:00`
- video2 → `2026-07-09 18:00`, next=`2026-07-10 08:00`
- video3 → `2026-07-10 08:00`, ...

## Kiến trúc code (đề xuất, chốt chi tiết ở plan)

Tách **logic điều phối (test được)** khỏi **driver DOM (fragile, test thủ công)**:

- `sheet/schedule-slots.js` — hàm thuần `computeNextSlot`, `parsePostTimes`. **Unit test đầy đủ.**
- `sheet/thumb-match.js` — hàm thuần chọn file thumb khớp title (từ danh sách file overlays). **Unit test.**
- `sheet/yt-upload.js` — driver playwright điều khiển YouTube Studio: `uploadVideo`, `waitThumbnailEnabled`, `setThumbnail`, `setSchedule`. Dùng `page` từ context GPM (mở rộng `gpm-client.js`). **Test thủ công** (selector phụ thuộc DOM YouTube).
- `sheet/upload-queue.js` — hàng đợi serial per-channel + máy trạng thái + đọc/ghi state + resume. Điều phối gọi các module trên. **Unit test phần logic hàng đợi/trạng thái bằng driver giả (inject).**
- Nối vào `sheet-runner.js`: khi `video-rendered` → enqueue nếu `gpmEnabled`.

## Lấy selector DOM (bắt buộc làm trước khi build driver)

YouTube Studio nằm sau đăng nhập + là SPA render JS → không thể lấy selector từ ngoài (WebFetch không thấy DOM sau login). Selector còn đổi theo ngôn ngữ/A-B test. Cách lấy ground-truth:

- **Task 0 — Script dò DOM** `sheet/yt-inspect.js`: dùng kết nối GPM đã có (Giai đoạn 1) → mở luồng upload → in ra element ứng viên (role/aria-label/id/selector) + snapshot HTML từng bước (Details, thumbnail, Visibility/Schedule). **User chạy trên máy đã login GPM** → thu selector thật.
- WebSearch selector YouTube Studio phổ biến (vd `ytcp-uploads-file-picker input[type=file]`, nút thumbnail, radio "Lên lịch") chỉ làm **mốc khởi đầu**; script dò xác nhận lại theo UI thật của user.
- Mọi selector cuối cùng gom vào 1 map trong `yt-upload.js` để dễ sửa khi UI đổi.

## Rủi ro & giảm thiểu

- **Selector DOM YouTube đổi/khác ngôn ngữ**: gom selector vào 1 chỗ trong `yt-upload.js`, ưu tiên `getByRole`/aria hơn class; test thủ công trên tài khoản thật.
- **Nút thumbnail chưa bật**: bước 3 poll có timeout + retry; nếu quá timeout → đánh dấu `uploaded` (chưa thumb) để quét lại sau, không kẹt cả hàng đợi.
- **Nghi bot**: giữ giãn cách 60-120s đã có; serial 1 video/lần.
- **Trùng lịch giữa các lần chạy**: `nextScheduleAt` persist + luôn kẹp ≥ ngày mai.

## Ngoài phạm vi
- Upload song song nhiều video/kênh.
- Tự sinh title/description bằng AI (dùng title sẵn có).
- Chỉnh sửa video sau khi đã lên lịch.
