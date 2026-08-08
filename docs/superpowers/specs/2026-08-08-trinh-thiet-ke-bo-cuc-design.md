# Trình thiết kế bố cục (composer): lớp tự do, lưu thành preset

Ngày: 2026-08-08

## Vấn đề

Mọi bố cục render hiện nay đều fix cứng. `buildComplexFilter` (`sheet/render-core.js:378`)
chuyển thẳng sang 1 trong 5 hàm nối chuỗi `filter_complex` bằng tay: `topTransparent`,
`chromaKey` (+alias `chromaKeyAuto`), `crop`, `keepColor`, `blurFrame`. `render.js:567-885`
có bản copy y hệt cho tab "Render" thủ công.

Thêm một cách bố cục mới phải sửa **5 chỗ**: `render-core.js` + `render.js` +
`renderer.html` (một khối `<div>` ẩn cho mỗi mode) + `renderer.js` + `sheets-service.js`
(alias cột). `DEFAULT_RENDER_CFG` đã 31 khoá phẳng, mỗi mode một tiền tố
(`person*`, `frame*`, `effect*`, `bgBlur*`).

Và có những bố cục **không thể** diễn tả bằng 5 mode đó, dù chỉ là tổ hợp của thứ đã có:

| Bố cục | Vì sao bất khả hôm nay |
|---|---|
| Dải crop + waveform + cụm ảnh LIKE/COMMENT/SUBSCRIBE | Không có nguồn waveform, không có khe ảnh tĩnh phụ |
| Nhân vật tách chroma + khung + nền mờ | `chromaKey` không có lớp khung; `blur` chỉ thuộc `blurFrame` |
| Giữ màu + khung | `keepColor` không có lớp khung |
| Video gốc lệch tâm, khung lệch tâm **khác** | `frameOverlayGeometry` ép hai thứ cùng tâm |
| Từ 2 ảnh tĩnh trở lên | Chỉ có đúng 1 khe khung + 1 khe ảnh người |
| Dải crop đen trắng trên nền mờ | `blur` không dùng được ngoài `blurFrame` |

## Phạm vi

**Chức năng mới hoàn toàn, tách hẳn.** 5 mode cũ, `render.js`, và 5 builder trong
`render-core.js` **không sửa một dòng nào**. Composer là một `renderMode` mới:
`"composer"`.

Đánh đổi đã cân nhắc và chấp nhận: code dựng filter graph tồn tại 2 hệ song song. Bù
lại, không có rủi ro hồi quy nào cho các mẻ video đang chạy sản xuất, và không phải
migrate `projects/*.json` hay sheet nào đang chạy.

Để vẫn được cái lợi "lấy mode cũ làm điểm khởi đầu", composer ship kèm **5 preset dựng
sẵn** tái tạo bố cục của 5 mode cũ, dạng **bản copy độc lập** — mở preset `crop` ra rồi
thêm lớp, mode `crop` thật nằm im.

### Rào cản kiến trúc mà spec cũ ghi sai

Spec `2026-08-02-crop-person-overlay-design.md:22` viết `render.js` "chạy như tiến trình
riêng từ `app.asar.unpacked` nên không import xuyên thư mục được". Không đúng. Luật
thật, do `tests/packaging.test.js:34` phát biểu và canh tự động: script được `asarUnpack`
chỉ không được import thư mục **chưa được bung ra**. `sheet/**` *đã có* trong
`asarUnpack` — chính file test đó đang `import { toUnpackedPath } from
"../sheet/render-core.js"`.

Nên compiler mới đặt trong `sheet/`, và **cả hai luồng đều dùng được**: luồng Sheet tự
động qua `render-core.js`, tab "Render" thủ công qua `render.js`. Mỗi bên chỉ **thêm một
nhánh**, không bỏ gì.

## Mô hình preset

```json
{
  "version": 1,
  "name": "khung-waveform",
  "base": { "w": 1280, "h": 720 },
  "layers": [ … ]
}
```

`layers` xếp **dưới → trên**. Mỗi lớp:

