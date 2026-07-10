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
};

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

export function buildComplexFilter(renderMode, cfgIn = {}) {
  const cfg = { ...DEFAULT_RENDER_CFG, ...cfgIn };
  switch (renderMode) {
    case "chromaKeyAuto":
    case "chromaKey": return chromaKey(cfg);
    case "crop": return crop(cfg);
    case "keepColor": return keepColor(cfg);
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
        .input(overlayFile)
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
