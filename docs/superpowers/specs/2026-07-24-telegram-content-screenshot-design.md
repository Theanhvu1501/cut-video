# Gửi ảnh trang Nội dung Studio kèm digest Telegram

Ngày: 2026-07-24

## Vấn đề

Digest Telegram hiện tại (`sheet/telegram-notify.js` → `buildDigest`) chỉ báo số đếm: `✅ 3 lên lịch | ❌ 0 lỗi`. Con số này lấy từ kết quả của `uploadAndSchedule` — mà hàm đó chỉ biết nó **đã click** nút thay thumbnail, không biết YouTube có thật sự nhận ảnh hay không.

Hệ quả: thumbnail hỏng kiểu "click được nhưng YouTube không áp dụng" báo `ok: true`, digest vẫn xanh, và chỉ phát hiện được khi mở máy vào Studio nhìn tận mắt.

Cần một bằng chứng hình ảnh gửi thẳng vào Telegram để người dùng biết kênh nào phải vào sửa tay, không phải ngồi vào máy để kiểm tra.

## Quyết định

Xong toàn bộ hàng đợi upload → với **mỗi kênh có video trong lượt**, mở lại trang Nội dung của kênh đó trong chính trình duyệt GPM đang dùng, chụp màn hình, gửi kèm digest.

Trang Nội dung (`/channel/<ID>/videos/upload`) liệt kê video mới nhất trước, mỗi dòng có ô thumbnail thật YouTube đang phục vụ và cột trạng thái `Đã lên lịch <giờ>`. Một ảnh phủ được toàn bộ loạt video vừa đăng của kênh.

Các phương án đã cân nhắc và loại:

- **Chụp trong hộp thoại upload từng video** (sau b3/b4, hoặc hộp xác nhận sau khi bấm Xong): 1 ảnh/video, số ảnh tăng theo số video, và ảnh chỉ chứng minh trạng thái ngay lúc đó chứ không phải trạng thái YouTube chốt lại.
- **Chụp cửa sổ Electron** (`webContents.capturePage`): chỉ thấy bảng trạng thái nội bộ của app — đúng bằng thông tin digest text đã có, không thêm gì.

## Thời điểm chụp

Đúng điểm `scheduleFlush()` đang gửi digest: `runActive === false && pending === 0`, sau `flushMs` (3s). Ba lý do:

1. Hàng đợi rảnh nên không job nào đang giữ `page` — điều hướng trang không cắt ngang upload.
2. `conns` vẫn còn mở: `idleCloseMs` mặc định 10 phút, xa hơn 3s rất nhiều.
3. Digest và ảnh về cùng một lúc, một lần điện thoại reo.

Nếu một lượt chạy mới bắt đầu ngay sau đó thì job đầu tiên cũng `page.goto("https://studio.youtube.com")` (`yt-upload.js:301`), nên trang bị điều hướng đi không gây hại.

## Thiết kế

### `sheet/yt-capture.js` (mới)

```js
export async function captureContentPage(page, {
  settleMs = 5000,
  timeoutMs = 60_000,
  log = () => {},
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  await page.goto("https://studio.youtube.com", { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const m = /\/channel\/([^/?#]+)/.exec(page.url());
  if (!m) throw new Error(`Không lấy được channel ID từ URL Studio (${page.url()}) — có thể chưa login.`);
  await page.goto(`https://studio.youtube.com/channel/${m[1]}/videos/upload`, {
    waitUntil: "domcontentloaded", timeout: timeoutMs,
  });
  // Chờ bảng video xuất hiện; hỏng selector cũng không chặn — vẫn chụp, ảnh lỗi cũng là thông tin.
  try { await page.waitForSelector("ytcp-video-row", { timeout: 20_000 }); }
  catch { log("   … không thấy dòng video nào trên trang Nội dung — vẫn chụp"); }
  await sleep(settleMs); // ảnh thumbnail lazy-load, chờ tải xong mới chụp
  return await page.screenshot({ type: "png" });
}
```

`studio.youtube.com` chuyển hướng về `/channel/<ID>` của profile đang đăng nhập; đọc `page.url()` là cách duy nhất biết channel ID mà không cần gọi API YouTube. Đây cũng chính là cách `yt-upload.js` vào Studio, nên tái dùng phiên login sẵn có của GPM.

Chụp mặc định là **viewport**, không `fullPage`. `connectOverCDP` cho context `viewport: null` nên `page.setViewportSize()` sẽ ném lỗi — kích thước ảnh bằng đúng kích thước cửa sổ GPM. Ảnh viewport phủ ~5–8 dòng đầu, tức là các video mới đăng, đúng thứ cần soi. `fullPage: true` sẽ tạo ảnh rất cao (30 dòng/trang) và Telegram nén tới mức không đọc nổi.

`sleep` tiêm được để test không phải chờ thật.

### `sheet/telegram-notify.js`

Thêm hàm mới cạnh `sendTelegram`, không đụng hàm cũ:

```js
export async function sendTelegramPhoto(token, chatId, photo, caption, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  if (!token || !chatId) return { ok: false, error: "thiếu token/chatId" };
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption.slice(0, 1024)); // giới hạn caption của Telegram
  form.append("photo", new Blob([photo], { type: "image/png" }), "content.png");
  const res = await fetchFn(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  return { ok: !!data.ok, error: data.description };
}
```

KHÔNG đặt header `Content-Type` — `fetch` phải tự sinh `boundary` của multipart. `FormData`/`Blob` là global từ Node 18, mà Electron 28 chạy Node 18.x; `sendTelegram` đã dùng global `fetch` chạy tốt nên nền tảng đã được chứng minh.

Caption từng ảnh, hàm thuần cạnh `buildDigest`:

```js
export function buildShotCaption(sheetName, results) {
  const mine = results.filter((r) => r.sheetName === sheetName);
  const ok = mine.filter((r) => r.ok).length;
  return `📋 ${sheetName} — ✅ ${ok} lên lịch, ❌ ${mine.length - ok} lỗi`;
}
```

Gửi **từng ảnh một** bằng `sendPhoto`, không dùng `sendMediaGroup`. Mỗi kênh một ảnh nên số tin bằng số kênh (thường 2–5); album lại buộc dựng mảng JSON `media` + `attach://` và chỉ cho một caption chung, mất nhãn tên kênh trên từng ảnh.

