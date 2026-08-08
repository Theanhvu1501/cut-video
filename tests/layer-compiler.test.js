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
