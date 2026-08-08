# Composer Engine (Giai đoạn 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm `renderMode: "composer"` dựng filter graph ffmpeg từ một stack lớp tự do trong file preset JSON, không sửa một dòng nào của 5 mode cũ.

**Architecture:** `sheet/layer-compiler.js` là hàm thuần biến preset thành `{ extraInputs, filterGraph }` — đúng giao diện `renderOne` đang trông đợi. `sheet/preset-store.js` đọc/ghi preset từ một thư mục truyền vào (không gọi API Electron, để test được). `render-core.js` và `render.js` mỗi bên thêm **một nhánh** `composer`. Bằng chứng compiler đúng: 5 preset dựng sẵn phải sinh ra graph tương đương graph của 5 builder cũ, so bằng đồ thị.

**Tech Stack:** Node.js ESM (`"type": "module"`), `node:test` + `node:assert/strict`, fluent-ffmpeg. Không thêm dependency mới.

**Spec:** `docs/superpowers/specs/2026-08-08-trinh-thiet-ke-bo-cuc-design.md`

## Global Constraints

- **Không sửa 5 builder cũ.** `topTransparent`, `chromaKey`, `crop`, `keepColor`, `blurFrame` trong `sheet/render-core.js` và 5 bản copy trong `render.js` phải nguyên vẹn từng ký tự. Chúng là mốc đối chiếu của test.
- **Khung cố định 1280×720** (`BASE_W`, `BASE_H`).
- **`evenDown`**: làm tròn **xuống** số chẵn — yuv420p yêu cầu kích thước chẵn.
- **Không ném lỗi làm chết mẻ render.** Luồng Sheet chạy không người trông; asset hỏng thì cảnh báo qua `onProgress` và bỏ lớp đó.
- **Chỉ số input cố định**: `[0]` = file nền, `[1]` = video gốc, `[2]` trở đi = input phụ do compiler cấp.
- **Nhãn hợp đồng**: graph phải kết thúc bằng `[combined_video]` và có `[overlay_audio]`.
- **Toạ độ luôn là biểu thức**, không tính sẵn thành số.
- **Mọi bước chồng đều có `:shortest=1`.**
- Chạy test: `npm test` (= `node --test 'tests/*.test.js'`). Chạy một file: `node --test tests/layer-compiler.test.js`.
- Comment và thông báo lỗi viết **tiếng Việt**, theo đúng văn phong `sheet/render-core.js`: giải thích *tại sao*, không diễn giải lại code.
- Commit message tiếng Việt theo mẫu sẵn có: `feat(composer): …`, `test(composer): …`.

---

### Task 1: Công cụ so sánh filter graph theo đồ thị

Đây là **dụng cụ đo**, phải làm trước và phải có test riêng: một normalizer sai sẽ làm mọi test hồi quy phía sau trở nên vô nghĩa mà vẫn xanh.

Vấn đề nó giải: thứ tự câu lệnh trong `filter_complex` **không** ảnh hưởng ffmpeg (nhãn ràng buộc chúng), và tên nhãn trung gian là tuỳ ý. So chuỗi thô sẽ báo "khác nhau" ở những graph thực chất giống nhau.

**Files:**
- Create: `tests/graph-dag.js` (helper, **không** đuôi `.test.js` nên `npm test` không chạy nó như test)
- Test: `tests/graph-dag.test.js`

**Interfaces:**
- Consumes: không
- Produces:
  - `parseStatement(text: string) -> { ins: string[], filter: string, outs: string[] }`
  - `flattenStatements(filterConfig: string[]) -> string[]`
  - `splitChain(filterText: string) -> string[]` — chẻ `"a=1,b=2"` thành `["a=1","b=2"]`, **không** cắt ở dấu phẩy nằm trong ngoặc hay trong dấu nháy
  - `canonicalGraph(filterConfig: string[], opts?: { ignoreShortest?: boolean, ignoreOverlayCoords?: boolean }) -> string`

**Vì sao phải có `splitChain`:** chỗ đặt nhãn trung gian là tuỳ ý người viết. Code cũ chẻ
chuỗi của mode `crop` thành **3 câu lệnh** (`[cropped]`, `[filtered]`, `[overlay_video]`),
compiler gộp thành **1 câu lệnh**. Hai thứ đó hoàn toàn tương đương với ffmpeg. Nếu
normalizer so theo câu lệnh thì nó báo "khác nhau" — nên trước khi chuẩn hoá phải **bung
mỗi chuỗi thành từng filter một**, mỗi filter một câu lệnh riêng. Dạng chuẩn khi đó không
còn phụ thuộc chỗ đặt nhãn.

Cạm bẫy: `blend=all_expr='max(A,B)'` **có dấu phẩy bên trong**. Chẻ bừa theo dấu phẩy là
làm hỏng filter đó.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/graph-dag.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatement, flattenStatements, splitChain, canonicalGraph } from "./graph-dag.js";

test("parseStatement bóc nhãn vào, chuỗi filter, nhãn ra", () => {
  assert.deepEqual(parseStatement("[0:v][top]overlay=0:0[out]"), {
    ins: ["0:v", "top"],
    filter: "overlay=0:0",
    outs: ["out"],
  });
  assert.deepEqual(parseStatement("[1:a]volume=1.0[overlay_audio]"), {
    ins: ["1:a"],
    filter: "volume=1.0",
    outs: ["overlay_audio"],
  });
});

test("parseStatement không nhầm dấu ngoặc bên trong biểu thức filter", () => {
  const s = parseStatement("[m0][m1]blend=all_expr='max(A,B)'[cm]");
  assert.deepEqual(s.ins, ["m0", "m1"]);
  assert.equal(s.filter, "blend=all_expr='max(A,B)'");
  assert.deepEqual(s.outs, ["cm"]);
});

test("flattenStatements tách những phần bị join bằng dấu ;", () => {
  const out = flattenStatements(["[0:v]scale=1:1[a];[a]negate[b]", "[b]copy[c]"]);
  assert.deepEqual(out, ["[0:v]scale=1:1[a]", "[a]negate[b]", "[b]copy[c]"]);
});

test("splitChain chẻ chuỗi filter theo dấu phẩy", () => {
  assert.deepEqual(splitChain("scale=1280:720,negate,copy"), ["scale=1280:720", "negate", "copy"]);
});

test("splitChain KHÔNG cắt ở dấu phẩy trong ngoặc hoặc trong nháy", () => {
  assert.deepEqual(splitChain("blend=all_expr='max(A,B)'"), ["blend=all_expr='max(A,B)'"]);
  assert.deepEqual(splitChain("blend=all_expr='max(A,B)',negate"), [
    "blend=all_expr='max(A,B)'", "negate",
  ]);
  assert.deepEqual(splitChain("overlay=(W-w)/2:(H-h)/2,copy"), ["overlay=(W-w)/2:(H-h)/2", "copy"]);
});

test("canonicalGraph coi một chuỗi gộp và chuỗi bị chẻ ra là BẰNG NHAU", () => {
  // Đây là khác biệt cốt lõi giữa code cũ và compiler: chỗ đặt nhãn trung gian là tuỳ ý.
  const gop = ["[1:v]scale=1280:720,crop=1280:220:0:490,negate[combined_video]"];
  const che = [
    "[1:v]scale=1280:720,crop=1280:220:0:490[cropped]",
    "[cropped]negate[combined_video]",
  ];
  const che3 = [
    "[1:v]scale=1280:720[a]",
    "[a]crop=1280:220:0:490[b]",
    "[b]negate[combined_video]",
  ];
  assert.equal(canonicalGraph(gop), canonicalGraph(che));
  assert.equal(canonicalGraph(gop), canonicalGraph(che3));
});

test("canonicalGraph vẫn phát hiện khác nhau khi THỨ TỰ filter trong chuỗi đổi", () => {
  const a = ["[1:v]scale=1280:720,negate[combined_video]"];
  const b = ["[1:v]negate,scale=1280:720[combined_video]"];
  assert.notEqual(canonicalGraph(a), canonicalGraph(b));
});

test("canonicalGraph bung chuỗi mà vẫn giữ đúng câu lệnh nhiều nhãn ra", () => {
  const a = ["[1:v]scale=1280:720,split=2[m][d]", "[m][d]alphamerge[combined_video]"];
  const b = ["[1:v]scale=1280:720[s]", "[s]split=2[m][d]", "[m][d]alphamerge[combined_video]"];
  assert.equal(canonicalGraph(a), canonicalGraph(b));
});

test("canonicalGraph coi hai graph chỉ khác TÊN NHÃN là bằng nhau", () => {
  const a = ["[0:v]scale=1280:720[bg]", "[1:v]negate[fg]", "[bg][fg]overlay=0:0[combined_video]"];
  const b = ["[0:v]scale=1280:720[xxx]", "[1:v]negate[yyy]", "[xxx][yyy]overlay=0:0[combined_video]"];
  assert.equal(canonicalGraph(a), canonicalGraph(b));
});

test("canonicalGraph coi hai graph chỉ khác THỨ TỰ câu lệnh là bằng nhau", () => {
  const a = ["[0:v]scale=1280:720[bg]", "[1:v]negate[fg]", "[bg][fg]overlay=0:0[combined_video]"];
  const b = ["[1:v]negate[fg]", "[bg][fg]overlay=0:0[combined_video]", "[0:v]scale=1280:720[bg]"];
  assert.equal(canonicalGraph(a), canonicalGraph(b));
});

test("canonicalGraph phát hiện khác THAM SỐ filter", () => {
  const a = ["[0:v]scale=1280:720[bg]", "[bg]copy[combined_video]"];
  const b = ["[0:v]scale=1280:360[bg]", "[bg]copy[combined_video]"];
  assert.notEqual(canonicalGraph(a), canonicalGraph(b));
});

test("canonicalGraph phát hiện khác TOPOLOGY", () => {
  // Cùng bộ filter, nhưng b đảo thứ tự chồng lớp.
  const a = ["[0:v]copy[x]", "[1:v]copy[y]", "[x][y]overlay=0:0[combined_video]"];
  const b = ["[0:v]copy[x]", "[1:v]copy[y]", "[y][x]overlay=0:0[combined_video]"];
  assert.notEqual(canonicalGraph(a), canonicalGraph(b));
});

test("canonicalGraph giữ nguyên nhãn hợp đồng, không đổi tên chúng", () => {
  const g = canonicalGraph(["[0:v]copy[combined_video]", "[1:a]volume=1.0[overlay_audio]"]);
  assert.match(g, /\[combined_video\]/);
  assert.match(g, /\[overlay_audio\]/);
});

test("ignoreShortest bỏ qua đúng :shortest=1, không đụng tham số khác", () => {
  const a = ["[0:v][1:v]overlay=0:H-h:shortest=1[combined_video]"];
  const b = ["[0:v][1:v]overlay=0:H-h[combined_video]"];
  assert.notEqual(canonicalGraph(a), canonicalGraph(b));
  assert.equal(canonicalGraph(a, { ignoreShortest: true }), canonicalGraph(b, { ignoreShortest: true }));
});

test("ignoreOverlayCoords bỏ qua x:y nhưng GIỮ các tham số sau", () => {
  const a = ["[0:v][1:v]overlay=(W-w)/2:(H-h)/2:shortest=1[combined_video]"];
  const b = ["[0:v][1:v]overlay=340:80:shortest=1[combined_video]"];
  assert.equal(
    canonicalGraph(a, { ignoreOverlayCoords: true }),
    canonicalGraph(b, { ignoreOverlayCoords: true })
  );
  // shortest vẫn phải được so
  const c = ["[0:v][1:v]overlay=340:80[combined_video]"];
  assert.notEqual(
    canonicalGraph(a, { ignoreOverlayCoords: true }),
    canonicalGraph(c, { ignoreOverlayCoords: true })
  );
});

