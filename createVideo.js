import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import os from "os";
import pLimit from "p-limit";
import path from "path";
import { fileURLToPath } from "url";

// Cấu hình FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// Cấu hình hiệu suất
const CONFIG = {
  processing: {
    maxConcurrent: Math.max(1, os.cpus().length - 1),
    useHardwareAcceleration: true,
    cleanupTempFiles: true,
  },
  ffmpeg: {
    preset: "veryfast",
    crf: 23,
    threads: 0,
    audioBitrate: "128k",
    timeout: 10 * 60 * 1000,
  },
};

// Đường dẫn
const __filename = fileURLToPath(import.meta.url);
const backgroundFolder = "./backgrounds";
const imageBackgroundFolder = "./image_backgrounds";
const outputFolder = "./combined_videos";
const snowOverlay = "./snow1.mp4";

// Tạo thư mục output nếu chưa tồn tại
if (!fs.existsSync(outputFolder)) {
  fs.mkdirSync(outputFolder, { recursive: true });
  console.log(`Đã tạo thư mục ${outputFolder}`);
}

// Cache cho metadata
const metadataCache = new Map();

// Lấy metadata của video
const getVideoMetadata = async (videoPath) => {
  if (metadataCache.has(videoPath)) {
    return metadataCache.get(videoPath);
  }

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        console.error(`Lỗi khi lấy metadata video: ${err.message}`);
        return reject(err);
      }

      const result = {
        duration: metadata.format.duration,
        width: metadata.streams[0].width,
        height: metadata.streams[0].height,
      };

      metadataCache.set(videoPath, result);
      resolve(result);
    });
  });
};

// --- HÀM XỬ LÝ BACKGROUND LÀ HÌNH ẢNH ---
const createVideoWithImage = async (imagePath, outputPath) => {
  try {
    const snowMetadata = await getVideoMetadata(snowOverlay);
    const duration = snowMetadata.duration;

    console.log(`Đang ghép video với hình ảnh: ${path.basename(imagePath)}`);
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(`Timeout khi xử lý video ${path.basename(imagePath)}`)
        );
      }, CONFIG.ffmpeg.timeout);

      ffmpeg()
        .input(imagePath)
        .loop(1)
        .input(snowOverlay)
        .inputOptions(["-stream_loop", "-1"])
        .complexFilter([
          // [0:v] Xử lý ảnh nền: Scale về HD
          "[0:v]scale=1280:720,setsar=1[bg]",

          // [1:v] Xử lý video tuyết: Scale về HD -> Lọc bỏ màu đen
          // colorkey=0x000000: Chọn màu đen
          // :0.1: Độ dung sai (0.1 để loại bỏ cả màu đen xám xám do nén video)
          // :0.3: Độ mượt viền (giúp bông tuyết không bị răng cưa)
          "[1:v]scale=1280:720,setsar=1,colorkey=0x000000:0.1:0.3[snow]",

          // Ghép tuyết (đã trong suốt) lên nền
          "[bg][snow]overlay=0:0[out]",
        ])
        .outputOptions([
          "-map",
          "[out]",
          "-t",
          duration,
          `-preset ${CONFIG.ffmpeg.preset}`,
          `-crf ${CONFIG.ffmpeg.crf}`,
          `-threads ${CONFIG.ffmpeg.threads}`,
          "-movflags +faststart",
          "-pix_fmt yuv420p",
        ])
        .on("progress", (progress) => {
          if (progress.percent) {
            process.stdout.write(`\rTiến độ: ${Math.round(progress.percent)}%`);
          }
        })
        .on("end", () => {
          clearTimeout(timeout);
          const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
          console.log(
            `\nĐã tạo video thành công: ${outputPath} (${processingTime}s)`
          );
          resolve();
        })
        .on("error", (err) => {
          clearTimeout(timeout);
          console.error(`\nLỗi khi tạo video: ${err.message}`);
          reject(err);
        })
        .save(outputPath);
    });
  } catch (error) {
    console.error(`Lỗi: ${error.message}`);
    throw error;
  }
};

// --- HÀM XỬ LÝ BACKGROUND LÀ VIDEO ---
const createVideoWithBackground = async (backgroundPath, outputPath) => {
  try {
    const bgMetadata = await getVideoMetadata(backgroundPath);
    const duration = bgMetadata.duration;

    console.log(
      `Đang ghép video với background: ${path.basename(backgroundPath)}`
    );
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(`Timeout khi xử lý video ${path.basename(backgroundPath)}`)
        );
      }, CONFIG.ffmpeg.timeout);

      ffmpeg()
        .input(backgroundPath)
        .input(snowOverlay)
        .inputOptions(["-stream_loop", "-1"])
        .complexFilter([
          // [0:v] Scale background về HD
          "[0:v]scale=1280:720,setsar=1[bg]",

          // [1:v] Xử lý tuyết: Scale + Tách nền đen
          "[1:v]scale=1280:720,setsar=1,colorkey=0x000000:0.1:0.3[snow]",

          // Overlay
          "[bg][snow]overlay=0:0[out]",
        ])
        .outputOptions([
          "-map",
          "[out]",
          "-t",
          duration,
          `-preset ${CONFIG.ffmpeg.preset}`,
          `-crf ${CONFIG.ffmpeg.crf}`,
          `-threads ${CONFIG.ffmpeg.threads}`,
          "-movflags +faststart",
        ])
        .on("progress", (progress) => {
          if (progress.percent) {
            process.stdout.write(`\rTiến độ: ${Math.round(progress.percent)}%`);
          }
        })
        .on("end", () => {
          clearTimeout(timeout);
          const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
          console.log(
            `\nĐã tạo video thành công: ${outputPath} (${processingTime}s)`
          );
          resolve();
        })
        .on("error", (err) => {
          clearTimeout(timeout);
          console.error(`\nLỗi khi tạo video: ${err.message}`);
          reject(err);
        })
        .save(outputPath);
    });
  } catch (error) {
    console.error(`Lỗi: ${error.message}`);
    throw error;
  }
};