### `sheet/upload-queue.js`

State mới: `const lastProfile = new Map();` — `sheetName → { gpmHost, profileId }`. `results` chỉ mang tên kênh, không mang thông tin profile, nên `runJob` ghi lại ngay khi nhận job:

```js
lastProfile.set(sheetName, { gpmHost, profileId });
```

Dep mới: `notifyShots = null,   // async (shots[], batch[]) — shots: [{ sheetName, image: Buffer }]`
Tuỳ chọn mới: `capture = captureContentPage,` (tiêm được để test)

`scheduleFlush()` đổi thành:

```js
flushTimer = setTimeout(async () => {
  if (runActive || pending > 0 || !results.length) return;
  const batch = results.splice(0, results.length);
  if (notifyDigest) {
    try { await notifyDigest(batch); } catch (e) { log(`Lỗi gửi Telegram: ${e?.message || e}`); }
  }
  await sendShots(batch);
}, flushMs);
```

```js
// Chụp trang Nội dung của từng kênh trong lượt rồi gửi kèm digest.
async function sendShots(batch) {
  if (!notifyShots || closing) return;
  cancelClose();                       // chụp mất ~20s/kênh, không để hẹn giờ đóng giết page giữa chừng
  const shots = [];
  for (const sheetName of new Set(batch.map((r) => r.sheetName))) {
    const p = lastProfile.get(sheetName);
    const c = p && conns.get(p.profileId);
    if (!c) { log(`[${sheetName}] không chụp được trang Nội dung — trình duyệt GPM đã đóng`); continue; }
    try {
      shots.push({ sheetName, image: await capture(c.page, { log }) });
    } catch (e) {
      log(`[${sheetName}] chụp trang Nội dung lỗi: ${e?.message || e}`);
    }
  }
  if (shots.length) {
    try { await notifyShots(shots, batch); } catch (e) { log(`Lỗi gửi ảnh Telegram: ${e?.message || e}`); }
  }
  scheduleClose();                     // chụp xong mới tính lại giờ đóng trình duyệt
}
```

Ba điểm cố ý:

- **`cancelClose()` trước, `scheduleClose()` sau.** `scheduleClose()` được gọi cùng lúc với `scheduleFlush()` (`upload-queue.js:210,224`) nên hẹn giờ đóng đã chạy trước khi chụp bắt đầu. Với `gpmIdleCloseMin` nhỏ (1 phút) và nhiều kênh, `closeIdleConns()` có thể nổ giữa lúc đang chụp và giết `page`. Huỷ rồi hẹn lại từ đầu là cách rẻ nhất, và cũng đúng ngữ nghĩa: đang chụp thì trình duyệt chưa rảnh.
- **Chỉ tái dùng `conns.get()`, không gọi `getConn()`.** Trình duyệt đã đóng thì bỏ qua ảnh kênh đó, tuyệt đối không tự mở lại profile GPM chỉ để chụp một tấm ảnh — mở profile tốn 10–20s và gây bất ngờ.
- **Chụp tuần tự, không `Promise.all`.** Mỗi kênh là một profile GPM riêng, chạy song song sẽ mở nhiều Chrome nặng máy cùng lúc; và số kênh nhỏ nên tổng thời gian vẫn chấp nhận được.

### `electron-main.js`

Cạnh `notifyDigest` (dòng 1379), thêm:

```js
notifyShots: async (shots, batch) => {
  if (!s.gpmTelegramEnabled) return;
  if (!s.gpmTelegramToken || !s.gpmTelegramChatId) return;
  for (const { sheetName, image } of shots) {
    const r = await sendTelegramPhoto(
      s.gpmTelegramToken, s.gpmTelegramChatId, image, buildShotCaption(sheetName, batch));
    if (!r.ok) emitEvent({ type: "log", message: `Telegram ảnh lỗi: ${r.error || "?"}` });
  }
},
```

