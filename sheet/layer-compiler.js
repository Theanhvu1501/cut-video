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
    if (!SOURCE_TYPES.includes(type)) {
      // String(type) để không ném TypeError nếu type là Symbol hay giá trị không convert được thành chuỗi.
      // Hàm này PHẢI luôn trả { ok, errors }, không được ném lỗi làm chết cả mẻ render.
      errors.push(`loại nguồn không hợp lệ: ${String(type)}`);
    }
    if (BOX_ONLY.has(type) && l?.geometry?.fit !== "box") {
      errors.push(`lớp ${type} buộc dùng fit: "box" vì kích thước nằm trong tham số sinh nguồn`);
    }
    const id = l?.id;
    // id !== undefined để bắt cả giá trị falsy như "" (chuỗi rỗng) và 0 nếu chúng có mặt thực sự.
    // Nếu dùng if (id) thì "" và 0 bị bỏ qua như không có id, nên hai lớp cùng id: "" vẫn lọt qua.
    if (id !== undefined) {
      if (seen.has(id)) {
        // String(id) cùng lý do: bảo vệ khỏi Symbol và giá trị anormal.
        errors.push(`id lớp bị trùng: ${String(id)}`);
      }
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

// Chỉ số input là hợp đồng cứng với renderOne: [0] = nền, [1] = video gốc. Input phụ bắt
// đầu từ [2] và phải khớp đúng thứ tự extraInputs trả về.
const FIRST_EXTRA_INPUT = 2;

// Cấp input và sinh [n:v] trong CÙNG một vòng lặp: đây là lý do blurFrameLayers() phải
// tồn tại trong code cũ. Làm trong một vòng thì không có đường nào lệch chỉ số.
export function compilePreset(preset) {
  const layers = Array.isArray(preset?.layers) ? preset.layers : [];
  const extraInputs = [];
  const warnings = [];
  const filterGraph = [];

  let labelSeq = 0;
  const nextLabel = () => `cl${labelSeq++}`;

  // Lớp waveform lấy tiếng từ chính luồng đang dùng làm audio đầu ra, nên phải asplit.
  const hasWaveform = layers.some((l) => l?.source?.type === "waveform");
  const audioSource = hasWaveform ? "cl_a_out" : "1:a";
  if (hasWaveform) filterGraph.push("[1:a]asplit=2[cl_a_out][cl_a_wave]");

  // Nhãn nguồn video của một lớp; trả về null nghĩa là bỏ lớp này.
  const sourceLabel = (layer) => {
    const src = layer?.source || {};
    switch (src.type) {
      case "background":
        return "0:v";
      case "overlay":
        return "1:v";
      case "image":
      case "video": {
        if (!src.path) {
          warnings.push(
            `⚠️ Lớp "${layer.label || layer.id || src.type}" không có đường dẫn hợp lệ — bỏ qua lớp này`
          );
          return null;
        }
        const idx = FIRST_EXTRA_INPUT + extraInputs.length;
        extraInputs.push({
          file: src.path,
          // Ảnh tĩnh phải -loop 1, nếu không chỉ khung hình đầu tiên có ảnh.
          inputOptions: src.type === "image" ? ["-loop", "1"] : ["-stream_loop", "-1"],
        });
        return `${idx}:v`;
      }
      case "solid": {
        const g = scaleFilter(layer.geometry);
        const idx = FIRST_EXTRA_INPUT + extraInputs.length;
        extraInputs.push({
          lavfi: `color=c=${src.color || "black"}:s=${g.w || BASE_W}x${g.h || BASE_H}:r=30`,
          inputOptions: ["-f", "lavfi"],
        });
        return `${idx}:v`;
      }
      case "waveform": {
        const g = scaleFilter(layer.geometry);
        const out = nextLabel();
        filterGraph.push(
          `[cl_a_wave]showwaves=s=${g.w || BASE_W}x${g.h || BASE_H}` +
            `:mode=${src.mode || "cline"}:rate=30:colors=${src.color || "white"}` +
            // showwaves vẽ trên nền đen; phải khử nền đen thành trong suốt mới chồng được.
            `,colorkey=0x000000:${src.tolerance ?? 0.01}:0[${out}]`
        );
        return out;
      }
      default:
        warnings.push(`⚠️ Loại nguồn không hiểu (${src.type}) — bỏ qua lớp này`);
        return null;
    }
  };

  let stage = null; // nhãn của kết quả đã chồng đến lớp hiện tại
  const pending = [];

  for (const layer of layers) {
    const inLabel = sourceLabel(layer);
    if (!inLabel) continue;

    // Chỉ waveform đi đường riêng: câu lệnh showwaves của nó đã được đẩy vào filterGraph
    // ngay lúc cấp nguồn, và nó đã có đúng kích thước nên không cần scale nữa.
    // Lớp solid thì KHÔNG đi đường riêng dù nguồn color= cũng đã đúng kích thước: cho nó
    // qua buildLayerChain thì treatment (opacity, blur…) mới áp được lên nó. Bước scale
    // lặp lại là vô hại vì cùng kích thước.
    const built =
      layer?.source?.type === "waveform"
        ? { statements: [], outLabel: inLabel, ...scaleFilter(layer.geometry) }
        : buildLayerChain(layer, inLabel, nextLabel);
    pending.push(...built.statements);

    if (stage === null) {
      stage = built.outLabel;
      continue;
    }
    const geo = layer.geometry || {};
    const { x, y } = anchorExpr(geo.anchor, geo.dx, geo.dy);
    const out = nextLabel();
    if (layer.blend === "screen") {
      const op = (layer.treatments || []).find((t) => t?.kind === "opacity");
      // blend phủ toàn khung, không có toạ độ — anchor/dx/dy bị bỏ qua ở đây.
      pending.push(
        `[${stage}][${built.outLabel}]blend=all_mode=screen` +
          `:all_opacity=${op ? numStr(op.value, 1) : 1}:shortest=1[${out}]`
      );
    } else {
      // shortest=1 ở MỌI bước: nền, ảnh, khối màu đều là nguồn vô hạn; độ dài hữu hạn
      // chỉ đến từ lớp video gốc.
      pending.push(`[${stage}][${built.outLabel}]overlay=${x}:${y}:shortest=1[${out}]`);
    }
    stage = out;
  }

  // Lớp waveform đẩy câu lệnh thẳng vào filterGraph chứ không qua pending. Nếu nó là lớp
  // duy nhất còn sống thì pending rỗng, bước đổi tên bên dưới không có gì để đổi, và graph
  // ra THIẾU HẲN [combined_video] — ffmpeg chết với lỗi khó hiểu thay vì báo sai preset.
  // Chèn một bước copy để hợp đồng đúng về cấu trúc, không phụ thuộc loại lớp nào đi
  // đường riêng.
  if (stage !== null && !pending.length) {
    const out = nextLabel();
    pending.push(`[${stage}]copy[${out}]`);
    stage = out;
  }
  // Không lớp nào dựng được hình: graph không dùng được. validatePreset đã chặn trường hợp
  // này, nhưng compilePreset phải tự nói ra khi bị gọi mà bỏ qua bước kiểm.
  if (stage === null) {
    warnings.push("⚠️ Preset không có lớp nào dựng được hình — graph không dùng được");
  }

  // Nhãn cuối cùng phải là [combined_video] — hợp đồng với renderOne. Đổi tên ở bước cuối
  // thay vì đoán trước lớp nào là lớp cuối.
  const rewritten = pending.map((s, i) =>
    i === pending.length - 1 && stage ? s.replace(new RegExp(`\\[${stage}\\]$`), "[combined_video]") : s
  );
  filterGraph.push(...rewritten);
  filterGraph.push(`[${audioSource}]volume=1.0[overlay_audio]`);
  return { extraInputs, filterGraph, warnings };
}
