import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
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
const combinedVideosFolder = "./combined_videos";
const outputFolder = "./done";
const chromaKeyFile = "./chromaKey.txt";
const height = 190;
const y_offset = 490;
const ipList = "./vps.txt";
const gpuVideoCodec = "h264_nvenc";
const maxConcurrentProcesses = 2;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const useAutoUploadVps = false;
const useGPU = false;

const topTransparent = false;
const opacity = 0.7;

const useChromaKey = true;
const color = "D4F9D7";

const useKeepColor = true; // Bật chế độ giữ màu (sẽ ưu tiên hơn useChromaKey cũ)
const keepColorsList = ["85F33A", "222222", "FFFFFF"];
const keepSimilarity = 0.2; // Độ sai số màu (0.1 - 0.3 là đẹp)

// Tạo thư mục nếu chưa tồn tạ

// if (fs.existsSync(outputFolder)) {
//   log(`Thư mục ${outputFolder} đã tồn tại, đang xóa...`, LOG_LEVEL.INFO);
//   fs.rmSync(outputFolder, { recursive: true, force: true });
// }

// fs.mkdirSync(outputFolder, { recursive: true });
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
// endregion

// region ========== 6. Tính vị trí video bắt đầu ==========
const calculateStartIndex = (folderIndex, day, totalVideos) => {
  const offset = (day - 1) * videosPerFolder;
  return (folderIndex * videosPerFolder + offset) % totalVideos;
};
// endregion

