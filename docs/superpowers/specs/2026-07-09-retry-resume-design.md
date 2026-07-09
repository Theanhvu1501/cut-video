# Retry / Resume cho pipeline tải → render → upload

Ngày: 2026-07-09
Phạm vi: `sheet/sheet-runner.js`, `sheet/channel-download.js`, `sheet/proxy.js` (mới),
`sheet/resume-plan.js` (mới), `sheet/resume-state.js` (mới), `download.js`.

## Vấn đề

Một URL chạy qua ba bước: tải → render → upload. Hiện tại chỉ có **một** ô trạng thái
cho hai bước đầu (cột B của tab kênh), với ba giá trị: rỗng, `done`, `error: <msg>`.

Hệ quả:

1. **Không resume được.** Tải xong mà render lỗi thì lượt sau phải tải lại từ đầu.
2. **Không retry.** `sheet-runner.js:43` chỉ nhặt dòng có `status === ""`, nên dòng
   `error:` nằm chết cho tới khi người dùng tự xoá ô status.
3. **Bẫy kẹt.** Khi render lỗi, `unlink(dl.filePath)` (`sheet-runner.js:87`) không chạy
   nên file `.mp4` còn lại trong `overlays/`. Nếu người dùng xoá ô status để ép chạy lại,
   `downloadOne` gọi yt-dlp với `noOverwrites: true` → yt-dlp bỏ qua, không tạo file mới →
   `pickDownloadedFile` so sánh thư mục trước/sau thấy không có `.mp4` nào mới →
   ném `Không tìm thấy file tải về cho URL`. Thông báo lỗi đổ oan cho bước tải trong khi
   file đang nằm sẵn trên đĩa.
4. **Upload lỗi là ngõ cụt.** Render xong (B = `done`) nhưng upload hỏng (C = `❌ lỗi:`)
   thì không gì chạy lại, vì bộ chọn chỉ nhìn cột B.
5. **Proxy thiếu scheme bị bỏ qua lặng lẽ.** `isValidProxy` (`channel-download.js:12-14`)
   đòi `^(http|https|socks5)://`. Dạng `host:port` hay `host:port:user:pass` trả `false`,
   và dòng 36 chỉ đơn giản không set `options.proxy` → tải thẳng bằng IP thật, không log.
   Đây là hành vi nguy hiểm nhất với người dùng đang dựa vào proxy để né bot-check.

## Nguyên tắc thiết kế

- **Không đổi tên file tải về.** `thumb-match.js` khớp thumbnail bằng `<title>.jpg` cạnh
  `<title>.mp4`. Đặt tên theo `videoId` sẽ phá liên kết này.
- **Không thêm cột mới vào Sheet.** Cột B và C đủ chỗ để mô tả mốc.
- **Sheet là nguồn sự thật cho con người**; file JSON cạnh nó giữ chi tiết máy cần
  (đường dẫn file, số lần thử) mà không tiện phơi ra Sheet.
- **Không đụng retry nội bộ của `upload-queue.js`.** Phần đó đã đúng: chỉ thử lại khi
  chưa bắt đầu đẩy byte, tránh tạo bản nháp trùng.

## Từ vựng trạng thái

### Cột B — tiến trình tải/render

| Giá trị | Nghĩa | Hành động lượt sau |
|---|---|---|
| `""` | chưa xử lý | tải + render |
| `đã tải` | tải xong, chưa render xong | chỉ render |
| `lỗi tải: <msg>` | bước tải hỏng | tải + render |
| `lỗi render: <msg>` | bước render hỏng | chỉ render |
| `done` | render xong | không render lại |
| `bỏ qua: <msg> (đã thử 3 lần)` | hết lượt thử | bỏ qua hẳn |

### Cột C — tiến trình upload (giữ nguyên từ vựng hiện có)

| Giá trị | Nghĩa |
|---|---|
| `""` | chưa upload |
| `⏳ đang upload`, các bước trung gian | đang chạy |
| `✅ lên lịch <thời gian>` | xong |
| `❌ lỗi: <msg>` | hỏng |
| `bỏ qua: <msg> (đã thử 3 lần)` | hết lượt thử |

## Bộ quyết định — `sheet/resume-plan.js`

Hàm thuần, không I/O, dễ test độc lập:

```js
decideAction({ statusB, statusC, attempts, uploadAttempts, overlayExists, outputExists })
  -> "full" | "render-only" | "upload-only" | "upload-exhausted" | "skip"
```

