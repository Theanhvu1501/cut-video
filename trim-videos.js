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

// Thư mục chứa video cần cắt
let inputFolder = "./overlays";
// Thư mục lưu video đã cắt
let outputFolder = "./overlays_trimmed";
// Thời điểm bắt đầu cắt (giây)
let startTime = 0;
// Thời lượng cần giữ lại (giây)
let duration = 30;
// Số lượng video xử lý đồng thời
let concurrency = 3;

// Đọc config từ file nếu có
// Kiểm tra CONFIG_DIR environment variable (được set bởi Electron main process)
// Nếu không có, dùng __dirname (cho development)
const configDir = process.env.CONFIG_DIR || __dirname;
const configFilePath = path.join(configDir, ".trim-config.json");
if (fs.existsSync(configFilePath)) {
  try {
    const configContent = fs.readFileSync(configFilePath, "utf-8");
    const config = JSON.parse(configContent);

    if (config.inputFolder) inputFolder = config.inputFolder;
    if (config.outputFolder) outputFolder = config.outputFolder;
    if (config.startTime !== undefined)
      startTime = parseFloat(config.startTime) || 0;
    if (config.duration !== undefined)
      duration = parseFloat(config.duration) || 30;
    if (config.concurrency !== undefined)
      concurrency = parseInt(config.concurrency) || 3;

    console.log(`Đã đọc config từ file: ${configFilePath}`);
  } catch (error) {
    console.error(`Lỗi khi đọc config file: ${error.message}`);
  }
}

// Hàm cắt video
const trimVideo = async (inputFile, outputFile, startTime, duration) => {
  return new Promise((resolve, reject) => {
    console.log(
      `Đang cắt video: ${path.basename(inputFile)} (từ ${startTime}s, độ dài ${duration}s)`
    );

    ffmpeg(inputFile)
      .setStartTime(startTime)
      .setDuration(duration)
      .output(outputFile)
      .outputOptions([
        "-c:v libx264", // Sử dụng codec H.264 cho video
        "-c:a aac", // Sử dụng codec AAC cho audio
        "-b:a 128k", // Bitrate audio 128kbps
        "-preset fast", // Preset encoding nhanh
        "-crf 23", // Chất lượng video (23 là cân bằng giữa chất lượng và dung lượng)
      ])
      .on("start", (commandLine) => {
        console.log(`Bắt đầu cắt: ${path.basename(inputFile)}`);
      })
      .on("progress", (progress) => {
        if (progress.percent) {
          process.stdout.write(`\rTiến độ: ${Math.round(progress.percent)}%`);
        }
      })
      .on("end", () => {
        console.log(
          `\nĐã cắt xong: ${path.basename(inputFile)} -> ${path.basename(
            outputFile
          )}`
        );
        resolve();
      })
      .on("error", (err) => {
        console.error(
          `\nLỗi khi cắt ${path.basename(inputFile)}: ${err.message}`
        );
        reject(err);
      })
      .run();
  });
};

// Hàm chính để cắt tất cả video trong thư mục
const trimAllVideos = async () => {
  try {
    // Tạo thư mục output nếu chưa tồn tại
    if (!fs.existsSync(outputFolder)) {
      fs.mkdirSync(outputFolder, { recursive: true });
      console.log(`Đã tạo thư mục: ${outputFolder}`);
    }

    // Lấy danh sách tất cả các file video trong thư mục input
    const files = fs.readdirSync(inputFolder).filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return [".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext);
    });

    if (files.length === 0) {
      console.log(
        `Không tìm thấy file video nào trong thư mục: ${inputFolder}`
      );
      return;
    }

    console.log(`Tìm thấy ${files.length} video cần cắt`);

    // Giới hạn số lượng video xử lý đồng thời
    const limit = pLimit(concurrency);

    // Tạo danh sách các promise để xử lý tất cả video
    const promises = files.map((file) => {
      const inputFile = path.join(inputFolder, file);
      const outputFile = path.join(outputFolder, file);

      return limit(() => trimVideo(inputFile, outputFile, startTime, duration));
    });

    // Chờ tất cả video được xử lý
    await Promise.all(promises);

    console.log(
      `\n✅ Đã hoàn thành cắt ${files.length} video, mỗi video cắt từ giây ${startTime}, độ dài ${duration} giây`
    );
    console.log(`Các video đã cắt được lưu trong thư mục: ${outputFolder}`);
  } catch (error) {
    console.error(`❌ Lỗi: ${error.message}`);
  }
};

// Thêm tùy chọn để thay thế các video gốc
const replaceOriginals = process.argv.includes("--replace");

// Hàm chính với tùy chọn thay thế
const main = async () => {
  if (replaceOriginals) {
    console.log(
      "⚠️ CHẾ ĐỘ THAY THẾ: Các video gốc sẽ bị thay thế bằng phiên bản đã cắt"
    );

    // Tạo thư mục backup
    const backupFolder = "./overlays_backup";
    if (!fs.existsSync(backupFolder)) {
      fs.mkdirSync(backupFolder, { recursive: true });
    }

    // Sao chép tất cả video gốc vào thư mục backup
    const files = fs.readdirSync(inputFolder).filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return [".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext);
    });

    for (const file of files) {
      const source = path.join(inputFolder, file);
      const destination = path.join(backupFolder, file);
      fs.copyFileSync(source, destination);
    }

    console.log(
      `Đã sao lưu ${files.length} video gốc vào thư mục: ${backupFolder}`
    );
  }

  // Cắt tất cả video
  await trimAllVideos();

  if (replaceOriginals) {
    // Di chuyển các video đã cắt để thay thế video gốc
    const files = fs.readdirSync(outputFolder);

    for (const file of files) {
      const source = path.join(outputFolder, file);
      const destination = path.join(inputFolder, file);

      // Xóa file gốc
      if (fs.existsSync(destination)) {
        fs.unlinkSync(destination);
      }

      // Di chuyển file đã cắt
      fs.renameSync(source, destination);
    }

    console.log(`Đã thay thế ${files.length} video gốc bằng phiên bản đã cắt`);

    // Xóa thư mục output vì không cần nữa
    fs.rmdirSync(outputFolder);
  }
};

// Chạy chương trình
main()
  .then(() => {
    console.log("Hoàn tất!");
  })
  .catch((err) => {
    console.error("Lỗi:", err);
  });
