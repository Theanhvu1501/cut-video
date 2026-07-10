# Đóng trình duyệt GPM khi hàng đợi upload rảnh

Ngày: 2026-07-10

## Vấn đề

`sheet/upload-queue.js` giữ `conns` (Map `profileId → {browser, page}`) mở vĩnh viễn. Chrome của GPM chạy suốt đêm dù không còn video nào để đăng, chiếm RAM và giữ profile ở trạng thái mở.

Quota `videosPerDay` là quota **render**, không phải quota **upload**. Đóng browser ngay khi `computeRemaining() <= 0` sẽ cắt ngang những upload đang chạy cho các video vừa render xong.

## Thời điểm đóng

Khi hàng đợi upload rảnh: `runActive === false && pending === 0`. Đây đúng là điểm `scheduleFlush()` gửi Telegram digest. Nó bao trùm cả ba trường hợp: đủ quota, hết URL mới, và hết slot lịch ngày mai.

Đóng sau một khoảng **ân hạn** cấu hình được (`gpmIdleCloseMin`, mặc định 10 phút). `pollSec` mặc định là 300s, nên ân hạn 10 phút đảm bảo các lượt chạy liên tiếp trong ngày tái dùng cùng một browser thay vì đóng–mở mỗi 5 phút (mỗi lần start profile tốn ~10–20s).

## Thiết kế

### `sheet/gpm-client.js`

Thêm hàm mới, không đụng hàm cũ:

```js
export async function closeProfile(gpmHost, profileId, conn = {}, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  try { await conn.browser?.close(); } catch { /* CDP đã chết */ }
  openedBrowsers.delete(profileId);
  const res = await fetchFn(`http://${gpmHost}/api/v3/profiles/close/${profileId}`);
  if (!res.ok) throw new Error(`GPM HTTP ${res.status}`);
}
```

Ngắt CDP trước, rồi gọi GPM tắt hẳn tiến trình Chrome. `browser.close()` của Playwright trên kết nối `connectOverCDP` chỉ ngắt kết nối — tiến trình Chrome vẫn sống, nên bắt buộc phải gọi API `close` của GPM thì mới giải phóng RAM và cho GPM sync profile.

Hàm được phép ném lỗi; người gọi nuốt và ghi log.

`connectAndOpenStudio` (nút 🔌) giữ Map `openedBrowsers` riêng. Sau khi upload-queue đóng profile, entry đó thành rác. `connectAndOpenStudio` đã bọc `browser.close()` trong try/catch nên lần bấm sau vẫn chạy đúng, nhưng `closeProfile` vẫn gọi `openedBrowsers.delete(profileId)` để không giữ tham chiếu tới một browser đã chết.

### `sheet/upload-queue.js`

Dep và tuỳ chọn mới:

```js
closeConn = closeProfile,
idleCloseMs = 600_000,   // 0 = tắt tính năng, giữ browser mở như hiện nay
```

State mới: `let idleTimer = null; let closing = null;`

`conns` phải nhớ `gpmHost` — hiện chỉ lưu `{browser, page}`, lúc đóng không biết gọi API đi đâu:

```js
async function getConn(gpmHost, profileId) {
  if (closing) await closing;        // đóng xong hẳn rồi mới mở lại
  if (conns.has(profileId)) return conns.get(profileId);
  const c = await connect(gpmHost, profileId);
  conns.set(profileId, { ...c, gpmHost });
  return c;
}
```

```js
async function closeIdleConns() {
  if (runActive || pending > 0) return;
  const entries = [...conns.entries()];
  conns.clear();
  for (const [profileId, c] of entries) {
    try {
      await closeConn(c.gpmHost, profileId, c);
      log(`Đã đóng trình duyệt GPM (profile ${profileId})`);
    } catch (e) {
      log(`Đóng profile ${profileId} thất bại: ${e?.message || e}`);
    }
  }
}

