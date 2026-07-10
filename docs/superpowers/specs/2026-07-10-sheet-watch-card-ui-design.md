# Thiết kế lại giao diện tab "Theo dõi Sheet" — card kênh + dialog cấu hình

Ngày: 2026-07-10

## Vấn đề

Tab `#sheet-watch` (`renderer.html:3716`) hiện có ba bảng **cùng khoá theo kênh**, nạp ở ba thời điểm rời rạc:

| Bảng | Cột | Nạp khi nào |
|---|---|---|
| `sw-gpm-table` | Kênh, Profile ID, Connect, Trạng thái | bấm "Tải danh sách kênh" |
| `sw-stats-table` | Kênh, Sub, View, Số video, Cập nhật lúc | mở `<details>` số liệu |
| `sw-status-table` | Kênh, Video, Tải/Render, Upload GPM, Lỗi | theo sự kiện, mọc dần |

Ba bảng là ba lát cắt của cùng một thực thể — **cái kênh**. Cộng thêm một khối `<details id="sw-config">` dài ~90 dòng chiếm đầu tab.

`sw-status-table` không phải per-kênh: nó per-video, khoá theo `url` (`renderer.js:4126`), trộn lẫn mọi kênh và lớn dần suốt phiên chạy.

## Phạm vi

Chỉ tab "Theo dõi Sheet". Không đụng 12 tab còn lại. Không đụng tầng main/runner — mọi sự kiện cần thiết đã mang sẵn `channel`.

## Lỗi sửa kèm

`gpmRenderRow` (`renderer.js:4402`) nội suy `ch.sheetName` và `ch.gpmProfileId` thẳng vào `innerHTML`. Hai chuỗi này đến từ Google Sheet. Code bảng số liệu ngay cạnh đó dùng `textContent` và có comment giải thích lý do. Bản viết lại dùng `textContent` cho mọi chuỗi đến từ Sheet.

## Mô hình dữ liệu

Một Map duy nhất, khoá theo `sheetName`:

```js
const channels = new Map(); // sheetName -> { ch, stats, gpm, videos: Map(url -> {...}) }
```

Nạp một lần khi mở tab: `api.gpmListChannels()` dựng lưới card; `listStatsChannels()` điền số liệu (đọc thẳng Sheet, không tốn quota YouTube API). Sự kiện `channel-status` / `video-rendered` / `upload-status` / `error` cập nhật `videos` của đúng card. Nút "Tải danh sách kênh" bị xoá.

`gpm:list-channels` được mở rộng trả thêm `enabled` và `countToday` (đọc `runner-state.json` qua `computeRemaining`) — UI chưa từng hiển thị quota hôm nay.

**Nạp là gộp, không phải thay.** Với `autoRunOnOpen`, runner chạy trước khi người dùng mở tab, nên sự kiện đã dựng card. `loadChannelsOnce` phải:

- không xoá `channels` Map và không xoá lưới — nếu không, video đang chạy biến mất khỏi UI;
- `setEmpty()` chỉ đặt chỗ giữ khi lưới **chưa có card thật**, vì nó xoá `grid`. Bỏ điều kiện này thì card do sự kiện dựng bị gỡ khỏi DOM trong khi Map vẫn giữ entry → `ensureChannel` trả về card mồ côi, không bao giờ gắn lại;
- `grid.appendChild(c.el.card)` cho từng kênh theo thứ tự `⚙config` (`appendChild` là *move*), vừa xếp đúng thứ tự vừa gắn lại card mồ côi nếu có;
- `countToday = Math.max(backend, đếm-trong-UI)` — một video có thể render xong giữa lúc đọc IPC và lúc gán, số không được phép lùi.

## Card kênh

Thu gọn — cao cố định, đọc lướt được cả lưới:

```
┌────────────────────────────────────────────┐
│ ● Chuyện Ma Có Thật        🔌    3/8    ▾  │
│ 1.2K sub · 45.3K view · 128 video          │
│ ⏳ đang render — "Câu chuyện lúc 0 giờ"    │
└────────────────────────────────────────────┘
```

