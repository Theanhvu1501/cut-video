import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Lấy đường dẫn thư mục hiện tại
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình
const CONFIG = {
  currentDayFile: path.join(__dirname, "currentDay.txt"),
  renderScript: path.join(__dirname, "render.js"),
  videosPerFolder: 2, // Số video mỗi folder, thay đổi theo nhu cầu
  logFile: path.join(__dirname, "schedule.log"),
};

// Hàm ghi log
const log = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  console.log(message);

  // Ghi log vào file
  fs.appendFileSync(CONFIG.logFile, logMessage);
};

// Hàm đọc currentDay từ file
const readCurrentDay = () => {
  try {
    if (!fs.existsSync(CONFIG.currentDayFile)) {
      log(
        `⚠️ Không tìm thấy file ${CONFIG.currentDayFile}, sử dụng giá trị mặc định là 1`
      );
      return 1;
    }

    const content = fs.readFileSync(CONFIG.currentDayFile, "utf-8").trim();
    const currentDay = parseInt(content, 10);

    if (isNaN(currentDay) || currentDay <= 0) {
      log(
        `⚠️ Giá trị không hợp lệ trong file ${CONFIG.currentDayFile}, sử dụng giá trị mặc định là 1`
      );
      return 1;
    }

    return currentDay + 1;
  } catch (error) {
    log(`❌ Lỗi khi đọc file ${CONFIG.currentDayFile}: ${error.message}`);
    return 1;
  }
};

// Hàm chạy render.js
const runRenderScript = (currentDay, videosPerFolder) => {
  return new Promise((resolve, reject) => {
    log(
      `🚀 Bắt đầu chạy render.js với currentDay=${currentDay}, videosPerFolder=${videosPerFolder}`
    );

    const child = spawn(
      "node",
      [CONFIG.renderScript, currentDay.toString(), videosPerFolder.toString()],
      {
        stdio: "inherit",
      }
    );

    child.on("close", (code) => {
      if (code === 0) {
        log(`✅ Render.js đã hoàn thành với mã thoát ${code}`);
        resolve();
      } else {
        log(`⚠️ Render.js đã kết thúc với mã thoát ${code}`);
        reject(new Error(`Render.js exited with code ${code}`));
      }
    });

    child.on("error", (error) => {
      log(`❌ Lỗi khi chạy render.js: ${error.message}`);
      reject(error);
    });
  });
};

// Hàm chính
const main = async () => {
  try {
    log("🔄 Bắt đầu quy trình tự động render video");

    // Đọc currentDay từ file
    const currentDay = readCurrentDay();
    log(`📅 Ngày hiện tại: ${currentDay}`);

    // Chạy render.js
    await runRenderScript(currentDay, CONFIG.videosPerFolder);

    log("✅ Hoàn thành quy trình tự động render video");
  } catch (error) {
    log(`❌ Lỗi trong quy trình tự động: ${error.message}`);
    process.exit(1);
  } finally {
    log(`================================================================`);
  }
};

// Chạy chương trình
main();
