import { path as installerFfmpeg } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { compilePreset, validatePreset } from "./layer-compiler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

const FIXED_FPS = 30;
const FIXED_GOP = FIXED_FPS * 2;
const AUDIO_FREQ = 44100;
const VIDEO_QUALITY = 23;

export const DEFAULT_RENDER_CFG = {
  opacity: 0.9,
  chromaColor: "D4F9D7",
  chromaSimilarity: 0.3,
  keepColors: ["FBFF02"],
  keepSimilarity: 0.2,
  keepCrop: false,
  keepHeight: 220,
  keepYOffset: 490,
  keepAddDarkLayer: false,
  cropHeight: 220,
  cropYOffset: 490,
  // Mode crop: lớp ảnh người đứng sát mép trên dải crop. Công tắc tách khỏi
  // đường dẫn để tắt tạm mà không mất đường dẫn đã chọn (giống blurFrame).
  personEnabled: false,
  personPath: "",
  personFile: "",
  personPos: "center", // left | center | right | random
  personScale: 0.9,
  videoSpeed: 0.95,
  // Mode blurFrame: 3 công tắc độc lập, mỗi công tắc tách khỏi giá trị của nó
  // để tắt tạm một lớp mà không mất đường dẫn đã chọn.
  bgBlurEnabled: false,
  bgBlur: 20,
  mainScale: 0.85,
  mainOpacity: 0.85,
  frameEnabled: false,
  framePath: "",
  frameFile: "",
  frameScale: 1,
  effectEnabled: false,
  effectPath: "",
  effectFile: "",
  effectOpacity: 0.15,
  // "normal" = chồng thẳng như Blend Mode Normal của Premiere (vùng tối vẫn làm
  // tối ảnh); "screen" = cộng sáng, vùng đen tự mất; "lumakey" = khử vùng tối
  // thành trong suốt rồi chồng thẳng.
  effectBlend: "normal",
  effectKeyThreshold: 0.15,
  // Mode dualFrame: 4 lớp — ảnh nền full khung, video overlay (khung to, giữa),
  // video background (khung nhỏ, góc dưới phải), ảnh khung viền khung to (tuỳ chọn).
  dualFrameBgPath: "",
  dualFrameBgFile: "",
  dualFrameFrameEnabled: false,
  dualFrameFramePath: "",
  dualFrameFrameFile: "",
  dualFrameFrameScale: 1,
  dualFrameMainWidth: 960,
  dualFrameMainHeight: 560,
  dualFrameMainX: 40,
  dualFrameMainY: 40,
  dualFrameMainOpacity: 1.0,
  dualFrameSmallWidth: 240,
  dualFrameSmallHeight: 160,
  dualFrameSmallX: 1000,
  dualFrameSmallY: 520,
  dualFrameSmallOpacity: 1.0,
  // 0 = góc vuông (mặc định, không đổi hành vi cũ). >0 = bo tròn 4 góc, đơn vị px.
  dualFrameSmallRadius: 0,
};

export const EFFECT_BLENDS = ["normal", "screen", "lumakey"];

export const FRAME_EXTS = [".png", ".webp"];
export const EFFECT_EXTS = [".mp4", ".mov", ".webm", ".mkv"];

function topTransparent(cfg) {
  const filter = [
    `[0:v]scale=1280:720,format=yuva420p,colorchannelmixer=aa=${cfg.opacity}[top_video]`,
    "[1:v]scale=1280:720[base_video]",
  ];
  return [
    filter.join(";"),
    "[base_video][top_video]overlay=0:0[combined_video]",
    "[1:a]volume=1.0[overlay_audio]",
  ];
}

function chromaKey(cfg) {
  const color = String(cfg.chromaColor).replace("#", "");
  const filter = [
    `[1:v]scale=1280:720,colorkey=0x${color}:${cfg.chromaSimilarity}:0.1,format=yuva420p[overlay_video]`,
  ];
  return [
    filter.join(";"),
    "[0:v][overlay_video]overlay=0:H-h[combined_video]",
    "[1:a]volume=1.0[overlay_audio]",
  ];
}

function crop(cfg) {
  const filter = [
    `[1:v]scale=1280:720,crop=1280:${cfg.cropHeight}:0:${cfg.cropYOffset}[cropped]`,
    "[cropped]eq=brightness=-1.0:contrast=3.0:gamma=1.2:saturation=0[filtered]",
    "[filtered]format=yuva420p,colorchannelmixer=aa=0.8[overlay_video]",
  ];

  if (!cropPersonLayer(cfg)) {
    return [
      filter.join(";"),
      "[0:v][overlay_video]overlay=0:H-h[combined_video]",
      "[1:a]volume=1.0[overlay_audio]",
    ];
  }

  // scale=-2:h giữ nguyên tỉ lệ gốc, chiều rộng tự suy ra và làm tròn về số chẵn.
  // Toạ độ x là biểu thức của ffmpeg nên không cần biết trước chiều rộng ảnh.
  const { h, y } = personGeometry(cfg);
  const x = personOverlayX(pickPersonPos(cfg.personPos));
  filter.push(`[2:v]scale=-2:${h}[person]`);
  filter.push(`[0:v][person]overlay=${x}:${y}[with_person]`);

  // Dải crop là lớp CUỐI: nó chứa phụ đề nên không bao giờ được để ảnh che, và
  // phần ảnh lòi xuống dưới bị nó cắt gọn đúng ở mép.
  return [
    filter.join(";"),
    "[with_person][overlay_video]overlay=0:H-h[combined_video]",
    "[1:a]volume=1.0[overlay_audio]",
  ];
}