```json
{
  "id": "l4",
  "label": "Ảnh người",
  "slot": "anh_nguoi",
  "source":   { "type": "image", "path": "D:/assets/nguoi/" },
  "geometry": { "fit": "box", "w": -2, "h": 380, "anchor": "bottom-left", "dx": 40, "dy": 0 },
  "treatments": [ { "kind": "opacity", "value": 0.9 } ],
  "blend": "normal"
}
```

`slot` là tên khe để Sheet ghi đè đường dẫn theo từng kênh (xem phần Sheet). Lớp không
có `slot` thì không ghi đè được.

### Loại nguồn

| `type` | Input ffmpeg | Chỉ số | Vô hạn? |
|---|---|---|---|
| `background` | file nền, `-stream_loop -1` | **luôn `[0]`** | có |
| `overlay` | video gốc — **đúng 1 lớp**, nơi ra tiếng và quyết định độ dài | **luôn `[1]`** | không |
| `image` | `-loop 1` | `[2]` trở đi | có |
| `video` | `-stream_loop -1` | `[2]` trở đi | có |
| `solid` | `-f lavfi -i color=c={color}:s={w}x{h}:r=30` | `[2]` trở đi | có |
| `waveform` | không có input — sinh từ tiếng của lớp `overlay` | — | không |

`solid` và `waveform` **buộc** `fit: "box"`: kích thước của chúng nằm ngay trong tham số
sinh nguồn (`color=…:s={w}x{h}`, `showwaves=s={w}x{h}`), nên không có bước `scale` nào
sau đó. Chọn `fit` khác cho hai loại này là preset không hợp lệ.

Chỉ số `[0]` và `[1]` **cố định**, giữ đúng thứ tự `renderOne` đang dựng
(`render-core.js:492-494`: `ffmpeg(backgroundFile).inputOptions(["-stream_loop","-1"]).input(overlayFile)`).
Nhờ vậy nhánh composer không phải sửa phần chạy ffmpeg, GPU fallback, hay bóc lỗi.
Preset không có lớp `background` thì input `[0]` đơn giản không được tham chiếu — ffmpeg
không giải mã stream không dùng.

Từ `overlay` dùng đúng nghĩa sẵn có trong codebase: **video nguồn đang được xử lý**
(`overlayFolder`, `overlayFile`, `[1:a]…[overlay_audio]`), không phải lớp trang trí.

### Hình học

`fit` quyết định kích thước:

| `fit` | Sinh ra |
|---|---|
| `full` | `scale=1280:720` |
| `scale` + `value` | `scale={evenDown(1280*value)}:{evenDown(720*value)}` |
| `box` + `w`,`h` | `scale={w}:{h}`. `w: -2` = giữ tỉ lệ gốc, chiều rộng suy từ `h` |
| `none` | **không sinh gì** — dùng nguồn y nguyên |

`evenDown` làm tròn **xuống** số chẵn (yuv420p yêu cầu kích thước chẵn) — dùng lại đúng
công thức `render-core.js:168`.

`fit: "none"` là **khác biệt thứ 4** so với code cũ, phát hiện khi triển khai và **đã khép
lại** bằng cách bổ sung năng lực chứ không bằng cách nới lỏng phép so:

`chromaKey` (`render-core.js:80`), `crop` (`render-core.js:95`) và `keepColor`
(`render-core.js:159`) chồng thẳng lên `[0:v]` — **không scale lớp nền**. Chỉ
`topTransparent` (`render-core.js:63`) và `blurFrame` (`render-core.js:328`) scale nó. Nếu
compiler luôn sinh `scale=1280:720` cho mọi lớp thì graph của 3 mode kia có thêm một node,
và phép so theo đồ thị báo khác nhau — đúng như vậy đã xảy ra khi làm Task 6.

`fit: "none"` cho preset **khai tường minh** rằng lớp này dùng nguồn y nguyên. Ngoài chuyện
khớp graph cũ, nó còn bỏ được một bước scale vô ích trên từng khung hình của cả mẻ 60 video.
Không đặt vào `buildLayerChain` dạng suy đoán "khi nào thì bỏ scale" — suy đoán ngầm sẽ
thành cái bẫy cho preset mới.

