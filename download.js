import ffmpeg from "@ffmpeg-installer/ffmpeg";
import ffmpegFluent from "fluent-ffmpeg";
import fs from "fs";
import pLimit from "p-limit";
import path from "path";
import sharp from "sharp";
import youtubedl from "youtube-dl-exec";

// =================================================================
// 0. CẤU HÌNH BAN ĐẦU
// =================================================================
ffmpegFluent.setFfmpegPath(ffmpeg.path);

// =================================================================
// 1. CÁC HÀM CỐT LÕI
// =================================================================

/**
 * Tải một video YouTube duy nhất.
 */
const downloadVideo = async (url, outputPath) => {
  const output = path.join(outputPath, "%(title)s.%(ext)s");
  await youtubedl(url, {
    output: output,
    format: "bestvideo[height=720]+bestaudio/best",
    mergeOutputFormat: "mp4",
    // skipDownload: true,
    writeThumbnail: true,
    convertThumbnails: "jpg",
    cookies: "./cookies.txt",
    addHeader: ["referer:youtube.com", "user-agent:googlebot"],
    noOverwrites: true,
  });
  console.log(`✅ Tải/Kiểm tra thành công: ${url}`);
};

/**
 * Tải tất cả video từ một file, báo cáo kết quả và có log phòng thủ.
 */
const downloadVideosFromFile = async (filePath, savePath) => {
  if (!fs.existsSync(savePath)) fs.mkdirSync(savePath, { recursive: true });

  const urls = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);

  console.log(
    `📄 Tìm thấy ${urls.length} URL trong file ${path.basename(filePath)}.`
  );
  if (urls.length === 0) return [];

  const limit = pLimit(3);

  const downloadPromises = urls.map((url) =>
    limit(async () => {
      console.log(`[QUEUE] Đang xử lý URL: ${url}`);
      try {
        await downloadVideo(url, savePath);
        return { status: "fulfilled", url: url };
      } catch (error) {
        const reason = error.stderr || error.message;
        console.error(`🔴 Đã bắt được lỗi cho URL: ${url}`);
        return { status: "rejected", url: url, reason: reason };
      }
    })
  );

  return Promise.all(downloadPromises);
};

/**
 * Sửa tên file, thay thế ký tự '？'.
 */
const fixFileNames = (directory) => {
  if (!fs.existsSync(directory)) return;
  const files = fs.readdirSync(directory);

  for (const file of files) {
    if (file.includes("？")) {
      const oldPath = path.join(directory, file);
      const newPath = path.join(directory, file.replace(/？/g, ""));
      try {
        fs.renameSync(oldPath, newPath);
        console.log(
          `🔧 Đã sửa tên file: ${file} -> ${file.replace(/？/g, "")}`
        );
      } catch (error) {
        console.error(`❌ Lỗi khi đổi tên file ${file}: ${error.message}`);
      }
    }
  }
};

/**
 * Xử lý ảnh cho một kênh: ghép overlay vào tất cả thumbnail.
 */
async function processSingleChannelImages(
  inputThumbDir,
  overlayImagePath,
  outputThumbDir,
  overlaySize
) {
  try {
    if (!fs.existsSync(inputThumbDir) || !fs.existsSync(overlayImagePath)) {
      console.warn(
        `⚠️  Thiếu thư mục thumbnail hoặc ảnh overlay cho kênh, bỏ qua xử lý ảnh.`
      );
      return;
    }
    if (!fs.existsSync(outputThumbDir))
      fs.mkdirSync(outputThumbDir, { recursive: true });

    const inputFiles = fs
      .readdirSync(inputThumbDir)
      .filter((file) => /\.(jpg|jpeg|png|webp)$/i.test(file));
    if (inputFiles.length === 0) return;

    console.log(
      `🖼️  Bắt đầu xử lý ${inputFiles.length} ảnh cho kênh tại: ${outputThumbDir}`
    );

    const overlayCircle = await sharp(overlayImagePath)
      .resize(overlaySize, overlaySize)
      .composite([
        {
          input: Buffer.from(
            `<svg><circle cx="${overlaySize / 2}" cy="${overlaySize / 2}" r="${
              overlaySize / 2
            }"/></svg>`
          ),
          blend: "dest-in",
        },
      ])
      .png()
      .toBuffer();

    for (const file of inputFiles) {
      const inputPath = path.join(inputThumbDir, file);
      const outputPath = path.join(outputThumbDir, file);
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
        console.error(`❌ Lỗi khi xử lý file ảnh ${file}:`, err.message);
      }
    }
    console.log(`✅ Hoàn tất xử lý ảnh cho kênh tại: ${outputThumbDir}`);
  } catch (err) {
    console.error(`❌ Lỗi nghiêm trọng khi xử lý ảnh kênh:`, err.message);
  }
}

