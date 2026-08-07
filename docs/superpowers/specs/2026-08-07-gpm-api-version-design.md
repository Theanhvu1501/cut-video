# Tự dò phiên bản API của GPM (/api/v3 và /api/v1)

Ngày: 2026-08-07

## Vấn đề

GPM bản cũ phục vụ API ở `/api/v3`, bản mới ở `/api/v1`. Đường dẫn và dữ liệu trả
về giống hệt nhau, chỉ khác mỗi đoạn version. `sheet/gpm-client.js` đang hardcode
`v3` ở cả 3 endpoint, nên máy cài bản mới không chạy được.

Nhiều máy cùng dùng app và không đồng bộ phiên bản GPM, nên bắt mỗi máy chọn tay
trong Cài đặt là thêm việc phải nhớ. App tự dò.

## Điều kiện dò

Không dò bằng HTTP status: gọi sai version **có thể** ra 404, nhưng cũng có thể ra
200 kèm danh sách rỗng. Mà danh sách rỗng lại trùng với trường hợp máy chưa tạo
profile nào — hai chuyện khác hẳn nhau.

Chấm điểm mỗi version qua endpoint liệt kê profile:

| rank | Nghĩa | Dấu hiệu |
|---|---|---|
| 2 | Chắc chắn đúng version | HTTP 2xx, không `success:false`, danh sách có ≥1 profile |
| 1 | Mơ hồ | Gọi được nhưng danh sách rỗng |
| 0 | Hỏng | Lỗi mạng, HTTP không 2xx, hoặc `success:false` |

Chỉ dò bằng endpoint liệt kê (chỉ đọc). Không dò bằng `start`/`close`: hai cái đó
cũng trả 404 khi profile ID sai, dò ở đó sẽ nhầm "sai ID" thành "sai version", tệ
hơn là bắn nhầm lệnh mở/đóng profile.

## Thiết kế

`sheet/gpm-client.js`:

- `API_VERSIONS = ["v3", "v1"]` — cũng là thứ tự ưu tiên khi hoà điểm, nên máy
  bản cũ giữ nguyên hành vi hiện tại.
- `detectVersion(host, fetch)`: dò song song cả hai (đều là localhost, 1 lần mỗi
  phiên), lấy bên điểm cao nhất.
- **Chỉ nhớ khi rank 2.** Máy chưa có profile nào thì cả hai cùng rank 1 — dùng
  tạm `v3` nhưng không cache, để tạo profile xong là dò lại đúng. Chốt vội ở đây
  là sai cho cả phiên chạy.
- Cache theo host trong `Map` ở module. `resetGpmVersionCache()` cho test,
  `getGpmApiVersion(host)` cho UI.
- `startProfile` / `closeProfile` dùng version đã chốt; chưa chốt thì dò, dò
  không ra thì cứ `v3` và để lời gọi thật báo lỗi — GPM chưa bật là lỗi kết nối
  của lời gọi đó, không phải lỗi version.
- `start`/`close` gặp 404 → xoá cache để lần sau dò lại. Ai nâng cấp GPM giữa
  phiên không phải khởi động lại app.
- Lỗi khi cả hai version đều rank 0: ném nguyên văn lỗi của version ưu tiên.

`electron-main.js` / `renderer.js`: IPC `gpm:test` trả thêm `apiVersion`, nút Test
hiện `✅ 3 profiles (API v3)`. Nhiều máy mỗi máy một bản GPM, nhìn phát biết ngay.
Chưa chốt được version thì không hiện gì (lúc đó cũng chẳng có profile nào).

Không thêm ô cấu hình nào.

## Test — `tests/gpm-client.test.js`

Fake GPM mô phỏng máy chỉ có MỘT bản: version còn lại trả 200 kèm danh sách rỗng
(đúng kiểu khó nhằn, không phải 404).

- Bản mới → dò ra `v1`, `start`/`close` cũng đi `v1`, không đụng `v3`.
- Bản cũ → chốt `v3`.
- Dò xong là nhớ: lần gọi sau chỉ còn đúng 1 request.
- Chưa có profile nào → không chốt; tạo profile xong dò lại ra đúng.
- GPM chưa chạy → giữ nguyên thông điệp `ECONNREFUSED`.
- `success:false` → báo `message` của GPM.
- `start` trả 404 → quên version đã nhớ.