Vị trí là **điểm neo + phần lệch**, không phải toạ độ tuyệt đối. Lý do cụ thể:
`chromaKey` dùng `overlay=0:H-h` — dán sát đáy *bất kể lớp cao bao nhiêu*; chuyển sang
`y` tuyệt đối thì đổi asset là lệch ngay.

| `anchor` | `x` | `y` |
|---|---|---|
| `top-left` | `0` | `0` |
| `top-center` | `(W-w)/2` | `0` |
| `top-right` | `W-w` | `0` |
| `middle-left` | `0` | `(H-h)/2` |
| `center` | `(W-w)/2` | `(H-h)/2` |
| `middle-right` | `W-w` | `(H-h)/2` |
| `bottom-left` | `0` | `H-h` |
| `bottom-center` | `(W-w)/2` | `H-h` |
| `bottom-right` | `W-w` | `H-h` |

`dx`/`dy` khác 0 thì cộng vào biểu thức (`H-h+40`); bằng 0 thì **không** thêm `+0` — để
chuỗi sinh ra khớp đúng chuỗi hiện tại.

### Treatments

Danh sách có tên, áp theo thứ tự, mỗi cái nối thêm vào chuỗi của **chính lớp đó**.
Không phải graph tự do: người dùng chọn từ 7 xử lý sẵn, không tự gõ filter ffmpeg.

| `kind` | Tham số | Sinh ra | Cần alpha? |
|---|---|---|---|
| `cropStrip` | `height`, `yOffset` | `crop=1280:{height}:0:{yOffset}` | không |
| `grayContrast` | `brightness`,`contrast`,`gamma`,`saturation` | `eq=brightness={b}:contrast={c}:gamma={g}:saturation={s}` | không |
| `blur` | `sigma` | `gblur=sigma={sigma}` | không |
| `chromakey` | `color`,`similarity`,`blend` | `colorkey=0x{color}:{similarity}:{blend}` | **sinh ra** alpha |
| `lumakey` | `threshold`,`tolerance`,`softness` | `lumakey=threshold={t}:tolerance={tol}:softness={s}` | cần |
| `opacity` | `value` | `colorchannelmixer=aa={value}` | cần |
| `keepColors` | `colors[]`, `similarity` | nhiều câu lệnh, xem dưới | sinh ra alpha |

**Luật chèn `format=yuva420p`** — compiler theo dõi một cờ `hasAlpha` khi dựng chuỗi và
chèn `format=yuva420p` **đúng một lần**:

- Treatment *cần* alpha (`lumakey`, `opacity`) mà `hasAlpha` chưa bật → chèn **trước** nó.
- `chromakey` *sinh ra* alpha → chèn **sau** nó nếu `hasAlpha` chưa bật.
- `blend: "screen"` không dùng alpha → thay bằng `format=yuv420p` ở cuối chuỗi.

Luật này tái tạo **chính xác** cả 3 thứ tự khác nhau đang tồn tại trong code hôm nay:

| Code hiện tại | Chuỗi |
|---|---|
| `chromaKey` (`render-core.js:76`) | `scale,colorkey=…,format=yuva420p` — format **sau** |
| `crop` (`render-core.js:89`) | `…,format=yuva420p,colorchannelmixer=aa=0.8` — format **trước** |
| `blurFrame` lumakey (`render-core.js:367`) | `scale,format=yuva420p,lumakey=…,colorchannelmixer=aa=` — format **trước** |

`keepColors` là treatment duy nhất sinh nhiều câu lệnh — giữ nguyên chuỗi
`split` → `colorkey`+`alphaextract`+`negate` mỗi màu → `blend=all_expr='max(A,B)'`
nối chuỗi → `alphamerge`, đúng như `render-core.js:126-146`.

### Chồng lớp

`blend: "normal"` → `overlay={x}:{y}:shortest=1`
`blend: "screen"` → `blend=all_mode=screen:all_opacity={opacity}:shortest=1`

