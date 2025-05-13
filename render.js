import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import os from "os";
import pLimit from "p-limit";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";
ffmpeg.setFfmpegPath(ffmpegPath);

// Thêm hệ thống log tối ưu
const LOG_LEVEL = {
  ERROR: 0, // Chỉ log lỗi
  WARN: 1, // Log lỗi và cảnh báo
  INFO: 2, // Log thông tin quan trọng
  DEBUG: 3, // Log chi tiết
};

const currentLogLevel = LOG_LEVEL.INFO; // Mặc định chỉ log thông tin quan trọng
const logFile = "./render.log";

// Hàm log với kiểm soát mức độ
const log = (message, level = LOG_LEVEL.INFO) => {
  if (level <= currentLogLevel) {
    // Log ra console cho thông tin quan trọng
    console.log(message);
  }

  // Luôn ghi tất cả log vào file để debug sau này
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, logMessage);
  } catch (error) {
    console.error(`Lỗi khi ghi log: ${error.message}`);
  }
};

// Hiển thị tiến độ xử lý
let totalVideosToProcess = 0;
let processedVideos = 0;
let errorVideos = 0;

const updateProgress = () => {
  if (totalVideosToProcess > 0) {
    const percent = Math.round((processedVideos / totalVideosToProcess) * 100);
    process.stdout.write(
      `\rTiến độ: ${processedVideos}/${totalVideosToProcess} videos (${percent}%) - Lỗi: ${errorVideos}`
    );
  }
};

// Cache cho avatar và metadata
const avatarCache = new Map();
const metadataCache = new Map();

// region ========== 1. Đọc tham số dòng lệnh ==========
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Vui lòng cung cấp số ngày và số video dưới dạng tham số.");
  console.error("Cách chạy: node script.js <số ngày> <số video>");
  process.exit(1);
}

const currentDay = parseInt(args[0], 10);
const videosPerFolder = parseInt(args[1], 10);

if (isNaN(currentDay) || currentDay <= 0) {
  console.error("Số ngày phải là một số nguyên dương.");
  process.exit(1);
}

if (isNaN(videosPerFolder) || videosPerFolder <= 0) {
  console.error("Số video mỗi folder phải là một số nguyên dương.");
  process.exit(1);
}
// endregion

// region ========== 2. Ghi currentDay vào file ==========
const currentDayFile = "./currentDay.txt";
try {
  fs.writeFileSync(currentDayFile, currentDay.toString(), {
    encoding: "utf-8",
  });
  log(
    `Đã lưu currentDay (${currentDay}) vào file: ${currentDayFile}`,
    LOG_LEVEL.INFO
  );
} catch (error) {
  log(`Lỗi khi ghi currentDay vào file: ${error.message}`, LOG_LEVEL.ERROR);
}
// endregion

// region ========== 3. Đường dẫn & thư mục ==========
const overlayFolder = "./overlays";
const backgroundFolder = "./backgrounds";
const imageBackgroundFolder = "./image_backgrounds";
const outputFolder = "./done";
const avatarFolder = "./images";
const snowOverlay = "./snow1.mov";
const useChromaKey = true;
const color = "4887EE";
const chromaKeyFile = "./chromaKey.txt";
const height = 190;
const y_offset = 490;
const ipList = "./vps.txt";
const useAutoUploadVps = true;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tạo thư mục nếu chưa tồn tại
if (fs.existsSync(outputFolder)) {
  log(`Thư mục ${outputFolder} đã tồn tại, đang xóa...`, LOG_LEVEL.INFO);
  fs.rmSync(outputFolder, { recursive: true, force: true });
}

fs.mkdirSync(outputFolder, { recursive: true });
// endregion

// region ========== 4. Tiện ích đọc file ==========
const getFilesFromFolder = (folder, fileTypes = [".mp4"]) => {
  return fs
    .readdirSync(folder)
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return fileTypes.includes(ext);
    })
    .sort((a, b) => {
      return a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    })
    .map((file) => path.join(folder, file));
};

// Đọc danh sách IP từ file
const readIpList = () => {
  try {
    if (!fs.existsSync(ipList)) {
      log(`⚠️ Không tìm thấy file IP: ${ipList}`, LOG_LEVEL.WARN);
      return [];
    }

    const content = fs.readFileSync(ipList, "utf-8");
    const ips = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    log(`Đã đọc ${ips.length} IP từ file ${ipList}`, LOG_LEVEL.DEBUG);
    return ips;
  } catch (error) {
    log(`❌ Lỗi khi đọc file IP: ${error.message}`, LOG_LEVEL.ERROR);
    return [];
  }
};
// endregion

