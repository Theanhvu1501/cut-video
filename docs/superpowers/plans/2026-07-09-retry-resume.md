# Retry / Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép chạy lại đúng bước bị lỗi (tải / render / upload) thay vì chạy lại cả quy trình, và sửa lỗi proxy thiếu scheme bị bỏ qua lặng lẽ.

**Architecture:** Cột B và C của tab kênh trở thành mốc trạng thái đọc được bằng mắt. Một file `resume-state.json` cạnh `runner-state.json` giữ đường dẫn file và số lần thử. Một hàm thuần `decideAction` đọc hai cột đó cộng với sự tồn tại của file trên đĩa để chọn một trong năm hành động, và `runChannel` chỉ việc thi hành.

**Tech Stack:** Node ESM, `node --test` + `node:assert/strict`, `p-limit`, googleapis, yt-dlp qua `youtube-dl-exec`, fluent-ffmpeg.

## Global Constraints

- Spec nguồn: `docs/superpowers/specs/2026-07-09-retry-resume-design.md`.
- Không đổi tên file tải về — `thumb-match.js` khớp `<title>.jpg` cạnh `<title>.mp4`.
- Không thêm cột mới vào Google Sheet. Chỉ dùng cột A (url), B (render), C (upload).
- Không sửa retry nội bộ của `upload-queue.js`.
- `MAX_ATTEMPTS = 3` cho cả `attempts` (tải+render) và `uploadAttempts`.
- Kỷ luật đồng bộ: giữa `resumeStore.load()` và `resumeStore.save()` **không được có `await`**. Lý do ở `sheet-runner.js:82-83` — task `pLimit` chạy song song, một `await` xen vào giữa sẽ làm mất lượt tăng biến đếm.
- Chuỗi trạng thái là hằng số export từ `sheet/resume-plan.js`, không viết chuỗi trần rải rác.
- Chạy toàn bộ test: `npm test`. Chạy một file: `node --test tests/<tên>.test.js`.
- Mọi file mới dùng ESM (`import`/`export`), khớp phần còn lại của repo.

---

### Task 1: Module chuẩn hoá proxy

**Files:**
- Create: `sheet/proxy.js`
- Test: `tests/proxy.test.js`

**Interfaces:**
- Consumes: không có.
- Produces: `normalizeProxy(raw: string) -> string` (ném `Error` nếu không parse được). Task 2 và Task 6 dùng.

- [ ] **Step 1: Write the failing test**

Tạo `tests/proxy.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeProxy } from "../sheet/proxy.js";

test("normalizeProxy giữ nguyên chuỗi đã đủ scheme", () => {
  assert.equal(normalizeProxy("socks5://1.2.3.4:1080"), "socks5://1.2.3.4:1080");
  assert.equal(normalizeProxy("http://user:pass@host.vn:8080"), "http://user:pass@host.vn:8080");
  assert.equal(normalizeProxy("HTTPS://1.2.3.4:443"), "https://1.2.3.4:443");
});

test("normalizeProxy thêm scheme http khi thiếu", () => {
  assert.equal(normalizeProxy("1.2.3.4:8080"), "http://1.2.3.4:8080");
  assert.equal(normalizeProxy("  1.2.3.4:8080  "), "http://1.2.3.4:8080");
});

test("normalizeProxy đổi host:port:user:pass sang dạng URL", () => {
  assert.equal(normalizeProxy("1.2.3.4:8080:bob:s3cret"), "http://bob:s3cret@1.2.3.4:8080");
  assert.equal(normalizeProxy("socks5://1.2.3.4:1080:bob:s3cret"), "socks5://bob:s3cret@1.2.3.4:1080");
});

test("normalizeProxy là idempotent (chuẩn hoá lần hai không đổi)", () => {
  const once = normalizeProxy("1.2.3.4:8080:bob:s3cret");
  assert.equal(normalizeProxy(once), once);
});

test("normalizeProxy ném lỗi với đầu vào hỏng", () => {
  assert.throws(() => normalizeProxy(""), /chuỗi rỗng/);
  assert.throws(() => normalizeProxy("   "), /chuỗi rỗng/);
  assert.throws(() => normalizeProxy("rác"), /không hợp lệ/);
  assert.throws(() => normalizeProxy("1.2.3.4:abc"), /không hợp lệ/);
  assert.throws(() => normalizeProxy("1.2.3.4:70000"), /không hợp lệ/);
  assert.throws(() => normalizeProxy("ftp://1.2.3.4:21"), /không hỗ trợ/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/proxy.test.js`
Expected: FAIL — `Cannot find module '.../sheet/proxy.js'`

- [ ] **Step 3: Write minimal implementation**

Tạo `sheet/proxy.js`:

```js
// Chuẩn hoá chuỗi proxy người dùng nhập thành URL yt-dlp hiểu được.
// Chấp nhận: scheme://[user:pass@]host:port, host:port, host:port:user:pass.
// Thiếu scheme -> mặc định http. Ném Error nếu không parse được — KHÔNG bao giờ
// trả null, vì im lặng bỏ qua proxy đồng nghĩa tải bằng IP thật.

const SCHEMES = new Set(["http", "https", "socks5", "socks5h"]);

function validPort(p) {
  if (!/^\d+$/.test(String(p ?? ""))) return false;
  const n = Number(p);
  return n >= 1 && n <= 65535;
}

export function normalizeProxy(raw) {
  const input = String(raw ?? "").trim();
  if (!input) throw new Error("Proxy không hợp lệ: chuỗi rỗng");

  let scheme = "http";
  let rest = input;
  const m = input.match(/^([A-Za-z0-9]+):\/\/(.*)$/);
  if (m) {
    scheme = m[1].toLowerCase();
    rest = m[2];
    if (!SCHEMES.has(scheme)) throw new Error(`Proxy không hợp lệ: scheme "${scheme}" không hỗ trợ`);
  }

  // Đã có dạng user:pass@host:port
  const at = rest.lastIndexOf("@");
  if (at !== -1) {
    const auth = rest.slice(0, at);
    const [host, port] = rest.slice(at + 1).split(":");
    if (!auth || !host || !validPort(port)) throw new Error(`Proxy không hợp lệ: ${input}`);
    return `${scheme}://${auth}@${host}:${port}`;
  }

  const parts = rest.split(":");
  if (parts.length === 2) {
    const [host, port] = parts;
    if (!host || !validPort(port)) throw new Error(`Proxy không hợp lệ: ${input}`);
    return `${scheme}://${host}:${port}`;
  }
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    if (!host || !validPort(port) || !user || !pass) throw new Error(`Proxy không hợp lệ: ${input}`);
    return `${scheme}://${user}:${pass}@${host}:${port}`;
  }
  throw new Error(`Proxy không hợp lệ: ${input}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/proxy.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add sheet/proxy.js tests/proxy.test.js
git commit -m "feat(proxy): module chuẩn hoá proxy, ném lỗi thay vì im lặng bỏ qua"
```

---

### Task 2: Dùng `normalizeProxy` ở cả hai đường tải

**Files:**
- Modify: `sheet/channel-download.js:12-14` (xoá `isValidProxy`), `sheet/channel-download.js:36`
- Modify: `download.js:110-150` (xoá `normalizeProxy` bản sao), `download.js:213-226`
- Test: `tests/channel-download.test.js` (create)

**Interfaces:**
- Consumes: `normalizeProxy` từ Task 1.
- Produces: `downloadOne(url, outputDir, { proxy, cookiesFile, ytdlpPath, ytdlFactory })` — ném `Error` nếu `proxy` khác rỗng và không parse được. `ytdlFactory` là điểm tiêm để test (mặc định `createYoutubeDl` của `youtube-dl-exec`); không dùng ở production.

- [ ] **Step 1: Write the failing test**

Tạo `tests/channel-download.test.js`. Các test này gọi `downloadOne` thật, với
`ytdlFactory` giả nên không chạm mạng, và với `outputDir` là thư mục tạm thật.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickDownloadedFile, downloadOne } from "../sheet/channel-download.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dl-"));
}

