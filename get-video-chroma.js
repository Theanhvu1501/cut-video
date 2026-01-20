import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

// ================= CẤU HÌNH CƠ BẢN =================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Đường dẫn tới ffmpeg (dùng giống các file khác trong project)
const FFMPEG_PATH = path.join(__dirname, "bin", "ffmpeg.exe");

// Thư mục chứa video cần đọc màu
// argv[2]: folder input (bắt buộc truyền từ app)
const INPUT_FOLDER = process.argv[2] || "./overlays_trimmed";
// File output (theo yêu cầu: ./chormaKey.txt)
// argv[3]: file output (bắt buộc truyền từ app)
const OUTPUT_FILE = process.argv[3] || "./chromaKey.txt";

// Các màu OUTPUT mặc định (có thể là 4 hoặc nhiều hơn)
let PALETTE_HEX = [
  "22BDD6", // Xanh dương
  "2B4052", // Đen
  "7FBFDE", // Xanh dương nhạt
  "7097B8", // Còn lại
];

// ================= HÀM TIỆN ÍCH MÀU SẮC =================
const hexToRgb = (hex) => {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
};

const rgbToHex = ({ r, g, b }) => {
  return (
    "#" +
    [r, g, b]
      .map((v) => {
        const s = v.toString(16);
        return s.length === 1 ? "0" + s : s;
      })
      .join("")
  );
};

const distanceSq = (c1, c2) => {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return dr * dr + dg * dg + db * db;
};

// Chuẩn bị palette ở dạng RGB để so sánh nhanh
const buildPalette = (hexList) =>
  hexList.map((hex) => ({
    hex,
    rgb: hexToRgb(hex),
  }));

let PALETTE = buildPalette(PALETTE_HEX);

// argv[4] (tùy chọn): 1 hoặc nhiều màu custom, cách nhau bởi dấu phẩy, ví dụ:
// "22BDD6,2B4052,7FBFDE,7097B8"
const PALETTE_ARG = process.argv[4];
if (PALETTE_ARG) {
  const parts = PALETTE_ARG.split(",")
    .map((p) => p.trim().replace("#", "").toUpperCase())
    .filter((p) => /^[0-9A-F]{6}$/.test(p));

  if (parts.length > 0) {
    PALETTE_HEX = parts;
    PALETTE = buildPalette(PALETTE_HEX);
  } else {
    console.warn(
      `⚠️ Tham số palette không hợp lệ (không có màu hex hợp lệ nào): "${PALETTE_ARG}". Đang dùng palette mặc định.`,
    );
  }
}

// ================= HÀM LẤY FRAME TỪ VIDEO =================
const extractFirstFrameBuffer = (videoPath) => {
  return new Promise((resolve, reject) => {
    const args = [
      "-ss",
      "0",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "pipe:1",
    ];

    // 👉 dùng ffmpeg từ thư mục bin trong app (tương tự các file khác)
    const ff = spawn(FFMPEG_PATH, args);

    const chunks = [];
    let stderr = "";

    ff.stdout.on("data", (data) => {
      chunks.push(data);
    });

    ff.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ff.on("error", (err) => {
      reject(
        new Error(
          `Không chạy được ffmpeg. Kiểm tra ffmpeg đã được cài và có trong PATH chưa.\n${err.message}`,
        ),
      );
    });

    ff.on("close", (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(
          new Error(
            `ffmpeg exit code ${code} khi trích frame từ ${videoPath}:\n${stderr}`,
          ),
        );
      }
    });
  });
};

// ================= HÀM TÍNH MÀU TỪ FRAME =================
const getAverageColorFromFrameBuffer = async (buffer) => {
  // Resize nhỏ để tính nhanh, không cần quá chính xác
  const { data, info } = await sharp(buffer)
    .resize(64, 64, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info; // channels = 3 (RGB)
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  const totalPixels = width * height;

  for (let i = 0; i < data.length; i += channels) {
    rSum += data[i];
    gSum += data[i + 1];
    bSum += data[i + 2];
  }

  const avg = {
    r: Math.round(rSum / totalPixels),
    g: Math.round(gSum / totalPixels),
    b: Math.round(bSum / totalPixels),
  };

  return avg;
};

// Map màu bất kỳ về 1 trong 4 màu yêu cầu
const mapToNearestPaletteColor = (rgb) => {
  let best = PALETTE[0];
  let bestDist = distanceSq(rgb, best.rgb);

  for (let i = 1; i < PALETTE.length; i++) {
    const p = PALETTE[i];
    const d = distanceSq(rgb, p.rgb);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }

  return best.hex;
};

// ================= MAIN =================
const main = async () => {
  if (!fs.existsSync(INPUT_FOLDER)) {
    console.error(`❌ Không tìm thấy thư mục: ${INPUT_FOLDER}`);
    process.exit(1);
  }

  const videoFiles = fs
    .readdirSync(INPUT_FOLDER)
    .filter((f) =>
      [".mp4", ".avi", ".mkv", ".mov"].includes(path.extname(f).toLowerCase()),
    )
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );

  if (videoFiles.length === 0) {
    console.log(`⚠️ Không có file video nào trong thư mục ${INPUT_FOLDER}`);
    process.exit(0);
  }

  console.log(
    `🎥 Tìm thấy ${videoFiles.length} video trong thư mục ${INPUT_FOLDER}`,
  );

  const results = [];

  for (const file of videoFiles) {
    const fullPath = path.join(INPUT_FOLDER, file);
    try {
      const frameBuf = await extractFirstFrameBuffer(fullPath);
      const avgRgb = await getAverageColorFromFrameBuffer(frameBuf);
      const mappedHex = mapToNearestPaletteColor(avgRgb);

      results.push({ file, mappedHex });
      console.log(`${file} -> avg=${rgbToHex(avgRgb)} -> mapped=${mappedHex}`);
    } catch (err) {
      console.error(`❌ Lỗi xử lý ${file}: ${err.message}`);
    }
  }

  // Ghi ra file:
  // - Mỗi video 1 dòng, chỉ gồm mã hex (không có dấu #)
  // - Số dòng đúng bằng số video trong folder INPUT_FOLDER
  const hexList = results.map((r) => r.mappedHex.replace("#", ""));
  fs.writeFileSync(OUTPUT_FILE, hexList.join("\n"), { encoding: "utf-8" });

  console.log(
    `\n✅ Đã lưu kết quả (${results.length} dòng) vào file: ${OUTPUT_FILE}`,
  );
};

main().catch((err) => {
  console.error("❌ Lỗi không mong muốn:", err);
  process.exit(1);
});
