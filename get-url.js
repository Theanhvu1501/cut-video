import fs from "fs";
import { google } from "googleapis";
import path from "path";
import { fileURLToPath } from "url";

// __dirname trong ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Đọc API key
const apiKey = "AIzaSyDZTsPGvG0u5du3t7YGueGgnNi7IiulMus";
const minSeconds = 60 * 10; // 10p

// Hàm parse ISO 8601 -> giây
function parseDuration(duration) {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}

async function getVideoUrls(handle) {
  const youtube = google.youtube({
    version: "v3",
    auth: apiKey,
  });

  // B1: lấy channelId từ handle
  const channelsResponse = await youtube.channels.list({
    part: ["id", "contentDetails"],
    forHandle: handle.trim(),
  });

  if (
    !channelsResponse.data.items ||
    channelsResponse.data.items.length === 0
  ) {
    console.log(`Không tìm thấy channel cho handle: ${handle}`);
    return;
  }

  const channel = channelsResponse.data.items[0];
  const channelId = channel.id;
  const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;

  console.log(`Channel ID: ${channelId}`);
  console.log(`Uploads Playlist ID: ${uploadsPlaylistId}`);
  console.log("Đang lấy urls...");

  // B2: duyệt qua playlist uploads để lấy tất cả video
  let nextPageToken = "";
  const directoryPath = path.join(
    __dirname,
    "channels",
    handle.replace(/^@/, "")
  );
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }

  const filePath = path.join(directoryPath, "youtube.txt");
  fs.writeFileSync(filePath, "URL\tPublishedAt\tTitle\tDuration(s)\n"); // thêm header

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
        part: ["contentDetails", "snippet"],
        id: videoIds,
      });

      for (const video of videosResponse.data.items) {
        const durationSec = parseDuration(video.contentDetails.duration);
        if (durationSec > minSeconds) {
          // > 10 phút
          const vid = video.id;
          const videoUrl = `https://www.youtube.com/watch?v=${vid}`;
          fs.appendFileSync(filePath, `${videoUrl}\n`);
          console.log(videoUrl, `(${Math.round(durationSec / 60)} phút)`);
        }
      }
    }

    nextPageToken = playlistItemsResponse.data.nextPageToken;
  } while (nextPageToken);

  console.log(`\nHoàn thành! Đã lưu file: ${filePath}`);
}

// === MAIN ===
const handle = process.argv[2];
if (!handle) {
  console.error("Vui lòng nhập tên channel handle, ví dụ:");
  console.error("   node index.js @GoogleDevelopers");
  process.exit(1);
}

getVideoUrls(handle).catch(console.error);
