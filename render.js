import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
ffmpeg.setFfmpegPath(ffmpegPath);

// =================================================================
// 0. CẤU HÌNH & LOGGING (ĐÃ NÂNG CẤP)
// =================================================================

const LOG_LEVEL = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
const currentLogLevel = LOG_LEVEL.INFO;
const logFile = "./render.log";
// Xóa log cũ khi bắt đầu
if (fs.existsSync(logFile)) fs.unlinkSync(logFile);

const logToQueue = (message) => {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`, {
    encoding: "utf-8",
  });
};

// --- HỆ THỐNG HIỂN THỊ TIẾN TRÌNH MỚI ---
let totalVideosToProcess = 0;
let processedVideos = 0;
let errorVideos = 0;
let progressSlots = []; // Mảng lưu trạng thái của từng slot xử lý song song
let dashboardInterval;

// Hàm khởi tạo các slot tiến trình
const initializeProgressSlots = (count) => {
  progressSlots = Array.from({ length: count }, (_, i) => ({
    id: i,
    message: "Đang chờ...",
  }));
};

// Hàm render toàn bộ bảng điều khiển tiến trình
const renderProgressDashboard = () => {
  // Sử dụng process.stdout.write và \r để tránh làm đầy console và file log
  const clearScreen = "\x1B[2J\x1B[0f";
  process.stdout.write(clearScreen);

  let output = "BẢNG ĐIỀU KHIỂN TIẾN TRÌNH RENDER:\n";
  output += "=======================================\n";
  progressSlots.forEach((slot) => {
    output += `[Slot ${slot.id + 1}] ${slot.message}\n`;
  });
  output += "=======================================\n";
  const overallPercent =
    totalVideosToProcess > 0
      ? Math.round((processedVideos / totalVideosToProcess) * 100)
      : 0;
  output += `TỔNG QUAN: ${processedVideos}/${totalVideosToProcess} videos (${overallPercent}%) - Lỗi: ${errorVideos}\n`;

  process.stdout.write(output);
};

const startDashboard = () => {
  if (dashboardInterval) clearInterval(dashboardInterval);
  dashboardInterval = setInterval(renderProgressDashboard, 200); // Cập nhật 5 lần/giây
};

const stopDashboard = () => {
  clearInterval(dashboardInterval);
  renderProgressDashboard(); // Render lần cuối để đảm bảo thông tin chính xác
  process.stdout.write("\n"); // Xuống dòng để không ghi đè log cuối
};

// =================================================================
// 1. ĐƯỜNG DẪN & CẤU HÌNH
// =================================================================
const overlayFolder = "./overlays";
const backgroundFolder = "./backgrounds";
const combinedVideosFolder = "./combined_videos";
const outputFolder = "./done";
const useChromaKey = true;
const defaultColor = "4887EE";
const chromaKeyFile = "./chromaKey.txt";
const height = 190;
const y_offset = 490;
const ipList = "./vps.txt";
const useAutoUploadVps = true;
const maxConcurrentProcesses = 2;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (fs.existsSync(outputFolder)) {
  logToQueue(`Thư mục ${outputFolder} đã tồn tại, đang xóa...`);
  fs.rmSync(outputFolder, { recursive: true, force: true });
}
fs.mkdirSync(outputFolder, { recursive: true });

// =================================================================
// 2. CÁC HÀM TIỆN ÍCH
// =================================================================
const getSubfolders = (folder) =>
  fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const getFilesFromFolder = (folder) =>
  fs.existsSync(folder)
    ? fs
        .readdirSync(folder)
        .filter((f) => path.extname(f).toLowerCase() === ".mp4")
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((f) => path.join(folder, f))
    : [];
const readIpList = () =>
  fs.existsSync(ipList)
    ? fs
        .readFileSync(ipList, "utf-8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
    : [];
const readChromaKeyColors = () =>
  fs.existsSync(chromaKeyFile)
    ? fs
        .readFileSync(chromaKeyFile, "utf-8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^[0-9A-Fa-f]{6}$/.test(l))
    : [];
const chromaKeyColors = readChromaKeyColors();

// =================================================================
// 3. HÀM XỬ LÝ VIDEO (ĐÃ NÂNG CẤP)
// =================================================================
const complexFilter = (folderIndex) => {
  const videoColor =
    folderIndex >= 0 && folderIndex < chromaKeyColors.length
      ? chromaKeyColors[folderIndex]
      : defaultColor;
  if (useChromaKey)
    return [
      `[1:v]scale=1280:720,colorkey=0x${videoColor}:0.3:0.1,format=yuva420p[ov]`,
      `[0:v][ov]overlay=0:H-h[v]`,
      `[1:a]volume=1.0[a]`,
    ];
  return [
    `[1:v]scale=1280:720,crop=1280:${height}:0:${y_offset}[c]`,
    `[c]eq=b=-1:c=3:g=1.2:s=0[f]`,
    `[f]format=yuva420p,colorchannelmixer=aa=0.8[ov]`,
    `[0:v][ov]overlay=0:H-h[v]`,
    `[1:a]volume=1.0[a]`,
  ];
};

const processVideo = async (
  inputOverlay,
  inputBackground,
  outputPath,
  folderIndex,
  slotId
) => {
  return new Promise((resolve, reject) => {
    const videoName = path.basename(outputPath);
    progressSlots[slotId].message = `Bắt đầu ${videoName}...`;
    const startTime = Date.now();
    ffmpeg.ffprobe(inputOverlay, (err, metadata) => {
      if (err) {
        progressSlots[slotId].message = `❌ Lỗi metadata ${videoName}`;
        processedVideos++;
        errorVideos++;
        return reject(err);
      }
      const duration = metadata.format.duration;
      ffmpeg(inputBackground)
        .inputOptions(["-stream_loop", "-1"])
        .input(inputOverlay)
        .complexFilter(complexFilter(folderIndex))
        .outputOptions("-preset", "ultrafast", "-t", duration)
        .audioCodec("aac")
        .map("[v]")
        .map("[a]")
        .on("progress", (progress) => {
          const percent = progress.percent ? progress.percent.toFixed(2) : 0;
          progressSlots[slotId].message = `Render ${videoName}... ${percent}%`;
        })
        .on("end", () => {
          const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
          progressSlots[
            slotId
          ].message = `✅ Hoàn thành ${videoName} trong ${timeTaken}s`;
          processedVideos++;
          resolve();
        })
        .on("error", (error) => {
          progressSlots[slotId].message = `❌ Lỗi render ${videoName}`;
          logToQueue(`Lỗi chi tiết ${videoName}: ${error.message}`);
          processedVideos++;
          errorVideos++;
          reject(error);
        })
        .save(outputPath);
    });
  });
};

// =================================================================
// 4. HÀM UPLOAD & DỌN DẸP VPS
// =================================================================
const uploadVps = (index, folderName) => {
  if (!useAutoUploadVps) return;
  const vpsList = readIpList();
  if (index >= vpsList.length) {
    logToQueue(
      `⚠️ Không có VPS tương ứng cho thư mục ${folderName} (index ${index})`
    );
    return;
  }
  const vpsName = vpsList[index];
  const currentFolderUpload = path.join(__dirname, outputFolder);
  const rcloneCmd = `rclone copy "${currentFolderUpload}" "${vpsName}:/" --include "${folderName}/**" --transfers 16 --checkers 8 --progress`;
  spawn(
    "cmd.exe",
    [
      "/c",
      "start",
      "cmd.exe",
      "/c",
      `echo Uploading to ${vpsName} && ${rcloneCmd} && exit`,
    ],
    { detached: true, stdio: "ignore" }
  ).unref();
  logToQueue(`Đã bắt đầu upload folder ${folderName} lên VPS ${vpsName}`);
};

const deleteVpsFiles = () => {
  if (!useAutoUploadVps) return;
  const uniqueVps = [...new Set(readIpList())];
  if (uniqueVps.length === 0) return;
  logToQueue(`Bắt đầu xóa file trên ${uniqueVps.length} VPS...`);
  uniqueVps.forEach((vpsName) => {
    spawn(
      "cmd.exe",
      [
        "/c",
        "start",
        "cmd.exe",
        "/c",
        `rclone delete "${vpsName}:/" --rmdirs && exit`,
      ],
      { detached: true, stdio: "ignore" }
    ).unref();
  });
};

// =================================================================
// 5. HÀM ĐIỀU PHỐI CHÍNH (ĐÃ NÂNG CẤP)
// =================================================================
const processAllVideos = async () => {
  const startTime = Date.now();
  try {
    const overlayFolders = getSubfolders(overlayFolder);
    if (overlayFolders.length === 0) {
      console.log("❌ Không tìm thấy thư mục con nào trong ./overlays/");
      return;
    }
    const backgroundSourceFolder = fs.existsSync(combinedVideosFolder)
      ? combinedVideosFolder
      : backgroundFolder;

    overlayFolders.forEach((folderName) => {
      totalVideosToProcess += getFilesFromFolder(
        path.join(overlayFolder, folderName)
      ).length;
    });

    initializeProgressSlots(maxConcurrentProcesses);
    startDashboard();

    logToQueue(
      `🚀 Bắt đầu xử lý cho ${overlayFolders.length} kênh, tổng cộng ${totalVideosToProcess} video.`
    );
    logToQueue(`Xử lý tối đa ${maxConcurrentProcesses} video cùng lúc`);

    for (let i = 0; i < overlayFolders.length; i++) {
      const folderName = overlayFolders[i];
      const groupFolder = path.join(outputFolder, folderName);
      if (!fs.existsSync(groupFolder))
        fs.mkdirSync(groupFolder, { recursive: true });

      const overlayFiles = getFilesFromFolder(
        path.join(overlayFolder, folderName)
      );
      const backgroundFiles = getFilesFromFolder(
        path.join(backgroundSourceFolder, folderName)
      );
      if (overlayFiles.length === 0 || backgroundFiles.length === 0) {
        logToQueue(
          `⚠️ Bỏ qua kênh ${folderName} do thiếu video overlay hoặc background.`
        );
        processedVideos += overlayFiles.length; // Cập nhật để tiến trình tổng quan không bị sai
        continue;
      }

      const tasks = overlayFiles.map((overlay) => ({
        overlay,
        background:
          backgroundFiles[Math.floor(Math.random() * backgroundFiles.length)],
        outputPath: path.join(
          groupFolder,
          `${path.basename(overlay, path.extname(overlay))}.mp4`
        ),
        folderIndex: i,
      }));

      for (let k = 0; k < tasks.length; k += maxConcurrentProcesses) {
        const batch = tasks.slice(k, k + maxConcurrentProcesses);
        await Promise.all(
          batch.map((task, index) =>
            processVideo(
              task.overlay,
              task.background,
              task.outputPath,
              task.folderIndex,
              index
            ).catch(() => {})
          )
        );
      }

      uploadVps(i, folderName);
    }
  } catch (error) {
    logToQueue(`❌ Lỗi nghiêm trọng khi xử lý: ${error.message}`);
  } finally {
    stopDashboard();
    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000 / 60).toFixed(2);
    console.log(
      `✅ Hoàn thành! Tổng thời gian: ${totalTime} phút. Xem chi tiết tại ${logFile}`
    );
  }
};

// =================================================================
// 6. KHỞI CHẠY
// =================================================================
deleteVpsFiles();
processAllVideos();
