import ffmpeg from "fluent-ffmpeg";
import fsSync, { promises as fs } from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cấu hình FFmpeg - sử dụng từ thư mục bin
const FFMPEG_PATH = path.join(__dirname, "bin", "ffmpeg.exe");
const FFPROBE_PATH = path.join(__dirname, "bin", "ffprobe.exe");
ffmpeg.setFfmpegPath(FFMPEG_PATH);
ffmpeg.setFfprobePath(FFPROBE_PATH);

let THUMBS_DIR = path.join(__dirname, "thumbs");
let DONE_DIR = path.join(__dirname, "done");
let OUTPUT_DIR = path.join(__dirname, "output");
const TEMP_DIR = path.join(__dirname, "temp");

let THUMB_DURATION = 3;
const THUMB_EXTENSION = ".jpg";
const DEFAULT_CHUNK_SIZE = 2;

// Tìm file silence.mp3: ưu tiên trong bin/, sau đó là __dirname
const BIN_SILENCE_PATH = path.join(__dirname, "bin", "silence.mp3");
const ROOT_SILENCE_PATH = path.join(__dirname, "silence.mp3");
const SILENT_AUDIO_PATH = fsSync.existsSync(BIN_SILENCE_PATH)
  ? BIN_SILENCE_PATH
  : ROOT_SILENCE_PATH;
let USE_THUMBS = true; // Mặc định là true để giữ tương thích với code cũ

// Các biến để lưu đường dẫn trực tiếp từ config (nếu có)
let INPUT_FOLDER = null; // Folder input trực tiếp chứa video
let OUTPUT_FOLDER = null; // Folder output trực tiếp
let THUMBS_FOLDER = null; // Folder thumbs trực tiếp (nếu useThumbs)

// Đọc config từ project JSON (mặc định là "default")
const projectName = process.env.PROJECT_NAME || "default";
const projectsDir = process.env.PROJECTS_DIR || path.join(__dirname, "projects");
const projectConfigPath = path.join(projectsDir, `${projectName}.json`);

if (fsSync.existsSync(projectConfigPath)) {
  try {
    const projectContent = fsSync.readFileSync(projectConfigPath, "utf-8");
    const projectData = JSON.parse(projectContent);
    const config = projectData.settings?.concat;

    if (config) {
      // Ưu tiên sử dụng inputFolder/outputFolder trực tiếp (mode mới)
      if (config.inputFolder) {
        INPUT_FOLDER = config.inputFolder;
      }

      if (config.outputFolder) {
        OUTPUT_FOLDER = config.outputFolder;
      }

      if (config.thumbsFolder) {
        THUMBS_FOLDER = config.thumbsFolder;
      }

      if (config.useThumbs !== undefined) USE_THUMBS = config.useThumbs;
      if (config.thumbDuration)
        THUMB_DURATION = parseFloat(config.thumbDuration) || 3;
      if (config.chunkSize)
        DEFAULT_CHUNK_SIZE = parseInt(config.chunkSize) || 2;

      console.log(`Đã đọc config từ project: ${projectName}`);
    }
  } catch (error) {
    console.error(`Lỗi khi đọc project config: ${error.message}`);
  }
}

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

      // Đảm bảo lấy đủ thông tin audio để tạo video đồng nhất
      resolve({
        width: videoStream.width,
        height: videoStream.height,
        frame_rate: videoStream.r_frame_rate,
        pix_fmt: videoStream.pix_fmt,
        audio_codec: audioStream ? audioStream.codec_name : "aac", // Mặc định aac
        sample_rate: audioStream ? audioStream.sample_rate : "44100", // Mặc định 44100
        audio_channels: audioStream ? audioStream.channels : 2, // Mặc định 2 kênh
        audio_bitrate: audioStream ? audioStream.bit_rate : "128k", // Mặc định 128k nếu không tìm thấy
      });
    });
  });
}

/**
 * Tạo video thumbnail dựa trên thông số đã "đo" được
 * Đảm bảo video tạo ra có cấu hình âm thanh giống hệt video gốc để dùng -c copy
 */
