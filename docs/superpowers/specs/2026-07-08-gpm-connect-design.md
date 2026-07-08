# GPM Connect — Thiết kế (Giai đoạn 1)

Ngày: 2026-07-08

## Bối cảnh & mục tiêu

Người dùng có ~10 kênh YouTube, mỗi kênh gắn với 1 profile GPM (antidetect browser) **đã login sẵn và đã có kênh**. Mục tiêu dài hạn: từ vid-master tự động (1) thay thumbnail dựa vào thumbs trong overlays đã tải + title, (2) lên lịch đăng theo `videosPerDay` (ví dụ `videosPerDay=2` → 2 mốc giờ như `8:00, 18:00`).

**Giai đoạn 1 (spec này) chỉ làm bước Connect.** Thumb & lịch để hook sẵn, chưa code.

Tham chiếu hiện thực đã chạy được: `../voxable/electron-app/services/gemini-browser.js` (các hàm GPM) và `ipc-handlers.js` (`content:testGpm`). Ta bám theo mẫu này.

## Yêu cầu

- **Toggle bật/tắt auto GPM**: có người thích làm tay. Khi tắt → app chạy y như hiện tại, ẩn toàn bộ khối GPM.
- Mapping **kênh → GPM profile** đặt ở Google Sheet `⚙config` (giữ một nguồn sự thật duy nhất, đồng bộ cách `videosPerDay`/`proxy` đang hoạt động).
- Test kết nối GPM **độc lập với Sheet** (chỉ cần GPM đang chạy).
- "Connect" = start profile GPM → `connectOverCDP` (playwright) → mở `https://studio.youtube.com`, giữ trình duyệt mở. Xác nhận điều khiển được + đã login.

## Mô hình dữ liệu

`sheet-settings.json` (đã có sẵn cơ chế load/save) thêm 2 trường chung cho máy:
- `gpmEnabled: boolean` — mặc định `false`
- `gpmHost: string` — mặc định `"127.0.0.1:19995"`

Sheet `⚙config` thêm 1 cột `gpmProfileId`. Alias tiếng Việt được chấp nhận (accent-insensitive qua `norm()` sẵn có): `"gpm profile id"`, `"gpm"`, `"profile gpm"`. Rỗng → kênh không có profile (bỏ qua khi connect).

## Kiến trúc code

### Service mới `sheet/gpm-client.js`
Rút gọn từ `gemini-browser.js` của voxable, chỉ các hàm GPM độc lập (chưa cần class pool):
- `testGpmConnection(gpmHost)` → `GET http://{gpmHost}/api/v3/profiles?page=0&per_page=100`; trả `[{id, name}]`. (copy nguyên logic voxable, tăng `per_page`).
- `startProfile(gpmHost, profileId)` → `GET .../api/v3/profiles/start/{profileId}`; kiểm `data.success`; trả `data.data.remote_debugging_address`. (copy nguyên)
- `connectOverCDPWithRetry(address, retries=10, intervalMs=1000)` → `chromium.connectOverCDP('http://'+address)`. (copy nguyên)
- `connectAndOpenStudio(gpmHost, profileId)` → nếu profileId này đã mở trước đó thì đóng trước (tránh khoá) → `startProfile` → `connectOverCDPWithRetry` → lấy `browser.contexts()[0] ?? newContext()` → `newPage()` → `goto('https://studio.youtube.com', {waitUntil:'domcontentloaded', timeout:30000})`. Lưu `{ browser }` vào Map module-level theo `profileId` để lần sau đóng cái cũ. **Giữ trình duyệt mở** (không close) như voxable.

`playwright-core` import `chromium`. Ở chế độ GPM ta connect CDP vào Chromium của GPM → **không cần Chrome/`findChrome`**.

### Parser `sheet/sheets-service.js`
- Thêm vào `HEADER_ALIASES`: `gpmProfileId: ["gpm profile id", "gpm", "profile gpm"]`.
- Trong `parseConfigRows`, thêm `gpmProfileId: col(row, "gpmProfileId")` vào object channel.

### IPC (electron-main.js)
- `gpm:test ({ gpmHost })` → `{ ok, profiles }` — mirror `content:testGpm`.
- `gpm:list-channels` → dùng sheetsApi + `readConfigSheet` (như `sheet:*` hiện có) → trả `[{ sheetName, gpmProfileId, videosPerDay }]`.
- `gpm:connect ({ gpmHost, profileId, sheetName })` → `connectAndOpenStudio`, trả `{ ok, error }`. Track browser đã mở trong Map ở service.

### preload.cjs
Expose `window.api.gpm = { test, listChannels, connect }`.

### package.json
Thêm dependency `playwright-core` (^1.44.0). `asarUnpack` đã có `node_modules/**` nên tự unpack. Không tải browser (chỉ dùng `connectOverCDP`).

## UI — trong tab "Theo dõi Sheet"

Khối **GPM** mới:
- Checkbox **"Bật tự động GPM"** (`sw-gpm-enabled`) → toggle ẩn/hiện `#sw-gpm-panel`.
- Ô `gpmHost` (`sw-gpm-host`, mặc định `127.0.0.1:19995`) + nút **Test** 🔌 (`sw-gpm-test`) + span trạng thái → gọi `gpm:test`, hiện số profiles.
- Nút **"Tải danh sách kênh"** → `gpm:list-channels` → render bảng: `Kênh | Profile ID | [Connect] | trạng thái`.
- Nút **"Connect tất cả"** → lặp gọi `gpm:connect` từng dòng có profileId, cập nhật trạng thái từng dòng (`⏳`/`✅`/`❌ lỗi`).
- `gpmEnabled` + `gpmHost` được thêm vào hàm load/save `sheet-settings` sẵn có trong `renderer.js` (quanh dòng 4147–4159).

## Kiểm thử

- **Unit test** (`tests/`, theo mẫu `node --test`): `parseConfigRows` đọc đúng cột `gpmProfileId` — nhận diện qua alias tiếng Việt, rỗng → chuỗi rỗng, có giá trị → trim đúng.
- **Thủ công**: nút Test đếm profiles; nút Connect mở đúng Studio của profile; toggle tắt → khối ẩn, app như cũ.

## Ngoài phạm vi (giai đoạn sau)

- Auto thay thumbnail (dựa thumbs trong overlays + title).
- Auto lên lịch đăng theo `videosPerDay` (cần thêm cột mốc giờ trong Sheet, ví dụ `8:00, 18:00`).
- Class pool/queue điều phối nhiều kênh song song (nếu cần khi tự động hoá thật sự).
