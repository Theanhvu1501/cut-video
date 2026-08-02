# Mode crop: chèn ảnh người phía trên dải crop

Ngày: 2026-08-02

## Vấn đề

Mode `crop` cắt một dải ngang từ video gốc, ép về đen trắng rồi dán xuống đáy khung
1280×720 làm nền cho phụ đề. Phần khung phía trên dải đó hiện chỉ có video nền.

Cần chèn thêm một ảnh người (PNG nền trong suốt) vào phần trên, đứng **sát mép trên**
dải crop, và chọn được vị trí ngang: trái / giữa / phải / ngẫu nhiên.

## Phạm vi

Mode `crop` hiện tồn tại độc lập ở hai nơi với logic gần như y hệt:

| Luồng | File | Hàm |
|---|---|---|
| Sheet tự động | `sheet/render-core.js` | `crop(cfg)` |
| Tab "Render" thủ công | `render.js` | `complexFilterCrop()` |

Làm ở **cả hai**. Không gộp chung hai bản trong lần này — `render.js` chạy như tiến
trình riêng từ `app.asar.unpacked` nên không import xuyên thư mục được, việc gộp là
một thay đổi kiến trúc riêng, ngoài phạm vi.

## Cấu hình mới

Theo đúng quy ước của mode `blurFrame`: công tắc tách khỏi đường dẫn, để tắt tạm một
lớp mà không mất đường dẫn đã chọn.

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `personEnabled` | `false` | Bật/tắt lớp ảnh người |
| `personPath` | `""` | File PNG, hoặc thư mục → bốc ngẫu nhiên một ảnh mỗi video |
| `personFile` | `""` | File cụ thể đã chốt cho lần render này (nội bộ, không phải cột Sheet) |
| `personPos` | `"center"` | `left` / `center` / `right` / `random` |
| `personScale` | `0.9` | Hệ số chiều cao, xem phần Hình học |

Định dạng ảnh nhận: `.png`, `.webp` (dùng lại hằng `FRAME_EXTS` sẵn có).

## Hình học

Khung nền cố định 1280×720 (`BASE_W`, `BASE_H`). Dải crop cao `cropHeight`, nằm sát đáy.

```
H_người = evenDown(personScale × (BASE_H − cropHeight))     tối thiểu 2
Y_người = BASE_H − cropHeight − H_người
```

`Y_người` cho đúng yêu cầu "sát dải crop": đáy ảnh trùng mép trên dải crop.

Toạ độ ngang dùng biểu thức của ffmpeg nên không cần biết trước chiều rộng ảnh:

| `personPos` | Biểu thức `x` |
|---|---|
| `left` | `0` |
| `center` | `(W-w)/2` |
| `right` | `W-w` |

Không chừa lề: `left`/`right` dán sát mép khung.

Ảnh được scale bằng `scale=-2:H_người` — giữ nguyên tỉ lệ gốc, chiều rộng tự suy ra và
làm tròn về số chẵn (yuv420p yêu cầu kích thước chẵn).

`personScale` ngoài khoảng `(0, 1]` rơi về mặc định `0.9`, giống cách `frameGeometry`
xử lý `mainScale`.

## Filter graph

Ảnh người là input `[2:v]` (sau nền `[0]` và video gốc `[1]`), nạp với `-loop 1` vì là
ảnh tĩnh.

Khi lớp người **tắt** — giữ nguyên hệt hiện tại:

```
[1:v]scale=1280:720,crop=1280:H_c:0:Y_c[cropped]
[cropped]eq=brightness=-1.0:contrast=3.0:gamma=1.2:saturation=0[filtered]
[filtered]format=yuva420p,colorchannelmixer=aa=0.8[overlay_video]
[0:v][overlay_video]overlay=0:H-h[combined_video]
```

Khi lớp người **bật**:

```
[1:v]scale=1280:720,crop=1280:H_c:0:Y_c[cropped]
[cropped]eq=brightness=-1.0:contrast=3.0:gamma=1.2:saturation=0[filtered]
[filtered]format=yuva420p,colorchannelmixer=aa=0.8[overlay_video]
[2:v]scale=-2:H_người[person]
[0:v][person]overlay=X:Y_người[with_person]
[with_person][overlay_video]overlay=0:H-h[combined_video]
```

**Thứ tự lớp: người trước, dải crop sau.** Dải crop chứa phụ đề nên không bao giờ được
để ảnh che; đổi lại, phần ảnh lòi xuống dưới bị dải crop cắt gọn — đúng như ảnh mẫu.

## Nơi sửa

### `sheet/render-core.js`

Hàm thuần mới, không đụng ffmpeg, test được độc lập:

- `pickPersonPos(personPos, rand)` → `"left" | "center" | "right"`.
  `random` bốc một trong ba; giá trị lạ rơi về `"center"`.
