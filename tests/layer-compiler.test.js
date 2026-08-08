import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorExpr, scaleFilter, ANCHORS, buildLayerChain, TREATMENT_KINDS, validatePreset, SOURCE_TYPES, compilePreset } from "../sheet/layer-compiler.js";
import { canonicalGraph } from "./graph-dag.js";

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

test("scaleFilter fit=none không sinh bước scale nào", () => {
  // Cần cho lớp nền của chromaKey/crop/keepColor: code cũ chồng thẳng lên [0:v].
  assert.deepEqual(scaleFilter({ fit: "none" }), { filter: "", w: null, h: null });
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

test("buildLayerChain với fit=none và không treatment thì không sinh câu lệnh nào", () => {
  const r = buildLayerChain({ geometry: { fit: "none" }, treatments: [] }, "0:v", labeller());
  assert.deepEqual(r.statements, []);
  assert.equal(r.outLabel, "0:v");
});

test("buildLayerChain với fit=none vẫn áp được treatment", () => {
  const r = buildLayerChain(
    { geometry: { fit: "none" }, treatments: [{ kind: "blur", sigma: 20 }] }, "0:v", labeller()
  );
  assert.deepEqual(r.statements, ["[0:v]gblur=sigma=20[t0]"]);
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

test("validatePreset không ném lỗi khi source.type không chuyển được thành chuỗi", () => {
  const p = {
    version: 1, name: "x",
    layers: [
      { id: "l1", source: { type: Symbol("x") } },
      { id: "l2", source: { type: "overlay" }, geometry: { fit: "full" } },
    ],
  };
  let r;
  assert.doesNotThrow(() => { r = validatePreset(p); });
  assert.equal(r.ok, false);
  assert.ok(r.errors.every((e) => typeof e === "string"));
});

test("validatePreset bắt trùng id kể cả khi id là chuỗi rỗng hoặc số 0", () => {
  const blank = {
    version: 1, name: "x",
    layers: [
      { id: "", source: { type: "background" }, geometry: { fit: "full" } },
      { id: "", source: { type: "overlay" }, geometry: { fit: "full" } },
    ],
  };
  const r1 = validatePreset(blank);
  assert.equal(r1.ok, false);
  assert.match(r1.errors.join("|"), /id lớp bị trùng/);

  const zero = {
    version: 1, name: "x",
    layers: [
      { id: 0, source: { type: "background" }, geometry: { fit: "full" } },
      { id: 0, source: { type: "overlay" }, geometry: { fit: "full" } },
    ],
  };
  assert.equal(validatePreset(zero).ok, false);

  // Lớp KHÔNG đặt id thì vẫn không bị coi là trùng nhau.
  const noId = {
    version: 1, name: "x",
    layers: [
      { source: { type: "background" }, geometry: { fit: "full" } },
      { source: { type: "overlay" }, geometry: { fit: "full" } },
    ],
  };
  assert.equal(validatePreset(noId).ok, true);
});

const bg = { id: "bg", source: { type: "background" }, geometry: { fit: "full" } };
const ov = { id: "ov", source: { type: "overlay" }, geometry: { fit: "full" } };

test("compilePreset: nền dưới, video gốc trên, không input phụ", () => {
  // anchor khai TƯỜNG MINH: test này nói về thứ tự lớp, không được ngầm phụ thuộc giá trị
  // mặc định của anchor (có test riêng bên dưới lo việc đó).
  const r = compilePreset({
    layers: [bg, { ...ov, geometry: { fit: "full", anchor: "top-left" } }],
  });
  assert.deepEqual(r.extraInputs, []);
  const joined = r.filterGraph.join("|");
  assert.match(joined, /\[0:v\]scale=1280:720/);
  assert.match(joined, /\[1:v\]scale=1280:720/);
  assert.match(joined, /overlay=0:0:shortest=1\[combined_video\]/);
  assert.ok(r.filterGraph.includes("[1:a]volume=1.0[overlay_audio]"));
});

test("compilePreset: lớp không khai anchor thì rơi về center, đúng như anchorExpr", () => {
  // anchorExpr coi mọi giá trị ngoài 9 điểm neo (kể cả undefined) là center — hành vi đã
  // chốt ở Task 2. Với lớp phủ kín khung thì (W-w)/2 = 0 nên kết quả SỐ vẫn là 0:0, chỉ
  // khác chuỗi; preset nào cần đúng chuỗi "0:0" thì khai anchor: "top-left".
  const r = compilePreset({ layers: [bg, { ...ov, geometry: { fit: "full" } }] });
  assert.match(r.filterGraph.join("|"), /overlay=\(W-w\)\/2:\(H-h\)\/2:shortest=1/);
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

test("compilePreset: waveform là lớp duy nhất vẫn ra đúng [combined_video]", () => {
  // Hợp đồng phải đúng về cấu trúc, không phụ thuộc lớp nào đi đường riêng: waveform đẩy
  // câu lệnh thẳng vào filterGraph nên nếu không chèn bước copy thì graph thiếu nhãn cuối.
  const r = compilePreset({
    layers: [{ id: "w", source: { type: "waveform" }, geometry: { fit: "box", w: 480, h: 120 } }],
  });
  const joined = r.filterGraph.join("|");
  assert.equal((joined.match(/\[combined_video\]/g) || []).length, 1);
  assert.doesNotThrow(() => canonicalGraph(r.filterGraph));
});

test("compilePreset: không lớp nào dựng được hình thì có cảnh báo rõ ràng", () => {
  const r = compilePreset({
    layers: [{ id: "a", source: { type: "image", path: "" }, geometry: { fit: "full" } }],
  });
  assert.match(r.warnings.join("|"), /không có lớp nào dựng được hình/);
});
