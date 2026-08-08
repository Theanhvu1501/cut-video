import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { spawn, spawnSync } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// Bố cục composer: dùng lại compiler chung với luồng Sheet (Task 8) thay vì
// viết lại builder filter riêng cho render.js. sheet/** đã có trong
// build.asarUnpack của package.json nên import này an toàn khi đóng gói
// (xem tests/packaging.test.js).
import { compilePreset } from "./sheet/layer-compiler.js";
import { resolvePresetAssets } from "./sheet/render-core.js";

// Thêm hệ thống log tối ưu
const LOG_LEVEL = {
  ERROR: 0, // Chỉ log lỗi
  WARN: 1, // Log lỗi và cảnh báo
  INFO: 2, // Log thông tin quan trọng
  DEBUG: 3, // Log chi tiết
};

// ================= 0. CẤU HÌNH CHUẨN HÓA (MỚI) =================
const FIXED_FPS = 30;
const FIXED_GOP = FIXED_FPS * 2; // Keyframe mỗi 2 giây
const AUDIO_FREQ = 44100;
const VIDEO_QUALITY = 23;

const currentLogLevel = LOG_LEVEL.INFO; // Mặc định chỉ log thông tin quan trọng
const logFile = "./render.log";

// Hàm log với kiểm soát mức độ
const log = (message, level = LOG_LEVEL.INFO) => {
  if (level <= currentLogLevel) {
    // Log ra console cho thông tin quan trọng
    console.log(message);
  }

  // Luôn ghi tất cả log vào file để debug sau này
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, logMessage);
  } catch (error) {
    console.error(`Lỗi khi ghi log: ${error.message}`);
  }
};

// Hiển thị tiến độ xử lý
let totalVideosToProcess = 0;
let processedVideos = 0;
let errorVideos = 0;

const updateProgress = () => {
  if (totalVideosToProcess > 0) {
    const percent = Math.round((processedVideos / totalVideosToProcess) * 100);
    process.stdout.write(
      `\rTiến độ: ${processedVideos}/${totalVideosToProcess} videos (${percent}%) - Lỗi: ${errorVideos}`
    );
  }
};

// region ========== 1. Đọc tham số dòng lệnh ==========
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Vui lòng cung cấp số ngày và số video dưới dạng tham số.");
  console.error("Cách chạy: node script.js <số ngày> <số video>");
  process.exit(1);
}

const currentDay = parseInt(args[0], 10);
const videosPerFolder = parseInt(args[1], 10);

if (isNaN(currentDay) || currentDay <= 0) {
  console.error("Số ngày phải là một số nguyên dương.");
  process.exit(1);
}

if (isNaN(videosPerFolder) || videosPerFolder <= 0) {
  console.error("Số video mỗi folder phải là một số nguyên dương.");
  process.exit(1);
}
// endregion

// region ========== 2. Ghi currentDay vào file ==========
const currentDayFile = "./currentDay.txt";
try {
  fs.writeFileSync(currentDayFile, currentDay.toString(), {
    encoding: "utf-8",
  });
  log(
    `Đã lưu currentDay (${currentDay}) vào file: ${currentDayFile}`,
    LOG_LEVEL.INFO
  );
} catch (error) {
  log(`Lỗi khi ghi currentDay vào file: ${error.message}`, LOG_LEVEL.ERROR);
}
// endregion

// region ========== 3. Đường dẫn & thư mục ==========
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Chọn FFmpeg path theo NVIDIA-SMI:
// - Nếu NVIDIA-SMI < 560.94: giữ nguyên @ffmpeg-installer/ffmpeg
// - Nếu NVIDIA-SMI > 560.94: dùng ffmpeg từ thư mục bin
// - Nếu không đọc được NVIDIA-SMI: giữ nguyên @ffmpeg-installer/ffmpeg
const NVIDIA_SMI_THRESHOLD = "560.94";
const BIN_FFMPEG_PATH = path.join(__dirname, "bin", "ffmpeg.exe");

const parseNvidiaSmiVersion = (text) => {
  if (!text) return null;
  // Hỗ trợ cả 2 dạng phổ biến:
  // "NVIDIA-SMI 560.94" (một số máy/driver)
  // "NVIDIA-SMI version  : 560.94" (như output trên Windows)
  const m =
    text.match(/NVIDIA-SMI\s+(\d+\.\d+)/i) ||
    text.match(/NVIDIA-SMI\s*version\s*:\s*(\d+\.\d+)/i);
  return m?.[1] ?? null;
};

const compareVersionDot = (a, b) => {
  // So sánh version dạng "560.94" theo [major, minor]
  // Trả về: -1 nếu a<b, 0 nếu a==b, 1 nếu a>b
  const toParts = (v) => {
    const [maj, min = "0"] = String(v || "").split(".");
    const major = Number.parseInt(maj, 10);
    const minor = Number.parseInt(min, 10);
    if (Number.isNaN(major) || Number.isNaN(minor)) return null;
    return [major, minor];
  };

  const pa = toParts(a);
  const pb = toParts(b);
  if (!pa || !pb) return 0;

  if (pa[0] !== pb[0]) return pa[0] > pb[0] ? 1 : -1;
  if (pa[1] !== pb[1]) return pa[1] > pb[1] ? 1 : -1;
  return 0;
};

const pickFfmpegPath = () => {
  try {
    const res = spawnSync("nvidia-smi", ["--version"], {
      encoding: "utf-8",
      windowsHide: true,
    });

    const smiText = `${res?.stdout || ""}\n${res?.stderr || ""}`;
    const smiVersion = parseNvidiaSmiVersion(smiText);
    if (!smiVersion) return ffmpegPath;

    const cmp = compareVersionDot(smiVersion, NVIDIA_SMI_THRESHOLD);
    if (cmp === 1 && fs.existsSync(BIN_FFMPEG_PATH)) {
      return BIN_FFMPEG_PATH;
    }

    return ffmpegPath;
  } catch {
    return ffmpegPath;
  }
};

const SELECTED_FFMPEG_PATH = pickFfmpegPath();
ffmpeg.setFfmpegPath(SELECTED_FFMPEG_PATH);

// Cấu hình FFprobe - sử dụng từ thư mục bin
const FFPROBE_PATH = path.join(__dirname, "bin", "ffprobe.exe");
ffmpeg.setFfprobePath(FFPROBE_PATH);

// Giữ FFMPEG_PATH cho các hàm khác nếu cần
const FFMPEG_PATH = SELECTED_FFMPEG_PATH;

const PROBE_TIMEOUT_MS = 20000;

const firstMeaningfulLine = (text) =>
  String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)[0] || "không rõ lý do";

