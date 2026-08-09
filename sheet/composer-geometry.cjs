// composer-geometry.cjs — Giai đoạn 2B: hàm THUẦN (không đụng DOM, không đụng ffmpeg) cho việc
// kéo thả trên canvas. Đây là phần dễ sai nhất của canvas (biến toạ độ tuyệt đối người dùng vừa
// nhả chuột thành anchor/dx/dy đúng theo compiler), nên được TÁCH RIÊNG khỏi composer-ui.js để
// viết unit test không cần mở app (xem tests/composer-geometry.test.js).
//
// PHẢI dùng chung được ở CẢ HAI nơi:
//   1. composer-ui.js (trình duyệt/renderer) — nạp bằng <script> THƯỜNG, không phải
//      type="module" (lý do: file:// + module script có thể bị Chromium chặn CORS tuỳ cấu hình
//      webSecurity, xem comment đầu composer-ui.js). Một <script> thường không hiểu cú pháp
//      import/export — có thì trình duyệt ném lỗi cú pháp ngay khi tải và hỏng CẢ tab Composer.
//   2. tests/composer-geometry.test.js (Node, package.json khai "type": "module").
// Nên file này viết bằng cú pháp JS thuần (không import/export ES module), và tự nhận diện môi
// trường bằng `typeof module` — an toàn vì `typeof` trên một biến chưa khai báo không bao giờ
// ném ReferenceError, chỉ trả về chuỗi "undefined". Đặt đuôi .cjs (không phải .js) để Node LUÔN
// coi là CommonJS bất kể "type":"module" trong package.json (Node tự bọc file .cjs bằng hàm có
// sẵn module/exports/require, không cần cấu hình gì thêm) — nhờ vậy `import {...} from
// "../sheet/composer-geometry.cjs"` ở file test vẫn lấy được named export nhờ cơ chế suy named-
// export tĩnh của Node cho CJS (module.exports = { ... } dạng object literal).
(function (factory) {
  if (typeof module === "object" && module.exports) {
    // Node (CJS) — bao gồm cả khi Node ESM "import" file .cjs này.
    module.exports = factory();
  } else if (typeof window !== "undefined") {
    // Trình duyệt (renderer process của Electron) — gắn vào biến toàn cục để composer-ui.js
    // dùng qua window.ComposerGeometry, không cần import/export.
    window.ComposerGeometry = factory();
  }
})(function () {
  "use strict";

  // Phải khớp CHÍNH XÁC với sheet/layer-compiler.js — đây là hằng số MIRROR thủ công, cùng kiểu
  // đánh đổi mà composer-ui.js đã chấp nhận cho SOURCE_TYPES/FIT_MODES (xem comment đầu file đó)
  // và render-core.js đã chấp nhận cho evenDown(). Đổi bên layer-compiler.js thì phải sửa tay ở
  // đây theo, không có gì tự đồng bộ.
  const BASE_W = 1280;
  const BASE_H = 720;
  const DEFAULT_SCALE = 0.85;

  // Thứ tự PHẢI cố định: pickAnchor() so khoảng cách theo đúng thứ tự này và giữ anchor đầu
  // tiên khi có nhiều anchor đồng hạng (xem comment ở pickAnchor) — đổi thứ tự đổi luôn kết quả
  // hoà nhau, không phải chuyện vô hại.
  const ANCHOR_KEYS = [
    "top-left", "top-center", "top-right",
    "middle-left", "center", "middle-right",
    "bottom-left", "bottom-center", "bottom-right",
  ];

  // yuv420p cần chiều chẵn — mirror evenDown() của layer-compiler.js/render-core.js.
  function evenDown(value) {
    const n = Math.round(value);
    return n % 2 === 0 ? n : n - 1;
  }

  // Toạ độ SỐ của 9 điểm neo với dx=dy=0 — mirror bảng ANCHORS (chuỗi biểu thức ffmpeg) của
  // layer-compiler.js, nhưng thay W/H/w/h bằng số thật để vẽ lên canvas/so khoảng cách khi kéo.
  function anchorBasePosition(anchor, w, h, W, H) {
    switch (anchor) {
      case "top-left": return { x: 0, y: 0 };
      case "top-center": return { x: (W - w) / 2, y: 0 };
      case "top-right": return { x: W - w, y: 0 };
      case "middle-left": return { x: 0, y: (H - h) / 2 };
      case "middle-right": return { x: W - w, y: (H - h) / 2 };
      case "bottom-left": return { x: 0, y: H - h };
      case "bottom-center": return { x: (W - w) / 2, y: H - h };
      case "bottom-right": return { x: W - w, y: H - h };
      case "center":
      default:
        return { x: (W - w) / 2, y: (H - h) / 2 };
    }
  }

  // Vị trí SỐ thật của một lớp trên canvas: base(anchor) + dx/dy. Dùng để VẼ box lên canvas —
  // đối xứng với pickAnchor() (chiều ngược: từ số ra anchor+dx/dy).
  function anchorPosition(anchor, w, h, dx, dy, W, H) {
    const base = anchorBasePosition(anchor, w, h, W == null ? BASE_W : W, H == null ? BASE_H : H);
    return { x: base.x + (Number(dx) || 0), y: base.y + (Number(dy) || 0) };
  }

  // ĐÂY LÀ HÀM TRUNG TÂM của canvas kéo thả — biến toạ độ tuyệt đối (x,y = góc trên-trái của
  // lớp, theo hệ toạ độ 1280x720 gốc, KHÔNG phải toạ độ đã thu nhỏ trên màn hình) người dùng vừa
  // nhả chuột thành anchor + dx/dy, đúng quy tắc đã chốt trong thiết kế:
  //   1. Với cả 9 điểm neo, tính xem lớp sẽ nằm ở đâu nếu dùng neo đó với dx=dy=0.
  //   2. Chọn neo có khoảng cách Manhattan (|Δx|+|Δy|) nhỏ nhất tới (x,y) vừa nhả.
  //   3. Phần lệch còn lại (x,y trừ vị trí neo đã chọn) ghi vào dx/dy.
  // Nhờ vậy kéo sát đáy ra "bottom-*" với dy nhỏ, không phải "top-left" với dy to — compiler
  // dùng anchor làm biểu thức (0, (W-w)/2, W-w, H-h, …) nên phải giữ đúng ý định "dán sát đáy"
  // của người dùng, không phải toạ độ tuyệt đối cứng.
  //
  // Hoà nhau (nhiều anchor cùng khoảng cách nhỏ nhất, ví dụ lớp phủ kín khung thì cả 9 anchor
  // đều cho cùng một điểm): giữ anchor gặp TRƯỚC theo thứ tự ANCHOR_KEYS (top-left thắng) — cùng
  // kiểu quyết định tie-break tường minh mà layer-compiler.js đã áp dụng ở Task 1 (từ chối đoán
  // ngầm, chọn một quy tắc rõ ràng và giữ nguyên).
  function pickAnchor({ x, y, w, h, W, H } = {}) {
    const containerW = W == null ? BASE_W : W;
    const containerH = H == null ? BASE_H : H;
    let best = null;
    for (const anchor of ANCHOR_KEYS) {
      const base = anchorBasePosition(anchor, w, h, containerW, containerH);
      const dist = Math.abs(x - base.x) + Math.abs(y - base.y);
      if (best === null || dist < best.dist) {
        best = { anchor, dist, dx: x - base.x, dy: y - base.y };
      }
    }
    return { anchor: best.anchor, dx: Math.round(best.dx), dy: Math.round(best.dy) };
  }

  // Mirror CHÍNH XÁC các nhánh "biết trước kích thước" của scaleFilter() (layer-compiler.js) —
  // KHÔNG bao gồm suy đoán xấp xỉ nào. Dùng riêng cho isBottomAnchorIgnored() bên dưới, để tái
  // tạo đúng isTrustedFullFrame() — hàm quyết định compiler có ĐỌC anchor/dx/dy của lớp dưới
  // cùng hay không. boxSize() (bên dưới) là hàm KHÁC, dùng để VẼ lên canvas và CÓ suy đoán xấp
  // xỉ khi fit:"none" — trộn hai hàm này sẽ làm UI "nói dối" khác với compiler thật ở đúng chỗ
  // dễ sai nhất (lớp dưới cùng fit:"none" không phải background/overlay: compiler KHÔNG coi là
  // full-frame tin được, nhưng nếu boxSize() lỡ đoán ra đúng 1280x720 thì phép so "== BASE_W/H"
  // sẽ sai lầm coi lớp đó là bị bỏ qua anchor).
  function knownScaledSize(geometry) {
    const g = geometry || {};
    if (g.fit === "none") return { w: null, h: null }; // scaleFilter fit:"none" LUÔN null, không suy đoán.
    if (g.fit === "scale") {
      const raw = Number(g.value);
      const ratio = raw > 0 && raw <= 1 ? raw : DEFAULT_SCALE;
      return { w: Math.max(2, evenDown(BASE_W * ratio)), h: Math.max(2, evenDown(BASE_H * ratio)) };
    }
    if (g.fit === "box") {
      const h = Math.max(2, evenDown(Number(g.h) || BASE_H));
      if (Number(g.w) === -2) return { w: null, h };
      return { w: Math.max(2, evenDown(Number(g.w) || BASE_W)), h };
    }
    // fit "full" hoặc giá trị lạ: scaleFilter rơi về nhánh cuối (scale=1280:720) trong cả hai case.
    return { w: BASE_W, h: BASE_H };
  }

  // Mirror isTrustedFullFrame() của layer-compiler.js — quyết định lớp DƯỚI CÙNG (lớp đầu tiên
  // dựng được stage trong compilePreset) có bị compiler BỎ QUA anchor/dx/dy hay không. true =
  // "kéo lớp này trên canvas không có tác dụng gì với video render ra" — canvas PHẢI khoá kéo
  // và ghi rõ lý do, kéo được thì UI nói dối. Xem tests/composer-geometry.test.js: đối chiếu
  // trực tiếp với compilePreset() thật (không chỉ đoán) để đảm bảo hai bên không lệch nhau.
  function isBottomAnchorIgnored(layer) {
    const built = knownScaledSize(layer && layer.geometry);
    if (built.w === BASE_W && built.h === BASE_H) return true;
    const type = layer && layer.source && layer.source.type;
    return (built.w === null || built.h === null) && (type === "background" || type === "overlay");
  }

  // Mirror nhánh "blend === 'screen'" của compilePreset(): blend phủ toàn khung, không đọc
  // toạ độ — bất kỳ lớp nào (không chỉ lớp dưới cùng) đặt blend:"screen" đều bị bỏ qua anchor.
  function isBlendPositionIgnored(layer) {
    return Boolean(layer && layer.blend === "screen");
  }

  // Kích thước hiển thị TRÊN CANVAS (khác knownScaledSize ở trên): CÓ suy đoán xấp xỉ khi
  // compiler thật sự không biết trước (fit:"none" trên nguồn không phải background/overlay,
  // hoặc fit:"box" với w:-2 mà chưa có ảnh mẫu để suy tỉ lệ) — approx:true đánh dấu các trường
  // hợp đó để composer-ui.js vẽ viền nét đứt/nhãn "xấp xỉ", không vẽ như kích thước chắc chắn.
  // opts.naturalW/naturalH (tuỳ chọn) là kích thước thật của ảnh/khung hình mẫu đã tải, dùng để
  // suy chiều rộng khi w:-2 (giữ tỉ lệ gốc).
  function boxSize(geometry, opts) {
    const g = geometry || {};
    const naturalW = opts && opts.naturalW;
    const naturalH = opts && opts.naturalH;
    if (g.fit === "full") return { w: BASE_W, h: BASE_H, approx: false };
    if (g.fit === "scale") {
      const raw = Number(g.value);
      const ratio = raw > 0 && raw <= 1 ? raw : DEFAULT_SCALE;
      return { w: Math.max(2, evenDown(BASE_W * ratio)), h: Math.max(2, evenDown(BASE_H * ratio)), approx: false };
    }
    if (g.fit === "box") {
      const h = Math.max(2, evenDown(Number(g.h) || BASE_H));
      if (Number(g.w) === -2) {
        if (naturalW > 0 && naturalH > 0) {
          return { w: Math.max(2, evenDown(h * (naturalW / naturalH))), h, approx: false };
        }
        // Chưa có ảnh mẫu nào để suy tỉ lệ gốc — đoán hình vuông chỉ để có cái vẽ, KHÔNG BAO
        // GIỜ ghi số đoán này ngược lại vào preset.geometry.w (vẫn phải giữ -2, xem yêu cầu
        // "kéo chiều cao vẫn giữ w:-2" ở composer-ui.js).
        return { w: h, h, approx: true };
      }
      return { w: Math.max(2, evenDown(Number(g.w) || BASE_W)), h, approx: false };
    }
    // fit "none": compiler không scale gì cả — kích thước thật là kích thước NGUỒN. UI không tự
    // biết nguồn thật (đó là việc của composer-ui.js: nó biết source.type, ở đây hàm thuần này
    // không nhận layer đầy đủ, chỉ nhận geometry) nên trả về ước lượng theo ảnh mẫu nếu có, hoặc
    // fallback khung chuẩn — cả hai đều approx:true. composer-ui.js override cứng thành
    // {BASE_W,BASE_H,approx:false} riêng cho background/overlay (nơi TOÀN hệ thống đã tin tưởng
    // luôn là 1280x720, xem comment ở isTrustedFullFrame trong layer-compiler.js) trước khi gọi
    // hàm này, nên override đó không đi qua nhánh approx ở đây.
    if (naturalW > 0 && naturalH > 0) return { w: naturalW, h: naturalH, approx: true };
    return { w: BASE_W, h: BASE_H, approx: true };
  }

  return {
    BASE_W, BASE_H, ANCHOR_KEYS,
    evenDown, anchorPosition, pickAnchor,
    knownScaledSize, isBottomAnchorIgnored, isBlendPositionIgnored,
    boxSize,
  };
});
