import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import os from "os";
import pLimit from "p-limit";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

// Cấu hình FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// Cấu hình hiệu suất
const CONFIG = {
  processing: {
    maxConcurrent: Math.max(1, os.cpus().length - 1), // Sử dụng tất cả CPU trừ 1
    useHardwareAcceleration: true,
    cleanupTempFiles: true,
  },
  ffmpeg: {
    preset: "veryfast", // Preset encoding nhanh
    crf: 23, // Chất lượng video (18-28, thấp = chất lượng cao)
    threads: 0, // Sử dụng tất cả thread
    audioBitrate: "128k",
    timeout: 10 * 60 * 1000, // 10 phút timeout
  },
};

// Đường dẫn
const __filename = fileURLToPath(import.meta.url);
const backgroundFolder = "./backgrounds";
const imageBackgroundFolder = "./image_backgrounds";
const outputFolder = "./combined_videos";
const avatarFolder = "./images";
const snowOverlay = "./snow1.mov";

// Tạo thư mục output nếu chưa tồn tại
if (!fs.existsSync(outputFolder)) {
  fs.mkdirSync(outputFolder, { recursive: true });
  console.log(`Đã tạo thư mục ${outputFolder}`);
}

// Cache cho avatar và metadata
const avatarCache = new Map();
const metadataCache = new Map();

// Tạo avatar hình tròn
const createCircularAvatar = async (avatarPath, size = 100) => {
  // Kiểm tra cache trước
  const cacheKey = `${avatarPath}_${size}`;
  if (avatarCache.has(cacheKey)) {
    return avatarCache.get(cacheKey);
  }

  const tempPath = avatarPath.replace(".jpg", `_circular_${size}.png`);

  // Kiểm tra nếu file đã tồn tại
  if (fs.existsSync(tempPath)) {
    avatarCache.set(cacheKey, tempPath);
    return tempPath;
  }

  await sharp(avatarPath)
    .resize(size, size)
    .composite([
      {
        input: Buffer.from(
          `<svg><circle cx="${size / 2}" cy="${size / 2}" r="${
            size / 2
          }" fill="rgba(255, 255, 255, 0.5)" /></svg>`
        ),
        blend: "dest-in",
      },
    ])
    .png()
    .toFile(tempPath);

  avatarCache.set(cacheKey, tempPath);
  return tempPath;
};

