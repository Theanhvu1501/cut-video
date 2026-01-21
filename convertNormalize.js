import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let rootFolder = "./thumbs"; // 📝 Thay bằng thư mục gốc của bạn

// Đọc config từ project JSON (mặc định là "default")
const projectName = process.env.PROJECT_NAME || "default";
const projectsDir = process.env.PROJECTS_DIR || path.join(__dirname, "projects");
const projectConfigPath = path.join(projectsDir, `${projectName}.json`);

if (fs.existsSync(projectConfigPath)) {
  try {
    const projectContent = fs.readFileSync(projectConfigPath, "utf-8");
    const projectData = JSON.parse(projectContent);
    const config = projectData.settings?.normalize;

    if (config) {
      if (config.inputFolder) rootFolder = config.inputFolder;

      console.log(`Đã đọc config từ project: ${projectName}`);
    }
  } catch (error) {
    console.error(`Lỗi khi đọc project config: ${error.message}`);
  }
}

function normalizeFilenamesRecursively(folderPath) {
  const items = fs.readdirSync(folderPath, { withFileTypes: true });

  for (const item of items) {
    const oldPath = path.join(folderPath, item.name);
    const normalizedName = item.name.normalize("NFC");
    const newPath = path.join(folderPath, normalizedName);

    // Nếu tên khác, tiến hành đổi tên
    if (oldPath !== newPath) {
      fs.renameSync(oldPath, newPath);
      console.log(`✅ Đã đổi tên: ${item.name} → ${normalizedName}`);
    }

    // Nếu là thư mục, gọi đệ quy
    if (item.isDirectory()) {
      normalizeFilenamesRecursively(newPath);
    }
  }
}

normalizeFilenamesRecursively(rootFolder);