- `●` chấm trạng thái GPM: xám chưa kết nối, xanh đã mở Studio, đỏ lỗi. Thay cột "Trạng thái" cũ.
- `🔌` connect kênh đó. `disabled` khi thiếu `gpmProfileId`, kèm `title="Kênh chưa có GPM Profile ID trong ⚙config"` — hiện nút chỉ bị mờ, không nói vì sao.
- `3/8` = `countToday` / `videosPerDay`. Dữ liệu đã có trong `runner-state` nhưng UI chưa từng hiển thị. Đây chính là "đã chạy đủ số video của ngày chưa".
- Dòng cuối: việc đang chạy. Rảnh thì `✓ đủ hôm nay` hoặc `— chờ lượt sau`.

Lưới: `grid-template-columns: repeat(auto-fill, minmax(340px, 1fr))`. Tự xuống 1 cột trên màn hẹp, không cần media query.

Mở rộng (bấm `▾`): danh sách video **của riêng kênh đó** — tiêu đề, trạng thái tải/render, trạng thái upload, lỗi. Mặc định chỉ hiện video đang chạy và video lỗi; video xong gấp lại sau dòng `✓ N video đã xong`. `sw-status-table` chuyển vào đây; `rows` đổi khoá từ `url` phẳng thành `channels.get(name).videos`.

## Dialog cấu hình

**Dời DOM, không viết lại DOM.** Khối `<details id="sw-config">` được cắt nguyên vẹn, dán vào body một modal. Mọi `id` giữ nguyên, nên `loadSettings()`, `currentSettings()`, `saveDebounced()`, hai nút 🔌 test và nút "Gửi thử" Telegram trong `renderer.js` không phải sửa dòng nào.

Modal nằm sẵn trong DOM từ đầu, chỉ bật/tắt `display`. Render lazy sẽ khiến `$("sw-poll")` là `null` lúc khởi tạo và toàn bộ phần cấu hình chết lặng.

Dùng lại `.modal` / `.modal-content` có sẵn của `#helpModal` (`renderer.html:3866`). Không thêm CSS modal mới.

Ba nhóm, theo thứ tự người dùng đụng tới:

1. **Google Sheet** — Spreadsheet ID, Service account JSON, Channels root, nút 🔌 kiểm tra kết nối.
2. **Render** — Poll (giây), Tốc độ video, Dùng GPU, Tự chạy khi mở app, YouTube API key.
3. **GPM & thông báo** — checkbox bật GPM, rồi panel con: GPM host + 🔌, "Đóng trình duyệt sau (phút rảnh)" (xem `2026-07-10-gpm-idle-close-design.md`), Telegram.

**Không có nút "Lưu".** App đã tự lưu debounce 400ms (`renderer.js:4198`); thêm nút Lưu là nói dối người dùng. Dialog chỉ có `✕`, đóng bằng Esc hoặc bấm nền.

## Thanh công cụ

```
Theo dõi Sheet — tự động tải & render
[▶ Start] [■ Stop] [↻ Chạy tất cả ngay]   [🔌 Connect tất cả] [🔄 Số liệu] [⚙]
```

- 🔌 test kết nối Sheet gộp vào dialog (nó là việc của cấu hình).
- `sw-gpm-list` xoá — card tự nạp.
- `sw-gpm-connect-all` lên toolbar, chỉ hiện khi `gpmEnabled`.

## Ba mảnh còn lại

- `sw-stats-banner` (cảnh báo "Thiếu cột trong ⚙config") — **không** nhét vào dialog: nó nói về dữ liệu Sheet, không phải cấu hình app. Thành dải băng ngay trên lưới card.
- `sw-stats-details` collapse — xoá, số liệu đã nằm trên card.
- `📜 Log chi tiết` — giữ nguyên `<details>` ở đáy tab.

## Tổng kết

Mất đi: 3 bảng, 2 khối `<details>`, 1 nút "Tải danh sách kênh".
Thêm vào: 1 lưới card, 1 modal, 1 dải cảnh báo.