// fluent-ffmpeg dựng message lỗi bằng utils.extractError, hàm này VỨT BỎ mọi dòng
// stderr bắt đầu bằng "[" — mà lỗi thật của ffmpeg gần như luôn nằm ở đó
// ([h264_nvenc @ ...], [AVFilterGraph @ ...]). Kết quả là chỉ còn lại phần đuôi vô
// nghĩa "frame=0 ... Conversion failed!". Tự bóc lại những dòng có ý nghĩa.
const extractFfmpegError = (stderr) =>
  String(stderr || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    // "Conversion failed!" là dòng cuối mặc định, không nói lên điều gì — bỏ đi
    // để 5 slot còn lại dành cho lý do thật.
    .filter((l) => !/^conversion failed/i.test(l))
    .filter((l) => /error|failed|cannot|unable|no capable|not supported|invalid|denied/i.test(l))
    .slice(-5)
    .join("\n");

// fluent-ffmpeg KHÔNG gán error.code (processor.js chỉ tạo Error với message), nên
// phải bóc mã thoát từ chính message. Windows trả mã âm dưới dạng unsigned 32-bit:
// 4294967256 = -40, nghĩa là ffmpeg abort ngay khi khởi tạo, chưa encode frame nào.
const parseFfmpegExitCode = (message) => {
  const m = /exited with code (-?\d+)/.exec(String(message || ""));
  if (!m) return null;
  const raw = Number(m[1]);
  return raw > 0x7fffffff ? raw - 0x100000000 : raw;
};

const listEncoders = () =>
  new Promise((resolve) => {
    const proc = spawn(FFMPEG_PATH, ["-hide_banner", "-encoders"]);
    let output = "";
    proc.stdout.on("data", (d) => { output += d.toString(); });
    proc.stderr.on("data", (d) => { output += d.toString(); });
    proc.on("close", () => resolve(output));
    proc.on("error", () => resolve(""));
  });

// `ffmpeg -encoders` chỉ cho biết BẢN BUILD có encoder, không cho biết MÁY NÀY chạy
// được: mọi bản ffmpeg Windows phổ biến đều liệt kê h264_nvenc dù máy dùng AMD/Intel
// hay không có NVIDIA. Phải encode thử 1 frame mới biết chắc.
const probeEncoder = (codec) =>
  new Promise((resolve) => {
    const proc = spawn(FFMPEG_PATH, [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "lavfi",
      "-i", "color=c=black:s=256x144:r=30",
      "-frames:v", "1",
      "-c:v", codec,
      "-f", "null",
      "-",
    ]);
    let stderr = "";
    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* tiến trình đã chết */ }
    }, PROBE_TIMEOUT_MS);

    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, reason: firstMeaningfulLine(stderr) });
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: e.message });
    });
  });

// Hàm kiểm tra GPU encoder có THỰC SỰ dùng được trên máy này không
const checkGpuSupport = async (codec) => {
  const { ok, reason } = await probeEncoder(codec);
  if (!ok) {
    log(`⚠️ Encoder ${codec} không dùng được trên máy này: ${reason}`, LOG_LEVEL.WARN);
  }
  return ok;
};

// Ưu tiên theo thứ tự: NVIDIA > Intel > AMD
const GPU_CANDIDATES = [
  { codec: "h264_nvenc", label: "NVIDIA (h264_nvenc)" },
  { codec: "h264_qsv", label: "Intel QuickSync (h264_qsv)" },
  { codec: "h264_amf", label: "AMD AMF (h264_amf)" },
];

// Hàm tự động phát hiện GPU và chọn codec phù hợp
const detectGpuCodec = async () => {
  const encoders = await listEncoders();

  for (const { codec, label } of GPU_CANDIDATES) {
    if (!encoders.includes(codec)) continue;

    const { ok, reason } = await probeEncoder(codec);
    if (ok) {
      log(`✅ Phát hiện GPU: ${label}`, LOG_LEVEL.INFO);
      return codec;
    }
    log(`⚠️ FFmpeg có ${codec} nhưng máy không encode được: ${reason}`, LOG_LEVEL.WARN);
  }

  log("⚠️ Không có GPU encoder nào dùng được. Sẽ sử dụng CPU (libx264)", LOG_LEVEL.WARN);
  return null;
};

let overlayFolder = "./overlays";
let backgroundFolder = "./backgrounds";
let combinedVideosFolder = "./combined_videos";
let outputFolder = "./done";

// GPU
let gpuVideoCodec = "h264_nvenc";
let useGPU = false;
let maxConcurrentProcesses = 2;
let videoSpeed = 0.95;

// VPS
const useAutoUploadVps = false;

// Chế độ render (topTransparent, chromaKey, crop, keepColor)
let renderMode = "topTransparent";
let opacity = 0.7;

// Bố cục composer. render.js không có app của Electron nên không tự tìm được thư mục
// preset — electron-main phải nhét cả object preset vào RENDER_CONFIG_JSON.
let composerPreset = null;

// Chế độ Chroma Key
let color = "D4F9D7";
let chromaKeyFile = "./chromaKey.txt";
let chromaKeyMode = "color"; // "color" hoặc "file"
let chromaKeySimilarity = 0.3;

// VPS
let ipList = "./vps.txt";

// Chế độ giữ màu
let keepColorsList = ["FBFF02"];
const keepSimilarity = 0.2; // Độ sai số màu (0.1 - 0.3 là đẹp)
let keepColorCrop = false;
let keepColorHeight = 220;
let keepColorYOffset = 490;
let keepColorAddDarkLayer = false; // Thêm lớp đen mờ khi có crop

// Chế độ crop
let height = 220;
let y_offset = 490;
// Lớp ảnh người đứng sát mép trên dải crop. Công tắc tách khỏi đường dẫn để tắt
// tạm mà không mất đường dẫn đã chọn.
let personEnabled = false;
let personPath = "";
let personPos = "center"; // left | center | right | random
let personScale = 0.9;

// Chế độ nền mờ + khung (blurFrame): 3 công tắc độc lập, mỗi công tắc tách khỏi
// giá trị của nó để tắt tạm một lớp mà không mất đường dẫn đã chọn.
let bgBlurEnabled = false;
let bgBlur = 20;
let mainScale = 0.85;
let mainOpacity = 0.85;
let frameEnabled = false;
let framePath = "";
let frameScale = 1;
let effectEnabled = false;
let effectPath = "";
let effectOpacity = 0.15;
// "normal" = chồng thẳng như Blend Mode Normal của Premiere (vùng tối vẫn làm tối
// ảnh); "screen" = cộng sáng, vùng đen tự mất; "lumakey" = khử vùng tối rồi chồng.
let effectBlend = "normal";
let effectKeyThreshold = 0.15;
const EFFECT_BLENDS = ["normal", "screen", "lumakey"];

// Đọc config từ project JSON hoặc từ environment variable RENDER_CONFIG_JSON
// Ưu tiên RENDER_CONFIG_JSON (từ options) nếu có, sau đó mới đọc từ project JSON
let config = null;

// Đọc từ environment variable RENDER_CONFIG_JSON trước (cho chạy đồng thời nhiều job)
if (process.env.RENDER_CONFIG_JSON) {
  try {
    config = JSON.parse(process.env.RENDER_CONFIG_JSON);
    log(`Đã đọc config từ RENDER_CONFIG_JSON (jobId: ${process.env.RENDER_JOB_ID || 'N/A'})`, LOG_LEVEL.INFO);
  } catch (error) {
    log(`Lỗi khi parse RENDER_CONFIG_JSON: ${error.message}`, LOG_LEVEL.ERROR);
  }
}

// Nếu không có RENDER_CONFIG_JSON, đọc từ project JSON
if (!config) {
  const projectName = process.env.PROJECT_NAME || "default";
  const projectsDir = process.env.PROJECTS_DIR || path.join(__dirname, "projects");
  const projectConfigPath = path.join(projectsDir, `${projectName}.json`);

  if (fs.existsSync(projectConfigPath)) {
    try {
      const projectContent = fs.readFileSync(projectConfigPath, "utf-8");
      const projectData = JSON.parse(projectContent);
      config = projectData.settings?.render;
      if (config) {
        log(`Đã đọc config từ project: ${projectName}`, LOG_LEVEL.INFO);
      }
    } catch (error) {
      log(`Lỗi khi đọc project config: ${error.message}`, LOG_LEVEL.ERROR);
    }
  }
}