function keepColor(cfg) {
  const colors = (cfg.keepColors || []).map((c) => String(c).replace("#", "")).filter(Boolean);
  const count = colors.length;
  if (count === 0) {
    return [
      "[1:v]scale=1280:720[final_isolated]",
      "[0:v][final_isolated]overlay=0:H-h[combined_video]",
      "[1:a]volume=1.0[overlay_audio]",
    ];
  }
  const filters = [];
  let baseFilter = "[1:v]scale=1280:720";
  if (cfg.keepCrop) {
    baseFilter += `,crop=1280:${cfg.keepHeight || 720}:0:${cfg.keepYOffset || 0}`;
  }
  let splitOutputs = "[src_main]";
  for (let i = 0; i < count; i++) splitOutputs += `[src_${i}_detect]`;
  filters.push(`${baseFilter},split=${count + 1}${splitOutputs}`);

  const maskNames = [];
  const similarity = cfg.keepSimilarity || 0.1;
  colors.forEach((hex, index) => {
    filters.push(`[src_${index}_detect]colorkey=0x${hex}:${similarity}:0.1,alphaextract,negate[mask_${index}]`);
    maskNames.push(`[mask_${index}]`);
  });
  let currentMask = maskNames[0];
  for (let i = 1; i < maskNames.length; i++) {
    filters.push(`${currentMask}${maskNames[i]}blend=all_expr='max(A,B)'[combined_mask_${i}]`);
    currentMask = `[combined_mask_${i}]`;
  }
  filters.push(`[src_main]${currentMask}alphamerge[final_isolated]`);

  if (cfg.keepCrop && cfg.keepAddDarkLayer) {
    const h = cfg.keepHeight || 720;
    filters.push(
      `[1:v]scale=1280:720,crop=1280:${h}:0:${cfg.keepYOffset || 0},geq=r=0:g=0:b=0:a=300,format=yuva420p[black_layer]`,
      "[0:v][black_layer]overlay=0:H-h:shortest=1[bg_with_black]",
      "[bg_with_black][final_isolated]overlay=0:H-h:shortest=1[combined_video]",
    );
    return [filters.join(";"), "[1:a]volume=1.0[overlay_audio]"];
  }
  return [
    filters.join(";"),
    "[0:v][final_isolated]overlay=0:H-h:shortest=1[combined_video]",
    "[1:a]volume=1.0[overlay_audio]",
  ];
}

const BASE_W = 1280;
const BASE_H = 720;

// yuv420p yêu cầu chiều rộng/cao chẵn nên phải làm tròn xuống số chẵn.
function evenDown(value) {
  const n = Math.round(value);
  return n % 2 === 0 ? n : n - 1;
}

// Hình học của lớp video gốc thu nhỏ, căn giữa khung 1280x720.
export function frameGeometry(mainScale) {
  const raw = Number(mainScale);
  const ratio = raw > 0 && raw <= 1 ? raw : DEFAULT_RENDER_CFG.mainScale;
  const w = Math.max(2, evenDown(BASE_W * ratio));
  const h = Math.max(2, evenDown(BASE_H * ratio));
  return { w, h, x: Math.round((BASE_W - w) / 2), y: Math.round((BASE_H - h) / 2) };
}

// Hình học của lớp khung: phóng to/thu nhỏ quanh cùng tâm với vùng video.
// Ảnh PNG khung thường có sẵn viền trong suốt bao quanh hình vẽ, nên phủ khít
// vùng video vẫn thấy khung thụt vào — frameScale > 1 bù đúng phần viền rỗng đó.
// Cho phép vượt 1.0: khung tràn ra ngoài 1280x720 thì overlay toạ độ âm, ffmpeg
// tự cắt phần thừa.
export function frameOverlayGeometry(mainScale, frameScale) {
  const { w, h } = frameGeometry(mainScale);
  const raw = Number(frameScale);
  const s = raw > 0 ? raw : DEFAULT_RENDER_CFG.frameScale;
  const fw = Math.max(2, evenDown(w * s));
  const fh = Math.max(2, evenDown(h * s));
  return { w: fw, h: fh, x: Math.round((BASE_W - fw) / 2), y: Math.round((BASE_H - fh) / 2) };
}

// ── Mode crop: lớp ảnh người ────────────────────────────────────────────────
export const PERSON_POSITIONS = ["left", "center", "right"];

