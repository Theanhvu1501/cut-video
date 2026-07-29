# Thông báo Telegram theo từng kênh (ảnh + kết quả trong một tin)

Ngày: 2026-07-29

## Vấn đề

Sau `c3491bf`, ảnh trang Nội dung của cả lượt được gộp vào **một** `sendMediaGroup`, caption gắn vào từng ảnh (`electron-main.js:1397`). Telegram chỉ hiển thị **một** caption cho cả album; caption của các ảnh còn lại phải mở từng ảnh mới thấy.

Bằng chứng từ người dùng: một lượt chạy 3 kênh → Telegram nhận **3 ảnh nhưng chỉ 1 dòng** `📋 kenh_10 — ✅ 1 lên lịch, ❌ 0 lỗi`. Ảnh không mất, thông tin của 2 kênh kia bị ẩn.

Trước commit đó là 3 tin `sendPhoto` riêng, mỗi tin có caption hiện rõ. Commit đổi sang album để tránh 429 — nhưng nguyên nhân 429 thật sự là **10 `sendPhoto` bắn liên tiếp trong một vòng `for`**, cách nhau vài chục milli giây. Album chữa được 429 nhưng đánh mất khả năng đọc.

Ngoài ra, cách gộp cuối lượt còn hai nhược điểm sẵn có:

- Ảnh chụp muộn: mọi kênh đều bị chụp ở cuối lượt, không phải lúc kênh đó vừa xong.
- Nhìn ảnh không biết nó của kênh nào, vì tên kênh chỉ nằm trong caption đang bị ẩn.

## Quyết định

Bỏ hẳn cách gộp cuối lượt. **Mỗi kênh xong → chụp ảnh kênh đó → gửi một tin duy nhất mang cả ảnh và kết quả của riêng kênh đó.** 10 kênh có việc làm là 10 tin.

Giới hạn ~1 tin/giây mỗi chat của Telegram không còn là rủi ro: các kênh xong cách nhau nhiều phút, nên các tin tự rải ra. `postWithRetry` (thêm ở `c3491bf`, giữ lại) vẫn lo phần 429 nếu có.

Hai quyết định do người dùng chốt:

- **Kênh không có video mới trong lượt → không gửi gì.** Không tốn ~20s chụp cho một kênh chẳng có gì để báo.
- **Vẫn giữ tin digest tổng cuối lượt** (`buildDigest`) để nhìn một tin là biết cả lượt, không phải cộng 10 tin.

Công tắc "Gửi kèm ảnh" (`gpmTelegramPhoto`) giữ nguyên ý nghĩa: **tắt** → chỉ có digest như hiện tại, không có tin từng kênh. Không đổi hành vi của người đang tắt nó.

## Thiết kế

### "Kênh đó xong" là lúc nào

`upload-queue.js` hiện chỉ có một biến `pending` toàn cục, nên chỉ biết *mọi* kênh đã rảnh. Nó không thể tự suy ra kênh A đã xong, vì trong lúc A upload thì runner vẫn đang render kênh B và có thể còn đẩy job mới vào.

Tín hiệu sạch nằm ở runner: các kênh được xử lý **tuần tự** (`sheet-runner.js:286`), nên khi `runChannel(A)` return thì lượt này chắc chắn không còn job nào của A. Runner báo tín hiệu đó xuống hàng đợi.

Thêm vào `createUploadQueue`:

```js
const pendingByChannel = new Map(); // sheetName -> số job đang chờ/chạy
const channelEnded = new Set();     // sheetName — runner đã báo hết job lượt này
const reported = new Set();         // sheetName — đã gửi tin trong lượt này
const reportTasks = new Set();      // Promise của các tin đang chụp/gửi
```

`beginRun()` xoá cả `channelEnded` và `reported` (cùng chỗ đang xoá `channelCache`).

Điều kiện gửi tin cho kênh X — cả ba phải đúng:

1. `channelEnded.has(X)` — runner đã báo hết job.
2. `(pendingByChannel.get(X) ?? 0) === 0` — chuỗi của X đã cạn.
3. `results.some((r) => r.sheetName === X)` — X có ít nhất một kết quả.

Kiểm tra ở hai chỗ: trong `endChannel(X)`, và trong `finally` của `enqueue` khi bộ đếm của kênh đó về 0. Chỗ nào tới sau thì chỗ đó gửi; `reported` chặn gửi hai lần.