// region ========== 7. Xử lý video ==========
const complexFilter = (inputOverlay) => {
  const overlayIndex = overlayFiles.findIndex((file) => file === inputOverlay);
  const videoColor =
    overlayIndex >= 0 && overlayIndex < chromaKeyColors.length
      ? chromaKeyColors[overlayIndex]
      : color;

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

const complexFilterTopTransparent = () => {
  const filter = [
    // 1. Lấy video background [0:v], scale về 1280x720.
    // 2. Thêm kênh alpha (độ trong suốt) và đặt opacity là 0.9 (tức là mờ đi 10%).
    // 3. Đặt tên cho stream này là [top_video].
    `[0:v]scale=1280:720,format=yuva420p,colorchannelmixer=aa=${opacity}[top_video]`,

    // 4. Lấy video overlay [1:v], scale về 1280x720 để cùng kích thước.
    // 5. Đặt tên cho stream này là [base_video].
    "[1:v]scale=1280:720[base_video]",
  ];

  return [
    filter.join(";"), // Nối các bước chuẩn bị lại
    "[base_video][top_video]overlay=0:0[combined_video]", // Đặt [top_video] lên trên [base_video]
    "[1:a]volume=1.0[overlay_audio]", // Vẫn sử dụng âm thanh từ video overlay
  ];
};

const complexFilterKeepColor = () => {
  const filters = [];
  const outputs = [];

  // 1. Duyệt qua từng màu cần giữ để tách nền
  keepColorsList.forEach((hexColor, index) => {
    // Bước A: Dùng colorkey để chọn màu.
    // Lưu ý: colorkey mặc định sẽ làm màu đó trong suốt (Alpha=0).
    // Chúng ta cần nó làm màu đó thành Alpha=0 để sau đó đảo ngược.
    filters.push(
      `[1:v]colorkey=0x${hexColor}:${keepSimilarity}:0.1[ck_temp_${index}]`
    );

    // Bước B: Trích xuất kênh Alpha từ kết quả trên và ĐẢO NGƯỢC (negate).
    // Sau khi negate: Màu được chọn sẽ có Alpha=1 (hiện), các màu khác Alpha=0 (ẩn).
    filters.push(`[ck_temp_${index}]alphaextract,negate[mask_${index}]`);

    // Bước C: Áp mask này ngược lại vào video gốc để lấy ra phần hình ảnh chỉ chứa màu đó.
    filters.push(`[1:v][mask_${index}]alphamerge[isolated_${index}]`);

    outputs.push(`[isolated_${index}]`);
  });

  // 2. Gộp (Stack) tất cả các layer màu đã tách lại với nhau
  // Nếu chỉ có 1 màu, lấy luôn output đó. Nếu nhiều màu, overlay chồng lên nhau.
  let currentStream = outputs[0];

  for (let i = 1; i < outputs.length; i++) {
    const nextStream = outputs[i];
    const outName = `[stack_${i}]`;
    filters.push(`${currentStream}${nextStream}overlay=0:0${outName}`);
    currentStream = outName;
  }

  // 3. Scale về kích thước chuẩn (1280x720) để khớp với background
  filters.push(`${currentStream}scale=1280:720[final_overlay]`);

  // 4. Trả về mảng filter hoàn chỉnh cho ffmpeg
  return [
    filters.join(";"), // Chuỗi filter xử lý tách màu
    `[0:v][final_overlay]overlay=0:H-h[combined_video]`, // Overlay lên background gốc
    "[1:a]volume=1.0[overlay_audio]", // Giữ nguyên âm thanh
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

      let filterConfig;
      if (useKeepColor) {
        log(
          `🎨 Sử dụng chế độ GIỮ MÀU (Keep Colors) cho ${path.basename(
            outputPath
          )}`,
          LOG_LEVEL.DEBUG
        );
        filterConfig = complexFilterKeepColor();
      } else if (topTransparent) {
        log(
          `✨ Sử dụng chế độ đè lớp phủ trong suốt cho ${path.basename(
            outputPath
          )}`,
          LOG_LEVEL.DEBUG
        );
        filterConfig = complexFilterTopTransparent();
      } else {
        log(
          `🎨 Sử dụng chế độ Chroma Key cho ${path.basename(outputPath)}`,
          LOG_LEVEL.DEBUG
        );
        filterConfig = complexFilter(inputOverlay);
      }
      const command = ffmpeg(inputBackground)
        .inputOptions(["-stream_loop", "-1"])
        .input(inputOverlay)
        .complexFilter(filterConfig)
        .outputOptions("-t", duration)
        .audioCodec("aac")
        .map("[combined_video]")
        .map("[overlay_audio]");

      if (useGPU) {
        log(
          `🚀 Sử dụng GPU (${gpuVideoCodec}) để render ${path.basename(
            outputPath
          )}`,
          LOG_LEVEL.DEBUG
        );
        command
          .videoCodec(gpuVideoCodec) // Sử dụng encoder của NVIDIA
          .outputOptions([
            // '-preset p2',  // p1=fastest, p7=slowest. 'p2' hoặc 'p3' là điểm cân bằng tốt.
            // '-tune hq',    // hq=high quality, ll=low latency. 'hq' tốt cho render offline.
            // '-cq 23',      // Constant Quality. Giá trị càng thấp, chất lượng càng cao. Khoảng 20-25 là hợp lý.
            // '-b:v 0'       // Bắt buộc khi sử dụng chế độ Constant Quality (cq).
            "-preset:v",
            "fast", // Một cách viết khác, `fast` tương đương với các preset p thấp.
            "-cq:v",
            "23", // Đặt chất lượng
          ]);
      } else {
        // Cấu hình CPU cũ
        log(
          `🐌 Sử dụng CPU (ultrafast) để render ${path.basename(outputPath)}`,
          LOG_LEVEL.DEBUG
        );
        command.outputOptions("-preset", "ultrafast");
      }

      command
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
  let totalVideoBackgrounds;
  try {
    // 1. Kiểm tra video overlay
    const totalOverlays = overlayFiles.length;
    if (totalOverlays === 0) {
      log(
        "❌ Không tìm thấy video overlay nào trong thư mục overlays!",
        LOG_LEVEL.ERROR
      );
      return;
    }

    // 2. Xác định nguồn video background (combined_videos hoặc backgrounds)
    const hasCombinedVideos = fs.existsSync(combinedVideosFolder);
    if (hasCombinedVideos) {
      const combinedVideosFolders = fs
        .readdirSync(combinedVideosFolder)
        .filter((folder) =>
          fs.lstatSync(path.join(combinedVideosFolder, folder)).isDirectory()
        );
      totalVideoBackgrounds = combinedVideosFolders.length;
      log(`Sử dụng video từ thư mục combined_videos`, LOG_LEVEL.INFO);
    } else {
      const backgroundFolders = fs
        .readdirSync(backgroundFolder)
        .filter((folder) =>
          fs.lstatSync(path.join(backgroundFolder, folder)).isDirectory()
        );
      totalVideoBackgrounds = backgroundFolders.length;
      log(`Sử dụng video từ thư mục backgrounds`, LOG_LEVEL.INFO);
    }

    // 3. Kiểm tra số lượng thư mục background
    if (totalVideoBackgrounds === 0) {
      log("❌ Không tìm thấy thư mục background nào!", LOG_LEVEL.ERROR);
      return;
    }

    // 4. Hiển thị thông tin tổng quan về quá trình xử lý
    log(
      `🚀 Bắt đầu xử lý với ${totalOverlays} video overlay và ${totalVideoBackgrounds} thư mục background`,
      LOG_LEVEL.INFO
    );
    log(
      `📅 Ngày hiện tại: ${currentDay}, Số video mỗi folder: ${videosPerFolder}`,
      LOG_LEVEL.INFO
    );

    // 5. Tính tổng số video sẽ xử lý
    totalVideosToProcess = totalVideoBackgrounds * videosPerFolder;
    log(`Tổng số video sẽ xử lý: ${totalVideosToProcess}`, LOG_LEVEL.INFO);
    log(
      `Xử lý tối đa ${maxConcurrentProcesses} video cùng lúc`,
      LOG_LEVEL.INFO
    );

    // 6. Xử lý từng folder background
    for (let i = 0; i < totalVideoBackgrounds; i++) {
      const folderName = `${i + 1}`;
      const groupFolder = path.join(outputFolder, folderName);

      // Tạo thư mục output nếu chưa tồn tại
      if (!fs.existsSync(groupFolder)) {
        fs.mkdirSync(groupFolder, { recursive: true });
      }

      // 7. Lấy danh sách file background
      let backgroundFiles = [];
      let totalBackgroundsForFolder = 0;

      if (hasCombinedVideos) {
        // Sử dụng video từ combined_videos
        const combinedVideosFolderPath = path.join(
          combinedVideosFolder,
          folderName
        );
        backgroundFiles = getFilesFromFolder(combinedVideosFolderPath);
        totalBackgroundsForFolder = backgroundFiles.length;
        log(
          `Sử dụng ${totalBackgroundsForFolder} video từ thư mục combined_videos/${folderName}`,
          LOG_LEVEL.INFO
        );
      } else {
        // Sử dụng video từ backgrounds
        const backgroundsFolderPath = path.join(backgroundFolder, folderName);
        backgroundFiles = getFilesFromFolder(backgroundsFolderPath);
        totalBackgroundsForFolder = backgroundFiles.length;
        log(
          `Sử dụng ${totalBackgroundsForFolder} video từ thư mục backgrounds/${folderName}`,
          LOG_LEVEL.INFO
        );
      }

      // 8. Kiểm tra số lượng file background
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
        `📁 Đang xử lý folder ${folderName} (${
          i + 1
        }/${totalVideoBackgrounds})`,
        LOG_LEVEL.INFO
      );

      // 9. Tính vị trí bắt đầu cho ngày hiện tại
      const startIndex = calculateStartIndex(i, currentDay, totalOverlays);

      // 10. Chuẩn bị danh sách công việc
      const tasks = [];

      // 11. Lấy số video từ vị trí bắt đầu
      for (let j = 0; j < videosPerFolder; j++) {
        const overlayIndex = (startIndex + j) % totalOverlays;
        const backgroundIndex = Math.floor(
          Math.random() * totalBackgroundsForFolder
        );

        const overlay = overlayFiles[overlayIndex];
        const background = backgroundFiles[backgroundIndex];

        const overlayFileName = path.basename(overlay, path.extname(overlay));
        const outputPath = path.join(groupFolder, `${overlayFileName}.mp4`);

        if (fs.existsSync(outputPath)) {
          log(
            `👉 Video đã tồn tại, bỏ qua: ${path.basename(outputPath)}`,
            LOG_LEVEL.INFO // Hoặc DEBUG nếu bạn không muốn thấy quá nhiều log
          );
          processedVideos++; // Vẫn tăng biến này để hiển thị đúng tiến độ
          updateProgress();
          continue; // Bỏ qua việc thêm task này và sang vòng lặp tiếp theo
        }

        log(
          `🎬 Chuẩn bị video ${j + 1}/${videosPerFolder}: ${path.basename(
            overlay
          )}`,
          LOG_LEVEL.DEBUG
        );

        tasks.push({
          overlay,
          background,
          outputPath,
        });
      }

      // 12. Xử lý song song với giới hạn số lượng
      const processBatch = async (batch) => {
        return Promise.all(
          batch.map((task) =>
            processVideo(task.overlay, task.background, task.outputPath).catch(
              (error) => {
                // Lỗi đã được xử lý trong hàm processVideo
                log(`Lỗi xử lý video: ${error.message}`, LOG_LEVEL.ERROR);
              }
            )
          )
        );
      };

      // 13. Chia nhỏ công việc thành các batch
      for (let k = 0; k < tasks.length; k += maxConcurrentProcesses) {
        const batch = tasks.slice(k, k + maxConcurrentProcesses);
        await processBatch(batch);
      }

      // 14. Upload lên VPS sau khi xử lý xong folder
      uploadVps(i, folderName);
    }

    // 15. Hiển thị thông tin kết thúc
    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000 / 60).toFixed(2);

    log("\n", LOG_LEVEL.INFO); // Xuống dòng sau khi hiển thị
    log(`✅ Hoàn thành! Tổng thời gian: ${totalTime} phút`, LOG_LEVEL.INFO);
  } catch (error) {
    log(`❌ Lỗi khi xử lý toàn bộ video: ${error.message}`, LOG_LEVEL.ERROR);
  }
};
// endregion

