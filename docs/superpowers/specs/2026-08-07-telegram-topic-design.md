# Gửi thông báo Telegram vào topic của group

Ngày: 2026-08-07

## Vấn đề

Nhiều máy cùng chạy VidMaster và cùng bắn thông báo vào một group Telegram. Tin của
các máy trộn lẫn nhau, không biết dòng nào của máy nào. Group đã bật Topics, nên
cách quản lý tự nhiên là mỗi máy gửi vào một topic riêng.

Hiện `sheet/telegram-notify.js` chỉ gửi `chat_id`, nên mọi tin rơi vào General.

## Phạm vi

Topic là cấu hình của **máy**, không phải của kênh: thêm đúng một ô "Topic ID"
trong Cài đặt app, áp cho mọi tin Telegram mà máy đó gửi.

Không đụng đến sheet `⚙config` — đã cân nhắc cột topic theo kênh và loại bỏ, vì
nhu cầu là tách theo máy chứ không theo kênh.

**Bắt buộc giữ nguyên hành vi cũ:** để trống Topic ID thì request phát ra phải
giống hệt hôm nay — không kèm `message_thread_id`, tin vào General.

## Thiết kế

### 1. `sheet/telegram-notify.js`

Tham số thứ 4 (hiện là `deps` cho test) nhận thêm `threadId`:

```js
sendTelegram(token, chatId, text, { threadId, fetch, sleep })
sendTelegramPhoto(token, chatId, photo, caption, { threadId, fetch, sleep })
```

Giữ nguyên vị trí tham số nên các lời gọi và test hiện có không phải sửa.

- `sendTelegram`: thêm `message_thread_id` vào body JSON khi parse ra số hợp lệ.
- `sendTelegramPhoto`: `form.append("message_thread_id", String(id))`, cũng chỉ khi hợp lệ.
- Không hợp lệ / trống / undefined → không thêm field nào.

Thêm hàm thuần `parseTopicId(value)`:

- `"45"` → `45`
- `"https://t.me/c/1234567890/45"` → `45` (cách lấy topic ID thực tế là chuột phải
  topic → Copy Link)
- `""`, `null`, `"abc"`, `"0"`, `"-5"` → `undefined`

Số phải đứng đầu chuỗi, sau `/` hoặc sau khoảng trắng — bắt chữ số cuối bất kể ký
tự đứng trước thì `"-5"` hoá thành topic 5.

### 2. Cài đặt app

- Khóa mới `gpmTelegramTopicId` (chuỗi) trong `sheet-settings.json`.
- `renderer.html`: input `sw-gpm-tg-topic`, placeholder `Topic ID (bỏ trống = General)`,
  đặt ngay sau `sw-gpm-tg-chat` trong `#sw-gpm-tg-fields`.
- `renderer.js`: nạp giá trị trong hàm fill settings, thêm vào `currentSettings()`,
  và đăng ký autosave `input` cùng nhóm với `sw-gpm-tg-token` / `sw-gpm-tg-chat`.

### 3. Nút "Gửi thử"

`preload.cjs` → `gpmTestTelegram(token, chatId, topicId)`; IPC `gpm:test-telegram`
nhận thêm `topicId` và truyền xuống `sendTelegram`. Nhờ đó xác nhận đúng topic
trước khi chạy thật. Topic sai hoặc group chưa bật Topics thì Telegram trả lỗi
(`message thread not found`) và nút hiện đúng lý do đó — không cần app tự đoán.

Điều kiện chặn của nút vẫn chỉ là thiếu token/chat ID; topic để trống là hợp lệ.

### 4. `electron-main.js`

Ba chỗ gửi trong `buildSheetRunner` truyền `{ threadId: parseTopicId(s.gpmTelegramTopicId) }`:

- `notifyDigest` — tin tổng khi hàng đợi upload rảnh (dòng ~1384)
- `notifyChannel` — bản có ảnh, `sendTelegramPhoto` (~1396)
- `notifyChannel` — bản dự phòng khi không chụp được ảnh, `sendTelegram` (~1397)

`s` đã được đọc một lần lúc dựng runner như các cấu hình khác; đổi Topic ID khi
đang chạy thì phải Dừng → Chạy lại, giống `gpmIdleCloseMin`.

### 5. Test — `tests/telegram-notify.test.js`

- `sendTelegram` có topic → body JSON chứa `message_thread_id: 45`.
- `sendTelegram` không có topic → body **không** có khóa `message_thread_id`.
- `sendTelegramPhoto` có topic → form có field `message_thread_id`.
- `sendTelegramPhoto` không có topic → form không có field đó.
- `parseTopicId`: số, link t.me, chuỗi rác, rỗng, `0`, số âm.

## Rủi ro

Gửi kèm `message_thread_id` vào group **chưa** bật Topics sẽ bị Telegram từ chối —
tin thông báo mất. Giảm thiểu bằng: mặc định trống (giữ hành vi cũ), và nút "Gửi
thử" cho kiểm chứng ngay. Lỗi gửi vẫn được log qua `emitEvent` như hiện tại.