Luật, xét theo thứ tự:

1. `statusB` bắt đầu bằng `bỏ qua:` → `skip`.
2. `statusB === "done"`:
   - `statusC` không bắt đầu bằng `❌` → `skip`
   - `outputExists` sai → `skip`
   - `uploadAttempts >= 3` → `upload-exhausted` (runner ghi `bỏ qua:` vào cột C)
   - ngược lại → `upload-only`
3. `statusB === ""` → `full` (và reset `attempts` về 0).
4. `statusB === "đã tải"` hoặc bắt đầu bằng `lỗi render:`:
   - `overlayExists` → `render-only`
   - ngược lại → `full` (người dùng đã xoá file tay)
5. `statusB` bắt đầu bằng `lỗi tải:` → `full`.
6. Mọi giá trị lạ → `skip` (an toàn: không đoán).

Cần `upload-exhausted` vì kết quả upload do `upload-queue` ghi vào cột C ở lượt
trước, nên "hết lượt thử upload" chỉ phát hiện được ở lượt sau. Ngược lại, "hết
lượt thử render" phát hiện ngay tại chỗ lỗi nên ghi `bỏ qua:` được luôn.

`overlayExists` và `outputExists` được suy ra từ `filePath`/`outputPath` trong entry JSON.
Nếu entry không tồn tại (file JSON bị xoá, hoặc máy khác chạy), cả hai là `false` —
`đã tải` sẽ rơi về `full`, `done` + `❌` sẽ rơi về `skip`. Mất file JSON làm hệ thống
chậm lại chứ không làm nó sai.

Điều kiện `outputExists` ở luật 2 quan trọng: nếu file render đã bị xoá thì không thể
upload lại, và ta không muốn `full` vì như vậy sẽ đốt quota render cho một video đã
render thành công. Trả `skip` và để người dùng xoá ô B nếu thật sự muốn làm lại.

## Trạng thái resume — `sheet/resume-state.js`

File `runner-state.json` hiện có giữ quota theo ngày. Thêm file riêng
`resume-state.json` cùng thư mục (`s.channelsRoot`, xem `electron-main.js:1352`), khoá
theo `sheetName` rồi `videoId` (dùng `videoIdOf` sẵn có trong `sheet/youtube-api.js`):

```json
{
  "Kênh A": {
    "dQw4w9WgXcQ": {
      "stage": "downloaded",
      "attempts": 1,
      "uploadAttempts": 0,
      "filePath": ".../overlays/Tiêu đề.mp4",
      "outputPath": ".../output/Tiêu đề.mp4",
      "title": "Tiêu đề"
    }
  }
}
```

Vòng đời entry:

- Tạo ở lần chạm đầu tiên của URL.
- `stage` chuyển `downloaded` → `rendered`.
- `attempts` tăng khi bước tải hoặc render thất bại; `uploadAttempts` tăng khi một lượt
  `upload-only` thất bại.
- **Xoá entry chỉ khi cả B = `done` và C bắt đầu bằng `✅`.** Không xoá ngay sau render,
  vì `upload-only` ở lượt sau cần `outputPath` và `title`.
- Nếu cột B là `""` (người dùng xoá tay) → xoá entry, coi như làm lại từ đầu.

**Kỷ luật đồng bộ:** `load` và `save` là đồng bộ, và **không được `await` giữa hai lời
gọi**. `sheet-runner.js:82-83` đã ghi rõ lý do: các task `pLimit` chạy song song, một
`await` xen vào giữa load-modify-save sẽ làm mất lượt tăng biến đếm.

## Số lần thử

Trần cố định 3 cho mỗi nhóm bước, đếm riêng:

- `attempts` — cho tải và render gộp chung.
- `uploadAttempts` — cho các lượt `upload-only`.

Chạm trần thì ghi `bỏ qua: <msg> (đã thử 3 lần)` vào đúng cột tương ứng (B cho
tải/render, C cho upload). Tiền tố `bỏ qua:` không nằm trong bộ chọn nên URL nghỉ hẳn.
Muốn hồi sinh: xoá ô status tương ứng trong Sheet.

Lưu ý về tổng số lần thử upload: `upload-queue.js` đã tự retry 3 lần **trong một lượt**.
Cộng với 3 lượt `upload-only` **qua các lần chạy**, một video hỏng có thể bị thử tối đa
9 lần trước khi bỏ. Đây là chủ ý — retry nội bộ xử lý lỗi chớp nhoáng (mất kết nối GPM),
retry qua lượt xử lý lỗi kéo dài (YouTube tạm khoá).

