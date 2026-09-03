import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { compilePreset, validatePreset } from "./sheet/layer-compiler.js";
import {
  resolvePresetAssets,
  buildComplexFilter as buildDualFrameFilter,
  buildStudioInputs as buildDualFrameInputs,
  resolveDualFrameAssets,
} from "./sheet/render-core.js";

// =================================================================
// Test Render - Bốc 1 video có sẵn trong overlays, cut ngắn, render test
// =================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const FFMPEG_PATH = path.join(__dirname, "bin", "ffmpeg.exe");
const FFPROBE_PATH = path.join(__dirname, "bin", "ffprobe.exe");

ffmpeg.setFfmpegPath(FFMPEG_PATH);
ffmpeg.setFfprobePath(FFPROBE_PATH);

// Parse config from env
let config = {};
try {
  config = JSON.parse(process.env.TEST_RENDER_CONFIG_JSON || "{}");
} catch (e) {
  console.error("❌ Lỗi parse config:", e.message);
  process.exit(1);
}

const {
  overlayFolder = "./overlays",
  duration = 10,
  renderMode = "topTransparent",
  chromaKeyMode = "color",
  chromaKeyColor = "D4F9D7",
  chromaKeySimilarity = 0.3,
  chromaKeyFile = "",
  keepColorColors = "FBFF02",
  keepColorCrop = false,
  keepColorHeight = 220,
  keepColorYOffset = 490,
  keepColorAddDarkLayer = false,
  useGPU = false,
  gpuVideoCodec = "h264_nvenc",
  opacity = 0.7,
  height = 220,
  y_offset = 490,
  personEnabled = false,
  personPath = "",
  personPos = "center",
  personScale = 0.9,
  bgBlurEnabled = false,
  bgBlur = 20,
  mainScale = 0.85,
  mainOpacity = 0.85,
  frameEnabled = false,
  framePath = "",
  frameScale = 1,
  effectEnabled = false,
  effectPath = "",
  effectOpacity = 0.15,
  effectBlend = "normal",
  effectKeyThreshold = 0.15,
  dualFrameBgPath = "",
  dualFrameFrameEnabled = false,
  dualFrameFramePath = "",
  dualFrameFrameScale = 1,
  dualFrameMainWidth = 960,
  dualFrameMainHeight = 560,
  dualFrameMainX = 40,
  dualFrameMainY = 40,
  dualFrameMainOpacity = 1.0,
  dualFrameSmallWidth = 240,
  dualFrameSmallHeight = 160,
  dualFrameSmallX = 1000,
  dualFrameSmallY = 520,
  dualFrameSmallOpacity = 1.0,
  dualFrameSmallRadius = 0,
  backgroundFolder = "./backgrounds",
  outputFolder = "./test-render-output",
  videoSpeed = 0.95,
} = config;

// Test output folder - sử dụng từ config
const TEST_OUTPUT_DIR = path.isAbsolute(outputFolder) ? outputFolder : path.join(__dirname, outputFolder);
if (!fs.existsSync(TEST_OUTPUT_DIR)) {
  fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
}

console.log(`🧪 Test Render bắt đầu...`);
console.log(`⏱️ Duration: ${duration}s`);
console.log(`🎨 Mode: ${renderMode}`);

// ============ Step 1: Chọn ngẫu nhiên 1 video có sẵn trong folder overlays ============
// Test render là để xem thử NHANH config render trông thế nào, không cần tải video mới —
// dùng luôn 1 video đã có sẵn (ví dụ tải qua Sheet trước đó) là đủ.
function pickRandomOverlayVideo() {
  const dir = path.isAbsolute(overlayFolder) ? overlayFolder : path.join(__dirname, overlayFolder);
  if (!fs.existsSync(dir)) {
    throw new Error(`Không tìm thấy folder overlays: ${dir}`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => path.extname(f).toLowerCase() === ".mp4")
    .map((f) => path.join(dir, f));
  if (!files.length) {
    throw new Error(`Không có video .mp4 nào trong folder overlays: ${dir}`);
  }
  const chosen = files[Math.floor(Math.random() * files.length)];
  console.log(`📁 Video overlay: ${path.basename(chosen)}`);
  return chosen;
}

// ============ Step 2: Cut video to duration ============
async function cutVideo(inputPath, cutDuration) {
  console.log(`\n✂️ Đang cắt ${cutDuration}s từ video...`);

  const timestamp = Date.now();
  const outputPath = path.join(TEST_OUTPUT_DIR, `test_cut_${timestamp}.mp4`);

  return new Promise((resolve, reject) => {
    // Get video duration first
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const totalDuration = metadata.format.duration;
      // Start from middle of video to avoid intro/outro
      const startTime = Math.max(0, (totalDuration - cutDuration) / 2);

      console.log(`📊 Video gốc: ${totalDuration.toFixed(1)}s, cắt từ ${startTime.toFixed(1)}s`);

      ffmpeg(inputPath)
        .setStartTime(startTime)
        .setDuration(cutDuration)
        .outputOptions(["-c", "copy"])
        .output(outputPath)
        .on("end", () => {
          console.log(`✅ Cắt xong: ${outputPath}`);
          resolve(outputPath);
        })
        .on("error", (err) => {
          console.error(`❌ Lỗi cắt video: ${err.message}`);
          reject(err);
        })
        .run();
    });
  });
}