// Áp dụng config nếu có
if (config) {
  if (config.renderMode) renderMode = config.renderMode;
  if (config.preset) composerPreset = config.preset;
  if (config.videoSpeed) videoSpeed = config.videoSpeed;
  if (config.opacity !== undefined) opacity = config.opacity;
  if (config.chromaKeyMode) chromaKeyMode = config.chromaKeyMode;
  if (config.chromaKeyColor) color = config.chromaKeyColor;
  if (config.chromaKeySimilarity !== undefined)
    chromaKeySimilarity = parseFloat(config.chromaKeySimilarity) || 0.3;
  if (config.chromaKeyFile) chromaKeyFile = config.chromaKeyFile;
  if (config.useGPU !== undefined) useGPU = config.useGPU;
  if (config.maxConcurrentProcesses !== undefined)
    maxConcurrentProcesses = parseInt(config.maxConcurrentProcesses) || 2;
  if (config.gpuVideoCodec) {
    gpuVideoCodec = config.gpuVideoCodec;
  }
  // Nếu useGPU được bật nhưng chưa có codec, sẽ tự động phát hiện khi bắt đầu render
  if (config.keepColorColors && Array.isArray(config.keepColorColors)) {
    keepColorsList = config.keepColorColors;
  }
  if (config.keepColorCrop !== undefined)
    keepColorCrop = config.keepColorCrop;
  if (config.keepColorHeight !== undefined)
    keepColorHeight = parseInt(config.keepColorHeight) || 220;
  if (config.keepColorYOffset !== undefined)
    keepColorYOffset = parseInt(config.keepColorYOffset) || 490;
  if (config.keepColorAddDarkLayer !== undefined)
    keepColorAddDarkLayer = config.keepColorAddDarkLayer;
  if (config.height !== undefined) height = config.height;
  if (config.y_offset !== undefined) y_offset = config.y_offset;
  if (config.personEnabled !== undefined) personEnabled = config.personEnabled;
  if (config.personPath) personPath = config.personPath;
  if (["left", "center", "right", "random"].includes(config.personPos))
    personPos = config.personPos;
  if (config.personScale !== undefined)
    personScale = parseFloat(config.personScale) || 0.9;
  if (config.bgBlurEnabled !== undefined) bgBlurEnabled = config.bgBlurEnabled;
  if (config.bgBlur !== undefined) bgBlur = parseFloat(config.bgBlur) || 20;
  if (config.mainScale !== undefined)
    mainScale = parseFloat(config.mainScale) || 0.85;
  if (config.mainOpacity !== undefined)
    mainOpacity = parseFloat(config.mainOpacity) || 0.9;
  if (config.frameEnabled !== undefined) frameEnabled = config.frameEnabled;
  if (config.framePath) framePath = config.framePath;
  if (config.frameScale !== undefined)
    frameScale = parseFloat(config.frameScale) || 1;
  if (config.effectEnabled !== undefined) effectEnabled = config.effectEnabled;
  if (config.effectPath) effectPath = config.effectPath;
  if (config.effectOpacity !== undefined)
    effectOpacity = parseFloat(config.effectOpacity) || 0.15;
  if (config.effectBlend && EFFECT_BLENDS.includes(config.effectBlend))
    effectBlend = config.effectBlend;
  if (config.effectKeyThreshold !== undefined)
    effectKeyThreshold = parseFloat(config.effectKeyThreshold) || 0.15;
  // Đọc đường dẫn từ config
  if (config.overlayFolder) {
    // Nếu là path tuyệt đối, dùng trực tiếp; nếu là tương đối, resolve từ __dirname
    overlayFolder = path.isAbsolute(config.overlayFolder)
      ? config.overlayFolder
      : path.resolve(__dirname, config.overlayFolder);
  }
  if (config.backgroundFolder) {
    backgroundFolder = path.isAbsolute(config.backgroundFolder)
      ? config.backgroundFolder
      : path.resolve(__dirname, config.backgroundFolder);
  }
  if (config.combinedVideosFolder) {
    combinedVideosFolder = path.isAbsolute(config.combinedVideosFolder)
      ? config.combinedVideosFolder
      : path.resolve(__dirname, config.combinedVideosFolder);
  }
  if (config.outputFolder) {
    // Nếu là path tuyệt đối, dùng trực tiếp; nếu là tương đối, resolve từ __dirname
    outputFolder = path.isAbsolute(config.outputFolder)
      ? config.outputFolder
      : path.resolve(__dirname, config.outputFolder);
    log(`Output folder từ config: ${outputFolder}`, LOG_LEVEL.INFO);
  }
  if (config.ipList) ipList = config.ipList;
}

// Dừng ngay thay vì âm thầm rơi về topTransparent: render cả mẻ ra sai bố cục tệ hơn
// nhiều so với dừng sớm và báo rõ.
if (renderMode === "composer" && !composerPreset) {
  log(
    "❌ renderMode là 'composer' nhưng config không có 'preset'. electron-main phải nạp preset và truyền qua RENDER_CONFIG_JSON.",
    LOG_LEVEL.ERROR
  );
  process.exit(1);
}

// Tạo thư mục nếu chưa tồn tạ

// if (fs.existsSync(outputFolder)) {
//   log(`Thư mục ${outputFolder} đã tồn tại, đang xóa...`, LOG_LEVEL.INFO);
//   fs.rmSync(outputFolder, { recursive: true, force: true });
// }

// fs.mkdirSync(outputFolder, { recursive: true });
// endregion

// region ========== 4. Tiện ích đọc file ==========
const getFilesFromFolder = (folder, fileTypes = [".mp4"]) => {
  return fs
    .readdirSync(folder)
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return fileTypes.includes(ext);
    })
    .sort((a, b) => {
      return a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    })
    .map((file) => path.join(folder, file));
};

// Đọc danh sách IP từ file
const readIpList = () => {
  try {
    if (!fs.existsSync(ipList)) {
      log(`⚠️ Không tìm thấy file IP: ${ipList}`, LOG_LEVEL.WARN);
      return [];
    }

    const content = fs.readFileSync(ipList, "utf-8");
    const ips = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    log(`Đã đọc ${ips.length} IP từ file ${ipList}`, LOG_LEVEL.DEBUG);
    return ips;
  } catch (error) {
    log(`❌ Lỗi khi đọc file IP: ${error.message}`, LOG_LEVEL.ERROR);
    return [];
  }
};
// endregion

// region ========== 5. Danh sách file ==========
const overlayFiles = getFilesFromFolder(overlayFolder);

// Đọc danh sách màu chroma key từ file
const readChromaKeyColors = () => {
  const colors = [];

  // Chỉ đọc file khi mode là "file"
  if (chromaKeyMode !== "file") {
    log(
      `Chế độ Chroma Key là "color", không đọc file. Sử dụng màu: #${color}`,
      LOG_LEVEL.DEBUG
    );
    return colors; // Trả về mảng rỗng khi dùng màu
  }

  try {
    if (fs.existsSync(chromaKeyFile)) {
      const content = fs.readFileSync(chromaKeyFile, "utf-8");
      const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));

      for (const line of lines) {
        if (/^[0-9A-Fa-f]{6}$/.test(line)) {
          colors.push(line);
        } else {
          log(
            `Định dạng màu không hợp lệ trong file ${chromaKeyFile}: ${line}`,
            LOG_LEVEL.WARN
          );
        }
      }

      log(
        `Đã đọc ${colors.length} màu chroma key từ file ${chromaKeyFile}`,
        LOG_LEVEL.DEBUG
      );
    } else {
      log(
        `Không tìm thấy file ${chromaKeyFile}, sẽ sử dụng màu mặc định: #${color}`,
        LOG_LEVEL.DEBUG
      );
    }
  } catch (error) {
    log(`Lỗi khi đọc file ${chromaKeyFile}: ${error.message}`, LOG_LEVEL.ERROR);
  }

  return colors;
};

const chromaKeyColors = readChromaKeyColors();
// endregion

