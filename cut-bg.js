import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import pLimit from "p-limit";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình FFmpeg - sử dụng từ thư mục bin
const FFMPEG_PATH = path.join(__dirname, "bin", "ffmpeg.exe");
const FFPROBE_PATH = path.join(__dirname, "bin", "ffprobe.exe");
ffmpeg.setFfmpegPath(FFMPEG_PATH);
ffmpeg.setFfprobePath(FFPROBE_PATH);

// Tự động phát hiện GPU encoder (NVIDIA > Intel > AMD). Trả về null nếu không có GPU.
const detectGpuCodec = () => {
  return new Promise((resolve) => {
    const checkProcess = spawn(FFMPEG_PATH, ["-encoders"]);
    let output = "";

    checkProcess.stdout.on("data", (data) => {
      output += data.toString();
    });
    checkProcess.stderr.on("data", (data) => {
      output += data.toString();
    });

    checkProcess.on("close", () => {
      if (output.includes("h264_nvenc")) {
        console.log("✅ Phát hiện GPU: NVIDIA (h264_nvenc)");
        resolve("h264_nvenc");
      } else if (output.includes("h264_qsv")) {
        console.log("✅ Phát hiện GPU: Intel QuickSync (h264_qsv)");
        resolve("h264_qsv");
      } else if (output.includes("h264_amf")) {
        console.log("✅ Phát hiện GPU: AMD AMF (h264_amf)");
        resolve("h264_amf");
      } else {
        console.log("⚠️ Không phát hiện GPU encoder. Sẽ fallback CPU (libx264)");
        resolve(null);
      }
    });

    checkProcess.on("error", () => {
      console.log("❌ Lỗi khi kiểm tra GPU encoder, fallback CPU");
      resolve(null);
    });
  });
};

// Hàm lấy độ dài video
function getVideoDuration(inputFile) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputFile, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata.format.duration);
      }
    });
  });
}

// Áp dụng codec options vào command tuỳ theo GPU/CPU
function applyEncoderOptions(command, gpuCodec) {
  if (gpuCodec && gpuCodec.includes("nvenc")) {
    command.videoCodec(gpuCodec).outputOptions([
      "-pix_fmt yuv420p",
      "-preset p4",
      "-cq:v 28",
      "-rc:v vbr",
      "-movflags +faststart",
    ]);
  } else if (gpuCodec && (gpuCodec.includes("qsv") || gpuCodec.includes("amf"))) {
    command.videoCodec(gpuCodec).outputOptions([
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
    ]);
  } else {
    // CPU fallback — veryfast vì background sẽ bị blur/darken, chất lượng không cần cao
    command.videoCodec("libx264").outputOptions([
      "-crf", "23",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
    ]);
  }
}

// Hàm cắt một đoạn video. Dùng fast seek (-ss trước -i) để tránh decode toàn bộ video trước segment.
function cutVideoSegment(inputFile, outputFile, startTime, duration, options = {}, gpuCodec = null) {
  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputFile)
      .seekInput(startTime) // Fast seek: đặt -ss TRƯỚC -i, không decode từ đầu
      .setDuration(duration)
      .output(outputFile);

    const filters = [];
    if (options.blur) {
      filters.push(`boxblur=${options.blur}`);
    }
    if (options.darken) {
      filters.push(`drawbox=w=iw:h=ih:color=black@${options.darken}:t=fill`);
    }

    if (filters.length > 0) {
      command.videoFilters(filters);
      applyEncoderOptions(command, gpuCodec);
    } else {
      command.videoCodec("copy");
    }

    command
      .noAudio()
      .on("end", () => {
        console.log(`✅ Conversion done for ${path.basename(outputFile)}`);
        resolve();
      })
      .on("error", (err) => {
        console.log(`❌ Error for ${path.basename(outputFile)}:`, err.message);
        reject(err);
      })
      .run();
  });
}

