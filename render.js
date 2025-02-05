import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
ffmpeg.setFfmpegPath(ffmpegPath);

// Lấy số ngày và số video từ tham số dòng lệnh
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

// Ghi currentDay vào file
const currentDayFile = "./currentDay.txt"; // Đường dẫn file để lưu currentDay
try {
  fs.writeFileSync(currentDayFile, currentDay.toString(), {
    encoding: "utf-8",
  });
  console.log(`Đã lưu currentDay (${currentDay}) vào file: ${currentDayFile}`);
} catch (error) {
  console.error("Lỗi khi ghi currentDay vào file:", error.message);
}

const overlayFolder = "./overlays"; // Thư mục chứa các video overlay
const backgroundFolder = "./backgrounds"; // Thư mục chứa các thư mục nền (folder_1, folder_2, ...)
const outputFolder = "./done"; // Thư mục xuất file

// Tạo thư mục output nếu chưa tồn tại
if (!fs.existsSync(outputFolder)) {
  fs.mkdirSync(outputFolder, { recursive: true });
}

// Đọc danh sách file từ thư mục và sắp xếp theo tên
const getFilesFromFolder = (folder) => {
  return fs
    .readdirSync(folder)
    .filter((file) => file.endsWith(".mp4"))
    .sort((a, b) => a.localeCompare(b)) // Sắp xếp theo tên file
    .map((file) => path.join(folder, file));
};

// Lấy danh sách overlay và background
const overlayFiles = getFilesFromFolder(overlayFolder);
const backgroundFolders = fs
  .readdirSync(backgroundFolder)
  .filter((folder) =>
    fs.lstatSync(path.join(backgroundFolder, folder)).isDirectory()
  );

// Hàm tính toán vị trí bắt đầu video nền cho mỗi folder
const calculateStartIndex = (folderIndex, day, totalVideos) => {
  return (
    ((day - 1) * videosPerFolder + folderIndex * videosPerFolder) % totalVideos
  );
};

// Hàm xử lý từng cặp overlay và background
const processVideo = (inputOverlay, inputBackground, outputPath) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    ffmpeg.ffprobe(inputOverlay, (err, metadata) => {
      if (err) {
        console.error("Lỗi khi lấy metadata video overlay:", err.message);
        return reject(err);
      }

      const durationOverlay = metadata.format.duration;
      ffmpeg(inputBackground)
        .input(inputOverlay)
        .inputOptions("-ss 6") // Cat 11s daudau
        .inputOptions("-t", durationOverlay) // Cắt video nền theo độ dài video overlay
        .complexFilter([
          "[1:v]scale=1280:720,crop=1280:180:0:440,eq=brightness=-1.0:contrast=3.0:gamma=1.2:saturation=0,format=yuva420p,colorchannelmixer=aa=0.8[overlay_video];" +
            "[0:v][overlay_video]overlay=0:H-h[combined_video];" +
            "[1:a]volume=1.0[overlay_audio]",
        ])
        .outputOptions("-preset", "ultrafast") // Tối ưu tốc độ xử lý
        .outputOptions("-t", durationOverlay) // Cắt video đầu ra sao cho độ dài bằng video overlay
        .audioCodec("aac")
        .map("[combined_video]") // Lấy video stream đã xử lý
        .map("[overlay_audio]") // Lấy audio stream từ video overlay
        .on("end", () => {
          const endTime = Date.now();
          console.log(
            `Xử lý xong video: ${outputPath}. Thời gian: ${(
              (endTime - startTime) /
              1000
            ).toFixed(2)} giây.`
          );
          resolve();
        })
        .on("error", (err) => {
          console.error("Lỗi khi xử lý video:", err.message);
          reject(err);
        })
        .save(outputPath);
    });
  });
};

// Hàm xử lý toàn bộ video
const processAllVideos = async () => {
  const totalOverlays = overlayFiles.length;

  // Duyệt qua từng folder nền
  for (let i = 0; i < backgroundFolders.length; i++) {
    const folderName = `${i + 1}`;
    const groupFolder = path.join(outputFolder, folderName);

    if (!fs.existsSync(groupFolder)) {
      fs.mkdirSync(groupFolder, { recursive: true });
    }

    const backgroundFolderPath = path.join(
      backgroundFolder,
      backgroundFolders[i]
    );
    const backgroundFiles = getFilesFromFolder(backgroundFolderPath);
    const totalBackgrounds = backgroundFiles.length;

    // Tính vị trí bắt đầu cho ngày hiện tại
    const startIndex = calculateStartIndex(i, currentDay, totalOverlays);

    // Lấy số video từ vị trí bắt đầu
    for (let j = 0; j < videosPerFolder; j++) {
      const overlayIndex = (startIndex + j) % totalOverlays; // Đảm bảo không vượt quá số video overlay
      const backgroundIndex = (startIndex + j) % totalBackgrounds; // Đảm bảo không vượt quá số video nền

      const overlay = overlayFiles[overlayIndex];
      const background = backgroundFiles[backgroundIndex];

      const overlayFileName = path.basename(overlay, path.extname(overlay));
      const outputPath = path.join(groupFolder, `${overlayFileName}.mp4`);

      console.log(`Đang xử lý overlay: ${overlay} với nền: ${background}`);
      try {
        await processVideo(overlay, background, outputPath);
      } catch (error) {
        console.error("Lỗi khi xử lý:", error.message);
      }
    }
  }

  console.log("Đã xử lý xong toàn bộ video.");
};

// Chạy xử lý
processAllVideos();
