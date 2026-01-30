// downloader.js
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { fileURLToPath } from "url";

// Cấu hình đường dẫn cho FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

/* =========================
   PATH SETUP
========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   USER SETTINGS (CẤU HÌNH Ở ĐÂY - dùng khi chạy standalone)
   Khi chạy từ Electron, config đọc từ process.env (STOCK_*)
========================= */

const fromEnv = (key, fallback) => (process.env[key] !== undefined && process.env[key] !== "" ? process.env[key] : fallback);
const fromEnvBool = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v === "true" || v === "yes";
};
const fromEnvNum = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
};

// 1. INPUT: Từ khóa & Số lượng
const SEARCH_QUERIES = ["nature"];
const MAX_VIDEOS_PER_QUERY = fromEnvNum("STOCK_MAX_VIDEOS", 30);

// 2. CẤU HÌNH FILE GỐC
const TARGET_ORIENTATION = fromEnv("STOCK_ORIENTATION", "landscape");
const DEFAULT_OUT_DIR = fromEnv("STOCK_OUT_DIR", path.join(process.cwd(), "stock_videos"));

// 3. OPTION XỬ LÝ VIDEO (từ env: STOCK_CONVERT_720, STOCK_REMOVE_AUDIO, STOCK_TRIM_SECONDS)
const OPTION_CONVERT_720 = fromEnvBool("STOCK_CONVERT_720", true);
const OPTION_REMOVE_AUDIO = fromEnvBool("STOCK_REMOVE_AUDIO", true);
const OPTION_TRIM_SECONDS = fromEnvNum("STOCK_TRIM_SECONDS", 0); // 0 = không cắt

// 4. Nguồn tải (từ Electron: STOCK_USE_PEXELS, STOCK_USE_PIXABAY)
const USE_PEXELS = fromEnvBool("STOCK_USE_PEXELS", true);
const USE_PIXABAY = fromEnvBool("STOCK_USE_PIXABAY", true);

/* =========================
   API CONFIG (từ env khi chạy từ app, không hardcode key trong repo)
========================= */
const PEXELS_API_KEY = fromEnv("STOCK_PEXELS_API_KEY", process.env.PEXELS_API_KEY || "");
const PIXABAY_KEY = fromEnv("STOCK_PIXABAY_API_KEY", process.env.PIXABAY_KEY || "");

const BASE_SLEEP_MS = 400;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS  = 30000;
const MAX_RETRIES   = 8;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* =========================
   UTILS
========================= */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function safeFilename(name) {
  return name.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 180);
}

function ensureKeys() {
  if (USE_PEXELS && !PEXELS_API_KEY) throw new Error("Bật Pexels cần nhập API key Pexels.");
  if (USE_PIXABAY && !PIXABAY_KEY) throw new Error("Bật Pixabay cần nhập API key Pixabay.");
  if (!USE_PEXELS && !USE_PIXABAY) throw new Error("Chọn ít nhất một nguồn: Pexels hoặc Pixabay.");
}

// Kiểm tra xem có cần xử lý video không
const NEEDS_PROCESSING = OPTION_CONVERT_720 || OPTION_REMOVE_AUDIO || (OPTION_TRIM_SECONDS > 0);

/* =========================
   FFMPEG PROCESSING
========================= */
function processVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath);

    // 1. Cắt video (Lấy n giây đầu)
    if (OPTION_TRIM_SECONDS > 0) {
      command.setDuration(OPTION_TRIM_SECONDS);
    }

    // 2. Xóa âm thanh
    if (OPTION_REMOVE_AUDIO) {
      command.noAudio();
    }

    // 3. Convert 720p
    if (OPTION_CONVERT_720) {
      // scale=-2:720 nghĩa là: Chiều cao set cứng 720, chiều rộng tự tính theo tỷ lệ (phải chia hết cho 2 để tránh lỗi)
      command.videoFilters('scale=-2:720');
    }

    command
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