function createVideoFromThumb(thumbPath, metadata) {
  return new Promise((resolve, reject) => {
    const tempVideoPath = path.resolve(TEMP_DIR, `temp_${Date.now()}.mp4`);
    const videoFilter = `scale=${metadata.width}:${metadata.height}:force_original_aspect_ratio=decrease,pad=${metadata.width}:${metadata.height}:-1:-1:color=black`;

    // Định dạng bitrate âm thanh cho FFmpeg. metadata.audio_bitrate có thể là số, cần chuyển thành string.
    const audioBitrate =
      typeof metadata.audio_bitrate === "number"
        ? `${Math.round(metadata.audio_bitrate / 1000)}k` // Chuyển từ bps sang kbps
        : metadata.audio_bitrate || "128k"; // Mặc định

    console.log(
      `    ℹ️  Tạo video tạm từ thumb với: codec=${metadata.audio_codec}, sr=${metadata.sample_rate}, ch=${metadata.audio_channels}, br=${audioBitrate}`
    );

    ffmpeg()
      .input(thumbPath)
      .loop(THUMB_DURATION)
      .input(SILENT_AUDIO_PATH) // Sử dụng file silence.mp3 đã chuẩn bị
      .inputOptions([`-t ${THUMB_DURATION}`])
      .videoCodec("libx264")
      .videoFilters(videoFilter)
      // Đảm bảo các thông số audio khớp với metadata của video gốc
      .audioCodec(metadata.audio_codec)
      .audioFrequency(metadata.sample_rate)
      .audioChannels(metadata.audio_channels)
      .audioBitrate(audioBitrate) // Đặt bitrate
      .outputOptions([
        `-pix_fmt ${metadata.pix_fmt}`, // Định dạng pixel
        `-r ${metadata.frame_rate}`, // Frame rate
        `-map 0:v:0`, // Chọn luồng video từ input 0 (thumb)
        `-map 1:a:0`, // Chọn luồng audio từ input 1 (silent_audio)
      ])
      .on("end", () => {
        console.log(
          `    ✅ Tạo video tạm thành công: ${path.basename(tempVideoPath)}`
        );
        resolve(tempVideoPath);
      })
      .on("error", (err) => {
        console.error(`\n    ❌ LỖI TẠO VIDEO TẠM TỪ THUMB: ${err.message}`);
        reject(new Error(`[Lỗi FFmpeg] ${err.message}`));
      })
      .save(tempVideoPath);
  });
}

