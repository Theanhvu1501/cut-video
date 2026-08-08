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