// "random" bốc một trong ba vị trí; giá trị lạ rơi về giữa. Phải chốt MỘT LẦN ở
// renderOne trước khi dựng filter — lần render lại bằng CPU (khi GPU lỗi) mà bốc
// lại sẽ cho ra vị trí khác với lần đầu.
export function pickPersonPos(personPos, rand = Math.random) {
  const p = String(personPos ?? "").trim().toLowerCase();
  if (PERSON_POSITIONS.includes(p)) return p;
  if (p !== "random") return "center";
  const i = Math.min(PERSON_POSITIONS.length - 1, Math.floor(rand() * PERSON_POSITIONS.length));
  return PERSON_POSITIONS[i];
}

// Chiều cao ảnh người và toạ độ y sao cho ĐÁY ảnh trùng mép trên dải crop.
export function personGeometry(cfgIn = {}) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  const above = Math.max(2, BASE_H - Number(cfg.cropHeight || 0));
  const raw = Number(cfg.personScale);
  const ratio = raw > 0 && raw <= 1 ? raw : DEFAULT_RENDER_CFG.personScale;
  const h = Math.max(2, evenDown(above * ratio));
  return { h, y: BASE_H - Number(cfg.cropHeight || 0) - h };
}

// Biểu thức toạ độ x của overlay. Trái/phải dán sát mép khung, không chừa lề.
export function personOverlayX(pos) {
  if (pos === "left") return "0";
  if (pos === "right") return "W-w";
  return "(W-w)/2";
}

// Nguồn sự thật duy nhất về "lớp người có bật không" — buildStudioInputs và crop
// đều hỏi hàm này, nên chỉ số input [2:v] không bao giờ lệch.
export function cropPersonLayer(cfgIn = {}) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  return Boolean(cfg.personEnabled) && Boolean(cfg.personFile);
}

// Biến personPath (file hoặc thư mục) thành file cụ thể cho lần render này.
// Bật công tắc mà đường dẫn hỏng thì cảnh báo và bỏ qua lớp, không ném lỗi:
// luồng sheet chạy không người trông, một ô gõ sai không đáng làm hỏng cả mẻ video.
export function resolvePersonAsset(cfgIn = {}, rand = Math.random) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  if (!cfg.personEnabled) return { personFile: "", warnings: [] };
  const personFile = pickAsset(cfg.personPath, FRAME_EXTS, rand);
  return {
    personFile,
    warnings: personFile
      ? []
      : [`⚠️ Bật ảnh người nhưng không tìm được ảnh hợp lệ tại: ${cfg.personPath || "(trống)"} — bỏ qua lớp ảnh người`],
  };
}

// Nguồn sự thật duy nhất về "lớp nào đang bật". buildStudioInputs và blurFrame
// đều hỏi hàm này, nên thứ tự input và chỉ số [n:v] trong filter không bao giờ lệch.
export function blurFrameLayers(cfgIn = {}) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  return {
    blurBg: Boolean(cfg.bgBlurEnabled) && Number(cfg.bgBlur) > 0,
    frame: Boolean(cfg.frameEnabled) && Boolean(cfg.frameFile),
    effect: Boolean(cfg.effectEnabled) && Boolean(cfg.effectFile),
  };
}

