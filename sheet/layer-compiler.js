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

// Nguồn sự thật cho geometry.fit hợp lệ — dùng để validatePreset từ chối giá trị lạ thay vì
// để scaleFilter âm thầm rơi về "full". fit CHỌN NHÁNH code (branch nào sinh filter), khác
// anchor lạ (chỉ chọn một CẶP biểu thức trong 9 cặp đã định) nên không được rơi về mặc định
// trong im lặng — xem comment ở validatePreset.
export const FIT_MODES = ["full", "scale", "box", "none"];

// Trả về cả kích thước sau scale, không chỉ chuỗi filter: lớp solid và waveform cần biết
// kích thước để sinh nguồn, và w=null báo "không biết trước" (scale=-2).
export function scaleFilter(geometry = {}) {
  const g = geometry || {};
  // "none" = dùng nguồn y nguyên, KHÔNG sinh bước scale nào. Cần cho lớp nền của
  // chromaKey/crop/keepColor: code cũ chồng thẳng lên [0:v] chứ không scale nó, nên preset
  // muốn ra đúng graph cũ thì phải bỏ được bước scale. Ngoài chuyện khớp graph, đây còn
  // tránh một bước scale vô ích trên từng khung hình của cả mẻ 60 video.
  // buildLayerChain đã xử lý được chuỗi rỗng sẵn (outLabel = nhãn nguồn, 0 câu lệnh).
  if (g.fit === "none") return { filter: "", w: null, h: null };
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

// Chỉ 2 loại nguồn ĐỌC source.path lúc render — xem sourceLabel trong compilePreset:
// background luôn là [0:v], overlay luôn là [1:v] (cả hai bỏ qua path), solid sinh từ
// source.color chứ không phải file, waveform không có input nào cả. Lớp thuộc 4 loại này
// mà gắn "slot" là vô tác dụng ÂM THẦM: applySlotOverrides vẫn ghi được vào source.path,
// nhưng compilePreset không bao giờ đọc lại nó. Cả 5 preset dựng sẵn từng gắn
// slot: "nen" cho lớp background — bug thật đã ship, không phải suy đoán.
const PATH_READING_TYPES = new Set(["image", "video"]);

// Gom TẤT CẢ lỗi thay vì dừng ở lỗi đầu: người dùng sửa preset một lần là xong, không
// phải sửa-chạy-sửa nhiều vòng.
export function validatePreset(preset) {
  const errors = [];
  const layers = Array.isArray(preset?.layers) ? preset.layers : [];
  if (!layers.length) errors.push("preset phải có ít nhất một lớp");

  // Tên lớp để nêu trong thông báo lỗi: ưu tiên id, không có thì dùng chỉ số. id !== undefined
  // cùng lý do với chỗ bắt trùng id bên dưới — "" và 0 vẫn là id thật, không phải "không có".
  const layerName = (l, i) => (l?.id !== undefined ? String(l.id) : `#${i}`);

  const seen = new Set();
  layers.forEach((l, i) => {
    const type = l?.source?.type;
    if (!SOURCE_TYPES.includes(type)) {
      // String(type) để không ném TypeError nếu type là Symbol hay giá trị không convert được thành chuỗi.
      // Hàm này PHẢI luôn trả { ok, errors }, không được ném lỗi làm chết cả mẻ render.
      errors.push(`loại nguồn không hợp lệ: ${String(type)}`);
    }
    if (BOX_ONLY.has(type) && l?.geometry?.fit !== "box") {
      errors.push(`lớp ${type} buộc dùng fit: "box" vì kích thước nằm trong tham số sinh nguồn`);
    }
    if (SOURCE_TYPES.includes(type) && !PATH_READING_TYPES.has(type) && l?.slot) {
      errors.push(
        `lớp ${layerName(l, i)}: slot "${l.slot}" vô tác dụng trên loại nguồn "${type}" ` +
          `(chỉ image/video đọc source.path) — bỏ slot hoặc đổi loại nguồn`
      );
    }
    // fit lạ CHỌN NHẦM NHÁNH code (scaleFilter rơi về "full" trong im lặng) — khác anchor lạ
    // vốn được spec cho phép tường minh rơi về "center" (đã có test riêng, không đụng ở đây).
    // fit và kind treatment bên dưới đều chọn nhánh, không phải tham số ngoài khoảng, nên phải
    // là lỗi chứ không phải giá trị mặc định.
    const fit = l?.geometry?.fit;
    if (fit !== undefined && !FIT_MODES.includes(fit)) {
      errors.push(`lớp ${layerName(l, i)}: fit không hợp lệ "${String(fit)}" — chỉ nhận ${FIT_MODES.join("/")}`);
    }
    for (const t of l?.treatments || []) {
      // kind lạ bị buildLayerChain bỏ qua trong im lặng (default: break) — cùng lớp lỗi với
      // fit lạ ở trên.
      if (t?.kind !== undefined && !TREATMENT_KINDS.includes(t.kind)) {
        errors.push(`lớp ${layerName(l, i)}: treatment kind không hợp lệ "${String(t.kind)}"`);
      }
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
  });

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

  // Lớp waveform lấy tiếng từ chính luồng đang dùng làm audio đầu ra, nên phải asplit — MỘT
  // nhánh riêng cho MỖI lớp waveform, cộng một nhánh giữ nguyên cho tiếng ra loa. Một nhãn
  // trung gian trong filter_complex chỉ được NUÔI đúng một đích — khác nhãn nguồn kiểu [0:v]
  // mà ffmpeg cho nhiều đích cùng đọc — nên ghi cứng asplit=2 rồi cho N lớp waveform cùng đọc
  // một nhãn [cl_a_wave] là graph SAI: ffmpeg từ chối nó dù validatePreset báo ok. N lớp
  // waveform thì phải là N nhãn audio riêng (cl_a_wave0, cl_a_wave1, …).
  const waveformLayers = layers.filter((l) => l?.source?.type === "waveform");
  const audioSource = waveformLayers.length ? "cl_a_out" : "1:a";
  if (waveformLayers.length) {
    const waveLabels = waveformLayers.map((_, i) => `cl_a_wave${i}`);
    filterGraph.push(
      `[1:a]asplit=${waveformLayers.length + 1}[cl_a_out]${waveLabels.map((l) => `[${l}]`).join("")}`
    );
  }
  // Chỉ số riêng để gán đúng nhãn cl_a_waveN cho từng lớp waveform theo thứ tự sourceLabel
  // được gọi (đúng thứ tự layers, vì compilePreset duyệt layers tuần tự bên dưới).
  let waveformSeq = 0;

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
        const out = nextLabel();
        // Phát color= thành NODE NGUỒN trong filter_complex, không cấp input "-f lavfi -i"
        // riêng: fluent-ffmpeg tiền kiểm "-f lavfi" bằng cách đọc `ffmpeg -formats` với một
        // regex chỉ hiểu 2 cột cờ (node_modules/fluent-ffmpeg/lib/capabilities.js:18), mà
        // ffmpeg mới in thêm cột cờ device (" D d lavfi") nên dòng đó bị bỏ qua và nó ném
        // "Input format lavfi is not available" — dù binary hoàn toàn hỗ trợ lavfi. Dạng
        // node nguồn tránh hẳn phép tiền kiểm đó, chạy được với cả bin/ffmpeg.exe (có cột
        // device) lẫn bản @ffmpeg-installer (không có), và bỏ luôn một khe input.
        filterGraph.push(
          `color=c=${src.color || "black"}:s=${g.w || BASE_W}x${g.h || BASE_H}:r=30[${out}]`
        );
        return out;
      }
      case "waveform": {
        const g = scaleFilter(layer.geometry);
        const out = nextLabel();
        // Nhãn audio riêng cho LỚP NÀY — xem comment ở waveformLayers/waveLabels phía trên.
        const waveLabel = `cl_a_wave${waveformSeq++}`;
        filterGraph.push(
          `[${waveLabel}]showwaves=s=${g.w || BASE_W}x${g.h || BASE_H}` +
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

    // MỌI lớp đều qua buildLayerChain, kể cả solid và waveform dù nguồn sinh của chúng
    // (color=…, showwaves=…) đã đúng kích thước sẵn: chỉ qua buildLayerChain thì treatment
    // (opacity, blur…) mới áp được lên chúng. Bước scale lặp lại ở đầu chuỗi là vô hại vì
    // cùng kích thước — trước đây waveform đi đường riêng (bỏ qua buildLayerChain hẳn) nên
    // mọi treatment khai trên lớp waveform bị rơi mất trong im lặng, cùng lỗi lẽ ra solid đã
    // tránh được.
    const built = buildLayerChain(layer, inLabel, nextLabel);
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

  // solid/waveform giờ CÓ qua buildLayerChain (xem comment ở lời gọi built = buildLayerChain
  // phía trên) nên KHÔNG phải nguồn của pending rỗng nữa: fit="box" bắt buộc của chúng luôn
  // sinh một bước scale, tức luôn có ít nhất một câu lệnh trong pending. pending chỉ rỗng khi
  // lớp DUY NHẤT còn sống có geometry fit="none" VÀ không treatment nào — buildLayerChain khi
  // đó không thêm câu lệnh nào (chain rỗng suốt, flush() không được gọi — xem "buildLayerChain
  // đã xử lý được chuỗi rỗng sẵn" ở scaleFilter), nên outLabel = inLabel nguyên vẹn. Ví dụ:
  // preset chỉ có một lớp overlay với fit: "none". Không chèn copy thì bước đổi tên bên dưới
  // không có gì để đổi, và graph ra THIẾU HẲN [combined_video] — ffmpeg chết với lỗi khó hiểu
  // thay vì báo sai preset. Chèn một bước copy để hợp đồng đúng về cấu trúc, không phụ thuộc
  // loại lớp nào đi đường riêng.
  if (stage !== null && !pending.length) {
    const out = nextLabel();
    pending.push(`[${stage}]copy[${out}]`);
    stage = out;
  }
  // Không lớp nào dựng được hình: graph không dùng được. Đường render thật luôn gọi
  // validatePreset trước compilePreset (renderOne ở render-core.js, nhánh composer của
  // render.js, và sheet-runner.js lúc nạp preset theo tên) nên trường hợp này bị chặn từ đó.
  // Nhưng compilePreset là hàm THUẦN — ai gọi trực tiếp mà bỏ qua bước kiểm kia (test, hay
  // preview-frame.js ở Giai đoạn 2) vẫn phải được báo rõ chứ không được ra graph rỗng âm thầm.
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