```js
function maybeReportChannel(sheetName) {
  if (!notifyChannel) return;         // công tắc ảnh đang tắt → khỏi tốn ~20s chụp
  if (!channelEnded.has(sheetName) || (pendingByChannel.get(sheetName) ?? 0) > 0) return;
  if (reported.has(sheetName)) return;
  const mine = results.filter((r) => r.sheetName === sheetName);
  if (!mine.length) return;           // không có video mới → không gửi
  reported.add(sheetName);            // đồng bộ, trước mọi await: không gửi hai lần

  const task = sendChannelReport(sheetName, mine).finally(() => reportTasks.delete(task));
  reportTasks.add(task);
}

async function sendChannelReport(sheetName, mine) {
  cancelClose();                      // đừng để hẹn giờ đóng giết page giữa lúc chụp
  let image = null;
  const p = lastProfile.get(sheetName);
  const c = p && conns.get(p.profileId);
  if (!c) log(`[${sheetName}] không chụp được trang Nội dung — trình duyệt GPM đã đóng`);
  else {
    try { image = await capture(c.page, { log }); }
    catch (e) { log(`[${sheetName}] chụp trang Nội dung lỗi: ${e?.message || e}`); }
  }
  try { await notifyChannel(sheetName, mine, image); }
  catch (e) { log(`[${sheetName}] lỗi gửi Telegram: ${e?.message || e}`); }
  scheduleClose();                    // gửi xong mới tính lại giờ đóng trình duyệt
}

function endChannel(sheetName) { channelEnded.add(sheetName); maybeReportChannel(sheetName); }
```

Hai tính chất quan trọng của `maybeReportChannel`:

- Nó lọc `results` và `reported.add` **trước mọi `await`**, nên hai lời gọi tới cùng lúc (từ `endChannel` và từ `finally` của job cuối) không thể gửi hai lần, và digest có `splice` mảng `results` giữa chừng thì tin của kênh cũng đã giữ được bản sao của mình.
- Nó **không** `await` việc chụp/gửi. Runner gọi `endChannel` rồi đi làm kênh kế tiếp ngay, không phải đứng chờ ~20s chụp ảnh.

`sendChannelReport` **không** `splice` mảng `results` — chỉ đọc lọc. Digest cuối lượt vẫn `splice` cả mảng như hiện tại, nên tổng của digest vẫn đủ mọi kênh.

### Thứ tự tin: digest đi sau cùng

Kênh cuối xong → `pending` về 0 → hẹn giờ digest 3s (`flushMs`), trong khi tin của kênh đó còn đang chụp (~20s). Nếu không xử lý, digest tổng sẽ tới **trước** tin của kênh cuối.

Nên callback của `scheduleFlush` chờ các tin còn đang bay trước khi gửi digest:

```js
await Promise.all([...reportTasks]);   // các tin từng kênh đi trước
if (notifyDigest) { … }
```

`drain()` cũng chờ `reportTasks` (test và lúc tắt app cần đợi tin gửi xong).

`cancelClose()`/`scheduleClose()` bọc quanh mỗi lần chụp giữ đúng cách phòng thủ mà `sendShots` đang có (`upload-queue.js:141-143`): với `gpmIdleCloseMin` nhỏ, hẹn giờ đóng có thể nổ giữa lúc chụp và giết `page`.

### `sheet-runner.js`

`runChannel` có nhiều đường thoát sớm (proxy lỗi → `return`, không có background → `return`), nên `endChannel` phải nằm trong `finally` bọc toàn thân hàm:

```js
async function runChannel(ch, today) {
  if (!ch.enabled) return;
  try { /* … thân hàm hiện tại … */ }
  finally { if (uploadQueue) uploadQueue.endChannel(ch.sheetName); }
}
```

Không `await` — `endChannel` là hàm đồng bộ và không bao giờ ném lỗi; việc chụp/gửi chạy nền để runner đi tiếp kênh sau ngay.

Kênh thoát sớm thì không có kết quả nào, nên `maybeReportChannel` tự dừng ở điều kiện `mine.length` — không gửi tin rỗng.

### `sheet/telegram-notify.js`

Thêm hàm thuần `buildChannelReport(sheetName, results)`, thay `buildShotCaption`:

```
📋 kenh_10 — ✅ 2 lên lịch, ❌ 0 lỗi
• Tiêu đề A → 30/07 08:00
• Tiêu đề B → 30/07 18:00
```

