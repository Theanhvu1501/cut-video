import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import pLimit from "p-limit";
import path from "path";

// Cấu hình FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// Thư mục gốc chứa video cần cắt
const inputFolder = "./overlays";
// Thư mục gốc lưu video đã cắt
const outputFolder = "./overlays_trimmed";
// Thời lượng cần giữ lại (giây)
const duration = 30;
// Số lượng video xử lý đồng thời
const concurrency = 3;

// --- THAY ĐỔI BẮT ĐẦU TỪ ĐÂY ---

/**
 * Hàm đệ quy để lấy tất cả các file video trong một thư mục và các thư mục con của nó.
 * @param {string} dirPath - Đường dẫn thư mục cần quét.
 * @param {string[]} arrayOfFiles - Mảng tích lũy các đường dẫn file.
 * @returns {string[]} Mảng chứa đường dẫn đầy đủ đến tất cả các file video.
 */
const getAllVideoFiles = (dirPath, arrayOfFiles = []) => {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      // Nếu là thư mục, tiếp tục quét đệ quy
      getAllVideoFiles(fullPath, arrayOfFiles);
    } else {
      // Nếu là file, kiểm tra phần mở rộng có phải là video không
      const ext = path.extname(file).toLowerCase();
      if ([".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext)) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
};

// --- THAY ĐỔI KẾT THÚC TẠI ĐÂY ---

// Hàm cắt video (không thay đổi)
const trimVideo = async (inputFile, outputFile, duration) => {
  return new Promise((resolve, reject) => {
    console.log(`Đang cắt video: ${path.basename(inputFile)}`);

    // --- THAY ĐỔI NHỎ: Tạo thư mục output nếu chưa tồn tại ---
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    // --- KẾT THÚC THAY ĐỔI NHỎ ---

    ffmpeg(inputFile)
      .setDuration(duration)
      .output(outputFile)
      .outputOptions([
        "-c:v libx264",
        "-c:a aac",
        "-b:a 128k",
        "-preset fast",
        "-crf 23",
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
          `\nĐã cắt xong: ${path.basename(inputFile)} -> ${path.relative(
            process.cwd(),
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
    // Tạo thư mục output gốc nếu chưa tồn tại
    if (!fs.existsSync(outputFolder)) {
      fs.mkdirSync(outputFolder, { recursive: true });
      console.log(`Đã tạo thư mục: ${outputFolder}`);
    }

    // --- THAY ĐỔI: Sử dụng hàm mới để lấy tất cả video trong các thư mục con ---
    const files = getAllVideoFiles(inputFolder);
    // --- KẾT THÚC THAY ĐỔI ---

    if (files.length === 0) {
      console.log(
        `Không tìm thấy file video nào trong thư mục: ${inputFolder} và các thư mục con của nó.`
      );
      return;
    }

    console.log(`Tìm thấy ${files.length} video cần cắt`);

    const limit = pLimit(concurrency);

    const promises = files.map((inputFile) => {
      // --- THAY ĐỔI: Tạo đường dẫn output tương ứng với cấu trúc thư mục con ---
      // Lấy đường dẫn tương đối (ví dụ: 'category1/video.mp4')
      const relativePath = path.relative(inputFolder, inputFile);
      // Nối với thư mục output để có đường dẫn đầy đủ (ví dụ: './overlays_trimmed/category1/video.mp4')
      const outputFile = path.join(outputFolder, relativePath);
      // --- KẾT THÚC THAY ĐỔI ---

      return limit(() => trimVideo(inputFile, outputFile, duration));
    });

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

    const backupFolder = "./overlays_backup";
    if (!fs.existsSync(backupFolder)) {
      fs.mkdirSync(backupFolder, { recursive: true });
    }

    // --- THAY ĐỔI: Sử dụng hàm đệ quy để sao lưu ---
    const filesToBackup = getAllVideoFiles(inputFolder);

    for (const file of filesToBackup) {
      const relativePath = path.relative(inputFolder, file);
      const destination = path.join(backupFolder, relativePath);

      // Tạo thư mục backup con nếu chưa tồn tại
      const backupDir = path.dirname(destination);
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      fs.copyFileSync(file, destination);
    }
    // --- KẾT THÚC THAY ĐỔI ---

    console.log(
      `Đã sao lưu ${filesToBackup.length} video gốc vào thư mục: ${backupFolder}`
    );
  }

  // Cắt tất cả video
  await trimAllVideos();

  if (replaceOriginals) {
    // --- THAY ĐỔI: Sử dụng hàm đệ quy để tìm file đã cắt và di chuyển chúng ---
    const trimmedFiles = getAllVideoFiles(outputFolder);

    for (const file of trimmedFiles) {
      const source = file; // file đã là đường dẫn đầy đủ
      const relativePath = path.relative(outputFolder, file);
      const destination = path.join(inputFolder, relativePath);

      // Di chuyển file đã cắt, ghi đè lên file gốc
      fs.renameSync(source, destination);
    }

    console.log(
      `Đã thay thế ${trimmedFiles.length} video gốc bằng phiên bản đã cắt`
    );

    // Xóa thư mục output vì không cần nữa (sử dụng rmSync cho Node v14.14+)
    fs.rmSync(outputFolder, { recursive: true, force: true });
    // --- KẾT THÚC THAY ĐỔI ---
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
