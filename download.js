import { spawn } from "child_process";
import ffmpegFluent from "fluent-ffmpeg";
import fs from "fs";
import pLimit from "p-limit";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";
import { create as createYoutubeDl } from "youtube-dl-exec";

// =================================================================
// 0. CẤU HÌNH BAN ĐẦU
// =================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Đường dẫn đến ffmpeg trong thư mục bin
const FFMPEG_PATH = path.join(__dirname, "bin", "ffmpeg.exe");
const FFPROBE_PATH = path.join(__dirname, "bin", "ffprobe.exe");

// Sử dụng absolute path để đảm bảo tìm đúng file sau khi tải mới
const YTDLP_PATH = path.join(__dirname, "bin", "yt-dlp.exe");
// Tạo helper function để luôn lấy yt-dlp mới nhất (sau khi tải update)
const getYoutubeDl = () => createYoutubeDl(YTDLP_PATH);
// Giữ object cũ để tương thích, nhưng nên dùng getYoutubeDl() để đảm bảo dùng file mới
const youtubedl = getYoutubeDl();
ffmpegFluent.setFfmpegPath(FFMPEG_PATH);
ffmpegFluent.setFfprobePath(FFPROBE_PATH);

let ALL_URLS_FILE = "./urls.txt"; // Tên file chứa TẤT CẢ các URL
const FAILED_URLS_LOG = "./failed_urls.txt"; // File log chứa các URL bị lỗi (đơn giản hóa)
let DOWNLOAD_DIR = "./overlays"; // Thư mục lưu video tải về và thumbnail gốc
let OVERLAY_IMAGES_DIR = "./images"; // Thư mục chứa các ảnh overlay
let OUTPUT_THUMBS_BASE_DIR = "./thumbs"; // Thư mục gốc lưu ảnh đã xử lý
let COOKIES_FILE = "./cookies.txt"; // File cookies.txt
let PROXY = null; // Proxy để sử dụng khi download (vd: http://proxy.example.com:8080)

// Đọc config từ file nếu có
// Kiểm tra CONFIG_DIR environment variable (được set bởi Electron main process)
// Nếu không có, dùng __dirname (cho development)
const configDir = process.env.CONFIG_DIR || __dirname;
const configFilePath = path.join(configDir, ".download-config.json");
if (fs.existsSync(configFilePath)) {
  try {
    const configContent = fs.readFileSync(configFilePath, "utf-8");
    const config = JSON.parse(configContent);

    if (config.urlsFile) ALL_URLS_FILE = config.urlsFile;
    if (config.downloadDir) DOWNLOAD_DIR = config.downloadDir;
    if (config.overlayImagesDir) OVERLAY_IMAGES_DIR = config.overlayImagesDir;
    if (config.outputThumbsBaseDir)
      OUTPUT_THUMBS_BASE_DIR = config.outputThumbsBaseDir;
    if (config.cookiesFile) COOKIES_FILE = config.cookiesFile;
    if (config.proxy !== undefined && config.proxy) PROXY = config.proxy;

    console.log(`Đã đọc config từ file: ${configFilePath}`);
  } catch (error) {
    console.error(`Lỗi khi đọc config file: ${error.message}`);
  }
}

// =================================================================
// 1. CÁC HÀM CỐT LÕI
// =================================================================

/**
 * Tải một video YouTube duy nhất.
 */
