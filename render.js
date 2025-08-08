import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import chalk from "chalk"; // Thư viện để thêm màu sắc
import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import logUpdate from "log-update";
import path from "path";
import { fileURLToPath } from "url";

ffmpeg.setFfmpegPath(ffmpegPath);

// =================================================================
// region ========== HỆ THỐNG LOG & HIỂN THỊ NÂNG CAO ==========
// =================================================================

const LOG_LEVEL = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};
const currentLogLevel = LOG_LEVEL.INFO;
const logFile = "./render.log";

// Hàm ghi log vào file
const writeToFile = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, logMessage);
  } catch (error) {
    console.error(`Lỗi khi ghi log: ${error.message}`);
  }
};

// Hàm log ra console và file
const log = (message, level = LOG_LEVEL.INFO) => {
  if (level <= currentLogLevel) {
    // Xóa khối log-update hiện tại để in log tĩnh
    logUpdate.clear();
    console.log(message);
    // Vẽ lại khối log-update
    updateDisplay();
  }
  writeToFile(message);
};

// State để theo dõi tiến trình
let totalVideosToProcess = 0;
let processedVideos = 0;
let errorVideos = 0;
const activeProcesses = {}; // Lưu tiến độ của các video đang render

// Hàm tạo thanh tiến trình
const createProgressBar = (percent, width = 40) => {
  const filledWidth = Math.round((width * percent) / 100);
  const emptyWidth = width - filledWidth;
  const filled = "█".repeat(filledWidth);
  const empty = "░".repeat(emptyWidth);
  return `[${chalk.green(filled)}${chalk.gray(empty)}]`;
};

// Hàm hiển thị tập trung, trái tim của giao diện log
const updateDisplay = () => {
  // 1. Xây dựng khối tiến độ tổng thể
  const percent =
    totalVideosToProcess > 0
      ? (processedVideos / totalVideosToProcess) * 100
      : 0;
  const progressBar = createProgressBar(percent);
  const overallStats = `Tiến độ: ${processedVideos}/${totalVideosToProcess} (${percent.toFixed(
    2
  )}%) - ${chalk.red(errorVideos + " lỗi")}`;
  const header = chalk.bold.yellow("🚀 VIDEO RENDERING PIPELINE 🚀");

  const overallProgressBlock = `${header}\n${progressBar} ${overallStats}`;

  // 2. Xây dựng danh sách các video đang render
  const individualProgress = Object.keys(activeProcesses)
    .map(
      (key) =>
        `  ${chalk.cyan("🔥 Đang render:")} ${key} - ${chalk.yellow(
          activeProcesses[key]
        )}`
    )
    .join("\n");

  // 3. Kết hợp và hiển thị bằng log-update
  logUpdate(`${overallProgressBlock}\n${individualProgress}`);
};
// endregion

// =================================================================
// region ========== CẤU HÌNH & ĐƯỜNG DẪN ==========
// =================================================================

const overlayFolder = "./overlays";
const backgroundFolder = "./backgrounds";
const combinedVideosFolder = "./combined_videos";
const outputFolder = "./done";
const useChromaKey = true;
const color = "4887EE";
const chromaKeyFile = "./chromaKey.txt";
const height = 190;
const y_offset = 490;
const ipList = "./vps.txt";
const useAutoUploadVps = false;
const maxConcurrentProcesses = 2; // Đặt số lượng render song song
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (fs.existsSync(outputFolder)) {
  console.log(chalk.yellow(`Thư mục ${outputFolder} đã tồn tại, đang xóa...`));
  fs.rmSync(outputFolder, { recursive: true, force: true });
}
fs.mkdirSync(outputFolder, { recursive: true });
writeToFile("Đã dọn dẹp và tạo lại thư mục output.");

// endregion

// =================================================================
// region ========== TIỆN ÍCH ĐỌC FILE ==========
// =================================================================

const getFilesFromFolder = (folder, fileTypes = [".mp4"]) => {
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder)
    .filter((file) => fileTypes.includes(path.extname(file).toLowerCase()))
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    )
    .map((file) => path.join(folder, file));
};

