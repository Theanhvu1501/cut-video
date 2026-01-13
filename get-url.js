import fs from "fs";
import { google } from "googleapis";
import path from "path";
import { fileURLToPath } from "url";

// __dirname trong ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// API key
const apiKey = "AIzaSyDZTsPGvG0u5du3t7YGueGgnNi7IiulMus";
const minSeconds = 60 * 10; // chỉ lấy video >10 phút

// Đường dẫn output mặc định
let outputBaseFolder = "./channels";

// Đọc config từ file nếu có
// Kiểm tra CONFIG_DIR environment variable (được set bởi Electron main process)
// Nếu không có, dùng __dirname (cho development)
const configDir = process.env.CONFIG_DIR || __dirname;
const configFilePath = path.join(configDir, ".get-url-config.json");
if (fs.existsSync(configFilePath)) {
  try {
    const configContent = fs.readFileSync(configFilePath, "utf-8");
    const config = JSON.parse(configContent);

    if (config.outputBaseFolder) outputBaseFolder = config.outputBaseFolder;

    console.log(`Đã đọc config từ file: ${configFilePath}`);
  } catch (error) {
    console.error(`Lỗi khi đọc config file: ${error.message}`);
  }
}

// Hàm parse thời lượng ISO 8601 -> giây
function parseDuration(duration) {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  const hours = parseInt(match?.[1] || "0", 10);
  const minutes = parseInt(match?.[2] || "0", 10);
  const seconds = parseInt(match?.[3] || "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}

async function getVideoUrls(handle) {
  const youtube = google.youtube({
    version: "v3",
    auth: apiKey,
  });

  // === B1: Lấy channel ID từ handle ===
  const channelsResponse = await youtube.channels.list({
    part: ["id", "contentDetails"],
    forHandle: handle.trim(),
  });

  if (!channelsResponse.data.items?.length) {
    console.log(`Không tìm thấy channel cho handle: ${handle}`);
    return;
  }

  const channel = channelsResponse.data.items[0];
  const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;

  console.log(`Channel ID: ${channel.id}`);
  console.log(`Uploads Playlist ID: ${uploadsPlaylistId}`);
  console.log("Đang lấy dữ liệu video...");

  // === B2: Lấy tất cả video từ playlist uploads ===
  let nextPageToken = "";
  const directoryPath = path.join(
    outputBaseFolder,
    handle.replace(/^@/, "")
  );
  if (!fs.existsSync(directoryPath))
    fs.mkdirSync(directoryPath, { recursive: true });

  const filePath = path.join(directoryPath, "youtube.txt");
  const videosData = [];

  do {
    const playlistItemsResponse = await youtube.playlistItems.list({
      part: ["snippet"],
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken: nextPageToken || undefined,
    });

    const videoIds = playlistItemsResponse.data.items.map(
      (item) => item.snippet.resourceId.videoId
    );

    if (videoIds.length > 0) {
      const videosResponse = await youtube.videos.list({
        part: ["contentDetails", "statistics"],
        id: videoIds,
      });

      for (const video of videosResponse.data.items) {
        const durationSec = parseDuration(video.contentDetails.duration);
        const viewCount = Number(video.statistics?.viewCount || 0);
        const vid = video.id;

        if (durationSec > minSeconds) {
          videosData.push({
            id: vid,
            viewCount,
            url: `https://www.youtube.com/watch?v=${vid}`,
          });
        }
      }
    }

    nextPageToken = playlistItemsResponse.data.nextPageToken;
  } while (nextPageToken);

  // === B3: Sắp xếp theo lượt view giảm dần ===
  // videosData.sort((a, b) => b.viewCount - a.viewCount);

  // === B4: Ghi file chỉ gồm URL + view count ===
  fs.writeFileSync(
    filePath,
    videosData.map((v) => `${v.url}`).join("\n"),
    "utf8"
  );

  console.log(`\n✅ Hoàn thành! Đã lưu file: ${filePath}`);
}

// === MAIN ===
const handle = process.argv[2];
if (!handle) {
  console.error("Vui lòng nhập tên channel handle, ví dụ:");
  console.error("   node index.js @GoogleDevelopers");
  process.exit(1);
}

getVideoUrls(handle).catch(console.error);
