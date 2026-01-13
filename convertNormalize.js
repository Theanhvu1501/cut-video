import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let rootFolder = "./thumbs"; // 📝 Thay bằng thư mục gốc của bạn

// Đọc config từ file nếu có
// Kiểm tra CONFIG_DIR environment variable (được set bởi Electron main process)
// Nếu không có, dùng __dirname (cho development)
const configDir = process.env.CONFIG_DIR || __dirname;
const configFilePath = path.join(configDir, ".normalize-config.json");
if (fs.existsSync(configFilePath)) {
  try {
    const configContent = fs.readFileSync(configFilePath, "utf-8");
    const config = JSON.parse(configContent);

    if (config.rootFolder) rootFolder = config.rootFolder;

    console.log(`Đã đọc config từ file: ${configFilePath}`);
  } catch (error) {
    console.error(`Lỗi khi đọc config file: ${error.message}`);
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
