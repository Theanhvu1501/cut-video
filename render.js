import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
ffmpeg.setFfmpegPath(ffmpegPath);

// Thêm hệ thống log tối ưu
const LOG_LEVEL = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const currentLogLevel = LOG_LEVEL.INFO;
const logFile = "./render.log";

const log = (message, level = LOG_LEVEL.INFO) => {
  if (level <= currentLogLevel) {
    console.log(message);
  }
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

// region ========== 1. Đọc tham số dòng lệnh (ĐÃ XÓA) ==========
// Không còn cần thiết vì logic đã thay đổi
// endregion

// region ========== 2. Ghi currentDay vào file (ĐÃ XÓA) ==========
// Không còn cần thiết
// endregion

// region ========== 3. Đường dẫn & thư mục ==========
const overlayFolder = "./overlays";
const backgroundFolder = "./backgrounds";
const combinedVideosFolder = "./combined_videos";
const outputFolder = "./done";
const useChromaKey = false;
const color = "4887EE";
const chromaKeyFile = "./chromaKey.txt";
const height = 190;
const y_offset = 490;
const ipList = "./vps.txt";
const useAutoUploadVps = false;
const maxConcurrentProcesses = 2;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (fs.existsSync(outputFolder)) {
  log(`Thư mục ${outputFolder} đã tồn tại, đang xóa...`, LOG_LEVEL.INFO);
  fs.rmSync(outputFolder, { recursive: true, force: true });
}
fs.mkdirSync(outputFolder, { recursive: true });
// endregion

// region ========== 4. Tiện ích đọc file ==========
const getFilesFromFolder = (folder, fileTypes = [".mp4"]) => {
  // Thêm kiểm tra nếu thư mục không tồn tại
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder)
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return fileTypes.includes(ext);
    })
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    )
    .map((file) => path.join(folder, file));
};

// *** THAY ĐỔI: Thêm hàm lấy thư mục con
const getSubfolders = (folder) => {
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
};

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
// *** THAY ĐỔI: Lấy danh sách thư mục con của overlays thay vì file
const overlaySubfolders = getSubfolders(overlayFolder);

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
// endregion

// region ========== 6. Tính vị trí video bắt đầu (ĐÃ XÓA) ==========
// Không còn cần thiết
// endregion

// region ========== 7. Xử lý video ==========
const complexFilter = (inputOverlay) => {
  // Logic chroma key có thể vẫn cần quyết định màu sắc dựa trên file, nhưng đơn giản hóa nó
  const videoColor = chromaKeyColors.length > 0 ? chromaKeyColors[0] : color;

  const chromaKeyFilter = useChromaKey
    ? `[1:v]scale=1280:720,colorkey=0x${videoColor}:0.3:0.1,format=yuva420p[overlay_video]`
    : `[1:v]scale=1280:720,crop=1280:${height}:0:${y_offset}[cropped]`;

  const filter = [chromaKeyFilter];
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
    "[0:v][overlay_video]overlay=0:H-h[combined_video]",
    "[1:a]volume=1.0[overlay_audio]",
  ];
};

const processVideo = async (inputOverlay, inputBackground, outputPath) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    ffmpeg.ffprobe(inputOverlay, (err, metadata) => {
      if (err) {
        log(
          `Lỗi khi lấy metadata video overlay: ${err.message}`,
          LOG_LEVEL.ERROR
        );
        processedVideos++;
        errorVideos++;
        updateProgress();
        return reject(err);
      }
      const duration = metadata.format.duration;
      ffmpeg(inputBackground)
        .inputOptions(["-stream_loop", "-1"])
        .input(inputOverlay)
        .complexFilter(complexFilter(inputOverlay))
        .outputOptions("-preset", "ultrafast")
        .outputOptions("-t", duration)
        .audioCodec("aac")
        .map("[combined_video]")
        .map("[overlay_audio]")
        .on("end", () => {
          const endTime = Date.now();
          log(
            `✅ Video ${path.basename(outputPath)} hoàn thành trong ${(
              (endTime - startTime) /
              1000
            ).toFixed(2)}s`,
            LOG_LEVEL.DEBUG
          );
          processedVideos++;
          updateProgress();
          resolve();
        })
        .on("error", (error) => {
          log(
            `❌ Lỗi khi xử lý video ${path.basename(outputPath)}: ${
              error.message
            }`,
            LOG_LEVEL.ERROR
          );
          processedVideos++;
          errorVideos++;
          updateProgress();
          reject(error);
        })
        .save(outputPath);
    });
  });
};
// endregion