async function processFolder(folderName, chunkSize) {
  console.log(`\n======================================================`);
  const modeText = USE_THUMBS
    ? "ghép nối với thumbnail"
    : "ghép nối trực tiếp (không thumbnail)";

  // Xác định đường dẫn: nếu có INPUT_FOLDER thì dùng trực tiếp, không cần folderName
  let videoFolderPath;
  let thumbFolderPath;
  let outputFolderPath;

  if (INPUT_FOLDER) {
    // Mode mới: sử dụng folder input trực tiếp
    videoFolderPath = INPUT_FOLDER;
    outputFolderPath = OUTPUT_FOLDER || path.join(INPUT_FOLDER, "output");
    if (USE_THUMBS && THUMBS_FOLDER) {
      thumbFolderPath = THUMBS_FOLDER;
    } else if (USE_THUMBS) {
      // Fallback: tìm thumbs folder cùng tên với input folder
      const inputFolderName = path.basename(INPUT_FOLDER);
      thumbFolderPath = path.join(THUMBS_DIR, inputFolderName);
    }
    console.log(
      `🚀 Bắt đầu xử lý folder: "${INPUT_FOLDER}"... (Chế độ ${modeText} - c copy)`
    );
  } else {
    // Mode cũ: sử dụng DONE_DIR + folderName
    videoFolderPath = path.join(DONE_DIR, folderName);
    thumbFolderPath = path.join(THUMBS_DIR, folderName);
    outputFolderPath = OUTPUT_FOLDER || path.join(OUTPUT_DIR, folderName);
    console.log(
      `🚀 Bắt đầu xử lý thư mục: "${folderName}"... (Chế độ ${modeText} - c copy)`
    );
  }

  try {
    await fs.mkdir(outputFolderPath, { recursive: true });
    await fs.mkdir(TEMP_DIR, { recursive: true }); // Đảm bảo TEMP_DIR tồn tại

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
      console.log(`🟡 Không tìm thấy video nào trong thư mục "${folderName}".`);
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
        `    ✅ Thông số chuẩn: ${sourceVideoMetadata.width}x${sourceVideoMetadata.height}, ` +
          `${sourceVideoMetadata.frame_rate} fps, Audio: ${sourceVideoMetadata.audio_codec} ` +
          `@ ${sourceVideoMetadata.sample_rate} Hz, ${sourceVideoMetadata.audio_channels} kênh`
      );
    } catch (error) {
      console.error(`\n    ❌ KHÔNG THỂ ĐO VIDEO MẪU. Dừng xử lý thư mục này.`);
      console.error(`    Chi tiết: ${error.message}`);
      return;
    }

    // Chỉ kiểm tra và tạo file silence.mp3 nếu cần chèn thumbnail
    if (USE_THUMBS) {
      try {
        await fs.access(SILENT_AUDIO_PATH);
        console.log("    ☑️  Đã tìm thấy silence.mp3.");
        // Bạn có thể thêm bước kiểm tra metadata của silence.mp3 ở đây để đảm bảo nó khớp
      } catch {
        console.warn(
          `\n    ⚠️  KHÔNG TÌM THẤY file 'silence.mp3' hoặc không thể truy cập.`
        );
        console.warn(
          `    Sẽ cố gắng tạo một file tạm với thông số chuẩn từ video gốc.`
        );
        // Tạo một file silence tạm thời nếu silence.mp3 không tồn tại
        await new Promise((resolve, reject) => {
          const tempSilentPath = SILENT_AUDIO_PATH; // Sử dụng đường dẫn silence.mp3 luôn
          const audioBitrate =
            typeof sourceVideoMetadata.audio_bitrate === "number"
              ? `${Math.round(sourceVideoMetadata.audio_bitrate / 1000)}k`
              : sourceVideoMetadata.audio_bitrate || "128k";

          ffmpeg()
            .addInput(
              `anullsrc=r=${sourceVideoMetadata.sample_rate}:cl=${
                sourceVideoMetadata.audio_channels === 1 ? "mono" : "stereo"
              }`
            )
            .inputOptions(["-f lavfi"])
            .duration(10) // Tạo 10 giây silence
            .audioCodec(sourceVideoMetadata.audio_codec)
            .audioBitrate(audioBitrate)
            .on("end", () => {
              console.log(`    ✅ Đã tạo file 'silence.mp3' tạm thời.`);
              resolve();
            })
            .on("error", (err) => {
              console.error(
                `    ❌ LỖI TẠO silence.mp3 tạm thời: ${err.message}`
              );
              reject(
                new Error(`Không thể tạo file silence.mp3: ${err.message}`)
              );
            })
            .save(tempSilentPath);
        });
      }
    }

    for (let i = 0; i < videoFiles.length; i += chunkSize) {
      const chunk = videoFiles.slice(i, i + chunkSize);
      if (chunk.length < 2) {
        console.log(
          `🟡 Bỏ qua nhóm cuối cùng vì chỉ có ${chunk.length} video.`
        );
        continue;
      }

      const outputFileName = chunk[0]; // Đặt tên file đầu ra theo tên video đầu tiên trong nhóm
      const outputFilePath = path.join(outputFolderPath, outputFileName);
      console.log(
        `\n🎬 Đang xử lý nhóm bắt đầu bằng "${chunk[0]}" -> ${outputFileName}`
      );

      const concatListPath = path.join(TEMP_DIR, `list_${folderName}_${i}.txt`);
      let concatFileContent = "";
      const tempVideoFilesToClean = []; // Danh sách các file tạm cần xóa

      for (let j = 0; j < chunk.length; j++) {
        // Thêm video gốc vào danh sách ghép
        concatFileContent += `file '${path.resolve(
          videoFolderPath,
          chunk[j]
        )}'\n`;

        // Nếu không phải là video cuối cùng trong chunk và bật chèn thumbnail, thêm thumbnail
        if (j < chunk.length - 1 && USE_THUMBS) {
          const nextVideoName = chunk[j + 1];
          const thumbName =
            nextVideoName.replace(path.extname(nextVideoName), "") +
            THUMB_EXTENSION;
          const thumbPath = path.resolve(thumbFolderPath, thumbName);

          try {
            await fs.access(thumbPath); // Kiểm tra sự tồn tại của thumbnail
            console.log(`    🖼️  Chuẩn bị thumb: ${thumbName}`);

            // Tạo video tạm từ thumbnail với thông số chuẩn
            const tempVideoPath = await createVideoFromThumb(
              thumbPath,
              sourceVideoMetadata
            );
            concatFileContent += `file '${tempVideoPath}'\n`;
            tempVideoFilesToClean.push(tempVideoPath); // Thêm vào danh sách dọn dẹp
          } catch (error) {
            console.error(
              `\n    ❌ KHÔNG THỂ TÌM HOẶC XỬ LÝ THUMBNAIL: "${thumbName}"`
            );
            console.error(`    Chi tiết: ${error.message}\n`);
            // Xử lý lỗi: có thể bỏ qua thumb hoặc dừng nếu cần
            // Ở đây ta vẫn tiếp tục, nhưng file concat list sẽ thiếu video từ thumb này
          }
        }
      }

      // Chỉ thực hiện ghép nếu có ít nhất 2 video (gốc + thumb + gốc) hoặc nhiều hơn
      if (concatFileContent.trim().split("\n").length > 1) {
        await fs.writeFile(concatListPath, concatFileContent);

        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(concatListPath)
            .inputOptions(["-f concat", "-safe 0"])
            .outputOptions("-c copy") // Giữ nguyên -c copy để nhanh nhất
            .on("end", () => {
              console.log(`✅ Hoàn thành ghép video: ${outputFilePath}`);
              resolve();
            })
            .on("error", (err) => {
              console.error(
                `\n    ❌ LỖI KHI GHÉP VIDEO BẰNG -c copy: ${err.message}`
              );
              reject(new Error(`Lỗi khi ghép video: ${err.message}`));
            })
            .save(outputFilePath);
        });
        console.log("    🗑️  Dọn dẹp file tạm...");
        for (const file of tempVideoFilesToClean) {
          try {
            await fs.unlink(file);
          } catch (e) {
            console.warn(`    Lỗi xóa file tạm "${file}": ${e.message}`);
          }
        }
        try {
          await fs.unlink(concatListPath);
        } catch (e) {
          console.warn(
            `    Lỗi xóa concat list "${concatListPath}": ${e.message}`
          );
        }
      } else {
        console.log(`🟡 Không đủ video/thumb để ghép cho nhóm này. Bỏ qua.`);
      }
    }
  } catch (error) {
    console.error(`\n❌ Đã xảy ra lỗi nghiêm trọng:`, error.message);
  } finally {
    // Luôn dọn dẹp thư mục TEMP_DIR sau khi xử lý xong tất cả các thư mục con
    try {
      console.log("\n🧹 Bắt đầu dọn dẹp thư mục TEMP...");
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
      console.log("✅ Dọn dẹp TEMP_DIR thành công.");
    } catch (err) {
      console.error("❌ Lỗi khi dọn dẹp TEMP_DIR:", err.message);
    }
  }
}