// region ========== 6. Tính vị trí video bắt đầu ==========
const calculateStartIndex = (folderIndex, day, totalVideos) => {
  const offset = (day - 1) * videosPerFolder;
  return (folderIndex * videosPerFolder + offset) % totalVideos;
};
// endregion

// region ========== 7. Xử lý video ==========
const complexFilterChromaKey = (inputOverlay) => {
  let videoColor = color; // Mặc định dùng màu từ config

  // Chỉ check file khi mode là "file"
  if (chromaKeyMode === "file") {
    const overlayIndex = overlayFiles.findIndex(
      (file) => file === inputOverlay
    );
    if (overlayIndex >= 0 && overlayIndex < chromaKeyColors.length) {
      videoColor = chromaKeyColors[overlayIndex];
    }
  }
  // Nếu mode là "color", chỉ dùng màu từ config (đã set ở trên)

  const filter = [
    `[1:v]scale=1280:720,colorkey=0x${videoColor}:${chromaKeySimilarity}:0.1,format=yuva420p[overlay_video]`,
  ];


  return [
    filter.join(";"),
    "[0:v][overlay_video]overlay=0:H-h[combined_video]",
    "[1:a]volume=1.0[overlay_audio]",
  ];
};

// Bật công tắc mà đường dẫn hỏng thì bỏ qua lớp đó chứ không cho job chết.
const resolvePersonAsset = () => {
  if (!personEnabled) return "";
  const personFile = pickAsset(personPath, FRAME_EXTS);
  if (!personFile)
    log(
      `⚠️ Bật ảnh người nhưng không tìm được ảnh hợp lệ tại: ${personPath || "(trống)"} — bỏ qua lớp ảnh người`,
      LOG_LEVEL.WARN
    );
  return personFile;
};

// "random" bốc một trong ba vị trí; giá trị lạ rơi về giữa.
const pickPersonPos = (pos) => {
  const p = String(pos ?? "").trim().toLowerCase();
  if (["left", "center", "right"].includes(p)) return p;
  if (p !== "random") return "center";
  const all = ["left", "center", "right"];
  return all[Math.min(2, Math.floor(Math.random() * 3))];
};

// Chiều cao ảnh và toạ độ y sao cho ĐÁY ảnh trùng mép trên dải crop.
const personGeometry = () => {
  const cropH = parseInt(height) || 0;
  const above = Math.max(2, BLURFRAME_BASE_H - cropH);
  const raw = Number(personScale);
  const ratio = raw > 0 && raw <= 1 ? raw : 0.9;
  const h = Math.max(2, evenDown(above * ratio));
  return { h, y: BLURFRAME_BASE_H - cropH - h };
};

const personOverlayX = (pos) =>
  pos === "left" ? "0" : pos === "right" ? "W-w" : "(W-w)/2";

const complexFilterCrop = (personFile) => {
  const filter = [
    `[1:v]scale=1280:720,crop=1280:${height}:0:${y_offset}[cropped]`,
    "[cropped]eq=brightness=-1.0:contrast=3.0:gamma=1.2:saturation=0[filtered]",
    "[filtered]format=yuva420p,colorchannelmixer=aa=0.8[overlay_video]",
  ];

  if (!personFile) {
    return [
      filter.join(";"),
      "[0:v][overlay_video]overlay=0:H-h[combined_video]",
      "[1:a]volume=1.0[overlay_audio]",
    ];
  }

  // scale=-2:h giữ nguyên tỉ lệ gốc; x là biểu thức của ffmpeg nên không cần
  // biết trước chiều rộng ảnh.
  const { h, y } = personGeometry();
  const x = personOverlayX(pickPersonPos(personPos));
  filter.push(`[2:v]scale=-2:${h}[person]`);
  filter.push(`[0:v][person]overlay=${x}:${y}[with_person]`);

  // Dải crop là lớp CUỐI: nó chứa phụ đề nên không được để ảnh che.
  return [
    filter.join(";"),
    "[with_person][overlay_video]overlay=0:H-h[combined_video]",
    "[1:a]volume=1.0[overlay_audio]",
  ];
};

const complexFilterTopTransparent = () => {
  const filter = [
    // 1. Lấy video background [0:v], scale về 1280x720.
    // 2. Thêm kênh alpha (độ trong suốt) và đặt opacity là 0.9 (tức là mờ đi 10%).
    // 3. Đặt tên cho stream này là [top_video].
    `[0:v]scale=1280:720,format=yuva420p,colorchannelmixer=aa=${opacity}[top_video]`,

    // 4. Lấy video overlay [1:v], scale về 1280x720 để cùng kích thước.
    // 5. Đặt tên cho stream này là [base_video].
    "[1:v]scale=1280:720[base_video]",
  ];

  return [
    filter.join(";"), // Nối các bước chuẩn bị lại
    "[base_video][top_video]overlay=0:0[combined_video]", // Đặt [top_video] lên trên [base_video]
    "[1:a]volume=1.0[overlay_audio]", // Vẫn sử dụng âm thanh từ video overlay
  ];
};

// region ========== Chế độ nền mờ + khung (blurFrame) ==========
const BLURFRAME_BASE_W = 1280;
const BLURFRAME_BASE_H = 720;
const FRAME_EXTS = [".png", ".webp"];
const EFFECT_EXTS = [".mp4", ".mov", ".webm", ".mkv"];

// yuv420p yêu cầu chiều rộng/cao chẵn nên phải làm tròn xuống số chẵn.
const evenDown = (value) => {
  const n = Math.round(value);
  return n % 2 === 0 ? n : n - 1;
};

// Hình học của lớp video gốc thu nhỏ, căn giữa khung 1280x720.
const frameGeometry = (scale) => {
  const raw = parseFloat(scale);
  const ratio = raw > 0 && raw <= 1 ? raw : 0.85;
  const w = Math.max(2, evenDown(BLURFRAME_BASE_W * ratio));
  const h = Math.max(2, evenDown(BLURFRAME_BASE_H * ratio));
  return {
    w,
    h,
    x: Math.round((BLURFRAME_BASE_W - w) / 2),
    y: Math.round((BLURFRAME_BASE_H - h) / 2),
  };
};

// Hình học của lớp khung: phóng to/thu nhỏ quanh cùng tâm với vùng video.
// Ảnh PNG khung thường có sẵn viền trong suốt bao quanh hình vẽ, nên phủ khít
// vùng video vẫn thấy khung thụt vào — frameScale > 1 bù đúng phần viền rỗng đó.
// Cho phép vượt 1.0: khung tràn ra ngoài 1280x720 thì overlay toạ độ âm, ffmpeg
// tự cắt phần thừa.
const frameOverlayGeometry = (scale, fScale) => {
  const { w, h } = frameGeometry(scale);
  const raw = parseFloat(fScale);
  const s = raw > 0 ? raw : 1;
  const fw = Math.max(2, evenDown(w * s));
  const fh = Math.max(2, evenDown(h * s));
  return {
    w: fw,
    h: fh,
    x: Math.round((BLURFRAME_BASE_W - fw) / 2),
    y: Math.round((BLURFRAME_BASE_H - fh) / 2),
  };
};

// target trỏ vào file thì dùng đúng file đó; trỏ vào thư mục thì bốc ngẫu nhiên
// một file hợp lệ bên trong. Trả về "" khi thiếu/hỏng để lớp đó bị bỏ qua.
const pickAsset = (target, exts) => {
  if (!target) return "";
  try {
    const stat = fs.statSync(target);
    if (stat.isFile()) return target;
    if (!stat.isDirectory()) return "";
    const files = fs
      .readdirSync(target)
      .filter((f) => exts.includes(path.extname(f).toLowerCase()))
      .sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      );
    if (!files.length) return "";
    return path.join(target, files[Math.floor(Math.random() * files.length)]);
  } catch {
    return "";
  }
};

