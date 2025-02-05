import fs from "fs"; // Đọc file
import pLimit from "p-limit"; // Giới hạn số lượng video tải song song
import path from "path";
import sharp from "sharp";
import youtubedl from "youtube-dl-exec"; // Tải video từ YouTube
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

async function processImagesFromFolder(
  inputDir,
  overlayPath,
  outputDir,
  overlaySize
) {
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const files = fs.readdirSync(inputDir).filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
    });

    console.log(
      `Tìm thấy ${files.length} file cần xử lý trong thư mục: ${inputDir}`
    );

    // Tạo overlay hình tròn với nền trong suốt
    const overlayCircle = await sharp(overlayPath)
      .resize(overlaySize, overlaySize)
      .composite([
        {
          input: Buffer.from(
            `<svg width="${overlaySize}" height="${overlaySize}">
              <rect width="100%" height="100%" fill="none"/> 
              <circle cx="${overlaySize / 2}" cy="${overlaySize / 2}" r="${
              overlaySize / 2
            }" fill="white" stroke="white"/>
            </svg>`
          ),
          blend: "dest-in",
        },
      ])
      .png() // Chuyển sang PNG để hỗ trợ nền trong suốt
      .toBuffer();

    for (const file of files) {
      const inputPath = path.join(inputDir, file);
      const outputPath = path.join(outputDir, file);

      console.log(`Đang xử lý: ${file}`);

      try {
        // Biến đổi màu và chèn overlay hình tròn
        const transformedBaseImage = await sharp(inputPath)
          .modulate({
            brightness: 1.1, // Tăng độ sáng 10%
            saturation: 1.2, // Tăng độ bão hòa 20%
            hue: 20, // Đổi tông màu (50 độ)
          })
          .toBuffer();

        // Lấy kích thước ảnh gốc
        const metadata = await sharp(transformedBaseImage).metadata();
        const x = metadata.width - overlaySize - 10;
        const y = 10;

        // Chèn overlay hình tròn vào ảnh gốc
        await sharp(transformedBaseImage)
          .composite([{ input: overlayCircle, top: y, left: x }])
          .toFile(outputPath);

        console.log(`Lưu ảnh đã xử lý tại: ${outputPath}`);
      } catch (err) {
        console.error(`Lỗi khi xử lý file ${file}:`, err.message);
      }
    }

    console.log("Quá trình xử lý hoàn tất.");
  } catch (err) {
    console.error("Lỗi khi xử lý thư mục:", err.message);
  }
}

async function main() {
  // Đường dẫn tới file chứa các URL
  const filePath = "./urls.txt"; // Đọc từ file txt chứa các URL
  const savePath = "./overlays"; // Thư mục lưu video
  const thumbPath = "./thumbs";
  // Gọi hàm tải video
  await downloadVideos(filePath, savePath);
  await processImagesFromFolder(
    savePath, // Thư mục chứa ảnh gốc
    "./avatar.jpg", // Đường dẫn ảnh overlay
    thumbPath, // Thư mục lưu kết quả
    125 // Đường kính overlay hình tròn
  );
}

main(); // Chạy chương trình main() khi chương trình chạy đầu tiên
