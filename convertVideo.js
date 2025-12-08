import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ================= CẤU HÌNH GPU & LUỒNG =================
const CONFIG = {
  inputDir: "./input",
  outputDir: "./overlays_convert",

  // Số luồng chạy song song.
  // Nếu dùng GPU, có thể tăng lên 4-5 vì Encode nhanh hơn.
  maxConcurrent: 3,

  // CHỌN CHẾ ĐỘ RENDER: 'nvidia', 'intel', 'amd', hoặc 'cpu'
  // - 'nvidia': Dùng cho card GTX/RTX (Khuyên dùng)
  // - 'intel':  Dùng cho Intel QuickSync (UHD Graphics)
  // - 'amd':    Dùng cho card AMD Radeon
  // - 'cpu':    Chạy bằng CPU thuần (chậm nhưng ổn định nhất)
  mode: "nvidia",
};
// ========================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tạo thư mục output
if (!fs.existsSync(CONFIG.outputDir)) {
  fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

// Chuỗi bộ lọc giữ nguyên
const complexFilter =
  "chromahold=0x7fff00:0.25, chromahold=0xffffff:0.25, format=rgb24, geq=r='if(lte(abs(r(X,Y)-g(X,Y)),20)*lte(abs(g(X,Y)-b(X,Y)),20)*lte(r(X,Y),220),0,p(X,Y))':g='if(lte(abs(r(X,Y)-g(X,Y)),20)*lte(abs(g(X,Y)-b(X,Y)),20)*lte(r(X,Y),220),0,p(X,Y))':b='if(lte(abs(r(X,Y)-g(X,Y)),20)*lte(abs(g(X,Y)-b(X,Y)),20)*lte(r(X,Y),220),0,p(X,Y))'";

/**
 * Lấy tham số FFmpeg dựa trên loại GPU
 */
function getFfmpegOptions(inputPath, outputPath) {
  let hwAccel = [];
  let videoCodec = "libx264"; // Mặc định CPU

  switch (CONFIG.mode.toLowerCase()) {
    case "nvidia":
      // NVIDIA NVENC
      hwAccel = ["-hwaccel", "cuda"];
      videoCodec = "h264_nvenc";
      break;
    case "intel":
      // Intel QuickSync
      hwAccel = ["-hwaccel", "qsv"];
      videoCodec = "h264_qsv";
      break;
    case "amd":
      // AMD AMF
      hwAccel = ["-hwaccel", "dxva2"]; // AMD thường dùng dxva2 để decode trên win
      videoCodec = "h264_amf";
      break;
    default:
      // CPU
      videoCodec = "libx264";
      break;
  }

  // Preset cho encoder (P4 là cân bằng giữa tốc độ và chất lượng cho NVENC)
  const encoderOptions =
    CONFIG.mode === "nvidia" ? ["-preset", "p4"] : ["-preset", "medium"];

  return [
    "-y",
    ...hwAccel, // Thêm cờ phần cứng vào trước input
    "-i",
    inputPath,
    "-vf",
    complexFilter,
    "-c:v",
    videoCodec, // Codec render (GPU hoặc CPU)
    ...encoderOptions,
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ];
}

function processVideo(fileName) {
  return new Promise((resolve, reject) => {
    const inputPath = path.join(CONFIG.inputDir, fileName);
    const outputPath = path.join(CONFIG.outputDir, fileName);

    console.log(`▶️ [${CONFIG.mode.toUpperCase()}] Bắt đầu: ${fileName}`);

    const args = getFfmpegOptions(inputPath, outputPath);

    // Spawn tiến trình
    const ffmpeg = spawn("ffmpeg", args);

    // Bắt lỗi stderr để debug nếu cần (FFmpeg xuất log qua stderr)
    let errorLog = "";
    ffmpeg.stderr.on("data", (data) => {
      errorLog += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ Hoàn thành: ${fileName}`);
        resolve(fileName);
      } else {
        console.error(`❌ Lỗi render file: ${fileName} (Code: ${code})`);
        // In ra vài dòng log cuối cùng để biết lỗi gì
        console.error(`   Log chi tiết: ${errorLog.slice(-300)}`);
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", (err) => {
      console.error(`❌ Lỗi không tìm thấy FFmpeg hoặc lỗi hệ thống:`, err);
      reject(err);
    });
  });
}

// Hàm quản lý hàng đợi (Worker Pool)
async function processQueue(files) {
  const results = [];
  const executing = [];

  for (const file of files) {
    const p = processVideo(file)
      .then((result) => {
        executing.splice(executing.indexOf(p), 1);
        return result;
      })
      .catch(() => {
        // Nếu lỗi thì vẫn tiếp tục queue, chỉ xóa khỏi executing
        executing.splice(executing.indexOf(p), 1);
      });

    results.push(p);
    executing.push(p);

    if (executing.length >= CONFIG.maxConcurrent) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

// MAIN
async function main() {
  try {
    if (!fs.existsSync(CONFIG.inputDir)) {
      console.error(`❌ Không tìm thấy thư mục ${CONFIG.inputDir}`);
      return;
    }

    const files = fs
      .readdirSync(CONFIG.inputDir)
      .filter((file) => file.toLowerCase().endsWith(".mp4"));

    if (files.length === 0) {
      console.log("⚠️ Không có file .mp4 nào.");
      return;
    }

    console.log(`🚀 Tìm thấy ${files.length} video.`);
    console.log(
      `⚙️  Chế độ: ${CONFIG.mode} | Luồng tối đa: ${CONFIG.maxConcurrent}`
    );

    const startTime = Date.now();
    await processQueue(files);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n🎉 TẤT CẢ ĐÃ XONG! (Tổng thời gian: ${duration}s)`);
  } catch (error) {
    console.error("Lỗi chương trình:", error);
  }
}

main();