// Bật công tắc mà đường dẫn hỏng thì bỏ qua lớp đó chứ không cho job chết.
const resolveBlurFrameAssets = () => {
  let frameFile = "";
  let effectFile = "";
  if (frameEnabled) {
    frameFile = pickAsset(framePath, FRAME_EXTS);
    if (!frameFile)
      log(
        `⚠️ Bật khung nhưng không tìm được ảnh khung hợp lệ tại: ${framePath || "(trống)"} — bỏ qua lớp khung`,
        LOG_LEVEL.WARN
      );
  }
  if (effectEnabled) {
    effectFile = pickAsset(effectPath, EFFECT_EXTS);
    if (!effectFile)
      log(
        `⚠️ Bật hiệu ứng nhưng không tìm được video hiệu ứng hợp lệ tại: ${effectPath || "(trống)"} — bỏ qua lớp hiệu ứng`,
        LOG_LEVEL.WARN
      );
  }
  return { frameFile, effectFile };
};

// Các input phụ (sau nền [0] và video gốc [1]) đúng thứ tự filter giả định.
const buildStudioInputs = ({ frameFile, effectFile }) => {
  const inputs = [];
  // Ảnh tĩnh phải -loop 1, nếu không chỉ có đúng 1 khung hình đầu tiên có khung.
  if (frameFile) inputs.push({ file: frameFile, inputOptions: ["-loop", "1"] });
  if (effectFile)
    inputs.push({ file: effectFile, inputOptions: ["-stream_loop", "-1"] });
  return inputs;
};

const complexFilterBlurFrame = ({ frameFile, effectFile }) => {
  const { w, h, x, y } = frameGeometry(mainScale);
  const useBlur = bgBlurEnabled && bgBlur > 0;
  const filters = [];

  // 1. Nền (twitch/pexel) phủ kín khung, làm nhoè nếu bật công tắc.
  filters.push(
    `[0:v]scale=${BLURFRAME_BASE_W}:${BLURFRAME_BASE_H}${useBlur ? `,gblur=sigma=${bgBlur}` : ""}[bf_bg]`
  );
  // 2. Video gốc thu nhỏ theo mainScale, giảm độ đục theo mainOpacity.
  filters.push(
    `[1:v]scale=${w}:${h},format=yuva420p,colorchannelmixer=aa=${mainOpacity}[bf_main]`
  );

  // Nhãn cuối chuỗi luôn phải là [combined_video] nên mỗi bước phải biết nó có
  // phải bước cuối không.
  const label = (isLast, name) => (isLast ? "[combined_video]" : name);
  let stage = label(!frameFile && !effectFile, "[bf_stage1]");
  // shortest=1: nền và hiệu ứng lặp vô hạn, chỉ video gốc là hữu hạn.
  filters.push(`[bf_bg][bf_main]overlay=${x}:${y}:shortest=1${stage}`);

  let idx = 2;
  if (frameFile) {
    // 3. Ảnh PNG khung phủ vùng video, nhân thêm frameScale để bù viền trong suốt.
    const fr = frameOverlayGeometry(mainScale, frameScale);
    filters.push(`[${idx}:v]scale=${fr.w}:${fr.h}[bf_frame]`);
    const next = label(!effectFile, "[bf_stage2]");
    filters.push(`${stage}[bf_frame]overlay=${fr.x}:${fr.y}:shortest=1${next}`);
    stage = next;
    idx++;
  }
  if (effectFile) {
    if (effectBlend === "screen") {
      // 4a. Cộng sáng: vùng đen của hiệu ứng tự mất, nhưng cả khung bị sáng lên.
      filters.push(
        `[${idx}:v]scale=${BLURFRAME_BASE_W}:${BLURFRAME_BASE_H},format=yuv420p[bf_fx]`
      );
      filters.push(
        `${stage}[bf_fx]blend=all_mode=screen:all_opacity=${effectOpacity}:shortest=1[combined_video]`
      );
    } else {
      // 4b. "normal" = Blend Mode Normal của Premiere: chồng thẳng với alpha, vùng
      // tối vẫn làm tối ảnh. "lumakey" khử vùng tối trước khi chồng.
      const key =
        effectBlend === "lumakey"
          ? `,lumakey=threshold=${effectKeyThreshold}:tolerance=0.1:softness=0.1`
          : "";
      filters.push(
        `[${idx}:v]scale=${BLURFRAME_BASE_W}:${BLURFRAME_BASE_H},format=yuva420p${key},colorchannelmixer=aa=${effectOpacity}[bf_fx]`
      );
      filters.push(`${stage}[bf_fx]overlay=0:0:shortest=1[combined_video]`);
    }
    idx++;
  }

  filters.push("[1:a]volume=1.0[overlay_audio]"); // Tiếng vẫn lấy từ video gốc
  return filters;
};
// endregion

const complexFilterKeepColor = () => {
  const filters = [];
  const count = keepColorsList.length;

  // Nếu không có màu nào thì trả về filter mặc định (không lọc)
  if (count === 0) {
    return [
      "[1:v]scale=1280:720[final_isolated]",
      `[0:v][final_isolated]overlay=0:H-h[combined_video]`,
      "[1:a]volume=1.0[overlay_audio]",
    ];
  }

  // 1. CHUẨN BỊ NGUỒN (Xử lý Scale và Crop)
  let baseFilter = `[1:v]scale=1280:720`;
  if (keepColorCrop) {
    // Đảm bảo các biến có giá trị mặc định để tránh lỗi 'undefined'
    const h = keepColorHeight || 720;
    const y = keepColorYOffset || 0;
    baseFilter += `,crop=1280:${h}:0:${y}`;
  }

  let splitOutputs = "[src_main]";
  for (let i = 0; i < count; i++) {
    splitOutputs += `[src_${i}_detect]`;
  }

  // SỬA LỖI TẠI ĐÂY: Thêm dấu phẩy trước split
  filters.push(`${baseFilter},split=${count + 1}${splitOutputs}`);

  // 2. TẠO MASK CHO TỪNG MÀU
  const maskNames = [];
  const similarity = keepSimilarity || 0.1;

  keepColorsList.forEach((hexColor, index) => {
    const maskName = `[mask_${index}]`;
    // Loại bỏ dấu # nếu có trong mã màu
    const cleanHex = hexColor.replace("#", "");

    filters.push(
      `[src_${index}_detect]colorkey=0x${cleanHex}:${similarity}:0.1,alphaextract,negate${maskName}`
    );
    maskNames.push(maskName);
  });

  // 3. GỘP CÁC MASK LẠI
  let currentMask = maskNames[0];
  for (let i = 1; i < maskNames.length; i++) {
    const nextMask = maskNames[i];
    const combinedMaskName = `[combined_mask_${i}]`;
    // Sử dụng blend mode 'max' hoặc 'lighten' để gộp các vùng trắng
    filters.push(
      `${currentMask}${nextMask}blend=all_expr='max(A,B)'${combinedMaskName}`
    );
    currentMask = combinedMaskName;
  }

  // 4. ÁP MASK TỔNG VÀO VIDEO GỐC
  filters.push(`[src_main]${currentMask}alphamerge[final_isolated]`);

  // 5. THÊM LỚP ĐEN MỜ (opacity 0.3) NẾU CÓ CROP VÀ ĐƯỢC BẬT
  if (keepColorCrop && keepColorAddDarkLayer) {
    const h = keepColorHeight || 720;
    // Tạo lớp đen mờ từ video gốc để có cùng duration
    // Lớp đen có kích thước bằng phần crop và opacity 0.3 (alpha = 76.5 ≈ 77)
    let blackFilter = `[1:v]scale=1280:720,crop=1280:${h}:0:${keepColorYOffset || 0}`;
    filters.push(
      `${blackFilter},geq=r=0:g=0:b=0:a=300,format=yuva420p[black_layer]`,
      // Overlay lớp đen lên background trước, sau đó overlay video keepColor lên trên
      `[0:v][black_layer]overlay=0:H-h:shortest=1[bg_with_black]`,
      `[bg_with_black][final_isolated]overlay=0:H-h:shortest=1[combined_video]`
    );

    return [
      filters.join(";"),
      "[1:a]volume=1.0[overlay_audio]",
    ];
  }

  return [
    filters.join(";"),
    `[0:v][final_isolated]overlay=0:H-h:shortest=1[combined_video]`,
    "[1:a]volume=1.0[overlay_audio]",
  ];
};

