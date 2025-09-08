import ffmpeg from "fluent-ffmpeg";
import { promises as fs } from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const THUMBS_DIR = path.join(__dirname, "thumbs");
const DONE_DIR = path.join(__dirname, "done");
const OUTPUT_DIR = path.join(__dirname, "output");
const TEMP_DIR = path.join(__dirname, "temp");

const THUMB_DURATION = 3;
const THUMB_EXTENSION = ".jpg";
const DEFAULT_CHUNK_SIZE = 2;
const SILENT_AUDIO_PATH = path.join(__dirname, "silence.mp3");

// Biến toàn cục để lưu trữ thông số của video gốc
let sourceVideoMetadata = null;

/**
 * "Đo" thông số của một video mẫu để làm chuẩn
 */
function probeVideo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        return reject(
          new Error(`Không thể đọc metadata của video: ${err.message}`)
        );
      }
      const videoStream = metadata.streams.find(
        (s) => s.codec_type === "video"
      );
      const audioStream = metadata.streams.find(
        (s) => s.codec_type === "audio"
      );

      if (!videoStream) {
        return reject(new Error("Không tìm thấy luồng video trong file mẫu."));
      }

      resolve({
        width: videoStream.width,
        height: videoStream.height,
        frame_rate: videoStream.r_frame_rate, // Lấy frame rate chính xác
        pix_fmt: videoStream.pix_fmt,
        audio_codec: audioStream ? audioStream.codec_name : "aac",
        sample_rate: audioStream ? audioStream.sample_rate : "44100",
      });
    });
  });
}

/**
 * Tạo video thumbnail dựa trên thông số đã "đo" được
 */
function createVideoFromThumb(thumbPath, metadata) {
  return new Promise((resolve, reject) => {
    const tempVideoPath = path.resolve(TEMP_DIR, `temp_${Date.now()}.mp4`);
    const videoFilter = `scale=${metadata.width}:${metadata.height}:force_original_aspect_ratio=decrease,pad=${metadata.width}:${metadata.height}:-1:-1:color=black`;

    ffmpeg()
      .input(thumbPath)
      .loop(THUMB_DURATION)
      .input(SILENT_AUDIO_PATH)
      .inputOptions([`-t ${THUMB_DURATION}`])
      .videoCodec("libx264")
      .videoFilters(videoFilter)
      .audioCodec(metadata.audio_codec) // Dùng đúng codec audio
      .audioFrequency(metadata.sample_rate) // Dùng đúng tần số âm thanh
      .outputOptions([
        `-pix_fmt ${metadata.pix_fmt}`, // Dùng đúng định dạng pixel
        `-r ${metadata.frame_rate}`, // Dùng đúng frame rate
      ])
      .on("end", () => resolve(tempVideoPath))
      .on("error", (err) => reject(new Error(`[Lỗi FFmpeg] ${err.message}`)))
      .save(tempVideoPath);
  });
}

