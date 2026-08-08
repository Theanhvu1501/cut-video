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

test("canonicalGraph phá tie bằng lookahead downstream, không phụ thuộc thứ tự mảng gốc", () => {
  // Counterexample của reviewer: hai câu lệnh "copy" cùng filter, cùng input [0:v] — trùng
  // sort key nếu chỉ nhìn filter+input. Chỉ đổi chỗ 2 dòng đầu (case1 vs case2), đồ thị với
  // ffmpeg là MỘT (x luôn đi vào negate, y luôn đi vào hflip). Nếu tie rơi về vị trí mảng
  // gốc thì case1 và case2 ra hai chuỗi chuẩn khác nhau — false positive.
  const case1 = [
    "[0:v]copy[x]", "[0:v]copy[y]",
    "[x]negate[out1]", "[y]hflip[out2]",
    "[out1][out2]overlay=0:0[combined_video]",
  ];
  const case2 = [
    "[0:v]copy[y]", "[0:v]copy[x]",
    "[x]negate[out1]", "[y]hflip[out2]",
    "[out1][out2]overlay=0:0[combined_video]",
  ];
  assert.equal(canonicalGraph(case1), canonicalGraph(case2));
});

test("canonicalGraph ném lỗi khi có nhánh đối xứng thật, không đoán", () => {
  // Hai nhánh cùng filter, cùng input, consumer cũng cùng filter: sau lookahead một tầng
  // vẫn trùng key hoàn toàn — không còn thông tin cấu trúc nào phân biệt được x với y.
  // Phải ném lỗi, không được đoán rồi coi là bằng nhau.
  const g = [
    "[0:v]copy[x]", "[0:v]copy[y]",
    "[x]negate[out1]", "[y]negate[out2]",
    "[out1][out2]overlay=0:0[combined_video]",
  ];
  assert.throws(() => canonicalGraph(g), /nhánh đối xứng/);
});
