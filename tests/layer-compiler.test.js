import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorExpr, scaleFilter, ANCHORS, buildLayerChain, TREATMENT_KINDS } from "../sheet/layer-compiler.js";

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
    "[1:v]scale=1280:720,split=3[t0][t1][t2]",
    "[t1]colorkey=0xFBFF02:0.2:0.1,alphaextract,negate[t3]",
    "[t2]colorkey=0xFF0000:0.2:0.1,alphaextract,negate[t4]",
    "[t3][t4]blend=all_expr='max(A,B)'[t5]",
    "[t0][t5]alphamerge[t6]",
  ]);
  assert.equal(r.outLabel, "t6");
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
    "[1:v]scale=1280:720,split=2[t0][t1]",
    "[t1]colorkey=0xFBFF02:0.2:0.1,alphaextract,negate[t2]",
    "[t0][t2]alphamerge[t3]",
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
