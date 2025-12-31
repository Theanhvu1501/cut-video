import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";

ffmpeg.setFfmpegPath(ffmpegPath);

// --- CẤU HÌNH ---
const CONFIG = {
  inputRoot: "./output_segments", // Folder chứa các video con (đã tạo ở bước trước)
  outputRoot: "./backgrounds", // Folder chứa video dài thành phẩm

  settings: {
    targetDuration: 60 * 60, // Thời lượng video mong muốn (Giây). Ví dụ: 3600s = 1 giờ
    sourceCount: 10, // Số lượng video con random để ghép (lấy 10 file trộn với nhau)
    outputCountPerFolder: 3, // Số video dài cần tạo ra cho mỗi chủ đề (folder)
    avgClipDuration: 12, // Thời lượng trung bình 1 clip con (để tính toán số lần lặp)
  },
};

// Tạo thư mục output gốc
if (!fs.existsSync(CONFIG.outputRoot)) {
  fs.mkdirSync(CONFIG.outputRoot, { recursive: true });
}

// Hàm xáo trộn mảng (Fisher-Yates Shuffle)
const shuffleArray = (array) => {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};

// Hàm lấy N phần tử ngẫu nhiên
const getRandomFiles = (files, count) => {
  const shuffled = shuffleArray(files);
  return shuffled.slice(0, Math.min(count, files.length));
};

// --- HÀM TẠO 1 VIDEO DÀI ---
const createLongVideo = async (inputFolder, outputFilePath, fileList) => {
  return new Promise((resolve, reject) => {
    // 1. Tạo file text tạm thời chứa danh sách video để concat
    // FFmpeg yêu cầu format: file '/path/to/file.mp4'
    const tempTxtPath = outputFilePath.replace(".mp4", ".txt");

    // Tính toán cần lặp lại danh sách bao nhiêu lần để đủ thời gian
    const totalClipDuration = fileList.length * CONFIG.settings.avgClipDuration;
    const loopsNeeded =
      Math.ceil(CONFIG.settings.targetDuration / totalClipDuration) + 1; // +1 để dư ra rồi cắt

    let fileContent = "";

    for (let i = 0; i < loopsNeeded; i++) {
      // Mỗi vòng lặp lại shuffle nhẹ thứ tự trong 10 file đó cho đỡ chán (tuỳ chọn)
      // Hoặc giữ nguyên thứ tự:
      fileList.forEach((fileName) => {
        // Đường dẫn tuyệt đối an toàn hơn cho FFmpeg
        const absPath = path.resolve(inputFolder, fileName).replace(/\\/g, "/");
        fileContent += `file '${absPath}'\n`;
      });
    }

    fs.writeFileSync(tempTxtPath, fileContent);

    console.log(`   ⏳ Đang render: ${path.basename(outputFilePath)}...`);

    // 2. Chạy lệnh FFmpeg concat
    ffmpeg()
      .input(tempTxtPath)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions([
        "-c copy", // Quan trọng: Copy stream không render lại -> SIÊU NHANH
        `-t ${CONFIG.settings.targetDuration}`, // Cắt đúng thời lượng yêu cầu
      ])
      .on("end", () => {
        // Xóa file temp txt sau khi xong
        if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath);
        resolve();
      })
      .on("error", (err) => {
        if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath);
        reject(err);
      })
      .save(outputFilePath);
  });
};

// --- MAIN ---
const main = async () => {
  try {
    console.log("🚀 BẮT ĐẦU TẠO VIDEO DÀI (MIX)");
    console.log(`⏱️ Thời lượng mục tiêu: ${CONFIG.settings.targetDuration}s`);

    // 1. Quét folder
    if (!fs.existsSync(CONFIG.inputRoot)) {
      throw new Error(`Không tìm thấy folder input: ${CONFIG.inputRoot}`);
    }

    const folders = fs
      .readdirSync(CONFIG.inputRoot)
      .filter((folder) =>
        fs.lstatSync(path.join(CONFIG.inputRoot, folder)).isDirectory()
      );

    for (const folderName of folders) {
      const inputFolderPath = path.join(CONFIG.inputRoot, folderName);
      const outputFolderPath = path.join(CONFIG.outputRoot, folderName);

      // Lấy danh sách video mp4
      const allVideos = fs
        .readdirSync(inputFolderPath)
        .filter((file) => file.endsWith(".mp4"));

      if (allVideos.length === 0) {
        console.log(`⚠️ Folder ${folderName} trống, bỏ qua.`);
        continue;
      }

      console.log(
        `\n📂 Đang xử lý chủ đề: "${folderName}" (${allVideos.length} source videos)`
      );

      if (!fs.existsSync(outputFolderPath)) {
        fs.mkdirSync(outputFolderPath, { recursive: true });
      }

      // Tạo N video theo yêu cầu
      for (let i = 1; i <= CONFIG.settings.outputCountPerFolder; i++) {
        // Lấy ngẫu nhiên sourceCount video (ví dụ 10 file)
        const selectedFiles = getRandomFiles(
          allVideos,
          CONFIG.settings.sourceCount
        );

        const outputFileName = `${folderName}_Mix_0${i}.mp4`;
        const outputPath = path.join(outputFolderPath, outputFileName);

        if (fs.existsSync(outputPath)) {
          console.log(`   ⏭️ Skipped (Đã tồn tại): ${outputFileName}`);
          continue;
        }

        await createLongVideo(inputFolderPath, outputPath, selectedFiles);
        console.log(`   ✅ Xong: ${outputFileName}`);
      }
    }

    console.log("\n🎉 HOÀN TẤT TẤT CẢ!");
  } catch (error) {
    console.error("Lỗi:", error.message);
  }
};

main();
