import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { createYoutubeClient, fetchSourceVideos, DEFAULT_YT_API_KEY } from "./sheet/youtube-api.js";

// __dirname trong ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const apiKey = process.env.YT_API_KEY || DEFAULT_YT_API_KEY;
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

async function getVideoUrls(handle) {
  const youtube = createYoutubeClient(apiKey);

  const directoryPath = path.join(outputBaseFolder, handle.replace(/^@/, ""));
  if (!fs.existsSync(directoryPath)) fs.mkdirSync(directoryPath, { recursive: true });
  const filePath = path.join(directoryPath, "youtube.xlsx");

  console.log("Đang lấy dữ liệu video...");
  const videosData = await fetchSourceVideos(youtube, handle, { minSeconds });

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