- `personGeometry(cfg)` → `{ h, y }`.
- `personOverlayX(pos)` → chuỗi biểu thức `x`.
- `resolvePersonAsset(cfg, rand)` → `{ personFile, warnings }`. Dùng lại `pickAsset`.
  Bật công tắc mà đường dẫn hỏng thì trả cảnh báo và bỏ qua lớp, **không ném lỗi** —
  luồng Sheet chạy không người trông, một ô gõ sai không đáng làm hỏng cả mẻ video.
- `cropPersonLayer(cfg)` → `boolean`, nguồn sự thật duy nhất về "lớp người có bật
  không", để `buildStudioInputs` và `crop` không bao giờ lệch chỉ số input.

Sửa:

- `buildStudioInputs(renderMode, cfg)` — thêm nhánh `crop`, trả
  `[{ file: cfg.personFile, inputOptions: ["-loop", "1"] }]` khi lớp người bật.
- `crop(cfg)` — dựng graph theo phần trên.
- `renderOne` — thêm nhánh `renderMode === "crop"`: gọi `resolvePersonAsset`, đẩy
  cảnh báo qua `onProgress`, và **chốt `personPos` một lần** (thay `random` bằng giá
  trị cụ thể) trước khi dựng filter. Bắt buộc phải chốt tại đây: `run()` được gọi lại
  lần hai khi GPU lỗi phải lùi về CPU, chốt muộn hơn sẽ ra vị trí khác giữa hai lần.

### `sheet/sheets-service.js`

Thêm alias cột ⚙config, theo đúng cách `framePath`/`frameScale` đang làm:

| Khoá | Tên cột chấp nhận |
|---|---|
| `personEnabled` | `bật ảnh người` |
| `personPath` | `ảnh người`, `đường dẫn ảnh người` |
| `personPos` | `vị trí ảnh người` |
| `personScale` | `phóng ảnh người` |

`personPos` chuẩn hoá qua `norm()` và chỉ nhận 4 giá trị hợp lệ, giống cách
`effectBlend` đang lọc.

### `render.js` + tab "Render"

`complexFilterCrop()` nhận thêm biến module `personFile` / `personPos` / `personScale`
đọc từ `config`, dựng cùng graph. Ảnh người thêm vào danh sách input của mode crop.

`renderer.html` đã có sẵn nhóm cấu hình crop (`render-height` ở dòng 2483,
`render-y-offset`) — thêm ngay dưới đó: ô chọn ảnh/thư mục, dropdown vị trí, ô số
`personScale`. `renderer.js` gom vào `settings.render` cùng chỗ với `height`/`y_offset`.

## Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| `personEnabled` bật, `personPath` trống/sai | Cảnh báo qua `onProgress`, bỏ lớp người, video vẫn render |
| Thư mục không có file `.png`/`.webp` | Như trên |
| `personScale` ngoài `(0, 1]` | Rơi về `0.9` |
| `personPos` giá trị lạ | Rơi về `center` |

Không tình huống nào được làm hỏng lượt render.

## Test

Test đơn vị (`tests/render-core.test.js`, `tests/sheets-service.test.js`):

- `pickPersonPos`: `random` chỉ trả một trong ba (bơm `rand` cố định để xác định);
  `left`/`center`/`right` trả nguyên; giá trị lạ → `center`.
- `personGeometry`: đúng công thức, làm tròn chẵn, `personScale` lạ rơi về mặc định.
- `crop`: lớp người tắt → graph **giống hệt** hiện tại (chống hồi quy); lớp người bật
  → có `[2:v]scale`, đúng thứ tự người-trước-dải-crop-sau, đúng `x`/`y`.
- `buildStudioInputs("crop", …)`: bật → đúng một input `-loop 1`; tắt → rỗng.
- `resolvePersonAsset`: đường dẫn hỏng → `personFile` rỗng + có cảnh báo, không ném.
- `parseConfigRows`: đọc đúng 4 cột mới, bỏ qua giá trị lạ.

Phần UI (`renderer.html`, `renderer.js`) không có test tự động — kiểm tra bằng tay.

## Rủi ro phải kiểm chứng bằng render thật

Những điểm dưới đây **không** thể khẳng định bằng test đơn vị:

1. **Độ dài video.** Thêm một input `-loop 1` (vô hạn) vào graph. Hiện `crop` không
   dùng `shortest=1`, chỉ dựa vào `-t newDuration` để cắt. Cần render thử một video
   thật để chắc chắn không treo và độ dài vẫn đúng.
2. **Ảnh quá cao.** `personScale = 1.0` với `cropHeight` nhỏ cho ảnh gần kịch trần
   khung; cần xem có bị méo hay tràn ngang không.
3. **Ảnh không có kênh alpha.** PNG nền trắng sẽ ra khối chữ nhật trắng. Đây là lỗi
   dữ liệu vào, không phải lỗi code, nhưng cần ghi rõ trong hướng dẫn.
