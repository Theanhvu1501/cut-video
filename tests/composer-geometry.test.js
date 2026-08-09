import { test } from "node:test";
import assert from "node:assert/strict";
// sheet/composer-geometry.cjs export theo kiểu UMD (module.exports = factory() bên trong một
// IIFE) để cùng lúc nạp được bằng <script> thường ở trình duyệt VÀ bằng Node — nhưng cách viết
// đó khiến cjs-module-lexer của Node không suy được named export tĩnh, nên phải import default
// rồi destructure, không phải "import { pickAnchor } from ...". Đã tự kiểm bằng node -e trước
// khi viết test này: named import thẳng ra TypeError "not a function", default import ra đủ 10
// hàm/hằng số.
import ComposerGeometry from "../sheet/composer-geometry.cjs";
import { compilePreset } from "../sheet/layer-compiler.js";

const {
  BASE_W, BASE_H, ANCHOR_KEYS, evenDown,
  anchorPosition, pickAnchor, isBottomAnchorIgnored, isBlendPositionIgnored, boxSize,
} = ComposerGeometry;

test("BASE_W/BASE_H khớp hằng số của layer-compiler.js", () => {
  assert.equal(BASE_W, 1280);
  assert.equal(BASE_H, 720);
});

test("ANCHOR_KEYS đủ 9 điểm, đúng thứ tự dùng cho tie-break", () => {
  assert.deepEqual(ANCHOR_KEYS, [
    "top-left", "top-center", "top-right",
    "middle-left", "center", "middle-right",
    "bottom-left", "bottom-center", "bottom-right",
  ]);
});

test("evenDown làm tròn xuống số chẵn, giữ nguyên số chẵn", () => {
  assert.equal(evenDown(101), 100);
  assert.equal(evenDown(100), 100);
  assert.equal(evenDown(2.4), 2);
});

// ── anchorPosition: vị trí SỐ của 9 điểm neo (dx=dy=0) ──────────────────────────────────────
test("anchorPosition tái tạo đúng 9 công thức số của ANCHORS (layer-compiler.js)", () => {
  const w = 400, h = 100, W = 1280, H = 720;
  assert.deepEqual(anchorPosition("top-left", w, h, 0, 0, W, H), { x: 0, y: 0 });
  assert.deepEqual(anchorPosition("top-center", w, h, 0, 0, W, H), { x: (W - w) / 2, y: 0 });
  assert.deepEqual(anchorPosition("top-right", w, h, 0, 0, W, H), { x: W - w, y: 0 });
  assert.deepEqual(anchorPosition("middle-left", w, h, 0, 0, W, H), { x: 0, y: (H - h) / 2 });
  assert.deepEqual(anchorPosition("center", w, h, 0, 0, W, H), { x: (W - w) / 2, y: (H - h) / 2 });
  assert.deepEqual(anchorPosition("middle-right", w, h, 0, 0, W, H), { x: W - w, y: (H - h) / 2 });
  assert.deepEqual(anchorPosition("bottom-left", w, h, 0, 0, W, H), { x: 0, y: H - h });
  assert.deepEqual(anchorPosition("bottom-center", w, h, 0, 0, W, H), { x: (W - w) / 2, y: H - h });
  assert.deepEqual(anchorPosition("bottom-right", w, h, 0, 0, W, H), { x: W - w, y: H - h });
});

test("anchorPosition cộng thêm dx/dy", () => {
  assert.deepEqual(anchorPosition("top-left", 100, 100, 5, -5, BASE_W, BASE_H), { x: 5, y: -5 });
});

// ── pickAnchor: hàm trung tâm của kéo thả ────────────────────────────────────────────────────
test("pickAnchor: thả sát đáy giữa khung ra bottom-center với dy nhỏ (không phải top-left dy to)", () => {
  // Lớp 400x100, thả ở x=440 (giữa khung theo chiều ngang: (1280-400)/2=440), y=615 (gần đáy:
  // đáy đúng chuẩn là 720-100=620, lệch 5px).
  const res = pickAnchor({ x: 440, y: 615, w: 400, h: 100, W: BASE_W, H: BASE_H });
  assert.equal(res.anchor, "bottom-center");
  assert.equal(res.dx, 0);
  assert.equal(res.dy, -5);
});

test("pickAnchor: thả đúng góc trên-trái ra top-left, dx/dy = 0", () => {
  const res = pickAnchor({ x: 0, y: 0, w: 200, h: 200, W: BASE_W, H: BASE_H });
  assert.deepEqual(res, { anchor: "top-left", dx: 0, dy: 0 });
});

