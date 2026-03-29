import { spawn } from "child_process";
import ffmpegFluent from "fluent-ffmpeg";
import fs from "fs";
import pLimit from "p-limit";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";
import { create as createYoutubeDl } from "youtube-dl-exec";

// =================================================================
// 0. CẤU HÌNH BAN ĐẦU
// =================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Đường dẫn đến ffmpeg trong thư mục bin
const FFMPEG_PATH = path.join(__dirname, "bin", "ffmpeg.exe");
const FFPROBE_PATH = path.join(__dirname, "bin", "ffprobe.exe");

// Sử dụng absolute path để đảm bảo tìm đúng file sau khi tải mới
const YTDLP_PATH = path.join(__dirname, "bin", "yt-dlp.exe");
// Tạo helper function để luôn lấy yt-dlp mới nhất (sau khi tải update)
const getYoutubeDl = () => createYoutubeDl(YTDLP_PATH);
// Giữ object cũ để tương thích, nhưng nên dùng getYoutubeDl() để đảm bảo dùng file mới
const youtubedl = getYoutubeDl();
ffmpegFluent.setFfmpegPath(FFMPEG_PATH);
ffmpegFluent.setFfprobePath(FFPROBE_PATH);

let ALL_URLS_FILE = "./urls.txt"; // Tên file chứa TẤT CẢ các URL
const FAILED_URLS_LOG = "./failed_urls.txt"; // File log chứa các URL bị lỗi (đơn giản hóa)
let DOWNLOAD_DIR = "./overlays"; // Thư mục lưu video tải về và thumbnail gốc
let OVERLAY_IMAGES_DIR = "./images"; // Thư mục chứa các ảnh overlay
let OUTPUT_THUMBS_BASE_DIR = "./thumbs"; // Thư mục gốc lưu ảnh đã xử lý
let COOKIES_FILE = "./cookies.txt"; // File cookies.txt
let MAX_CONCURRENT = 2; // Số video tải song song
let PROXY = null; // Proxy để sử dụng khi download (vd: http://proxy.example.com:8080)
let DOWNLOAD_DRIVE = false; // Bật tải Drive với giới hạn độ dài tên file
let DRIVE_LANGUAGE = "jp"; // Ngôn ngữ cho Drive: "auto", "jp", "cn", "kr", "vi", "en", etc.
let DESC_DIR = null; // Thư mục lưu mô tả (desc)


// Đọc config từ project JSON (mặc định là "default")
// Kiểm tra PROJECT_NAME và PROJECTS_DIR environment variable (được set bởi Electron main process)
const projectName = process.env.PROJECT_NAME || "default";
const projectsDir =
  process.env.PROJECTS_DIR || path.join(__dirname, "projects");
const projectConfigPath = path.join(projectsDir, `${projectName}.json`);

if (fs.existsSync(projectConfigPath)) {
  try {
    const projectContent = fs.readFileSync(projectConfigPath, "utf-8");
    const projectData = JSON.parse(projectContent);
    const config = projectData.settings?.download;

    if (config) {
      if (config.urlsFile) ALL_URLS_FILE = config.urlsFile;
      if (config.outputFolder) DOWNLOAD_DIR = config.outputFolder;
      if (config.descFolder !== undefined) DESC_DIR = config.descFolder;
      if (config.overlayImagesFolder)
        OVERLAY_IMAGES_DIR = config.overlayImagesFolder;
      if (config.thumbsFolder) OUTPUT_THUMBS_BASE_DIR = config.thumbsFolder;
      if (config.cookiesFile !== undefined) COOKIES_FILE = config.cookiesFile;
      if (config.maxConcurrent !== undefined) MAX_CONCURRENT = parseInt(config.maxConcurrent) || 2;
      if (config.proxy !== undefined && config.proxy) {
        // Trim và validate proxy
        const proxyValue =
          typeof config.proxy === "string" ? config.proxy.trim() : config.proxy;
        // Chỉ set PROXY nếu có giá trị hợp lệ (không phải empty string hoặc null)
        if (proxyValue && proxyValue !== "null" && proxyValue !== "undefined") {
          PROXY = proxyValue;
        } else {
          // Reset PROXY về null nếu config có giá trị không hợp lệ
          PROXY = null;
        }
      } else {
        // Nếu proxy không có trong config hoặc là null/undefined, đảm bảo PROXY là null
        PROXY = null;
      }
      if (config.downloadDrive !== undefined)
        DOWNLOAD_DRIVE = config.downloadDrive;
      if (config.driveLanguage !== undefined)
        DRIVE_LANGUAGE = config.driveLanguage;

      console.log(`Đã đọc config từ project: ${projectName}`);
    }
  } catch (error) {
    console.error(`Lỗi khi đọc project config: ${error.message}`);
  }
}