// region ========== 5. Danh sách file ==========
const overlayFiles = getFilesFromFolder(overlayFolder);
const backgroundFolders = fs
  .readdirSync(backgroundFolder)
  .filter((folder) =>
    fs.lstatSync(path.join(backgroundFolder, folder)).isDirectory()
  );

// Lấy danh sách thư mục con trong image_backgrounds
const imageBackgroundFolders = fs.existsSync(imageBackgroundFolder)
  ? fs
      .readdirSync(imageBackgroundFolder)
      .filter((folder) =>
        fs.lstatSync(path.join(imageBackgroundFolder, folder)).isDirectory()
      )
  : [];

// Đọc danh sách màu chroma key từ file
const readChromaKeyColors = () => {
  const colors = [];

  try {
    if (fs.existsSync(chromaKeyFile)) {
      const content = fs.readFileSync(chromaKeyFile, "utf-8");
      const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));

      for (const line of lines) {
        if (/^[0-9A-Fa-f]{6}$/.test(line)) {
          colors.push(line);
        } else {
          log(
            `Định dạng màu không hợp lệ trong file ${chromaKeyFile}: ${line}`,
            LOG_LEVEL.WARN
          );
        }
      }

      log(
        `Đã đọc ${colors.length} màu chroma key từ file ${chromaKeyFile}`,
        LOG_LEVEL.DEBUG
      );
    } else {
      log(
        `Không tìm thấy file ${chromaKeyFile}, sẽ sử dụng màu mặc định: #${color}`,
        LOG_LEVEL.DEBUG
      );
    }
  } catch (error) {
    log(`Lỗi khi đọc file ${chromaKeyFile}: ${error.message}`, LOG_LEVEL.ERROR);
  }

  return colors;
};

const chromaKeyColors = readChromaKeyColors();

// Tạo thư mục image_backgrounds nếu chưa tồn tại
if (!fs.existsSync(imageBackgroundFolder)) {
  fs.mkdirSync(imageBackgroundFolder, { recursive: true });
  log(
    `Đã tạo thư mục ${imageBackgroundFolder}. Vui lòng thêm các thư mục con (1, 2, 3...) và hình ảnh background.`,
    LOG_LEVEL.INFO
  );
}
// endregion

// region ========== 6. Tính vị trí video bắt đầu ==========
const calculateStartIndex = (folderIndex, day, totalVideos) => {
  return (
    ((day - 1) * videosPerFolder + folderIndex * videosPerFolder) % totalVideos
  );
};
// endregion

// region ========== 7. Tạo avatar hình tròn ==========
const createCircularAvatar = async (avatarPath, size = 100) => {
  // Kiểm tra cache trước
  const cacheKey = `${avatarPath}_${size}`;
  if (avatarCache.has(cacheKey)) {
    return avatarCache.get(cacheKey);
  }

  const tempPath = avatarPath.replace(".jpg", `_circular_${size}.png`);

  // Kiểm tra nếu file đã tồn tại
  if (fs.existsSync(tempPath)) {
    avatarCache.set(cacheKey, tempPath);
    return tempPath;
  }

  await sharp(avatarPath)
    .resize(size, size)
    .composite([
      {
        input: Buffer.from(
          `<svg><circle cx="${size / 2}" cy="${size / 2}" r="${
            size / 2
          }" fill="rgba(255, 255, 255, 0.5)" /></svg>`
        ),
        blend: "dest-in",
      },
    ])
    .png()
    .toFile(tempPath);

  avatarCache.set(cacheKey, tempPath);
  return tempPath;
};
// endregion

// region ========== 8. Xử lý video ==========
// Thêm cấu hình tối ưu
const CONFIG = {
  // Cấu hình FFmpeg
  ffmpeg: {
    preset: "veryfast", // Preset encoding (ultrafast, superfast, veryfast, faster, fast, medium)
    crf: 23, // Chất lượng video (18-28, thấp hơn = chất lượng cao hơn)
    threads: 0, // 0 = tự động sử dụng tất cả thread
    audioBitrate: "128k", // Bitrate audio
    timeout: 15 * 60 * 1000, // Timeout xử lý video (15 phút)
  },
  // Cấu hình xử lý
  processing: {
    maxConcurrent: Math.max(1, os.cpus().length - 1), // Số luồng xử lý tối đa
    useHardwareAcceleration: true, // Sử dụng GPU để tăng tốc
    cleanupTempFiles: true, // Xóa file tạm sau khi hoàn thành
  },
};