## Dọn file

Quy tắc phân biệt theo bước hỏng — đây là điểm dễ làm sai nhất:

| Tình huống | File `overlays/<title>.mp4` | File `overlays/<title>.jpg` |
|---|---|---|
| Tải hỏng | xoá phần dở dang trước khi thử lại | xoá nếu có |
| Render hỏng | **giữ** (đây là thứ để resume) | giữ |
| Render xong | xoá | **giữ** (thumb cho upload) |
| Upload xong | — | có thể giữ, không ảnh hưởng |

Bọc `unlink` trong `finally` là **sai**: nó xoá file ngay cả khi render hỏng, giết luôn
khả năng resume. Phải xoá trong nhánh thành công và trong nhánh "lỗi tải", không xoá
trong nhánh "lỗi render".

Vì `full` chỉ chạy khi không có overlay hợp lệ, `downloadOne` không bao giờ bị gọi trên
một file `.mp4` đã hoàn chỉnh. Bẫy kẹt ở mục 3 phần Vấn đề biến mất mà không cần sửa
`noOverwrites` hay `pickDownloadedFile`.

## Quota

`computeRemaining` giới hạn số video **render** mỗi ngày. Job `upload-only` không render
nên **không được tính vào quota** và không bị `pending.slice(0, remaining)` cắt. Chia
danh sách việc làm hai: nhóm `upload-only` chạy hết, nhóm `full`/`render-only` mới bị cắt
theo `remaining`.

## Proxy — `sheet/proxy.js`

Chuyển `normalizeProxy` từ `download.js:110-150` sang module dùng chung, xoá bản sao cũ.

```js
normalizeProxy(raw) -> string   // ném Error nếu không parse được
```

Chấp nhận:

| Đầu vào | Kết quả |
|---|---|
| `socks5://1.2.3.4:1080` | giữ nguyên |
| `http://user:pass@host:8080` | giữ nguyên |
| `1.2.3.4:8080` | `http://1.2.3.4:8080` |
| `1.2.3.4:8080:user:pass` | `http://user:pass@1.2.3.4:8080` |
| `rác` | ném `Error("Proxy không hợp lệ: rác")` |

Scheme hợp lệ: `http`, `https`, `socks5`, `socks5h`. Thiếu scheme → mặc định `http`.
Port phải là số trong khoảng 1–65535.

`channel-download.js` bỏ `isValidProxy`, gọi `normalizeProxy`. Nếu kênh có điền proxy
mà parse hỏng thì **`runChannel` phát lỗi và bỏ qua kênh đó, không tải video nào**.
Lý do: im lặng tải thẳng bằng IP thật đúng là kết cục tệ nhất cho người đang dùng proxy
để né bot-check. Thà dừng còn hơn lộ IP. Proxy để trống vẫn là hợp lệ (tải thẳng, có chủ ý).

## Kiểm thử

Tất cả chạy với dep giả, theo đúng lối `tests/sheet-runner.test.js` đang dùng.

- `resume-plan.test.js` — bảng đầu vào/đầu ra cho `decideAction`, phủ cả 6 luật, gồm ca
  `statusB = "lỗi render:"` mà `overlayExists = false` → `full`, và ca `done` + `❌` +
  `outputExists = false` → `skip`.
- `resume-state.test.js` — vòng đời entry: tạo, tăng `attempts`, xoá khi hoàn tất, reset
  khi cột B rỗng.
- `sheet-runner.test.js` (bổ sung) — `render-only` không gọi `downloader`; `upload-only`
  không gọi `downloader` lẫn `renderer` nhưng có gọi `uploadQueue.enqueue`;
  `upload-only` không bị quota cắt; chạm trần 3 lần thì ghi `bỏ qua:`.
- `proxy.test.js` — bảng chuyển đổi ở trên, kèm ca port không phải số và ca chuỗi rỗng.
- `channel-download.test.js` (bổ sung) — proxy hỏng thì ném lỗi, không âm thầm bỏ qua.

## Ngoài phạm vi

- Không đổi tên file tải về.
- Không thêm cột Sheet.
- Không sửa retry nội bộ của `upload-queue.js`.
- Không tự xoá video trong `output/` sau khi upload — để người dùng quyết định.
- Không phân biệt lỗi tạm thời với lỗi vĩnh viễn; trần 3 lần áp dụng đồng đều.
