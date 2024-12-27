const fs = require("fs");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffmpeg = require("fluent-ffmpeg");
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

// Hàm kiểm tra số file đã có trong thư mục hiện tại
function getNextFileIndex() {
  const files = fs.readdirSync("."); // Đọc danh sách file trong thư mục hiện tại
  const videoFiles = files.filter(
    (file) => file.startsWith("video_done") && file.endsWith(".mp4")
  );
  return videoFiles.length + 1;
}

// Hàm chính để cắt video thành các đoạn 1 tiếng
async function splitVideoIntoSegments(inputFile) {
  try {
    const duration = await getVideoDuration(inputFile); // Lấy độ dài video
    const segmentDuration = 3600; // Thời lượng mỗi đoạn là 1 tiếng (3600 giây)
    const totalSegments = Math.floor(duration / segmentDuration); // Số lượng đoạn 1 tiếng

    // Tạo danh sách các Promise để chạy song song
    const promises = [];
    for (let i = 0; i < totalSegments; i++) {
      const startTime = i * segmentDuration;
      const outputFile = `video_done${getNextFileIndex() + i}.mp4`;
      promises.push(
        cutVideoSegment(inputFile, outputFile, startTime, segmentDuration)
      );
    }

    // Chạy tất cả các Promise đồng thời
    await Promise.all(promises);
    console.log("All segments processed");
  } catch (err) {
    console.log("Error processing segments:", err);
  }
}

// Gọi hàm để cắt video
splitVideoIntoSegments("video.mp4");