Import thêm `sendTelegramPhoto, buildShotCaption` ở dòng 17.

**Không thêm ô cài đặt mới.** Dùng chung công tắc `gpmTelegramEnabled` + token/chat ID sẵn có: tắt Telegram là tắt luôn ảnh. Một công tắc riêng cho ảnh chỉ có nghĩa khi người dùng muốn digest mà không muốn ảnh — chưa có nhu cầu đó, YAGNI.

## Xử lý lỗi

Nguyên tắc: **ảnh hỏng không bao giờ được làm hỏng digest.** Digest text gửi xong trước khi khâu chụp bắt đầu, nên kể cả toàn bộ khâu chụp sập thì thông báo vẫn về đúng như bản hiện tại.

| Tình huống | Hành vi |
|---|---|
| Trình duyệt GPM đã đóng | Bỏ qua kênh đó, ghi log, các kênh khác vẫn chụp |
| `goto`/`screenshot` timeout, page chết | Bắt lỗi từng kênh, ghi log, không ném ra ngoài |
| Chưa login (URL không có `/channel/`) | Ném lỗi từ `captureContentPage`, bị bắt và ghi log |
| YouTube đổi giao diện, không thấy `ytcp-video-row` | **Vẫn chụp và vẫn gửi** — ảnh trang lạ cũng là thông tin cần biết |
| `sendPhoto` lỗi HTTP/Telegram | Ghi log vào tab Theo dõi Sheet, không retry |

## Giới hạn đã biết

Ảnh chỉ phủ phần trang lọt trong cửa sổ GPM. Kênh đăng nhiều hơn ~8 video trong một lượt thì các video cũ nhất của lượt sẽ nằm ngoài khung. Cách xử lý khi cần: phóng to cửa sổ GPM. Nếu sau này thật sự cần thì đổi sang `fullPage: true` là một dòng, nhưng mặc định không chọn vì Telegram nén ảnh quá cao thành không đọc được.

## Test

Bám khuôn hiện có: `node --test`, không fake timers, dep tiêm qua tham số.

### `tests/telegram-notify.test.js` — thêm

1. `sendTelegramPhoto` thiếu token/chatId → `{ ok: false, error: "thiếu token/chatId" }`, không gọi `fetch`.
2. Đường thành công với `fetch` giả: URL đúng `https://api.telegram.org/bot<TOK>/sendPhoto`, body là `FormData`, có field `chat_id`, `caption`, `photo`; **không** có header `Content-Type` do người gọi đặt.
3. Caption dài hơn 1024 ký tự bị cắt đúng 1024.
4. `buildShotCaption` đếm đúng ok/lỗi và **chỉ đếm dòng của kênh đó**, bỏ qua kết quả kênh khác trong cùng batch.

### `tests/yt-capture.test.js` (mới)

`page` giả: `goto` ghi lại URL, `url()` trả chuỗi cấu hình được, `waitForSelector` no-op, `screenshot` trả `Buffer.from("PNG")`.

5. Đường thành công: `goto` lần 1 vào `studio.youtube.com`, `url()` trả `.../channel/UC123`, `goto` lần 2 phải đúng `https://studio.youtube.com/channel/UC123/videos/upload`; trả về đúng buffer.
6. `url()` không chứa `/channel/` (chưa login) → ném `Error`, và `screenshot` **không** được gọi.
7. `waitForSelector` ném (đổi giao diện) → vẫn `screenshot` và vẫn trả buffer. Đây là ca chốt quyết định "vẫn gửi ảnh trang lạ".

### `tests/upload-queue.test.js` — thêm

Bơm `capture` (đếm lần gọi, trả buffer giả) và `notifyShots` (ghi lại tham số).

8. 2 kênh, 3 job → flush gọi `notifyShots` **một lần** với đúng 2 shot, đúng tên kênh, không trùng.
9. `conns` không có profile của kênh (đã đóng) → shot của kênh đó bị bỏ, kênh còn lại vẫn có, `notifyDigest` vẫn được gọi đủ.
10. `capture` ném lỗi ở kênh đầu → kênh sau vẫn chụp, hàng đợi không sập, `log` nhận thông báo.
11. `notifyShots` ném lỗi → hàng đợi không sập, job kế tiếp vẫn chạy được.
12. **Không tự mở lại trình duyệt.** `connect` đếm số lần gọi; sau flush với `conns` rỗng, `connect` không được gọi thêm lần nào.
13. **Hẹn giờ đóng bị huỷ trong lúc chụp.** `idleCloseMs: 5`, `capture` trả Promise treo do test tự `resolve`. Chờ 40ms → `closeConn` **chưa** được gọi (nếu thiếu `cancelClose()` thì ca này đỏ). `resolve` `capture` → chờ → `closeConn` mới chạy.

Ca 13 là bug không tái hiện được bằng tay: nó chỉ nổ khi người dùng đặt `gpmIdleCloseMin` nhỏ và có nhiều kênh, biểu hiện là ảnh của vài kênh cuối biến mất kèm một lỗi CDP lạ.
