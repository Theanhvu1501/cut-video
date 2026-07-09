# Theo dõi kênh YouTube + auto lấy URL nguồn

Ngày: 2026-07-09

## Mục tiêu

Hai tính năng độc lập, cùng khai báo trong tab `⚙config` của Google Sheet, cùng dùng YouTube Data API v3 với một API key chung. Không kênh nào phải OAuth.

**A — Theo dõi kênh đích.** Lấy sub, tổng view, số video của các kênh mình đang đăng lên. Xem được ngay trong Sheet và trong app, không phải mở YouTube.

**B — Auto lấy URL nguồn.** Từ `@handle` của kênh nguồn, lấy danh sách video và nối vào cột A của tab kênh. Thay cho việc gõ tay handle vào tab "Lấy URL" rồi copy thủ công từ file `.xlsx` sang Sheet.

## Phạm vi

Chỉ dùng chỉ số công khai (`channels.list`, `playlistItems.list`, `videos.list`). Chỉ giữ con số hiện tại, ghi đè mỗi lần refresh.

Cố tình không làm:

- Không lưu lịch sử, không vẽ biểu đồ.
- Không Telegram digest cho stats.
- Không theo dõi view của từng video đã đăng.
- Không tự tạo cột trong Sheet.
- Không đụng YouTube Analytics API / OAuth.

Nếu sau này cần xem đà tăng, chỗ móc vào là `writeChannelStats` — thêm một hàm append snapshot bên cạnh nó, không phải sửa chỗ khác.

## Cột mới trong `⚙config`

`sheets-service.js` đã có cơ chế `HEADER_ALIASES` khớp tên cột tiếng Việt không dấu. Chỉ cần khai báo thêm; vị trí và thứ tự cột không quan trọng.

| Tên cột | Vai trò | Ai ghi |
|---|---|---|
| `Link kênh` | URL kênh đích | Người dùng |
| `@handle nguồn` | Handle kênh nguồn | Người dùng |
| `Sub` | Số người đăng ký | App |
| `Tổng view` | Tổng lượt xem | App |
| `Số video` | Số video công khai | App |
| `Cập nhật lúc` | Dấu thời gian `dd/mm/yyyy hh:mm` | App |

App không bao giờ tạo cột. Cột nào không tồn tại thì bỏ qua khi ghi, và báo cột thiếu lên giao diện.

`Link kênh` chấp nhận bốn dạng: `@handle`, `youtube.com/@handle`, `youtube.com/channel/UC…`, `UC…` trần.

### Ràng buộc từ YouTube

YouTube làm tròn `subscriberCount` ở API công khai với kênh trên 1.000 sub — 1.234 sub trả về `1230`. Số chính xác chỉ có qua OAuth chủ kênh. Chấp nhận sai số này; mục đích là quan sát đà tăng, không phải đối soát.

Kênh bật ẩn sub trả `hiddenSubscriberCount: true` → hiện `—`, các cột khác vẫn ghi.

## Module mới: `sheet/youtube-api.js`

Nơi duy nhất chạm YouTube Data API v3.

```
createYoutubeClient(apiKey)
fetchChannelStats(yt, refs[])   → [{ ref, channelId, title, subscribers, views, videoCount, hidden }]
                                  hoặc { ref, error } cho ref hỏng
fetchSourceVideos(yt, handle, { minSeconds = 600 })
                                → [{ url, title, viewCount, publishedAt }]
```

Ba hàm thuần, tách riêng để test offline:

- `parseChannelRef(input)` → `{ type: "handle" | "id", value }`, trả `null` nếu rác.
- `videoIdOf(url)` → chuẩn hoá `watch?v=ID` và `youtu.be/ID` về cùng một `ID`, bỏ query thừa.
- `pickNewUrls(existing, fetched)` → lọc trùng theo `videoIdOf`, giữ nguyên thứ tự của `fetched`.

**Quota.** `channels.list` nhận tối đa 50 `id` một lần gọi (1 unit), nhưng `forHandle` chỉ nhận một handle mỗi lần. Nên `fetchChannelStats` tách refs: các `UC…` gộp một lần gọi, các `@handle` gọi lẻ. 20 kênh handle = 20 unit mỗi lần refresh, so với hạn mức 10.000/ngày là không đáng kể.

Client YouTube được truyền vào làm tham số, không tạo bên trong. Nhờ vậy test bơm object giả, không cần mạng, không cần API key.

## Sửa module có sẵn

### `sheet/sheets-service.js`

Thêm, không đổi hành vi cũ:

- `parseConfigRows` trả thêm ba field trên mỗi channel: `rowIndex`, `channelUrl`, `sourceHandle`. Không nơi nào đang đọc ba field này nên test cũ vẫn xanh.
- `findStatsColumns(values)` (thuần) → `{ headerRowIndex, cols }`, với `cols` chỉ chứa các cột tìm thấy.
- `writeChannelStats(sheets, id, configTab, rowIndex, cols, stats)` → gom một `values.batchUpdate`, chỉ chạm các ô có trong `cols`.
- `appendUrls(sheets, id, sheetName, urls)` → `values.append` trên range `A:A` với `insertDataOption: "INSERT_ROWS"`.

`appendUrls` chỉ ghi cột A. Cột B (trạng thái render) và cột C (trạng thái upload) không bị đụng, nên chạy lại nhiều lần là an toàn.