// =================================================================
// 1. CÁC HÀM CỐT LÕI
// =================================================================

const getDriveFilenameLimit = (language) => {
  const limits = {
    jp: 240, // Tiếng Nhật: 240 bytes (khoảng 60-80 ký tự)
    cn: 240, // Tiếng Trung: 240 bytes
    kr: 240, // Tiếng Hàn: 240 bytes
    th: 255, // Tiếng Thái: 255 bytes
    ar: 255, // Tiếng Ả Rập: 255 bytes
    vi: 255, // Tiếng Việt: 255 bytes (có thể có dấu)
    en: 255, // Tiếng Anh và Latin: 255 bytes (1 byte/ký tự)
    default: 240, // Mặc định
  };

  return limits[language] || limits.default;
};

function normalizeProxy(raw) {
  if (!raw) return null;

  raw = raw.trim();

  let scheme = "http";

  // 1️⃣ Tách scheme nếu có
  const schemeMatch = raw.match(/^(\w+):\/\//);
  if (schemeMatch) {
    scheme = schemeMatch[1];
    raw = raw.replace(/^\w+:\/\//, "");
  }

  // 2️⃣ Nếu đã có dạng user:pass@host:port → DONE
  if (raw.includes("@")) {
    const [auth, hostPort] = raw.split("@");
    const [host, port] = hostPort.split(":");
    if (!port || isNaN(port)) throw new Error("Invalid port");
    return `${scheme}://${auth}@${host}:${port}`;
  }

  // 3️⃣ Split theo :
  const parts = raw.split(":");

  // host:port
  if (parts.length === 2) {
    const [host, port] = parts;
    if (isNaN(port)) throw new Error("Invalid port");
    return `${scheme}://${host}:${port}`;
  }

  // host:port:user:pass
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    if (isNaN(port)) throw new Error("Invalid port");
    return `${scheme}://${user}:${pass}@${host}:${port}`;
  }
  console.error(`🔴 Lỗi định dạng proxy`);
  return null;
}


function getNodeExecutable() {
  // Vì process được chạy độc lập, chúng ta kiểm tra đường dẫn thư mục hiện tại để biết đang chạy trong production hay không
  const isPackaged = __dirname.includes('app.asar') || __dirname.includes('resources');

  if (!isPackaged) return "node";

  // Đường dẫn có thể có bin/node.exe dựa vào vị trí của app.asar.unpacked
  const possiblePaths = [
    path.join(__dirname, "bin", "node.exe"), // Nếu script chạy thẳng trong app.asar.unpacked
    path.join(__dirname, "..", "bin", "node.exe"), // Trong trường hợp nằm trong thư mục con nào đó
    path.join(__dirname, "..", "..", "bin", "node.exe") // Nếu cần lùi thêm cấp
  ];

  // Nếu tìm được file exe, trả về đường dẫn
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }

  return "node";
}

/**
 * Tải một video YouTube duy nhất.
 */