// Kiểm tra và sử dụng hardware acceleration
const useHardwareAcceleration = () => {
  if (!CONFIG.processing.useHardwareAcceleration) return [];

  try {
    const platform = process.platform;
    if (platform === "win32") {
      // Windows: thử dùng NVIDIA NVENC trước, nếu không có thì dùng Intel QSV, cuối cùng là auto
      return ["-hwaccel", "auto", "-hwaccel_output_format", "yuv420p"];
    } else if (platform === "darwin") {
      // macOS: sử dụng VideoToolbox
      return ["-hwaccel", "videotoolbox"];
    } else {
      // Linux: thử dùng VAAPI
      return ["-hwaccel", "vaapi", "-hwaccel_output_format", "yuv420p"];
    }
  } catch (error) {
    log(
      `Không thể sử dụng hardware acceleration: ${error.message}`,
      LOG_LEVEL.WARN
    );
    return [];
  }
};

// Lấy metadata của video (độ dài)
const getVideoMetadata = async (videoPath) => {
  if (metadataCache.has(videoPath)) {
    return metadataCache.get(videoPath);
  }

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        log(`Lỗi khi lấy metadata video: ${err.message}`, LOG_LEVEL.ERROR);
        return reject(err);
      }

      const result = {
        duration: metadata.format.duration,
        width: metadata.streams[0].width,
        height: metadata.streams[0].height,
      };

      metadataCache.set(videoPath, result);
      resolve(result);
    });
  });
};

const complexFilter = (isImage, inputOverlay) => {
  const overlayIndex = overlayFiles.findIndex((file) => file === inputOverlay);
  const videoColor =
    overlayIndex >= 0 && overlayIndex < chromaKeyColors.length
      ? chromaKeyColors[overlayIndex]
      : color;

  const chromaKeyFilter = useChromaKey
    ? `[1:v]scale=1280:720,colorkey=0x${videoColor}:0.3:0.1,format=yuva420p[overlay_video]`
    : `[1:v]scale=1280:720,crop=1280:${height}:0:${y_offset}[cropped]`;
  const filter = [
    isImage
      ? ["[0:v]scale=1280:720,setsar=1[bg]", chromaKeyFilter].join(";")
      : chromaKeyFilter,
  ];
  if (!useChromaKey) {
    filter.push(
      "[cropped]eq=brightness=-1.0:contrast=3.0:gamma=1.2:saturation=0[filtered]"
    );
    filter.push(
      "[filtered]format=yuva420p,colorchannelmixer=aa=0.8[overlay_video]"
    );
  }
  return [
    filter.join(";"),
    isImage
      ? "[bg][overlay_video]overlay=0:H-h[temp1]"
      : "[0:v][overlay_video]overlay=0:H-h[temp1]",
    "[temp1][2:v]overlay=W-w-10:10[temp2]",
    "[temp2][3:v]overlay=0:0:format=auto[combined_video]",
    "[1:a]volume=1.0[overlay_audio]",
  ];
};