Với `blend: "screen"`, treatment `opacity` của lớp **không** sinh
`colorchannelmixer=aa=`; giá trị của nó chuyển thành `all_opacity` của bước chồng, và
chuỗi lớp kết thúc bằng `format=yuv420p`. Đúng cách `blurFrame` đang làm
(`render-core.js:355-357`). `blend: "screen"` bỏ qua `x`/`y`/`anchor` — `blend` phủ toàn
khung, không có toạ độ.

**Mọi bước chồng đều kèm `shortest=1`.** Nền `-stream_loop -1`, ảnh `-loop 1`, khối màu
`color=` đều là nguồn vô hạn; độ dài hữu hạn chỉ đến từ lớp `overlay`. Bước nào chỉ toàn
nguồn vô hạn thì `shortest=1` vẫn cho ra vô hạn (vô hại); bước nào đã có lớp `overlay`
thì nó kết thúc đúng chỗ. `blurFrame` đã làm vậy và chạy tốt.

Nhưng **3 mode cũ không có `shortest=1`**: `topTransparent` (`overlay=0:0`), `chromaKey`
và `crop` (`overlay=0:H-h`) chỉ dựa vào `-t newDuration` để cắt. Nên preset dựng sẵn của
3 mode đó **khác bản gốc đúng ở chỗ thêm `:shortest=1`** — khác biệt cố ý, không phải
lỗi. Kiểm lại từng bước thì việc thêm là an toàn và chặt hơn: `topTransparent` có base là
lớp `overlay` hữu hạn nên `shortest=1` kết thúc đúng; `crop` có lớp ảnh người `-loop 1`
vô hạn nhưng bước chồng cuối đã có dải crop hữu hạn.

### Toạ độ: luôn dùng biểu thức, không dùng số

Compiler **luôn** sinh biểu thức anchor (`0`, `(W-w)/2`, `W-w`, `H-h`, …), không bao giờ
tính sẵn thành số. Lý do: chỉ biểu thức mới giữ được hành vi "dán sát đáy bất kể lớp cao
bao nhiêu", và lớp `w: -2` có chiều rộng không biết trước nên bắt buộc phải là biểu thức.

Hệ quả: **3 bước chồng của mode cũ khác textually nhưng bằng nhau về số**, vì code cũ
tính sẵn thành số ở những chỗ nó biết trước kích thước:

| Bước | Code cũ | Compiler |
|---|---|---|
| `crop` — ảnh người | `overlay={x}:{720-cropHeight-h}` | `overlay={x}:H-h-{cropHeight}` |
| `blurFrame` — video gốc | `overlay={x}:{y}` (số, từ `frameGeometry`) | `overlay=(W-w)/2:(H-h)/2` |
| `blurFrame` — khung | `overlay={x}:{y}` (số) | `overlay=(W-w)/2:(H-h)/2` |

Vì vậy test so DAG phải **bỏ qua toạ độ overlay**, và toạ độ được kiểm riêng bằng những
assert tường minh cho từng preset. Hai lớp test cộng lại mới phủ đủ: DAG lo topology +
chuỗi filter, assert riêng lo toạ độ.

### Waveform

Loại nguồn duy nhất động tới phần **audio** của graph: tiếng vừa ra loa vừa vẽ hình.

```
[1:a]asplit=2[a_out][a_wave]
[a_wave]showwaves=s={w}x{h}:mode={mode}:rate=30:colors={color},colorkey=0x000000:{tol}:0[wave]
[a_out]volume=1.0[overlay_audio]
```

Không có lớp waveform thì giữ nguyên `[1:a]volume=1.0[overlay_audio]` như hiện tại.
`mode`: `point` | `line` | `p2p` | `cline`.

## Compiler

```
compilePreset(preset, resolved) -> { extraInputs: [...], filterGraph: [...] }
```

Hàm thuần, không đụng ffmpeg, test được độc lập. `extraInputs` là các input từ `[2]` trở
đi (`[0]`/`[1]` do `renderOne` dựng sẵn). `filterGraph` kết thúc bằng nhãn
`[combined_video]` và có `[overlay_audio]` — **đúng giao diện `renderOne` đang trông
đợi** (`render-core.js:483-484`).