// --- HÀM CHÍNH ---
const main = async () => {
  try {
    console.log(
      `🚀 Bắt đầu xử lý video với ${CONFIG.processing.maxConcurrent} luồng đồng thời`
    );

    let totalVideos = 0;
    let processedVideos = 0;
    let errorVideos = 0;

    const limit = pLimit(CONFIG.processing.maxConcurrent);
    const tasks = [];

    // Kiểm tra thư mục Image Background
    const hasImageBackgrounds =
      fs.existsSync(imageBackgroundFolder) &&
      fs
        .readdirSync(imageBackgroundFolder)
        .some((folder) =>
          fs.lstatSync(path.join(imageBackgroundFolder, folder)).isDirectory()
        );

    if (hasImageBackgrounds) {
      console.log("Đang xử lý với hình ảnh làm background...");
      const imageFolders = fs
        .readdirSync(imageBackgroundFolder)
        .filter((folder) =>
          fs.lstatSync(path.join(imageBackgroundFolder, folder)).isDirectory()
        );

      for (const folder of imageFolders) {
        const folderPath = path.join(imageBackgroundFolder, folder);
        const outputFolderPath = path.join(outputFolder, folder);

        if (!fs.existsSync(outputFolderPath))
          fs.mkdirSync(outputFolderPath, { recursive: true });

        const images = fs
          .readdirSync(folderPath)
          .filter((file) =>
            [".jpg", ".jpeg", ".png"].includes(path.extname(file).toLowerCase())
          );

        totalVideos += images.length;

        for (const image of images) {
          const imagePath = path.join(folderPath, image);
          const outputPath = path.join(
            outputFolderPath,
            `${path.parse(image).name}.mp4`
          );

          tasks.push(
            limit(() =>
              createVideoWithImage(imagePath, outputPath)
                .then(() => {
                  processedVideos++;
                  updateProgress(processedVideos, totalVideos);
                })
                .catch((error) => {
                  console.error(`Lỗi xử lý ${image}: ${error.message}`);
                  errorVideos++;
                  processedVideos++;
                  updateProgress(processedVideos, totalVideos);
                })
            )
          );
        }
      }
    } else {
      console.log("Đang xử lý với video làm background...");
      const videoFolders = fs
        .readdirSync(backgroundFolder)
        .filter((folder) =>
          fs.lstatSync(path.join(backgroundFolder, folder)).isDirectory()
        );

      for (const folder of videoFolders) {
        const folderPath = path.join(backgroundFolder, folder);
        const outputFolderPath = path.join(outputFolder, folder);

        if (!fs.existsSync(outputFolderPath))
          fs.mkdirSync(outputFolderPath, { recursive: true });

        const videos = fs
          .readdirSync(folderPath)
          .filter((file) => path.extname(file).toLowerCase() === ".mp4");

        totalVideos += videos.length;

        for (const video of videos) {
          const videoPath = path.join(folderPath, video);
          const outputPath = path.join(outputFolderPath, `combined_${video}`);

          tasks.push(
            limit(() =>
              createVideoWithBackground(videoPath, outputPath)
                .then(() => {
                  processedVideos++;
                  updateProgress(processedVideos, totalVideos);
                })
                .catch((error) => {
                  console.error(`Lỗi xử lý ${video}: ${error.message}`);
                  errorVideos++;
                  processedVideos++;
                  updateProgress(processedVideos, totalVideos);
                })
            )
          );
        }
      }
    }

    console.log(`Tổng số video cần xử lý: ${totalVideos}`);
    await Promise.all(tasks);
    if (CONFIG.processing.cleanupTempFiles) metadataCache.clear();
    console.log(
      `\n✅ Hoàn thành! (${processedVideos}/${totalVideos} thành công)`
    );
  } catch (error) {
    console.error(`❌ Lỗi Fatal: ${error.message}`);
  }
};

const updateProgress = (current, total) => {
  const percent = Math.round((current / total) * 100);
  process.stdout.write(`\rTiến độ tổng thể: ${current}/${total} (${percent}%)`);
};

console.time("Thời gian xử lý");
main().finally(() => {
  console.timeEnd("Thời gian xử lý");
});