// --- Logic chính ---
(async () => {
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.mkdir(TEMP_DIR, { recursive: true }); // Tạo TEMP_DIR ngay từ đầu

    // Đọc chunkSize, useThumbs, thumbDuration từ config nếu có (đã đọc ở trên, nhưng cần đọc lại để có giá trị mới nhất)
    let configChunkSize = DEFAULT_CHUNK_SIZE;
    if (fsSync.existsSync(configFilePath)) {
      try {
        const configContent = fsSync.readFileSync(configFilePath, "utf-8");
        const config = JSON.parse(configContent);
        if (config.chunkSize)
          configChunkSize =
            parseInt(config.chunkSize, 10) || DEFAULT_CHUNK_SIZE;
        if (config.useThumbs !== undefined) USE_THUMBS = config.useThumbs;
        if (config.thumbDuration)
          THUMB_DURATION = parseFloat(config.thumbDuration) || 3;
      } catch (error) {
        console.error(`Lỗi khi đọc config: ${error.message}`);
      }
    }

    const args = process.argv.slice(2);
    let folderName = null;
    let chunkSize = DEFAULT_CHUNK_SIZE;

    // Ưu tiên: INPUT_FOLDER từ config > command line args > auto mode
    if (INPUT_FOLDER) {
      // Mode mới: sử dụng folder input trực tiếp từ config
      chunkSize = configChunkSize;
      await processFolder(null, chunkSize); // folderName không cần thiết nữa
    } else if (args[0] && args[1]) {
      // Chế độ thủ công: node concat-video.js <chunkSize> <folderName>
      chunkSize = parseInt(args[0], 10) || DEFAULT_CHUNK_SIZE;
      folderName = args[1];
      await processFolder(folderName, chunkSize);
    } else {
      // Chế độ tự động
      console.log(
        `Chế độ tự động: Xử lý tất cả các thư mục con trong "${DONE_DIR}"...`
      );
      const allFolders = await fs.readdir(DONE_DIR, { withFileTypes: true });
      const subDirectories = allFolders
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
        );
      if (subDirectories.length === 0) {
        console.log(
          `🟡 Không tìm thấy thư mục con nào trong "${DONE_DIR}" để xử lý.`
        );
      }
      for (const f of subDirectories) {
        await processFolder(f, DEFAULT_CHUNK_SIZE);
      }
    }

    console.log("\n🎉 Quá trình xử lý hoàn tất!");
  } catch (err) {
    console.error("Lỗi không mong muốn trong quá trình khởi tạo:", err.message);
  } finally {
    // Dọn dẹp TEMP_DIR một lần nữa ở cuối cùng nếu có lỗi ở các bước khởi tạo
    try {
      // Việc dọn dẹp TEMP_DIR đã được chuyển vào finally của processFolder hoặc chạy sau vòng lặp chính
      // Nếu bạn muốn nó chạy một lần duy nhất ở cuối cùng của toàn bộ script:
      // console.log("\n🧹 Dọn dẹp TEMP_DIR cuối cùng...");
      // await fs.rm(TEMP_DIR, { recursive: true, force: true });
      // console.log("✅ Dọn dẹp TEMP_DIR cuối cùng thành công.");
    } catch (err) {
      // console.error("❌ Lỗi khi dọn dẹp TEMP_DIR cuối cùng:", err.message);
    }
  }
})();