Hai kỷ luật bắt buộc, cả hai đều là bài học đã có trong code:

1. **Chỉ số input không được lệch.** `blurFrameLayers()` (`render-core.js:251`) tồn tại
   chính vì lý do này. Compiler giải quyết tận gốc: cấp input và sinh `[n:v]` trong
   **cùng một vòng lặp**, nên không có đường nào lệch.
2. **Chốt asset một lần, trước khi vào compiler.** `renderOne` gọi lại `run()` lần hai
   khi GPU lỗi phải lùi về CPU (`render-core.js:520`). Lớp nào có `path` là thư mục
   (bốc ngẫu nhiên qua `pickAsset`) phải chốt file **trước**, không thì lần render lại
   ra ảnh khác. Dùng lại `pickAsset` sẵn có.

### 5 preset dựng sẵn

Bằng chứng compiler tổng hợp được cả 5 mode, không phải lời hứa:

| Mode | Các lớp (dưới → trên) |
|---|---|
| `topTransparent` | `overlay` full → **`background`** full + `opacity` ← *nền nằm trên* |
| `chromaKey` | `background` full → `overlay` full + `chromakey`, neo `bottom-left` |
| `crop` | `background` full → `image` (ảnh người, `w:-2`, neo `bottom-*`, `dy:-cropHeight`) → `overlay` + `cropStrip` + `grayContrast` + `opacity 0.8`, neo `bottom-left` |
| `keepColor` | `background` full → `solid` đen neo `bottom-left` → `overlay` + `cropStrip` + `keepColors[…]`, neo `bottom-left` |
| `blurFrame` | `background` full + `blur` → `overlay` scale `.85` neo `center` + `opacity` → `image` (khung) scale neo `center` → `video` (hiệu ứng) full + `lumakey` + `opacity`, chồng `screen` |

`topTransparent` là bằng chứng thứ tự lớp phải **hoàn toàn tự do**: `[0:v]` (file nền)
thành `top_video` có alpha, `[1:v]` (video gốc) làm `base_video` — **nền nằm trên**
(`render-core.js:61-71`). Ràng buộc duy nhất là đúng một lớp `overlay`.

Khối đen của `keepColor` hiện dựng bằng `geq=r=0:g=0:b=0:a=300` trên một bản copy của
video gốc (`render-core.js:151`) — cách vòng vo để vẽ hình chữ nhật đen. Thành lớp
`solid` thì gọn hơn và **đặt được ở bất kỳ đâu**, không chỉ dán đáy. Đây là chỗ preset
dựng sẵn **không** cho ra graph giống hệt bản gốc; chấp nhận được vì đây là chức năng
mới, không phải refactor.

## Lưu trữ

| Chỗ | Nội dung |
|---|---|
| `app.getPath("userData")/presets/<tên>.json` | Preset của người dùng, ghi được ở bản cài thật |
| `presets-builtin/*.json` | 5 preset dựng sẵn, chỉ đọc, nằm trong asar |

Cùng cơ chế `projects/` đang dùng (`electron-main.js:722-725`). Lần đầu chạy thì **copy**
5 preset dựng sẵn sang `userData` — sửa được mà không mất bản gốc.

`sheet/preset-store.js`: `listPresets()`, `loadPreset(name)`, `savePreset(preset)`,
`validatePreset(preset)`, `applySlotOverrides(preset, overrides)`.

## Sheet

Thêm đúng 2 thứ, không sửa cột nào đang có:

| Cột | Ý nghĩa |
|---|---|
| `kiểu render` | nhận thêm một giá trị: `composer` |
| `preset` | tên preset. Chỉ đọc khi `kiểu render = composer` |

Các cột asset sẵn có (`khung`, `ảnh người`, `hiệu ứng`, …) thành **ghi đè theo khe** khi
ở chế độ composer: cột có giá trị thì ghi đè khe cùng tên, để trống thì dùng đường dẫn
mặc định trong preset. Một preset dùng cho 10 kênh, sửa bố cục một lần ăn cả 10, mà mỗi
kênh vẫn dùng asset riêng.