/**
 * Đọc file log lỗi và tạo các file _retry.txt một cách an toàn.
 */
function prepareRetryFiles() {
  const urlsDir = "./urls";
  const failedLogPath = "./failed_downloads.csv";

  if (!fs.existsSync(failedLogPath)) {
    console.log("✅ Không có file log lỗi. Không cần thử lại.");
    return false;
  }

  const lines = fs.readFileSync(failedLogPath, "utf-8").split("\n").slice(1);
  const tasksByChannel = {};

  for (const line of lines) {
    if (!line.trim()) continue;

    const delimiterIndex = line.indexOf(",");
    if (delimiterIndex === -1) {
      console.warn(`⚠️ Bỏ qua dòng lỗi không hợp lệ trong CSV: ${line}`);
      continue;
    }
    const channelId = line.substring(0, delimiterIndex);
    const url = line.substring(delimiterIndex + 1);

    if (!tasksByChannel[channelId]) tasksByChannel[channelId] = [];
    tasksByChannel[channelId].push(url);
  }

  const oldRetryFiles = fs
    .readdirSync(urlsDir)
    .filter((f) => f.endsWith("_retry.txt"));
  oldRetryFiles.forEach((f) => fs.unlinkSync(path.join(urlsDir, f)));

  if (Object.keys(tasksByChannel).length === 0) {
    console.log("✅ File log lỗi rỗng. Không có gì để thử lại.");
    return false;
  }

  for (const channelId in tasksByChannel) {
    const retryFilePath = path.join(urlsDir, `${channelId}_retry.txt`);
    const urlsToRetry = tasksByChannel[channelId].join("\n");
    fs.writeFileSync(retryFilePath, urlsToRetry);
    console.log(
      `🔧 Đã tạo file thử lại: ${retryFilePath} với ${tasksByChannel[channelId].length} URL.`
    );
  }
  return true;
}

// =================================================================
// 2. HÀM MAIN - ĐIỀU PHỐI CHÍNH
// =================================================================

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