// ============ Step 3: Render video ============
async function renderVideo(overlayPath) {
  console.log(`\n🎬 Đang render video...`);

  // Get random background
  let bgPath = null;
  if (fs.existsSync(backgroundFolder)) {
    const bgFiles = fs.readdirSync(backgroundFolder).filter(f =>
      [".mp4", ".mov", ".avi", ".mkv"].includes(path.extname(f).toLowerCase())
    );
    if (bgFiles.length > 0) {
      const randomBg = bgFiles[Math.floor(Math.random() * bgFiles.length)];
      bgPath = path.join(backgroundFolder, randomBg);
      console.log(`🖼️ Background: ${randomBg}`);
    }
  }

  if (!bgPath) {
    console.error("❌ Không tìm thấy video background trong folder:", backgroundFolder);
    throw new Error("No background video found");
  }

  const timestamp = Date.now();
  const outputPath = path.join(TEST_OUTPUT_DIR, `test_render_${timestamp}.mp4`);

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(overlayPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const videoDuration = metadata.format.duration;
      const newDuration = videoDuration / parseFloat(videoSpeed);

      // Build filter based on mode
      let filterConfig = buildFilter();
      filterConfig.push(`[combined_video]setpts=PTS/${videoSpeed}[final_video_speed]`);
      filterConfig.push(`[overlay_audio]atempo=${videoSpeed}[final_audio_speed]`);

      const command = ffmpeg(bgPath)
        .inputOptions(["-stream_loop", "-1"])
        .input(overlayPath);

      // Input phụ của dualFrame (ảnh nền, khung viền); rỗng với các mode còn lại.
      for (const extra of dualFrameStudioInputs) {
        command.input(extra.file).inputOptions(extra.inputOptions);
      }

      command
        .complexFilter(filterConfig)
        .outputOptions("-t", newDuration)
        .audioCodec("aac")
        .audioFrequency(44100)
        .audioChannels(2)
        .map("[final_video_speed]")
        .map("[final_audio_speed]");

      if (useGPU) {
        command.videoCodec(gpuVideoCodec);
        command.outputOptions(["-preset", "p4", "-rc", "vbr", "-cq", "23"]);
      } else {
        command.videoCodec("libx264");
        command.outputOptions(["-preset", "fast", "-crf", "23"]);
      }

      command
        .output(outputPath)
        .on("start", (cmd) => {
          console.log(`🚀 FFmpeg command started...`);
        })
        .on("progress", (progress) => {
          if (progress.percent) {
            process.stdout.write(`\r⏳ Tiến độ: ${progress.percent.toFixed(1)}%`);
          }
        })
        .on("end", () => {
          console.log(`\n✅ Render xong: ${outputPath}`);
          resolve(outputPath);
        })
        .on("error", (err) => {
          console.error(`\n❌ Lỗi render: ${err.message}`);
          reject(err);
        })
        .run();
    });
  });
}

// Input phụ (ảnh nền, khung viền) mà mode dualFrame cần — buildFilter() nạp lại mỗi lần gọi,
// renderVideo() đọc ra ngay sau đó để thêm đúng input vào ffmpeg command.
let dualFrameStudioInputs = [];

// Build filter based on render mode
function buildFilter() {
  dualFrameStudioInputs = [];
  if (renderMode === "chromaKey") {
    return buildChromaKeyFilter();
  } else if (renderMode === "keepColor") {
    return buildKeepColorFilter();
  } else if (renderMode === "blurFrame") {
    return buildBlurFrameFilter();
  } else if (renderMode === "dualFrame") {
    return buildDualFrameModeFilter();
  } else {
    // Default: topTransparent
    return buildTopTransparentFilter();
  }
}

// Dùng thẳng render-core.js thay vì viết lại filter riêng: mode mới nên tránh nhân bản
// logic sang file thứ 3 (topTransparent/chromaKey/keepColor/blurFrame ở đây là bản cũ,
// đã trùng lặp với render.js và sheet/render-core.js từ trước khi mode này tồn tại).
function buildDualFrameModeFilter() {
  const dfCfg = {
    dualFrameBgPath, dualFrameFrameEnabled, dualFrameFramePath, dualFrameFrameScale,
    dualFrameMainWidth, dualFrameMainHeight, dualFrameMainX, dualFrameMainY, dualFrameMainOpacity,
    dualFrameSmallWidth, dualFrameSmallHeight, dualFrameSmallX, dualFrameSmallY, dualFrameSmallOpacity,
    dualFrameSmallRadius,
  };
  const { bgFile, frameFile, warnings } = resolveDualFrameAssets(dfCfg);
  warnings.forEach((w) => console.warn(w));
  dfCfg.dualFrameBgFile = bgFile;
  dfCfg.dualFrameFrameFile = frameFile;
  dualFrameStudioInputs = buildDualFrameInputs("dualFrame", dfCfg);
  return buildDualFrameFilter("dualFrame", dfCfg);
}

