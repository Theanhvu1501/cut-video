import { path as installerFfmpeg } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
  return [
    filter.join(";"),
    "[0:v][overlay_video]overlay=0:H-h[combined_video]",
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

export function buildComplexFilter(renderMode, cfgIn = {}) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  switch (renderMode) {
    case "chromaKeyAuto":
    case "chromaKey": return chromaKey(cfg);
    case "crop": return crop(cfg);
    case "keepColor": return keepColor(cfg);
    case "blurFrame": return blurFrame(cfg);
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
  const { ffmpegPath, ffprobePath } = resolveFfmpegPaths();
  ffmpeg.setFfmpegPath(ffmpegPath);
  ffmpeg.setFfprobePath(ffprobePath);

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(overlayFile, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata.format.duration;
      const newDuration = duration / cfg.videoSpeed;

      const filterConfig = buildComplexFilter(renderMode, cfg);
      filterConfig.push(`[combined_video]setpts=PTS/${cfg.videoSpeed}[final_video_speed]`);
      filterConfig.push(`[overlay_audio]atempo=${cfg.videoSpeed}[final_audio_speed]`);

      const command = ffmpeg(backgroundFile)
        .inputOptions(["-stream_loop", "-1"])
        .input(overlayFile);

      // Input phụ của blurFrame (khung, hiệu ứng); rỗng với 4 mode cũ.
      for (const extra of buildStudioInputs(renderMode, cfg)) {
        command.input(extra.file).inputOptions(extra.inputOptions);
      }

      command
        .complexFilter(filterConfig)
        .outputOptions(`-t ${newDuration}`)
        .audioCodec("aac")
        .audioFrequency(AUDIO_FREQ)
        .audioChannels(2)
        .map("[final_video_speed]")
        .map("[final_audio_speed]");

      if (useGPU && gpuVideoCodec.includes("nvenc")) {
        command.videoCodec(gpuVideoCodec).outputOptions([
          "-pix_fmt yuv420p", `-r ${FIXED_FPS}`, `-g ${FIXED_GOP}`, `-keyint_min ${FIXED_GOP}`,
          "-sc_threshold 0", "-preset medium", `-cq:v ${VIDEO_QUALITY}`, "-rc:v vbr", "-movflags +faststart",
        ]);
      } else if (useGPU) {
        command.videoCodec(gpuVideoCodec).outputOptions(["-pix_fmt", "yuv420p", "-movflags", "+faststart"]);
      } else {
        command.videoCodec("libx264").outputOptions([
          "-preset ultrafast", "-pix_fmt yuv420p", `-r ${FIXED_FPS}`, `-g ${FIXED_GOP}`,
          `-keyint_min ${FIXED_GOP}`, "-sc_threshold 0", `-crf ${VIDEO_QUALITY}`, "-movflags +faststart",
        ]);
      }

      command
        .on("stderr", (line) => { if (onProgress) onProgress(line); })
        .on("end", () => resolve({ outputPath, durationSec: newDuration }))
        .on("error", (e) => reject(e))
        .save(outputPath);
    });
  });
}
