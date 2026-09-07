# Chống bot-check YouTube: PO token + xoay vòng cookie + chia lô

Ngày: 2026-09-08

## Vấn đề

Cả hai luồng tải của vid-master đang dính lỗi bot-check của YouTube ("Sign in to
confirm you're not a bot"). Ba nguyên nhân, theo thứ tự nặng dần:

1. **Không có PO token.** YouTube yêu cầu proof-of-origin token cho phần lớn
   format từ 2025; thiếu nó thì hoặc bị chặn thẳng, hoặc chỉ còn vài format rác.
2. **`ytdlp-settings.json` đang ép `youtube:player_client=android`.** Client
   android không dùng PO token web — giữ cờ này thì có cài PO token cũng vô
   nghĩa. Đây là thứ phải sửa đầu tiên.
3. **Chỉ có một file cookie.** Cookie đó bị YouTube gắn cờ là tắc toàn bộ, không
   có đường lùi.

Bản `YouTubeDownloader_Portable_v1.1.1` của cùng người dùng đang tải được trên
cùng máy, cùng mạng. Khác biệt của nó: có bgutil PO token provider, có thư mục
nhiều cookie xoay vòng, và chia lô 30 video / nghỉ 120s. Thiết kế này port cả ba
sang vid-master.

## Điều đã kiểm chứng trước khi thiết kế

- `yt-dlp.exe` 2026.08.19 trong `bin/` **có** `--plugin-dirs`.
- Plugin bgutil nạp được vào bản exe đóng băng, nhưng **chỉ đúng một layout**:
  `--plugin-dirs <DIR>` với `<DIR>/<tên-package>/yt_dlp_plugins/extractor/*.py`.
  Kết quả: `PO Token Providers: bgutil:http-1.3.1 (external), bgutil:script-node-1.3.1,
  bgutil:script-deno-1.3.1`.
  Hai layout còn lại **không** ăn (`Plugin directories: none`):
  - `<DIR>/yt_dlp_plugins/extractor/*.py`
  - `cwd/yt-dlp-plugins/<pkg>/yt_dlp_plugins/extractor/*.py`
- `bin/node.exe` là v22.14, thoả yêu cầu `node >= 20` của bgutil 1.3.1.
- `bin/**` đã nằm trong `asarUnpack` của electron-builder, không phải sửa
  packaging.

## Kiến trúc

### Tài nguyên chép sang

```
bin/bgutil/server/                             <- _internal/bgutil-server (build/ + node_modules/)
bin/bgutil/plugins/bgutil-pot/yt_dlp_plugins/  <- _internal/yt_dlp_plugins
```

`bin/` nằm trong `.gitignore` nên nhị phân không vào git. `scripts/setup-bgutil.mjs`
chép từ một bản portable có sẵn để dựng máy mới không phải nhớ thao tác tay.

### Chế độ chạy: HTTP server, script mode làm lưới đỡ

Chọn HTTP server (`node build/main.js --port 4416`) thay vì script mode vì token
được cache trong server, không phải trả giá khởi động node + jsdom (~2-5s) cho
mỗi lần xin token.

Cả ba file plugin chép chung một lượt, nên script mode tự động thành đường lùi:
khi server chết, hoặc khi chạy `download.js` thẳng từ CLI (Electron không bật,
không ai spawn server), yt-dlp tụt xuống `bgutil:script-node` thay vì trượt hẳn.
Không phải viết thêm dòng nào cho đường lùi này.

### Module mới

**`sheet/pot-provider.js`** — vòng đời bgutil server.
`startPotServer({ nodePath, serverDir, port })` spawn server rồi poll `GET /ping`
cho tới khi có `server_uptime` (timeout 30s, backoff). Port 4416 bận thì thử
4417, 4418. `stopPotServer()` kill khi thoát app. Server chết giữa chừng thì
KHÔNG hồi sinh — để yt-dlp tụt xuống script mode, đơn giản hơn và không có nguy
cơ spawn lặp.

**`sheet/cookie-pool.js`** — xoay vòng cookie.
`createCookiePool({ folder, file })` liệt kê `.txt` trong folder (sort theo tên
để thứ tự ổn định giữa các lần chạy); folder trống hoặc không tồn tại thì fallback
về `file` đơn, đúng hành vi cũ. `pool.current()` trả cookie đang dùng,
`pool.rotate()` sang cookie kế tiếp theo vòng tròn. State giữ trong RAM, không
persist: một phiên chạy là đủ ngữ cảnh, persist chỉ thêm file trạng thái phải
dọn.

`isBotCheckError(message)` nhận diện bot-check từ stderr yt-dlp:
`Sign in to confirm you're not a bot`, `not a bot`, `HTTP Error 403`,
`Requested format is not available` (dấu hiệu bị chặn trá hình — YouTube trả về
danh sách format rỗng thay vì báo lỗi thẳng).

**`sheet/download-batch.js`** — `chunkIntoBatches(items, size)`. `size <= 0` là lựa
chọn cố ý "tắt chia lô" nên trả về một lô duy nhất; danh sách rỗng trả `[]` chứ
không phải `[[]]`, để chỗ gọi không nghỉ 120s cho một lô không có gì.

**`sheet/download-retry.js`** — retry dùng chung cho cả hai luồng.
`downloadWithRetry(fn, pool)` gọi `fn(cookiesFile)`; lỗi khớp `isBotCheckError`
thì `pool.rotate()` rồi thử lại, tối đa bằng số cookie trong pool. Lỗi khác ném
thẳng — không nuốt, vì retry một lỗi mạng hay lỗi format bằng cookie khác chỉ
tốn thời gian và giấu mất nguyên nhân thật.

### File sửa

**`sheet/ytdlp-config.js`** — `DEFAULT_EXTRACTOR_ARGS` đổi từ
`youtube:player_client=web_embedded` thành chuỗi rỗng. Có PO token rồi thì để
yt-dlp tự chọn client là tốt nhất; ép cứng client nào cũng là tự bó tay khi
YouTube đổi. `ytdlp-settings.json` hiện có `youtube:player_client=android` phải
được xoá.

**`sheet/download-options.js`** — `buildYtdlOptions` nhận thêm `pluginDirs`,
`potBaseUrl` và `potScriptPath`; thêm `resolveBinDir` / `getBgutilPaths` để dò
`bin/bgutil` ở cả bản dev lẫn bản đóng gói.

`base_url` được truyền CẢ KHI đúng cổng mặc định (khác spec ban đầu): plugin chỉ
tự đoán 4416, mà pot-provider có thể đã phải nhảy sang 4417/4418 vì cổng bận.

`potScriptPath` là thứ phát sinh khi thử tay, không có trong spec ban đầu: mặc
định plugin tìm script ở `C:\Users\<user>\bgutil-ytdlp-pot-provider\server` — chỗ
không tồn tại ở đây — nên không chỉ đường thì yt-dlp báo
`bgutil:script-node (external, unavailable)` và mất hẳn đường lùi. Chỉ đường rồi
thì thành `(external)`.

**`download.js`** — chia lô: đọc `batchSize` (mặc định 30) và `batchBreakSeconds`
(mặc định 120) từ `settings.download`. Trong mỗi lô giữ nguyên `pLimit(MAX_CONCURRENT)`
và nghỉ ngẫu nhiên 1-2.5s như hiện tại; hết lô thì nghỉ dài. Cookie lấy từ pool,
mỗi URL bọc qua `downloadWithRetry`.

**`sheet/channel-download.js`** — `downloadOne` nhận `cookiePool` thay cho
`cookiesFile` cứng, bọc `downloadWithRetry`. Vẫn chấp nhận `cookiesFile` để test
cũ và lời gọi cũ không vỡ.

**`sheet/sheet-runner.js`** — dựng pool một lần cho cả lượt chạy và truyền xuống
`downloader`. Nhịp nghỉ 60-120s giữa mỗi video và `pLimit(1)` đang có giữ nguyên:
luồng Sheet vốn đã đủ chậm, chia lô thêm ở đây không mua được gì.

**`electron-main.js`** + **`renderer`** — start/stop bgutil theo vòng đời app,
truyền `pluginDirs`/`potBaseUrl` xuống cả hai luồng, thêm ô chọn thư mục cookies,
ô số video mỗi lô, ô số giây nghỉ giữa lô, và dòng trạng thái bgutil.

## Cấu hình mới

`projects/<tên>.json`, nhánh `settings.download`:

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `cookiesFolder` | `null` | Thư mục chứa nhiều `.txt`; rỗng thì dùng `cookiesFile` như cũ |
| `batchSize` | `30` | Số video mỗi lô ở luồng tải thủ công |
| `batchBreakSeconds` | `120` | Số giây nghỉ giữa hai lô |

`cookiesFile` giữ nguyên, không migrate: project cũ mở lên vẫn chạy y như trước.

## Script kèm theo

**`scripts/setup-bgutil.mjs`** — chép bgutil từ một bản portable sang `bin/bgutil`.
Bắt EBUSY riêng: Windows khoá thư mục đang là cwd của tiến trình, nên chạy lúc app
đang mở sẽ hỏng, và stack trace của rimraf không gợi ý được gì.

**`scripts/check-download.mjs`** — chạy đúng code path của app (pot-provider →
cookie-pool → downloadOne) để tải thử một video. Dùng khi YouTube đổi cơ chế: biết
ngay vấn đề nằm ở PO token, ở cookie, hay chỗ khác. Cảnh báo riêng nếu phát hiện
`player_client=android` trong cấu hình.

## Test

Chạy bằng `node --test tests/*.test.js` đã có sẵn. Thêm 37 test, tất cả pass.

- `cookie-pool`: xoay vòng tròn, folder rỗng thì fallback file đơn, chỉ lấy
  `.txt`, thứ tự ổn định theo tên.
- `isBotCheckError`: khớp đúng các chuỗi bot-check, không khớp lỗi mạng thường.
- `download-retry`: rotate đúng số lần rồi bỏ cuộc, lỗi thường không retry.
- `download-options`: có `pluginDirs`, `base_url` và `script_path`; cờ PO token
  cộng thêm chứ không đè extractor-args của người dùng.
- `download-batch`: chia lô đúng, danh sách rỗng không sinh lô rỗng.
- `pot-provider`: dùng lại server có sẵn, spawn khi chưa có, nhảy port khi bận,
  trả null (không ném) khi không lên được.
- `channel-download`: xoay cookie khi bot-check, KHÔNG xoay với lỗi thường.

Lưu ý: repo có sẵn 5 test đỏ từ trước (đường dẫn `\` vs `/`, GPM upload,
parseConfigRows) — đã đối chiếu với worktree sạch ở HEAD, không liên quan đến
thay đổi này.

## Đánh đổi

Installer phình thêm ~173MB (`node_modules` của bgutil có native `canvas`). Hiện
đã ~670MB vì ba file ffmpeg, nên đây là chi phí chấp nhận được để đổi lấy việc
tải được.