function buildTopTransparentFilter() {
  return [
    "[0:v]scale=1920:1080,fps=30[bg_scaled]",
    `[1:v]scale=1920:-1,fps=30,colorchannelmixer=aa=${opacity}[overlay_scaled]`,
    `[bg_scaled][overlay_scaled]overlay=(W-w)/2:${y_offset}[combined_video]`,
    "[1:a]volume=1.0[overlay_audio]",
  ];
}

function buildChromaKeyFilter() {
  const colorHex = chromaKeyColor.replace("#", "");
  const similarity = chromaKeySimilarity;

  return [
    "[0:v]scale=1920:1080,fps=30[bg_scaled]",
    `[1:v]scale=1920:-1,fps=30,chromakey=0x${colorHex}:${similarity}:0.1[overlay_keyed]`,
    `[bg_scaled][overlay_keyed]overlay=(W-w)/2:${y_offset}[combined_video]`,
    "[1:a]volume=1.0[overlay_audio]",
  ];
}

function buildKeepColorFilter() {
  const colors = keepColorColors.split(",").map(c => c.trim().replace("#", ""));
  const colorFilter = colors.map(c => `colorkey=0x${c}:0.3:0.2`).join(",");

  return [
    "[0:v]scale=1920:1080,fps=30[bg_scaled]",
    keepColorCrop
      ? `[1:v]fps=30,crop=iw:${keepColorHeight}:0:${keepColorYOffset},scale=1920:-1,${colorFilter}[overlay_processed]`
      : `[1:v]fps=30,scale=1920:-1,${colorFilter}[overlay_processed]`,
    `[bg_scaled][overlay_processed]overlay=(W-w)/2:${y_offset}[combined_video]`,
    "[1:a]volume=1.0[overlay_audio]",
  ];
}

function buildBlurFrameFilter() {
  return [
    "[0:v]scale=1920:1080,fps=30[bg_scaled]",
    `[1:v]scale=1920:1080,fps=30,boxblur=${bgBlur}[bg_blurred]`,
    `[1:v]scale=iw*${mainScale}:-1,fps=30[main_scaled]`,
    `[bg_blurred][main_scaled]overlay=(W-w)/2:(H-h)/2:format=auto,colorchannelmixer=aa=${mainOpacity}[combined_video]`,
    "[1:a]volume=1.0[overlay_audio]",
  ];
}

// ============ Step 4: Open result ============
function openResult(filePath) {
  console.log(`\n🎉 Mở video kết quả...`);

  const platform = process.platform;
  let cmd;

  if (platform === "win32") {
    cmd = spawn("cmd", ["/c", "start", "", filePath], { detached: true });
  } else if (platform === "darwin") {
    cmd = spawn("open", [filePath], { detached: true });
  } else {
    cmd = spawn("xdg-open", [filePath], { detached: true });
  }

  cmd.unref();
}

// ============ Cleanup old test files ============
function cleanupOldFiles() {
  const files = fs.readdirSync(TEST_OUTPUT_DIR);
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  for (const file of files) {
    const filePath = path.join(TEST_OUTPUT_DIR, file);
    const stat = fs.statSync(filePath);
    if (now - stat.mtimeMs > maxAge) {
      try {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Đã xóa file cũ: ${file}`);
      } catch (e) {
        // ignore
      }
    }
  }
}

// ============ Main ============
async function main() {
  try {
    // Cleanup old files first
    cleanupOldFiles();

    // Step 1: Chọn video overlay có sẵn (không tải mới)
    const overlayPath = pickRandomOverlayVideo();

    // Step 2: Cut
    const cutPath = await cutVideo(overlayPath, duration);

    // Step 3: Render
    const renderedPath = await renderVideo(cutPath);

    // Step 4: Open result
    openResult(renderedPath);

    // Chỉ xoá file cut tạm — overlayPath là video thật của người dùng, không được đụng vào.
    try {
      fs.unlinkSync(cutPath);
    } catch (e) {
      // ignore cleanup errors
    }

    console.log(`\n✅ Test Render hoàn thành!`);
    console.log(`📁 Output: ${renderedPath}`);

  } catch (error) {
    console.error(`\n❌ Test Render thất bại: ${error.message}`);
    process.exit(1);
  }
}

main();