// region ========== 8. Xử lý toàn bộ video ==========
const processAllVideos = async () => {
  const startTime = Date.now();
  try {
    // *** THAY ĐỔI: Kiểm tra thư mục con của overlays
    if (overlaySubfolders.length === 0) {
      log(
        "❌ Không tìm thấy thư mục con nào trong thư mục overlays!",
        LOG_LEVEL.ERROR
      );
      return;
    }

    // *** THAY ĐỔI: Lấy tất cả các file background vào một danh sách duy nhất
    const hasCombinedVideos = fs.existsSync(combinedVideosFolder);
    let allBackgroundFiles = [];
    if (hasCombinedVideos) {
      log(`Sử dụng video từ thư mục combined_videos`, LOG_LEVEL.INFO);
      const combinedVideosFolders = getSubfolders(combinedVideosFolder);
      combinedVideosFolders.forEach((folder) => {
        allBackgroundFiles.push(
          ...getFilesFromFolder(path.join(combinedVideosFolder, folder))
        );
      });
    } else {
      log(`Sử dụng video từ thư mục backgrounds`, LOG_LEVEL.INFO);
      const backgroundFolders = getSubfolders(backgroundFolder);
      backgroundFolders.forEach((folder) => {
        allBackgroundFiles.push(
          ...getFilesFromFolder(path.join(backgroundFolder, folder))
        );
      });
    }

    if (allBackgroundFiles.length === 0) {
      log("❌ Không tìm thấy video background nào!", LOG_LEVEL.ERROR);
      return;
    }
    log(
      `Đã tìm thấy tổng cộng ${allBackgroundFiles.length} video background.`,
      LOG_LEVEL.INFO
    );

    // *** THAY ĐỔI: Tính tổng số video sẽ xử lý dựa trên cấu trúc mới
    totalVideosToProcess = overlaySubfolders.reduce((total, folderName) => {
      return (
        total + getFilesFromFolder(path.join(overlayFolder, folderName)).length
      );
    }, 0);

    log(
      `🚀 Bắt đầu xử lý ${totalVideosToProcess} video từ ${overlaySubfolders.length} thư mục overlay`,
      LOG_LEVEL.INFO
    );
    log(
      `Xử lý tối đa ${maxConcurrentProcesses} video cùng lúc`,
      LOG_LEVEL.INFO
    );

    // *** THAY ĐỔI: Vòng lặp chính sẽ lặp qua các thư mục overlay
    for (let i = 0; i < overlaySubfolders.length; i++) {
      const overlayFolderName = overlaySubfolders[i];
      const currentOverlayFolderPath = path.join(
        overlayFolder,
        overlayFolderName
      );
      const currentOverlayFiles = getFilesFromFolder(currentOverlayFolderPath);

      if (currentOverlayFiles.length === 0) {
        log(
          `⚠️ Bỏ qua thư mục overlay rỗng: ${overlayFolderName}`,
          LOG_LEVEL.WARN
        );
        continue;
      }

      log(
        `📁 Đang xử lý thư mục overlay: ${overlayFolderName} (${i + 1}/${
          overlaySubfolders.length
        }) với ${currentOverlayFiles.length} video.`,
        LOG_LEVEL.INFO
      );

      // Tạo thư mục output tương ứng
      const groupFolder = path.join(outputFolder, overlayFolderName);
      if (!fs.existsSync(groupFolder)) {
        fs.mkdirSync(groupFolder, { recursive: true });
      }

      const tasks = [];
      // Tạo task cho mỗi video trong thư mục overlay hiện tại
      for (const overlayFile of currentOverlayFiles) {
        const background =
          allBackgroundFiles[
            Math.floor(Math.random() * allBackgroundFiles.length)
          ];
        const overlayFileName = path.basename(
          overlayFile,
          path.extname(overlayFile)
        );
        const outputPath = path.join(groupFolder, `${overlayFileName}.mp4`);

        tasks.push({
          overlay: overlayFile,
          background: background,
          outputPath: outputPath,
        });
      }

      // Xử lý song song
      const processBatch = async (batch) => {
        return Promise.all(
          batch.map((task) =>
            processVideo(task.overlay, task.background, task.outputPath).catch(
              (error) =>
                log(`Lỗi xử lý video: ${error.message}`, LOG_LEVEL.ERROR)
            )
          )
        );
      };

      for (let k = 0; k < tasks.length; k += maxConcurrentProcesses) {
        const batch = tasks.slice(k, k + maxConcurrentProcesses);
        await processBatch(batch);
      }

      // Upload lên VPS sau khi xử lý xong folder
      uploadVps(i, overlayFolderName);
    }

    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000 / 60).toFixed(2);
    log("\n", LOG_LEVEL.INFO);
    log(`✅ Hoàn thành! Tổng thời gian: ${totalTime} phút`, LOG_LEVEL.INFO);
  } catch (error) {
    log(`❌ Lỗi khi xử lý toàn bộ video: ${error.message}`, LOG_LEVEL.ERROR);
  }
};
// endregion

