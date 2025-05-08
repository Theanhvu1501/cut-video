import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";
ffmpeg.setFfmpegPath(ffmpegPath);
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
const currentDayFile = "./currentDay.txt"; // Đường dẫn file để lưu currentDay
try {
  fs.writeFileSync(currentDayFile, currentDay.toString(), {
    encoding: "utf-8",
  });
  console.log(`Đã lưu currentDay (${currentDay}) vào file: ${currentDayFile}`);
} catch (error) {
  console.error("Lỗi khi ghi currentDay vào file:", error.message);
}
// endregion

// region ========== 3. Đường dẫn & thư mục ==========
const overlayFolder = "./overlays"; // Thư mục chứa các video overlay
const backgroundFolder = "./backgrounds"; // Thư mục chứa các thư mục nền (folder_1, folder_2, ...)
const imageBackgroundFolder = "./image_backgrounds"; // Thư mục chứa các hình ảnh làm nền
const outputFolder = "./done"; // Thư mục xuất file
const avatarFolder = "./images"; // Thư mục chứa các ảnh avatar
const snowOverlay = "./snow1.mov";
const useChromaKey = true;
const color = "4887EE"; // màu chroma key useChromaKey = true
const height = 190; // chiều cao của phần video cần cắt.
const y_offset = 490; // vị trí cắt từ trên xuống dưới video gốc
const ipList = "./vps.txt";
const useAutoUploadVps = true;
const __filename = fileURLToPath(import.meta.url); // chuyển URL thành đường dẫn thực tế
const __dirname = path.dirname(__filename); // lấy thư mục chứa file

// Tạo thư mục nếu chưa tồn tại
if (!fs.existsSync(outputFolder)) {
  fs.mkdirSync(outputFolder, { recursive: true });
}
// endregion

// region ========== 4. Tiện ích đọc file ==========
const getFilesFromFolder = (folder, fileTypes = [".mp4"]) => {
  return fs
    .readdirSync(folder)
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return fileTypes.includes(ext);
    })
    .sort((a, b) => a.localeCompare(b)) // Sắp xếp theo tên file
    .map((file) => path.join(folder, file));
};

