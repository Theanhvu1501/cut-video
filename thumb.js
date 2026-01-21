import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let DOWNLOAD_DIR = "./overlays"; // Thư mục lưu video tải về và thumbnail gốc
let OVERLAY_IMAGES_DIR = "./images"; // Thư mục chứa các ảnh overlay
let OUTPUT_THUMBS_BASE_DIR = "./thumbs"; // Thư mục gốc lưu ảnh đã xử lý

// Đọc config từ project JSON (mặc định là "default")
const projectName = process.env.PROJECT_NAME || "default";
const projectsDir = process.env.PROJECTS_DIR || path.join(__dirname, "projects");
const projectConfigPath = path.join(projectsDir, `${projectName}.json`);

if (fs.existsSync(projectConfigPath)) {
  try {
    const projectContent = fs.readFileSync(projectConfigPath, "utf-8");
    const projectData = JSON.parse(projectContent);
    const config = projectData.settings?.thumb;

    if (config) {
      if (config.inputFolder) DOWNLOAD_DIR = config.inputFolder;
      if (config.overlayFolder) OVERLAY_IMAGES_DIR = config.overlayFolder;
      if (config.outputFolder) OUTPUT_THUMBS_BASE_DIR = config.outputFolder;

      console.log(`Đã đọc config từ project: ${projectName}`);
    }
  } catch (error) {
    console.error(`Lỗi khi đọc project config: ${error.message}`);
  }
}

async function processAllThumbnailsWithMultipleOverlays(
  inputThumbDir, // Thư mục chứa các thumbnail gốc đã tải
  overlayImagesDir, // Thư mục chứa nhiều ảnh overlay
  outputBaseDir, // Thư mục gốc để lưu kết quả (sẽ có các thư mục con)
  overlaySize
) {
  try {
    if (!fs.existsSync(inputThumbDir)) {
      console.warn(
        `⚠️ Thiếu thư mục thumbnail gốc: ${inputThumbDir}, bỏ qua xử lý ảnh.`
      );
      return;
    }
    if (!fs.existsSync(overlayImagesDir)) {
      console.warn(
        `⚠️ Thiếu thư mục ảnh overlay tại: ${overlayImagesDir}, bỏ qua xử lý ảnh.`
      );
      return;
    }

    const overlayFiles = fs
      .readdirSync(overlayImagesDir)
      .filter((file) => /\.(jpg|jpeg|png|webp)$/i.test(file))
      .sort(
        (a, b) => parseInt(path.parse(a).name) - parseInt(path.parse(b).name)
      ); // Sắp xếp theo tên (số)

    if (overlayFiles.length === 0) {
      console.warn(
        `⚠️ Không tìm thấy ảnh overlay nào trong thư mục: ${overlayImagesDir}. Bỏ qua xử lý ảnh.`
      );
      return;
    }

    const inputThumbnailFiles = fs
      .readdirSync(inputThumbDir)
      .filter((file) => /\.(jpg|jpeg|png|webp)$/i.test(file));

    if (inputThumbnailFiles.length === 0) {
      console.log(
        `ℹ️ Không có ảnh thumbnail gốc nào để xử lý trong ${inputThumbDir}.`
      );
      return;
    }

    console.log(
      `🖼️  Bắt đầu xử lý ${inputThumbnailFiles.length} ảnh thumbnail gốc với ${overlayFiles.length} ảnh overlay.`
    );

    for (let i = 0; i < overlayFiles.length; i++) {
      const overlayFileName = overlayFiles[i];
      const overlayPath = path.join(overlayImagesDir, overlayFileName);
      const outputDirForThisOverlay = path.join(outputBaseDir, `${i + 1}`); // Tạo thư mục con dựa trên thứ tự overlay

      if (!fs.existsSync(outputDirForThisOverlay)) {
        fs.mkdirSync(outputDirForThisOverlay, { recursive: true });
      }

      // Tạo overlay hình tròn một lần cho mỗi file overlay
      const overlayCircle = await sharp(overlayPath)
        .resize(overlaySize, overlaySize)
        .composite([
          {
            input: Buffer.from(
              `<svg><circle cx="${overlaySize / 2}" cy="${
                overlaySize / 2
              }" r="${overlaySize / 2}" fill="white"/></svg>`
            ),
            blend: "dest-in",
          },
        ])
        .png()
        .toBuffer();

      // Áp dụng overlay này cho TẤT CẢ các thumbnail gốc
      for (const file of inputThumbnailFiles) {
        const inputPath = path.join(inputThumbDir, file);
        const outputPath = path.join(outputDirForThisOverlay, file);
        try {
          const transformedBaseImage = await sharp(inputPath)
            .modulate({ brightness: 1.1, saturation: 1.2, hue: 20 })
            .toBuffer();
          const metadata = await sharp(transformedBaseImage).metadata();
          const x = metadata.width - overlaySize - 10;
          const y = 10;
          await sharp(transformedBaseImage)
            .composite([{ input: overlayCircle, top: y, left: x }])
            .toFile(outputPath);
        } catch (err) {
          console.error(
            `❌ Lỗi khi xử lý file ảnh ${file} với overlay ${overlayFileName}:`,
            err.message
          );
        }
      }
    }
    console.log(`✅ Toàn bộ quá trình xử lý ảnh overlay đã hoàn tất.`);
  } catch (err) {
    console.error(`❌ Lỗi nghiêm trọng khi xử lý ảnh:`, err.message);
  }
}

await processAllThumbnailsWithMultipleOverlays(
  DOWNLOAD_DIR, // Thư mục chứa các thumbnail gốc đã tải
  OVERLAY_IMAGES_DIR, // Thư mục chứa nhiều ảnh overlay (images/)
  OUTPUT_THUMBS_BASE_DIR, // Thư mục gốc để lưu kết quả (thumbs/)
  125
);