const processVideo = async (
  inputOverlay,
  inputBackground,
  outputPath,
  avatarPath,
  useImageBackground = false
) => {
  // Tạo avatar hình tròn trước
  const circularAvatarPath = await createCircularAvatar(avatarPath);

  // Lấy metadata của video overlay
  const metadata = await getVideoMetadata(inputOverlay);
  const duration = metadata.duration;

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let ffmpegProcess = null;

    // Thêm timeout để tránh bị treo quá lâu
    const timeout = setTimeout(() => {
      log(
        `⚠️ Quá thời gian xử lý video: ${path.basename(outputPath)}`,
        LOG_LEVEL.WARN
      );

      // Cố gắng kill process nếu còn tồn tại
      if (ffmpegProcess && ffmpegProcess.kill) {
        try {
          ffmpegProcess.kill("SIGKILL");
          log(
            `Đã dừng process ffmpeg cho ${path.basename(outputPath)}`,
            LOG_LEVEL.DEBUG
          );
        } catch (e) {
          log(`Không thể dừng process: ${e.message}`, LOG_LEVEL.ERROR);
        }
      }

      processedVideos++;
      errorVideos++;
      updateProgress();
      resolve(); // Vẫn resolve để tiếp tục với video khác
    }, CONFIG.ffmpeg.timeout);

    // Kiểm tra nếu background là hình ảnh
    const isImage =
      useImageBackground ||
      [".jpg", ".jpeg", ".png"].includes(
        path.extname(inputBackground).toLowerCase()
      );

    // Sử dụng hardware acceleration và tối ưu cài đặt
    const base = isImage
      ? ffmpeg()
          .input(inputBackground)
          .loop(1)
          .inputOptions(useHardwareAcceleration())
      : ffmpeg(inputBackground).inputOptions(useHardwareAcceleration());

    ffmpegProcess = base
      .input(inputOverlay)
      .input(circularAvatarPath)
      .input(snowOverlay)
      .inputOptions(["-stream_loop", "-1"])
      .inputOptions("-t", duration)
      .complexFilter(complexFilter(isImage, inputOverlay))
      .outputOptions(`-preset ${CONFIG.ffmpeg.preset}`)
      .outputOptions(`-crf ${CONFIG.ffmpeg.crf}`)
      .outputOptions(`-threads ${CONFIG.ffmpeg.threads}`)
      .outputOptions("-t", duration)
      .audioCodec("aac")
      .audioBitrate(CONFIG.ffmpeg.audioBitrate)
      .outputOptions("-movflags +faststart") // Tối ưu cho streaming
      .map("[combined_video]")
      .map("[overlay_audio]")
      .on("progress", (progress) => {
        if (progress.percent) {
          // Cập nhật tiến độ chi tiết hơn
          const percent = Math.round(progress.percent * 100) / 100;
          process.stdout.write(
            `\rĐang xử lý ${path.basename(outputPath)}: ${percent}%`
          );
        }
      })
      .on("end", () => {
        clearTimeout(timeout);
        const endTime = Date.now();
        const processingTime = ((endTime - startTime) / 1000).toFixed(2);
        log(
          `✅ Video ${path.basename(
            outputPath
          )} hoàn thành trong ${processingTime}s`,
          LOG_LEVEL.DEBUG
        );

        // Xóa file tạm nếu được cấu hình
        if (
          CONFIG.processing.cleanupTempFiles &&
          !circularAvatarPath.includes("_circular_")
        ) {
          try {
            fs.unlinkSync(circularAvatarPath);
            log(
              `Đã xóa file tạm: ${path.basename(circularAvatarPath)}`,
              LOG_LEVEL.DEBUG
            );
          } catch (e) {
            // Bỏ qua lỗi khi xóa file
          }
        }

        processedVideos++;
        updateProgress();
        resolve();
      })
      .on("error", (error) => {
        clearTimeout(timeout);
        log(
          `❌ Lỗi khi xử lý video ${path.basename(outputPath)}: ${
            error.message
          }`,
          LOG_LEVEL.ERROR
        );

        // Xóa file output nếu tồn tại (có thể bị hỏng)
        if (fs.existsSync(outputPath)) {
          try {
            fs.unlinkSync(outputPath);
            log(
              `Đã xóa file output bị lỗi: ${path.basename(outputPath)}`,
              LOG_LEVEL.DEBUG
            );
          } catch (e) {
            // Bỏ qua lỗi khi xóa file
          }
        }

        processedVideos++;
        errorVideos++;
        updateProgress();
        reject(error);
      })
      .save(outputPath);
  });
};
// endregion

