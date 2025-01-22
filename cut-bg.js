import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
ffmpeg.setFfmpegPath(ffmpegPath);

// Hàm lấy độ dài video
function getVideoDuration(inputFile) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputFile, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata.format.duration); // độ dài video (giây)
      }
    });
  });
}

// Hàm để cắt một đoạn video
function cutVideoSegment(inputFile, outputFile, startTime, duration) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputFile)
      .setStartTime(startTime)
      .setDuration(duration)
      .output(outputFile)
      .videoCodec("copy")
      .noAudio()
      .on("end", () => {
        console.log(`Conversion done for ${outputFile}`);
        resolve();
      })
      .on("error", (err) => {
        console.log(`Error for ${outputFile}:`, err);
        reject(err);
      })
      .run();
  });
}

// Hàm chính xử lý cắt video trong tất cả thư mục
async function processAllVideosInFolders(inputRoot, outputRoot) {
  try {
    const folders = fs.readdirSync(inputRoot).filter((item) => {
      const fullPath = path.join(inputRoot, item);
      return fs.statSync(fullPath).isDirectory(); // Chỉ lấy thư mục
    });

    for (const folder of folders) {
      const inputFolderPath = path.join(inputRoot, folder);
      const outputFolderPath = path.join(outputRoot, folder);

      // Tạo thư mục output nếu chưa tồn tại
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
        const segmentDuration = 3600; // 1 tiếng
        const totalSegments = Math.floor(duration / segmentDuration);

        for (let i = 0; i < totalSegments; i++) {
          const startTime = i * segmentDuration;
          const outputFile = path.join(
            outputFolderPath,
            `${baseVideoName}_done${i + 1}.mp4`
          );

          await cutVideoSegment(
            inputFile,
            outputFile,
            startTime,
            segmentDuration
          );
        }
      }
    }

    console.log("All videos processed successfully.");
  } catch (err) {
    console.error("Error processing videos:", err);
  }
}

// Thư mục nguồn và đích
const inputRoot = "bgs";
const outputRoot = "backgrounds";

// Gọi hàm chính
processAllVideosInFolders(inputRoot, outputRoot);
