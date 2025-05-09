import { spawn } from "child_process";
import fs from "fs";
import TelegramBot from "node-telegram-bot-api";
import path from "path";
import { fileURLToPath } from "url";

// Lấy đường dẫn thư mục hiện tại
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình
const CONFIG = {
  backgroundFolder: "./backgrounds", // Thư mục chứa các thư mục nền (folder_1, folder_2, ...)
  imageBackgroundFolder: "./image_backgrounds", // Thư mục chứa các hình ảnh làm nền
  outputFolder: "./done", // Thư mục xuất file
  currentDayFile: path.join(__dirname, "currentDay.txt"),
  renderScript: path.join(__dirname, "render.js"),
  videosPerFolder: 2, // Số video mỗi folder, thay đổi theo nhu cầu
  logFile: path.join(__dirname, "schedule.log"),
  telegram: {
    token: "6371688043:AAF8zyBpv-EP70012a8YuPU7lpL3ppoVfKM", // Thay thế bằng token của bot Telegram của bạn
    chatId: "-4242127506", // Thay thế bằng chat ID của bạn hoặc nhóm
    enabled: true, // Bật/tắt tính năng gửi tin nhắn Telegram
  },
};

// Khởi tạo bot Telegram nếu được bật
let bot = null;
if (
  CONFIG.telegram.enabled &&
  CONFIG.telegram.token &&
  CONFIG.telegram.chatId
) {
  try {
    bot = new TelegramBot(CONFIG.telegram.token, { polling: false });
  } catch (error) {
    console.error(`Lỗi khởi tạo Telegram Bot: ${error.message}`);
  }
}

// Hàm gửi tin nhắn qua Telegram
const sendTelegramMessage = async (message) => {
  if (!bot || !CONFIG.telegram.enabled) return;

  try {
    await bot.sendMessage(CONFIG.telegram.chatId, message, {
      parse_mode: "HTML",
    });
    console.log("✅ Đã gửi tin nhắn Telegram");
  } catch (error) {
    console.error(`❌ Lỗi khi gửi tin nhắn Telegram: ${error.message}`);
  }
};

// Đọc danh sách thư mục con trong backgrounds và image_backgrounds
const backgroundFolders = fs.existsSync(CONFIG.backgroundFolder)
  ? fs
      .readdirSync(CONFIG.backgroundFolder)
      .filter((folder) =>
        fs.lstatSync(path.join(CONFIG.backgroundFolder, folder)).isDirectory()
      )
  : [];

const imageBackgroundFolders = fs.existsSync(CONFIG.imageBackgroundFolder)
  ? fs
      .readdirSync(CONFIG.imageBackgroundFolder)
      .filter((folder) =>
        fs
          .lstatSync(path.join(CONFIG.imageBackgroundFolder, folder))
          .isDirectory()
      )
  : [];

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

// Hàm kiểm tra số ngày còn lại
const checkRemainingDays = (currentDay) => {
  // Đếm số thư mục con trong image_backgrounds hoặc backgrounds
  const useImageBackground = imageBackgroundFolders.length > 0;
  const totalBackgrounds = useImageBackground
    ? imageBackgroundFolders.length
    : backgroundFolders.length;

  const remainingDays = totalBackgrounds - currentDay;

  log(
    `📊 Tổng số channel: ${totalBackgrounds}, Ngày hiện tại: ${currentDay}, Còn lại: ${remainingDays} ngày`
  );

  return {
    useImageBackground,
    totalBackgrounds,
    remainingDays,
  };
};

// Hàm chính
const main = async () => {
  try {
    log("🔄 Bắt đầu quy trình tự động render video");

    // Đọc currentDay từ file
    const currentDay = readCurrentDay();
    log(`📅 Ngày hiện tại: ${currentDay}`);

    // Kiểm tra số ngày còn lại
    const { totalBackgrounds, remainingDays } = checkRemainingDays(currentDay);

    // Gửi cảnh báo nếu sắp hết ngày
    if (remainingDays <= 2 && remainingDays >= 0) {
      const warningMessage = `⚠️ <b>CẢNH BÁO</b>: Chỉ còn ${remainingDays} ngày nữa là hết background!\nNgày hiện tại: ${currentDay}/${totalBackgrounds}`;
      await sendTelegramMessage(warningMessage);
    }

    // Kiểm tra nếu đã hết ngày
    if (remainingDays < 0) {
      const errorMessage = `❌ <b>LỖI</b>: Đã hết video! Không thể tiếp tục render.\nNgày hiện tại: ${currentDay}/${totalBackgrounds}`;
      log(errorMessage);
      await sendTelegramMessage(errorMessage);
      return;
    }

    // Chạy render.js
    await runRenderScript(currentDay, CONFIG.videosPerFolder);

    // Gửi thông báo thành công
    const successMessage = `✅ <b>THÀNH CÔNG</b>: Đã render video cho ngày ${currentDay}/${totalBackgrounds}.\nCòn lại: ${remainingDays} ngày`;
    log(successMessage);
    await sendTelegramMessage(successMessage);

    log("✅ Hoàn thành quy trình tự động render video");
  } catch (error) {
    const errorMessage = `❌ <b>LỖI</b>: ${error.message}`;
    log(`❌ Lỗi trong quy trình tự động: ${error.message}`);
    await sendTelegramMessage(errorMessage);
    process.exit(1);
  } finally {
    log(`================================================================`);
  }
};

// Chạy chương trình
main();