// target trỏ vào file thì dùng đúng file đó; trỏ vào thư mục thì bốc ngẫu nhiên
// một file hợp lệ bên trong. Trả về "" khi thiếu/hỏng để lớp đó bị bỏ qua.
export function pickAsset(target, exts, rand = Math.random) {
  if (!target) return "";
  try {
    const stat = fs.statSync(target);
    if (stat.isFile()) return target;
    if (!stat.isDirectory()) return "";
    const files = fs
      .readdirSync(target)
      .filter((f) => exts.includes(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    if (!files.length) return "";
    return path.join(target, files[Math.floor(rand() * files.length)]);
  } catch {
    return "";
  }
}

// Biến framePath/effectPath (file hoặc thư mục) thành file cụ thể cho lần render này.
// Bật công tắc mà đường dẫn hỏng thì trả cảnh báo và bỏ qua lớp đó, không ném lỗi:
// luồng sheet chạy không người trông, một ô gõ sai không đáng làm hỏng cả mẻ video.
export function resolveBlurFrameAssets(cfgIn = {}, rand = Math.random) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  const warnings = [];
  let frameFile = "";
  let effectFile = "";
  if (cfg.frameEnabled) {
    frameFile = pickAsset(cfg.framePath, FRAME_EXTS, rand);
    if (!frameFile)
      warnings.push(
        `⚠️ Bật khung nhưng không tìm được ảnh khung hợp lệ tại: ${cfg.framePath || "(trống)"} — bỏ qua lớp khung`
      );
  }
  if (cfg.effectEnabled) {
    effectFile = pickAsset(cfg.effectPath, EFFECT_EXTS, rand);
    if (!effectFile)
      warnings.push(
        `⚠️ Bật hiệu ứng nhưng không tìm được video hiệu ứng hợp lệ tại: ${cfg.effectPath || "(trống)"} — bỏ qua lớp hiệu ứng`
      );
  }
  return { frameFile, effectFile, warnings };
}

// Các input phụ (sau nền [0] và video gốc [1]) mà mode cần, đúng thứ tự filter giả định.
export function buildStudioInputs(renderMode, cfgIn = {}) {
  if (renderMode === "crop") {
    // Ảnh tĩnh phải -loop 1, nếu không chỉ khung hình đầu tiên có ảnh người.
    return cropPersonLayer(cfgIn)
      ? [{ file: { ...DEFAULT_RENDER_CFG, ...cfgIn }.personFile, inputOptions: ["-loop", "1"] }]
      : [];
  }
  if (renderMode === "dualFrame") {
    const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
    const layers = dualFrameLayers(cfg);
    const inputs = [];
    // Thiếu ảnh nền thì dualFrame() tự phát sinh nền đen ngay trong filter_complex
    // (không chiếm input phụ nào) — chỉ chiếm input khi đã chốt được file thật.
    if (cfg.dualFrameBgFile) inputs.push({ file: cfg.dualFrameBgFile, inputOptions: ["-loop", "1"] });
    if (layers.frame) inputs.push({ file: cfg.dualFrameFrameFile, inputOptions: ["-loop", "1"] });
    return inputs;
  }
  if (renderMode !== "blurFrame") return [];
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  const layers = blurFrameLayers(cfg);
  const inputs = [];
  // Ảnh tĩnh phải -loop 1, nếu không chỉ có đúng 1 khung hình đầu tiên có khung.
  if (layers.frame) inputs.push({ file: cfg.frameFile, inputOptions: ["-loop", "1"] });
  if (layers.effect) inputs.push({ file: cfg.effectFile, inputOptions: ["-stream_loop", "-1"] });
  return inputs;
}

function blurFrame(cfg) {
  const { w, h, x, y } = frameGeometry(cfg.mainScale);
  const layers = blurFrameLayers(cfg);
  const filters = [];

  const blur = layers.blurBg ? `,gblur=sigma=${cfg.bgBlur}` : "";
  filters.push(`[0:v]scale=${BASE_W}:${BASE_H}${blur}[bf_bg]`);
  filters.push(
    `[1:v]scale=${w}:${h},format=yuva420p,colorchannelmixer=aa=${cfg.mainOpacity}[bf_main]`
  );

  // Nhãn cuối cùng của chuỗi luôn phải là [combined_video], nên mỗi bước phải biết
  // nó có phải bước cuối không.
  const label = (isLast, name) => (isLast ? "[combined_video]" : name);
  let stage = label(!layers.frame && !layers.effect, "[bf_stage1]");
  // shortest=1: nền và hiệu ứng lặp vô hạn, chỉ video gốc là hữu hạn.
  filters.push(`[bf_bg][bf_main]overlay=${x}:${y}:shortest=1${stage}`);

  let idx = 2;
  if (layers.frame) {
    const fr = frameOverlayGeometry(cfg.mainScale, cfg.frameScale);
    filters.push(`[${idx}:v]scale=${fr.w}:${fr.h}[bf_frame]`);
    const next = label(!layers.effect, "[bf_stage2]");
    filters.push(`${stage}[bf_frame]overlay=${fr.x}:${fr.y}:shortest=1${next}`);
    stage = next;
    idx++;
  }
  if (layers.effect) {
    const blend = EFFECT_BLENDS.includes(cfg.effectBlend)
      ? cfg.effectBlend
      : DEFAULT_RENDER_CFG.effectBlend;
    if (blend === "screen") {
      // Cộng sáng: vùng đen của hiệu ứng tự mất, nhưng cả khung bị sáng lên.
      filters.push(`[${idx}:v]scale=${BASE_W}:${BASE_H},format=yuv420p[bf_fx]`);
      filters.push(
        `${stage}[bf_fx]blend=all_mode=screen:all_opacity=${cfg.effectOpacity}:shortest=1[combined_video]`
      );
    } else {
      // "normal" = Blend Mode Normal của Premiere: chồng thẳng với alpha, vùng tối
      // vẫn làm tối ảnh. "lumakey" chỉ khác ở chỗ khử vùng tối trước khi chồng.
      const key =
        blend === "lumakey"
          ? `,lumakey=threshold=${cfg.effectKeyThreshold}:tolerance=0.1:softness=0.1`
          : "";
      filters.push(
        `[${idx}:v]scale=${BASE_W}:${BASE_H},format=yuva420p${key},colorchannelmixer=aa=${cfg.effectOpacity}[bf_fx]`
      );
      filters.push(`${stage}[bf_fx]overlay=0:0:shortest=1[combined_video]`);
    }
    idx++;
  }

  filters.push("[1:a]volume=1.0[overlay_audio]");
  return filters;
}

// ── Mode dualFrame: nền ảnh + video overlay (khung to) + video nền (khung nhỏ) + khung viền ──

// Nguồn sự thật duy nhất về "khung viền có bật không" — buildStudioInputs và dualFrame
// đều hỏi hàm này, nên chỉ số input không bao giờ lệch.
export function dualFrameLayers(cfgIn = {}) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  return { frame: Boolean(cfg.dualFrameFrameEnabled) && Boolean(cfg.dualFrameFrameFile) };
}

