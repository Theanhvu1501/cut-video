import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import pLimit from "p-limit";
import path from "path";

// Cấu hình FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// --- CẤU HÌNH ---
const CONFIG = {
  processing: {
    maxConcurrent: 3, // Tự động chỉnh theo số nhân CPU
  },
  video: {
    segmentMin: 30, // Thời lượng ngắn nhất (giây)
    segmentMax: 40, // Thời lượng dài nhất (giây)
  },
  ffmpeg: {
    preset: "veryfast", // veryfast render cho lẹ
    crf: 23,
    timeout: 10 * 60 * 1000,
  },
};

// Đường dẫn
const imageBackgroundFolder = "./image_backgrounds";
const outputRootFolder = "./output_segments";
const snowOverlay = "./snow1.mp4";

// Tạo thư mục gốc output
if (!fs.existsSync(outputRootFolder)) {
  fs.mkdirSync(outputRootFolder, { recursive: true });
}

// Hàm random số
const getRandomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// --- HÀM TẠO 1 SEGMENT ---
const createSegment = async (imagePath, outputPath, duration) => {
  return new Promise((resolve, reject) => {
    // Check nếu file output đã tồn tại thì bỏ qua (để resume nếu chạy lại)
    if (fs.existsSync(outputPath)) {
      return resolve("Skipped");
    }

    const timer = setTimeout(() => {
      reject(new Error("Timeout quá thời gian cho phép"));
    }, CONFIG.ffmpeg.timeout);

    ffmpeg()
      .input(imagePath)
      .loop(1)
      .input(snowOverlay)
      .inputOptions(["-stream_loop", "-1"])
      .complexFilter([
        "[0:v]scale=1280:720,setsar=1[bg]",
        "[1:v]scale=1280:720,setsar=1,colorkey=0x000000:0.1:0.3[snow]",
        "[bg][snow]overlay=0:0[out]",
      ])
      .outputOptions([
        "-map",
        "[out]",
        "-t",
        duration,
        `-preset ${CONFIG.ffmpeg.preset}`,
        `-crf ${CONFIG.ffmpeg.crf}`,
        "-movflags +faststart",
        "-pix_fmt yuv420p",
        "-y", // Ghi đè file nếu có (nếu muốn check exist thì xóa dòng này đi)
      ])
      .on("end", () => {
        clearTimeout(timer);
        resolve(outputPath);
      })
      .on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      })
      .save(outputPath);
  });
};

// --- MAIN ---
const main = async () => {
  try {
    console.log(`🚀 BẮT ĐẦU CHUYỂN ĐỔI TẤT CẢ ẢNH SANG VIDEO`);
    console.log(`⚡ Max Threads: ${CONFIG.processing.maxConcurrent}\n`);

    const limit = pLimit(CONFIG.processing.maxConcurrent);
    const tasks = [];
    let totalImages = 0;

    // 1. Quét danh sách folder
    const folders = fs
      .readdirSync(imageBackgroundFolder)
      .filter((folder) =>
        fs.lstatSync(path.join(imageBackgroundFolder, folder)).isDirectory()
      );

    for (const folderName of folders) {
      const inputFolderPath = path.join(imageBackgroundFolder, folderName);
      const outputFolderPath = path.join(outputRootFolder, folderName);

      // Tạo folder đích
      if (!fs.existsSync(outputFolderPath)) {
        fs.mkdirSync(outputFolderPath, { recursive: true });
      }

      // Lấy danh sách ảnh
      const images = fs
        .readdirSync(inputFolderPath)
        .filter((file) =>
          [".jpg", ".jpeg", ".png"].includes(path.extname(file).toLowerCase())
        );

      if (images.length === 0) continue;

      console.log(
        `📂 Folder "${folderName}": Tìm thấy ${images.length} ảnh -> Đang xử lý...`
      );
      totalImages += images.length;

      // 2. Duyệt qua từng ảnh để tạo video
      for (const imageFile of images) {
        const imagePath = path.join(inputFolderPath, imageFile);

        // Random thời gian cho video này
        const duration = getRandomInt(
          CONFIG.video.segmentMin,
          CONFIG.video.segmentMax
        );

        // Giữ nguyên tên file ảnh, chỉ thay đuôi thành .mp4
        const imageNameWithoutExt = path.parse(imageFile).name;
        const outputFileName = `${imageNameWithoutExt}.mp4`;
        const outputPath = path.join(outputFolderPath, outputFileName);

        // Đẩy task vào hàng đợi
        tasks.push(
          limit(() =>
            createSegment(imagePath, outputPath, duration)
              .then((res) => {
                if (res === "Skipped") {
                  process.stdout.write("S"); // S = Skipped
                } else {
                  process.stdout.write("."); // . = Done
                }
              })
              .catch((err) => {
                console.error(`\n❌ Lỗi [${imageFile}]: ${err.message}`);
              })
          )
        );
      }
    }

    console.log(`\n\n⏳ Đang render tổng cộng ${totalImages} video...`);

    await Promise.all(tasks);

    console.log(`\n\n✅ ĐÃ HOÀN THÀNH TOÀN BỘ!`);
    console.log(`👉 File output nằm tại: ${outputRootFolder}`);
  } catch (error) {
    console.error(`Fatal Error: ${error.message}`);
  }
};

main();
