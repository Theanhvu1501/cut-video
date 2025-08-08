import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import chalk from "chalk";
import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import logUpdate from "log-update";
import path from "path";
import { fileURLToPath } from "url";

// =================================================================
// region ========== CÀI ĐẶT FFMPEG ==========
// =================================================================
ffmpeg.setFfmpegPath(ffmpegPath);

// =================================================================
// region ========== HỆ THỐNG LOG & HIỂN THỊ ==========
// =================================================================
const LOG_LEVEL = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
const currentLogLevel = LOG_LEVEL.INFO;
const logFile = "./render.log";

if (fs.existsSync(logFile)) fs.unlinkSync(logFile);

const writeToFile = (message) => {
  const timestamp = new Date().toISOString();
  const cleanMessage = message.replace(/[\u001b\u009b][[()#;?]*.{0,2}m/g, "");
  fs.appendFileSync(logFile, `[${timestamp}] ${cleanMessage}\n`, {
    encoding: "utf-8",
  });
};

const log = (message, level = LOG_LEVEL.INFO) => {
  if (level <= currentLogLevel) {
    logUpdate.done();
    console.log(message);
  }
  writeToFile(message);
};

let totalVideosToProcess = 0,
  processedVideos = 0,
  errorVideos = 0;
const activeProcesses = {};

const createProgressBar = (percent, width = 40) => {
  const filledWidth = Math.round((width * percent) / 100);
  const filled = "█".repeat(filledWidth);
  const empty = "░".repeat(width - filledWidth);
  return `[${chalk.green(filled)}${chalk.gray(empty)}]`;
};

const updateDisplay = () => {
  const percent =
    totalVideosToProcess > 0
      ? (processedVideos / totalVideosToProcess) * 100
      : 0;
  const pBar = createProgressBar(percent);
  const stats = `Tiến độ: ${processedVideos}/${totalVideosToProcess} (${percent.toFixed(
    2
  )}%) - ${chalk.red(errorVideos + " lỗi")}`;
  const header = chalk.bold.yellow("🚀 VIDEO RENDERING PIPELINE 🚀");
  const overall = `${header}\n${pBar} ${stats}`;
  const individual = Object.keys(activeProcesses)
    .map(
      (k) =>
        `  ${chalk.cyan("🔥 Đang render:")} ${k} - ${chalk.yellow(
          activeProcesses[k]
        )}`
    )
    .join("\n");
  logUpdate(`${overall}\n${individual}`);
};
// endregion

// =================================================================
// region ========== CẤU HÌNH & TIỆN ÍCH ==========
// =================================================================
const configsFolder = "./configs";
const overlayFolder = "./overlays";
const backgroundFolder = "./backgrounds";
const outputFolder = "./done";
const useAutoUploadVps = false;
const maxConcurrentProcesses = 2;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (fs.existsSync(outputFolder))
  fs.rmSync(outputFolder, { recursive: true, force: true });
fs.mkdirSync(outputFolder, { recursive: true });

const getFilesFromFolder = (folder) => {
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder)
    .filter((file) => path.extname(file).toLowerCase() === ".mp4");
};
const getSubfolders = (folder) => {
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
};

// *** NEW: Hàm tiện ích để chuyển đổi timemark thành giây ***
const timemarkToSeconds = (timemark) => {
  if (typeof timemark !== "string") return 0;
  const parts = timemark.split(":").map(parseFloat);
  let seconds = 0;
  if (parts.length === 3) {
    seconds += parts[0] * 3600;
    seconds += parts[1] * 60;
    seconds += parts[2];
  } else if (parts.length === 2) {
    seconds += parts[0] * 60;
    seconds += parts[1];
  }
  return seconds;
};

const loadConfigForFolder = (folderName) => {
  const defaultConfigDir = path.join(configsFolder, "default");
  const specificConfigDir = path.join(configsFolder, folderName);
  if (!fs.existsSync(defaultConfigDir))
    throw new Error("Không tìm thấy thư mục configs/default!");
  const defaultConfig = JSON.parse(
    fs.readFileSync(path.join(defaultConfigDir, "config.json"), "utf-8")
  );
  const configDirToUse = fs.existsSync(specificConfigDir)
    ? specificConfigDir
    : defaultConfigDir;

  let finalConfig = { ...defaultConfig };
  if (fs.existsSync(specificConfigDir)) {
    finalConfig = {
      ...finalConfig,
      ...JSON.parse(
        fs.readFileSync(path.join(configDirToUse, "config.json"), "utf-8")
      ),
    };
  }

  finalConfig.chromaKeyList = [];
  const chromaKeyFilePath = path.join(configDirToUse, "chroma_keys.txt");
  if (fs.existsSync(chromaKeyFilePath)) {
    try {
      const content = fs.readFileSync(chromaKeyFilePath, "utf-8");
      finalConfig.chromaKeyList = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^[0-9A-Fa-f]{6}$/.test(l));
    } catch (e) {
      log(
        chalk.red(`- Lỗi khi đọc file key ${chromaKeyFilePath}: ${e.message}`),
        LOG_LEVEL.WARN
      );
    }
  }
  return finalConfig;
};
// endregion

// =================================================================
// region ========== XỬ LÝ VIDEO ==========
// =================================================================
const complexFilter = (config, overlayIndex) => {
  let finalChromaColor =
    config.chromaKeyList && config.chromaKeyList.length > 0
      ? config.chromaKeyList[overlayIndex % config.chromaKeyList.length]
      : config.chromaColor;

  if (config.useChromaKey) {
    if (!finalChromaColor)
      throw new Error(
        "useChromaKey là true nhưng không tìm thấy màu nào để áp dụng!"
      );
    const filterDefs = [
      `[1:v]scale=1280:720,colorkey=0x${finalChromaColor}:${config.chromaSimilarity}:${config.chromaBlend},format=yuva420p[overlay_v]`,
      `[0:v][overlay_v]overlay=0:H-h[final_v]`,
      `[1:a]volume=${config.audioVolume || 1.0}[final_a]`,
    ];
    return filterDefs.join("; ");
  } else {
    const cropHeight = config.cropHeight || 190;
    const cropYOffset = config.cropYOffset || 490;
    const filterDefs = [
      `[1:v]scale=1280:720,crop=1280:${cropHeight}:0:${cropYOffset}[cropped]`,
      `[cropped]format=yuva420p,colorchannelmixer=aa=0.8[overlay_v]`,
      `[0:v][overlay_v]overlay=0:H-h[final_v]`,
      `[1:a]volume=${config.audioVolume || 1.0}[final_a]`,
    ];
    return filterDefs.join("; ");
  }
};

const processVideo = async (task) => {
  const { overlayPath, backgroundPath, outputPath, config, overlayIndex } =
    task;
  const videoKey = path.basename(outputPath);

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(overlayPath, (err, metadata) => {
      if (err) {
        log(
          chalk.red(`Lỗi metadata ${videoKey}: ${err.message}`),
          LOG_LEVEL.ERROR
        );
        processedVideos++;
        errorVideos++;
        updateDisplay();
        reject(err);
        return;
      }
      // Lấy tổng thời lượng chính xác của video overlay
      const totalDuration = metadata.format.duration;
      activeProcesses[videoKey] = "0.00%";
      updateDisplay();

      const command = ffmpeg(backgroundPath)
        .inputOptions(["-stream_loop", "-1"])
        .input(overlayPath)
        .complexFilter(complexFilter(config, overlayIndex), [
          "final_v",
          "final_a",
        ])
        .outputOptions("-preset", config.preset)
        .outputOptions("-t", totalDuration)
        .on("progress", (p) => {
          // *** THAY ĐỔI LỚN: TỰ TÍNH TOÁN LẠI % ***
          const currentSeconds = timemarkToSeconds(p.timemark);
          let accuratePercent = (currentSeconds / totalDuration) * 100;
          if (accuratePercent > 100) accuratePercent = 100;
          if (accuratePercent < 0) accuratePercent = 0;

          activeProcesses[videoKey] = `${accuratePercent.toFixed(2)}%`;
          updateDisplay();
        })
        .on("end", () => {
          delete activeProcesses[videoKey];
          log(chalk.green(`✅ ${videoKey} hoàn thành`), LOG_LEVEL.INFO);
          processedVideos++;
          updateDisplay();
          resolve();
        })
        .on("error", (e, stdout, stderr) => {
          delete activeProcesses[videoKey];
          log(
            chalk.red(`❌ Lỗi khi xử lý ${videoKey}: ${e.message}`),
            LOG_LEVEL.ERROR
          );
          writeToFile(
            `--- FFMPEG STDERR for ${videoKey} ---\n${stderr}\n--- END ---`
          );
          processedVideos++;
          errorVideos++;
          updateDisplay();
          reject(e);
        });

      command.save(outputPath);
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
    const overlaySubfolders = getSubfolders(overlayFolder);
    if (overlaySubfolders.length === 0)
      throw new Error("Không tìm thấy thư mục con nào trong 'overlays'!");

    totalVideosToProcess = overlaySubfolders.reduce(
      (total, dir) =>
        total + getFilesFromFolder(path.join(overlayFolder, dir)).length,
      0
    );
    log(
      chalk.blue(`Tổng số video cần xử lý: ${totalVideosToProcess}`),
      LOG_LEVEL.INFO
    );

    for (const folderName of overlaySubfolders) {
      const config = loadConfigForFolder(folderName);
      log(chalk.magenta(`\n📁 Xử lý thư mục: ${folderName}`), LOG_LEVEL.INFO);

      let backgroundFilesForThisFolder = [];
      const specificBackgroundDir = path.join(backgroundFolder, folderName);
      const defaultBackgroundDir = path.join(backgroundFolder, "default");

      if (
        fs.existsSync(specificBackgroundDir) &&
        getFilesFromFolder(specificBackgroundDir).length > 0
      ) {
        backgroundFilesForThisFolder = getFilesFromFolder(
          specificBackgroundDir
        ).map((f) => path.join(specificBackgroundDir, f));
        log(
          chalk.gray(`- Sử dụng backgrounds từ thư mục riêng: ${folderName}`),
          LOG_LEVEL.DEBUG
        );
      } else if (
        fs.existsSync(defaultBackgroundDir) &&
        getFilesFromFolder(defaultBackgroundDir).length > 0
      ) {
        backgroundFilesForThisFolder = getFilesFromFolder(
          defaultBackgroundDir
        ).map((f) => path.join(defaultBackgroundDir, f));
        log(
          chalk.gray(`- Sử dụng backgrounds từ thư mục mặc định: default`),
          LOG_LEVEL.DEBUG
        );
      }

      if (backgroundFilesForThisFolder.length === 0) {
        log(
          chalk.yellow(
            `⚠️ Cảnh báo: Không tìm thấy video background cho '${folderName}'. Bỏ qua thư mục này.`
          ),
          LOG_LEVEL.WARN
        );
        const skippedCount = getFilesFromFolder(
          path.join(overlayFolder, folderName)
        ).length;
        processedVideos += skippedCount;
        updateDisplay();
        continue;
      }

      const currentOverlayFileNames = getFilesFromFolder(
        path.join(overlayFolder, folderName)
      );
      if (currentOverlayFileNames.length === 0) continue;

      const groupFolder = path.join(outputFolder, folderName);
      fs.mkdirSync(groupFolder, { recursive: true });

      const tasks = currentOverlayFileNames.map((fileName, index) => ({
        overlayPath: path.join(overlayFolder, folderName, fileName),
        backgroundPath:
          backgroundFilesForThisFolder[
            Math.floor(Math.random() * backgroundFilesForThisFolder.length)
          ],
        outputPath: path.join(groupFolder, fileName),
        config: config,
        overlayIndex: index,
      }));

      for (let k = 0; k < tasks.length; k += maxConcurrentProcesses) {
        const batch = tasks.slice(k, k + maxConcurrentProcesses);
        await Promise.all(
          batch.map((task) => processVideo(task).catch(() => {}))
        );
      }
      uploadVps(folderName, config);
    }
    logUpdate.done();
    console.log(
      chalk.bold.green(
        `\n🎉 Hoàn thành! Tổng thời gian: ${(
          (Date.now() - startTime) /
          60000
        ).toFixed(2)} phút`
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
// region ========== UPLOAD VPS ==========
// =================================================================
const uploadVps = (folderName, config) => {
  if (!useAutoUploadVps || !config.vpsRemoteName) return;
  const vpsName = config.vpsRemoteName;
  const currentFolderUpload = path.join(__dirname, outputFolder);
  log(
    chalk.blueBright(
      `\n📡 Bắt đầu upload ${folderName} lên VPS remote: ${vpsName}...`
    ),
    LOG_LEVEL.INFO
  );
  const cmd = `rclone copy "${currentFolderUpload}" "${vpsName}:/" --include "${folderName}/**" --transfers 16 --checkers 8 --progress`;
  spawn("cmd.exe", ["/c", "start", "cmd.exe", "/c", `${cmd} && exit`], {
    detached: true,
  }).unref();
};
// endregion

// =================================================================
// region ========== KHỞI CHẠY ==========
// =================================================================
processAllVideos();
// endregion