test("canonicalGraph ném lỗi khi graph có nhãn treo", () => {
  assert.throws(() => canonicalGraph(["[khong_ton_tai]copy[combined_video]"]), /nhãn treo/);
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `node --test tests/graph-dag.test.js`
Expected: FAIL — `Cannot find module './graph-dag.js'`

- [ ] **Step 3: Viết `tests/graph-dag.js`**

```js
// So sánh hai filter_complex theo ĐỒ THỊ, không theo chuỗi. Thứ tự câu lệnh trong
// filter_complex không ảnh hưởng ffmpeg — nhãn mới là thứ ràng buộc chúng — và tên nhãn
// trung gian là tuỳ ý. So chuỗi thô sẽ báo "khác nhau" ở graph thực chất giống nhau.

// Nhãn là hợp đồng với renderOne: không được đổi tên khi chuẩn hoá.
const CONTRACT_LABELS = new Set(["combined_video", "overlay_audio"]);

// Nhãn nguồn của ffmpeg: [0:v], [1:a]... Chúng cố định, giữ nguyên.
const SOURCE_LABEL = /^\d+:[va]$/;

// Bóc "[a][b]filter=x[c]" thành 3 phần. Không dùng regex cho phần giữa: chuỗi filter có
// thể chứa dấu ngoặc (blend=all_expr='max(A,B)'), regex tham lam sẽ bóc sai.
export function parseStatement(text) {
  const s = String(text);
  let i = 0;
  const ins = [];
  while (s[i] === "[") {
    const end = s.indexOf("]", i);
    if (end < 0) break;
    ins.push(s.slice(i + 1, end));
    i = end + 1;
  }
  let j = s.length;
  const outs = [];
  while (s[j - 1] === "]") {
    const start = s.lastIndexOf("[", j - 1);
    if (start < 0) break;
    outs.unshift(s.slice(start + 1, j - 1));
    j = start;
  }
  return { ins, filter: s.slice(i, j), outs };
}

// Code hiện tại join một số câu lệnh bằng ";" thành một phần tử mảng, số khác để riêng.
export function flattenStatements(filterConfig) {
  return (filterConfig || [])
    .flatMap((part) => String(part).split(";"))
    .map((s) => s.trim())
    .filter(Boolean);
}

// Chẻ "a=1,b=2" thành ["a=1","b=2"]. Không cắt ở dấu phẩy nằm trong ngoặc hoặc trong dấu
// nháy: blend=all_expr='max(A,B)' có dấu phẩy bên trong, chẻ bừa là làm hỏng filter.
export function splitChain(filterText) {
  const s = String(filterText || "");
  const out = [];
  let buf = "";
  let depth = 0;
  let quote = null;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      buf += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; buf += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { out.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out.map((f) => f.trim()).filter(Boolean);
}

// Bung mỗi câu lệnh thành từng filter một, mỗi filter một câu lệnh riêng.
// Lý do: chỗ đặt nhãn trung gian là TUỲ Ý người viết — code cũ chẻ chuỗi của mode crop
// thành 3 câu lệnh, compiler gộp thành 1, hai thứ tương đương hoàn toàn với ffmpeg. Bung
// ra thì dạng chuẩn không còn phụ thuộc chỗ đặt nhãn.
// Filter đầu giữ nhãn vào gốc, filter cuối giữ nhãn ra gốc, ở giữa cấp nhãn tạm.
function expandChains(statements) {
  const out = [];
  let seq = 0;
  for (const s of statements) {
    const filters = splitChain(s.filter);
    if (filters.length <= 1) { out.push(s); continue; }
    let prev = null;
    filters.forEach((f, i) => {
      const first = i === 0;
      const last = i === filters.length - 1;
      const ins = first ? s.ins : [prev];
      const outs = last ? s.outs : [`__ex${seq++}`];
      out.push({ ins, filter: f, outs });
      prev = outs[0];
    });
  }
  return out;
}

// overlay=X:Y[:opt...] -> overlay=@:@[:opt...]. Tách theo ":" chứ không regex: biểu thức
// toạ độ như (W-w)/2 không chứa ":" nên tách an toàn, và các tham số sau phải giữ lại để
// vẫn so được shortest=1.
function blurOverlayCoords(filter) {
  if (!filter.startsWith("overlay=")) return filter;
  const parts = filter.slice("overlay=".length).split(":");
  const rest = parts.length > 2 ? ":" + parts.slice(2).join(":") : "";
  return `overlay=@:@${rest}`;
}

export function canonicalGraph(filterConfig, opts = {}) {
  // Bung chuỗi TRƯỚC khi áp tuỳ chọn: sau khi bung thì mỗi câu lệnh đúng một filter, nên
  // blurOverlayCoords chỉ nhìn vào filter overlay thật, không nhìn vào cả chuỗi.
  const stmts = expandChains(
    flattenStatements(filterConfig).map((t) => parseStatement(t))
  ).map((s) => {
    let filter = s.filter;
    if (opts.ignoreOverlayCoords) filter = blurOverlayCoords(filter);
    if (opts.ignoreShortest) filter = filter.replace(/:shortest=1/g, "");
    return { ...s, filter };
  });

  const map = new Map();
  const known = new Set();
  for (const s of stmts) {
    for (const l of s.ins) {
      if (SOURCE_LABEL.test(l)) { map.set(l, l); known.add(l); }
    }
  }

  let n = 0;
  const pending = [...stmts];
  const ordered = [];
  while (pending.length) {
    const ready = pending.filter((s) => s.ins.every((l) => known.has(l)));
    if (!ready.length) {
      throw new Error(`graph có nhãn treo hoặc vòng lặp: ${pending.map((s) => s.filter).join(" | ")}`);
    }
    // Sắp thứ tự trong cùng một lớp topo bằng chuỗi filter + tên nhãn ĐÃ chuẩn hoá của
    // input — hai thứ đó so được giữa hai graph khác tên nhãn, nên số L{n} gán ra giống
    // nhau cho hai graph đẳng cấu.
    ready.sort((a, b) => {
      const ka = `${a.filter}\u0000${a.ins.map((l) => map.get(l)).join(",")}`;
      const kb = `${b.filter}\u0000${b.ins.map((l) => map.get(l)).join(",")}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    for (const s of ready) {
      for (const l of s.outs) {
        map.set(l, CONTRACT_LABELS.has(l) ? l : `L${n++}`);
        known.add(l);
      }
      ordered.push(s);
      pending.splice(pending.indexOf(s), 1);
    }
  }

  // Sắp cuối cùng theo chuỗi: tên nhãn đã mã hoá vị trí topo nên sắp xếp là an toàn và
  // xoá hẳn ảnh hưởng của thứ tự câu lệnh gốc.
  return ordered
    .map((s) => {
      const ins = s.ins.map((l) => `[${map.get(l)}]`).join("");
      const outs = s.outs.map((l) => `[${map.get(l)}]`).join("");
      return `${ins}${s.filter}${outs}`;
    })
    .sort()
    .join("\n");
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `node --test tests/graph-dag.test.js`
Expected: PASS — 16 test

- [ ] **Step 5: Commit**

```bash
git add tests/graph-dag.js tests/graph-dag.test.js
git commit -m "test(composer): công cụ so sánh filter graph theo đồ thị"
```

---

### Task 2: Hình học — anchor và fit

**Files:**
- Create: `sheet/layer-compiler.js`
- Test: `tests/layer-compiler.test.js`

**Interfaces:**
- Consumes: không
- Produces:
  - `BASE_W = 1280`, `BASE_H = 720`
  - `ANCHORS: Record<string, { x: string, y: string }>` — 9 khoá
  - `anchorExpr(anchor: string, dx?: number, dy?: number) -> { x: string, y: string }`
  - `scaleFilter(geometry: object) -> { filter: string, w: number|null, h: number|null }` — `filter` là đoạn `scale=…`; `w`/`h` là kích thước sau scale, `null` khi không biết trước (ví dụ `w: -2`)

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/layer-compiler.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorExpr, scaleFilter, ANCHORS } from "../sheet/layer-compiler.js";

test("ANCHORS có đúng 9 điểm neo", () => {
  assert.equal(Object.keys(ANCHORS).length, 9);
});

test("anchorExpr sinh đúng biểu thức của 9 điểm neo", () => {
  assert.deepEqual(anchorExpr("top-left"), { x: "0", y: "0" });
  assert.deepEqual(anchorExpr("top-center"), { x: "(W-w)/2", y: "0" });
  assert.deepEqual(anchorExpr("top-right"), { x: "W-w", y: "0" });
  assert.deepEqual(anchorExpr("middle-left"), { x: "0", y: "(H-h)/2" });
  assert.deepEqual(anchorExpr("center"), { x: "(W-w)/2", y: "(H-h)/2" });
  assert.deepEqual(anchorExpr("middle-right"), { x: "W-w", y: "(H-h)/2" });
  assert.deepEqual(anchorExpr("bottom-left"), { x: "0", y: "H-h" });
  assert.deepEqual(anchorExpr("bottom-center"), { x: "(W-w)/2", y: "H-h" });
  assert.deepEqual(anchorExpr("bottom-right"), { x: "W-w", y: "H-h" });
});

test("anchorExpr với dx/dy bằng 0 KHÔNG sinh +0", () => {
  // Quan trọng: chuỗi phải khớp đúng chuỗi của code cũ, "0+0" là khác.
  assert.deepEqual(anchorExpr("bottom-left", 0, 0), { x: "0", y: "H-h" });
});

test("anchorExpr cộng dx/dy dương và trừ khi âm", () => {
  assert.deepEqual(anchorExpr("bottom-left", 40, -220), { x: "0+40", y: "H-h-220" });
  assert.deepEqual(anchorExpr("center", -10, 5), { x: "(W-w)/2-10", y: "(H-h)/2+5" });
});

test("anchorExpr với anchor lạ rơi về center", () => {
  assert.deepEqual(anchorExpr("khong-ton-tai"), { x: "(W-w)/2", y: "(H-h)/2" });
});

test("scaleFilter fit=full phủ kín khung", () => {
  assert.deepEqual(scaleFilter({ fit: "full" }), { filter: "scale=1280:720", w: 1280, h: 720 });
});

test("scaleFilter fit=scale làm tròn xuống số chẵn", () => {
  // 1280*0.85 = 1088 (chẵn), 720*0.85 = 612 (chẵn)
  assert.deepEqual(scaleFilter({ fit: "scale", value: 0.85 }), {
    filter: "scale=1088:612", w: 1088, h: 612,
  });
  // 1280*0.9 = 1152, 720*0.9 = 648
  assert.deepEqual(scaleFilter({ fit: "scale", value: 0.9 }), {
    filter: "scale=1152:648", w: 1152, h: 648,
  });
});

test("scaleFilter fit=scale ngoài khoảng (0,1] rơi về 0.85", () => {
  assert.deepEqual(scaleFilter({ fit: "scale", value: 0 }).filter, "scale=1088:612");
  assert.deepEqual(scaleFilter({ fit: "scale", value: 5 }).filter, "scale=1088:612");
});

test("scaleFilter fit=box dùng đúng w/h đã cho", () => {
  assert.deepEqual(scaleFilter({ fit: "box", w: 980, h: 560 }), {
    filter: "scale=980:560", w: 980, h: 560,
  });
});

test("scaleFilter fit=box với w=-2 giữ tỉ lệ gốc, chiều rộng không biết trước", () => {
  assert.deepEqual(scaleFilter({ fit: "box", w: -2, h: 380 }), {
    filter: "scale=-2:380", w: null, h: 380,
  });
});