// Biến dualFrameBgPath/dualFrameFramePath (file hoặc thư mục) thành file cụ thể cho lần
// render này. Ảnh nền không có công tắc riêng (nó là lớp lõi của cả mode) nên thiếu/hỏng vẫn
// cảnh báo, nhưng KHÔNG ném lỗi: dualFrame() tự phủ nền đen thay thế để không hỏng cả mẻ video.
export function resolveDualFrameAssets(cfgIn = {}, rand = Math.random) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  const warnings = [];
  const bgFile = pickAsset(cfg.dualFrameBgPath, FRAME_EXTS, rand);
  if (!bgFile) {
    warnings.push(
      `⚠️ Không tìm được ảnh nền hợp lệ tại: ${cfg.dualFrameBgPath || "(trống)"} — dùng nền đen thay thế`
    );
  }
  let frameFile = "";
  if (cfg.dualFrameFrameEnabled) {
    frameFile = pickAsset(cfg.dualFrameFramePath, FRAME_EXTS, rand);
    if (!frameFile) {
      warnings.push(
        `⚠️ Bật khung viền nhưng không tìm được ảnh khung hợp lệ tại: ${cfg.dualFrameFramePath || "(trống)"} — bỏ qua lớp khung`
      );
    }
  }
  return { bgFile, frameFile, warnings };
}

// Hình học khung to (chứa video overlay) — toạ độ/kích thước khai trực tiếp, không suy ra
// từ tỉ lệ như frameGeometry, vì khung to ở đây neo theo layout cố định (góc trái trên).
export function dualFrameMainGeometry(cfgIn = {}) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  const w = Math.max(2, evenDown(cfg.dualFrameMainWidth));
  const h = Math.max(2, evenDown(cfg.dualFrameMainHeight));
  return { w, h, x: Math.round(cfg.dualFrameMainX), y: Math.round(cfg.dualFrameMainY) };
}

// Hình học khung nhỏ (chứa video nền) — luôn ở lớp TRÊN CÙNG nên không cần logic isLast.
export function dualFrameSmallGeometry(cfgIn = {}) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  const w = Math.max(2, evenDown(cfg.dualFrameSmallWidth));
  const h = Math.max(2, evenDown(cfg.dualFrameSmallHeight));
  return { w, h, x: Math.round(cfg.dualFrameSmallX), y: Math.round(cfg.dualFrameSmallY) };
}

// Hình học khung viền: phóng to/thu nhỏ quanh cùng tâm với khung to, giống frameOverlayGeometry
// của blurFrame — dualFrameFrameScale > 1 bù phần viền trong suốt quanh hình vẽ khung PNG.
export function dualFrameFrameGeometry(cfgIn = {}) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  const { w, h, x, y } = dualFrameMainGeometry(cfg);
  const raw = Number(cfg.dualFrameFrameScale);
  const s = raw > 0 ? raw : DEFAULT_RENDER_CFG.dualFrameFrameScale;
  const fw = Math.max(2, evenDown(w * s));
  const fh = Math.max(2, evenDown(h * s));
  const cx = x + w / 2;
  const cy = y + h / 2;
  return { w: fw, h: fh, x: Math.round(cx - fw / 2), y: Math.round(cy - fh / 2) };
}

// Biểu thức alpha bo 4 góc bằng geq: trong bán kính R tính từ mỗi góc, pixel ngoài
// đường tròn góc thì cho trong suốt (0), còn lại giữ nguyên alpha đã có (255 = không đổi,
// nhân với alpha gốc ở nơi gọi). R kẹp tối đa bằng nửa cạnh ngắn hơn — bo quá nửa cạnh
// biến hình chữ nhật thành hình dạng vô nghĩa (2 vòng tròn góc đè lên nhau).
// Trả về null khi bo = 0 (sau khi kẹp): nơi gọi bỏ qua bước geq, giữ nguyên hành vi góc
// vuông cũ — không có test/video nào trước đây phải chạy qua geq nếu không cấu hình bo.
export function roundedCornerAlphaExpr(w, h, r) {
  const rr = Math.max(0, Math.min(Math.round(Number(r) || 0), Math.floor(Math.min(w, h) / 2)));
  if (rr <= 0) return null;
  const right = w - rr;
  const bottom = h - rr;
  return (
    `if(lt(X,${rr})*lt(Y,${rr})*gt((${rr}-X)*(${rr}-X)+(${rr}-Y)*(${rr}-Y),${rr}*${rr}),0,` +
    `if(lt(X,${rr})*gt(Y,${bottom})*gt((${rr}-X)*(${rr}-X)+(Y-${bottom})*(Y-${bottom}),${rr}*${rr}),0,` +
    `if(gt(X,${right})*lt(Y,${rr})*gt((X-${right})*(X-${right})+(${rr}-Y)*(${rr}-Y),${rr}*${rr}),0,` +
    `if(gt(X,${right})*gt(Y,${bottom})*gt((X-${right})*(X-${right})+(Y-${bottom})*(Y-${bottom}),${rr}*${rr}),0,255))))`
  );
}