// ytdl giả: ghi ra đúng file mp4 mà downloadOne mong đợi, và ghi lại options.
function fakeYtdlFactory(seen) {
  return () => async (url, options) => {
    seen.push(options);
    const dir = path.dirname(options.output);
    fs.writeFileSync(path.join(dir, "Tiêu đề.mp4"), "x");
  };
}

test("pickDownloadedFile chỉ nhận mp4 mới xuất hiện", () => {
  assert.equal(pickDownloadedFile(["a.mp4"], ["a.mp4", "b.mp4", "b.jpg"]), "b.mp4");
  assert.equal(pickDownloadedFile(["a.mp4"], ["a.mp4"]), null);
});

test("downloadOne chuẩn hoá proxy thiếu scheme trước khi gọi yt-dlp", async () => {
  const dir = tmpDir();
  const seen = [];
  const out = await downloadOne("https://youtu.be/dQw4w9WgXcQ", dir, {
    proxy: "1.2.3.4:8080",
    ytdlFactory: fakeYtdlFactory(seen),
  });
  assert.equal(seen[0].proxy, "http://1.2.3.4:8080");
  assert.equal(out.title, "Tiêu đề");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("downloadOne ném lỗi với proxy hỏng và KHÔNG gọi yt-dlp", async () => {
  const dir = tmpDir();
  const seen = [];
  await assert.rejects(
    () => downloadOne("https://youtu.be/dQw4w9WgXcQ", dir, { proxy: "rác", ytdlFactory: fakeYtdlFactory(seen) }),
    /Proxy không hợp lệ/,
  );
  assert.deepEqual(seen, []); // chưa hề chạm mạng
  fs.rmSync(dir, { recursive: true, force: true });
});

test("downloadOne không set proxy khi để trống (cố ý tải thẳng)", async () => {
  const dir = tmpDir();
  const seen = [];
  await downloadOne("https://youtu.be/dQw4w9WgXcQ", dir, { proxy: "  ", ytdlFactory: fakeYtdlFactory(seen) });
  assert.equal("proxy" in seen[0], false);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/channel-download.test.js`
Expected: FAIL — `downloadOne` chưa nhận `ytdlFactory` nên nó gọi yt-dlp thật và
test treo hoặc lỗi mạng; test proxy hỏng cũng FAIL vì hiện tại proxy `rác` bị bỏ
qua lặng lẽ chứ không ném.

- [ ] **Step 3: Sửa `sheet/channel-download.js`**

Xoá hàm `isValidProxy` (dòng 12-14). Thêm import ở đầu file, sau các import sẵn có:

```js
import { normalizeProxy } from "./proxy.js";
```

Sửa chữ ký (dòng 16) để nhận điểm tiêm, và chuẩn hoá proxy **trước** khi tạo client:

```js
export async function downloadOne(url, outputDir, { proxy, cookiesFile, ytdlpPath, ytdlFactory = createYoutubeDl } = {}) {
  // Proxy rỗng = cố ý tải thẳng. Proxy có giá trị mà hỏng -> ném lỗi trước khi
  // chạm mạng, không tải bằng IP thật (kết cục tệ nhất cho người né bot-check).
  const proxyUrl = String(proxy ?? "").trim() ? normalizeProxy(proxy) : null;

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const before = fs.readdirSync(outputDir);

  const ytdl = ytdlFactory(ytdlpPath);
```

Xoá dòng 36 cũ (`if (isValidProxy(proxy)) options.proxy = proxy.trim();`) và thay bằng:

```js
  if (proxyUrl) options.proxy = proxyUrl;
```

- [ ] **Step 4: Sửa `download.js` để dùng chung một bản**

Xoá toàn bộ hàm `normalizeProxy` ở `download.js:110-150`. Thêm import ở đầu file:

```js
import { normalizeProxy } from "./sheet/proxy.js";
```

Thay khối `download.js:213-226` bằng:

```js
  // Thêm proxy nếu có (chuẩn hoá; hỏng thì dừng chứ không tải bằng IP thật)
  if (PROXY && typeof PROXY === "string" && PROXY.trim()) {
    const proxy = normalizeProxy(PROXY.trim());
    options.proxy = proxy;
    console.log(`🔒 Sử dụng proxy: ${proxy}`);
  }
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS toàn bộ. Nếu có test nào của `download.js` gãy vì `normalizeProxy` giờ ném thay vì trả `null`, sửa test cho khớp hợp đồng mới.

- [ ] **Step 6: Commit**

```bash
git add sheet/channel-download.js download.js tests/channel-download.test.js
git commit -m "fix(proxy): dùng chung normalizeProxy, proxy hỏng dừng thay vì tải bằng IP thật"
```

---

### Task 3: Đọc thêm cột C khi lấy danh sách URL

**Files:**
- Modify: `sheet/sheets-service.js:167-178` (`parseUrlRows`), `sheet/sheets-service.js:215-218` (`readChannelUrls`)
- Modify: `tests/sheets-service.test.js:102-119`

**Interfaces:**
- Consumes: không có.
- Produces: `parseUrlRows(values) -> [{ rowIndex, url, status, uploadStatus }]`. `readChannelUrls` đọc dải `A:C`. Task 6 và 7 dùng `uploadStatus`.

- [ ] **Step 1: Sửa test hiện có cho thất bại**

Trong `tests/sheets-service.test.js`, thay hai test ở dòng 102-119:

```js
test("parseUrlRows keeps 1-based index, skips blanks and header", () => {
  const rows = [
    ["URL","status","upload"],
    ["https://youtu.be/a","",""],
    ["",""],
    ["https://youtu.be/b","done","✅ lên lịch 10/07 07:00"],
  ];
  const out = parseUrlRows(rows);
  assert.deepEqual(out, [
    { rowIndex: 2, url: "https://youtu.be/a", status: "", uploadStatus: "" },
    { rowIndex: 4, url: "https://youtu.be/b", status: "done", uploadStatus: "✅ lên lịch 10/07 07:00" },
  ]);
});

test("parseUrlRows treats first row as data if it is a URL", () => {
  const out = parseUrlRows([["https://youtu.be/x",""]]);
  assert.deepEqual(out, [{ rowIndex: 1, url: "https://youtu.be/x", status: "", uploadStatus: "" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sheets-service.test.js`
Expected: FAIL — thiếu khoá `uploadStatus` trong object thực tế.

- [ ] **Step 3: Sửa `parseUrlRows`**

`sheet/sheets-service.js`, thay dòng 175:

```js
    out.push({ rowIndex: r + 1, url, status: String(row[1] ?? "").trim() });
```

bằng:

```js
    out.push({
      rowIndex: r + 1,
      url,
      status: String(row[1] ?? "").trim(),
      uploadStatus: String(row[2] ?? "").trim(),
    });
```

- [ ] **Step 4: Mở rộng dải đọc của `readChannelUrls`**

Thay dòng 216:

```js
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:B` });
```

bằng:

```js
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:C` });
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS. `tests/sheet-runner.test.js` vẫn xanh vì `uploadStatus` thiếu sẽ là `undefined`, và Task 4 xử lý `undefined` như chuỗi rỗng.

- [ ] **Step 6: Commit**

```bash
git add sheet/sheets-service.js tests/sheets-service.test.js
git commit -m "feat(sheet): readChannelUrls đọc thêm cột C (trạng thái upload)"
```

---

### Task 4: Bộ quyết định thuần `decideAction`

**Files:**
- Create: `sheet/resume-plan.js`
- Test: `tests/resume-plan.test.js`
- Modify: `docs/superpowers/specs/2026-07-09-retry-resume-design.md` (thêm hành động thứ năm)

**Interfaces:**
- Consumes: không có.
- Produces:
  - `MAX_ATTEMPTS = 3`
  - `ST = { DOWNLOADED, DONE, ERR_DL, ERR_RENDER, SKIP }` — hằng số chuỗi trạng thái.
  - `decideAction({ statusB, statusC, attempts, uploadAttempts, overlayExists, outputExists }) -> "full" | "render-only" | "upload-only" | "upload-exhausted" | "skip"`
  - `skipText(msg) -> string` — sinh `bỏ qua: <msg> (đã thử 3 lần)`.

**Ghi chú lệch spec:** spec liệt kê bốn hành động. Khi viết plan lộ ra rằng "upload đã thử đủ 3 lần" chỉ phát hiện được ở **lượt sau** (vì kết quả upload nằm ở cột C do `upload-queue` ghi), trong khi "render đã thử đủ 3 lần" phát hiện được ngay tại chỗ lỗi. Nên cần hành động thứ năm `upload-exhausted` để runner biết phải ghi `bỏ qua:` vào cột C. Cập nhật spec trong cùng commit này.

- [ ] **Step 1: Write the failing test**

Tạo `tests/resume-plan.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAction, skipText, MAX_ATTEMPTS, ST } from "../sheet/resume-plan.js";

const base = {
  statusB: "", statusC: "", attempts: 0, uploadAttempts: 0,
  overlayExists: false, outputExists: false,
};
const d = (o) => decideAction({ ...base, ...o });

test("ô B rỗng -> tải và render từ đầu", () => {
  assert.equal(d({}), "full");
  // Kể cả khi biến đếm cũ còn sót: ô rỗng nghĩa là người dùng muốn làm lại.
  assert.equal(d({ attempts: 99 }), "full");
});

test("đã tải mà file còn -> chỉ render", () => {
  assert.equal(d({ statusB: ST.DOWNLOADED, overlayExists: true }), "render-only");
  assert.equal(d({ statusB: `${ST.ERR_RENDER} ffmpeg chết`, overlayExists: true }), "render-only");
});

test("đã tải mà file bị xoá tay -> tải lại từ đầu", () => {
  assert.equal(d({ statusB: ST.DOWNLOADED, overlayExists: false }), "full");
  assert.equal(d({ statusB: `${ST.ERR_RENDER} x`, overlayExists: false }), "full");
});

test("lỗi tải -> tải lại từ đầu", () => {
  assert.equal(d({ statusB: `${ST.ERR_DL} mạng hỏng` }), "full");
});

test("render xong, upload lỗi, file output còn -> chỉ upload", () => {
  assert.equal(
    d({ statusB: ST.DONE, statusC: "❌ lỗi: GPM mất kết nối", outputExists: true }),
    "upload-only",
  );
});

test("render xong, upload lỗi, hết lượt thử -> báo hết lượt", () => {
  assert.equal(
    d({ statusB: ST.DONE, statusC: "❌ lỗi: x", outputExists: true, uploadAttempts: MAX_ATTEMPTS }),
    "upload-exhausted",
  );
});

test("render xong, upload lỗi, file output đã bị xoá -> bỏ qua", () => {
  assert.equal(d({ statusB: ST.DONE, statusC: "❌ lỗi: x", outputExists: false }), "skip");
});

test("render xong và upload xong -> bỏ qua", () => {
  assert.equal(d({ statusB: ST.DONE, statusC: "✅ lên lịch 10/07 07:00", outputExists: true }), "skip");
});

test("đã đánh dấu bỏ qua -> không đụng tới nữa", () => {
  assert.equal(d({ statusB: skipText("hỏng"), overlayExists: true }), "skip");
});

test("chạm trần số lần thử -> bỏ qua", () => {
  assert.equal(d({ statusB: ST.DOWNLOADED, overlayExists: true, attempts: MAX_ATTEMPTS }), "skip");
});

test("trạng thái lạ -> bỏ qua, không đoán", () => {
  assert.equal(d({ statusB: "đang chạy dở???" }), "skip");
});

test("uploadStatus undefined được coi như rỗng", () => {
  assert.equal(decideAction({ ...base, statusB: ST.DONE, statusC: undefined }), "skip");
});

test("skipText có đủ lý do và số lần", () => {
  assert.equal(skipText("ffmpeg chết"), "bỏ qua: ffmpeg chết (đã thử 3 lần)");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/resume-plan.test.js`
Expected: FAIL — `Cannot find module '.../sheet/resume-plan.js'`

- [ ] **Step 3: Write implementation**

Tạo `sheet/resume-plan.js`:

```js
// Bộ quyết định thuần: đọc hai cột trạng thái của Sheet + sự tồn tại của file
// trên đĩa, trả về việc cần làm. Không I/O, không phụ thuộc — test được độc lập.

export const MAX_ATTEMPTS = 3;

export const ST = {
  DOWNLOADED: "đã tải",
  DONE: "done",
  ERR_DL: "lỗi tải:",
  ERR_RENDER: "lỗi render:",
  SKIP: "bỏ qua:",
};

export function skipText(msg) {
  return `${ST.SKIP} ${msg} (đã thử ${MAX_ATTEMPTS} lần)`;
}

export function decideAction({
  statusB = "", statusC = "",
  attempts = 0, uploadAttempts = 0,
  overlayExists = false, outputExists = false,
} = {}) {
  const b = String(statusB ?? "").trim();
  const c = String(statusC ?? "").trim();

  if (b.startsWith(ST.SKIP)) return "skip";

  if (b === ST.DONE) {
    if (!c.startsWith("❌")) return "skip";       // chưa upload, đang upload, hoặc đã xong
    if (!outputExists) return "skip";             // mất file render -> không upload lại được
    return uploadAttempts >= MAX_ATTEMPTS ? "upload-exhausted" : "upload-only";
  }

  // Ô rỗng = người dùng muốn làm lại từ đầu; biến đếm cũ không còn ý nghĩa.
  if (b === "") return "full";

  if (attempts >= MAX_ATTEMPTS) return "skip";

  if (b === ST.DOWNLOADED || b.startsWith(ST.ERR_RENDER)) {
    return overlayExists ? "render-only" : "full";
  }
  if (b.startsWith(ST.ERR_DL)) return "full";

  return "skip"; // trạng thái lạ: không đoán
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/resume-plan.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Cập nhật spec cho khớp**

Trong `docs/superpowers/specs/2026-07-09-retry-resume-design.md`, phần "Bộ quyết định", đổi chữ ký thành:

```
decideAction({ statusB, statusC, attempts, uploadAttempts, overlayExists, outputExists })
  -> "full" | "render-only" | "upload-only" | "upload-exhausted" | "skip"
```

và sửa luật 2 thành:

```
2. `statusB === "done"`:
   - `statusC` không bắt đầu bằng `❌` → `skip`
   - `outputExists` sai → `skip`
   - `uploadAttempts >= 3` → `upload-exhausted` (runner ghi `bỏ qua:` vào cột C)
   - ngược lại → `upload-only`
```

Thêm một đoạn giải thích ngay dưới bảng luật:

```
Cần `upload-exhausted` vì kết quả upload do `upload-queue` ghi vào cột C ở lượt
trước, nên "hết lượt thử upload" chỉ phát hiện được ở lượt sau. Ngược lại, "hết
lượt thử render" phát hiện ngay tại chỗ lỗi nên ghi `bỏ qua:` được luôn.
```

- [ ] **Step 6: Commit**

```bash
git add sheet/resume-plan.js tests/resume-plan.test.js docs/superpowers/specs/2026-07-09-retry-resume-design.md
git commit -m "feat(resume): hàm thuần decideAction chọn full/render-only/upload-only/skip"
```

---

### Task 5: Kho trạng thái resume

**Files:**
- Create: `sheet/resume-state.js`
- Test: `tests/resume-state.test.js`

**Interfaces:**
- Consumes: `videoIdOf` từ `sheet/youtube-api.js:32`.
- Produces:
  - `keyOf(url) -> string` — `videoIdOf(url)`, rơi về chính chuỗi url nếu không parse được (URL giả trong test, hoặc link lạ).
  - `loadResume(path) -> object`, `saveResume(path, state) -> void`
  - `getEntry(state, sheetName, url) -> entry | null`
  - `setEntry(state, sheetName, url, patch) -> entry` — merge, tự khởi tạo `attempts: 0, uploadAttempts: 0`.
  - `clearEntry(state, sheetName, url) -> void` — xoá entry, xoá luôn kênh nếu rỗng.

- [ ] **Step 1: Write the failing test**

Tạo `tests/resume-state.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { keyOf, loadResume, saveResume, getEntry, setEntry, clearEntry } from "../sheet/resume-state.js";

test("keyOf dùng videoId, rơi về url khi không parse được", () => {
  assert.equal(keyOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(keyOf("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(keyOf("u1"), "u1");
});

test("setEntry khởi tạo biến đếm rồi merge patch", () => {
  const s = {};
  const e = setEntry(s, "Kênh A", "u1", { stage: "downloaded", filePath: "/ov/a.mp4" });
  assert.deepEqual(e, { attempts: 0, uploadAttempts: 0, stage: "downloaded", filePath: "/ov/a.mp4" });
  setEntry(s, "Kênh A", "u1", { attempts: 1 });
  assert.equal(getEntry(s, "Kênh A", "u1").attempts, 1);
  assert.equal(getEntry(s, "Kênh A", "u1").filePath, "/ov/a.mp4");
});

test("getEntry trả null khi chưa có", () => {
  assert.equal(getEntry({}, "Kênh A", "u1"), null);
  assert.equal(getEntry({ "Kênh A": {} }, "Kênh A", "u1"), null);
});

test("clearEntry xoá entry và xoá luôn kênh khi rỗng", () => {
  const s = {};
  setEntry(s, "Kênh A", "u1", { stage: "rendered" });
  setEntry(s, "Kênh A", "u2", { stage: "rendered" });
  clearEntry(s, "Kênh A", "u1");
  assert.equal(getEntry(s, "Kênh A", "u1"), null);
  assert.ok(s["Kênh A"]);
  clearEntry(s, "Kênh A", "u2");
  assert.equal(s["Kênh A"], undefined);
});

test("clearEntry trên kênh không tồn tại không ném lỗi", () => {
  const s = {};
  clearEntry(s, "Không có", "u1");
  assert.deepEqual(s, {});
});

test("loadResume trả {} khi file thiếu hoặc hỏng; saveResume ghi rồi đọc lại được", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-"));
  const p = path.join(dir, "nested", "resume-state.json");
  assert.deepEqual(loadResume(p), {});

  const s = {};
  setEntry(s, "Kênh A", "https://youtu.be/dQw4w9WgXcQ", { stage: "downloaded" });
  saveResume(p, s);
  assert.deepEqual(loadResume(p), s);

  fs.writeFileSync(p, "{ không phải json", "utf-8");
  assert.deepEqual(loadResume(p), {});

  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/resume-state.test.js`
Expected: FAIL — `Cannot find module '.../sheet/resume-state.js'`

- [ ] **Step 3: Write implementation**

Tạo `sheet/resume-state.js`:

```js
// Trạng thái resume, tách khỏi runner-state.json (vốn chỉ giữ quota theo ngày).
// Khoá theo sheetName -> videoId. Giữ đường dẫn file và số lần thử — thứ Sheet
// không tiện chứa. Mất file này chỉ làm hệ thống chậm lại, không làm nó sai.

import fs from "fs";
import path from "path";
import { videoIdOf } from "./youtube-api.js";

export function keyOf(url) {
  return videoIdOf(url) || String(url ?? "").trim();
}

export function loadResume(statePath) {
  try {
    if (!fs.existsSync(statePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveResume(statePath, state) {
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export function getEntry(state, sheetName, url) {
  return state?.[sheetName]?.[keyOf(url)] ?? null;
}

export function setEntry(state, sheetName, url, patch) {
  const k = keyOf(url);
  if (!state[sheetName]) state[sheetName] = {};
  const prev = state[sheetName][k] || { attempts: 0, uploadAttempts: 0 };
  state[sheetName][k] = { ...prev, ...patch };
  return state[sheetName][k];
}

export function clearEntry(state, sheetName, url) {
  const k = keyOf(url);
  const ch = state[sheetName];
  if (!ch) return;
  delete ch[k];
  if (!Object.keys(ch).length) delete state[sheetName];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/resume-state.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add sheet/resume-state.js tests/resume-state.test.js
git commit -m "feat(resume): kho trạng thái resume-state.json khoá theo videoId"
```

---

### Task 6: `runChannel` biết resume và đếm số lần thử

**Files:**
- Modify: `sheet/sheet-runner.js:19-113` (toàn bộ `createSheetRunner` phần `runChannel`)
- Test: `tests/sheet-runner.test.js` (bổ sung)

**Interfaces:**
- Consumes: `decideAction`, `ST`, `skipText`, `MAX_ATTEMPTS` (Task 4); `getEntry`, `setEntry`, `clearEntry` (Task 5); `normalizeProxy` (Task 1); `uploadStatus` trên mỗi item (Task 3).
- Produces: `createSheetRunner(deps)` nhận thêm hai dep bắt buộc:
  - `resumeStore: { load(): object, save(state): void }` — đồng bộ.
  - `fileExists: (path: string) => boolean`
  Task 7 dùng tiếp cùng chữ ký. Task 8 nối dây thật.

**Chỉ làm trong task này:** `full`, `render-only`, đếm `attempts`, dọn file, proxy. `upload-only` để Task 7.

- [ ] **Step 1: Write the failing tests**

Thêm vào cuối `tests/sheet-runner.test.js`, và mở rộng `makeDeps` để có hai dep mới. Sửa `makeDeps` (dòng 39-70) thành:

```js
function makeDeps(overrides = {}) {
  const calls = { status: [], rendered: [], errors: [], downloaded: [], unlinked: [] };
  let savedState = {};
  let savedResume = {};
  const files = new Set(overrides.existingFiles || []);
  const deps = {
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2 },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 2, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [
        { rowIndex: 2, url: "u1", status: "", uploadStatus: "" },
        { rowIndex: 3, url: "u2", status: "", uploadStatus: "" },
        { rowIndex: 4, url: "u3", status: "", uploadStatus: "" },
        { rowIndex: 5, url: "u4", status: "done", uploadStatus: "" },
      ],
      setUrlStatus: async (sheetName, rowIndex, status) => calls.status.push({ sheetName, rowIndex, status }),
      setUploadStatus: async (sheetName, rowIndex, status) => calls.status.push({ sheetName, rowIndex, status, col: "C" }),
    },
    downloader: async (url) => { calls.downloaded.push(url); return { filePath: `/ov/${url}.mp4`, title: url }; },
    renderer: async ({ outputPath }) => { calls.rendered.push(outputPath); return { outputPath }; },
    listBackgrounds: () => ["bg1.mp4"],
    ensureDirs: () => ({ backgroundsDir: "/bg", overlaysDir: "/ov", outputDir: "/out" }),
    stateStore: { load: () => savedState, save: (s) => { savedState = JSON.parse(JSON.stringify(s)); } },
    resumeStore: { load: () => savedResume, save: (s) => { savedResume = JSON.parse(JSON.stringify(s)); } },
    fileExists: (p) => files.has(p),
    emit: (e) => { if (e.type === "error") calls.errors.push(e); },
    now: () => new Date(2026, 6, 7, 10, 0),
    pLimitFn: () => (fn) => fn(),
    rand: () => 0,
    unlink: (p) => { calls.unlinked.push(p); },
    detectChroma: async () => "000000",
    sleep: async () => {},
  };
  delete overrides.existingFiles;
  return { deps: { ...deps, ...overrides }, calls, getState: () => savedState, getResume: () => savedResume, files };
}
```

Rồi thêm các test mới:

```js
import { ST, skipText, MAX_ATTEMPTS } from "../sheet/resume-plan.js";

test("render-only: bỏ qua bước tải khi file overlay còn trên đĩa", async () => {
  const { deps, calls } = makeDeps({
    existingFiles: ["/ov/u1.mp4"],
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: ST.DOWNLOADED, uploadStatus: "" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 0, stage: "downloaded", filePath: "/ov/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(calls.downloaded, []);
  assert.deepEqual(calls.rendered, ["/out/u1.mp4"]);
});

test("đã tải nhưng file bị xoá tay -> tải lại từ đầu", async () => {
  const { deps, calls } = makeDeps({
    existingFiles: [],
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: ST.DOWNLOADED, uploadStatus: "" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 0, stage: "downloaded", filePath: "/ov/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(calls.downloaded, ["u1"]);
});

test("render lỗi: giữ file overlay, ghi 'lỗi render:', tăng attempts", async () => {
  const { deps, calls, getResume } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async (s, r, status) => calls.status.push({ rowIndex: r, status }),
      setUploadStatus: async () => {},
    },
    renderer: async () => { throw new Error("ffmpeg chết"); },
  });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(calls.unlinked, []); // KHÔNG xoá file khi render lỗi
  const last = calls.status.at(-1);
  assert.ok(last.status.startsWith(ST.ERR_RENDER), last.status);
  assert.equal(getResume()["Kênh A"].u1.attempts, 1);
});

test("render xong: xoá overlay, ghi done, lưu outputPath", async () => {
  const { deps, calls, getResume } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
  });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(calls.unlinked, ["/ov/u1.mp4"]);
  const e = getResume()["Kênh A"].u1;
  assert.equal(e.stage, "rendered");
  assert.equal(e.outputPath, "/out/u1.mp4");
});

test("chạm trần 3 lần -> ghi 'bỏ qua:' vào cột B", async () => {
  const { deps, calls } = makeDeps({
    existingFiles: ["/ov/u1.mp4"],
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: `${ST.ERR_RENDER} x`, uploadStatus: "" }],
      setUrlStatus: async (s, r, status) => calls.status.push({ rowIndex: r, status }),
      setUploadStatus: async () => {},
    },
    renderer: async () => { throw new Error("ffmpeg chết"); },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: MAX_ATTEMPTS - 1, uploadAttempts: 0, stage: "downloaded", filePath: "/ov/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.equal(calls.status.at(-1).status, skipText("ffmpeg chết"));
});

test("proxy hỏng -> bỏ qua cả kênh, không tải gì", async () => {
  const { deps, calls } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "rác" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
  });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(calls.downloaded, []);
  assert.match(calls.errors.at(-1).message, /Proxy không hợp lệ/);
});

test("proxy thiếu scheme được chuẩn hoá rồi truyền xuống downloader", async () => {
  const seen = [];
  const { deps } = makeDeps({
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "1.2.3.4:8080" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "", uploadStatus: "" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
    downloader: async (url, dir, opts) => { seen.push(opts.proxy); return { filePath: `/ov/${url}.mp4`, title: url }; },
  });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(seen, ["http://1.2.3.4:8080"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/sheet-runner.test.js`
Expected: FAIL — `resumeStore` chưa được `createSheetRunner` dùng; `calls.downloaded` vẫn có `"u1"` trong test render-only.

- [ ] **Step 3: Viết lại `runChannel`**

Trong `sheet/sheet-runner.js`, thêm import ở đầu file:

```js
import path from "path";
import { todayStr, computeRemaining, recordRendered } from "./runner-state.js";
import { decideAction, skipText, ST, MAX_ATTEMPTS } from "./resume-plan.js";
import { getEntry, setEntry } from "./resume-state.js";
import { normalizeProxy } from "./proxy.js";
```

Thêm `resumeStore, fileExists` vào danh sách destructure của `deps` (dòng 20-24).

Thay toàn bộ thân `runChannel` (dòng 28-113) bằng:

```js
  // yt-dlp lưu thumb cùng basename với video: <title>.mp4 -> <title>.jpg
  function thumbOf(videoPath) {
    return String(videoPath).replace(/\.[^.]+$/, ".jpg");
  }

  // Tăng biến đếm rồi lưu. load/save đồng bộ, KHÔNG await ở giữa (xem
  // sheet-runner.js:82-83 cũ): pLimit chạy song song, await ở giữa sẽ mất lượt tăng.
  function bumpAttempts(sheetName, url, field) {
    const rs = resumeStore.load();
    const prev = getEntry(rs, sheetName, url);
    const next = setEntry(rs, sheetName, url, { [field]: (prev?.[field] ?? 0) + 1 });
    resumeStore.save(rs);
    return next[field];
  }

  function patchEntry(sheetName, url, patch) {
    const rs = resumeStore.load();
    setEntry(rs, sheetName, url, patch);
    resumeStore.save(rs);
  }

  async function runChannel(ch, today) {
    if (!ch.enabled) return;
    try {
      // Proxy hỏng -> dừng kênh. Tải thẳng bằng IP thật là kết cục tệ nhất cho
      // người dùng đang dựa vào proxy để né bot-check.
      let proxy = "";
      if (String(ch.proxy ?? "").trim()) {
        try {
          proxy = normalizeProxy(ch.proxy);
        } catch (err) {
          emit({ type: "error", channel: ch.sheetName, message: String(err?.message || err) });
          return;
        }
      }

      const channelRoot = path.join(config.channelsRoot, ch.sheetName);
      const { backgroundsDir, overlaysDir, outputDir } = ensureDirs(channelRoot);
      const backgrounds = listBackgrounds(backgroundsDir);
      if (!backgrounds.length) {
        emit({ type: "error", channel: ch.sheetName, message: "Chưa có background (.mp4) trong folder kênh." });
        return;
      }

      const state = stateStore.load();
      const remaining = computeRemaining(state[ch.sheetName], ch.videosPerDay, today);

      const urls = await sheetsApi.readChannelUrls(ch.sheetName);
      const rs = resumeStore.load();
      const planned = urls.map((item) => {
        const entry = getEntry(rs, ch.sheetName, item.url);
        const action = decideAction({
          statusB: item.status,
          statusC: item.uploadStatus,
          attempts: entry?.attempts ?? 0,
          uploadAttempts: entry?.uploadAttempts ?? 0,
          overlayExists: !!(entry?.filePath && fileExists(entry.filePath)),
          outputExists: !!(entry?.outputPath && fileExists(entry.outputPath)),
        });
        return { item, entry, action };
      });

      // Việc render bị quota cắt; việc upload-only thì không (Task 7 dùng tiếp).
      const renderWork = planned
        .filter((p) => p.action === "full" || p.action === "render-only")
        .slice(0, remaining);

      if (!renderWork.length) {
        emit({ type: "channel-status", channel: ch.sheetName, status: remaining <= 0 ? "đủ hôm nay" : "hết URL mới" });
        return;
      }

      const limit = pLimitFn(config.renderConcurrency || 2);
      const downloadLimit = pLimitFn(1);
      let firstDownload = true;

      await Promise.all(renderWork.map(({ item, entry, action }) => limit(async () => {
        let stage = "download";
        let dl = null;
        try {
          if (action === "render-only") {
            dl = { filePath: entry.filePath, title: entry.title };
          } else {
            emit({ type: "channel-status", channel: ch.sheetName, status: "đang tải", url: item.url });
            dl = await downloadLimit(async () => {
              if (!firstDownload) {
                const delay = pickDownloadDelay(config, rand);
                if (delay > 0 && sleep) {
                  emit({ type: "channel-status", channel: ch.sheetName, status: `chờ ${Math.round(delay / 1000)}s trước khi tải`, url: item.url });
                  await sleep(delay);
                }
              }
              firstDownload = false;
              return downloader(item.url, overlaysDir, { proxy });
            });
            patchEntry(ch.sheetName, item.url, { stage: "downloaded", filePath: dl.filePath, title: dl.title });
            await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, ST.DOWNLOADED);
          }

          stage = "render";
          const bg = pickRandomBackground(backgrounds, rand);
          const outputPath = path.join(outputDir, `${dl.title}.mp4`);
          const cfg = { ...ch.cfg };
          if (config.videoSpeed != null) cfg.videoSpeed = config.videoSpeed;
          if (ch.renderMode === "chromaKeyAuto" && ch.chromaPalette?.length) {
            try {
              cfg.chromaColor = await detectChroma(dl.filePath, ch.chromaPalette);
            } catch (err) {
              emit({ type: "log", message: `Dò màu thất bại (${ch.sheetName}), dùng chromaColor cố định: ${String(err?.message || err).slice(0, 120)}` });
            }
          }
          emit({ type: "channel-status", channel: ch.sheetName, status: "đang render", url: item.url });
          await renderer({
            overlayFile: dl.filePath, backgroundFile: path.join(backgroundsDir, bg),
            outputPath, renderMode: ch.renderMode, cfg,
            useGPU: config.useGPU, gpuVideoCodec: config.gpuVideoCodec,
          });

          await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, ST.DONE);
          const s = stateStore.load();
          recordRendered(s, ch.sheetName, today);
          stateStore.save(s);
          patchEntry(ch.sheetName, item.url, { stage: "rendered", outputPath, title: dl.title });
          try { unlink(dl.filePath); } catch { /* ignore */ }
          emit({ type: "video-rendered", channel: ch.sheetName, outputPath, sourceUrl: item.url, title: dl.title });
          enqueueUpload(ch, item, { outputPath, title: dl.title }, overlaysDir);
        } catch (e) {
          const msg = String(e?.message || e).slice(0, 200);
          const attempts = bumpAttempts(ch.sheetName, item.url, "attempts");
          if (stage === "download") {
            // Tải hỏng: bỏ mọi dấu vết file (mp4 lẫn thumb) để lượt sau tải lại sạch.
            // (.part dở dang do yt-dlp tự nối tiếp, không đụng tới.)
            const rs2 = resumeStore.load();
            const e2 = getEntry(rs2, ch.sheetName, item.url);
            if (e2?.filePath) {
              for (const p of [e2.filePath, thumbOf(e2.filePath)]) {
                try { unlink(p); } catch { /* ignore */ }
              }
            }
            setEntry(rs2, ch.sheetName, item.url, { stage: null, filePath: null });
            resumeStore.save(rs2);
          }
          const prefix = stage === "download" ? ST.ERR_DL : ST.ERR_RENDER;
          const text = attempts >= MAX_ATTEMPTS ? skipText(msg) : `${prefix} ${msg}`;
          try { await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, text); } catch { /* ignore */ }
          emit({ type: "error", channel: ch.sheetName, url: item.url, message: msg });
        }
      })));
    } catch (e) {
      emit({ type: "error", channel: ch.sheetName, message: String(e?.message || e).slice(0, 200) });
    }
  }
```

Và tách khối enqueue upload cũ (dòng 90-103) thành hàm riêng, đặt ngay trên `runChannel`:

```js
  function enqueueUpload(ch, item, info, overlaysDir) {
    if (!(uploadQueue && config.gpmEnabled && ch.gpmProfileId && ch.postTimes)) return;
    uploadQueue.enqueue({
      sheetName: ch.sheetName,
      gpmHost: config.gpmHost,
      profileId: ch.gpmProfileId,
      videoPath: info.outputPath,
      overlaysDir,
      title: info.title,
      postTimes: ch.postTimes,
      locale: config.gpmLocale,
      rowIndex: item.rowIndex,
      sourceUrl: item.url,
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/sheet-runner.test.js`
Expected: PASS. Test cũ `second download is delayed but first is immediate` vẫn xanh (hai URL status rỗng → hai job `full`).

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: PASS toàn bộ.

- [ ] **Step 6: Commit**

```bash
git add sheet/sheet-runner.js tests/sheet-runner.test.js
git commit -m "feat(resume): runChannel bỏ qua bước tải khi overlay còn, đếm số lần thử"
```

---

### Task 7: Chạy lại riêng bước upload

**Files:**
- Modify: `sheet/sheet-runner.js` (khối `planned` trong `runChannel`)
- Test: `tests/sheet-runner.test.js` (bổ sung)

**Interfaces:**
- Consumes: hành động `upload-only` và `upload-exhausted` từ Task 4; `enqueueUpload` từ Task 6.
- Produces: `sheetsApi.setUploadStatus(sheetName, rowIndex, status)` trở thành dep bắt buộc. Task 8 nối dây.

- [ ] **Step 1: Write the failing tests**

Thêm vào `tests/sheet-runner.test.js`:

```js
test("upload-only: không tải, không render, chỉ đưa vào hàng đợi upload", async () => {
  const enqueued = [];
  const { deps, calls } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2, gpmEnabled: true, gpmHost: "h", gpmLocale: "vi" },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "", gpmProfileId: "p1", postTimes: "07:00" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: GPM chết" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
    uploadQueue: { enqueue: (j) => enqueued.push(j) },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 0, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(calls.downloaded, []);
  assert.deepEqual(calls.rendered, []);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].videoPath, "/out/u1.mp4");
  assert.equal(enqueued[0].sourceUrl, "u1");
});

test("upload-only tăng uploadAttempts mỗi lượt", async () => {
  const { deps, getResume } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2, gpmEnabled: true, gpmHost: "h", gpmLocale: "vi" },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "", gpmProfileId: "p1", postTimes: "07:00" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: x" }],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
    uploadQueue: { enqueue: () => {} },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 1, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.equal(getResume()["Kênh A"].u1.uploadAttempts, 2);
});

test("upload-only không bị quota cắt kể cả khi đã đủ video hôm nay", async () => {
  const enqueued = [];
  const { deps, calls } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2, gpmEnabled: true, gpmHost: "h", gpmLocale: "vi" },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 1, renderMode: "topTransparent", cfg: {}, proxy: "", gpmProfileId: "p1", postTimes: "07:00" },
      ],
      readChannelUrls: async () => [
        { rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: x" },
        { rowIndex: 3, url: "u2", status: "", uploadStatus: "" },
      ],
      setUrlStatus: async () => {},
      setUploadStatus: async () => {},
    },
    uploadQueue: { enqueue: (j) => enqueued.push(j) },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: 0, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });
  // Đã render 1 video hôm nay -> remaining = 0.
  deps.stateStore.save({ "Kênh A": { lastRunDate: "2026-07-07", countToday: 1 } });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(calls.rendered, []);            // quota chặn u2
  assert.equal(enqueued.length, 1);                // nhưng u1 vẫn được upload lại
  assert.equal(enqueued[0].sourceUrl, "u1");
});

test("upload hết lượt thử -> ghi 'bỏ qua:' vào cột C, không enqueue", async () => {
  const enqueued = [];
  const upStatus = [];
  const { deps } = makeDeps({
    existingFiles: ["/out/u1.mp4"],
    config: { spreadsheetId: "SID", channelsRoot: "/root", statePath: "/root/state.json", renderConcurrency: 2, gpmEnabled: true, gpmHost: "h", gpmLocale: "vi" },
    sheetsApi: {
      readConfigSheet: async () => [
        { sheetName: "Kênh A", enabled: true, videosPerDay: 5, renderMode: "topTransparent", cfg: {}, proxy: "", gpmProfileId: "p1", postTimes: "07:00" },
      ],
      readChannelUrls: async () => [{ rowIndex: 2, url: "u1", status: "done", uploadStatus: "❌ lỗi: GPM chết" }],
      setUrlStatus: async () => {},
      setUploadStatus: async (s, r, status) => upStatus.push(status),
    },
    uploadQueue: { enqueue: (j) => enqueued.push(j) },
  });
  deps.resumeStore.save({ "Kênh A": { u1: { attempts: 0, uploadAttempts: MAX_ATTEMPTS, stage: "rendered", outputPath: "/out/u1.mp4", title: "u1" } } });
  await createSheetRunner(deps).runNow();
  assert.deepEqual(enqueued, []);
  assert.equal(upStatus.at(-1), skipText("GPM chết"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/sheet-runner.test.js`
Expected: FAIL — `enqueued.length` là 0; `upStatus` rỗng. Task 6 chưa xử lý `upload-only`.

- [ ] **Step 3: Xử lý `upload-only` và `upload-exhausted`**

Trong `runChannel`, ngay sau khi tính `planned` và **trước** khi tính `renderWork`, chèn:

```js
      // upload-only KHÔNG tốn quota render: chạy hết, không qua slice(0, remaining).
      for (const { item, entry, action } of planned) {
        if (action === "upload-exhausted") {
          const reason = String(item.uploadStatus).replace(/^❌\s*lỗi:\s*/i, "").trim();
          try { await sheetsApi.setUploadStatus(ch.sheetName, item.rowIndex, skipText(reason)); } catch { /* ignore */ }
          emit({ type: "log", message: `[${ch.sheetName}] bỏ upload sau ${MAX_ATTEMPTS} lần: ${entry?.title ?? item.url}` });
          continue;
        }
        if (action !== "upload-only") continue;
        bumpAttempts(ch.sheetName, item.url, "uploadAttempts");
        emit({ type: "channel-status", channel: ch.sheetName, status: "thử lại upload", url: item.url });
        enqueueUpload(ch, item, { outputPath: entry.outputPath, title: entry.title }, overlaysDir);
      }
```

Sửa điều kiện thoát sớm bên dưới để không cắt mất lượt upload vừa xếp hàng:

```js
      if (!renderWork.length) {
        emit({ type: "channel-status", channel: ch.sheetName, status: remaining <= 0 ? "đủ hôm nay" : "hết URL mới" });
        return;
      }
```

giữ nguyên — vì khối upload đã chạy trước `return`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/sheet-runner.test.js`
Expected: PASS, gồm cả 4 test mới.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: PASS toàn bộ.

- [ ] **Step 6: Commit**

```bash
git add sheet/sheet-runner.js tests/sheet-runner.test.js
git commit -m "feat(resume): chạy lại riêng bước upload, không tốn quota render"
```

---

### Task 8: Nối dây trong Electron và kiểm tra thật

**Files:**
- Modify: `electron-main.js:13` (import), `electron-main.js:1352` (đường dẫn state), `electron-main.js:1399-1424` (deps)

**Interfaces:**
- Consumes: `loadResume`, `saveResume` (Task 5); dep `resumeStore`, `fileExists`, `sheetsApi.setUploadStatus` (Task 6, 7).
- Produces: không có — đây là lớp nối dây cuối.

- [ ] **Step 1: Thêm import**

Trong `electron-main.js`, thêm cạnh các import của `sheet/`:

```js
import { loadResume, saveResume } from "./sheet/resume-state.js";
```

- [ ] **Step 2: Thêm đường dẫn file trạng thái**

Ngay dưới `electron-main.js:1352`:

```js
  const statePath = path.join(s.channelsRoot, "runner-state.json");
  const resumePath = path.join(s.channelsRoot, "resume-state.json");
```

- [ ] **Step 3: Thêm ba dep**

Trong khối `sheetsApi` (`electron-main.js:1399-1403`), thêm dòng cuối:

```js
    sheetsApi: {
      readConfigSheet: () => readConfigSheet(sheets, s.spreadsheetId),
      readChannelUrls: (name) => readChannelUrls(sheets, s.spreadsheetId, name),
      setUrlStatus: (name, row, status) => setUrlStatus(sheets, s.spreadsheetId, name, row, status),
      setUploadStatus: (name, row, status) => setUploadStatus(sheets, s.spreadsheetId, name, row, status),
    },
```

Cạnh `stateStore` (`electron-main.js:1418`), thêm:

```js
    stateStore: { load: () => loadState(statePath), save: (st) => saveState(statePath, st) },
    resumeStore: { load: () => loadResume(resumePath), save: (st) => saveResume(resumePath, st) },
    fileExists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
```

- [ ] **Step 4: Kiểm tra cú pháp và test**

Run: `node --check electron-main.js && npm test`
Expected: không lỗi cú pháp; toàn bộ test PASS.

**Lưu ý:** `node --check renderer.js` luôn báo lỗi giả trên repo này — đừng chạy nó và đừng "sửa" theo lỗi đó.

- [ ] **Step 5: Kiểm tra thật trên một kênh**

Việc này cần Sheet thật và GPM. Làm theo thứ tự:

1. Mở app: `npm start`. Chọn một kênh test có 1 URL, cột B và C để trống.
2. Bấm "Chạy ngay". Đợi tới khi cột B hiện `đã tải` rồi **tắt app giữa lúc render**.
3. Mở lại app, bấm "Chạy ngay". Quan sát log: **không được có dòng "đang tải"**, phải nhảy thẳng vào "đang render". Đây là bằng chứng resume hoạt động.
4. Kiểm tra `<channelsRoot>/resume-state.json` có entry với `stage`, `filePath`, `title`.
5. Sau khi render xong, kiểm tra file overlay `.mp4` đã bị xoá còn `.jpg` vẫn còn.
6. Điền proxy sai (ví dụ `rác`) vào cột "Proxy tải" của kênh, bấm "Chạy ngay". Log phải hiện `Proxy không hợp lệ: rác` và **không tải video nào**.
7. Điền proxy `1.2.3.4:8080` (thiếu scheme). Log không được báo lỗi định dạng nữa; nếu proxy đó không sống thì lỗi sẽ là lỗi mạng, khác hẳn.

- [ ] **Step 6: Commit**

```bash
git add electron-main.js
git commit -m "feat(resume): nối dây resumeStore và setUploadStatus vào Electron"
```

---

## Ghi chú cho người triển khai

**Bẫy dễ sập nhất:** đừng bọc `unlink(dl.filePath)` trong `finally`. Nó sẽ xoá file ngay cả khi render lỗi, và giết luôn toàn bộ mục đích của plan này. File overlay chỉ bị xoá ở hai chỗ: nhánh render thành công, và nhánh tải thất bại.

**Bẫy thứ hai:** giữa `resumeStore.load()` và `resumeStore.save()` không được có `await`. Các task `pLimit` chạy song song; một `await` xen vào giữa sẽ làm mất lượt tăng `attempts`.

**Bẫy thứ ba:** `videoIdOf` trả `null` với URL không phải YouTube (kể cả `"u1"` trong test). `keyOf` rơi về chính chuỗi url — đừng "sửa" bằng cách ném lỗi.

**Vì sao không cần sửa `noOverwrites` hay `pickDownloadedFile`:** sau plan này, `downloadOne` chỉ được gọi khi hành động là `full`, và `full` chỉ xảy ra khi overlay không tồn tại. Bẫy "yt-dlp bỏ qua vì file đã có → dir-diff không thấy mp4 mới → ném `Không tìm thấy file tải về`" mất đường xảy ra.
