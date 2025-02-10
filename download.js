import fs from "fs"; // Đọc file
import pLimit from "p-limit"; // Giới hạn số lượng video tải song song
import path from "path";
import sharp from "sharp";
import youtubedl from "youtube-dl-exec"; // Tải video từ YouTube
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import ffmpegFluent from "fluent-ffmpeg";

// Cấu hình FFmpeg cho fluent-ffmpeg
ffmpegFluent.setFfmpegPath(ffmpeg.path);
// Hàm tải video YouTube với định dạng MP4
const downloadVideo = async (url, outputPath) => {
  try {
    const output = path.join(outputPath, "%(title)s.%(ext)s");
    await youtubedl(url, {
      output: output,
      format: "bestvideo[height=720]+bestaudio[ext=m4a]/mp4",
      mergeOutputFormat: "mp4",
      writeThumbnail: true,
      convertThumbnails: "jpg",
    });
    console.log(`Tải video từ ${url} thành công dưới định dạng MP4!`);
  } catch (error) {
    console.error(`Lỗi khi tải video từ ${url}:`, error.message);
  }
};

// Hàm tải nhiều video từ danh sách URL
const downloadVideos = async (filePath, savePath) => {
  if (!fs.existsSync(savePath)) fs.mkdirSync(savePath); // Tạo thư mục nếu chưa có

  // Đọc file chứa danh sách URL
  const urls = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean); // Tách từng dòng và loại bỏ dòng trống

  const limit = pLimit(3); // Giới hạn tối đa 3 video chạy song song

  // Lặp qua từng URL và gọi hàm tải video
  const downloadPromises = urls.map((url) =>
    limit(() => downloadVideo(url, savePath))
  );

  await Promise.all(downloadPromises); // Chạy tất cả các Promise song song với giới hạn
};


const convertCodec = async (directory) => {
  const files = fs.readdirSync(directory);

  for (const file of files) {
    const filePath = path.join(directory, file);
    const ext = path.extname(file).toLowerCase();

    if (ext === ".mp4") {
      const outputFilePath = path.join(directory, "converted_" + file);

      console.log(`🔄 Đang chuyển đổi codec: ${file} -> ${outputFilePath}`);

      await new Promise((resolve, reject) => {
        ffmpegFluent(filePath)
          .videoCodec("libx264")
          .audioCodec("aac")
          .audioBitrate("128k")
          .outputOptions("-preset fast") // Giảm thời gian encode
          .outputOptions("-crf 23") // Chất lượng tốt, dung lượng tối ưu
          .on("end", () => {
            console.log(`✅ Đã chuyển đổi codec: ${file}`);
            fs.unlinkSync(filePath); // Xóa file gốc sau khi convert
            fs.renameSync(outputFilePath, filePath); // Đổi lại tên file thành gốc
            resolve();
          })
          .on("error", (err) => {
            console.error(`❌ Lỗi khi chuyển đổi ${file}: ${err.message}`);
            reject(err);
          })
          .save(outputFilePath);
      });
    }
  }
};

async function processImagesFromFolder(inputDir, overlayDir, outputBaseDir, overlaySize) {
  try {
    if (!fs.existsSync(outputBaseDir)) {
      fs.mkdirSync(outputBaseDir, { recursive: true });
    }

    // Lấy danh sách ảnh overlay
    const overlayFiles = fs.readdirSync(overlayDir)
      .filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file)) // Lọc file ảnh
      .sort((a, b) => parseInt(a) - parseInt(b)); // Sắp xếp theo số

    console.log(`Tìm thấy ${overlayFiles.length} ảnh overlay trong thư mục: ${overlayDir}`);

    // Lấy danh sách ảnh đầu vào
    const inputFiles = fs.readdirSync(inputDir)
      .filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file));

    console.log(`Tìm thấy ${inputFiles.length} ảnh cần xử lý trong thư mục: ${inputDir}`);

    for (let i = 0; i < overlayFiles.length; i++) {
      const overlayPath = path.join(overlayDir, overlayFiles[i]);
      const outputDir = path.join(outputBaseDir, `${i + 1}`); // Tạo folder theo số thứ tự

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      console.log(`Sử dụng overlay: ${overlayFiles[i]} -> Lưu vào ${outputDir}`);

      // Tạo overlay hình tròn
      const overlayCircle = await sharp(overlayPath)
        .resize(overlaySize, overlaySize)
        .composite([{
          input: Buffer.from(
            `<svg width="${overlaySize}" height="${overlaySize}">
              <rect width="100%" height="100%" fill="none"/> 
              <circle cx="${overlaySize / 2}" cy="${overlaySize / 2}" r="${overlaySize / 2}" fill="white" stroke="white"/>
            </svg>`
          ),
          blend: "dest-in",
        }])
        .png()
        .toBuffer();

      for (const file of inputFiles) {
        const inputPath = path.join(inputDir, file);
        const outputPath = path.join(outputDir, file);

        console.log(`Đang xử lý: ${file} với overlay ${overlayFiles[i]}`);

        try {
          // Biến đổi màu và chèn overlay
          const transformedBaseImage = await sharp(inputPath)
            .modulate({ brightness: 1.1, saturation: 1.2, hue: 20 })
            .toBuffer();

          const metadata = await sharp(transformedBaseImage).metadata();
          const x = metadata.width - overlaySize - 10;
          const y = 10;

          await sharp(transformedBaseImage)
            .composite([{ input: overlayCircle, top: y, left: x }])
            .toFile(outputPath);

          console.log(`Lưu ảnh đã xử lý tại: ${outputPath}`);
        } catch (err) {
          console.error(`Lỗi khi xử lý file ${file}:`, err.message);
        }
      }
    }

    console.log("Quá trình xử lý hoàn tất.");
  } catch (err) {
    console.error("Lỗi khi xử lý thư mục:", err.message);
  }
}


async function main() {
  // Đường dẫn tới file chứa các URL


  const filePath = "./urls.txt";
  const savePath = "./overlays"; // Thư mục lưu video tải về
  const overlayDir = "./images"; // Thư mục chứa ảnh overlay
  const outputBaseDir = "./thumbs"; // Thư mục gốc lưu ảnh đã xử lý
  const overlaySize = 125;

  // Gọi hàm tải video
  await downloadVideos(filePath, savePath);
  await convertCodec(savePath);
  await processImagesFromFolder(savePath, overlayDir, outputBaseDir, overlaySize);
}

main(); // Chạy chương trình main() khi chương trình chạy đầu tiên