Kênh nào vẫn dùng `crop`/`blurFrame` thì chạy y như hôm nay, không biết composer tồn tại.

Bảng alias khe → tên cột đặt cùng chỗ với alias hiện có (`sheets-service.js:41`).

## Giao diện

Một màn hình, **không có trục thời gian**. Đây không phải app làm video:

| App làm video | Cái này |
|---|---|
| Timeline — lớp hiện ở giây 3, mất ở giây 10 | Mọi lớp hiện suốt video |
| Keyframe, animation, transition | Không |
| Cắt/ghép, nhiều track tiếng | Không |
| Bấm Export ra 1 video | Không export — chỉ định nghĩa bố cục, hàng đợi hiện tại render cả mẻ |

Bỏ timeline là cái cắt lớn nhất và đúng nhất: cả 5 mode hiện tại không có lớp nào xuất
hiện giữa video.

```
┌─ Preset: khung-waveform ──────────── [Lưu] [Lưu thành…] ─┐
│  ┌───────────────────────────┐   LỚP (kéo để đảo)         │
│  │                     ┌───┐ │   ⣿ 6 ▸ Cụm LIKE/SUB  🖼  │
│  │   ╔═══════════════╗ │LIKE│ │   ⣿ 5 ▸ Waveform      〜  │
│  │   ║  VIDEO GỐC    ║ │ CMT│ │   ⣿ 4 ▸ Khung         🖼  │
│  │   ╚═══════════════╝ │ SUB│ │   ⣿ 3 ▸ Video gốc     ▶  │
│  │      〜〜〜〜〜     └───┘ │   ⣿ 2 ▸ Ô bo góc      ▶  │
│  │                    ┌─────┐│   ⣿ 1 ▸ Nền           ▶  │
│  │                    │  ○  ││   ─────────────────────── │
│  └────────────────────└─────┘┘   THÔNG SỐ — Khung        │
│   canvas 1280×720 @ 50%           Nguồn  🖼 [D:/kh/…] […] │
│   [ Xem thu 1 frame ]  giây [12]  Khe    [khung        ]  │
│   ┌──── PNG thật ────┐            Vị trí ⌗ 3×3  dx 0 dy 0│
│   │                  │            Cỡ    ◉box w 980 h 560 │
│   └──────────────────┘            Xử lý  (chưa có)   [+]  │
│                                   Chồng  normal ▾    1.0  │
└───────────────────────────────────────────────────────────┘
```

**Canvas không vẽ ô xám.** Nó trích sẵn **1 khung hình thật** từ một video trong
`overlayFolder` và một trong `backgroundFolder`, dùng làm hình đại diện cho 2 lớp video.
Canvas gần như đúng thật về hình học ngay khi kéo; chỉ `chromakey`/`blur`/`waveform` là
xấp xỉ vì đó là xử lý điểm ảnh.

**Kéo thả sinh ra anchor, không sinh toạ độ tuyệt đối.** Khi kéo, lớp hít vào 9 điểm neo
+ 2 đường tâm; nhả ra thì tính điểm neo gần nhất rồi ghi phần lệch vào `dx`/`dy`. Giữ
`Alt` để bỏ hít. Giữ được cảm giác kéo thả tự nhiên mà không mất hành vi "dán sát đáy
bất kể ảnh cao bao nhiêu".

**Nút "Xem thu 1 frame" dùng đúng compiler**, không có đường render riêng — preview có
đường riêng là preview nói dối. `sheet/preview-frame.js` gọi ffmpeg với đúng
`filterGraph` của compiler, thêm `-ss {giây}` trên input `overlay` và `-frames:v 1`,
không map audio ra file.

Hai giới hạn của preview 1 frame, phải ghi rõ trong UI:

1. `setpts`/`atempo` (tốc độ `videoSpeed`) không thể hiện trên ảnh tĩnh.
2. Waveform ở giây 12 vẽ từ tiếng tại giây 12 — xem thu ở giây khác ra sóng khác. Bình
   thường, không phải lỗi.

