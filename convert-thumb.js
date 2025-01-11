const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

/**
 * Đọc tất cả ảnh từ một thư mục, xử lý từng ảnh (chèn overlay hình tròn) và lưu kết quả vào thư mục khác.
 * @param {string} inputDir - Đường dẫn thư mục chứa ảnh gốc.
 * @param {string} overlayPath - Đường dẫn ảnh overlay.
 * @param {string} outputDir - Đường dẫn thư mục lưu kết quả.
 * @param {number} overlaySize - Kích thước đường kính overlay hình tròn.
 */
async function processImagesFromFolder(
  inputDir,
  overlayPath,
  outputDir,
  overlaySize
) {
  try {
    // Đảm bảo thư mục đầu ra tồn tại
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Lấy danh sách file trong thư mục đầu vào
    const files = fs.readdirSync(inputDir).filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return [".jpg", ".jpeg", ".png", ".webp"].includes(ext); // Chỉ xử lý các file ảnh
    });

    console.log(
      `Tìm thấy ${files.length} file cần xử lý trong thư mục: ${inputDir}`
    );

    // Tạo ảnh overlay hình tròn một lần để tái sử dụng
    const overlayCircle = await sharp(overlayPath)
      .resize(overlaySize, overlaySize)
      .composite([
        {
          input: Buffer.from(
            `<svg><circle cx="${overlaySize / 2}" cy="${overlaySize / 2}" r="${
              overlaySize / 2
            }" fill="white"/></svg>`
          ),
          blend: "dest-in",
        },
      ])
      .toBuffer();

    // Xử lý từng ảnh
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
            hue: 50, // Đổi tông màu (50 độ)
          })
          .toBuffer();

        // Lấy kích thước ảnh gốc
        const metadata = await sharp(transformedBaseImage).metadata();
        const x = metadata.width - overlaySize;
        const y = 0;

        // Chèn overlay vào ảnh gốc
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

// Sử dụng hàm
processImagesFromFolder(
  "./thumb", // Thư mục chứa ảnh gốc
  "./avatar.jpg", // Đường dẫn ảnh overlay
  "./thumb_done", // Thư mục lưu kết quả
  125 // Đường kính overlay hình tròn
);