function dualFrame(cfg) {
  const main = dualFrameMainGeometry(cfg);
  const small = dualFrameSmallGeometry(cfg);
  const layers = dualFrameLayers(cfg);
  const filters = [];

  // Ảnh nền chiếm input kế tiếp sau [0:v] (video nền, khung nhỏ) và [1:v] (video overlay,
  // khung to) CHỈ KHI đã chốt được file thật — thiếu/hỏng thì phát nền đen thẳng trong
  // filter_complex (không chiếm input nào), cùng kỹ thuật lớp "solid" của layer-compiler.js.
  let idx = 2;
  if (cfg.dualFrameBgFile) {
    filters.push(`[${idx}:v]scale=${BASE_W}:${BASE_H}[df_bg]`);
    idx++;
  } else {
    filters.push(`color=c=black:s=${BASE_W}x${BASE_H}:r=${FIXED_FPS}[df_bg]`);
  }

  filters.push(
    `[1:v]scale=${main.w}:${main.h},format=yuva420p,colorchannelmixer=aa=${cfg.dualFrameMainOpacity}[df_main]`
  );
  // shortest=1: nền và video nền (khung nhỏ) lặp vô hạn, chỉ video overlay là hữu hạn.
  filters.push(`[df_bg][df_main]overlay=${main.x}:${main.y}:shortest=1[df_stage1]`);
  let stage = "[df_stage1]";

  if (layers.frame) {
    const fr = dualFrameFrameGeometry(cfg);
    filters.push(`[${idx}:v]scale=${fr.w}:${fr.h}[df_frame]`);
    idx++;
    filters.push(`${stage}[df_frame]overlay=${fr.x}:${fr.y}:shortest=1[df_stage2]`);
    stage = "[df_stage2]";
  }

  // Video nền (khung nhỏ) luôn là lớp CUỐI: không bao giờ để khung viền che mất nó.
  // geq ĐÒI HỎI bắt buộc phải có lum_expr (hoặc r_expr) — không tự pass-through khi chỉ
  // khai a=, khác với suy đoán ban đầu (đã thấy ffmpeg từ chối bằng "A luminance or RGB
  // expression is mandatory" nếu bỏ qua). Khai lum/cb/cr giữ nguyên qua lum(X,Y)/cb(X,Y)/
  // cr(X,Y) để chỉ alpha bị đổi, màu giữ nguyên như trước khi bo góc.
  const radiusExpr = roundedCornerAlphaExpr(small.w, small.h, cfg.dualFrameSmallRadius);
  const roundSuffix = radiusExpr
    ? `,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*(${radiusExpr})/255'`
    : "";
  filters.push(
    `[0:v]scale=${small.w}:${small.h},format=yuva420p,colorchannelmixer=aa=${cfg.dualFrameSmallOpacity}${roundSuffix}[df_small]`
  );
  filters.push(`${stage}[df_small]overlay=${small.x}:${small.y}:shortest=1[combined_video]`);

  filters.push("[1:a]volume=1.0[overlay_audio]");
  return filters;
}

export function buildComplexFilter(renderMode, cfgIn = {}) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  switch (renderMode) {
    case "chromaKeyAuto":
    case "chromaKey": return chromaKey(cfg);
    case "crop": return crop(cfg);
    case "keepColor": return keepColor(cfg);
    case "blurFrame": return blurFrame(cfg);
    case "dualFrame": return dualFrame(cfg);
    case "topTransparent":
    default: return topTransparent(cfg);
  }
}

// Không spawn được file .exe nằm trong app.asar: fs của Electron đọc xuyên asar
// nên existsSync trả true, còn spawn thì ném ENOENT. electron-builder bung bin/**
// ra app.asar.unpacked/, nên đổi thành phần thư mục app.asar -> app.asar.unpacked.
export function toUnpackedPath(p) {
  return String(p).replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
}

export function resolveFfmpegPaths() {
  const binFfmpeg = toUnpackedPath(path.join(REPO_ROOT, "bin", "ffmpeg.exe"));
  const binFfprobe = toUnpackedPath(path.join(REPO_ROOT, "bin", "ffprobe.exe"));
  // Bản dự phòng nằm trong node_modules, cũng bị gói vào asar -> phải đổi luôn.
  const fallbackFfmpeg = toUnpackedPath(installerFfmpeg);
  return {
    ffmpegPath: fs.existsSync(binFfmpeg) ? binFfmpeg : fallbackFfmpeg,
    ffprobePath: fs.existsSync(binFfprobe) ? binFfprobe : fallbackFfmpeg.replace(/ffmpeg(\.exe)?$/, "ffprobe$1"),
  };
}