// forceCpu = true: lần render lại sau khi GPU thất bại (xem handler "error" bên dưới).
const processVideo = async (
  inputOverlay,
  inputBackground,
  outputPath,
  forceCpu = false
) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const gpuForThis = useGPU && !forceCpu;

    ffmpeg.ffprobe(inputOverlay, (err, metadata) => {
      if (err) {
        log(
          `Lỗi khi lấy metadata video overlay: ${err.message}`,
          LOG_LEVEL.ERROR
        );

        processedVideos++;
        errorVideos++;
        updateProgress();
        return reject(err);
      }

      const duration = metadata.format.duration;
      const newDuration = duration / videoSpeed; // Điều chỉnh duration theo tốc độ video

      let filterConfig;
      let studioInputs = [];
      if (renderMode === "blurFrame") {
        const assets = resolveBlurFrameAssets();
        log(
          `🖼️ Sử dụng chế độ Nền mờ + Khung cho ${path.basename(outputPath)}`,
          LOG_LEVEL.DEBUG
        );
        filterConfig = complexFilterBlurFrame(assets);
        studioInputs = buildStudioInputs(assets);
      } else if (renderMode === "keepColor") {
        log(
          `🎨 Sử dụng chế độ GIỮ MÀU (Keep Colors) cho ${path.basename(
            outputPath
          )}`,
          LOG_LEVEL.DEBUG
        );
        filterConfig = complexFilterKeepColor();
      } else if (renderMode === "topTransparent") {
        log(
          `✨ Sử dụng chế độ đè lớp phủ trong suốt cho ${path.basename(
            outputPath
          )}`,
          LOG_LEVEL.DEBUG
        );
        filterConfig = complexFilterTopTransparent();
      } else if (renderMode === "chromaKey") {
        log(
          `🎨 Sử dụng chế độ Chroma Key cho ${path.basename(outputPath)}`,
          LOG_LEVEL.DEBUG
        );
        filterConfig = complexFilterChromaKey(inputOverlay);
      } else if (renderMode === "crop") {
        log(
          `✂️ Sử dụng chế độ Crop cho ${path.basename(outputPath)}`,
          LOG_LEVEL.DEBUG
        );
        // Chốt ảnh một lần rồi mới dựng filter: filter và danh sách input phải
        // khớp nhau về chỉ số [2:v].
        const personFile = resolvePersonAsset();
        filterConfig = complexFilterCrop(personFile);
        if (personFile)
          studioInputs = [{ file: personFile, inputOptions: ["-loop", "1"] }];
      } else if (renderMode === "composer") {
        log(
          `🧩 Dùng bố cục composer "${composerPreset?.name || "?"}" cho ${path.basename(outputPath)}`,
          LOG_LEVEL.DEBUG
        );
        // Chốt asset rồi mới dựng filter, giống hệt nhánh crop ở trên: filter và
        // danh sách input phải khớp nhau về chỉ số [n:v].
        const { preset, warnings } = resolvePresetAssets(composerPreset);
        warnings.forEach((w) => log(w, LOG_LEVEL.WARN));
        const composed = compilePreset(preset);
        composed.warnings.forEach((w) => log(w, LOG_LEVEL.WARN));
        filterConfig = [...composed.filterGraph];
        studioInputs = composed.extraInputs;
      } else {
        // Default to topTransparent if mode is invalid
        log(
          `⚠️ Mode không hợp lệ (${renderMode}), sử dụng Top Transparent cho ${path.basename(
            outputPath
          )}`,
          LOG_LEVEL.WARN
        );
        filterConfig = complexFilterTopTransparent();
      }

      filterConfig.push(`[combined_video]setpts=PTS/${videoSpeed}[final_video_speed]`);
      filterConfig.push(`[overlay_audio]atempo=${videoSpeed}[final_audio_speed]`);

      // Code cũ không có format filter, để nguyên filterConfig

      const command = ffmpeg(inputBackground);

      // Khi dùng complex filter với GPU encoding:
      // - KHÔNG dùng hwaccel cho input vì complex filter xử lý trên CPU
      // - Chỉ dùng GPU cho encoding (videoCodec)
      // - Complex filter sẽ decode trên CPU, xử lý filter, rồi encode bằng GPU

      command.inputOptions(["-stream_loop", "-1"]).input(inputOverlay);

      // Input phụ của blurFrame (khung, hiệu ứng), crop (ảnh người) hoặc composer
      // (mọi lớp image/video/solid); rỗng với 4 mode cũ còn lại.
      for (const extra of studioInputs) {
        // Lớp solid không có file: nó là nguồn sinh của ffmpeg (-f lavfi -i color=…).
        // Dùng ?? chứ không ||: lavfi có thể là chuỗi rỗng và || sẽ rơi về undefined,
        // làm .input(undefined) chết ngay.
        command.input(extra.lavfi ?? extra.file).inputOptions(extra.inputOptions);
      }

      command
        .complexFilter(filterConfig)
        .outputOptions("-t", newDuration)
        .audioCodec("aac")
        .audioFrequency(AUDIO_FREQ)
        .audioChannels(2)
        .map("[final_video_speed]")
        .map("[final_audio_speed]");

      if (gpuForThis) {
        log(
          `🚀 Sử dụng GPU (${gpuVideoCodec}) để render ${path.basename(
            outputPath
          )}`,
          LOG_LEVEL.DEBUG
        );

        // Cấu hình GPU giống code cũ đã chạy được
        if (gpuVideoCodec.includes("nvenc")) {
          // NVIDIA NVENC - dùng cấu hình giống code cũ
          command.videoCodec(gpuVideoCodec).outputOptions([
            "-pix_fmt yuv420p", // Chuẩn màu
            `-r ${FIXED_FPS}`, // FPS cố định
            `-g ${FIXED_GOP}`, // Khoảng cách Keyframe
            `-keyint_min ${FIXED_GOP}`, // Ép cứng Keyframe
            "-sc_threshold 0", // Tắt phát hiện cảnh
            "-preset medium", // Tốc độ render (giống code cũ)
            `-cq:v ${VIDEO_QUALITY}`, // Chất lượng
            "-rc:v vbr", // Bitrate biến thiên
            "-movflags +faststart", // Hỗ trợ xem nhanh/web
          ]);
        } else if (gpuVideoCodec.includes("qsv")) {
          // Intel QuickSync
          command
            .videoCodec(gpuVideoCodec)
            .outputOptions([
              "-preset",
              "medium",
              "-pix_fmt",
              "yuv420p",
              "-movflags",
              "+faststart",
            ]);
        } else if (gpuVideoCodec.includes("amf")) {
          // AMD AMF
          command
            .videoCodec(gpuVideoCodec)
            .outputOptions([
              "-preset",
              "medium",
              "-pix_fmt",
              "yuv420p",
              "-movflags",
              "+faststart",
            ]);
        } else {
          // Fallback nếu codec không xác định
          command
            .videoCodec(gpuVideoCodec)
            .outputOptions(["-pix_fmt", "yuv420p", "-movflags", "+faststart"]);
        }
      } else {
        // Cấu hình CPU cũ
        log(
          `🐌 Sử dụng CPU (ultrafast) để render ${path.basename(outputPath)}`,
          LOG_LEVEL.DEBUG
        );
        command
          .videoCodec("libx264")
          .outputOptions([
            "-preset ultrafast",
            "-pix_fmt yuv420p",
            `-r ${FIXED_FPS}`,
            `-g ${FIXED_GOP}`,
            `-keyint_min ${FIXED_GOP}`,
            "-sc_threshold 0",
            `-crf ${VIDEO_QUALITY}`,
            "-movflags +faststart",
          ]);
      }

      // Thu thập stderr để hiển thị lỗi chi tiết
      let ffmpegStderr = "";

      command
        .on("start", (commandLine) => {
          log(`🔧 FFmpeg command: ${commandLine}`, LOG_LEVEL.DEBUG);
        })
        .on("stderr", (stderrLine) => {
          ffmpegStderr += stderrLine + "\n";
          // Log cảnh báo từ ffmpeg nếu có
          if (
            stderrLine.includes("error") ||
            stderrLine.includes("Error") ||
            stderrLine.includes("failed")
          ) {
            log(`⚠️ FFmpeg: ${stderrLine}`, LOG_LEVEL.WARN);
          }
        })
        .on("end", () => {
          const endTime = Date.now();
          log(
            `✅ Video ${path.basename(outputPath)} hoàn thành trong ${(
              (endTime - startTime) /
              1000
            ).toFixed(2)}s`,
            LOG_LEVEL.DEBUG
          );
          processedVideos++;
          updateProgress();
          resolve();
        })
        .on("error", (error) => {
          const exitCode = parseFfmpegExitCode(error.message);
          const detail = extractFfmpegError(ffmpegStderr);

          log(
            `❌ Lỗi khi xử lý video ${path.basename(outputPath)}: ${
              error.message
            }`,
            LOG_LEVEL.ERROR
          );
          log(
            `❌ Exit code: ${exitCode === null ? "unknown" : exitCode}`,
            LOG_LEVEL.ERROR
          );
          if (detail) {
            log(`❌ FFmpeg báo:\n${detail}`, LOG_LEVEL.ERROR);
          }
          if (ffmpegStderr) {
            log(`❌ FFmpeg stderr đầy đủ:\n${ffmpegStderr}`, LOG_LEVEL.DEBUG);
          }

          // Driver NVIDIA quá cũ — ffmpeg nói thẳng phiên bản tối thiểu cần có.
          const driverMatch = ffmpegStderr.match(
            /minimum required Nvidia driver for nvenc is ([\d.]+)/
          );
          if (driverMatch) {
            log(
              `❌ Driver NVIDIA quá cũ! Cần driver ${driverMatch[1]} hoặc mới hơn. Cập nhật tại https://www.nvidia.com/drivers`,
              LOG_LEVEL.ERROR
            );
          }

          // GPU hỏng thì render lại video này bằng CPU thay vì bỏ luôn. Nếu CPU chạy
          // được thì chính GPU là thủ phạm ⇒ tắt GPU cho các video còn lại.
          if (gpuForThis) {
            log(
              `⚠️ GPU (${gpuVideoCodec}) render thất bại, thử lại bằng CPU: ${path.basename(
                outputPath
              )}`,
              LOG_LEVEL.WARN
            );
            return processVideo(
              inputOverlay,
              inputBackground,
              outputPath,
              true
            )
              .then(() => {
                if (useGPU) {
                  useGPU = false;
                  log(
                    `⚠️ Đã TẮT GPU cho các video còn lại: ${gpuVideoCodec} không encode được trên máy này.`,
                    LOG_LEVEL.WARN
                  );
                }
                resolve();
              })
              .catch(reject);
          }

          processedVideos++;
          errorVideos++;
          updateProgress();
          reject(detail ? new Error(`${error.message}\n${detail}`) : error);
        })
        .save(outputPath);
    });
  });
};
// endregion