async function processFolder(folderName, chunkSize) {
  console.log(`\n======================================================`);
  console.log(
    `🚀 Bắt đầu xử lý thư mục: "${folderName}"... (Chế độ ghép nối nhanh)`
  );

  const videoFolderPath = path.join(DONE_DIR, folderName);
  const thumbFolderPath = path.join(THUMBS_DIR, folderName);
  const outputFolderPath = path.join(OUTPUT_DIR, folderName);

  try {
    await fs.mkdir(outputFolderPath, { recursive: true });
    const videoFiles = (await fs.readdir(videoFolderPath))
      .map((f) => f.trim())
      .filter(
        (file) =>
          !file.startsWith(".") &&
          (file.endsWith(".mp4") || file.endsWith(".mov"))
      )
      .sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      );

    if (videoFiles.length === 0) {
      console.log(`🟡 Không tìm thấy video nào.`);
      return;
    }
    console.log(`🔍 Tìm thấy ${videoFiles.length} video.`);

    // "Đo" thông số của video đầu tiên để làm chuẩn cho cả thư mục
    try {
      console.log(`    🔬 Đang đo thông số của video mẫu: ${videoFiles[0]}`);
      sourceVideoMetadata = await probeVideo(
        path.join(videoFolderPath, videoFiles[0])
      );
      console.log(
        `    ✅ Thông số chuẩn: ${sourceVideoMetadata.width}x${sourceVideoMetadata.height}, ${sourceVideoMetadata.frame_rate} fps`
      );
    } catch (error) {
      console.error(`\n    ❌ KHÔNG THỂ ĐO VIDEO MẪU. Dừng xử lý thư mục này.`);
      console.error(`    Chi tiết: ${error.message}`);
      return;
    }

    for (let i = 0; i < videoFiles.length; i += chunkSize) {
      const chunk = videoFiles.slice(i, i + chunkSize);
      if (chunk.length < 2) {
        console.log(`🟡 Bỏ qua nhóm cuối cùng.`);
        continue;
      }

      const outputFileName = chunk[0];
      const outputFilePath = path.join(outputFolderPath, outputFileName);
      console.log(
        `\n🎬 Đang xử lý nhóm bắt đầu bằng "${chunk[0]}" -> ${outputFileName}`
      );

      const concatListPath = path.join(TEMP_DIR, `list_${folderName}_${i}.txt`);
      let concatFileContent = "";
      const tempVideoFiles = [];

      for (let j = 0; j < chunk.length; j++) {
        concatFileContent += `file '${path.resolve(
          videoFolderPath,
          chunk[j]
        )}'\n`;

        if (j < chunk.length - 1) {
          const nextVideoName = chunk[j + 1];
          const thumbName =
            nextVideoName.replace(path.extname(nextVideoName), "") +
            THUMB_EXTENSION;
          const thumbPath = path.resolve(thumbFolderPath, thumbName);

          try {
            await fs.access(thumbPath);
            console.log(`    🖼️  Chuẩn bị thumb: ${thumbName}`);
            // Truyền thông số đã đo được vào hàm tạo video
            const tempVideoPath = await createVideoFromThumb(
              thumbPath,
              sourceVideoMetadata
            );
            concatFileContent += `file '${tempVideoPath}'\n`;
            tempVideoFiles.push(tempVideoPath);
          } catch (error) {
            console.error(`\n    ❌ GẶP LỖI KHI XỬ LÝ THUMB: "${thumbName}"`);
            console.error(`    Chi tiết: ${error.message}\n`);
          }
        }
      }

      if (tempVideoFiles.length > 0) {
        await fs.writeFile(concatListPath, concatFileContent);
        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(concatListPath)
            .inputOptions(["-f concat", "-safe 0"])
            .outputOptions("-c copy")
            .on("end", () => {
              console.log(`✅ Hoàn thành ghép video: ${outputFilePath}`);
              resolve();
            })
            .on("error", (err) =>
              reject(new Error(`Lỗi khi ghép video: ${err.message}`))
            )
            .save(outputFilePath);
        });
        console.log("    🗑️  Dọn dẹp file tạm...");
        for (const file of tempVideoFiles) {
          try {
            await fs.unlink(file);
          } catch (e) {}
        }
        try {
          await fs.unlink(concatListPath);
        } catch (e) {}
      } else {
        console.log(
          `🟡 Không có thumb nào được xử lý cho nhóm này, bỏ qua việc ghép.`
        );
      }
    }
  } catch (error) {
    console.error(`\n❌ Đã xảy ra lỗi nghiêm trọng:`, error.message);
  }
}

// --- Logic chính ---
// Nếu bạn muốn xử lý chỉ thư mục 3 và ghép 4 video một lần, lệnh sẽ là: node concat-video.js 4 3
(async () => {
  try {
    await fs.access(SILENT_AUDIO_PATH);
  } catch {
    console.error(`\n❌ LỖI: Không tìm thấy file 'silence.mp3'.`);
    process.exit(1);
  }

  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const args = process.argv.slice(2);
    if (args[0] && args[1]) {
      await processFolder(args[1], parseInt(args[0], 10));
    } else {
      console.log(`Chế độ tự động...`);
      const allFolders = await fs.readdir(DONE_DIR, { withFileTypes: true });
      const subDirectories = allFolders
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
        );
      for (const f of subDirectories)
        await processFolder(f, DEFAULT_CHUNK_SIZE);
    }
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    console.log("\n✅ Dọn dẹp thành công.");
    console.log("\n🎉 Hoàn tất!");
  } catch (err) {
    console.error("Lỗi không mong muốn:", err.message);
  }
})();