// region ========== 9. Upload VPS ==========
const uploadVps = (index, folderName) => {
  if (!useAutoUploadVps) return;
  // Đọc danh sách IP
  const vpsList = readIpList();
  const vpsName = vpsList[index];
  const currentFolderUpload = path.join(__dirname, outputFolder);
  const echoInfo = `echo Uploading ${currentFolderUpload} to VPS ${vpsName} &&`;
  console.log(`Đang upload folder ${currentFolderUpload} lên VPS ${vpsName}`);

  // Tạo lệnh rclone với dấu ngoặc kép cho các đường dẫn
  const rcloneCmd = `rclone copy "${currentFolderUpload}" "${vpsName}:/" --include "${folderName}/**" --transfers 16 --checkers 8 --progress`;
  const cmd = `${echoInfo} ${rcloneCmd} && exit`;
  // Sử dụng spawn để mở cửa sổ CMD mới và chạy lệnh
  spawn("cmd.exe", ["/c", "start", "cmd.exe", "/c", cmd], {
    detached: true,
    stdio: "ignore",
    windowsVerbatimArguments: true,
  }).unref();

  console.log(`Đã bắt đầu upload folder ${folderName} lên VPS ${vpsName}`);
};
// endregion

// region ========== 9.5 Xóa file trên VPS ==========
const deleteVpsFiles = () => {
  if (!useAutoUploadVps) return;
  const vpsList = readIpList();
  if (vpsList.length === 0) {
    log(`Không tìm thấy danh sách VPS để xóa file`, LOG_LEVEL.WARN);
    return;
  }

  // Lọc các VPS có tên khác nhau để tránh xóa trùng lặp
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
// Xóa file trên VPS trước khi bắt đầu render
deleteVpsFiles();
processAllVideos().then(() => {
  console.log("🎉 Hoàn tất xử lý tất cả video.");
});
// endregion