// region ========== 9. Xử lý toàn bộ video ==========
const processAllVideos = async () => {
  const startTime = Date.now();
  let completedFolders = 0;

  try {
    // Kiểm tra và tạo thư mục cache nếu chưa tồn tại
    const cacheDir = path.join(__dirname, ".cache");
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const totalOverlays = overlayFiles.length;
    if (totalOverlays === 0) {
      log(
        "❌ Không tìm thấy video overlay nào trong thư mục overlays!",
        LOG_LEVEL.ERROR
      );
      return;
    }

    const totalImageBackgroundFolders = imageBackgroundFolders.length;
    const totalVideoBackgrounds = backgroundFolders.length;
    const useImageBackground = totalImageBackgroundFolders > 0;

    const totalBackgrounds = useImageBackground
      ? totalImageBackgroundFolders
      : totalVideoBackgrounds;

    if (totalBackgrounds === 0) {
      log("❌ Không tìm thấy thư mục background nào!", LOG_LEVEL.ERROR);
      return;
    }

    log(
      `🚀 Bắt đầu xử lý với ${totalOverlays} video overlay và ${totalBackgrounds} thư mục background`,
      LOG_LEVEL.INFO
    );
    log(
      `📅 Ngày hiện tại: ${currentDay}, Số video mỗi folder: ${videosPerFolder}`,
      LOG_LEVEL.INFO
    );

    if (useImageBackground) {
      log(
        `Sử dụng hình ảnh làm background từ ${totalImageBackgroundFolders} thư mục`,
        LOG_LEVEL.INFO
      );
    }

    // Tính tổng số video sẽ xử lý
    totalVideosToProcess = totalBackgrounds * videosPerFolder;
    log(`Tổng số video sẽ xử lý: ${totalVideosToProcess}`, LOG_LEVEL.INFO);

    // Sử dụng p-limit để giới hạn số lượng xử lý đồng thời
    const limit = pLimit(CONFIG.processing.maxConcurrent);
    log(
      `Sử dụng tối đa ${CONFIG.processing.maxConcurrent} luồng xử lý song song`,
      LOG_LEVEL.INFO
    );

    // Mảng chứa tất cả các promise
    const tasks = [];

    // Duyệt qua từng folder nền
    for (let i = 0; i < totalBackgrounds; i++) {
      const folderName = `${i + 1}`;
      const groupFolder = path.join(outputFolder, folderName);
      const avatarPath = path.join(avatarFolder, `${folderName}.jpg`);

      if (!fs.existsSync(avatarPath)) {
        log(`❌ Không tìm thấy avatar: ${avatarPath}`, LOG_LEVEL.ERROR);
        // Bỏ qua folder này và cập nhật số lượng video đã xử lý
        processedVideos += videosPerFolder;
        errorVideos += videosPerFolder;
        updateProgress();
        continue;
      }

      if (!fs.existsSync(groupFolder)) {
        fs.mkdirSync(groupFolder, { recursive: true });
      }

      // Lấy danh sách background (video hoặc hình ảnh)
      let backgroundFiles = [];
      let totalBackgroundsForFolder = 0;

      if (useImageBackground) {
        // Tìm thư mục con tương ứng trong image_backgrounds
        const imageBackgroundSubfolder =
          imageBackgroundFolders.find((folder) => folder === folderName) ||
          imageBackgroundFolders[0]; // Sử dụng folder đầu tiên nếu không tìm thấy

        if (imageBackgroundSubfolder) {
          const imageBackgroundFolderPath = path.join(
            imageBackgroundFolder,
            imageBackgroundSubfolder
          );
          backgroundFiles = getFilesFromFolder(imageBackgroundFolderPath, [
            ".jpg",
            ".jpeg",
            ".png",
          ]);
          totalBackgroundsForFolder = backgroundFiles.length;
        }
      } else {
        // Sử dụng video làm background
        const backgroundFolderPath = path.join(
          backgroundFolder,
          backgroundFolders[i]
        );
        backgroundFiles = getFilesFromFolder(backgroundFolderPath);
        totalBackgroundsForFolder = backgroundFiles.length;
      }

      if (totalBackgroundsForFolder === 0) {
        log(
          `❌ Không có file background nào cho folder ${folderName}`,
          LOG_LEVEL.ERROR
        );
        // Bỏ qua folder này và cập nhật số lượng video đã xử lý
        processedVideos += videosPerFolder;
        errorVideos += videosPerFolder;
        updateProgress();
        continue;
      }

      log(
        `📁 Đang xử lý folder ${folderName} (${i + 1}/${totalBackgrounds})`,
        LOG_LEVEL.INFO
      );

      // Tính vị trí bắt đầu cho ngày hiện tại
      const startIndex = calculateStartIndex(i, currentDay, totalOverlays);

      // Tạo một promise để xử lý tất cả video trong folder này
      const folderPromise = (async () => {
        const folderTasks = [];

        // Lấy số video từ vị trí bắt đầu
        for (let j = 0; j < videosPerFolder; j++) {
          const overlayIndex = (startIndex + j) % totalOverlays;
          const backgroundIndex = useImageBackground
            ? Math.floor(Math.random() * totalBackgroundsForFolder)
            : (startIndex + j) % totalBackgroundsForFolder;

          const overlay = overlayFiles[overlayIndex];
          const background = backgroundFiles[backgroundIndex];

          const overlayFileName = path.basename(overlay, path.extname(overlay));
          const outputPath = path.join(groupFolder, `${overlayFileName}.mp4`);

          log(
            `🎬 Video ${j + 1}/${videosPerFolder}: ${path.basename(overlay)}`,
            LOG_LEVEL.DEBUG
          );

          // Thêm task vào danh sách, sử dụng p-limit để giới hạn số lượng xử lý đồng thời
          folderTasks.push(
            limit(() =>
              processVideo(
                overlay,
                background,
                outputPath,
                avatarPath,
                useImageBackground
              ).catch((error) => {
                // Lỗi đã được xử lý trong hàm processVideo
                log(
                  `Không thể xử lý video: ${path.basename(overlay)}`,
                  LOG_LEVEL.ERROR
                );
              })
            )
          );
        }

        // Chờ tất cả video trong folder này hoàn thành
        await Promise.all(folderTasks);

        // Upload lên VPS nếu được cấu hình
        if (useAutoUploadVps) {
          uploadVps(i, folderName);
        }

        completedFolders++;
        log(
          `✅ Đã hoàn thành folder ${folderName} (${completedFolders}/${totalBackgrounds})`,
          LOG_LEVEL.INFO
        );
      })();

      tasks.push(folderPromise);
    }

    // Chờ tất cả các folder hoàn thành
    await Promise.all(tasks);

    // Dọn dẹp cache avatar
    if (CONFIG.processing.cleanupTempFiles) {
      for (const [key, tempPath] of avatarCache.entries()) {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
          log(`Đã xóa file cache: ${tempPath}`, LOG_LEVEL.DEBUG);
        }
      }
    }

    avatarCache.clear();
    metadataCache.clear();

    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000 / 60).toFixed(2);
    const averageTimePerVideo = (
      (endTime - startTime) /
      1000 /
      totalVideosToProcess
    ).toFixed(2);

    log("\n", LOG_LEVEL.INFO); // Xuống dòng sau khi hiển thị
    log(`✅ Hoàn thành! Tổng thời gian: ${totalTime} phút`, LOG_LEVEL.INFO);
    log(
      `📊 Thống kê: ${processedVideos} video đã xử lý, ${errorVideos} lỗi`,
      LOG_LEVEL.INFO
    );
    log(
      `⏱️ Thời gian trung bình: ${averageTimePerVideo} giây/video`,
      LOG_LEVEL.INFO
    );
  } catch (error) {
    log(`❌ Lỗi khi xử lý toàn bộ video: ${error.message}`, LOG_LEVEL.ERROR);
  }
};
// endregion

