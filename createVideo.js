import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

// Cấu hình FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

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

// Cache cho avatar
const avatarCache = new Map();

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

    return new Promise((resolve, reject) => {
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
          "-preset",
          "veryfast",
          "-crf",
          "23",
        ])
        .on("progress", (progress) => {
          if (progress.percent) {
            process.stdout.write(`\rTiến độ: ${Math.round(progress.percent)}%`);
          }
        })
        .on("end", () => {
          console.log(`\nĐã tạo video thành công: ${outputPath}`);
          resolve();
        })
        .on("error", (err) => {
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

    return new Promise((resolve, reject) => {
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
          "-preset",
          "veryfast",
          "-crf",
          "23",
        ])
        .on("progress", (progress) => {
          if (progress.percent) {
            process.stdout.write(`\rTiến độ: ${Math.round(progress.percent)}%`);
          }
        })
        .on("end", () => {
          console.log(`\nĐã tạo video thành công: ${outputPath}`);
          resolve();
        })
        .on("error", (err) => {
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

        for (const image of images) {
          const imagePath = path.join(folderPath, image);
          const outputPath = path.join(
            outputFolderPath,
            `${path.parse(image).name}.mp4`
          );

          await createVideoWithImage(imagePath, outputPath, avatarPath);
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

        for (const video of videos) {
          const videoPath = path.join(folderPath, video);
          const outputPath = path.join(outputFolderPath, `combined_${video}`);

          await createVideoWithBackground(videoPath, outputPath, avatarPath);
        }
      }
    }

    console.log("✅ Hoàn thành tất cả các video!");
  } catch (error) {
    console.error(`❌ Lỗi trong quá trình xử lý: ${error.message}`);
  }
};

// Chạy chương trình
main();
