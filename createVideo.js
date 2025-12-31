import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import pLimit from "p-limit";
import path from "path";

// Cấu hình FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// --- CẤU HÌNH ---
const CONFIG = {
  processing: {
    maxConcurrent: 3, // Số luồng chạy song song
  },
  video: {
    segmentMin: 30,
    segmentMax: 40,
    fps: 30, // Cố định FPS để tính toán chuyển động cho mượt
  },
  ffmpeg: {
    preset: "veryfast",
    crf: 23,
    timeout: 10 * 60 * 1000,
  },
};

// Đường dẫn
const imageBackgroundFolder = "./image_backgrounds";
const outputRootFolder = "./output_segments";
const snowOverlay = "./snow1.mp4";

// Tạo thư mục gốc output
if (!fs.existsSync(outputRootFolder)) {
  fs.mkdirSync(outputRootFolder, { recursive: true });
}

const getRandomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// --- HÀM TẠO FILTER CHUYỂN ĐỘNG (ZOOM/PAN) ---
const getDynamicFilter = (durationInSeconds) => {
  // Tính tổng số frame dựa trên thời lượng và FPS
  // + 50 frame dư để tránh bị đen hình ở giây cuối cùng
  const totalFrames = durationInSeconds * CONFIG.video.fps + 50;

  // Các hiệu ứng zoompan
  // d: thời lượng (frames), s: kích thước output, fps: tốc độ khung hình
  const commonParams = `:d=${totalFrames}:s=1280x720:fps=${CONFIG.video.fps}`;

  const effects = [
    // 1. ZOOM IN (Từ từ phóng to vào giữa)
    // z: zoom tăng dần mỗi frame thêm 0.0015
    {
      name: "Zoom In Center",
      filter: `zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${commonParams}`,
    },

    // 2. ZOOM OUT (Từ từ thu nhỏ lại)
    // z: Nếu frame đầu tiên (on=1) thì set zoom 1.5, sau đó giảm dần
    {
      name: "Zoom Out Center",
      filter: `zoompan=z='if(eq(on,1),1.5,max(1.001,zoom-0.0015))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'${commonParams}`,
    },

    // 3. PAN RIGHT (Lia sang phải)
    // z: Giữ zoom cố định 1.2. x: tăng dần tọa độ x
    {
      name: "Pan Right",
      filter: `zoompan=z='1.2':x='(iw-iw/zoom)*(on/${totalFrames})':y='(ih-ih/zoom)/2'${commonParams}`,
    },

    // 4. PAN LEFT (Lia sang trái)
    // z: Giữ zoom cố định 1.2. x: giảm dần tọa độ x (ngược lại của Right)
    {
      name: "Pan Left",
      filter: `zoompan=z='1.2':x='(iw-iw/zoom)*(1-on/${totalFrames})':y='(ih-ih/zoom)/2'${commonParams}`,
    },
  ];

  // Random chọn 1 hiệu ứng
  const selectedEffect = effects[getRandomInt(0, effects.length - 1)];
  return selectedEffect;
};

// --- HÀM TẠO 1 SEGMENT ---
const createSegment = async (imagePath, outputPath, duration) => {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(outputPath)) {
      return resolve("Skipped");
    }

    // Lấy hiệu ứng ngẫu nhiên
    const effect = getDynamicFilter(duration);

    const timer = setTimeout(() => {
      reject(new Error("Timeout quá thời gian cho phép"));
    }, CONFIG.ffmpeg.timeout);

    ffmpeg()
      .input(imagePath)
      // Không cần loop(1) ở đây vì zoompan sẽ tự tạo frame từ 1 ảnh
      .input(snowOverlay)
      .inputOptions(["-stream_loop", "-1"])
      .complexFilter([
        // [0:v] input ảnh -> scale lên 1920 (để zoom cho nét) -> Áp dụng hiệu ứng -> đặt tên là [bg]
        `[0:v]scale=1920:-2,${effect.filter}[bg]`,

        // [1:v] input tuyết -> scale 1280x720 -> lọc màu đen -> đặt tên là [snow]
        `[1:v]scale=1280:720,setsar=1,colorkey=0x000000:0.1:0.3[snow]`,

        // Gộp [bg] và [snow]
        `[bg][snow]overlay=0:0[out]`,
      ])
      .outputOptions([
        "-map",
        "[out]",
        "-t",
        duration,
        `-r ${CONFIG.video.fps}`, // Bắt buộc set FPS output trùng với zoompan
        `-preset ${CONFIG.ffmpeg.preset}`,
        `-crf ${CONFIG.ffmpeg.crf}`,
        "-movflags +faststart",
        "-pix_fmt yuv420p",
        "-y",
      ])
      .on("end", () => {
        clearTimeout(timer);
        resolve({ outputPath, effectName: effect.name });
      })
      .on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      })
      .save(outputPath);
  });
};

// --- MAIN ---
const main = async () => {
  try {
    console.log(`🚀 BẮT ĐẦU: HIỆU ỨNG ZOOM/PAN NGẪU NHIÊN`);
    console.log(`⚡ Max Threads: ${CONFIG.processing.maxConcurrent}`);
    console.log(`🎬 FPS: ${CONFIG.video.fps}\n`);

    const limit = pLimit(CONFIG.processing.maxConcurrent);
    const tasks = [];
    let totalImages = 0;

    const folders = fs
      .readdirSync(imageBackgroundFolder)
      .filter((folder) =>
        fs.lstatSync(path.join(imageBackgroundFolder, folder)).isDirectory()
      );

    for (const folderName of folders) {
      const inputFolderPath = path.join(imageBackgroundFolder, folderName);
      const outputFolderPath = path.join(outputRootFolder, folderName);

      if (!fs.existsSync(outputFolderPath)) {
        fs.mkdirSync(outputFolderPath, { recursive: true });
      }

      const images = fs
        .readdirSync(inputFolderPath)
        .filter((file) =>
          [".jpg", ".jpeg", ".png"].includes(path.extname(file).toLowerCase())
        );

      if (images.length === 0) continue;

      console.log(`📂 Folder "${folderName}": ${images.length} ảnh.`);
      totalImages += images.length;

      for (const imageFile of images) {
        const imagePath = path.join(inputFolderPath, imageFile);
        const duration = getRandomInt(
          CONFIG.video.segmentMin,
          CONFIG.video.segmentMax
        );
        const imageNameWithoutExt = path.parse(imageFile).name;
        const outputFileName = `${imageNameWithoutExt}.mp4`;
        const outputPath = path.join(outputFolderPath, outputFileName);

        tasks.push(
          limit(() =>
            createSegment(imagePath, outputPath, duration)
              .then((res) => {
                if (res === "Skipped") {
                  process.stdout.write("S");
                } else {
                  // In ra hiệu ứng đã dùng (viết tắt chữ đầu cho gọn log)
                  // Z=Zoom, P=Pan
                  const shortName = res.effectName.charAt(0);
                  process.stdout.write(shortName);
                }
              })
              .catch((err) => {
                console.error(`\n❌ Lỗi [${imageFile}]: ${err.message}`);
              })
          )
        );
      }
    }

    console.log(`\n\n⏳ Đang render... (Ký hiệu: Z=Zoom, P=Pan, S=Skip)`);

    await Promise.all(tasks);

    console.log(`\n\n✅ ĐÃ HOÀN THÀNH TOÀN BỘ!`);
    console.log(`👉 File output nằm tại: ${outputRootFolder}`);
  } catch (error) {
    console.error(`Fatal Error: ${error.message}`);
  }
};

main();