// region ========== 11. Upload VPS ==========
const uploadVps = (index, folderName) => {
  if (!useAutoUploadVps) return;

  // Đọc danh sách IP
  const vpsList = readIpList();
  if (vpsList.length === 0) {
    log(`Không có VPS nào để upload folder ${folderName}`, LOG_LEVEL.WARN);
    return;
  }

  // Lấy VPS tương ứng với index, hoặc VPS đầu tiên nếu không có
  const vpsName = vpsList[index % vpsList.length];
  const currentFolderUpload = path.join(__dirname, outputFolder);

  log(`Đang upload folder ${folderName} lên VPS ${vpsName}`, LOG_LEVEL.INFO);

  // Tạo lệnh rclone với dấu ngoặc kép cho các đường dẫn
  const rcloneCmd = `rclone copy "${currentFolderUpload}" "${vpsName}:/" --include "${folderName}/**" --transfers 16 --checkers 8 --progress`;
  const cmd = `echo Uploading ${currentFolderUpload} to VPS ${vpsName} && ${rcloneCmd} && exit`;

  // Sử dụng spawn để mở cửa sổ CMD mới và chạy lệnh
  const uploadProcess = spawn(
    "cmd.exe",
    ["/c", "start", "cmd.exe", "/c", cmd],
    {
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: true,
    }
  );

  uploadProcess.unref();
  log(
    `Đã bắt đầu upload folder ${folderName} lên VPS ${vpsName}`,
    LOG_LEVEL.INFO
  );
};
// endregion

// region ========== 10. Khởi chạy ==========
processAllVideos().then(() => {
  console.log("🎉 Hoàn tất xử lý tất cả video.");
});
// endregion