// Đọc danh sách IP từ file
const readIpList = () => {
  try {
    if (!fs.existsSync(ipList)) {
      console.warn(`⚠️ Không tìm thấy file IP: ${ipList}`);
      return [];
    }

    const content = fs.readFileSync(ipList, "utf-8");
    const ips = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    console.log(`📋 Đã đọc ${ips.length} IP từ file ${ipList}`);
    return ips;
  } catch (error) {
    console.error(`❌ Lỗi khi đọc file IP: ${error.message}`);
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

// Tạo thư mục image_backgrounds nếu chưa tồn tại
if (!fs.existsSync(imageBackgroundFolder)) {
  fs.mkdirSync(imageBackgroundFolder, { recursive: true });
  console.log(
    `Đã tạo thư mục ${imageBackgroundFolder}. Vui lòng thêm các thư mục con (1, 2, 3...) và hình ảnh background vào các thư mục này.`
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
  const tempPath = avatarPath.replace(".jpg", "_circular.png");

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

  return tempPath;
};

// endregion

// region ========== 8. Xử lý video ==========
const complexFilter = (isImage) => {
  const chromaKeyFilter = useChromaKey
    ? `[1:v]scale=1280:720,colorkey=0x${color}:0.3:0.1,format=yuva420p[overlay_video]`
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

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    ffmpeg.ffprobe(inputOverlay, (err, metadata) => {
      if (err) {
        console.error("Lỗi khi lấy metadata video overlay:", err.message);
        return reject(err);
      }

      const duration = metadata.format.duration;

      // Kiểm tra nếu background là hình ảnh
      const isImage =
        useImageBackground ||
        [".jpg", ".jpeg", ".png"].includes(
          path.extname(inputBackground).toLowerCase()
        );
      const base = isImage
        ? ffmpeg().input(inputBackground).loop(1)
        : ffmpeg(inputBackground);
      base
        .input(inputOverlay)
        .input(circularAvatarPath)
        .input(snowOverlay)
        .inputOptions("-t", duration)
        .complexFilter(complexFilter(isImage))
        .outputOptions("-preset", "ultrafast")
        .outputOptions("-t", duration)
        .audioCodec("aac")
        .map("[combined_video]")
        .map("[overlay_audio]")
        .on("end", () => {
          const endTime = Date.now();
          console.log(
            `Xử lý xong video: ${outputPath}. Thời gian: ${(
              (endTime - startTime) /
              1000
            ).toFixed(2)} giây.`
          );
          fs.unlinkSync(circularAvatarPath);
          resolve();
        })
        .on("error", (error) => {
          console.error("Lỗi khi xử lý video:", err.message);
          if (fs.existsSync(circularAvatarPath))
            fs.unlinkSync(circularAvatarPath);
          reject(error);
        })
        .save(outputPath);
    });
  });
};
// endregion

// region ========== 9. Xử lý toàn bộ video ==========
const processAllVideos = async () => {
  const totalOverlays = overlayFiles.length;
  const totalImageBackgroundFolders = imageBackgroundFolders.length;
  const totalVideoBackgrounds = backgroundFolders.length;
  const useImageBackground = totalImageBackgroundFolders > 0;

  const totalBackgrounds = useImageBackground
    ? totalImageBackgroundFolders
    : totalVideoBackgrounds;
  if (useImageBackground) {
    console.log(
      `Sử dụng hình ảnh từ ${totalImageBackgroundFolders} thư mục làm background.`
    );
  }

  // Duyệt qua từng folder nền
  for (let i = 0; i < totalBackgrounds; i++) {
    const folderName = `${i + 1}`;
    const groupFolder = path.join(outputFolder, folderName);
    const avatarPath = path.join(avatarFolder, `${folderName}.jpg`);

    if (!fs.existsSync(avatarPath)) {
      console.error(`Không tìm thấy avatar: ${avatarPath}`);
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
      console.error(`Không có file background nào cho folder ${folderName}`);
      continue;
    }

    // Tính vị trí bắt đầu cho ngày hiện tại
    const startIndex = calculateStartIndex(i, currentDay, totalOverlays);

    // Lấy số video từ vị trí bắt đầu
    for (let j = 0; j < videosPerFolder; j++) {
      const overlayIndex = (startIndex + j) % totalOverlays; // Đảm bảo không vượt quá số video overlay

      // Chọn ngẫu nhiên một background nếu sử dụng hình ảnh
      const backgroundIndex = useImageBackground
        ? Math.floor(Math.random() * totalBackgroundsForFolder)
        : (startIndex + j) % totalBackgroundsForFolder;

      const overlay = overlayFiles[overlayIndex];
      const background = backgroundFiles[backgroundIndex];

      const overlayFileName = path.basename(overlay, path.extname(overlay));
      const outputPath = path.join(groupFolder, `${overlayFileName}.mp4`);

      console.log(`Đang xử lý overlay: ${overlay} với nền: ${background}`);
      try {
        await processVideo(
          overlay,
          background,
          outputPath,
          avatarPath,
          useImageBackground
        );
      } catch (error) {
        console.error("Lỗi khi xử lý:", error.message);
      }
    }

    uploadVps(i, folderName);
  }

  console.log("Đã xử lý xong toàn bộ video.");
};
// endregion

// region ========== 11. Upload VPS ==========
const uploadVps = (index, folderName) => {
  if (!useAutoUploadVps) return;
  // Đọc danh sách IP
  const vpsList = readIpList();
  const vpsName = vpsList[index];
  const currentFolderUpload = path.join(__dirname, outputFolder, folderName);
  const echoInfo = `echo Uploading ${currentFolderUpload} to VPS ${vpsName} &&`;
  console.log(`Đang upload folder ${currentFolderUpload} lên VPS ${vpsName}`);
  const cmd = `${echoInfo} rclone copy ${currentFolderUpload} ${vpsName}:/  --transfers 16 --checkers 8 --progress`;
  spawn("cmd.exe", ["/c", "start", "cmd.exe", "/k", cmd], {
    detached: true,
    stdio: "ignore",
  }).unref();
};
// endregion

// region ========== 10. Khởi chạy ==========
processAllVideos().then(() => {
  console.log("🎉 Hoàn tất xử lý tất cả video.");
});
// endregion