/* =========================
   FETCH & DOWNLOAD
========================= */
async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  let lastError;
  const finalOptions = { ...options, headers: { "User-Agent": USER_AGENT, ...options.headers } };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, finalOptions);
      if (res.ok) return res;
      
      if ([403, 429, 500, 502, 503, 504].includes(res.status)) {
        let wait = res.headers.get("retry-after") ? Number(res.headers.get("retry-after")) * 1000 : Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
        wait *= 0.85 + Math.random() * 0.3;
        console.log(`  !! HTTP ${res.status}, retry in ${(wait/1000).toFixed(1)}s`);
        await sleep(wait);
        continue;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
      const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
      console.log(`  !! Network error (${e.message}), retry in ${(wait/1000).toFixed(1)}s`);
      await sleep(wait);
    }
  }
  throw lastError;
}

// Hàm này chỉ tải file raw về temp
async function downloadRawFile(url, tempPath) {
  fs.mkdirSync(path.dirname(tempPath), { recursive: true });

  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      const res = await fetchWithRetry(url);
      const file = fs.createWriteStream(tempPath);
      const nodeStream = Readable.fromWeb(res.body);

      await new Promise((resolve, reject) => {
        nodeStream.pipe(file);
        nodeStream.on("error", reject);
        file.on("error", reject);
        file.on("finish", resolve);
      });
      return;
    } catch (e) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** i);
      console.log(`  !! DL Error (${e.message}), retry ${(wait/1000).toFixed(1)}s`);
      await sleep(wait);
    }
  }
  throw new Error("Download failed");
}

/* =========================
   API SEARCH
========================= */
async function pexelsSearch(query, page, perPage, orientation) {
  const url = new URL("https://api.pexels.com/videos/search");
  const params = { query, page, per_page: perPage };
  if (orientation) params.orientation = orientation; 
  url.search = new URLSearchParams(params);
  const res = await fetchWithRetry(url, { headers: { Authorization: PEXELS_API_KEY } });
  return res.json();
}

function pickBestPexels(video) {
  const files = video.video_files || [];
  const preferred = files.filter(f => f.quality === "hd");
  const list = preferred.length ? preferred : files;
  return list.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
}

async function pixabaySearch(query, page, perPage, orientation) {
  const url = new URL("https://pixabay.com/api/videos/");
  let pixOrientation = orientation === "landscape" ? "horizontal" : (orientation === "portrait" ? "vertical" : "all");
  url.search = new URLSearchParams({
    key: PIXABAY_KEY, q: query, page, per_page: perPage, orientation: pixOrientation, video_type: "all"
  });
  const res = await fetchWithRetry(url);
  const data = await res.json();
  if (!data.hits?.length) console.log(`[WARN] Pixabay: 0 results for "${query}" (Page ${page})`);
  return data;
}

function pickBestPixabay(video) {
  if (!video?.videos) return null;
  const v = video.videos;
  return v.large || v.medium || v.small || v.tiny;
}

/* =========================
   MAIN CORE
========================= */
async function processAndSaveVideo(url, finalPath) {
  // Nếu file cuối cùng đã tồn tại thì bỏ qua
  if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 0) return;

  const folder = path.dirname(finalPath);
  const filename = path.basename(finalPath);
  const tempPath = path.join(folder, `temp_${filename}`);

  try {
    // B1: Tải file gốc về file tạm
    // console.log(`    Downloading raw...`);
    await downloadRawFile(url, tempPath);

    // B2: Nếu có option xử lý thì chạy qua FFmpeg
    if (NEEDS_PROCESSING) {
      console.log(`    Processing: 720p=${OPTION_CONVERT_720}, NoAudio=${OPTION_REMOVE_AUDIO}, Trim=${OPTION_TRIM_SECONDS}s`);
      await processVideo(tempPath, finalPath);
      
      // Xóa file tạm sau khi xử lý xong
      fs.unlinkSync(tempPath);
    } else {
      // Nếu không cần xử lý gì thì đổi tên file tạm thành file chính
      fs.renameSync(tempPath, finalPath);
    }
  } catch (err) {
    console.error(`    FAILED: ${err.message}`);
    // Dọn dẹp nếu lỗi
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
  }
}