const downloadVideo = async (url, outputPath) => {
  let output;

  if (DOWNLOAD_DRIVE) {
    // Xác định ngôn ngữ (mặc định là jp)
    let language = DRIVE_LANGUAGE || "jp";
    const byteLimit = getDriveFilenameLimit(language);
    output = path.join(outputPath, `%(title).${byteLimit}B.%(ext)s`);
  } else {
    output = path.join(outputPath, "%(title)s.%(ext)s");
  }

  // Chuẩn bị options
  const options = {
    output: output,
    format:
      "bestvideo[height=720][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height=720][ext=mp4][vcodec^=avc]",
    mergeOutputFormat: "mp4",
    writeThumbnail: true,
    convertThumbnails: "jpg",
    addHeader: [
      "referer:youtube.com",
      "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    ],
    limitRate: "2M",
    cookies: COOKIES_FILE,
    // addHeader: ["referer:youtube.com", "user-agent:googlebot"], // Bỏ comment nếu cần
    noOverwrites: true, // Không ghi đè nếu file đã tồn tại
    extractorArgs: ["youtube:player_client=default,-android_sdkless"],
    jsRuntime: getNodeExecutable(),
  };

  if (DESC_DIR && fs.existsSync(DESC_DIR)) {
    options.writeDescription = true;
  }

  // Thêm proxy nếu có (validate và trim)
  if (PROXY && typeof PROXY === "string" && PROXY.trim()) {
    const trimmedProxy = PROXY.trim();
    // Validate proxy format (phải có protocol: http://, https://, hoặc socks5://)
    if (/^(http|https|socks5):\/\//i.test(trimmedProxy)) {
      const proxy = normalizeProxy(trimmedProxy);
      options.proxy = proxy;
      console.log(`🔒 Sử dụng proxy: ${proxy}`);
    } else {
      console.warn(
        `⚠️ Proxy format không hợp lệ: ${trimmedProxy}. Proxy phải bắt đầu với http://, https://, hoặc socks5://`,
      );
    }
  }

  // Sử dụng getYoutubeDl() để đảm bảo luôn dùng yt-dlp mới nhất (sau khi update)
  await getYoutubeDl()(url, options);
  console.log(`✅ Tải/Kiểm tra thành công: ${url}`);
};

const downloadVideoWithYtdl = (url, outputPath) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_PATH, [
      "-f",
      "bestvideo[height=720]+bestaudio/best",
      "-o",
      path.join(outputPath, "%(title)s.%(ext)s"),
      "--merge-output-format",
      "mp4",
      "--write-thumbnail",
      "--convert-thumbnails",
      "jpg",
      "--no-overwrites",
      "--limit-rate",
      "2M",
      "--add-header",
      "referer:youtube.com",
      "--add-header",
      "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      url,
    ]);

    proc.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ Hoàn tất: ${url}`);
        resolve();
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });
  });
};

/**
 * Tải tất cả video từ một danh sách URL, báo cáo kết quả.
 * Trả về danh sách các tác vụ bị từ chối (failed URLs).
 */

const sleepRandom = (min, max) => {
  const sleepTime = Math.random() * (max - min) + min;
  return new Promise((resolve) => setTimeout(resolve, sleepTime));
};

const downloadVideosFromList = async (urls, savePath) => {
  if (!fs.existsSync(savePath)) fs.mkdirSync(savePath, { recursive: true });

  console.log(`📄 Bắt đầu tải ${urls.length} URL với giới hạn ${MAX_CONCURRENT} video tải song song.`);
  if (urls.length === 0) return [];

  const limit = pLimit(MAX_CONCURRENT); // Giới hạn 3 video tải song song

  const downloadPromises = urls.map((url) =>
    limit(async () => {
      try {
        await sleepRandom(1000, 2500);
        await downloadVideo(url, savePath);
        return { status: "fulfilled", url: url };
      } catch (error) {
        // Lấy thông tin lỗi chi tiết hơn
        let reason = error.message || "Unknown error";
        if (error.stderr) {
          reason = error.stderr.toString();
        } else if (error.stdout) {
          reason = error.stdout.toString();
        }

        // Log chi tiết lỗi proxy nếu có
        if (
          PROXY &&
          (reason.includes("proxy") ||
            reason.includes("Proxy") ||
            reason.includes("PROXY"))
        ) {
          console.error(`🔴 Lỗi proxy cho URL: ${url}`);
          console.error(`   Proxy đang sử dụng: ${PROXY}`);
          console.error(`   Chi tiết lỗi: ${reason}`);
        } else {
          console.error(`🔴 Đã bắt được lỗi cho URL: ${url}`, reason);
        }
        return { status: "rejected", url: url, reason: reason };
      }
    }),
  );

  const results = await Promise.all(downloadPromises);
  const failedTasks = results.filter((result) => result.status === "rejected");
  return failedTasks.map((task) => task.url); // Trả về chỉ URL bị lỗi
};

/**
 * Chuyển đổi codec của các file MP4 trong thư mục.
 */
const convertCodec = async (directory) => {
  if (!fs.existsSync(directory)) {
    console.warn(
      `⚠️ Thư mục không tồn tại: ${directory}, bỏ qua convert codec.`,
    );
    return;
  }
  const files = fs.readdirSync(directory);

  for (const file of files) {
    const filePath = path.join(directory, file);
    const ext = path.extname(file).toLowerCase();

    if (ext === ".mp4") {
      const outputFilePath = path.join(directory, "converted_" + file);

      console.log(`🔄 Đang chuyển đổi codec: ${file} -> ${outputFilePath}`);

      try {
        await new Promise((resolve, reject) => {
          ffmpegFluent(filePath)
            .videoCodec("libx264")
            .audioCodec("aac")
            .audioBitrate("128k")
            .outputOptions("-preset fast") // Giảm thời gian encode
            .outputOptions("-crf 23") // Chất lượng tốt, dung lượng tối ưu
            .on("end", () => {
              console.log(`✅ Đã chuyển đổi codec: ${file}`);
              fs.unlinkSync(filePath); // Xóa file gốc sau khi convert
              fs.renameSync(outputFilePath, filePath); // Đổi lại tên file thành gốc
              resolve();
            })
            .on("error", (err) => {
              console.error(`❌ Lỗi khi chuyển đổi ${file}: ${err.message}`);
              reject(err);
            })
            .save(outputFilePath);
        });
      } catch (error) {
        console.error(
          `❌ Không thể chuyển đổi codec cho ${file}: ${error.message}`,
        );
      }
    }
  }
};

/**
 * Sửa tên file, thay thế ký tự '？'.
 */
const fixFileNames = (directory) => {
  if (!fs.existsSync(directory)) return;
  const files = fs.readdirSync(directory);

  for (const file of files) {
    const normalizedName = file.normalize("NFC");
    if (file !== normalizedName) {
      const oldPath = path.join(directory, file);
      const newPath = path.join(directory, normalizedName);
      try {
        fs.renameSync(oldPath, newPath);
        console.log(`🔧 Đã chuẩn hóa tên file: ${file} -> ${normalizedName}`);
      } catch (error) {
        console.error(`❌ Lỗi khi đổi tên file ${file}: ${error.message}`);
      }
    }
  }
};

/**
 * Xử lý tất cả thumbnail trong một thư mục bằng cách áp dụng TẤT CẢ các ảnh overlay
 * từ thư mục OVERLAY_IMAGES_DIR, lưu kết quả vào các thư mục con tương ứng.
 */
async function processAllThumbnailsWithMultipleOverlays(
  inputThumbDir, // Thư mục chứa các thumbnail gốc đã tải
  overlayImagesDir, // Thư mục chứa nhiều ảnh overlay
  outputBaseDir, // Thư mục gốc để lưu kết quả (sẽ có các thư mục con)
  overlaySize,
) {
  try {
    if (!fs.existsSync(inputThumbDir)) {
      console.warn(
        `⚠️ Thiếu thư mục thumbnail gốc: ${inputThumbDir}, bỏ qua xử lý ảnh.`,
      );
      return;
    }
    if (!fs.existsSync(overlayImagesDir)) {
      console.warn(
        `⚠️ Thiếu thư mục ảnh overlay tại: ${overlayImagesDir}, bỏ qua xử lý ảnh.`,
      );
      return;
    }

    const overlayFiles = fs
      .readdirSync(overlayImagesDir)
      .filter((file) => /\.(jpg|jpeg|png|webp)$/i.test(file))
      .sort(
        (a, b) => parseInt(path.parse(a).name) - parseInt(path.parse(b).name),
      ); // Sắp xếp theo tên (số)

    if (overlayFiles.length === 0) {
      console.warn(
        `⚠️ Không tìm thấy ảnh overlay nào trong thư mục: ${overlayImagesDir}. Bỏ qua xử lý ảnh.`,
      );
      return;
    }

    const inputThumbnailFiles = fs
      .readdirSync(inputThumbDir)
      .filter((file) => /\.(jpg|jpeg|png|webp)$/i.test(file));

    if (inputThumbnailFiles.length === 0) {
      console.log(
        `ℹ️ Không có ảnh thumbnail gốc nào để xử lý trong ${inputThumbDir}.`,
      );
      return;
    }

    console.log(
      `🖼️  Bắt đầu xử lý ${inputThumbnailFiles.length} ảnh thumbnail gốc với ${overlayFiles.length} ảnh overlay.`,
    );

    for (let i = 0; i < overlayFiles.length; i++) {
      const overlayFileName = overlayFiles[i];
      const overlayPath = path.join(overlayImagesDir, overlayFileName);
      const outputDirForThisOverlay = path.join(outputBaseDir, `${i + 1}`); // Tạo thư mục con dựa trên thứ tự overlay

      if (!fs.existsSync(outputDirForThisOverlay)) {
        fs.mkdirSync(outputDirForThisOverlay, { recursive: true });
      }

      // Tạo overlay hình tròn một lần cho mỗi file overlay
      const overlayCircle = await sharp(overlayPath)
        .resize(overlaySize, overlaySize)
        .composite([
          {
            input: Buffer.from(
              `<svg><circle cx="${overlaySize / 2}" cy="${
                overlaySize / 2
              }" r="${overlaySize / 2}" fill="white"/></svg>`,
            ),
            blend: "dest-in",
          },
        ])
        .png()
        .toBuffer();

      // Áp dụng overlay này cho TẤT CẢ các thumbnail gốc
      for (const file of inputThumbnailFiles) {
        const inputPath = path.join(inputThumbDir, file);
        const outputPath = path.join(outputDirForThisOverlay, file);
        try {
          const transformedBaseImage = await sharp(inputPath)
            .modulate({ brightness: 1.1, saturation: 1.2, hue: 20 })
            .toBuffer();
          const metadata = await sharp(transformedBaseImage).metadata();
          const x = metadata.width - overlaySize - 10;
          const y = 10;
          await sharp(transformedBaseImage)
            .composite([{ input: overlayCircle, top: y, left: x }])
            .toFile(outputPath);
        } catch (err) {
          console.error(
            `❌ Lỗi khi xử lý file ảnh ${file} với overlay ${overlayFileName}:`,
            err.message,
          );
        }
      }
    }
    console.log(`✅ Toàn bộ quá trình xử lý ảnh overlay đã hoàn tất.`);
  } catch (err) {
    console.error(`❌ Lỗi nghiêm trọng khi xử lý ảnh:`, err.message);
  }
}