async function main() {
  // --- Cấu hình ---
  const urlsDir = "./urls";
  const downloadBaseDir = "./overlays";
  const overlayDir = "./images";
  const outputBaseDir = "./thumbs";
  const overlaySize = 125;
  const failedLogPath = "./failed_downloads.csv";

  // --- Kiểm tra chế độ chạy ---
  const isRetryMode = process.argv.includes("retry");

  if (isRetryMode) {
    console.log("🚀 Chạy ở chế độ THỬ LẠI (RETRY)...");
    const canRetry = prepareRetryFiles();
    if (!canRetry) {
      console.log("🏁 Không có gì để thử lại. Dừng chương trình.");
      return;
    }
  } else {
    console.log("🚀 Chạy ở chế độ BÌNH THƯỜNG...");
    console.log("🧹 Dọn dẹp thư mục cũ...");
    if (!fs.existsSync(outputBaseDir)) {
      fs.mkdirSync(outputBaseDir, { recursive: true });
    }
    if (!fs.existsSync(downloadBaseDir)) {
      fs.mkdirSync(downloadBaseDir, { recursive: true });
    }
    if (fs.existsSync(failedLogPath)) fs.unlinkSync(failedLogPath);
  }

  // --- Lấy danh sách file cần xử lý ---
  const urlFiles = isRetryMode
    ? fs.readdirSync(urlsDir).filter((f) => f.endsWith("_retry.txt"))
    : fs
        .readdirSync(urlsDir)
        .filter((f) => f.endsWith(".txt") && !f.endsWith("_retry.txt"));

  if (urlFiles.length === 0) {
    console.log("✅ Không tìm thấy file URL nào để xử lý trong chế độ này.");
    return;
  }

  console.log(`🔎 Tìm thấy ${urlFiles.length} file để xử lý.`);
  let allFailedTasks = [];

  // --- Vòng lặp xử lý chính ---
  for (const urlFile of urlFiles) {
    const channelId = path.parse(urlFile).name.replace("_retry", "");
    console.log(
      `\n================== BẮT ĐẦU KÊNH: ${channelId} ==================`
    );

    const urlFilePath = path.join(urlsDir, urlFile);
    const channelDownloadPath = path.join(downloadBaseDir, channelId);
    const channelOutputPath = path.join(outputBaseDir, channelId);

    const results = await downloadVideosFromFile(
      urlFilePath,
      channelDownloadPath
    );
    // if (fs.existsSync(channelDownloadPath)) {
    //   await convertCodec(channelDownloadPath);
    // }
    const failedTasks = results.filter(
      (result) => result.status === "rejected"
    );
    if (failedTasks.length > 0) {
      console.error(
        `❌ Kênh ${channelId} có ${failedTasks.length} video tải lỗi.`
      );
      failedTasks.forEach((task) =>
        allFailedTasks.push({ channelId, url: task.url })
      );
    }

    const overlayFile = fs
      .readdirSync(overlayDir)
      .find((f) => path.parse(f).name === channelId);
    if (overlayFile) {
      const overlayImagePath = path.join(overlayDir, overlayFile);
      fixFileNames(channelDownloadPath);
      await processSingleChannelImages(
        channelDownloadPath,
        overlayImagePath,
        channelOutputPath,
        overlaySize
      );
    } else {
      console.warn(
        `⚠️  Không tìm thấy overlay cho kênh ${channelId}, bỏ qua xử lý ảnh.`
      );
    }

    console.log(
      `================== KẾT THÚC KÊNH: ${channelId} ==================\n`
    );
  }

  // --- Tổng kết và ghi/cập nhật/xóa log lỗi ---
  if (isRetryMode) {
    if (allFailedTasks.length > 0) {
      console.log("================== TỔNG KẾT RETRY ==================");
      console.error(
        `🔥 Vẫn còn ${allFailedTasks.length} video chưa thể tải được.`
      );
      const csvContent = allFailedTasks
        .map((task) => `${task.channelId},${task.url}`)
        .join("\n");
      fs.writeFileSync(failedLogPath, "channelId,url\n" + csvContent);
      console.log(`📂 File log lỗi ${failedLogPath} đã được cập nhật.`);
    } else {
      console.log("================== TỔNG KẾT RETRY ==================");
      console.log("✅ Tất cả các video lỗi trước đó đã được xử lý thành công!");

      if (fs.existsSync(failedLogPath)) {
        fs.unlinkSync(failedLogPath);
        console.log(`🗑️  Đã xóa file log lỗi ${failedLogPath}.`);
      }

      console.log("[CLEANUP] Dọn dẹp các file retry tạm thời...");
      const retryFilesToDelete = fs
        .readdirSync(urlsDir)
        .filter((f) => f.endsWith("_retry.txt"));
      retryFilesToDelete.forEach((file) => {
        const filePathToDelete = path.join(urlsDir, file);
        fs.unlinkSync(filePathToDelete);
        console.log(`🗑️  Đã xóa file retry: ${filePathToDelete}`);
      });
    }
  } else {
    if (allFailedTasks.length > 0) {
      console.log("================== TỔNG KẾT LỖI ==================");
      console.error(
        `🔥 Tổng cộng có ${allFailedTasks.length} video tải thất bại.`
      );
      const csvContent = allFailedTasks
        .map((task) => `${task.channelId},${task.url}`)
        .join("\n");
      fs.writeFileSync(failedLogPath, "channelId,url\n" + csvContent);
      console.log(
        `📂 Danh sách các URL lỗi đã được ghi vào file: ${failedLogPath}`
      );
      console.log(
        "💡 Mẹo: Chạy lại với lệnh 'node your_script.js retry' để tự động thử lại các video lỗi."
      );
    } else {
      console.log("🎉🎉🎉 TẤT CẢ CÁC VIDEO ĐỀU ĐƯỢC XỬ LÝ THÀNH CÔNG! 🎉🎉🎉");
    }
  }
}

// Chạy chương trình
main();