// Hàm chính xử lý cắt video trong tất cả thư mục
async function processAllVideosInFolders(inputRoot, outputRoot, options = {}, gpuCodec = null, maxConcurrent = 2, segmentDuration = 3600) {
  try {
    const folders = fs.readdirSync(inputRoot).filter((item) => {
      const fullPath = path.join(inputRoot, item);
      return fs.statSync(fullPath).isDirectory();
    });

    // Build danh sách phẳng tất cả segments cần cắt → cho phép parallel cross-folder
    const segments = [];

    for (const folder of folders) {
      const inputFolderPath = path.join(inputRoot, folder);
      const outputFolderPath = path.join(outputRoot, folder);

      if (!fs.existsSync(outputFolderPath)) {
        fs.mkdirSync(outputFolderPath, { recursive: true });
      }

      const videos = fs
        .readdirSync(inputFolderPath)
        .filter((file) => file.endsWith(".mp4"));

      for (const video of videos) {
        const inputFile = path.join(inputFolderPath, video);
        const baseVideoName = path.basename(video, ".mp4");
        const duration = await getVideoDuration(inputFile);
        const totalSegments = Math.floor(duration / segmentDuration);

        for (let i = 0; i < totalSegments; i++) {
          const startTime = i * segmentDuration;
          const outputFile = path.join(
            outputFolderPath,
            `${baseVideoName}_done${i + 1}.mp4`,
          );
          segments.push({ inputFile, outputFile, startTime });
        }
      }
    }

    if (segments.length === 0) {
      console.log("ℹ️ Không có segment nào để cắt.");
      return;
    }

    console.log(
      `🚀 Bắt đầu cắt ${segments.length} segment với ${maxConcurrent} ffmpeg song song${gpuCodec ? ` (GPU: ${gpuCodec})` : " (CPU)"}.`,
    );

    const limit = pLimit(maxConcurrent);
    await Promise.all(
      segments.map((seg) =>
        limit(() =>
          cutVideoSegment(
            seg.inputFile,
            seg.outputFile,
            seg.startTime,
            segmentDuration,
            options,
            gpuCodec,
          ).catch((err) => {
            console.error(
              `❌ Segment lỗi (${path.basename(seg.outputFile)}): ${err.message}`,
            );
          }),
        ),
      ),
    );

    console.log("🎉 All videos processed.");
  } catch (err) {
    console.error("Error processing videos:", err);
  }
}

// Thư mục nguồn và đích
let inputRoot = "./bgs";
let outputRoot = "./backgrounds";
let currentOptions = {};
let useGPU = false;
let gpuVideoCodec = null;
let maxConcurrent = 2;
let segmentDuration = 3600; // 1 giờ

// Đọc config từ project JSON (mặc định là "default")
const projectName = process.env.PROJECT_NAME || "default";
const projectsDir =
  process.env.PROJECTS_DIR || path.join(__dirname, "projects");
const projectConfigPath = path.join(projectsDir, `${projectName}.json`);

if (fs.existsSync(projectConfigPath)) {
  try {
    const projectContent = fs.readFileSync(projectConfigPath, "utf-8");
    const projectData = JSON.parse(projectContent);
    const config = projectData.settings?.cutBg;

    if (config) {
      if (config.inputFolder) inputRoot = config.inputFolder;
      if (config.outputFolder) outputRoot = config.outputFolder;
      if (config.darken) currentOptions.darken = config.darken;
      if (config.blur) currentOptions.blur = config.blur;
      if (config.useGPU !== undefined) useGPU = !!config.useGPU;
      if (config.maxConcurrent !== undefined) {
        const parsed = parseInt(config.maxConcurrent);
        if (!isNaN(parsed) && parsed > 0) maxConcurrent = parsed;
      }
      if (config.segmentDuration !== undefined) {
        const parsed = parseInt(config.segmentDuration);
        if (!isNaN(parsed) && parsed > 0) segmentDuration = parsed;
      }

      console.log(`Đã đọc config từ project: ${projectName}`);
    }
  } catch (error) {
    console.error(`Lỗi khi đọc project config: ${error.message}`);
  }
}

// Main: detect GPU nếu được yêu cầu, rồi chạy xử lý
(async () => {
  if (useGPU) {
    gpuVideoCodec = await detectGpuCodec();
  }
  await processAllVideosInFolders(
    inputRoot,
    outputRoot,
    currentOptions,
    gpuVideoCodec,
    maxConcurrent,
    segmentDuration,
  );
})();