// Lấy metadata của video (độ dài)
const getVideoMetadata = async (videoPath) => {
  // Kiểm tra cache
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

// Hàm ghép video với hình ảnh
const createVideoWithImage = async (imagePath, outputPath, avatarPath) => {
  try {
    // Tạo avatar hình tròn
    const circularAvatarPath = await createCircularAvatar(avatarPath);

    // Lấy metadata của video snow
    const snowMetadata = await getVideoMetadata(snowOverlay);
    const duration = snowMetadata.duration;

    console.log(`Đang ghép video với hình ảnh: ${path.basename(imagePath)}`);
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      // Thiết lập timeout
      const timeout = setTimeout(() => {
        reject(
          new Error(`Timeout khi xử lý video ${path.basename(imagePath)}`)
        );
      }, CONFIG.ffmpeg.timeout);

      ffmpeg()
        .input(imagePath)
        .loop(1)
        .input(snowOverlay)
        .input(circularAvatarPath)
        .inputOptions(["-stream_loop", "-1"])
        .complexFilter([
          "[0:v]scale=1280:720,setsar=1[bg]",
          "[bg][1:v]overlay=0:0[temp]",
          "[temp][2:v]overlay=W-w-10:10[out]",
        ])
        .outputOptions([
          "-map",
          "[out]",
          "-t",
          duration,
          `-preset ${CONFIG.ffmpeg.preset}`,
          `-crf ${CONFIG.ffmpeg.crf}`,
          `-threads ${CONFIG.ffmpeg.threads}`,
          "-movflags +faststart", // Tối ưu cho streaming
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

// Hàm ghép video với video background
const createVideoWithBackground = async (
  backgroundPath,
  outputPath,
  avatarPath
) => {
  try {
    // Tạo avatar hình tròn
    const circularAvatarPath = await createCircularAvatar(avatarPath);

    // Lấy metadata của video background
    const bgMetadata = await getVideoMetadata(backgroundPath);
    const duration = bgMetadata.duration;

    console.log(
      `Đang ghép video với background: ${path.basename(backgroundPath)}`
    );
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      // Thiết lập timeout
      const timeout = setTimeout(() => {
        reject(
          new Error(`Timeout khi xử lý video ${path.basename(backgroundPath)}`)
        );
      }, CONFIG.ffmpeg.timeout);

      ffmpeg()
        .input(backgroundPath)
        .input(snowOverlay)
        .input(circularAvatarPath)
        .inputOptions(["-stream_loop", "-1"])
        .complexFilter([
          "[0:v]scale=1280:720,setsar=1[bg]",
          "[bg][1:v]overlay=0:0[temp]",
          "[temp][2:v]overlay=W-w-10:10[out]",
        ])
        .outputOptions([
          "-map",
          "[out]",
          "-t",
          duration,
          `-preset ${CONFIG.ffmpeg.preset}`,
          `-crf ${CONFIG.ffmpeg.crf}`,
          `-threads ${CONFIG.ffmpeg.threads}`,
          "-movflags +faststart", // Tối ưu cho streaming
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

// Hàm chính
const main = async () => {
  try {
    console.log(
      `🚀 Bắt đầu xử lý video với ${CONFIG.processing.maxConcurrent} luồng đồng thời`
    );
    console.log(
      `💻 Thông tin hệ thống: ${os.cpus().length} CPU, ${Math.round(
        os.totalmem() / 1024 / 1024 / 1024
      )}GB RAM`
    );

    // Đếm tổng số video cần xử lý
    let totalVideos = 0;
    let processedVideos = 0;
    let errorVideos = 0;

    // Giới hạn số lượng xử lý đồng thời
    const limit = pLimit(CONFIG.processing.maxConcurrent);
    const tasks = [];

    // Kiểm tra xem có thư mục hình ảnh không
    const hasImageBackgrounds =
      fs.existsSync(imageBackgroundFolder) &&
      fs
        .readdirSync(imageBackgroundFolder)
        .some((folder) =>
          fs.lstatSync(path.join(imageBackgroundFolder, folder)).isDirectory()
        );

    if (hasImageBackgrounds) {
      // Xử lý với hình ảnh
      console.log("Đang xử lý với hình ảnh làm background...");

      const imageFolders = fs
        .readdirSync(imageBackgroundFolder)
        .filter((folder) =>
          fs.lstatSync(path.join(imageBackgroundFolder, folder)).isDirectory()
        );

      for (const folder of imageFolders) {
        const folderPath = path.join(imageBackgroundFolder, folder);
        const outputFolderPath = path.join(outputFolder, folder);
        const avatarPath = path.join(avatarFolder, `${folder}.jpg`);

        if (!fs.existsSync(avatarPath)) {
          console.warn(
            `Không tìm thấy avatar cho folder ${folder}, đang bỏ qua...`
          );
          continue;
        }

        if (!fs.existsSync(outputFolderPath)) {
          fs.mkdirSync(outputFolderPath, { recursive: true });
        }

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
              createVideoWithImage(imagePath, outputPath, avatarPath)
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
      // Xử lý với video background
      console.log("Đang xử lý với video làm background...");

      const videoFolders = fs
        .readdirSync(backgroundFolder)
        .filter((folder) =>
          fs.lstatSync(path.join(backgroundFolder, folder)).isDirectory()
        );

      for (const folder of videoFolders) {
        const folderPath = path.join(backgroundFolder, folder);
        const outputFolderPath = path.join(outputFolder, folder);
        const avatarPath = path.join(avatarFolder, `${folder}.jpg`);

        if (!fs.existsSync(avatarPath)) {
          console.warn(
            `Không tìm thấy avatar cho folder ${folder}, đang bỏ qua...`
          );
          continue;
        }

        if (!fs.existsSync(outputFolderPath)) {
          fs.mkdirSync(outputFolderPath, { recursive: true });
        }

        const videos = fs
          .readdirSync(folderPath)
          .filter((file) => path.extname(file).toLowerCase() === ".mp4");

        totalVideos += videos.length;

        for (const video of videos) {
          const videoPath = path.join(folderPath, video);
          const outputPath = path.join(outputFolderPath, `combined_${video}`);

          tasks.push(
            limit(() =>
              createVideoWithBackground(videoPath, outputPath, avatarPath)
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

    // Chờ tất cả các task hoàn thành
    await Promise.all(tasks);

    // Dọn dẹp cache nếu được cấu hình
    if (CONFIG.processing.cleanupTempFiles) {
      for (const tempPath of avatarCache.values()) {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      }
      avatarCache.clear();
      metadataCache.clear();
    }

    console.log(
      `\n✅ Hoàn thành tất cả các video! (${processedVideos}/${totalVideos}, ${errorVideos} lỗi)`
    );
  } catch (error) {
    console.error(`❌ Lỗi trong quá trình xử lý: ${error.message}`);
  }
};

// Hàm hiển thị tiến độ
const updateProgress = (current, total) => {
  const percent = Math.round((current / total) * 100);
  process.stdout.write(`\rTiến độ tổng thể: ${current}/${total} (${percent}%)`);
};

// Chạy chương trình
console.time("Thời gian xử lý");
main().finally(() => {
  console.timeEnd("Thời gian xử lý");
});