// region ========== 8. Xử lý toàn bộ video ==========
const processAllVideos = async () => {
  const startTime = Date.now();
  let totalVideoBackgrounds;
  try {
    // 0. Kiểm tra GPU codec bằng cách encode thử. Luôn kiểm tra kể cả khi người dùng
    // tự chọn codec — chọn tay vẫn có thể chọn nhầm codec máy không chạy được.
    if (useGPU) {
      const probe = gpuVideoCodec
        ? await probeEncoder(gpuVideoCodec)
        : { ok: false, reason: "chưa chọn codec" };

      if (probe.ok) {
        log(`✅ GPU encoder ${gpuVideoCodec} sẵn sàng`, LOG_LEVEL.INFO);
      } else {
        log(
          `⚠️ GPU encoder ${gpuVideoCodec || "(trống)"} không dùng được: ${
            probe.reason
          }`,
          LOG_LEVEL.WARN
        );
        const detectedCodec = await detectGpuCodec();
        if (detectedCodec) {
          gpuVideoCodec = detectedCodec;
          log(`✅ Đã chuyển sang GPU codec: ${gpuVideoCodec}`, LOG_LEVEL.INFO);
        } else {
          log(`⚠️ Không có GPU encoder dùng được, sẽ sử dụng CPU`, LOG_LEVEL.WARN);
          useGPU = false; // Tắt GPU nếu không phát hiện được
        }
      }
    }

    // 1. Kiểm tra video overlay
    const totalOverlays = overlayFiles.length;
    if (totalOverlays === 0) {
      log(
        "❌ Không tìm thấy video overlay nào trong thư mục overlays!",
        LOG_LEVEL.ERROR
      );
      return;
    }

    // 2. Xác định nguồn video background (combined_videos hoặc backgrounds)
    const hasCombinedVideos = fs.existsSync(combinedVideosFolder);
    if (hasCombinedVideos) {
      const combinedVideosFolders = fs
        .readdirSync(combinedVideosFolder)
        .filter((folder) =>
          fs.lstatSync(path.join(combinedVideosFolder, folder)).isDirectory()
        );
      totalVideoBackgrounds = combinedVideosFolders.length;
      log(`Sử dụng video từ thư mục combined_videos`, LOG_LEVEL.INFO);
    } else {
      const backgroundFolders = fs
        .readdirSync(backgroundFolder)
        .filter((folder) =>
          fs.lstatSync(path.join(backgroundFolder, folder)).isDirectory()
        );
      totalVideoBackgrounds = backgroundFolders.length;
      log(`Sử dụng video từ thư mục backgrounds`, LOG_LEVEL.INFO);
    }

    // 3. Kiểm tra số lượng thư mục background
    if (totalVideoBackgrounds === 0) {
      log("❌ Không tìm thấy thư mục background nào!", LOG_LEVEL.ERROR);
      return;
    }

    // 4. Hiển thị thông tin tổng quan về quá trình xử lý
    log(
      `🚀 Bắt đầu xử lý với ${totalOverlays} video overlay và ${totalVideoBackgrounds} thư mục background`,
      LOG_LEVEL.INFO
    );
    log(
      `📅 Ngày hiện tại: ${currentDay}, Số video mỗi folder: ${videosPerFolder}`,
      LOG_LEVEL.INFO
    );
    log(`Tốc độ video: ${videoSpeed}`, LOG_LEVEL.INFO);


    // 5. Tính tổng số video sẽ xử lý
    totalVideosToProcess = totalVideoBackgrounds * videosPerFolder;
    log(`Tổng số video sẽ xử lý: ${totalVideosToProcess}`, LOG_LEVEL.INFO);
    log(
      `Xử lý tối đa ${maxConcurrentProcesses} video cùng lúc`,
      LOG_LEVEL.INFO
    );

    // 6. Xử lý từng folder background
    for (let i = 0; i < totalVideoBackgrounds; i++) {
      const folderName = `${i + 1}`;
      const groupFolder = path.join(outputFolder, folderName);

      // Tạo thư mục output nếu chưa tồn tại
      if (!fs.existsSync(groupFolder)) {
        fs.mkdirSync(groupFolder, { recursive: true });
      }

      // 7. Lấy danh sách file background
      let backgroundFiles = [];
      let totalBackgroundsForFolder = 0;

      if (hasCombinedVideos) {
        // Sử dụng video từ combined_videos
        const combinedVideosFolderPath = path.join(
          combinedVideosFolder,
          folderName
        );
        backgroundFiles = getFilesFromFolder(combinedVideosFolderPath);
        totalBackgroundsForFolder = backgroundFiles.length;
        log(
          `Sử dụng ${totalBackgroundsForFolder} video từ thư mục combined_videos/${folderName}`,
          LOG_LEVEL.INFO
        );
      } else {
        // Sử dụng video từ backgrounds
        const backgroundsFolderPath = path.join(backgroundFolder, folderName);
        backgroundFiles = getFilesFromFolder(backgroundsFolderPath);
        totalBackgroundsForFolder = backgroundFiles.length;
        log(
          `Sử dụng ${totalBackgroundsForFolder} video từ thư mục backgrounds/${folderName}`,
          LOG_LEVEL.INFO
        );
      }

      // 8. Kiểm tra số lượng file background
      if (totalBackgroundsForFolder === 0) {
        log(
          `❌ Không có file background nào cho folder ${folderName}`,
          LOG_LEVEL.ERROR
        );
        // Bỏ qua folder này và cập nhật số lượng video đã xử lý
        processedVideos += videosPerFolder;
        errorVideos += videosPerFolder;
        updateProgress();
        continue;
      }

      log(
        `📁 Đang xử lý folder ${folderName} (${i + 1
        }/${totalVideoBackgrounds})`,
        LOG_LEVEL.INFO
      );

      // 9. Tính vị trí bắt đầu cho ngày hiện tại
      const startIndex = calculateStartIndex(i, currentDay, totalOverlays);

      // 10. Chuẩn bị danh sách công việc
      const tasks = [];

      // 11. Lấy số video từ vị trí bắt đầu
      for (let j = 0; j < videosPerFolder; j++) {
        const overlayIndex = (startIndex + j) % totalOverlays;
        const backgroundIndex = Math.floor(
          Math.random() * totalBackgroundsForFolder
        );

        const overlay = overlayFiles[overlayIndex];
        const background = backgroundFiles[backgroundIndex];

        const overlayFileName = path.basename(overlay, path.extname(overlay));
        const outputPath = path.join(groupFolder, `${overlayFileName}.mp4`);

        if (fs.existsSync(outputPath)) {
          log(
            `👉 Video đã tồn tại, bỏ qua: ${path.basename(outputPath)}`,
            LOG_LEVEL.INFO // Hoặc DEBUG nếu bạn không muốn thấy quá nhiều log
          );
          processedVideos++; // Vẫn tăng biến này để hiển thị đúng tiến độ
          updateProgress();
          continue; // Bỏ qua việc thêm task này và sang vòng lặp tiếp theo
        }

        log(
          `🎬 Chuẩn bị video ${j + 1}/${videosPerFolder}: ${path.basename(
            overlay
          )}`,
          LOG_LEVEL.DEBUG
        );

        tasks.push({
          overlay,
          background,
          outputPath,
        });
      }

      // 12. Xử lý song song với giới hạn số lượng
      const processBatch = async (batch) => {
        return Promise.all(
          batch.map((task) =>
            processVideo(task.overlay, task.background, task.outputPath).catch(
              (error) => {
                // Lỗi đã được xử lý trong hàm processVideo
                log(`Lỗi xử lý video: ${error.message}`, LOG_LEVEL.ERROR);
              }
            )
          )
        );
      };

      // 13. Chia nhỏ công việc thành các batch
      for (let k = 0; k < tasks.length; k += maxConcurrentProcesses) {
        const batch = tasks.slice(k, k + maxConcurrentProcesses);
        await processBatch(batch);
      }

      // 14. Upload lên VPS sau khi xử lý xong folder
      uploadVps(i, folderName);
    }

    // 15. Hiển thị thông tin kết thúc
    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000 / 60).toFixed(2);

    log("\n", LOG_LEVEL.INFO); // Xuống dòng sau khi hiển thị
    log(`✅ Hoàn thành! Tổng thời gian: ${totalTime} phút`, LOG_LEVEL.INFO);
  } catch (error) {
    log(`❌ Lỗi khi xử lý toàn bộ video: ${error.message}`, LOG_LEVEL.ERROR);
  }
};
// endregion

