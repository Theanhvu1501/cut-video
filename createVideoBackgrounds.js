import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";

ffmpeg.setFfmpegPath(ffmpegPath);

// --- XỬ LÝ THAM SỐ ĐẦU VÀO ---
// Lấy tham số thứ nhất sau tên file. Ví dụ: node index.js 5
const args = process.argv.slice(2);
// Nếu có nhập số thì lấy, nếu không hoặc nhập sai thì mặc định là 3
const inputCount = args[0] && !isNaN(parseInt(args[0])) ? parseInt(args[0]) : 3;

console.log(`🎯 Số lượng video sẽ tạo cho mỗi folder: ${inputCount}`);

// --- CẤU HÌNH ---
const CONFIG = {
  inputRoot: "./output_segments",
  outputRoot: "./backgrounds",

  settings: {
    targetDuration: 60 * 60,
    sourceCount: 10,
    outputCountPerFolder: inputCount, // <--- Đã thay đổi dòng này
    avgClipDuration: 12,
  },
};

// Tạo thư mục output gốc
if (!fs.existsSync(CONFIG.outputRoot)) {
  fs.mkdirSync(CONFIG.outputRoot, { recursive: true });
}

// ... (Giữ nguyên phần còn lại của code từ đoạn này trở xuống: shuffleArray, createLongVideo, main...)

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
    const tempTxtPath = outputFilePath.replace(".mp4", ".txt");
    const totalClipDuration = fileList.length * CONFIG.settings.avgClipDuration;
    const loopsNeeded =
      Math.ceil(CONFIG.settings.targetDuration / totalClipDuration) + 1;

    let fileContent = "";

    for (let i = 0; i < loopsNeeded; i++) {
      fileList.forEach((fileName) => {
        const absPath = path.resolve(inputFolder, fileName).replace(/\\/g, "/");
        fileContent += `file '${absPath}'\n`;
      });
    }

    fs.writeFileSync(tempTxtPath, fileContent);

    console.log(`   ⏳ Đang render: ${path.basename(outputFilePath)}...`);

    ffmpeg()
      .input(tempTxtPath)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c copy", `-t ${CONFIG.settings.targetDuration}`])
      .on("end", () => {
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

      // Vòng lặp này bây giờ sẽ chạy theo số lượng bạn nhập
      for (let i = 1; i <= CONFIG.settings.outputCountPerFolder; i++) {
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
