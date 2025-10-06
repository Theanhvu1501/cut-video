import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import pLimit from "p-limit";
import path from "path";

// Cấu hình FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// Thư mục chứa video cần cắt
const inputFolder = "./overlays";
// Thư mục lưu video đã cắt
const outputFolder = "./overlays_trimmed";
// Thời lượng cần giữ lại (giây)
const duration = 30;
// Số lượng video xử lý đồng thời
const concurrency = 3;

// Hàm cắt video
const trimVideo = async (inputFile, outputFile, duration) => {
  return new Promise((resolve, reject) => {
    console.log(`Đang cắt video: ${path.basename(inputFile)}`);

    ffmpeg(inputFile)
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

      return limit(() => trimVideo(inputFile, outputFile, duration));
    });

    // Chờ tất cả video được xử lý
    await Promise.all(promises);

    console.log(
      `\n✅ Đã hoàn thành cắt ${files.length} video, mỗi video giữ lại ${duration} giây đầu tiên`
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