test("pickAnchor: thả giữa khung tuyệt đối ra center, dx/dy = 0", () => {
  const w = 300, h = 150;
  const x = (BASE_W - w) / 2;
  const y = (BASE_H - h) / 2;
  const res = pickAnchor({ x, y, w, h, W: BASE_W, H: BASE_H });
  assert.deepEqual(res, { anchor: "center", dx: 0, dy: 0 });
});

test("pickAnchor: lớp phủ kín khung (w=W,h=H) thì mọi anchor hoà nhau — giữ anchor đầu tiên theo ANCHOR_KEYS (top-left)", () => {
  // w=W, h=H nên (W-w)/2 = W-w = 0 với mọi anchor ngang, tương tự chiều dọc — cả 9 công thức ra
  // đúng cùng điểm (0,0). Đây là ca "hoà nhau" mà comment ở pickAnchor nói tới.
  const res = pickAnchor({ x: 0, y: 0, w: BASE_W, h: BASE_H, W: BASE_W, H: BASE_H });
  assert.equal(res.anchor, "top-left");
  assert.equal(res.dx, 0);
  assert.equal(res.dy, 0);
});

test("pickAnchor: roundtrip với cả 9 anchor + dx/dy ngẫu nhiên phải cho lại đúng anchor gốc", () => {
  // Với mỗi anchor thật, sinh vị trí bằng anchorPosition rồi đưa NGƯỢC vào pickAnchor — phải ra
  // lại đúng anchor đó (không phải lân cận), vì đó chính xác là điểm gần nhất với neo mình xuất
  // phát từ. dx/dy nhỏ (trong khoảng an toàn, không chồng lấn công thức của anchor khác).
  const w = 200, h = 100;
  for (const anchor of ANCHOR_KEYS) {
    if (anchor === "center") continue; // trường hợp hoà nhau đặc biệt kiểm riêng ở test dưới.
    const dx = 3, dy = -2;
    const pos = anchorPosition(anchor, w, h, dx, dy, BASE_W, BASE_H);
    const res = pickAnchor({ x: pos.x, y: pos.y, w, h, W: BASE_W, H: BASE_H });
    assert.equal(res.anchor, anchor, `roundtrip lệch cho anchor ${anchor}`);
    assert.equal(res.dx, dx);
    assert.equal(res.dy, dy);
  }
});

// ── isBottomAnchorIgnored: KHÔNG ĐƯỢC NÓI DỐI so với compilePreset thật ─────────────────────
// Đây là test quan trọng nhất của file: dựng một preset 2 lớp (lớp dưới cùng theo từng cấu hình
// + đúng 1 lớp overlay để validatePreset không chặn), chạy compilePreset() THẬT, rồi kiểm filter
// graph có chèn node canvas đen "color=c=black:s=1280x720" hay không — đó chính là dấu hiệu
// compiler CÓ dùng đến anchor/dx/dy của lớp dưới cùng (xem C2 trong layer-compiler.js). So kết
// quả đó với isBottomAnchorIgnored() để chắc hai bên khớp nhau tuyệt đối; nếu composer-ui.js
// khoá/mở kéo theo hàm này mà nó lệch với compiler thật thì canvas "nói dối" đúng 3 trường hợp
// brief cấm.
function bottomLayerInsertsCanvas(bottomLayer) {
  const preset = {
    version: 1, layers: [
      bottomLayer,
      { id: "ov", source: { type: "overlay" }, geometry: { fit: "full" }, treatments: [], blend: "normal" },
    ],
  };
  const composed = compilePreset(preset);
  return composed.filterGraph.some((line) => line.includes("color=c=black:s=1280x720"));
}

test("isBottomAnchorIgnored khớp compilePreset thật: background/overlay fit full -> true, không chèn canvas", () => {
  const layer = { id: "bg", source: { type: "background" }, geometry: { fit: "full" }, treatments: [], blend: "normal" };
  assert.equal(isBottomAnchorIgnored(layer), true);
  assert.equal(bottomLayerInsertsCanvas(layer), false);
});

test("isBottomAnchorIgnored khớp compilePreset thật: background fit:none -> true (giả định toàn hệ thống), không chèn canvas", () => {
  const layer = { id: "bg", source: { type: "background" }, geometry: { fit: "none" }, treatments: [], blend: "normal" };
  assert.equal(isBottomAnchorIgnored(layer), true);
  assert.equal(bottomLayerInsertsCanvas(layer), false);
});

test("isBottomAnchorIgnored khớp compilePreset thật: image fit:none -> false (KHÔNG tin cậy, compiler CÓ chèn canvas + đọc anchor)", () => {
  const layer = { id: "img", source: { type: "image", path: "x.png" }, geometry: { fit: "none", anchor: "bottom-left" }, treatments: [], blend: "normal" };
  assert.equal(isBottomAnchorIgnored(layer), false);
  assert.equal(bottomLayerInsertsCanvas(layer), true);
});