- Dòng đầu: tên kênh + số thành công/lỗi.
- Mỗi thành công một dòng `• <title> → <giờ lịch>`, giờ lấy qua `formatSchedule(scheduleISO)`.
- Mỗi lỗi một dòng `• ❌ <title>: <error>`.
- Cắt ở `CAPTION_MAX` (1024). Khi phải cắt, dòng cuối là `… và N video nữa` để không có dòng bị cắt dở.

Xoá `sendTelegramMediaGroup` và `buildShotCaption` — sau thay đổi này không còn ai gọi. `postWithRetry`, `sendTelegram`, `sendTelegramPhoto` giữ nguyên.

### `electron-main.js`

Thay dep `notifyShots` bằng `notifyChannel`:

```js
notifyChannel: !(s.gpmTelegramEnabled && s.gpmTelegramPhoto) ? null : async (sheetName, results, image) => {
  if (!s.gpmTelegramToken || !s.gpmTelegramChatId) return;
  const caption = buildChannelReport(sheetName, results);
  const r = image
    ? await sendTelegramPhoto(s.gpmTelegramToken, s.gpmTelegramChatId, image, caption)
    : await sendTelegram(s.gpmTelegramToken, s.gpmTelegramChatId, caption);
  if (!r.ok) emitEvent({ type: "log", message: `Telegram [${sheetName}] lỗi: ${r.error || "?"}` });
},
```

Chụp thất bại (`image === null`) vẫn gửi tin chữ: mất ảnh không được làm mất kết quả.

### Xoá khỏi `upload-queue.js`

`sendShots` và dep `notifyShots` biến mất; `scheduleFlush` chỉ còn gửi digest (sau khi chờ `reportTasks`). `lastProfile` giữ lại — `sendChannelReport` cần nó để tìm `page`.

## Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| Trình duyệt GPM đã đóng khi tới lúc chụp | Log, gửi tin chữ không ảnh |
| `captureContentPage` ném lỗi (timeout, chưa login) | Log, gửi tin chữ không ảnh |
| `sendTelegramPhoto` trả `ok: false` | Log ra panel UI; không thử lại ngoài 3 lượt của `postWithRetry` |
| Kênh thoát sớm vì lỗi cấu hình | `endChannel` vẫn được gọi trong `finally`; không có kết quả nên không gửi |
| Một lượt chạy mới bắt đầu khi tin chưa gửi xong | `beginRun()` xoá `reported`/`channelEnded`; tin đang bay không bị ảnh hưởng |

## Test

`tests/telegram-notify.test.js`

- `buildChannelReport`: đếm đúng thành công/lỗi; có dòng giờ lịch đúng định dạng; có dòng lỗi; cắt ở 1024 ký tự và kết bằng `… và N video nữa`.
- Xoá các test của `sendTelegramMediaGroup`.

`tests/upload-queue.test.js`

- Kênh có kết quả: `notifyChannel` được gọi **đúng một lần**, với **chỉ** kết quả của kênh đó.
- Kênh 0 kết quả: `notifyChannel` **không** được gọi, và `capture` cũng không được gọi.
- `endChannel` tới trước khi job cuối xong → tin vẫn được gửi (kiểm tra cả hai thứ tự).
- Digest cuối lượt vẫn nhận **đủ** kết quả của mọi kênh sau khi từng kênh đã được báo.
- Digest được gửi **sau** mọi tin từng kênh (dùng `capture` chậm giả để bắt đúng thứ tự).
- `capture` ném lỗi → `notifyChannel` vẫn được gọi với `image === null`.
- `notifyChannel === null` (tắt công tắc ảnh) → `capture` không được gọi lần nào, digest vẫn gửi.

`tests/sheet-runner.test.js`

- `endChannel` được gọi cho mọi kênh, kể cả kênh thoát sớm vì proxy lỗi / không có background.

## Không thuộc phạm vi

Việc app không kiểm tra profile GPM có đúng kênh ghi trong Sheet hay không (`yt-upload.js:301` và `yt-capture.js:22` đều mở Studio trần rồi để redirect quyết định, cột `channelUrl` chưa được dùng) là **lỗi riêng, nặng hơn**, và có spec riêng. Thay đổi trong tài liệu này chỉ làm lỗi đó *dễ thấy* hơn (hai tin, hai tên kênh, ảnh giống hệt nhau) chứ không sửa nó.
