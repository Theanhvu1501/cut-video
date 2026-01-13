import ffmpeg from "fluent-ffmpeg";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Thiết lập đường dẫn đến ffmpeg thực thi - sử dụng từ thư mục bin
const FFMPEG_PATH = path.join(__dirname, "bin", "ffmpeg.exe");
const FFPROBE_PATH = path.join(__dirname, "bin", "ffprobe.exe");
ffmpeg.setFfmpegPath(FFMPEG_PATH);
ffmpeg.setFfprobePath(FFPROBE_PATH);

// --- CẤU HÌNH ---
const BASE_DIR = "./backgrounds";
const VIDEOS_DIR = path.join(BASE_DIR, "videos");
const IMAGES_DIR = path.join(BASE_DIR, "images");
const SNOW_VIDEO_PATH = "./snow.mov";

const SNOW_DURATION = 16;
const INTRO_DURATION = 8;
const TOTAL_DURATION = 3600;
const BACKGROUND_DURATION = TOTAL_DURATION - INTRO_DURATION;

const OUTPUT_RESOLUTION = "1280x720";
const PIXEL_FORMAT = "yuv420p";
const TRANSITION_DURATION = 1;

// --- CẤU HÌNH FADE CHO CHUNK ---
const FADE_DURATION = 1; // Thời gian mờ dần là 1 giây
const FADEOUT_START_TIME = SNOW_DURATION - FADE_DURATION; // Bắt đầu fade out tại giây thứ 15

/**
 * Tìm file ảnh tương ứng.
 */
async function findImageFile(baseName) {
  const extensions = [".jpg", ".jpeg", ".png"];
  for (const ext of extensions) {
    const imagePath = path.join(IMAGES_DIR, `${baseName}${ext}`);
    try {
      await fs.access(imagePath);
      return imagePath;
    } catch (error) {}
  }
  return null;
}

/**
 * BƯỚC 1: Tạo chunk nền 16s (Re-encode).
 */
function createBaseChunk(backgroundImagePath, snowVideoPath, chunkOutputPath) {
  return new Promise((resolve, reject) => {
    console.log(`   [Bước 1/3] ⏳ Đang tạo chunk nền 16 giây...`);
    ffmpeg()
      .input(backgroundImagePath)
      .inputOptions("-loop 1")
      .input(snowVideoPath)
      .complexFilter([
        // Chuẩn bị ảnh nền
        `[0:v]scale=${OUTPUT_RESOLUTION},format=${PIXEL_FORMAT}[base]`,
        // Chuẩn bị video tuyết
        `[1:v]scale=${OUTPUT_RESOLUTION},format=${PIXEL_FORMAT}[snow_scaled]`,
        // **LÀM TRONG SUỐT MÀU ĐEN CỦA VIDEO TUYẾT**
        // colorkey=black:0.1:0.1 -> color:similarity:blend
        // similarity: Mức độ tương đồng màu. 0.1 là một giá trị tốt để bắt đầu.
        // blend: Độ mềm của viền. 0.1 giúp hiệu ứng mượt hơn.
        `[snow_scaled]colorkey=black:0.1:0.1[snow_transparent]`,
        // Giờ mới phủ lớp tuyết đã trong suốt lên ảnh nền
        `[base][snow_transparent]overlay=shortest=1`,
      ])
      .outputOptions([
        "-an",
        "-c:v libx264",
        `-pix_fmt ${PIXEL_FORMAT}`,
        `-t ${SNOW_DURATION}`,
      ])
      .on("end", () => {
        console.log(`   [Bước 1/3] ✅ Chunk nền đã được tạo.`);
        resolve(chunkOutputPath);
      })
      .on("error", (err) =>
        reject(new Error(`Lỗi khi tạo chunk nền: ${err.message}`))
      )
      .save(chunkOutputPath);
  });
}

/**
 * BƯỚC 2: Lặp chunk thành nền dài (Copy - Nhanh).
 */
function createLoopedBackground(chunkPath, loopedOutputPath) {
  return new Promise((resolve, reject) => {
    console.log(`   [Bước 2/3] ⏳ Đang lặp chunk để tạo nền dài (nhanh)...`);
    ffmpeg()
      .input(chunkPath)
      .inputOptions("-stream_loop -1")
      .outputOptions(["-an", "-c copy", `-t ${BACKGROUND_DURATION}`])
      .on("end", () => {
        console.log(`   [Bước 2/3] ✅ Video nền dài đã được tạo.`);
        resolve(loopedOutputPath);
      })
      .on("error", (err) =>
        reject(new Error(`Lỗi khi lặp video nền: ${err.message}`))
      )
      .save(loopedOutputPath);
  });
}