test("isBottomAnchorIgnored khớp compilePreset thật: image fit:box nhỏ hơn khung -> false, có chèn canvas", () => {
  const layer = { id: "img", source: { type: "image", path: "x.png" }, geometry: { fit: "box", w: 400, h: 300, anchor: "bottom-left" }, treatments: [], blend: "normal" };
  assert.equal(isBottomAnchorIgnored(layer), false);
  assert.equal(bottomLayerInsertsCanvas(layer), true);
});

test("isBottomAnchorIgnored khớp compilePreset thật: image fit:box đúng 1280x720 -> true (trùng khung chuẩn), không chèn canvas", () => {
  const layer = { id: "img", source: { type: "image", path: "x.png" }, geometry: { fit: "box", w: 1280, h: 720 }, treatments: [], blend: "normal" };
  assert.equal(isBottomAnchorIgnored(layer), true);
  assert.equal(bottomLayerInsertsCanvas(layer), false);
});

test("isBottomAnchorIgnored khớp compilePreset thật: solid fit:box nhỏ -> false, có chèn canvas", () => {
  const layer = { id: "s", source: { type: "solid", color: "red" }, geometry: { fit: "box", w: 200, h: 200, anchor: "top-right" }, treatments: [], blend: "normal" };
  assert.equal(isBottomAnchorIgnored(layer), false);
  assert.equal(bottomLayerInsertsCanvas(layer), true);
});

// ── isBlendPositionIgnored ───────────────────────────────────────────────────────────────────
test("isBlendPositionIgnored: blend screen -> true, blend normal -> false", () => {
  assert.equal(isBlendPositionIgnored({ blend: "screen" }), true);
  assert.equal(isBlendPositionIgnored({ blend: "normal" }), false);
  assert.equal(isBlendPositionIgnored({}), false);
});

test("isBlendPositionIgnored khớp compilePreset thật: lớp trên cùng blend:screen thì đổi anchor không đổi filter graph", () => {
  const base = (anchor) => ({
    version: 1, layers: [
      { id: "bg", source: { type: "background" }, geometry: { fit: "full" }, treatments: [], blend: "normal" },
      { id: "ov", source: { type: "overlay" }, geometry: { fit: "full" }, treatments: [], blend: "normal" },
      { id: "fx", source: { type: "video", path: "x.mp4" }, geometry: { fit: "full", anchor }, treatments: [], blend: "screen" },
    ],
  });
  const g1 = compilePreset(base("top-left")).filterGraph.join(";");
  const g2 = compilePreset(base("bottom-right")).filterGraph.join(";");
  assert.equal(g1, g2, "blend:screen phải bỏ qua anchor -> đổi anchor không đổi graph");
});

// ── boxSize: kích thước hiển thị trên canvas (CÓ suy đoán xấp xỉ khi cần) ───────────────────
test("boxSize fit:full luôn ra đúng khung chuẩn, không xấp xỉ", () => {
  assert.deepEqual(boxSize({ fit: "full" }), { w: BASE_W, h: BASE_H, approx: false });
});

test("boxSize fit:scale tính đúng theo value, mặc định 0.85 khi thiếu/khỏi khoảng", () => {
  const r = boxSize({ fit: "scale", value: 0.5 });
  assert.equal(r.w, evenDown(BASE_W * 0.5));
  assert.equal(r.h, evenDown(BASE_H * 0.5));
  assert.equal(r.approx, false);
  const fallback = boxSize({ fit: "scale", value: 2 }); // ngoài (0,1] -> rơi về DEFAULT_SCALE
  assert.equal(fallback.w, evenDown(BASE_W * 0.85));
});

test("boxSize fit:box w:-2 không có ảnh mẫu -> đoán hình vuông, approx:true (KHÔNG được coi là chắc chắn)", () => {
  const r = boxSize({ fit: "box", w: -2, h: 300 });
  assert.equal(r.h, 300);
  assert.equal(r.w, 300);
  assert.equal(r.approx, true);
});

test("boxSize fit:box w:-2 có ảnh mẫu -> suy đúng theo tỉ lệ thật, approx:false", () => {
  const r = boxSize({ fit: "box", w: -2, h: 300 }, { naturalW: 1600, naturalH: 900 }); // tỉ lệ 16:9
  assert.equal(r.h, 300);
  assert.equal(r.w, evenDown(300 * (1600 / 900)));
  assert.equal(r.approx, false);
});

test("boxSize fit:none không có ảnh mẫu -> fallback khung chuẩn nhưng approx:true", () => {
  const r = boxSize({ fit: "none" });
  assert.deepEqual(r, { w: BASE_W, h: BASE_H, approx: true });
});