// fluent-ffmpeg dựng message lỗi bằng utils.extractError, hàm này VỨT BỎ mọi dòng
// stderr bắt đầu bằng "[" — mà lỗi thật của ffmpeg gần như luôn nằm ở đó
// ([h264_nvenc @ ...], [AVFilterGraph @ ...]). Kết quả là chỉ còn lại phần đuôi vô
// nghĩa "frame=0 ... Conversion failed!". Tự bóc lại những dòng có ý nghĩa.
export function extractFfmpegError(stderr) {
  return String(stderr || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    // "Conversion failed!" là dòng cuối mặc định, không nói lên điều gì — bỏ đi
    // để 5 slot còn lại dành cho lý do thật.
    .filter((l) => !/^conversion failed/i.test(l))
    .filter((l) => /error|failed|cannot|unable|no capable|not supported|invalid|denied/i.test(l))
    .slice(-5)
    .join("\n");
}

// Chọn encoder + tham số. Tách riêng để test được mà không cần chạy ffmpeg thật.
export function encoderSettings(useGPU, gpuVideoCodec = "h264_nvenc") {
  if (useGPU && String(gpuVideoCodec).includes("nvenc")) {
    return {
      codec: gpuVideoCodec,
      options: [
        "-pix_fmt yuv420p", `-r ${FIXED_FPS}`, `-g ${FIXED_GOP}`, `-keyint_min ${FIXED_GOP}`,
        "-sc_threshold 0", "-preset medium", `-cq:v ${VIDEO_QUALITY}`, "-rc:v vbr", "-movflags +faststart",
      ],
    };
  }
  if (useGPU) {
    return { codec: gpuVideoCodec, options: ["-pix_fmt yuv420p", "-movflags +faststart"] };
  }
  return {
    codec: "libx264",
    options: [
      "-preset ultrafast", "-pix_fmt yuv420p", `-r ${FIXED_FPS}`, `-g ${FIXED_GOP}`,
      `-keyint_min ${FIXED_GOP}`, "-sc_threshold 0", `-crf ${VIDEO_QUALITY}`, "-movflags +faststart",
    ],
  };
}

// GPU hỏng ở video đầu thì các video sau khỏi thử lại cho mất thời gian.
let gpuBroken = false;
export function resetGpuState() { gpuBroken = false; }

// Chốt asset của preset MỘT LẦN trước khi dựng graph. Bắt buộc phải chốt ở đây: run()
// được gọi lại lần hai khi GPU lỗi phải lùi về CPU, chốt muộn hơn thì lớp có path là
// thư mục sẽ bốc ra ảnh khác giữa hai lần.
// Đường dẫn hỏng thì cảnh báo và để rỗng (compilePreset sẽ bỏ lớp đó) chứ không ném:
// luồng sheet chạy không người trông, một ô gõ sai không đáng làm hỏng cả mẻ video.
export function resolvePresetAssets(preset, rand = Math.random) {
  const clone = JSON.parse(JSON.stringify(preset || {}));
  const warnings = [];
  for (const layer of clone.layers || []) {
    const type = layer?.source?.type;
    if (type !== "image" && type !== "video") continue;
    const exts = type === "image" ? FRAME_EXTS : EFFECT_EXTS;
    const file = pickAsset(layer.source.path, exts, rand);
    if (!file && layer.source.path) {
      warnings.push(
        `⚠️ Lớp "${layer.label || layer.id || type}": không tìm được file hợp lệ tại ${layer.source.path} — bỏ qua lớp này`
      );
    }
    layer.source = { ...layer.source, path: file };
  }
  return { preset: clone, warnings };
}

export function renderOne({
  overlayFile, backgroundFile, outputPath,
  renderMode, cfg: cfgIn = {}, useGPU = false, gpuVideoCodec = "h264_nvenc",
  onProgress,
}) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  if (renderMode === "blurFrame") {
    const { frameFile, effectFile, warnings } = resolveBlurFrameAssets(cfg);
    cfg.frameFile = frameFile;
    cfg.effectFile = effectFile;
    if (onProgress) warnings.forEach((w) => onProgress(w));
  }
  if (renderMode === "dualFrame") {
    // Chốt ảnh nền + khung viền NGAY TẠI ĐÂY, cùng lý do với blurFrame/crop: run() có thể
    // gọi lại lần hai khi GPU lỗi phải lùi về CPU, chốt muộn hơn sẽ bốc ra ảnh khác.
    const { bgFile, frameFile, warnings } = resolveDualFrameAssets(cfg);
    cfg.dualFrameBgFile = bgFile;
    cfg.dualFrameFrameFile = frameFile;
    if (onProgress) warnings.forEach((w) => onProgress(w));
  }
  if (renderMode === "crop") {
    // Chốt ảnh và vị trí NGAY TẠI ĐÂY, trước khi dựng filter: run() được gọi lại
    // lần hai khi GPU lỗi phải lùi về CPU, chốt muộn hơn sẽ ra ảnh/vị trí khác.
    const { personFile, warnings } = resolvePersonAsset(cfg);
    cfg.personFile = personFile;
    cfg.personPos = pickPersonPos(cfg.personPos);
    if (onProgress) warnings.forEach((w) => onProgress(w));
  }
  // Composer: bố cục đến từ preset trong cfg.preset thay vì fix cứng theo mode.
  let composed = null;
  if (renderMode === "composer") {
    // Lớp phòng thủ THỨ HAI (thứ nhất là sheet-runner.js, nạp + kiểm preset một lần cho cả
    // kênh trước khi tải video nào). render.js KHÔNG gọi renderOne — nó có pipeline ffmpeg
    // riêng, chỉ import compilePreset/validatePreset/resolvePresetAssets từ layer-compiler.js
    // (xem render.js, nhánh renderMode === "composer"). Người gọi renderOne duy nhất ngoài
    // test là electron-main.js. Dù vậy vẫn không được coi preset đầu vào là luôn hợp lệ vì
    // renderOne là hàm export công khai — bất kỳ người gọi mới nào (Giai đoạn 2 sau này) đều
    // có thể bỏ qua bước kiểm ở nơi gọi. Kiểm TRƯỚC
    // ffprobe: preset sai cấu trúc thì dừng ngay, không tốn một lượt ffprobe/ffmpeg nào.
    // validatePreset đã gom hết lỗi nên check.errors.join("; ") đúng là thông báo người vận
    // hành cần, không phải chỉ lỗi đầu tiên.
    const check = validatePreset(cfg.preset);
    if (!check.ok) {
      throw new Error(`preset composer không hợp lệ: ${check.errors.join("; ")}`);
    }
    const { preset, warnings } = resolvePresetAssets(cfg.preset);
    if (onProgress) warnings.forEach((w) => onProgress(w));
    composed = compilePreset(preset);
    if (onProgress) composed.warnings.forEach((w) => onProgress(w));
  }
  const { ffmpegPath, ffprobePath } = resolveFfmpegPaths();
  ffmpeg.setFfmpegPath(ffmpegPath);
  ffmpeg.setFfprobePath(ffprobePath);

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(overlayFile, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata.format.duration;
      const newDuration = duration / cfg.videoSpeed;

      const filterConfig = composed
        ? [...composed.filterGraph]
        : buildComplexFilter(renderMode, cfg);
      filterConfig.push(`[combined_video]setpts=PTS/${cfg.videoSpeed}[final_video_speed]`);
      filterConfig.push(`[overlay_audio]atempo=${cfg.videoSpeed}[final_audio_speed]`);

      // Input phụ của blurFrame (khung, hiệu ứng); rỗng với 4 mode cũ.
      // Tính một lần để lần thử lại bằng CPU dùng đúng bộ asset đã bốc.
      const studioInputs = composed ? composed.extraInputs : buildStudioInputs(renderMode, cfg);
      const say = (m) => { if (onProgress) onProgress(m); };

      const run = (gpuOn) => {
        const command = ffmpeg(backgroundFile)
          .inputOptions(["-stream_loop", "-1"])
          .input(overlayFile);

        for (const extra of studioInputs) {
          // extra.lavfi: giữ lại cho input dạng nguồn sinh (-f lavfi -i ...) nếu tương lai có
          // loại lớp nào cần — HIỆN TẠI không loại lớp nào của compilePreset còn phát ra input
          // dạng này. Lớp solid từng dùng "-f lavfi -i color=…" (đã đổi: fluent-ffmpeg tiền
          // kiểm "-f lavfi" ném "Input format lavfi is not available" trên ffmpeg mới — xem
          // comment ở case "solid" trong sheet/layer-compiler.js), giờ phát color= thành node
          // nguồn thẳng trong filter_complex nên không còn nằm trong extraInputs nữa.
          command.input(extra.lavfi ?? extra.file).inputOptions(extra.inputOptions);
        }

        command
          .complexFilter(filterConfig)
          .outputOptions(`-t ${newDuration}`)
          .audioCodec("aac")
          .audioFrequency(AUDIO_FREQ)
          .audioChannels(2)
          .map("[final_video_speed]")
          .map("[final_audio_speed]");

        const enc = encoderSettings(gpuOn, gpuVideoCodec);
        command.videoCodec(enc.codec).outputOptions(enc.options);

        let stderrLog = "";
        command
          .on("stderr", (line) => { stderrLog += line + "\n"; say(line); })
          .on("end", () => resolve({ outputPath, durationSec: newDuration, usedGpu: gpuOn }))
          .on("error", (e) => {
            const detail = extractFfmpegError(stderrLog);
            // GPU chết ngay khi khởi tạo encoder là chuyện thường (không có card NVIDIA,
            // driver cũ, hết session NVENC). Lùi về CPU thay vì bỏ luôn video.
            if (gpuOn) {
              gpuBroken = true;
              say(`⚠️ GPU (${gpuVideoCodec}) không encode được, render lại bằng CPU. Lý do: ${detail || e.message}`);
              return run(false);
            }
            reject(detail ? new Error(`${e.message}\n${detail}`) : e);
          })
          .save(outputPath);
      };

      run(Boolean(useGPU) && !gpuBroken);
    });
  });
}