test("scaleFilter fit lạ rơi về full", () => {
  assert.equal(scaleFilter({ fit: "khong-ton-tai" }).filter, "scale=1280:720");
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `node --test tests/layer-compiler.test.js`
Expected: FAIL — `Cannot find module '../sheet/layer-compiler.js'`

- [ ] **Step 3: Viết phần hình học của `sheet/layer-compiler.js`**

```js
// Dựng filter_complex từ một stack lớp (preset) thay vì fix cứng từng bố cục.
// Hàm thuần, không đụng ffmpeg và không đọc file — test được độc lập.
//
// Chỉ số input là hợp đồng với renderOne: [0] = file nền, [1] = video gốc, [2] trở đi là
// input phụ do compiler cấp, đúng thứ tự extraInputs trả về.

export const BASE_W = 1280;
export const BASE_H = 720;

const DEFAULT_SCALE = 0.85;

// yuv420p yêu cầu chiều rộng/cao chẵn nên phải làm tròn XUỐNG số chẵn.
// Trùng với evenDown trong render-core.js là CỐ Ý, không phải quên DRY: render-core.js
// import file này (nhánh composer của renderOne), nên import ngược lại là vòng tròn.
// Chiều phụ thuộc phải một hướng — layer-compiler không được biết gì về render-core.
function evenDown(value) {
  const n = Math.round(value);
  return n % 2 === 0 ? n : n - 1;
}

// Toạ độ là BIỂU THỨC của ffmpeg, không phải số tính sẵn. Chỉ biểu thức mới giữ được
// hành vi "dán sát đáy bất kể lớp cao bao nhiêu", và lớp scale=-2:h có chiều rộng không
// biết trước nên bắt buộc phải là biểu thức.
export const ANCHORS = {
  "top-left": { x: "0", y: "0" },
  "top-center": { x: "(W-w)/2", y: "0" },
  "top-right": { x: "W-w", y: "0" },
  "middle-left": { x: "0", y: "(H-h)/2" },
  center: { x: "(W-w)/2", y: "(H-h)/2" },
  "middle-right": { x: "W-w", y: "(H-h)/2" },
  "bottom-left": { x: "0", y: "H-h" },
  "bottom-center": { x: "(W-w)/2", y: "H-h" },
  "bottom-right": { x: "W-w", y: "H-h" },
};

export function anchorExpr(anchor, dx = 0, dy = 0) {
  const a = ANCHORS[anchor] || ANCHORS.center;
  // dx/dy bằng 0 thì KHÔNG thêm "+0": chuỗi phải khớp đúng chuỗi của code cũ.
  const add = (base, d) => {
    const n = Number(d) || 0;
    if (n === 0) return base;
    return n > 0 ? `${base}+${n}` : `${base}-${Math.abs(n)}`;
  };
  return { x: add(a.x, dx), y: add(a.y, dy) };
}

// Trả về cả kích thước sau scale, không chỉ chuỗi filter: lớp solid và waveform cần biết
// kích thước để sinh nguồn, và w=null báo "không biết trước" (scale=-2).
export function scaleFilter(geometry = {}) {
  const g = geometry || {};
  if (g.fit === "scale") {
    const raw = Number(g.value);
    const ratio = raw > 0 && raw <= 1 ? raw : DEFAULT_SCALE;
    const w = Math.max(2, evenDown(BASE_W * ratio));
    const h = Math.max(2, evenDown(BASE_H * ratio));
    return { filter: `scale=${w}:${h}`, w, h };
  }
  if (g.fit === "box") {
    const w = Number(g.w);
    const h = Math.max(2, evenDown(Number(g.h) || BASE_H));
    // -2 = giữ tỉ lệ gốc, ffmpeg tự suy chiều rộng và làm tròn về số chẵn.
    if (w === -2) return { filter: `scale=-2:${h}`, w: null, h };
    const ew = Math.max(2, evenDown(w || BASE_W));
    return { filter: `scale=${ew}:${h}`, w: ew, h };
  }
  return { filter: `scale=${BASE_W}:${BASE_H}`, w: BASE_W, h: BASE_H };
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `node --test tests/layer-compiler.test.js`
Expected: PASS — 11 test

- [ ] **Step 5: Commit**

```bash
git add sheet/layer-compiler.js tests/layer-compiler.test.js
git commit -m "feat(composer): hình học lớp — 9 điểm neo và 3 kiểu fit"
```

---

### Task 3: 7 treatment và luật chèn `format=yuva420p`

Luật `format=yuva420p` là chỗ dễ sai nhất của cả compiler. Code hiện tại có **3 thứ tự khác nhau** và cả 3 đều đúng theo cách riêng của nó — treatment nào *cần* alpha thì format phải nằm **trước**, treatment nào *sinh ra* alpha thì format nằm **sau**.

**Files:**
- Modify: `sheet/layer-compiler.js`
- Test: `tests/layer-compiler.test.js`

**Interfaces:**
- Consumes: `BASE_W`, `BASE_H` từ Task 2
- Produces:
  - `TREATMENT_KINDS: string[]` — 7 tên
  - `buildLayerChain(layer, inLabel, nextLabel) -> { statements: string[], outLabel: string, w: number|null, h: number|null }`
    - `inLabel`: nhãn nguồn của lớp, ví dụ `"1:v"` hoặc `"2:v"` (không có ngoặc)
    - `nextLabel(): string` — hàm sinh tên nhãn trung gian mới, do compiler cấp

- [ ] **Step 1: Viết test thất bại**

Thêm vào `tests/layer-compiler.test.js`:

```js
import { buildLayerChain, TREATMENT_KINDS } from "../sheet/layer-compiler.js";

// Bộ sinh nhãn xác định để test so chuỗi được.
function labeller() {
  let n = 0;
  return () => `t${n++}`;
}

test("TREATMENT_KINDS có đúng 7 xử lý", () => {
  assert.deepEqual([...TREATMENT_KINDS].sort(), [
    "blur", "chromakey", "cropStrip", "grayContrast", "keepColors", "lumakey", "opacity",
  ]);
});

test("lớp không treatment chỉ có scale", () => {
  const r = buildLayerChain(
    { geometry: { fit: "full" }, treatments: [] }, "1:v", labeller()
  );
  assert.deepEqual(r.statements, ["[1:v]scale=1280:720[t0]"]);
  assert.equal(r.outLabel, "t0");
});

test("chromakey: format=yuva420p nằm SAU colorkey (khớp chromaKey cũ)", () => {
  const r = buildLayerChain(
    {
      geometry: { fit: "full" },
      treatments: [{ kind: "chromakey", color: "D4F9D7", similarity: 0.3, blend: 0.1 }],
    },
    "1:v", labeller()
  );
  assert.deepEqual(r.statements, [
    "[1:v]scale=1280:720,colorkey=0xD4F9D7:0.3:0.1,format=yuva420p[t0]",
  ]);
});

test("opacity: format=yuva420p nằm TRƯỚC colorchannelmixer (khớp crop cũ)", () => {
  const r = buildLayerChain(
    {
      geometry: { fit: "full" },
      treatments: [
        { kind: "cropStrip", height: 220, yOffset: 490 },
        // Chuỗi, không phải số: code cũ ghi cứng "-1.0"/"3.0", mà String(Number(-1.0))
        // cho ra "-1". Preset giữ dạng chuỗi để sinh ra đúng chuỗi cũ.
        { kind: "grayContrast", brightness: "-1.0", contrast: "3.0", gamma: "1.2", saturation: "0" },
        { kind: "opacity", value: 0.8 },
      ],
    },
    "1:v", labeller()
  );
  assert.deepEqual(r.statements, [
    "[1:v]scale=1280:720,crop=1280:220:0:490,eq=brightness=-1.0:contrast=3.0:gamma=1.2:saturation=0," +
      "format=yuva420p,colorchannelmixer=aa=0.8[t0]",
  ]);
  // cropStrip đổi chiều cao của lớp — compiler phải biết để tính neo.
  assert.equal(r.h, 220);
  assert.equal(r.w, 1280);
});

test("lumakey rồi opacity: format chèn ĐÚNG MỘT LẦN, trước lumakey (khớp blurFrame cũ)", () => {
  const r = buildLayerChain(
    {
      geometry: { fit: "full" },
      treatments: [
        { kind: "lumakey", threshold: 0.15, tolerance: 0.1, softness: 0.1 },
        { kind: "opacity", value: 0.15 },
      ],
    },
    "3:v", labeller()
  );
  assert.deepEqual(r.statements, [
    "[3:v]scale=1280:720,format=yuva420p,lumakey=threshold=0.15:tolerance=0.1:softness=0.1," +
      "colorchannelmixer=aa=0.15[t0]",
  ]);
});

test("blend=screen: opacity KHÔNG sinh colorchannelmixer, chuỗi kết bằng format=yuv420p", () => {
  const r = buildLayerChain(
    {
      geometry: { fit: "full" },
      treatments: [{ kind: "opacity", value: 0.15 }],
      blend: "screen",
    },
    "3:v", labeller()
  );
  assert.deepEqual(r.statements, ["[3:v]scale=1280:720,format=yuv420p[t0]"]);
});

test("blur không cần alpha nên không chèn format (khớp blurFrame nền cũ)", () => {
  const r = buildLayerChain(
    { geometry: { fit: "full" }, treatments: [{ kind: "blur", sigma: 20 }] },
    "0:v", labeller()
  );
  assert.deepEqual(r.statements, ["[0:v]scale=1280:720,gblur=sigma=20[t0]"]);
});

test("keepColors sinh nhiều câu lệnh, đúng chuỗi của keepColor cũ", () => {
  const r = buildLayerChain(
    {
      geometry: { fit: "full" },
      treatments: [{ kind: "keepColors", colors: ["FBFF02", "FF0000"], similarity: 0.2 }],
    },
    "1:v", labeller()
  );
  assert.deepEqual(r.statements, [
    "[1:v]scale=1280:720,split=3[t1][t2][t3]",
    "[t2]colorkey=0xFBFF02:0.2:0.1,alphaextract,negate[t4]",
    "[t3]colorkey=0xFF0000:0.2:0.1,alphaextract,negate[t5]",
    "[t4][t5]blend=all_expr='max(A,B)'[t6]",
    "[t1][t6]alphamerge[t7]",
  ]);
  assert.equal(r.outLabel, "t7");
});

test("keepColors một màu không có bước blend", () => {
  const r = buildLayerChain(
    {
      geometry: { fit: "full" },
      treatments: [{ kind: "keepColors", colors: ["FBFF02"], similarity: 0.2 }],
    },
    "1:v", labeller()
  );
  assert.deepEqual(r.statements, [
    "[1:v]scale=1280:720,split=2[t1][t2]",
    "[t2]colorkey=0xFBFF02:0.2:0.1,alphaextract,negate[t3]",
    "[t1][t3]alphamerge[t4]",
  ]);
});

test("keepColors bỏ dấu # trong mã màu", () => {
  const r = buildLayerChain(
    {
      geometry: { fit: "full" },
      treatments: [{ kind: "keepColors", colors: ["#FBFF02"], similarity: 0.2 }],
    },
    "1:v", labeller()
  );
  assert.match(r.statements[1], /colorkey=0xFBFF02:/);
});

test("treatment kind lạ bị bỏ qua, không ném lỗi", () => {
  const r = buildLayerChain(
    { geometry: { fit: "full" }, treatments: [{ kind: "khong-ton-tai" }] },
    "1:v", labeller()
  );
  assert.deepEqual(r.statements, ["[1:v]scale=1280:720[t0]"]);
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `node --test tests/layer-compiler.test.js`
Expected: FAIL — `buildLayerChain is not a function`

- [ ] **Step 3: Viết phần treatment vào `sheet/layer-compiler.js`**

Thêm vào cuối file:

```js
export const TREATMENT_KINDS = [
  "cropStrip", "grayContrast", "blur", "chromakey", "lumakey", "opacity", "keepColors",
];

// Chuỗi đi qua NGUYÊN VẸN, chỉ số mới bị Number() nắn lại.
// Lý do: String(Number("-1.0")) cho ra "-1", mà code cũ ghi cứng "brightness=-1.0" trong
// chuỗi template. Preset giữ được "-1.0" dạng chuỗi thì sinh ra đúng chuỗi cũ; còn người
// dùng gõ số trong UI thì ra "3" — ffmpeg nhận cả hai như nhau.
const numStr = (v, fallback) => {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return String(v === undefined || v === null || v === "" ? fallback : Number(v));
};

// Nối chuỗi filter của MỘT lớp: scale trước, rồi các treatment theo thứ tự khai báo.
// keepColors là treatment duy nhất phải cắt chuỗi ra thành nhiều câu lệnh (nó cần split
// nguồn thành nhiều nhánh), nên hàm này trả về mảng câu lệnh chứ không phải một chuỗi.
export function buildLayerChain(layer, inLabel, nextLabel) {
  const l = layer || {};
  const geo = scaleFilter(l.geometry);
  let w = geo.w;
  let h = geo.h;
  const screen = l.blend === "screen";

  const statements = [];
  let chain = geo.filter;
  let source = inLabel;
  let hasAlpha = false;

  // Đóng chuỗi đang dựng thành một câu lệnh có nhãn ra, để bước sau nối tiếp từ nhãn đó.
  const flush = () => {
    const out = nextLabel();
    statements.push(`[${source}]${chain}[${out}]`);
    source = out;
    chain = "";
    return out;
  };
  const push = (frag) => { chain = chain ? `${chain},${frag}` : frag; };
  // Treatment cần alpha (lumakey, opacity) thì format phải nằm TRƯỚC nó; treatment sinh
  // ra alpha (chromakey, keepColors) thì nằm SAU. Chèn đúng một lần.
  const ensureAlpha = () => {
    if (hasAlpha) return;
    push("format=yuva420p");
    hasAlpha = true;
  };

  for (const t of l.treatments || []) {
    switch (t?.kind) {
      case "cropStrip": {
        const ch = Math.max(2, Number(t.height) || BASE_H);
        push(`crop=${BASE_W}:${ch}:0:${numStr(t.yOffset, 0)}`);
        w = BASE_W;
        h = ch;
        break;
      }
      case "grayContrast":
        push(
          `eq=brightness=${numStr(t.brightness, 0)}:contrast=${numStr(t.contrast, 1)}` +
            `:gamma=${numStr(t.gamma, 1)}:saturation=${numStr(t.saturation, 1)}`
        );
        break;
      case "blur":
        push(`gblur=sigma=${numStr(t.sigma, 20)}`);
        break;
      case "chromakey":
        push(
          `colorkey=0x${String(t.color || "").replace("#", "")}` +
            `:${numStr(t.similarity, 0.3)}:${numStr(t.blend, 0.1)}`
        );
        ensureAlpha();
        break;
      case "lumakey":
        ensureAlpha();
        push(
          `lumakey=threshold=${numStr(t.threshold, 0.15)}` +
            `:tolerance=${numStr(t.tolerance, 0.1)}:softness=${numStr(t.softness, 0.1)}`
        );
        break;
      case "opacity":
        // blend=screen không dùng alpha: giá trị opacity chuyển thành all_opacity của
        // bước chồng (compilePreset đọc trực tiếp từ layer), nên ở đây bỏ qua.
        if (screen) break;
        ensureAlpha();
        push(`colorchannelmixer=aa=${numStr(t.value, 1)}`);
        break;
      case "keepColors": {
        const colors = (t.colors || []).map((c) => String(c).replace("#", "")).filter(Boolean);
        if (!colors.length) break;
        const sim = numStr(t.similarity, 0.1);
        // split=N+1: một nhánh giữ ảnh gốc, N nhánh để dò từng màu.
        const mainLabel = nextLabel();
        const detectLabels = colors.map(() => nextLabel());
        statements.push(
          `[${source}]${chain}${chain ? "," : ""}split=${colors.length + 1}` +
            `[${mainLabel}]${detectLabels.map((d) => `[${d}]`).join("")}`
        );
        chain = "";
        const masks = colors.map((hex, i) => {
          const m = nextLabel();
          statements.push(`[${detectLabels[i]}]colorkey=0x${hex}:${sim}:0.1,alphaextract,negate[${m}]`);
          return m;
        });
        let mask = masks[0];
        for (let i = 1; i < masks.length; i++) {
          const merged = nextLabel();
          statements.push(`[${mask}][${masks[i]}]blend=all_expr='max(A,B)'[${merged}]`);
          mask = merged;
        }
        const merged = nextLabel();
        statements.push(`[${mainLabel}][${mask}]alphamerge[${merged}]`);
        source = merged;
        hasAlpha = true;
        break;
      }
      default:
        // Kind lạ: bỏ qua chứ không ném — preset gõ sai một dòng không đáng làm chết mẻ.
        break;
    }
  }

  // blend=screen cần yuv420p (không alpha) ở cuối chuỗi, đúng cách blurFrame đang làm.
  if (screen && !hasAlpha) push("format=yuv420p");

  const outLabel = chain ? flush() : source;
  return { statements, outLabel, w, h };
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `node --test tests/layer-compiler.test.js`
Expected: PASS — 22 test

- [ ] **Step 5: Commit**

```bash
git add sheet/layer-compiler.js tests/layer-compiler.test.js
git commit -m "feat(composer): 7 treatment và luật chèn format=yuva420p"
```

---

### Task 4: Kiểm tra preset hợp lệ

**Files:**
- Modify: `sheet/layer-compiler.js`
- Test: `tests/layer-compiler.test.js`

**Interfaces:**
- Consumes: `TREATMENT_KINDS`, `ANCHORS` từ Task 2–3
- Produces:
  - `SOURCE_TYPES: string[]` — `["background","overlay","image","video","solid","waveform"]`
  - `validatePreset(preset) -> { ok: boolean, errors: string[] }`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `tests/layer-compiler.test.js`:

```js
import { validatePreset, SOURCE_TYPES } from "../sheet/layer-compiler.js";

const okPreset = {
  version: 1,
  name: "thu",
  layers: [
    { id: "l1", source: { type: "background" }, geometry: { fit: "full" } },
    { id: "l2", source: { type: "overlay" }, geometry: { fit: "full" } },
  ],
};

test("SOURCE_TYPES có đúng 6 loại nguồn", () => {
  assert.deepEqual([...SOURCE_TYPES].sort(), [
    "background", "image", "overlay", "solid", "video", "waveform",
  ]);
});

test("validatePreset nhận preset hợp lệ", () => {
  assert.deepEqual(validatePreset(okPreset), { ok: true, errors: [] });
});

test("validatePreset từ chối khi KHÔNG có lớp overlay", () => {
  const p = { ...okPreset, layers: [okPreset.layers[0]] };
  const r = validatePreset(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join("|"), /đúng một lớp video gốc/);
});

test("validatePreset từ chối khi có 2 lớp overlay", () => {
  const p = { ...okPreset, layers: [...okPreset.layers, { id: "l3", source: { type: "overlay" } }] };
  const r = validatePreset(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join("|"), /đúng một lớp video gốc/);
});

test("validatePreset từ chối preset không có lớp nào", () => {
  const r = validatePreset({ version: 1, name: "x", layers: [] });
  assert.equal(r.ok, false);
});

test("validatePreset từ chối loại nguồn lạ", () => {
  const p = { ...okPreset, layers: [...okPreset.layers, { id: "l3", source: { type: "abc" } }] };
  const r = validatePreset(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join("|"), /loại nguồn không hợp lệ: abc/);
});

test("validatePreset buộc solid và waveform dùng fit=box", () => {
  const bad = {
    ...okPreset,
    layers: [...okPreset.layers, { id: "l3", source: { type: "solid" }, geometry: { fit: "full" } }],
  };
  const r = validatePreset(bad);
  assert.equal(r.ok, false);
  assert.match(r.errors.join("|"), /solid.*fit: "box"/);

  const good = {
    ...okPreset,
    layers: [
      ...okPreset.layers,
      { id: "l3", source: { type: "solid", color: "black" }, geometry: { fit: "box", w: 1280, h: 150 } },
    ],
  };
  assert.equal(validatePreset(good).ok, true);
});

test("validatePreset từ chối waveform khi thiếu lớp overlay để lấy tiếng", () => {
  const p = {
    version: 1, name: "x",
    layers: [{ id: "l1", source: { type: "waveform" }, geometry: { fit: "box", w: 480, h: 120 } }],
  };
  const r = validatePreset(p);
  assert.equal(r.ok, false);
});

test("validatePreset báo id lớp trùng nhau", () => {
  const p = {
    ...okPreset,
    layers: [{ ...okPreset.layers[0], id: "same" }, { ...okPreset.layers[1], id: "same" }],
  };
  const r = validatePreset(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join("|"), /id lớp bị trùng: same/);
});

test("validatePreset gom TẤT CẢ lỗi, không dừng ở lỗi đầu", () => {
  const r = validatePreset({ version: 1, name: "x", layers: [{ id: "a", source: { type: "abc" } }] });
  assert.ok(r.errors.length >= 2, `mong đợi nhiều lỗi, nhận ${r.errors.length}`);
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `node --test tests/layer-compiler.test.js`
Expected: FAIL — `validatePreset is not a function`

- [ ] **Step 3: Viết `validatePreset`**

Thêm vào `sheet/layer-compiler.js`:

```js
export const SOURCE_TYPES = ["background", "overlay", "image", "video", "solid", "waveform"];

// Kích thước của solid và waveform nằm ngay trong tham số sinh nguồn (color=…:s=WxH,
// showwaves=s=WxH) nên không có bước scale nào sau đó — buộc phải là fit=box.
const BOX_ONLY = new Set(["solid", "waveform"]);

// Gom TẤT CẢ lỗi thay vì dừng ở lỗi đầu: người dùng sửa preset một lần là xong, không
// phải sửa-chạy-sửa nhiều vòng.
export function validatePreset(preset) {
  const errors = [];
  const layers = Array.isArray(preset?.layers) ? preset.layers : [];
  if (!layers.length) errors.push("preset phải có ít nhất một lớp");

  const seen = new Set();
  for (const l of layers) {
    const type = l?.source?.type;
    if (!SOURCE_TYPES.includes(type)) errors.push(`loại nguồn không hợp lệ: ${type}`);
    if (BOX_ONLY.has(type) && l?.geometry?.fit !== "box") {
      errors.push(`lớp ${type} buộc dùng fit: "box" vì kích thước nằm trong tham số sinh nguồn`);
    }
    const id = l?.id;
    if (id) {
      if (seen.has(id)) errors.push(`id lớp bị trùng: ${id}`);
      seen.add(id);
    }
  }

  const overlays = layers.filter((l) => l?.source?.type === "overlay").length;
  if (overlays !== 1) {
    errors.push(
      `preset phải có đúng một lớp video gốc (overlay) — nơi lấy tiếng và quyết định độ dài, đang có ${overlays}`
    );
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `node --test tests/layer-compiler.test.js`
Expected: PASS — 32 test

- [ ] **Step 5: Commit**

```bash
git add sheet/layer-compiler.js tests/layer-compiler.test.js
git commit -m "feat(composer): validatePreset gom hết lỗi thay vì dừng ở lỗi đầu"
```

---

### Task 5: `compilePreset` — cấp input, chồng lớp, audio

Trái tim của compiler. Kỷ luật quan trọng nhất: **cấp input và sinh `[n:v]` trong cùng một vòng lặp**, để chỉ số không bao giờ lệch — đây chính là thứ mà `blurFrameLayers()` phải tồn tại để canh trong code cũ.

**Files:**
- Modify: `sheet/layer-compiler.js`
- Test: `tests/layer-compiler.test.js`

**Interfaces:**
- Consumes: `buildLayerChain`, `anchorExpr`, `scaleFilter` từ Task 2–3
- Produces:
  - `compilePreset(preset) -> { extraInputs: Array<{ file?: string, lavfi?: string, inputOptions: string[] }>, filterGraph: string[], warnings: string[] }`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `tests/layer-compiler.test.js`:

```js
import { compilePreset } from "../sheet/layer-compiler.js";
import { canonicalGraph } from "../tests/graph-dag.js";

const bg = { id: "bg", source: { type: "background" }, geometry: { fit: "full" } };
const ov = { id: "ov", source: { type: "overlay" }, geometry: { fit: "full" } };

test("compilePreset: nền dưới, video gốc trên, không input phụ", () => {
  const r = compilePreset({ layers: [bg, { ...ov, geometry: { fit: "full" } }] });
  assert.deepEqual(r.extraInputs, []);
  const joined = r.filterGraph.join("|");
  assert.match(joined, /\[0:v\]scale=1280:720/);
  assert.match(joined, /\[1:v\]scale=1280:720/);
  assert.match(joined, /overlay=0:0:shortest=1\[combined_video\]/);
  assert.ok(r.filterGraph.includes("[1:a]volume=1.0[overlay_audio]"));
});

test("compilePreset: lớp dưới cùng KHÔNG có bước chồng, nó là nền của chuỗi", () => {
  const r = compilePreset({ layers: [bg, ov] });
  const overlaySteps = r.filterGraph.filter((s) => s.includes("overlay="));
  assert.equal(overlaySteps.length, 1);
});

test("compilePreset: MỌI bước chồng đều có :shortest=1", () => {
  const r = compilePreset({
    layers: [
      bg,
      { id: "im", source: { type: "image", path: "a.png" }, geometry: { fit: "box", w: -2, h: 380 } },
      ov,
    ],
  });
  const steps = r.filterGraph.filter((s) => s.includes("overlay="));
  assert.equal(steps.length, 2);
  for (const s of steps) assert.match(s, /:shortest=1/);
});

test("compilePreset: chỉ số [n:v] khớp đúng thứ tự extraInputs", () => {
  const r = compilePreset({
    layers: [
      bg,
      { id: "a", source: { type: "image", path: "khung.png" }, geometry: { fit: "full" } },
      ov,
      { id: "b", source: { type: "video", path: "fx.mp4" }, geometry: { fit: "full" } },
    ],
  });
  assert.equal(r.extraInputs.length, 2);
  assert.equal(r.extraInputs[0].file, "khung.png");
  assert.deepEqual(r.extraInputs[0].inputOptions, ["-loop", "1"]);
  assert.equal(r.extraInputs[1].file, "fx.mp4");
  assert.deepEqual(r.extraInputs[1].inputOptions, ["-stream_loop", "-1"]);
  const joined = r.filterGraph.join("|");
  assert.match(joined, /\[2:v\]/);
  assert.match(joined, /\[3:v\]/);
});

test("compilePreset: lớp image thiếu path bị bỏ + có cảnh báo, chỉ số không lệch", () => {
  const r = compilePreset({
    layers: [
      bg,
      { id: "a", source: { type: "image", path: "" }, geometry: { fit: "full" } },
      ov,
      { id: "b", source: { type: "video", path: "fx.mp4" }, geometry: { fit: "full" } },
    ],
  });
  assert.equal(r.extraInputs.length, 1);
  assert.equal(r.extraInputs[0].file, "fx.mp4");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /bỏ qua lớp/);
  // fx.mp4 là input phụ đầu tiên nên phải là [2:v], KHÔNG phải [3:v].
  assert.match(r.filterGraph.join("|"), /\[2:v\]/);
  assert.doesNotMatch(r.filterGraph.join("|"), /\[3:v\]/);
});

test("compilePreset: lớp solid dùng lavfi color, kích thước từ geometry", () => {
  const r = compilePreset({
    layers: [
      bg,
      {
        id: "s", source: { type: "solid", color: "black" },
        geometry: { fit: "box", w: 1280, h: 150, anchor: "bottom-left" },
      },
      ov,
    ],
  });
  assert.equal(r.extraInputs.length, 1);
  assert.equal(r.extraInputs[0].lavfi, "color=c=black:s=1280x150:r=30");
  assert.deepEqual(r.extraInputs[0].inputOptions, ["-f", "lavfi"]);
});

test("compilePreset: lớp waveform sinh asplit và KHÔNG chiếm input", () => {
  const r = compilePreset({
    layers: [
      bg, ov,
      {
        id: "w", source: { type: "waveform", mode: "cline", color: "white", tolerance: 0.01 },
        geometry: { fit: "box", w: 480, h: 120, anchor: "bottom-center" },
      },
    ],
  });
  assert.deepEqual(r.extraInputs, []);
  const joined = r.filterGraph.join("|");
  assert.match(joined, /\[1:a\]asplit=2/);
  assert.match(joined, /showwaves=s=480x120:mode=cline:rate=30:colors=white/);
  assert.match(joined, /colorkey=0x000000:0\.01:0/);
  // Tiếng ra vẫn phải nguyên vẹn, chỉ đổi nguồn từ [1:a] sang nhánh của asplit.
  assert.match(joined, /volume=1\.0\[overlay_audio\]/);
  assert.doesNotMatch(joined, /\[1:a\]volume=1\.0/);
});

test("compilePreset: không có waveform thì giữ đúng [1:a]volume=1.0[overlay_audio]", () => {
  const r = compilePreset({ layers: [bg, ov] });
  assert.ok(r.filterGraph.includes("[1:a]volume=1.0[overlay_audio]"));
});

test("compilePreset: blend=screen dùng blend=all_mode=screen với all_opacity", () => {
  const r = compilePreset({
    layers: [
      bg, ov,
      {
        id: "fx", source: { type: "video", path: "fx.mp4" }, geometry: { fit: "full" },
        treatments: [{ kind: "opacity", value: 0.15 }], blend: "screen",
      },
    ],
  });
  assert.match(
    r.filterGraph.join("|"),
    /blend=all_mode=screen:all_opacity=0\.15:shortest=1\[combined_video\]/
  );
});

test("compilePreset: graph luôn kết thúc bằng [combined_video] và có [overlay_audio]", () => {
  const r = compilePreset({
    layers: [bg, ov, { id: "x", source: { type: "image", path: "a.png" }, geometry: { fit: "full" } }],
  });
  const joined = r.filterGraph.join("|");
  assert.equal((joined.match(/\[combined_video\]/g) || []).length, 1);
  assert.match(joined, /\[overlay_audio\]/);
});

test("compilePreset: graph sinh ra không có nhãn treo (canonicalGraph không ném)", () => {
  const r = compilePreset({
    layers: [
      bg,
      { id: "s", source: { type: "solid", color: "black" }, geometry: { fit: "box", w: 1280, h: 150 } },
      { ...ov, treatments: [{ kind: "keepColors", colors: ["FBFF02"], similarity: 0.2 }] },
      { id: "w", source: { type: "waveform" }, geometry: { fit: "box", w: 480, h: 120 } },
    ],
  });
  assert.doesNotThrow(() => canonicalGraph(r.filterGraph));
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `node --test tests/layer-compiler.test.js`
Expected: FAIL — `compilePreset is not a function`

- [ ] **Step 3: Viết `compilePreset`**

Thêm vào `sheet/layer-compiler.js`:

```js
// Chỉ số input là hợp đồng cứng với renderOne: [0] = nền, [1] = video gốc. Input phụ bắt
// đầu từ [2] và phải khớp đúng thứ tự extraInputs trả về.
const FIRST_EXTRA_INPUT = 2;

// Cấp input và sinh [n:v] trong CÙNG một vòng lặp: đây là lý do blurFrameLayers() phải
// tồn tại trong code cũ. Làm trong một vòng thì không có đường nào lệch chỉ số.
export function compilePreset(preset) {
  const layers = Array.isArray(preset?.layers) ? preset.layers : [];
  const extraInputs = [];
  const warnings = [];
  const filterGraph = [];

  let labelSeq = 0;
  const nextLabel = () => `cl${labelSeq++}`;

  // Lớp waveform lấy tiếng từ chính luồng đang dùng làm audio đầu ra, nên phải asplit.
  const hasWaveform = layers.some((l) => l?.source?.type === "waveform");
  const audioSource = hasWaveform ? "cl_a_out" : "1:a";
  if (hasWaveform) filterGraph.push("[1:a]asplit=2[cl_a_out][cl_a_wave]");

  // Nhãn nguồn video của một lớp; trả về null nghĩa là bỏ lớp này.
  const sourceLabel = (layer) => {
    const src = layer?.source || {};
    switch (src.type) {
      case "background":
        return "0:v";
      case "overlay":
        return "1:v";
      case "image":
      case "video": {
        if (!src.path) {
          warnings.push(
            `⚠️ Lớp "${layer.label || layer.id || src.type}" không có đường dẫn hợp lệ — bỏ qua lớp này`
          );
          return null;
        }
        const idx = FIRST_EXTRA_INPUT + extraInputs.length;
        extraInputs.push({
          file: src.path,
          // Ảnh tĩnh phải -loop 1, nếu không chỉ khung hình đầu tiên có ảnh.
          inputOptions: src.type === "image" ? ["-loop", "1"] : ["-stream_loop", "-1"],
        });
        return `${idx}:v`;
      }
      case "solid": {
        const g = scaleFilter(layer.geometry);
        const idx = FIRST_EXTRA_INPUT + extraInputs.length;
        extraInputs.push({
          lavfi: `color=c=${src.color || "black"}:s=${g.w || BASE_W}x${g.h || BASE_H}:r=30`,
          inputOptions: ["-f", "lavfi"],
        });
        return `${idx}:v`;
      }
      case "waveform": {
        const g = scaleFilter(layer.geometry);
        const out = nextLabel();
        filterGraph.push(
          `[cl_a_wave]showwaves=s=${g.w || BASE_W}x${g.h || BASE_H}` +
            `:mode=${src.mode || "cline"}:rate=30:colors=${src.color || "white"}` +
            // showwaves vẽ trên nền đen; phải khử nền đen thành trong suốt mới chồng được.
            `,colorkey=0x000000:${src.tolerance ?? 0.01}:0[${out}]`
        );
        return out;
      }
      default:
        warnings.push(`⚠️ Loại nguồn không hiểu (${src.type}) — bỏ qua lớp này`);
        return null;
    }
  };

  let stage = null; // nhãn của kết quả đã chồng đến lớp hiện tại
  const pending = [];

  for (const layer of layers) {
    const inLabel = sourceLabel(layer);
    if (!inLabel) continue;

    // Lớp waveform và solid đã có kích thước đúng từ nguồn; các lớp khác đi qua chuỗi
    // scale + treatment bình thường.
    const built =
      layer?.source?.type === "waveform"
        ? { statements: [], outLabel: inLabel, ...scaleFilter(layer.geometry) }
        : buildLayerChain(layer, inLabel, nextLabel);
    pending.push(...built.statements);

    if (stage === null) {
      stage = built.outLabel;
      continue;
    }
    const geo = layer.geometry || {};
    const { x, y } = anchorExpr(geo.anchor, geo.dx, geo.dy);
    const out = nextLabel();
    if (layer.blend === "screen") {
      const op = (layer.treatments || []).find((t) => t?.kind === "opacity");
      // blend phủ toàn khung, không có toạ độ — anchor/dx/dy bị bỏ qua ở đây.
      pending.push(
        `[${stage}][${built.outLabel}]blend=all_mode=screen` +
          `:all_opacity=${op ? numStr(op.value, 1) : 1}:shortest=1[${out}]`
      );
    } else {
      // shortest=1 ở MỌI bước: nền, ảnh, khối màu đều là nguồn vô hạn; độ dài hữu hạn
      // chỉ đến từ lớp video gốc.
      pending.push(`[${stage}][${built.outLabel}]overlay=${x}:${y}:shortest=1[${out}]`);
    }
    stage = out;
  }

  // Nhãn cuối cùng phải là [combined_video] — hợp đồng với renderOne. Đổi tên ở bước cuối
  // thay vì đoán trước lớp nào là lớp cuối.
  const rewritten = pending.map((s, i) =>
    i === pending.length - 1 && stage ? s.replace(new RegExp(`\\[${stage}\\]$`), "[combined_video]") : s
  );
  filterGraph.push(...rewritten);
  filterGraph.push(`[${audioSource}]volume=1.0[overlay_audio]`);
  return { extraInputs, filterGraph, warnings };
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `node --test tests/layer-compiler.test.js`
Expected: PASS — 44 test

Nếu test "lớp dưới cùng KHÔNG có bước chồng" thất bại vì graph chỉ có 2 lớp mà `pending` rỗng ở nhánh `stage === null`, kiểm lại: lớp đầu tiên chỉ đóng góp `statements`, không đóng góp bước `overlay=`.

- [ ] **Step 5: Commit**

```bash
git add sheet/layer-compiler.js tests/layer-compiler.test.js
git commit -m "feat(composer): compilePreset — cấp input và chồng lớp trong một vòng"
```

---

### Task 6: 5 preset dựng sẵn + test hồi quy so với 5 mode cũ

Đây là task **chứng minh** compiler đúng: 5 preset phải sinh ra graph tương đương graph của 5 builder cũ. Không cần đóng băng fixture — 5 builder cũ vẫn còn nguyên trong code, test gọi thẳng chúng.

Ba khác biệt **cố ý**, khai báo tường minh chứ không nới lỏng chung:

1. `:shortest=1` thêm vào 3 mode cũ chưa có → so bằng `{ ignoreShortest: true }`, kèm assert riêng rằng preset có `shortest=1`.
2. Toạ độ overlay dạng biểu thức thay vì số → so bằng `{ ignoreOverlayCoords: true }`, kèm assert riêng về chuỗi toạ độ.
3. `keepColor` dùng lớp `solid` thay `geq` → chỉ so nhánh **không** bật `keepAddDarkLayer`.

**Files:**
- Create: `presets-builtin/topTransparent.json`, `chromaKey.json`, `crop.json`, `keepColor.json`, `blurFrame.json`
- Test: `tests/builtin-presets.test.js`

**Interfaces:**
- Consumes: `compilePreset` (Task 5), `canonicalGraph` (Task 1), `buildComplexFilter` từ `sheet/render-core.js` (không sửa)
- Produces: 5 file JSON preset dựng sẵn

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/builtin-presets.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { compilePreset, validatePreset } from "../sheet/layer-compiler.js";
import { buildComplexFilter } from "../sheet/render-core.js";
import { canonicalGraph } from "./graph-dag.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "presets-builtin");
const load = (name) => JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), "utf8"));

// So theo đồ thị, bỏ qua 2 khác biệt CỐ Ý (shortest, toạ độ). Cả hai được kiểm riêng
// bằng assert tường minh ở các test bên dưới, nên bỏ qua ở đây không tạo lỗ hổng.
const sameGraph = (a, b) => {
  const opts = { ignoreShortest: true, ignoreOverlayCoords: true };
  assert.equal(canonicalGraph(a, opts), canonicalGraph(b, opts));
};

test("cả 5 preset dựng sẵn đều hợp lệ", () => {
  for (const n of ["topTransparent", "chromaKey", "crop", "keepColor", "blurFrame"]) {
    const r = validatePreset(load(n));
    assert.equal(r.ok, true, `${n}: ${r.errors.join("; ")}`);
  }
});

test("preset topTransparent tương đương mode topTransparent", () => {
  const cfg = { opacity: 0.7 };
  const p = load("topTransparent");
  p.layers.find((l) => l.source.type === "background").treatments = [
    { kind: "opacity", value: cfg.opacity },
  ];
  sameGraph(compilePreset(p).filterGraph, buildComplexFilter("topTransparent", cfg));
});

test("preset topTransparent giữ đúng thứ tự đảo: nền nằm TRÊN video gốc", () => {
  const p = load("topTransparent");
  assert.equal(p.layers[0].source.type, "overlay");
  assert.equal(p.layers[1].source.type, "background");
});

test("preset chromaKey tương đương mode chromaKey", () => {
  const cfg = { chromaColor: "D4F9D7", chromaSimilarity: 0.3 };
  const p = load("chromaKey");
  const ck = p.layers.find((l) => l.source.type === "overlay").treatments.find((t) => t.kind === "chromakey");
  ck.color = cfg.chromaColor;
  ck.similarity = cfg.chromaSimilarity;
  sameGraph(compilePreset(p).filterGraph, buildComplexFilter("chromaKey", cfg));
});

test("preset crop tương đương mode crop (không có ảnh người)", () => {
  const cfg = { cropHeight: 220, cropYOffset: 490 };
  const p = load("crop");
  p.layers = p.layers.filter((l) => l.source.type !== "image");
  const strip = p.layers.find((l) => l.source.type === "overlay").treatments.find((t) => t.kind === "cropStrip");
  strip.height = cfg.cropHeight;
  strip.yOffset = cfg.cropYOffset;
  sameGraph(compilePreset(p).filterGraph, buildComplexFilter("crop", cfg));
});

test("preset crop tương đương mode crop (CÓ ảnh người)", () => {
  const cfg = { cropHeight: 220, cropYOffset: 490, personEnabled: true, personFile: "ng.png", personPos: "center", personScale: 0.9 };
  const p = load("crop");
  const strip = p.layers.find((l) => l.source.type === "overlay").treatments.find((t) => t.kind === "cropStrip");
  strip.height = cfg.cropHeight;
  strip.yOffset = cfg.cropYOffset;
  const person = p.layers.find((l) => l.source.type === "image");
  person.source.path = cfg.personFile;
  // personGeometry cũ: h = evenDown(0.9 * (720-220)) = 450, y = 720-220-450 = 50
  person.geometry = { fit: "box", w: -2, h: 450, anchor: "bottom-left", dx: 0, dy: -cfg.cropHeight };
  sameGraph(compilePreset(p).filterGraph, buildComplexFilter("crop", cfg));
});

test("toạ độ ảnh người: biểu thức của compiler bằng số của code cũ", () => {
  // Code cũ: overlay=0:50 (720 - 220 - 450). Compiler: overlay=0:H-h-220 với h=450.
  const cfg = { cropHeight: 220, personEnabled: true, personFile: "ng.png", personPos: "left", personScale: 0.9 };
  const old = buildComplexFilter("crop", cfg).join("|");
  assert.match(old, /overlay=0:50/);

  const p = load("crop");
  p.layers.find((l) => l.source.type === "overlay").treatments.find((t) => t.kind === "cropStrip").height = 220;
  const person = p.layers.find((l) => l.source.type === "image");
  person.source.path = "ng.png";
  person.geometry = { fit: "box", w: -2, h: 450, anchor: "bottom-left", dy: -220 };
  const now = compilePreset(p).filterGraph.join("|");
  assert.match(now, /overlay=0:H-h-220:shortest=1/);
  // 720 - 450 - 220 = 50 — bằng nhau về số.
  assert.equal(720 - 450 - 220, 50);
});

test("preset keepColor tương đương mode keepColor (không bật lớp nền tối)", () => {
  const cfg = { keepColors: ["FBFF02", "FF0000"], keepSimilarity: 0.2, keepCrop: true, keepHeight: 150, keepYOffset: 550, keepAddDarkLayer: false };
  const p = load("keepColor");
  p.layers = p.layers.filter((l) => l.source.type !== "solid");
  const ovl = p.layers.find((l) => l.source.type === "overlay");
  ovl.treatments = [
    { kind: "cropStrip", height: cfg.keepHeight, yOffset: cfg.keepYOffset },
    { kind: "keepColors", colors: cfg.keepColors, similarity: cfg.keepSimilarity },
  ];
  sameGraph(compilePreset(p).filterGraph, buildComplexFilter("keepColor", cfg));
});

test("preset keepColor dùng lớp solid thay geq — khác bản gốc CỐ Ý", () => {
  const p = load("keepColor");
  const solid = p.layers.find((l) => l.source.type === "solid");
  assert.ok(solid, "preset keepColor phải có lớp solid làm nền tối");
  const r = compilePreset(p);
  assert.match(r.extraInputs.map((i) => i.lavfi || "").join("|"), /color=c=black/);
  // Bản gốc dựng khối đen bằng geq trên bản copy video gốc; compiler không dùng geq.
  assert.doesNotMatch(r.filterGraph.join("|"), /geq=/);
});

test("preset blurFrame tương đương mode blurFrame (đủ 3 lớp)", () => {
  const cfg = {
    bgBlurEnabled: true, bgBlur: 20, mainScale: 0.85, mainOpacity: 0.85,
    frameEnabled: true, frameFile: "khung.png", frameScale: 1,
    effectEnabled: true, effectFile: "fx.mp4", effectOpacity: 0.15, effectBlend: "screen",
  };
  const p = load("blurFrame");
  p.layers.find((l) => l.source.type === "image").source.path = cfg.frameFile;
  p.layers.find((l) => l.source.type === "video").source.path = cfg.effectFile;
  sameGraph(compilePreset(p).filterGraph, buildComplexFilter("blurFrame", cfg));
});

test("preset blurFrame: extraInputs khớp buildStudioInputs cũ về thứ tự và cờ", () => {
  const p = load("blurFrame");
  p.layers.find((l) => l.source.type === "image").source.path = "khung.png";
  p.layers.find((l) => l.source.type === "video").source.path = "fx.mp4";
  const r = compilePreset(p);
  assert.deepEqual(r.extraInputs, [
    { file: "khung.png", inputOptions: ["-loop", "1"] },
    { file: "fx.mp4", inputOptions: ["-stream_loop", "-1"] },
  ]);
});

test("3 preset của mode chưa có shortest=1 thì preset PHẢI có — khác biệt cố ý", () => {
  for (const n of ["topTransparent", "chromaKey", "crop"]) {
    const old = buildComplexFilter(n, {}).join("|");
    assert.doesNotMatch(old, /shortest=1/, `${n}: mode cũ lẽ ra không có shortest`);
    const steps = compilePreset(load(n)).filterGraph.filter((s) => s.includes("overlay="));
    for (const s of steps) assert.match(s, /:shortest=1/, `${n}: preset phải có shortest=1`);
  }
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `node --test tests/builtin-presets.test.js`
Expected: FAIL — `ENOENT ... presets-builtin/topTransparent.json`

- [ ] **Step 3: Viết 5 file preset**

`presets-builtin/topTransparent.json` — chú ý **nền nằm trên**:

```json
{
  "version": 1,
  "name": "topTransparent",
  "label": "Video trong suốt",
  "base": { "w": 1280, "h": 720 },
  "layers": [
    { "id": "ov", "label": "Video gốc", "source": { "type": "overlay" }, "geometry": { "fit": "full" }, "treatments": [], "blend": "normal" },
    { "id": "bg", "label": "Nền", "slot": "nen", "source": { "type": "background" }, "geometry": { "fit": "full", "anchor": "top-left" }, "treatments": [{ "kind": "opacity", "value": 0.9 }], "blend": "normal" }
  ]
}
```

`presets-builtin/chromaKey.json`:

```json
{
  "version": 1,
  "name": "chromaKey",
  "label": "Chroma Key",
  "base": { "w": 1280, "h": 720 },
  "layers": [
    { "id": "bg", "label": "Nền", "slot": "nen", "source": { "type": "background" }, "geometry": { "fit": "full" }, "treatments": [], "blend": "normal" },
    { "id": "ov", "label": "Video gốc", "source": { "type": "overlay" }, "geometry": { "fit": "full", "anchor": "bottom-left" }, "treatments": [{ "kind": "chromakey", "color": "D4F9D7", "similarity": 0.3, "blend": 0.1 }], "blend": "normal" }
  ]
}
```

`presets-builtin/crop.json` — thứ tự: nền → ảnh người → dải crop. Dải crop là lớp **cuối** vì nó chứa phụ đề, không bao giờ được để ảnh che:

```json
{
  "version": 1,
  "name": "crop",
  "label": "Crop",
  "base": { "w": 1280, "h": 720 },
  "layers": [
    { "id": "bg", "label": "Nền", "slot": "nen", "source": { "type": "background" }, "geometry": { "fit": "full" }, "treatments": [], "blend": "normal" },
    { "id": "person", "label": "Ảnh người", "slot": "anh_nguoi", "source": { "type": "image", "path": "" }, "geometry": { "fit": "box", "w": -2, "h": 450, "anchor": "bottom-center", "dx": 0, "dy": -220 }, "treatments": [], "blend": "normal" },
    { "id": "strip", "label": "Dải crop", "source": { "type": "overlay" }, "geometry": { "fit": "full", "anchor": "bottom-left" }, "treatments": [{ "kind": "cropStrip", "height": 220, "yOffset": 490 }, { "kind": "grayContrast", "brightness": "-1.0", "contrast": "3.0", "gamma": "1.2", "saturation": "0" }, { "kind": "opacity", "value": 0.8 }], "blend": "normal" }
  ]
}
```

`presets-builtin/keepColor.json`:

```json
{
  "version": 1,
  "name": "keepColor",
  "label": "Giữ màu",
  "base": { "w": 1280, "h": 720 },
  "layers": [
    { "id": "bg", "label": "Nền", "slot": "nen", "source": { "type": "background" }, "geometry": { "fit": "full" }, "treatments": [], "blend": "normal" },
    { "id": "dark", "label": "Lớp nền tối", "source": { "type": "solid", "color": "black" }, "geometry": { "fit": "box", "w": 1280, "h": 220, "anchor": "bottom-left" }, "treatments": [], "blend": "normal" },
    { "id": "kept", "label": "Màu giữ lại", "source": { "type": "overlay" }, "geometry": { "fit": "full", "anchor": "bottom-left" }, "treatments": [{ "kind": "cropStrip", "height": 220, "yOffset": 490 }, { "kind": "keepColors", "colors": ["FBFF02"], "similarity": 0.2 }], "blend": "normal" }
  ]
}
```

`presets-builtin/blurFrame.json` — `mainScale 0.85` → `scale=1088:612`; khung dùng `frameScale 1` nên cùng kích thước:

```json
{
  "version": 1,
  "name": "blurFrame",
  "label": "Nền mờ + khung",
  "base": { "w": 1280, "h": 720 },
  "layers": [
    { "id": "bg", "label": "Nền mờ", "slot": "nen", "source": { "type": "background" }, "geometry": { "fit": "full" }, "treatments": [{ "kind": "blur", "sigma": 20 }], "blend": "normal" },
    { "id": "ov", "label": "Video gốc", "source": { "type": "overlay" }, "geometry": { "fit": "scale", "value": 0.85, "anchor": "center" }, "treatments": [{ "kind": "opacity", "value": 0.85 }], "blend": "normal" },
    { "id": "frame", "label": "Khung", "slot": "khung", "source": { "type": "image", "path": "" }, "geometry": { "fit": "box", "w": 1088, "h": 612, "anchor": "center" }, "treatments": [], "blend": "normal" },
    { "id": "fx", "label": "Hiệu ứng", "slot": "hieu_ung", "source": { "type": "video", "path": "" }, "geometry": { "fit": "full", "anchor": "top-left" }, "treatments": [{ "kind": "opacity", "value": 0.15 }], "blend": "screen" }
  ]
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `node --test tests/builtin-presets.test.js`
Expected: PASS — 13 test

Nếu một preset lệch, in cả hai graph ra để đối chiếu:
`node -e "import('./sheet/render-core.js').then(m=>console.log(m.buildComplexFilter('crop',{cropHeight:220,cropYOffset:490}).join('\n')))"`

- [ ] **Step 5: Commit**

```bash
git add presets-builtin tests/builtin-presets.test.js
git commit -m "feat(composer): 5 preset dựng sẵn + test hồi quy so với 5 mode cũ"
```

---

### Task 7: `preset-store.js` — đọc/ghi preset và ghi đè theo khe

Không gọi API Electron: `presetsDir` truyền vào từ ngoài, nên test được bằng thư mục tạm và `render.js` (không có `app`) cũng dùng được.

**Files:**
- Create: `sheet/preset-store.js`
- Test: `tests/preset-store.test.js`

**Interfaces:**
- Consumes: `validatePreset` từ Task 4
- Produces:
  - `listPresets(presetsDir) -> string[]`
  - `loadPreset(presetsDir, name) -> object | null`
  - `savePreset(presetsDir, preset) -> { ok: boolean, errors: string[] }`
  - `ensureBuiltins(presetsDir, builtinDir) -> string[]` — tên các preset vừa copy
  - `applySlotOverrides(preset, overrides: Record<string,string>) -> object` — bản sao mới, không sửa preset gốc

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/preset-store.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  listPresets, loadPreset, savePreset, ensureBuiltins, applySlotOverrides,
} from "../sheet/preset-store.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vm-presets-"));

const p1 = {
  version: 1, name: "thu",
  layers: [
    { id: "bg", source: { type: "background" }, geometry: { fit: "full" } },
    { id: "k", slot: "khung", source: { type: "image", path: "mac-dinh.png" }, geometry: { fit: "full" } },
    { id: "ov", source: { type: "overlay" }, geometry: { fit: "full" } },
  ],
};

test("savePreset rồi loadPreset trả lại đúng preset", () => {
  const dir = tmp();
  assert.deepEqual(savePreset(dir, p1), { ok: true, errors: [] });
  assert.deepEqual(loadPreset(dir, "thu"), p1);
});

test("savePreset từ chối preset không hợp lệ và KHÔNG ghi file", () => {
  const dir = tmp();
  const bad = { version: 1, name: "xau", layers: [{ id: "a", source: { type: "background" } }] };
  const r = savePreset(dir, bad);
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(path.join(dir, "xau.json")), false);
});

test("savePreset tạo thư mục nếu chưa có", () => {
  const dir = path.join(tmp(), "chua-ton-tai");
  assert.equal(savePreset(dir, p1).ok, true);
  assert.ok(fs.existsSync(path.join(dir, "thu.json")));
});

test("savePreset làm sạch tên file, chặn đi ra ngoài thư mục", () => {
  const dir = tmp();
  assert.equal(savePreset(dir, { ...p1, name: "../../hack" }).ok, true);
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  assert.doesNotMatch(files[0], /\.\./);
});

test("listPresets trả tên đã sắp, bỏ file không phải .json", () => {
  const dir = tmp();
  savePreset(dir, { ...p1, name: "beta" });
  savePreset(dir, { ...p1, name: "alpha" });
  fs.writeFileSync(path.join(dir, "ghi-chu.txt"), "x");
  assert.deepEqual(listPresets(dir), ["alpha", "beta"]);
});

test("listPresets trả mảng rỗng khi thư mục chưa tồn tại", () => {
  assert.deepEqual(listPresets(path.join(tmp(), "khong-co")), []);
});

test("loadPreset trả null khi không có file, và khi JSON hỏng", () => {
  const dir = tmp();
  assert.equal(loadPreset(dir, "khong-co"), null);
  fs.writeFileSync(path.join(dir, "hong.json"), "{ khong phai json");
  assert.equal(loadPreset(dir, "hong"), null);
});

test("ensureBuiltins copy preset dựng sẵn lần đầu", () => {
  const src = tmp();
  const dst = tmp();
  fs.writeFileSync(path.join(src, "a.json"), JSON.stringify(p1));
  assert.deepEqual(ensureBuiltins(dst, src), ["a"]);
  assert.ok(fs.existsSync(path.join(dst, "a.json")));
});

test("ensureBuiltins KHÔNG ghi đè bản người dùng đã sửa", () => {
  const src = tmp();
  const dst = tmp();
  fs.writeFileSync(path.join(src, "a.json"), JSON.stringify(p1));
  fs.writeFileSync(path.join(dst, "a.json"), JSON.stringify({ ...p1, name: "da-sua" }));
  assert.deepEqual(ensureBuiltins(dst, src), []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dst, "a.json"), "utf8")).name, "da-sua");
});

test("applySlotOverrides ghi đè đúng khe, để trống thì giữ mặc định", () => {
  const r = applySlotOverrides(p1, { khung: "D:/kenh-b/hoa.png" });
  assert.equal(r.layers.find((l) => l.slot === "khung").source.path, "D:/kenh-b/hoa.png");
  const r2 = applySlotOverrides(p1, { khung: "" });
  assert.equal(r2.layers.find((l) => l.slot === "khung").source.path, "mac-dinh.png");
});

test("applySlotOverrides KHÔNG sửa preset gốc", () => {
  applySlotOverrides(p1, { khung: "khac.png" });
  assert.equal(p1.layers.find((l) => l.slot === "khung").source.path, "mac-dinh.png");
});

test("applySlotOverrides bỏ qua khe không tồn tại, không ném", () => {
  assert.doesNotThrow(() => applySlotOverrides(p1, { khong_co_khe: "x.png" }));
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `node --test tests/preset-store.test.js`
Expected: FAIL — `Cannot find module '../sheet/preset-store.js'`

- [ ] **Step 3: Viết `sheet/preset-store.js`**

```js
import fs from "fs";
import path from "path";
import { validatePreset } from "./layer-compiler.js";

// presetsDir truyền vào từ ngoài chứ không tự gọi app.getPath("userData"): render.js là
// tiến trình node riêng, không có đối tượng app của Electron, và test cần thư mục tạm.

// Tên preset đi thẳng vào tên file nên phải làm sạch: "../../x" không được thoát ra ngoài.
function safeName(name) {
  return String(name || "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "preset";
}

export function listPresets(presetsDir) {
  try {
    return fs
      .readdirSync(presetsDir)
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .map((f) => f.slice(0, -".json".length))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  } catch {
    return [];
  }
}

// Trả null thay vì ném: một file preset hỏng không đáng làm chết cả danh sách.
export function loadPreset(presetsDir, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(presetsDir, `${safeName(name)}.json`), "utf8"));
  } catch {
    return null;
  }
}

export function savePreset(presetsDir, preset) {
  const check = validatePreset(preset);
  if (!check.ok) return check;
  try {
    fs.mkdirSync(presetsDir, { recursive: true });
    fs.writeFileSync(
      path.join(presetsDir, `${safeName(preset?.name)}.json`),
      JSON.stringify(preset, null, 2),
      "utf8"
    );
    return { ok: true, errors: [] };
  } catch (err) {
    return { ok: false, errors: [`không ghi được preset: ${err.message}`] };
  }
}

// Copy preset dựng sẵn sang thư mục người dùng, KHÔNG ghi đè bản đã có: người dùng sửa
// preset dựng sẵn rồi thì lần mở app sau không được mất công sửa đó.
export function ensureBuiltins(presetsDir, builtinDir) {
  const copied = [];
  try {
    fs.mkdirSync(presetsDir, { recursive: true });
    for (const f of fs.readdirSync(builtinDir)) {
      if (!f.toLowerCase().endsWith(".json")) continue;
      const dst = path.join(presetsDir, f);
      if (fs.existsSync(dst)) continue;
      fs.copyFileSync(path.join(builtinDir, f), dst);
      copied.push(f.slice(0, -".json".length));
    }
  } catch {
    // Thiếu thư mục dựng sẵn thì thôi, không làm chết app.
  }
  return copied;
}

// Ô Sheet có giá trị thì thắng; để trống thì dùng đường dẫn mặc định trong preset. Trả về
// BẢN SAO: preset gốc được nhiều kênh dùng chung, sửa tại chỗ là kênh sau ăn giá trị của
// kênh trước.
export function applySlotOverrides(preset, overrides = {}) {
  const clone = JSON.parse(JSON.stringify(preset || {}));
  for (const layer of clone.layers || []) {
    const v = layer.slot ? overrides[layer.slot] : undefined;
    if (v === undefined || v === null || String(v).trim() === "") continue;
    layer.source = { ...(layer.source || {}), path: String(v).trim() };
  }
  return clone;
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `node --test tests/preset-store.test.js`
Expected: PASS — 12 test

- [ ] **Step 5: Commit**

```bash
git add sheet/preset-store.js tests/preset-store.test.js
git commit -m "feat(composer): preset-store — đọc/ghi preset và ghi đè theo khe"
```

---

### Task 8: Nhánh `composer` trong `render-core.js`

**Files:**
- Modify: `sheet/render-core.js` — thêm `import`, thêm nhánh trong `renderOne` (quanh dòng 458-471 và 482-498)
- Test: `tests/render-core.test.js`

**Interfaces:**
- Consumes: `compilePreset` (Task 5), `pickAsset` (đã có trong `render-core.js:262`)
- Produces:
  - `resolvePresetAssets(preset, rand?) -> { preset: object, warnings: string[] }` — export mới từ `render-core.js`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `tests/render-core.test.js`:

```js
import { resolvePresetAssets } from "../sheet/render-core.js";

test("resolvePresetAssets chốt file cụ thể khi path là thư mục", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-anh-"));
  fs.writeFileSync(path.join(dir, "a.png"), "x");
  const preset = {
    layers: [
      { id: "bg", source: { type: "background" }, geometry: { fit: "full" } },
      { id: "im", source: { type: "image", path: dir }, geometry: { fit: "full" } },
      { id: "ov", source: { type: "overlay" }, geometry: { fit: "full" } },
    ],
  };
  const r = resolvePresetAssets(preset, () => 0);
  assert.equal(r.preset.layers[1].source.path, path.join(dir, "a.png"));
  assert.deepEqual(r.warnings, []);
});

test("resolvePresetAssets KHÔNG sửa preset đầu vào", () => {
  const preset = {
    layers: [{ id: "im", source: { type: "image", path: "/khong/co" }, geometry: { fit: "full" } }],
  };
  resolvePresetAssets(preset, () => 0);
  assert.equal(preset.layers[0].source.path, "/khong/co");
});

test("resolvePresetAssets cảnh báo và để path rỗng khi đường dẫn hỏng, không ném", () => {
  const preset = {
    layers: [
      { id: "im", label: "Khung", source: { type: "image", path: "/khong/co/thuc" }, geometry: { fit: "full" } },
    ],
  };
  const r = resolvePresetAssets(preset, () => 0);
  assert.equal(r.preset.layers[0].source.path, "");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Khung/);
});

test("resolvePresetAssets bỏ qua lớp không cần file", () => {
  const preset = {
    layers: [
      { id: "bg", source: { type: "background" }, geometry: { fit: "full" } },
      { id: "s", source: { type: "solid", color: "black" }, geometry: { fit: "box", w: 10, h: 10 } },
      { id: "w", source: { type: "waveform" }, geometry: { fit: "box", w: 10, h: 10 } },
      { id: "ov", source: { type: "overlay" }, geometry: { fit: "full" } },
    ],
  };
  const r = resolvePresetAssets(preset, () => 0);
  assert.deepEqual(r.warnings, []);
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `node --test tests/render-core.test.js`
Expected: FAIL — `resolvePresetAssets is not a function`

- [ ] **Step 3: Sửa `sheet/render-core.js`**

Thêm import ở đầu file, ngay sau các import sẵn có:

```js
import { compilePreset } from "./layer-compiler.js";
```

Thêm hàm mới, đặt ngay trước `export function renderOne(`:

```js
// Chốt asset của preset MỘT LẦN trước khi dựng graph. Bắt buộc phải chốt ở đây: run()
// được gọi lại lần hai khi GPU lỗi phải lùi về CPU, chốt muộn hơn thì lớp có path là
// thư mục sẽ bốc ra ảnh khác giữa hai lần.
// Đường dẫn hỏng thì cảnh báo và để rỗng (compilePreset sẽ bỏ lớp đó) chứ không ném:
// luồng sheet chạy không người trông, một ô gõ sai không đáng làm hỏng cả mẻ video.
export function resolvePresetAssets(preset, rand = Math.random) {
  const clone = JSON.parse(JSON.stringify(preset || {}));
  const warnings = [];
  for (const layer of clone.layers || []) {
    const type = layer?.source?.type;
    if (type !== "image" && type !== "video") continue;
    const exts = type === "image" ? FRAME_EXTS : EFFECT_EXTS;
    const file = pickAsset(layer.source.path, exts, rand);
    if (!file && layer.source.path) {
      warnings.push(
        `⚠️ Lớp "${layer.label || layer.id || type}": không tìm được file hợp lệ tại ${layer.source.path} — bỏ qua lớp này`
      );
    }
    layer.source = { ...layer.source, path: file };
  }
  return { preset: clone, warnings };
}
```

Trong `renderOne`, thêm nhánh ngay **sau** khối `if (renderMode === "crop") { … }` (kết thúc ở dòng 471):

```js
  // Composer: bố cục đến từ preset trong cfg.preset thay vì fix cứng theo mode.
  let composed = null;
  if (renderMode === "composer") {
    const { preset, warnings } = resolvePresetAssets(cfg.preset);
    if (onProgress) warnings.forEach((w) => onProgress(w));
    composed = compilePreset(preset);
    if (onProgress) composed.warnings.forEach((w) => onProgress(w));
  }
```

Thay dòng dựng filter (dòng 482) và dòng dựng input phụ (dòng 488):

```js
      const filterConfig = composed
        ? [...composed.filterGraph]
        : buildComplexFilter(renderMode, cfg);
```

```js
      const studioInputs = composed ? composed.extraInputs : buildStudioInputs(renderMode, cfg);
```

Trong `run()`, vòng lặp nạp input phụ (dòng 496-498) phải xử lý được input `lavfi` (khối
màu không có file):

```js
        for (const extra of studioInputs) {
          // Lớp solid không có file: nó là nguồn sinh của ffmpeg (-f lavfi -i color=…).
          command.input(extra.lavfi ?? extra.file).inputOptions(extra.inputOptions);
        }
```

- [ ] **Step 4: Chạy toàn bộ test để chắc chắn không vỡ gì**

Run: `npm test`
Expected: PASS — mọi test cũ vẫn xanh (bằng chứng 5 mode cũ không bị đụng) + 4 test mới

- [ ] **Step 5: Commit**

```bash
git add sheet/render-core.js tests/render-core.test.js
git commit -m "feat(composer): nhánh composer trong renderOne, chốt asset trước khi dựng graph"
```

---

### Task 9: Nhánh `composer` trong `render.js` (tab Render thủ công)

`render.js` là tiến trình node riêng, không có `app` của Electron nên không tự tìm được
thư mục preset. Preset phải được **truyền vào** qua config: `electron-main.js` đã có sẵn
đường `RENDER_CONFIG_JSON` (`render.js:346`).

Thiếu `config.preset` thì **dừng ngay với lỗi rõ ràng**, không âm thầm rơi về
`topTransparent`: render cả mẻ 60 video ra sai bố cục tệ hơn nhiều so với dừng sớm.

**Files:**
- Modify: `render.js` — import, biến config, nhánh trong `processVideo` (quanh dòng 980-1020)
- Test: `tests/packaging.test.js` (test sẵn có tự bắt lỗi import; chỉ cần chạy)

**Interfaces:**
- Consumes: `compilePreset` từ `sheet/layer-compiler.js`, `resolvePresetAssets` từ `sheet/render-core.js`
- Produces: không có export mới

- [ ] **Step 1: Thêm import và đọc config**

Thêm vào đầu `render.js`, cạnh các import sẵn có:

```js
import { compilePreset } from "./sheet/layer-compiler.js";
import { resolvePresetAssets } from "./sheet/render-core.js";
```

Khai báo biến module cạnh các biến config khác:

```js
// Bố cục composer. render.js không có app của Electron nên không tự tìm được thư mục
// preset — electron-main phải nhét cả object preset vào RENDER_CONFIG_JSON.
let composerPreset = null;
```

Trong khối `if (config) { … }` (bắt đầu dòng 374), thêm:

```js
  if (config.preset) composerPreset = config.preset;
```

Ngay sau khối đó, thêm kiểm tra dừng sớm:

```js
// Dừng ngay thay vì âm thầm rơi về topTransparent: render cả mẻ ra sai bố cục tệ hơn
// nhiều so với dừng sớm và báo rõ.
if (renderMode === "composer" && !composerPreset) {
  log(
    "❌ renderMode là 'composer' nhưng config không có 'preset'. electron-main phải nạp preset và truyền qua RENDER_CONFIG_JSON.",
    LOG_LEVEL.ERROR
  );
  process.exit(1);
}
```

- [ ] **Step 2: Thêm nhánh trong `processVideo`**

Trong chuỗi `if/else if` chọn mode (`render.js:975-1000`), thêm nhánh **trước** nhánh
`else` mặc định:

```js
      } else if (renderMode === "composer") {
        log(
          `🧩 Dùng bố cục composer "${composerPreset?.name || "?"}" cho ${path.basename(outputPath)}`,
          LOG_LEVEL.DEBUG
        );
        // Chốt asset rồi mới dựng filter: filter và danh sách input phải khớp chỉ số.
        const { preset, warnings } = resolvePresetAssets(composerPreset);
        warnings.forEach((w) => log(w, LOG_LEVEL.WARN));
        const composed = compilePreset(preset);
        composed.warnings.forEach((w) => log(w, LOG_LEVEL.WARN));
        filterConfig = [...composed.filterGraph];
        studioInputs = composed.extraInputs;
      } else {
```

Sửa vòng lặp nạp input phụ (`render.js:1016-1018`) để hiểu input `lavfi`:

```js
      for (const extra of studioInputs) {
        // Lớp solid không có file: nó là nguồn sinh của ffmpeg (-f lavfi -i color=…).
        command.input(extra.lavfi ?? extra.file).inputOptions(extra.inputOptions);
      }
```

- [ ] **Step 3: Chạy test đóng gói để chắc chắn import hợp lệ**

Run: `node --test tests/packaging.test.js`
Expected: PASS — test "script được asarUnpack không import từ thư mục chưa được bung ra"
phải xanh, vì `sheet/**` đã có trong `asarUnpack`.

- [ ] **Step 4: Chạy toàn bộ test**

Run: `npm test`
Expected: PASS — tất cả

- [ ] **Step 5: Commit**

```bash
git add render.js
git commit -m "feat(composer): nhánh composer cho tab Render thủ công"
```

---

### Task 10: Cột Sheet `preset` và ghi đè theo khe

**Files:**
- Modify: `sheet/sheets-service.js` — `HEADER_ALIASES` (quanh dòng 37-60), `parseConfigRows` (quanh dòng 110-200)
- Modify: `sheet/sheet-runner.js` — quanh dòng 240-256 (chỗ gọi `renderer`)
- Test: `tests/sheets-service.test.js`

**Interfaces:**
- Consumes: `applySlotOverrides`, `loadPreset` từ Task 7
- Produces: `channel.presetName: string`, `channel.slotOverrides: Record<string,string>`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `tests/sheets-service.test.js` (dùng đúng cách dựng `values` mà các test sẵn có
trong file này đang dùng):

```js
test("parseConfigRows đọc cột preset", () => {
  const values = [
    ["tên kênh", "bật", "video mỗi ngày", "kiểu render", "preset"],
    ["Kênh A", "x", "3", "composer", "khung-waveform"],
  ];
  const rows = parseConfigRows(values);
  assert.equal(rows[0].renderMode, "composer");
  assert.equal(rows[0].presetName, "khung-waveform");
});

test("parseConfigRows gom cột asset thành slotOverrides", () => {
  const values = [
    ["tên kênh", "bật", "video mỗi ngày", "kiểu render", "preset", "khung", "ảnh người", "hiệu ứng"],
    ["Kênh A", "x", "3", "composer", "p1", "D:/kh/hoa.png", "D:/ng/", ""],
  ];
  const rows = parseConfigRows(values);
  assert.equal(rows[0].slotOverrides.khung, "D:/kh/hoa.png");
  assert.equal(rows[0].slotOverrides.anh_nguoi, "D:/ng/");
  // Ô trống KHÔNG được thành khoá: để trống nghĩa là dùng mặc định của preset.
  assert.equal("hieu_ung" in rows[0].slotOverrides, false);
});

test("parseConfigRows: kênh không dùng composer vẫn chạy như cũ", () => {
  const values = [
    ["tên kênh", "bật", "video mỗi ngày", "kiểu render", "chiều cao cắt"],
    ["Kênh B", "x", "2", "crop", "150"],
  ];
  const rows = parseConfigRows(values);
  assert.equal(rows[0].renderMode, "crop");
  assert.equal(rows[0].presetName, "");
  assert.equal(rows[0].cfg.cropHeight, 150);
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó thất bại**

Run: `node --test tests/sheets-service.test.js`
Expected: FAIL — `presetName` là `undefined`

- [ ] **Step 3: Sửa `sheet/sheets-service.js`**

Thêm vào `HEADER_ALIASES`, cạnh `renderMode`:

```js
  presetName: ["preset", "bố cục"],
```

Thêm bảng khe ngay dưới `HEADER_ALIASES`:

```js
// Khe của lớp trong preset -> tên cột Sheet ghi đè đường dẫn asset cho từng kênh.
// Dùng lại đúng những tên cột đã có, nên sheet đang chạy không phải đổi gì.
const SLOT_COLUMNS = {
  nen: "backgroundSlot",
  khung: "framePath",
  anh_nguoi: "personPath",
  hieu_ung: "effectPath",
};
```

Thêm alias cho cột nền mới (cạnh các alias khác):

```js
  backgroundSlot: ["nền", "video nền"],
```

Trong `parseConfigRows`, trong vòng lặp dòng, thêm ngay trước khi dựng `const channel = {`:

```js
    // Ô trống KHÔNG được thành khoá: applySlotOverrides coi khoá có giá trị là "ghi đè",
    // nên thêm khoá rỗng sẽ xoá mất đường dẫn mặc định của preset.
    const slotOverrides = {};
    for (const [slot, columnKey] of Object.entries(SLOT_COLUMNS)) {
      const v = col(row, columnKey);
      if (v) slotOverrides[slot] = v;
    }
```

Thêm 2 khoá vào object `channel`:

```js
      presetName: col(row, "presetName"),
      slotOverrides,
```

- [ ] **Step 4: Chạy test để chắc chắn nó xanh**

Run: `node --test tests/sheets-service.test.js`
Expected: PASS — mọi test cũ + 3 test mới

- [ ] **Step 5: Nạp preset trong `sheet-runner.js`**

Thêm import ở đầu file:

```js
import { loadPreset, applySlotOverrides } from "./preset-store.js";
```

Trong hàm chạy, ngay **sau** khối `if (ch.renderMode === "chromaKeyAuto" …)` (kết thúc
quanh dòng 250), thêm:

```js
          if (ch.renderMode === "composer") {
            const preset = loadPreset(config.presetsDir, ch.presetName);
            if (!preset) {
              emit({
                type: "log",
                message: `Bỏ qua ${ch.sheetName}: không đọc được preset "${ch.presetName || "(trống)"}"`,
              });
              continue;
            }
            cfg.preset = applySlotOverrides(preset, ch.slotOverrides);
          }
```

`config.presetsDir` do `electron-main.js` truyền vào khi khởi động runner —
`path.join(app.getPath("userData"), "presets")`.

- [ ] **Step 6: Chạy toàn bộ test**

Run: `npm test`
Expected: PASS — tất cả

- [ ] **Step 7: Commit**

```bash
git add sheet/sheets-service.js sheet/sheet-runner.js tests/sheets-service.test.js
git commit -m "feat(composer): cột Sheet preset và ghi đè asset theo khe"
```

---

## Kiểm chứng bằng render thật (bắt buộc, không thay được bằng test đơn vị)

Sau Task 10, chạy tay 5 việc dưới đây. Spec liệt kê chúng là rủi ro mở; test đơn vị
không nói được điều gì về chúng.

- [ ] **1. Độ dài video với nhiều nguồn vô hạn.** Dựng một preset JSON tay có nền + 2 ảnh
  + video gốc, render một video thật. Kiểm `ffprobe` độ dài đầu ra khớp
  `độ dài gốc / videoSpeed`, và ffmpeg không treo.
- [ ] **2. Preset không có lớp `background`.** Input `[0]` `-stream_loop -1` không được
  tham chiếu. Render thử, xác nhận không treo.
- [ ] **3. `showwaves` có trong suốt thật không** sau `colorkey=0x000000`. Thử tolerance
  `0.01`, `0.1`, `0.3`; chọn giá trị cho sóng sạch mà không ăn mất phần tối của sóng.
- [ ] **4. Ảnh PNG không có kênh alpha** ra khối chữ nhật đặc — xác nhận rồi ghi vào
  hướng dẫn. Đây là lỗi dữ liệu vào, không sửa bằng code.
- [ ] **5. Bố cục trong ảnh mẫu của người dùng**: khung lệch tâm + video gốc trong khung
  + cụm LIKE/SUB góc phải + waveform giữa dưới + ô bo góc dưới phải. Viết preset JSON tay,
  render thật, đối chiếu với ảnh mẫu. Đây là bài kiểm cuối của Giai đoạn 1.

---

## Self-Review

**Spec coverage:**

| Mục spec | Task |
|---|---|
| Mô hình preset (schema, `slot`) | 6, 7 |
| 6 loại nguồn, chỉ số `[0]`/`[1]` cố định | 5 |
| `solid`/`waveform` buộc `fit: "box"` | 4 |
| Hình học: `fit`, 9 anchor, `dx`/`dy`, `w: -2` | 2 |
| 7 treatment | 3 |
| Luật `format=yuva420p` (3 thứ tự) | 3 |
| `keepColors` nhiều câu lệnh | 3 |
| `blend` normal/screen, `all_opacity` | 3, 5 |
| `shortest=1` mọi bước | 5, 6 |
| Toạ độ luôn là biểu thức + 3 khác biệt cố ý | 2, 6 |
| Waveform + `asplit` | 5 |
| Compiler: input và `[n:v]` cùng một vòng | 5 |
| Chốt asset một lần trước khi dựng graph | 8 |
| 5 preset dựng sẵn | 6 |
| Lưu trữ `userData/presets`, copy builtin | 7 |
| Sheet: cột `preset`, ghi đè theo khe | 10 |
| Xử lý lỗi (bảng 7 dòng) | 3, 4, 5, 7, 8, 9 |
| Test DAG so với mode cũ | 1, 6 |
| 5 rủi ro cần render thật | mục "Kiểm chứng bằng render thật" |

Ngoài phạm vi Giai đoạn 1 (đúng theo spec): canvas kéo thả, `preview-frame.js`, IPC,
trích khung hình đại diện — toàn bộ Giai đoạn 2.

**Type consistency:** `compilePreset` trả `{ extraInputs, filterGraph, warnings }` ở Task
5 và được dùng đúng ba tên đó ở Task 8, 9. `extraInputs` phần tử là
`{ file?, lavfi?, inputOptions }` — Task 8 và 9 đều dùng `extra.lavfi ?? extra.file`.
`validatePreset` trả `{ ok, errors }` ở Task 4, `savePreset` trả lại đúng hình dạng đó ở
Task 7. `resolvePresetAssets` trả `{ preset, warnings }` ở Task 8, dùng đúng ở Task 9.
`buildLayerChain` trả `{ statements, outLabel, w, h }` ở Task 3, dùng đúng ở Task 5.
`scaleFilter` trả `{ filter, w, h }` ở Task 2, dùng ở Task 3 và 5.