const downloadVideo = async (url, outputPath) => {
  const output = path.join(outputPath, "%(title)s.%(ext)s");

  // Chuẩn bị options
  const options = {
    output: output,
    format:
      "bestvideo[height=720][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height=720][ext=mp4][vcodec^=avc]",
    mergeOutputFormat: "mp4",
    writeThumbnail: true,
    convertThumbnails: "jpg",
    addHeader: [
      "referer:youtube.com",
      "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    ],
    limitRate: "2M",
    cookies: COOKIES_FILE,
    // addHeader: ["referer:youtube.com", "user-agent:googlebot"], // Bỏ comment nếu cần
    noOverwrites: true, // Không ghi đè nếu file đã tồn tại
    extractorArgs: ["youtube:player-client=default,-tv_simply"],
  };

  // Thêm proxy nếu có
  if (PROXY) {
    options.proxy = PROXY;
    console.log(`🔒 Sử dụng proxy: ${PROXY}`);
  }

  // Sử dụng getYoutubeDl() để đảm bảo luôn dùng yt-dlp mới nhất (sau khi update)
  await getYoutubeDl()(url, options);
  console.log(`✅ Tải/Kiểm tra thành công: ${url}`);
};

const downloadVideoWithYtdl = (url, outputPath) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_PATH, [
      "-f",
      "bestvideo[height=720]+bestaudio/best",
      "-o",
      path.join(outputPath, "%(title)s.%(ext)s"),
      "--merge-output-format",
      "mp4",
      "--write-thumbnail",
      "--convert-thumbnails",
      "jpg",
      "--no-overwrites",
      "--limit-rate",
      "2M",
      "--add-header",
      "referer:youtube.com",
      "--add-header",
      "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      url,
    ]);

    proc.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ Hoàn tất: ${url}`);
        resolve();
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });
  });
};

/**
 * Tải tất cả video từ một danh sách URL, báo cáo kết quả.
 * Trả về danh sách các tác vụ bị từ chối (failed URLs).
 */
const downloadVideosFromList = async (urls, savePath) => {
  if (!fs.existsSync(savePath)) fs.mkdirSync(savePath, { recursive: true });

  console.log(`📄 Bắt đầu tải ${urls.length} URL.`);
  if (urls.length === 0) return [];

  const limit = pLimit(3); // Giới hạn 3 video tải song song

  const downloadPromises = urls.map((url) =>
    limit(async () => {
      try {
        await downloadVideo(url, savePath);
        return { status: "fulfilled", url: url };
      } catch (error) {
        const reason = error.stderr || error.message;
        console.error(`🔴 Đã bắt được lỗi cho URL: ${url}`, reason);
        return { status: "rejected", url: url, reason: reason };
      }
    })
  );

  const results = await Promise.all(downloadPromises);
  const failedTasks = results.filter((result) => result.status === "rejected");
  return failedTasks.map((task) => task.url); // Trả về chỉ URL bị lỗi
};

/**
 * Chuyển đổi codec của các file MP4 trong thư mục.
 */
const convertCodec = async (directory) => {
  if (!fs.existsSync(directory)) {
    console.warn(
      `⚠️ Thư mục không tồn tại: ${directory}, bỏ qua convert codec.`
    );
    return;
  }
  const files = fs.readdirSync(directory);

  for (const file of files) {
    const filePath = path.join(directory, file);
    const ext = path.extname(file).toLowerCase();

    if (ext === ".mp4") {
      const outputFilePath = path.join(directory, "converted_" + file);

      console.log(`🔄 Đang chuyển đổi codec: ${file} -> ${outputFilePath}`);

      try {
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
      } catch (error) {
        console.error(
          `❌ Không thể chuyển đổi codec cho ${file}: ${error.message}`
        );
      }
    }
  }
};

/**
 * Sửa tên file, thay thế ký tự '？'.
 */
const fixFileNames = (directory) => {
  if (!fs.existsSync(directory)) return;
  const files = fs.readdirSync(directory);

  for (const file of files) {
    const normalizedName = file.normalize("NFC");
    if (file !== normalizedName) {
      const oldPath = path.join(directory, file);
      const newPath = path.join(directory, normalizedName);
      try {
        fs.renameSync(oldPath, newPath);
        console.log(`🔧 Đã chuẩn hóa tên file: ${file} -> ${normalizedName}`);
      } catch (error) {
        console.error(`❌ Lỗi khi đổi tên file ${file}: ${error.message}`);
      }
    }
  }
};

/**
 * Xử lý tất cả thumbnail trong một thư mục bằng cách áp dụng TẤT CẢ các ảnh overlay
 * từ thư mục OVERLAY_IMAGES_DIR, lưu kết quả vào các thư mục con tương ứng.
 */
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

// =================================================================
// 2. HÀM MAIN - ĐIỀU PHỐI CHÍNH
// =================================================================

async function main() {
  // --- Cấu hình ---
  // Các biến cấu hình đã được định nghĩa ở trên (ALL_URLS_FILE, FAILED_URLS_LOG, v.v.)
  const overlaySize = 125; // Kích thước của ảnh overlay

  // --- Kiểm tra chế độ chạy ---
  const isRetryMode = process.argv.includes("retry");

  if (isRetryMode) {
    console.log("🚀 Chạy ở chế độ THỬ LẠI (RETRY)...");
    if (
      !fs.existsSync(FAILED_URLS_LOG) ||
      fs.readFileSync(FAILED_URLS_LOG, "utf-8").trim() === ""
    ) {
      console.log(
        "✅ Không có file log lỗi hoặc file rỗng. Không cần thử lại."
      );
      return;
    }
  } else {
    console.log("🚀 Chạy ở chế độ BÌNH THƯỜNG...");
    console.log("🧹 Dọn dẹp/Chuẩn bị thư mục...");

    // Đảm bảo các thư mục tồn tại
    [DOWNLOAD_DIR, OVERLAY_IMAGES_DIR, OUTPUT_THUMBS_BASE_DIR].forEach(
      (dir) => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          console.log(`➕ Đã tạo thư mục: ${dir}`);
        }
      }
    );

    // Xóa file log lỗi cũ khi chạy chế độ bình thường để bắt đầu lại từ đầu
    if (fs.existsSync(FAILED_URLS_LOG)) {
      fs.unlinkSync(FAILED_URLS_LOG);
      console.log(`🗑️ Đã xóa file log lỗi cũ: ${FAILED_URLS_LOG}`);
    }
  }

  // --- Đọc danh sách URL cần xử lý ---
  let urlsToProcess = [];
  if (isRetryMode) {
    console.log(`🔎 Đọc các URL lỗi từ file: ${FAILED_URLS_LOG}`);
    urlsToProcess = fs
      .readFileSync(FAILED_URLS_LOG, "utf-8")
      .split("\n")
      .filter(Boolean);
    // Xóa file log lỗi sau khi đọc để ghi lại lỗi mới nếu có trong lần retry này
    fs.unlinkSync(FAILED_URLS_LOG);
  } else {
    if (!fs.existsSync(ALL_URLS_FILE)) {
      console.error(`❌ Lỗi: Không tìm thấy file URL chính: ${ALL_URLS_FILE}`);
      console.log("💡 Vui lòng tạo file urls.txt và thêm các URL vào đó.");
      return;
    }
    console.log(`🔎 Đọc các URL từ file: ${ALL_URLS_FILE}`);
    urlsToProcess = fs
      .readFileSync(ALL_URLS_FILE, "utf-8")
      .split("\n")
      .filter(Boolean);
  }

  if (urlsToProcess.length === 0) {
    console.log("✅ Không tìm thấy URL nào để xử lý.");
    return;
  }

  // --- Tải video ---
  console.log(`\n================== BẮT ĐẦU TẢI VIDEO ==================`);
  const failedDownloads = await downloadVideosFromList(
    urlsToProcess,
    DOWNLOAD_DIR
  );

  // --- Sửa tên file ---
  console.log(`\n🔧 Đang sửa tên file trong thư mục: ${DOWNLOAD_DIR}...`);
  fixFileNames(DOWNLOAD_DIR);

  // --- Chuyển đổi codec (bỏ comment để bật) ---
  // console.log(`\n🔄 Đang chuyển đổi codec trong thư mục: ${DOWNLOAD_DIR}...`);
  // await convertCodec(DOWNLOAD_DIR);

  // --- Xử lý ảnh overlay ---
  console.log(`\n🖼️  Bắt đầu xử lý ảnh thumbnail với nhiều overlay...`);
  await processAllThumbnailsWithMultipleOverlays(
    DOWNLOAD_DIR, // Thư mục chứa các thumbnail gốc đã tải
    OVERLAY_IMAGES_DIR, // Thư mục chứa nhiều ảnh overlay (images/)
    OUTPUT_THUMBS_BASE_DIR, // Thư mục gốc để lưu kết quả (thumbs/)
    overlaySize
  );

  // --- Tổng kết ---
  if (failedDownloads.length > 0) {
    console.log("\n================== TỔNG KẾT LỖI ==================");
    console.error(
      `🔥 Tổng cộng có ${failedDownloads.length} video tải thất bại.`
    );
    const failedUrlsContent = failedDownloads.join("\n");
    fs.writeFileSync(FAILED_URLS_LOG, failedUrlsContent);
    console.log(
      `📂 Danh sách các URL lỗi đã được ghi vào file: ${FAILED_URLS_LOG}`
    );
    if (!isRetryMode) {
      console.log(
        "💡 Mẹo: Chạy lại với lệnh 'node your_script_name.js retry' để tự động thử lại các video lỗi."
      );
    } else {
      console.log(
        "⚠️ Vẫn còn URL lỗi sau khi thử lại. Vui lòng kiểm tra file log."
      );
    }
  } else {
    console.log("\n🎉🎉🎉 TẤT CẢ CÁC VIDEO ĐỀU ĐƯỢC XỬ LÝ THÀNH CÔNG! 🎉🎉🎉");
    if (fs.existsSync(FAILED_URLS_LOG)) {
      fs.unlinkSync(FAILED_URLS_LOG); // Xóa file log lỗi nếu tất cả đã thành công
      console.log(`🗑️ Đã xóa file log lỗi ${FAILED_URLS_LOG}.`);
    }
  }

  console.log("\n🏁 Chương trình đã hoàn tất.");
}

// Chạy chương trình
main();