function scheduleClose() {
  if (!idleCloseMs || !conns.size) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    closing = closeIdleConns().finally(() => { closing = null; });
  }, idleCloseMs);
}
```

Điểm hẹn giờ: cạnh `scheduleFlush()` — trong `.finally()` của `enqueue` khi `pending === 0`, và trong `endRun()`.

Điểm huỷ hẹn: đầu `enqueue()` và trong `beginRun()` — `clearTimeout(idleTimer)` gọi **đồng bộ**, trước mọi `await`.

### Race condition

Hẹn giờ nổ → `closeIdleConns()` đang `await` lời gọi HTTP. Một job mới `enqueue`; `clearTimeout` vô nghĩa vì timer đã nổ. Job gọi `getConn`, thấy `conns` rỗng, mở lại profile. Lời gọi `close` đang bay dở hạ luôn tiến trình Chrome vừa mở → upload chết giữa chừng, biểu hiện như một lỗi CDP ngẫu nhiên không tái hiện được.

Hai lớp phòng vệ cố ý chồng nhau:

- `clearTimeout` lo trường hợp thường (job tới trước khi hẹn nổ).
- `if (closing) await closing` trong `getConn` lo trường hợp hiếm (job tới đúng lúc đang đóng).

`conns.clear()` chạy **trước** vòng `await` nên không có cửa sổ nào job đọc trúng một `browser` sắp bị giết.

Điều kiện `if (runActive || pending > 0) return;` được kiểm lại ngay trong callback — timer 10 phút thừa sức sống qua lúc một lượt chạy mới bắt đầu.

## Cấu hình

Khoá `gpmIdleCloseMin`, đơn vị **phút**, mặc định `10`, `0` = tắt.

- `electron-main.js:1343` — thêm `gpmIdleCloseMin: 10` vào object mặc định của `loadSettings`.
- `electron-main.js:1357` — truyền `idleCloseMs: Math.max(0, Number(s.gpmIdleCloseMin ?? 10) || 0) * 60_000` vào `createUploadQueue`.
- `renderer.html` — thêm `form-group` trong `#sw-gpm-panel`, dưới dòng GPM host: `<input id="sw-gpm-idle-close" type="number" min="0" value="10">`, chú thích `0 = luôn giữ mở`.
- `renderer.js` — `loadSettings` đọc `s.gpmIdleCloseMin ?? 10`; `currentSettings` trả `Math.max(0, parseInt(...) || 0)`; thêm `"sw-gpm-idle-close"` vào mảng listener tự-lưu.

Đổi cấu hình lúc runner đang chạy **không có tác dụng ngay** — `createUploadQueue` đọc `idleCloseMs` một lần khi runner được dựng. Phải Dừng → Chạy lại. Chấp nhận đánh đổi này: đọc nóng lại settings mỗi lần hẹn giờ là thêm một đường dây phụ thuộc chỉ để phục vụ một con số hiếm khi chỉnh.

## Xử lý lỗi

Đóng thất bại (GPM đang tắt, HTTP lỗi) chỉ ghi một dòng log. Không ném ra ngoài, không ảnh hưởng lượt chạy. `conns` đã xoá nên lượt sau kết nối lại sạch.

## Test

Bám khuôn hiện có: `node --test`, timeout thật rất nhỏ (`idleCloseMs: 5`, chờ 40ms). Không cần fake timers.

### `tests/gpm-client.test.js` — `closeProfile`

1. Đường thành công: gọi `browser.close()` **trước**, rồi `fetch` đúng URL `http://<host>/api/v3/profiles/close/<id>`. Kiểm cả thứ tự.
2. `browser.close()` ném (CDP đã chết) → vẫn phải `fetch`. Ca hay xảy ra nhất ngoài đời.
3. `fetch` trả `!res.ok` → ném `Error` chứa mã HTTP.

### `tests/upload-queue.test.js` — hẹn giờ

Bơm `connect` (đếm lần gọi), `runUpload` (no-op), `closeConn` (ghi lại `[gpmHost, profileId]`).

4. **Rảnh quá hạn thì đóng.** 1 job → `endRun()` → chờ 40ms → `closeConn` gọi đúng một lần, đúng `gpmHost`/`profileId`. Enqueue job nữa → `connect` đã chạy 2 lần. Chứng minh `conns.clear()` làm browser mở lại được.
5. **Có job trước hạn thì huỷ hẹn.** job 1 → `endRun()` → chờ 2ms → job 2 → chờ 40ms → `closeConn` chưa từng gọi, `connect` chỉ 1 lần.
6. **`runActive` chặn đóng.** job 1 xong → `beginRun()` (chưa `endRun`) → chờ 40ms → không đóng, dù `pending === 0`.
7. **`idleCloseMs: 0` tắt hẳn.** Không bao giờ đóng — hành vi y hệt bản hiện tại.
8. **`closeConn` ném lỗi.** Hàng đợi không sập, `log` nhận thông báo, job kế tiếp vẫn `connect` lại được.
9. **Race condition.** `closeConn` trả Promise treo do test tự `resolve`. Chờ hẹn giờ nổ (`closeIdleConns` kẹt trong `await`), rồi `enqueue` job mới → khẳng định `connect` **chưa** chạy. `resolve` `closeConn` → chờ → `connect` đã chạy, và chạy **sau** khi `closeConn` xong.

Ca 9 là con bug duy nhất trong thiết kế này không tái hiện được bằng tay. Gỡ `if (closing) await closing;` ra thì ca này đỏ ngay; không có nó, suite vẫn xanh trong khi Chrome bị giết giữa lúc upload.