## Nơi sửa

### Thêm mới

| File | Việc |
|---|---|
| `sheet/layer-compiler.js` | `compilePreset`, hình học/anchor, 7 treatment. Hàm thuần |
| `sheet/preset-store.js` | Đọc/ghi/liệt kê/kiểm tra preset, trộn ghi-đè-theo-khe |
| `sheet/preview-frame.js` | Xuất 1 PNG tại giây N từ video thật |
| `presets-builtin/*.json` | 5 preset dựng sẵn |
| `tests/layer-compiler.test.js` | |
| `tests/preset-store.test.js` | |

### Sửa — chỉ cộng thêm nhánh

| File | Việc |
|---|---|
| `sheet/render-core.js` | `renderOne`: nhánh `renderMode === "composer"` → chốt asset, gọi `compilePreset`, đẩy `extraInputs` vào `studioInputs`. 5 nhánh cũ y nguyên |
| `render.js` | Cùng một nhánh, `import` từ `sheet/layer-compiler.js`. 5 builder cũ y nguyên |
| `sheet/sheets-service.js` | Cột `preset`; alias khe cho ghi đè |
| `sheet/sheet-runner.js` | Nạp preset theo tên, áp ghi đè theo khe |
| `renderer.html` / `renderer.js` | Panel composer |
| `electron-main.js` | IPC: liệt kê/đọc/ghi preset, trích khung hình đại diện, xem thu 1 frame |

**`package.json` không phải sửa.** `sheet/**` đã có trong `asarUnpack` nên `render.js`
import `sheet/layer-compiler.js` là hợp lệ. `presets-builtin/` không cần `asarUnpack`:
chỉ `electron-main.js` đọc nó, một lần, để copy sang `userData` — tiến trình main đọc
xuyên asar được. Preset lúc chạy luôn đọc từ `userData`, nằm ngoài asar.

## Thứ tự triển khai

Spec này quá lớn cho một kế hoạch triển khai duy nhất — nó gộp cả một engine dựng filter
graph và một trình soạn kéo thả. Tách làm 2 giai đoạn, mỗi giai đoạn một kế hoạch riêng:

**Giai đoạn 1 — Engine, chưa có UI.** `layer-compiler.js`, `preset-store.js`, 5 preset
dựng sẵn, 2 nhánh `composer` trong `render-core.js` và `render.js`, cột Sheet. Kiểm bằng
preset **viết tay bằng JSON**. Kết thúc giai đoạn này bạn đã render được bố cục mới
(kể cả bố cục trong ảnh mẫu) — chỉ là phải gõ JSON. Đây là chỗ chứa toàn bộ rủi ro kỹ
thuật, và đóng được cả 5 rủi ro cần render thật.

**Giai đoạn 2 — Trình thiết kế.** Canvas kéo thả, danh sách lớp, bảng thông số, trích
khung hình đại diện, xem thu 1 frame, IPC. Không có rủi ro kỹ thuật nào còn lại; thuần
giao diện.

Chia thế này vì nếu làm ngược (UI trước) thì bạn có một trình soạn đẹp mà chưa biết
compiler có dựng đúng graph không. Làm engine trước thì mỗi bước đều kiểm chứng được
bằng render thật.

## Xử lý lỗi

Luồng Sheet **chạy không người trông**: một ô gõ sai không được làm hỏng cả mẻ 60 video.
Giữ đúng nguyên tắc `resolveBlurFrameAssets`/`resolvePersonAsset` đang dùng.

| Tình huống | Hành vi |
|---|---|
| Lớp có `path` hỏng/trống | Cảnh báo qua `onProgress`, **bỏ lớp đó**, video vẫn render |
| Thư mục không có file đúng đuôi | Như trên |
| Preset không tồn tại | Bỏ qua kênh đó, cảnh báo — các kênh khác chạy tiếp |
| Preset không có lớp `overlay` | Từ chối ngay khi **lưu** trong UI; bỏ qua kênh khi chạy |
| Preset có 2+ lớp `overlay` | Như trên |
| Tham số ngoài khoảng | Rơi về mặc định, đúng cách `frameGeometry` làm (`render-core.js:176`) |
| `anchor` không hợp lệ | Rơi về `center` |