async function bulkDownloadUnlimited({ query, perPage = 20, orientation = "landscape", maxVideos = Infinity }) {
  ensureKeys();
  const baseDir = path.join(DEFAULT_OUT_DIR, safeFilename(query));
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

  let seen = new Set();
  let pexPage = 1, pixPage = 1;
  let pexDone = false, pixDone = false;
  let index = 1, downloaded = 0;

  console.log(`\n>>> STARTING: "${query}" (Target: ${maxVideos} videos)`);

  while (true) {
    let progressed = false;

    // --- PEXELS ---
    if (USE_PEXELS && !pexDone && downloaded < maxVideos) {
      try {
        const data = await pexelsSearch(query, pexPage, perPage, orientation);
        const videos = data.videos || [];
        if (!videos.length) { pexDone = true; console.log("[PEXELS] Exhausted."); }
        else {
          progressed = true;
          for (const v of videos) {
            if (downloaded >= maxVideos) break;
            const best = pickBestPexels(v);
            if (!best) continue;

            const key = `pexels_${v.id}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const filename = `pex_${String(index++).padStart(6, "0")}.mp4`;
            const outPath = path.join(baseDir, filename);

            console.log(`[PEXELS] ${filename} (ID: ${v.id})`);
            await processAndSaveVideo(best.link, outPath);

            downloaded++;
            await sleep(BASE_SLEEP_MS);
          }
          pexPage++;
        }
      } catch (e) { console.error(`[PEXELS] Error: ${e.message}`); pexDone = true; }
    }

    // --- PIXABAY ---
    if (USE_PIXABAY && !pixDone && downloaded < maxVideos) {
      try {
        const data = await pixabaySearch(query, pixPage, perPage, orientation);
        const hits = data.hits || [];
        if (!hits.length) { pixDone = true; console.log("[PIXABAY] Exhausted."); }
        else {
          progressed = true;
          for (const h of hits) {
            if (downloaded >= maxVideos) break;
            const best = pickBestPixabay(h);
            if (!best) continue;

            const key = `pixabay_${h.id}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const filename = `pix_${String(index++).padStart(6, "0")}.mp4`;
            const outPath = path.join(baseDir, filename);

            console.log(`[PIXABAY] ${filename} (ID: ${h.id})`);
            await processAndSaveVideo(best.url, outPath);

            downloaded++;
            await sleep(BASE_SLEEP_MS);
          }
          pixPage++;
        }
      } catch (e) { console.error(`[PIXABAY] Error: ${e.message}`); pixDone = true; }
    }

    if (downloaded >= maxVideos || (pexDone && pixDone)) break;
    if (!progressed) await sleep(2000);
  }
  console.log(`DONE: "${query}" - ${downloaded} videos.`);
}

/* =========================
   RUN
========================= */
(async () => {
  console.log("==========================================");
  console.log(`TOOL DL + PROCESSING (720p: ${OPTION_CONVERT_720}, NoAudio: ${OPTION_REMOVE_AUDIO}, Trim: ${OPTION_TRIM_SECONDS}s)`);
  console.log(`Sources: Pexels=${USE_PEXELS}, Pixabay=${USE_PIXABAY}`);
  console.log("==========================================");

  const queryFromEnv = process.env.STOCK_QUERY;
  if (queryFromEnv && queryFromEnv.trim()) {
    await bulkDownloadUnlimited({
      query: queryFromEnv.trim(),
      perPage: 20,
      orientation: TARGET_ORIENTATION,
      maxVideos: MAX_VIDEOS_PER_QUERY,
    });
    console.log("\nALL TASKS COMPLETED.");
    return;
  }

  for (const q of SEARCH_QUERIES) {
    await bulkDownloadUnlimited({ query: q, perPage: 20, orientation: TARGET_ORIENTATION, maxVideos: MAX_VIDEOS_PER_QUERY });
  }
  console.log("\nALL TASKS COMPLETED.");
})();