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

// So theo đồ thị, bỏ qua 2 khác biệt CỐ Ý (shortest, toạ độ). Toạ độ overlay của lớp chồng
// CHÍNH (video gốc/dải cuối cùng của 4 trong 5 preset, cộng ảnh người/khung của crop và
// blurFrame) được kiểm riêng bằng assert tường minh ở các test bên dưới — ĐỦ để bỏ qua ở đây
// không tạo lỗ hổng cho NHỮNG lớp đó. Dải đen (solid) của keepColor thì KHÔNG nằm trong số
// đó: nó là lớp mới hoàn toàn, không có mode cũ nào để so kích thước/vị trí/thứ tự — reviewer
// từng đổi hẳn geometry của nó (kích thước, neo) mà mọi test composer vẫn xanh cho tới khi có
// test "preset keepColor NGUYÊN BẢN" riêng bên dưới. Không có test đó thì ignoreOverlayCoords
// ở đây làm mờ luôn dải đen.
const sameGraph = (a, b) => {
  const opts = { ignoreShortest: true, ignoreOverlayCoords: true };
  assert.equal(canonicalGraph(a, opts), canonicalGraph(b, opts));
};

// evenDown cục bộ, khớp evenDown trong layer-compiler.js/render-core.js (round rồi làm
// tròn xuống số chẵn) — dùng để kiểm công thức personGeometry cũ mà không cần import hàm
// private của 2 module đó.
const evenDown = (value) => {
  const n = Math.round(value);
  return n % 2 === 0 ? n : n - 1;
};

test("cả 5 preset dựng sẵn đều hợp lệ", () => {
  for (const n of ["topTransparent", "chromaKey", "crop", "keepColor", "blurFrame"]) {
    const r = validatePreset(load(n));
    assert.equal(r.ok, true, `${n}: ${r.errors.join("; ")}`);
  }
});

test("preset topTransparent tương đương mode topTransparent", () => {
  const p = load("topTransparent");
  const op = p.layers.find((l) => l.source.type === "background").treatments.find((t) => t.kind === "opacity");
  // Pin giá trị ship: 0.9 là con số preset THẬT dùng, không phải test tự chọn. sameGraph ở
  // dưới chỉ so CẤU TRÚC nên không tự bắt được việc opacity ship bị sửa sai số — phải ghim
  // tường minh ở đây, rồi mới suy cfg TỪ chính giá trị đã ghim để feed cho code cũ.
  assert.equal(op.value, 0.9, "opacity của lớp nền trong preset ship phải là 0.9");
  sameGraph(compilePreset(p).filterGraph, buildComplexFilter("topTransparent", { opacity: op.value }));
});

test("preset topTransparent giữ đúng thứ tự đảo: nền nằm TRÊN video gốc", () => {
  const p = load("topTransparent");
  assert.equal(p.layers[0].source.type, "overlay");
  assert.equal(p.layers[1].source.type, "background");
});

test("preset chromaKey tương đương mode chromaKey", () => {
  const p = load("chromaKey");
  const ck = p.layers.find((l) => l.source.type === "overlay").treatments.find((t) => t.kind === "chromakey");
  // Pin giá trị ship — lý do xem comment ở test topTransparent.
  assert.equal(ck.color, "D4F9D7", "color chromakey trong preset ship phải là D4F9D7");
  assert.equal(ck.similarity, 0.3, "similarity chromakey trong preset ship phải là 0.3");
  const cfg = { chromaColor: ck.color, chromaSimilarity: ck.similarity };
  sameGraph(compilePreset(p).filterGraph, buildComplexFilter("chromaKey", cfg));
});

test("preset crop tương đương mode crop (không có ảnh người)", () => {
  const p = load("crop");
  p.layers = p.layers.filter((l) => l.source.type !== "image");
  const strip = p.layers.find((l) => l.source.type === "overlay").treatments.find((t) => t.kind === "cropStrip");
  // Pin giá trị ship — lý do xem comment ở test topTransparent.
  assert.equal(strip.height, 220, "cropStrip.height trong preset ship phải là 220");
  assert.equal(strip.yOffset, 490, "cropStrip.yOffset trong preset ship phải là 490");
  // Suy cfg TỪ preset ship, không ghi đè preset cho khớp cfg: giá trị ship chính là thứ
  // được thi hành qua compilePreset lẫn buildComplexFilter.
  const cfg = { cropHeight: strip.height, cropYOffset: strip.yOffset };
  sameGraph(compilePreset(p).filterGraph, buildComplexFilter("crop", cfg));
});