const getSubfolders = (folder) => {
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
};

const readIpList = () => {
  try {
    if (!fs.existsSync(ipList)) return [];
    const content = fs.readFileSync(ipList, "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch (error) {
    log(chalk.red(`❌ Lỗi khi đọc file IP: ${error.message}`), LOG_LEVEL.ERROR);
    return [];
  }
};

const readChromaKeyColors = () => {
  const colors = [];
  try {
    if (fs.existsSync(chromaKeyFile)) {
      const content = fs.readFileSync(chromaKeyFile, "utf-8");
      return content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^[0-9A-Fa-f]{6}$/.test(l));
    }
  } catch (error) {
    log(
      chalk.red(`Lỗi khi đọc file ${chromaKeyFile}: ${error.message}`),
      LOG_LEVEL.ERROR
    );
  }
  return colors;
};

const chromaKeyColors = readChromaKeyColors();
const overlaySubfolders = getSubfolders(overlayFolder);
// endregion

// =================================================================
// region ========== XỬ LÝ VIDEO ==========
// =================================================================

const complexFilter = (inputOverlay) => {
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
  const videoKey = path.basename(outputPath);

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    ffmpeg.ffprobe(inputOverlay, (err, metadata) => {
      if (err) {
        log(
          chalk.red(`Lỗi metadata video overlay: ${err.message}`),
          LOG_LEVEL.ERROR
        );
        processedVideos++;
        errorVideos++;
        updateDisplay();
        return reject(err);
      }

      activeProcesses[videoKey] = "Bắt đầu...";
      updateDisplay();

      ffmpeg(inputBackground)
        .inputOptions(["-stream_loop", "-1"])
        .input(inputOverlay)
        .complexFilter(complexFilter(inputOverlay))
        .outputOptions("-preset", "ultrafast")
        .outputOptions("-t", metadata.format.duration)
        .audioCodec("aac")
        .map("[combined_video]")
        .map("[overlay_audio]")
        .on("progress", (progress) => {
          const percent =
            progress.percent < 0 ? 0 : progress.percent.toFixed(2);
          activeProcesses[videoKey] = `${percent}%`;
          updateDisplay();
        })
        .on("end", () => {
          delete activeProcesses[videoKey];
          const duration = ((Date.now() - startTime) / 1000).toFixed(2);
          log(
            chalk.green(`✅ ${videoKey} hoàn thành trong ${duration}s`),
            LOG_LEVEL.INFO
          );
          processedVideos++;
          updateDisplay();
          resolve();
        })
        .on("error", (error) => {
          delete activeProcesses[videoKey];
          log(
            chalk.red(`❌ Lỗi khi xử lý ${videoKey}: ${error.message}`),
            LOG_LEVEL.ERROR
          );
          processedVideos++;
          errorVideos++;
          updateDisplay();
          reject(error);
        })
        .save(outputPath);
    });
  });
};
// endregion

// =================================================================
// region ========== LUỒNG XỬ LÝ CHÍNH ==========
// =================================================================