### `get-url.js`

Giữ nguyên là CLI chạy được như cũ và vẫn ghi `.xlsx`. Chỉ bỏ phần gọi API trực tiếp, chuyển sang `import` từ `youtube-api.js`. Tab "Lấy URL" trong app không đổi gì.

### API key

Key đang hardcode ở `get-url.js:12` và đã commit vào git. Chuyển thành ô nhập trong tab "Theo dõi Sheet", lưu chung chỗ với thiết lập sheet hiện có (`sheet:load-settings` / `sheet:save-settings`). Key cũ điền sẵn làm mặc định.

Key đó đã lộ trong lịch sử git — ai clone repo cũng dùng được và tiêu quota. Người dùng nên tạo key mới trong Google Cloud Console, giới hạn chỉ gọi được YouTube Data API, rồi dán vào ô này. Việc tạo key nằm ngoài phạm vi code; code chỉ tạo chỗ để dán.

## Luồng

**Refresh stats** — nút bấm, hoặc tự động cuối mỗi lượt chạy:

```
đọc ⚙config → lọc dòng có Link kênh → parseChannelRef
  → fetchChannelStats → writeChannelStats (từng dòng)
  → emit về renderer để vẽ bảng
```

**Lấy URL nguồn** — nút bấm trên từng dòng:

```
đọc @handle nguồn → fetchSourceVideos
  → đọc cột A hiện tại của tab kênh → pickNewUrls
  → appendUrls → báo "đã thêm N, bỏ qua M trùng"
```

Auto-refresh móc vào `runNow()` trong `sheet-runner.js`, ngay sau `emit({ type: "done" })` — sau khi cả lượt render xong. Chưa có API key thì bỏ qua lặng lẽ, không làm hỏng lượt chạy.

## Giao diện

Bảng đặt trong tab **"Theo dõi Sheet"**, không tạo tab mới. Dữ liệu đến từ `⚙config`, và người dùng đã ở sẵn tab này khi chạy render. Thanh tab hiện đã có 13 tab.

```
Số liệu kênh                          [🔄 Làm mới]

Kênh     Sub     Tổng view  Số video  Cập nhật lúc
Kênh A   1.230   45.678     120       09/07/2026 14:32   [Lấy URL nguồn]
Kênh B   —       1.204      8         09/07/2026 14:32   [Lấy URL nguồn]
Kênh C   ⚠ Link kênh không hợp lệ                        [Lấy URL nguồn]
```

Dấu thời gian dùng `dd/mm/yyyy hh:mm`, khớp định dạng giờ đăng đã dùng ở nơi khác trong repo.

Nút "Lấy URL nguồn" chỉ bật khi dòng đó có `@handle nguồn`. Bấm xong hiện `Đã thêm 12 URL, bỏ qua 47 trùng`.

Hai IPC mới theo pattern `sheet:*` sẵn có: `yt:refresh-stats`, `yt:fetch-source-urls`.

## Xử lý lỗi

Nguyên tắc: một kênh hỏng không được làm hỏng cả bảng. `fetchChannelStats` bọc từng ref, trả `{ ref, error }` thay vì ném ra ngoài.

| Tình huống | Hành vi |
|---|---|
| `Link kênh` rỗng | Bỏ qua dòng, không gọi API |
| `Link kênh` sai định dạng | Ô hiện `⚠ Link kênh không hợp lệ`, không gọi API |
| Handle không tồn tại | Ô hiện `⚠ Không tìm thấy kênh` |
| API key sai / hết quota | Banner đỏ trên bảng, các dòng giữ số cũ |
| Kênh ẩn sub | Cột Sub hiện `—`, các cột khác vẫn ghi |
| Thiếu cột trong `⚙config` | Banner vàng liệt kê cột thiếu, vẫn ghi các cột có |
| Auto-refresh lỗi | Log vào panel, lượt render vẫn tính là `done` |

Cột `Cập nhật lúc` chỉ ghi khi lấy số thành công. Nhìn dấu thời gian cũ là biết dòng đó đang lỗi.

## Test

Theo `node --test` như 10 file test hiện có. Viết test trước, chạy cho đỏ, rồi mới viết code.

**`tests/youtube-api.test.js`** (mới)

- `parseChannelRef` với 4 dạng hợp lệ và với rác.
- `videoIdOf` với `watch?v=`, `youtu.be/`, và URL có query thừa.
- `pickNewUrls` khi trùng hoàn toàn, trùng một phần, và khi hai URL khác dạng cùng trỏ một video.
- `fetchChannelStats` gộp các `UC…` vào một lần gọi và tách `@handle` thành các lần gọi lẻ.
- `fetchChannelStats` với một ref lỗi: các ref còn lại vẫn trả kết quả.

**`tests/sheets-service.test.js`** (bổ sung)

- `findStatsColumns` khi đủ cột, thiếu vài cột, và không có cột nào.
- `parseConfigRows` trả đúng `rowIndex` khi có dòng nhóm-mode phía trên header.

**`tests/sheet-runner.test.js`** (bổ sung)

- Auto-refresh chạy sau `done`.
- Không có API key thì bỏ qua.
- Refresh ném lỗi thì lượt chạy vẫn `done`.
