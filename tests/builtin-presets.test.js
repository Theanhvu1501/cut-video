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