// region ========== 9. Upload VPS ==========
const uploadVps = (index, folderName) => {
  if (!useAutoUploadVps) return;
  // Đọc danh sách IP
  const vpsList = readIpList();
  const vpsName = vpsList[index];
  const currentFolderUpload = path.join(__dirname, outputFolder);
  const echoInfo = `echo Uploading ${currentFolderUpload} to VPS ${vpsName} &&`;
  console.log(`Đang upload folder ${currentFolderUpload} lên VPS ${vpsName}`);

  // Tạo lệnh rclone với dấu ngoặc kép cho các đường dẫn
  const rcloneCmd = `rclone copy "${currentFolderUpload}" "${vpsName}:/" --include "${folderName}/**" --transfers 16 --checkers 8 --progress`;
  const cmd = `${echoInfo} ${rcloneCmd} && exit`;
  // Sử dụng spawn để mở cửa sổ CMD mới và chạy lệnh
  spawn("cmd.exe", ["/c", "start", "cmd.exe", "/c", cmd], {
    detached: true,
    stdio: "ignore",
    windowsVerbatimArguments: true,
  }).unref();

  console.log(`Đã bắt đầu upload folder ${folderName} lên VPS ${vpsName}`);
};
// endregion

// region ========== 9.5 Xóa file trên VPS ==========
const deleteVpsFiles = () => {
  if (!useAutoUploadVps) return;
  const vpsList = readIpList();
  if (vpsList.length === 0) {
    log(`Không tìm thấy danh sách VPS để xóa file`, LOG_LEVEL.WARN);
    return;
  }

  // Lọc các VPS có tên khác nhau để tránh xóa trùng lặp
  const uniqueVps = [...new Set(vpsList)];

  log(`Bắt đầu xóa file trên ${uniqueVps.length} VPS...`, LOG_LEVEL.INFO);

  for (const vpsName of uniqueVps) {
    const deleteCmd = `rclone delete "${vpsName}:/" --rmdirs && exit`;

    log(`Đang xóa file trên VPS ${vpsName}`, LOG_LEVEL.INFO);
    try {
      spawn("cmd.exe", ["/c", "start", "cmd.exe", "/c", deleteCmd], {
        detached: true,
        stdio: "ignore",
        windowsVerbatimArguments: true,
      }).unref();
      log(`Đã xóa file trên VPS ${vpsName}`, LOG_LEVEL.INFO);
    } catch (error) {
      log(
        `Lỗi khi xóa file trên VPS ${vpsName}: ${error.message}`,
        LOG_LEVEL.ERROR
      );
    }
  }

  log(`Hoàn thành xóa file trên các VPS`, LOG_LEVEL.INFO);
};
// endregion
// region ========== 10. Khởi chạy ==========
// Xóa file trên VPS trước khi bắt đầu render
deleteVpsFiles();
processAllVideos().then(() => {
  console.log("🎉 Hoàn tất xử lý tất cả video.");
});
// endregion
