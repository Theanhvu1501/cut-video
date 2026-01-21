import fs from "fs";
import { google } from "googleapis";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";

// __dirname trong ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// API key
const apiKey = "AIzaSyDZTsPGvG0u5du3t7YGueGgnNi7IiulMus";
const minSeconds = 60 * 10; // chỉ lấy video >10 phút

// Đường dẫn output mặc định
let outputBaseFolder = "./channels";

// Đọc config từ project JSON (mặc định là "default")
const projectName = process.env.PROJECT_NAME || "default";
const projectsDir = process.env.PROJECTS_DIR || path.join(__dirname, "projects");
const projectConfigPath = path.join(projectsDir, `${projectName}.json`);

if (fs.existsSync(projectConfigPath)) {
  try {
    const projectContent = fs.readFileSync(projectConfigPath, "utf-8");
    const projectData = JSON.parse(projectContent);
    const config = projectData.settings?.getUrl;

    if (config) {
      if (config.outputFolder) outputBaseFolder = config.outputFolder;

      console.log(`Đã đọc config từ project: ${projectName}`);
    }
  } catch (error) {
    console.error(`Lỗi khi đọc project config: ${error.message}`);
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
  const directoryPath = path.join(outputBaseFolder, handle.replace(/^@/, ""));
  if (!fs.existsSync(directoryPath))
    fs.mkdirSync(directoryPath, { recursive: true });

  const filePath = path.join(directoryPath, "youtube.xlsx");
  const videosData = [];

  do {
    const playlistItemsResponse = await youtube.playlistItems.list({
      part: ["snippet"],
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken: nextPageToken || undefined,
    });

    const videoIds = playlistItemsResponse.data.items.map(
      (item) => item.snippet.resourceId.videoId,
    );

    if (videoIds.length > 0) {
      const videosResponse = await youtube.videos.list({
        part: ["contentDetails", "statistics", "snippet"],
        id: videoIds,
      });

      for (const video of videosResponse.data.items) {
        const durationSec = parseDuration(video.contentDetails.duration);
        const viewCount = Number(video.statistics?.viewCount || 0);
        const vid = video.id;
        const title = video.snippet?.title || "";
        const publishedAt = video.snippet?.publishedAt || "";

        if (durationSec > minSeconds) {
          videosData.push({
            id: vid,
            viewCount,
            url: `https://www.youtube.com/watch?v=${vid}`,
            title: title,
            publishedAt: publishedAt,
          });
        }
      }
    }

    nextPageToken = playlistItemsResponse.data.nextPageToken;
  } while (nextPageToken);

  // === B3: Sắp xếp theo lượt view giảm dần ===
  // videosData.sort((a, b) => b.viewCount - a.viewCount);

  // === B4: Ghi file Excel với các cột: url, title, viewCount, date publish ===
  if (videosData.length > 0) {
    // Chuẩn bị dữ liệu cho Excel
    const excelData = videosData.map((v) => {
      // Format ngày tháng
      let datePublish = "";
      if (v.publishedAt) {
        const date = new Date(v.publishedAt);
        datePublish = date.toLocaleDateString("vi-VN", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
      }

      return {
        URL: v.url,
        Title: v.title,
        ViewCount: v.viewCount,
        "Date Publish": datePublish,
      };
    });

    // Tạo workbook và worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    // Đặt độ rộng cột
    ws["!cols"] = [
      { wch: 50 }, // URL
      { wch: 60 }, // Title
      { wch: 15 }, // ViewCount
      { wch: 20 }, // Date Publish
    ];

    // Thêm worksheet vào workbook
    XLSX.utils.book_append_sheet(wb, ws, "Videos");

    // Ghi file Excel
    XLSX.writeFile(wb, filePath);

    console.log(
      `\n✅ Hoàn thành! Đã lưu ${videosData.length} video vào file Excel: ${filePath}`,
    );
  } else {
    console.log(`\n⚠️ Không có video nào thỏa mãn điều kiện (>${minSeconds}s)`);
  }
}

// === MAIN ===
const handle = process.argv[2];
if (!handle) {
  console.error("Vui lòng nhập tên channel handle, ví dụ:");
  console.error("   node index.js @GoogleDevelopers");
  process.exit(1);
}

getVideoUrls(handle).catch(console.error);