// =================================================================
// 2. HÀM MAIN - ĐIỀU PHỐI CHÍNH
// =================================================================

async function main() {
  // --- Cấu hình ---
  // Các biến cấu hình đã được định nghĩa ở trên (ALL_URLS_FILE, FAILED_URLS_LOG, v.v.)
  const overlaySize = 125; // Kích thước của ảnh overlay

  // --- Kiểm tra chế độ chạy ---
  const isRetryMode = process.argv.includes("retry");

  if (isRetryMode) {
    console.log("🚀 Chạy ở chế độ THỬ LẠI (RETRY)...");
    if (
      !fs.existsSync(FAILED_URLS_LOG) ||
      fs.readFileSync(FAILED_URLS_LOG, "utf-8").trim() === ""
    ) {
      console.log(
        "✅ Không có file log lỗi hoặc file rỗng. Không cần thử lại.",
      );
      return;
    }
  } else {
    console.log("🚀 Chạy ở chế độ BÌNH THƯỜNG...");
    console.log("🧹 Dọn dẹp/Chuẩn bị thư mục...");

    // Đảm bảo các thư mục tồn tại
    [DOWNLOAD_DIR, OVERLAY_IMAGES_DIR, OUTPUT_THUMBS_BASE_DIR].forEach(
      (dir) => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          console.log(`➕ Đã tạo thư mục: ${dir}`);
        }
      },
    );

    // Xóa file log lỗi cũ khi chạy chế độ bình thường để bắt đầu lại từ đầu
    if (fs.existsSync(FAILED_URLS_LOG)) {
      fs.unlinkSync(FAILED_URLS_LOG);
      console.log(`🗑️ Đã xóa file log lỗi cũ: ${FAILED_URLS_LOG}`);
    }
  }

  // --- Đọc danh sách URL cần xử lý ---
  let urlsToProcess = [];
  if (isRetryMode) {
    console.log(`🔎 Đọc các URL lỗi từ file: ${FAILED_URLS_LOG}`);
    urlsToProcess = fs
      .readFileSync(FAILED_URLS_LOG, "utf-8")
      .split("\n")
      .filter(Boolean);
    // Xóa file log lỗi sau khi đọc để ghi lại lỗi mới nếu có trong lần retry này
    fs.unlinkSync(FAILED_URLS_LOG);
  } else {
    if (!fs.existsSync(ALL_URLS_FILE)) {
      console.error(`❌ Lỗi: Không tìm thấy file URL chính: ${ALL_URLS_FILE}`);
      console.log("💡 Vui lòng tạo file urls.txt và thêm các URL vào đó.");
      return;
    }
    console.log(`🔎 Đọc các URL từ file: ${ALL_URLS_FILE}`);
    urlsToProcess = fs
      .readFileSync(ALL_URLS_FILE, "utf-8")
      .split("\n")
      .filter(Boolean);
  }

  if (urlsToProcess.length === 0) {
    console.log("✅ Không tìm thấy URL nào để xử lý.");
    return;
  }

  // --- Tải video ---
  console.log(`\n================== BẮT ĐẦU TẢI VIDEO ==================`);
  const failedDownloads = await downloadVideosFromList(
    urlsToProcess,
    DOWNLOAD_DIR,
  );

  // --- Di chuyển descriptions ---
  if (DESC_DIR && fs.existsSync(DESC_DIR)) {
    console.log(`\n📦 Đang di chuyển file mô tả (.description) vào: ${DESC_DIR}...`);
    try {
        const files = fs.readdirSync(DOWNLOAD_DIR);
        for (const file of files) {
           if (file.endsWith('.description')) {
               const oldPath = path.join(DOWNLOAD_DIR, file);
               const newPath = path.join(DESC_DIR, file.replace(/\.description$/, '.txt'));
               fs.renameSync(oldPath, newPath);
               console.log(`  - Đã xuất mô tả: ${file.replace(/\.description$/, '.txt')}`);
           }
        }
    } catch(err) {
        console.error(`❌ Lỗi khi di chuyển file mô tả: `, err.message);
    }
  }

  // --- Sửa tên file ---
  console.log(`\n🔧 Đang sửa tên file trong thư mục: ${DOWNLOAD_DIR}...`);
  fixFileNames(DOWNLOAD_DIR);

  // --- Chuyển đổi codec (bỏ comment để bật) ---
  // console.log(`\n🔄 Đang chuyển đổi codec trong thư mục: ${DOWNLOAD_DIR}...`);
  // await convertCodec(DOWNLOAD_DIR);

  // --- Xử lý ảnh overlay ---
  console.log(`\n🖼️  Bắt đầu xử lý ảnh thumbnail với nhiều overlay...`);
  await processAllThumbnailsWithMultipleOverlays(
    DOWNLOAD_DIR, // Thư mục chứa các thumbnail gốc đã tải
    OVERLAY_IMAGES_DIR, // Thư mục chứa nhiều ảnh overlay (images/)
    OUTPUT_THUMBS_BASE_DIR, // Thư mục gốc để lưu kết quả (thumbs/)
    overlaySize,
  );

  // --- Tổng kết ---
  if (failedDownloads.length > 0) {
    console.log("\n================== TỔNG KẾT LỖI ==================");
    console.error(
      `🔥 Tổng cộng có ${failedDownloads.length} video tải thất bại.`,
    );
    const failedUrlsContent = failedDownloads.join("\n");
    fs.writeFileSync(FAILED_URLS_LOG, failedUrlsContent);
    console.log(
      `📂 Danh sách các URL lỗi đã được ghi vào file: ${FAILED_URLS_LOG}`,
    );
    if (!isRetryMode) {
      console.log(
        "💡 Mẹo: Chạy lại với lệnh 'node your_script_name.js retry' để tự động thử lại các video lỗi.",
      );
    } else {
      console.log(
        "⚠️ Vẫn còn URL lỗi sau khi thử lại. Vui lòng kiểm tra file log.",
      );
    }
  } else {
    console.log("\n🎉🎉🎉 TẤT CẢ CÁC VIDEO ĐỀU ĐƯỢC XỬ LÝ THÀNH CÔNG! 🎉🎉🎉");
    if (fs.existsSync(FAILED_URLS_LOG)) {
      fs.unlinkSync(FAILED_URLS_LOG); // Xóa file log lỗi nếu tất cả đã thành công
      console.log(`🗑️ Đã xóa file log lỗi ${FAILED_URLS_LOG}.`);
    }
  }

  console.log("\n🏁 Chương trình đã hoàn tất.");
}

// Chạy chương trình
main();
