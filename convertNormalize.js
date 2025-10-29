import fs from "fs";
import path from "path";

const rootFolder = "./thumbs"; // 📝 Thay bằng thư mục gốc của bạn

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