/**
 * BƯỚC 3 (ĐÃ SỬA): Ghép video bằng Concat Demuxer (Copy - Siêu Nhanh, Kém Ổn Định).
 */
async function combineFinalVideos_CopyWithDemuxer(
  introVideoPath,
  loopedBackgroundPath,
  finalOutputPath,
  listFilePath
) {
  // Tạo file text chứa danh sách các video cần nối
  // Sử dụng path.resolve để có đường dẫn tuyệt đối, an toàn hơn cho ffmpeg
  const fileContent = `file '${path.resolve(
    introVideoPath
  )}'\nfile '${path.resolve(loopedBackgroundPath)}'`;
  await fs.writeFile(listFilePath, fileContent);

  return new Promise((resolve, reject) => {
    console.log(`   [Bước 3/3] 🚀 Đang ghép video cuối cùng (chế độ copy)...`);
    console.log(
      `      ⚠️ CẢNH BÁO: Chế độ này yêu cầu video intro phải có sẵn độ phân giải ${OUTPUT_RESOLUTION}.`
    );
    ffmpeg()
      .input(listFilePath)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c copy"]) // <-- SỬ DỤNG COPY, KHÔNG RE-ENCODE
      .on("end", () => {
        console.log(`   [Bước 3/3] ✅ Ghép video thành công!`);
        resolve();
      })
      .on("error", (err) => {
        reject(
          new Error(
            `Lỗi khi ghép video (chế độ copy). Nguyên nhân có thể do video intro không tương thích (khác độ phân giải, codec...). Lỗi gốc: ${err.message}`
          )
        );
      })
      .save(finalOutputPath);
  });
}

/**
 * Hàm chính để chạy toàn bộ quá trình
 */
async function processAllVideos() {
  console.log("--- Bắt đầu quá trình tạo video ---");
  try {
    const videoFiles = await fs.readdir(VIDEOS_DIR);

    for (const videoFile of videoFiles) {
      const baseName = path.parse(videoFile).name;
      const introVideoPath = path.join(VIDEOS_DIR, videoFile);
      const imagePath = await findImageFile(baseName);

      if (!imagePath) {
        console.warn(
          `\n⚠️ Bỏ qua '${videoFile}': Không tìm thấy ảnh tương ứng.`
        );
        continue;
      }

      const finalOutputPath = path.join(
        BASE_DIR,
        `${baseName}_1_hour_silent_720p.mp4`
      );
      const tempChunkPath = path.join(BASE_DIR, `temp_chunk_${baseName}.mp4`);
      const tempLoopedBgPath = path.join(
        BASE_DIR,
        `temp_looped_bg_${baseName}.mp4`
      );
      const tempListPath = path.join(BASE_DIR, `temp_list_${baseName}.txt`); // File text tạm

      console.log(`\n🚀 Bắt đầu xử lý file: ${videoFile}`);

      try {
        await createBaseChunk(imagePath, SNOW_VIDEO_PATH, tempChunkPath);
        await createLoopedBackground(tempChunkPath, tempLoopedBgPath);

        // Gọi hàm ghép video mới
        await combineFinalVideos_CopyWithDemuxer(
          introVideoPath,
          tempLoopedBgPath,
          finalOutputPath,
          tempListPath
        );

        console.log(`🎉 HOÀN THÀNH: ${path.basename(finalOutputPath)}`);
      } catch (error) {
        console.error(`❌ Đã xảy ra lỗi với '${videoFile}':`, error.message);
      } finally {
        console.log(`   🗑️  Đang dọn dẹp các file tạm...`);
        try {
          await fs.unlink(tempChunkPath);
        } catch (e) {}
        try {
          await fs.unlink(tempLoopedBgPath);
        } catch (e) {}
        try {
          await fs.unlink(tempListPath);
        } catch (e) {} // Dọn dẹp cả file text
      }
    }
  } catch (error) {
    console.error("❌ Đã xảy ra lỗi nghiêm trọng:", error);
  } finally {
    console.log("\n--- Quá trình hoàn tất ---");
  }
}

// Chạy hàm chính
processAllVideos();