test("preset crop tương đương mode crop (CÓ ảnh người)", () => {
  const p = load("crop");
  const strip = p.layers.find((l) => l.source.type === "overlay").treatments.find((t) => t.kind === "cropStrip");
  const cfg = {
    cropHeight: strip.height, cropYOffset: strip.yOffset,
    personEnabled: true, personFile: "ng.png", personPos: "center", personScale: 0.9,
  };
  const person = p.layers.find((l) => l.source.type === "image");
  person.source.path = cfg.personFile;
  // anchor "bottom-center" phải khớp personPos "center" (personOverlayX("center") cũng ra
  // "(W-w)/2") — đây là giá trị THẬT preset ship, không ghi đè, không tự mâu thuẫn với cfg
  // như bản trước (anchor bottom-left + personPos center).
  assert.equal(person.geometry.anchor, "bottom-center");
  // h/dy là 2 giá trị DUY NHẤT được phép suy ra từ cfg thay vì đọc thẳng từ ship, vì chúng
  // phụ thuộc cropHeight/personScale. Trước khi dùng, assert số ship khớp ĐÚNG công thức
  // personGeometry cũ — nếu không, JSON và công thức có thể lệch nhau mà không ai biết.
  const expectH = evenDown(cfg.personScale * (720 - cfg.cropHeight));
  assert.equal(person.geometry.h, expectH, "h của lớp người trong preset ship phải khớp personGeometry cũ");
  assert.equal(person.geometry.dy, -cfg.cropHeight, "dy của lớp người trong preset ship phải khớp personGeometry cũ");
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

  // personPos: "center" khớp đúng anchor "bottom-center" mà preset THẬT đang ship — dùng
  // NGUYÊN geometry ship (không ghi đè gì ngoài đường dẫn ảnh), nên phần x khớp NGUYÊN VĂN
  // với code cũ ("(W-w)/2" cả hai bên), chỉ phần y khác dạng (biểu thức so với số).
  const cfgCenter = { ...cfg, personPos: "center" };
  const oldCenter = buildComplexFilter("crop", cfgCenter).join("|");
  assert.match(oldCenter, /overlay=\(W-w\)\/2:50/);

  const pCenter = load("crop");
  pCenter.layers.find((l) => l.source.type === "image").source.path = "ng.png";
  const nowCenter = compilePreset(pCenter).filterGraph.join("|");
  assert.match(nowCenter, /overlay=\(W-w\)\/2:H-h-220:shortest=1/);
});

test("preset keepColor tương đương mode keepColor (không bật lớp nền tối)", () => {
  const p = load("keepColor");
  p.layers = p.layers.filter((l) => l.source.type !== "solid");
  const ovl = p.layers.find((l) => l.source.type === "overlay");
  const strip = ovl.treatments.find((t) => t.kind === "cropStrip");
  const keep = ovl.treatments.find((t) => t.kind === "keepColors");
  // Pin giá trị ship: cấu hình 1 màu FBFF02 là thứ preset THẬT đang chạy, không phải kịch
  // bản test tự dựng. Xem comment ở test topTransparent về lý do cần pin song song sameGraph.
  assert.deepEqual(keep.colors, ["FBFF02"], "colors của keepColor trong preset ship phải là [FBFF02]");
  assert.equal(keep.similarity, 0.2, "similarity của keepColor trong preset ship phải là 0.2");
  assert.equal(strip.height, 220, "cropStrip.height trong preset ship phải là 220");
  assert.equal(strip.yOffset, 490, "cropStrip.yOffset trong preset ship phải là 490");
  // Suy cfg TỪ preset ship — không thay cả mảng treatments bằng kịch bản khác như trước.
  const cfg = {
    keepColors: keep.colors, keepSimilarity: keep.similarity,
    keepCrop: true, keepHeight: strip.height, keepYOffset: strip.yOffset,
    keepAddDarkLayer: false,
  };
  sameGraph(compilePreset(p).filterGraph, buildComplexFilter("keepColor", cfg));
});

