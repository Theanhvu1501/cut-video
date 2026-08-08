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