// region ========== 9. Upload VPS ==========
const uploadVps = (index, folderName) => {
  if (!useAutoUploadVps) return;
  const vpsList = readIpList();
  if (vpsList.length === 0) {
    log("⚠️ Danh sách VPS trống, không thể upload.", LOG_LEVEL.WARN);
    return;
  }
  // *** THAY ĐỔI NHỎ: Sử dụng modulo để chọn VPS an toàn hơn
  const vpsName = vpsList[index % vpsList.length];
  const currentFolderUpload = path.join(__dirname, outputFolder);
  const echoInfo = `echo Uploading ${folderName} from ${currentFolderUpload} to VPS ${vpsName} &&`;
  console.log(`\nBắt đầu upload folder ${folderName} lên VPS ${vpsName}`);

  const rcloneCmd = `rclone copy "${currentFolderUpload}" "${vpsName}:/" --include "${folderName}/**" --transfers 16 --checkers 8 --progress`;
  const cmd = `${echoInfo} ${rcloneCmd} && exit`;
  spawn("cmd.exe", ["/c", "start", "cmd.exe", "/c", cmd], {
    detached: true,
    stdio: "ignore",
    windowsVerbatimArguments: true,
  }).unref();
};
// endregion

// region ========== 9.5 Xóa file trên VPS ==========
const deleteVpsFiles = () => {
  // Không thay đổi
  if (!useAutoUploadVps) return;
  const vpsList = readIpList();
  if (vpsList.length === 0) {
    log(`Không tìm thấy danh sách VPS để xóa file`, LOG_LEVEL.WARN);
    return;
  }
  const uniqueVps = [...new Set(vpsList)];
  log(`Bắt đầu xóa file trên ${uniqueVps.length} VPS...`, LOG_LEVEL.INFO);
  for (const vpsName of uniqueVps) {
    const deleteCmd = `rclone delete "${vpsName}:/" --rmdirs && exit`;
    log(`Đang xóa file trên VPS ${vpsName}`, LOG_LEVEL.INFO);
    try {
      spawn("cmd.exe", ["/c", "start", "cmd.exe", "/c", deleteCmd], {
        detached: true,
        stdio: "ignore",
        windowsVerbatimArguments: true,
      }).unref();
      log(`Đã xóa file trên VPS ${vpsName}`, LOG_LEVEL.INFO);
    } catch (error) {
      log(
        `Lỗi khi xóa file trên VPS ${vpsName}: ${error.message}`,
        LOG_LEVEL.ERROR
      );
    }
  }
  log(`Hoàn thành xóa file trên các VPS`, LOG_LEVEL.INFO);
};
// endregion

// region ========== 10. Khởi chạy ==========
deleteVpsFiles();
processAllVideos().then(() => {
  console.log("\n🎉 Hoàn tất xử lý tất cả video.");
});
// endregion