test("keepColor 2 màu (kịch bản dựng RIÊNG cho test, không phải preset ship) vẫn tương đương code cũ", () => {
  // Preset ship chỉ có 1 màu nên không bao giờ chạm nhánh blend=all_expr='max(A,B)' (chỉ
  // xuất hiện khi có từ 2 màu trở lên). Dựng riêng một biến thể 2 màu ở đây để phủ nhánh
  // đó — đây KHÔNG phải giá trị ship, chỉ là ca kiểm thêm cho compiler.
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
  // C1: solid phát color= thành node nguồn trong filter_complex, không còn chiếm input phụ
  // (xem sheet/layer-compiler.js) — extraInputs phải rỗng, và câu lệnh color= nằm trong
  // filterGraph.
  assert.deepEqual(r.extraInputs, []);
  assert.match(r.filterGraph.join("|"), /color=c=black/);
  // Bản gốc dựng khối đen bằng geq trên bản copy video gốc; compiler không dùng geq.
  assert.doesNotMatch(r.filterGraph.join("|"), /geq=/);
});

test("preset keepColor NGUYÊN BẢN: dải đen ghim đúng kích thước/vị trí, chồng DƯỚI dải giữ màu", () => {
  // sameGraph ở các test khác XOÁ HẲN lớp solid rồi so phần còn lại, và test "dùng lớp solid
  // thay geq" ở trên chỉ khẳng định CÓ input color=c=black — không gì khẳng định kích thước,
  // vị trí, hay thứ tự chồng của dải đen. Reviewer chứng minh: đổi solid.geometry từ
  // {fit:"box",w:1280,h:220,anchor:"bottom-left"} thành {fit:"box",w:640,h:700,anchor:"center"}
  // — phá hoàn toàn bố cục — mà 104 test composer vẫn xanh. Test này lấy preset NGUYÊN VẸN,
  // không xoá lớp nào, để đóng đúng lỗ đó.
  const p = load("keepColor");
  const solid = p.layers.find((l) => l.source.type === "solid");
  const ovl = p.layers.find((l) => l.source.type === "overlay");
  const strip = ovl.treatments.find((t) => t.kind === "cropStrip");

  // Code cũ dùng CHUNG một giá trị keepHeight cho cả chiều cao dải đen lẫn chiều cao vùng
  // cắt; preset có HAI số độc lập (solid.geometry.h và cropStrip.height) nên chúng có thể
  // lệch nhau âm thầm nếu ai sửa một bên mà quên bên kia. assert.equal ở đây SUY 220 ra từ
  // cropStrip.height — không gán cứng — để chính assert này tự lệch theo nếu preset ship đổi.
  assert.equal(solid.geometry.h, strip.height, "chiều cao dải đen (solid.h) phải khớp cropStrip.height của preset ship");
  assert.equal(solid.geometry.w, 1280, "chiều rộng dải đen phải phủ hết khung 1280");
  assert.equal(solid.geometry.anchor, "bottom-left", "dải đen phải dán sát đáy, cùng phía với dải giữ màu");

  const r = compilePreset(p);
  // C1: không còn extraInputs[0].lavfi — solid giờ là node nguồn trong filterGraph, không
  // phải input phụ (xem sheet/layer-compiler.js).
  assert.match(
    r.filterGraph.join("|"),
    new RegExp(`color=c=black:s=1280x${strip.height}:r=30\\[cl\\d+\\]`),
    "câu lệnh sinh dải đen phải đúng kích thước ghim trong preset ship (suy từ cropStrip.height)"
  );

  // Cả dải đen lẫn dải giữ màu đều neo bottom-left trên khung full nên RA CÙNG một chuỗi
  // overlay=0:H-h:shortest=1 — phải có ĐÚNG 2 bước chồng dạng này, không hơn không kém.
  const overlaySteps = r.filterGraph.filter((s) => s.includes("overlay=0:H-h:shortest=1"));
  assert.equal(overlaySteps.length, 2, "phải có đúng 2 bước chồng overlay=0:H-h:shortest=1: dải đen và dải giữ màu");

  // Thứ tự: dải đen phải chồng lên NỀN trước (nó ở DƯỚI), rồi dải giữ màu mới chồng lên trên
  // cùng (bước chồng CUỐI, ra [combined_video]) — khớp bảng preset ở spec: "solid đen neo
  // bottom-left -> overlay + cropStrip + keepColors, neo bottom-left".
  const darkOverlayLine = r.filterGraph.find((s) => /^\[0:v\]\[cl\d+\]overlay=0:H-h:shortest=1\[cl\d+\]$/.test(s));
  assert.ok(darkOverlayLine, "bước chồng dải đen phải nhận input trực tiếp từ [0:v] (nền)");
  const darkOutLabel = darkOverlayLine.match(/overlay=0:H-h:shortest=1\[(cl\d+)\]$/)[1];
  const finalOverlayLine = r.filterGraph.find((s) => s.endsWith("overlay=0:H-h:shortest=1[combined_video]"));
  assert.ok(finalOverlayLine, "bước chồng cuối cùng (ra [combined_video]) phải là bước chồng dải giữ màu");
  assert.ok(
    finalOverlayLine.startsWith(`[${darkOutLabel}]`),
    "bước chồng cuối (dải giữ màu) phải nhận stage TỪ bước chồng dải đen — tức dải đen nằm DƯỚI dải giữ màu"
  );
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

test("toạ độ blurFrame: biểu thức của compiler bằng số của code cũ", () => {
  // frameGeometry(0.85): w = evenDown(1280*0.85) = 1088, h = evenDown(720*0.85) = 612
  //                      x = round((1280-1088)/2) = 96, y = round((720-612)/2) = 54
  // frameOverlayGeometry(0.85, 1) cho cùng kích thước nên cùng toạ độ.
  const cfg = {
    bgBlurEnabled: true, bgBlur: 20, mainScale: 0.85, mainOpacity: 0.85,
    frameEnabled: true, frameFile: "khung.png", frameScale: 1,
    effectEnabled: true, effectFile: "fx.mp4", effectOpacity: 0.15, effectBlend: "screen",
  };
  const old = buildComplexFilter("blurFrame", cfg).join("|");
  // Code cũ đặt cả lớp video gốc và lớp khung ở đúng toạ độ số này.
  assert.equal((old.match(/overlay=96:54/g) || []).length, 2);

  const p = load("blurFrame");
  p.layers.find((l) => l.source.type === "image").source.path = cfg.frameFile;
  p.layers.find((l) => l.source.type === "video").source.path = cfg.effectFile;
  const now = compilePreset(p).filterGraph.join("|");
  assert.equal((now.match(/overlay=\(W-w\)\/2:\(H-h\)\/2/g) || []).length, 2);

  // Bằng nhau về số: đây là toàn bộ lý do được phép bỏ qua toạ độ khi so DAG.
  assert.equal((1280 - 1088) / 2, 96);
  assert.equal((720 - 612) / 2, 54);
});

test("toạ độ lớp chồng chính của 4 preset còn lại: khớp nguyên văn code cũ", () => {
  // Bốn chỗ này code cũ và compiler ra chuỗi GIỐNG HỆT, khác duy nhất :shortest=1 — nên
  // assert nguyên văn được, không cần suy luận số như blurFrame. Không có assert này thì
  // ignoreOverlayCoords làm mờ luôn chúng và anchor sai sẽ không ai bắt.

  // topTransparent: nền chồng lên video gốc ở góc trên trái.
  {
    const p = load("topTransparent");
    const op = p.layers.find((l) => l.source.type === "background")
      .treatments.find((t) => t.kind === "opacity");
    const old = buildComplexFilter("topTransparent", { opacity: op.value }).join("|");
    assert.match(old, /overlay=0:0\[combined_video\]/);
    assert.match(compilePreset(p).filterGraph.join("|"), /overlay=0:0:shortest=1\[combined_video\]/);
  }

  // chromaKey: video gốc dán sát đáy.
  {
    const p = load("chromaKey");
    const ck = p.layers.find((l) => l.source.type === "overlay")
      .treatments.find((t) => t.kind === "chromakey");
    const old = buildComplexFilter("chromaKey", {
      chromaColor: ck.color, chromaSimilarity: ck.similarity,
    }).join("|");
    assert.match(old, /overlay=0:H-h\[combined_video\]/);
    assert.match(compilePreset(p).filterGraph.join("|"), /overlay=0:H-h:shortest=1\[combined_video\]/);
  }

  // crop: dải crop là lớp CUỐI (nó chứa phụ đề nên không được để ảnh che), dán sát đáy.
  {
    const p = load("crop");
    p.layers = p.layers.filter((l) => l.source.type !== "image");
    const strip = p.layers.find((l) => l.source.type === "overlay")
      .treatments.find((t) => t.kind === "cropStrip");
    const old = buildComplexFilter("crop", {
      cropHeight: strip.height, cropYOffset: strip.yOffset,
    }).join("|");
    assert.match(old, /overlay=0:H-h\[combined_video\]/);
    assert.match(compilePreset(p).filterGraph.join("|"), /overlay=0:H-h:shortest=1\[combined_video\]/);
  }

  // keepColor: lớp giữ màu dán sát đáy. Code cũ ở đây ĐÃ có shortest=1 nên khớp trọn vẹn.
  {
    const p = load("keepColor");
    p.layers = p.layers.filter((l) => l.source.type !== "solid");
    const ovl = p.layers.find((l) => l.source.type === "overlay");
    const strip = ovl.treatments.find((t) => t.kind === "cropStrip");
    const keep = ovl.treatments.find((t) => t.kind === "keepColors");
    const old = buildComplexFilter("keepColor", {
      keepColors: keep.colors, keepSimilarity: keep.similarity, keepCrop: true,
      keepHeight: strip.height, keepYOffset: strip.yOffset, keepAddDarkLayer: false,
    }).join("|");
    assert.match(old, /overlay=0:H-h:shortest=1\[combined_video\]/);
    assert.match(compilePreset(p).filterGraph.join("|"), /overlay=0:H-h:shortest=1\[combined_video\]/);
  }
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

test("C2: lớp dưới cùng KHÔNG phải 1280x720 → compiler tự chèn canvas nền đen cố định khung", () => {
  // Kịch bản UI kéo thả: một lớp nhỏ (solid 400x300) bị kéo xuống dưới cùng. Không chèn
  // canvas thì video ra sai kích thước — lỗi THẬT đã gặp khi render (1280x190 thay vì
  // 1280x720), xem comment ở isTrustedFullFrame trong sheet/layer-compiler.js.
  const p = {
    layers: [
      {
        id: "small", label: "Lớp nhỏ dưới cùng", source: { type: "solid", color: "red" },
        geometry: { fit: "box", w: 400, h: 300, anchor: "top-left" }, treatments: [],
      },
      { id: "ov", label: "Video gốc", source: { type: "overlay" }, geometry: { fit: "full" }, treatments: [] },
    ],
  };
  const r = compilePreset(p);

  const canvasLine = r.filterGraph.find((s) => /^color=c=black:s=1280x720:r=30\[cl\d+\]$/.test(s));
  assert.ok(canvasLine, "phải có node canvas nền đen 1280x720 làm khung cố định");
  const canvasLabel = canvasLine.match(/\[(cl\d+)\]$/)[1];

  // Lớp nhỏ dưới cùng phải chồng lên ĐÚNG canvas đó, tại anchor "top-left" (0,0) của chính nó.
  const baseOverlay = r.filterGraph.find(
    (s) => s.startsWith(`[${canvasLabel}]`) && s.includes("overlay=0:0:shortest=1")
  );
  assert.ok(baseOverlay, "lớp nhỏ dưới cùng phải chồng lên canvas tại đúng anchor của chính nó");
  const stageLabel = baseOverlay.match(/\[(cl\d+)\]$/)[1];

  // Video gốc (lớp thứ hai) phải chồng TIẾP lên kết quả đã cố định khung đó, không phải
  // chồng thẳng lên lớp nhỏ.
  const finalOverlay = r.filterGraph.find((s) => s.endsWith("[combined_video]"));
  assert.ok(
    finalOverlay.startsWith(`[${stageLabel}]`),
    "video gốc phải chồng lên khung đã cố định kích thước, không phải lên lớp nhỏ trực tiếp"
  );
});

test("C2: lớp dưới cùng ĐÃ đúng 1280x720 (kể cả background fit:\"none\") → không chèn canvas thừa", () => {
  // Cả 5 preset dựng sẵn đều có lớp dưới cùng full-frame — 3 trong số đó (chromaKey, crop,
  // keepColor) dùng background với fit:"none" (w/h null ở scaleFilter). Đây chính là trường
  // hợp isTrustedFullFrame phải nhận diện là "đã đủ khung" để KHÔNG chèn canvas — không thì
  // 15 test hồi quy phía trên đã đỏ ngay từ nhánh C2 này.
  for (const name of ["topTransparent", "chromaKey", "crop", "keepColor", "blurFrame"]) {
    const r = compilePreset(load(name));
    assert.doesNotMatch(
      r.filterGraph.join("|"),
      /color=c=black:s=1280x720:r=30/,
      `${name}: không được chèn canvas 1280x720 thừa (lớp dưới cùng vốn đã đủ khung)`
    );
  }
});

test("3 preset của mode chưa có shortest=1 thì preset PHẢI có — khác biệt cố ý", () => {
  for (const n of ["topTransparent", "chromaKey", "crop"]) {
    const old = buildComplexFilter(n, {}).join("|");
    assert.doesNotMatch(old, /shortest=1/, `${n}: mode cũ lẽ ra không có shortest`);
    const steps = compilePreset(load(n)).filterGraph.filter((s) => s.includes("overlay="));
    for (const s of steps) assert.match(s, /:shortest=1/, `${n}: preset phải có shortest=1`);
  }
});