Không tình huống nào được ném lỗi làm chết cả mẻ.

## Test

`tests/layer-compiler.test.js`:

- **Test then chốt**: 5 preset dựng sẵn qua compiler, so với **DAG** của chuỗi filter
  hiện tại. So theo đồ thị — chuẩn hoá tên nhãn theo thứ tự duyệt topo — chứ không so
  chuỗi thô, vì thứ tự câu lệnh trong `filter_complex` không ảnh hưởng ffmpeg (nhãn ràng
  buộc chúng).

  **Không cần đóng băng fixture**: 5 builder cũ vẫn còn nguyên trong code (đây là chức
  năng tách hẳn), nên test gọi thẳng `buildComplexFilter("crop", cfg)` để so. So sống như
  vậy còn tốt hơn fixture — ai sửa builder cũ là test bắt được ngay.

  Ba khác biệt **cố ý**, phải khai báo tường minh trong test chứ không được nới lỏng
  chung: (1) `:shortest=1` thêm vào 3 mode cũ chưa có; (2) toạ độ overlay dạng biểu thức
  thay vì số ở 3 bước; (3) `keepColor` dùng lớp `solid` thay `geq`.
- Luật `format=yuva420p`: cả 3 thứ tự trong bảng đối chiếu ra đúng chuỗi.
- Chỉ số input `[n:v]` khớp đúng số `extraInputs`, với mọi tổ hợp bật/tắt lớp.
- `shortest=1` có ở **mọi** bước chồng.
- `waveform` sinh `asplit`, và `[overlay_audio]` vẫn nguyên vẹn; không có waveform thì
  giữ đúng `[1:a]volume=1.0[overlay_audio]`.
- Anchor: 9 giá trị ra 9 cặp biểu thức đúng; `dx`/`dy` bằng 0 **không** sinh `+0`.
- `fit: "box"` với `w: -2` ra `scale=-2:{h}`.
- Lớp `path` hỏng → có cảnh báo, không ném.

`tests/preset-store.test.js`:

- Ghi đè theo khe: cột có giá trị thắng, cột trống dùng mặc định preset.
- `validatePreset`: 0 lớp `overlay` → từ chối; 2 lớp `overlay` → từ chối.
- Preset dựng sẵn được copy sang `userData` lần đầu, lần sau không ghi đè bản đã sửa.

`tests/packaging.test.js` đã có sẵn test canh import xuyên thư mục — nó sẽ tự bắt nếu
`render.js` import một thư mục chưa `asarUnpack`.

Phần UI không có test tự động — kiểm bằng tay.

## Rủi ro phải kiểm chứng bằng render thật

Test đơn vị không nói được những điều dưới đây:

1. **Độ dài video khi có nhiều nguồn vô hạn.** Luật "luôn `shortest=1`" đúng trên lý
   thuyết nhưng phải render thật một preset có 3+ lớp vô hạn (nền + 2 ảnh) để chắc chắn
   không treo và độ dài vẫn đúng `-t newDuration`. Đây đúng là rủi ro mà spec
   `2026-08-02` đã ghi và vẫn chưa đóng.
2. **Preset không có lớp `background`.** Input `[0]` `-stream_loop -1` không được tham
   chiếu — trên lý thuyết ffmpeg không giải mã stream không dùng, cần xác nhận không
   treo.
3. **`showwaves` có thật sự trong suốt** sau `colorkey=0x000000` không, và giá trị dung
   sai nào cho ra sóng sạch mà không ăn mất phần tối của sóng.
4. **Ảnh không có kênh alpha** ra khối chữ nhật đặc. Lỗi dữ liệu vào, không phải lỗi
   code — ghi rõ trong hướng dẫn.
5. **Trích khung hình đại diện cho canvas** trên video 4K/dọc: thời gian trích và kích
   thước ảnh tạm.