const processAllVideos = async () => {
  const startTime = Date.now();
  try {
    if (overlaySubfolders.length === 0) {
      log(
        chalk.red("❌ Không tìm thấy thư mục con nào trong 'overlays'!"),
        LOG_LEVEL.ERROR
      );
      return;
    }

    const hasCombinedVideos = fs.existsSync(combinedVideosFolder);
    const sourcePath = hasCombinedVideos
      ? combinedVideosFolder
      : backgroundFolder;
    let allBackgroundFiles = getSubfolders(sourcePath).flatMap((folder) =>
      getFilesFromFolder(path.join(sourcePath, folder))
    );

    if (allBackgroundFiles.length === 0) {
      log(
        chalk.red("❌ Không tìm thấy video background nào!"),
        LOG_LEVEL.ERROR
      );
      return;
    }

    totalVideosToProcess = overlaySubfolders.reduce(
      (total, folderName) =>
        total + getFilesFromFolder(path.join(overlayFolder, folderName)).length,
      0
    );

    log(
      chalk.blue(`Tổng số video cần xử lý: ${totalVideosToProcess}`),
      LOG_LEVEL.INFO
    );
    log(
      chalk.blue(`Xử lý tối đa ${maxConcurrentProcesses} video cùng lúc`),
      LOG_LEVEL.INFO
    );

    for (let i = 0; i < overlaySubfolders.length; i++) {
      const overlayFolderName = overlaySubfolders[i];
      const currentOverlayFiles = getFilesFromFolder(
        path.join(overlayFolder, overlayFolderName)
      );

      if (currentOverlayFiles.length === 0) continue;

      log(
        chalk.magenta(
          `\n📁 Bắt đầu xử lý thư mục: ${overlayFolderName} (${i + 1}/${
            overlaySubfolders.length
          })`
        ),
        LOG_LEVEL.INFO
      );

      const groupFolder = path.join(outputFolder, overlayFolderName);
      fs.mkdirSync(groupFolder, { recursive: true });

      const tasks = currentOverlayFiles.map((overlayFile) => ({
        overlay: overlayFile,
        background:
          allBackgroundFiles[
            Math.floor(Math.random() * allBackgroundFiles.length)
          ],
        outputPath: path.join(
          groupFolder,
          `${path.basename(overlayFile, path.extname(overlayFile))}.mp4`
        ),
      }));

      for (let k = 0; k < tasks.length; k += maxConcurrentProcesses) {
        const batch = tasks.slice(k, k + maxConcurrentProcesses);
        await Promise.all(
          batch.map((task) =>
            processVideo(task.overlay, task.background, task.outputPath).catch(
              () => {}
            )
          )
        );
      }

      uploadVps(i, overlayFolderName);
    }

    logUpdate.done();
    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    console.log(
      chalk.bold.green(
        `\n🎉 Hoàn thành tất cả! Tổng thời gian: ${totalTime} phút`
      )
    );
  } catch (error) {
    logUpdate.done();
    console.log(
      chalk.red.bold(`\n❌ Đã xảy ra lỗi nghiêm trọng: ${error.message}`)
    );
  }
};
// endregion

// =================================================================
// region ========== UPLOAD & XÓA VPS ==========
// =================================================================

const uploadVps = (index, folderName) => {
  if (!useAutoUploadVps) return;
  const vpsList = readIpList();
  if (vpsList.length === 0) return;

  const vpsName = vpsList[index % vpsList.length];
  const currentFolderUpload = path.join(__dirname, outputFolder);
  const echoInfo = `echo Uploading ${folderName} to VPS ${vpsName} &&`;
  log(
    chalk.blueBright(`\n📡 Bắt đầu upload ${folderName} lên VPS ${vpsName}...`),
    LOG_LEVEL.INFO
  );

  const rcloneCmd = `rclone copy "${currentFolderUpload}" "${vpsName}:/" --include "${folderName}/**" --transfers 16 --checkers 8 --progress`;
  const cmd = `${echoInfo} ${rcloneCmd} && exit`;
  spawn("cmd.exe", ["/c", "start", "cmd.exe", "/c", cmd], {
    detached: true,
    stdio: "ignore",
    windowsVerbatimArguments: true,
  }).unref();
};

const deleteVpsFiles = () => {
  if (!useAutoUploadVps) return;
  const vpsList = [...new Set(readIpList())];
  if (vpsList.length === 0) return;

  log(
    chalk.yellow(`Bắt đầu xóa file trên ${vpsList.length} VPS...`),
    LOG_LEVEL.INFO
  );
  for (const vpsName of vpsList) {
    const deleteCmd = `rclone delete "${vpsName}:/" --rmdirs && exit`;
    spawn("cmd.exe", ["/c", "start", "cmd.exe", "/c", deleteCmd], {
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: true,
    }).unref();
  }
  log(chalk.yellow(`Đã gửi lệnh xóa đến các VPS.`), LOG_LEVEL.INFO);
};
// endregion

// =================================================================
// region ========== KHỞI CHẠY ==========
// =================================================================

deleteVpsFiles();
processAllVideos();
// endregion
