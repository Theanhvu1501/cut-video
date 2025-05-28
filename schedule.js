import { spawn } from "child_process";
import { Client, EmbedBuilder, GatewayIntentBits } from "discord.js";
import fs from "fs";
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
  discord: {
    token: "token", // Thay thế bằng token của bot Discord của bạn
    channelId: "chat_id", // Thay thế bằng ID kênh Discord
    enabled: true, // Bật/tắt tính năng gửi tin nhắn Discord
  },
};

// Khởi tạo bot Discord nếu được bật
let discordClient = null;
if (CONFIG.discord.enabled && CONFIG.discord.token) {
  try {
    discordClient = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });

    discordClient.login(CONFIG.discord.token);

    discordClient.on("ready", () => {
      log(`✅ Discord Bot đã sẵn sàng với tên ${discordClient.user.tag}`);
    });
  } catch (error) {
    console.error(`Lỗi khởi tạo Discord Bot: ${error.message}`);
  }
}

// Hàm gửi tin nhắn qua Discord
const sendDiscordMessage = async (message) => {
  if (!discordClient || !CONFIG.discord.enabled) return;

  try {
    // Kiểm tra xem bot đã sẵn sàng chưa
    if (!discordClient.isReady()) {
      log(`⚠️ Discord Bot chưa sẵn sàng, đang chờ kết nối...`);
      // Đợi bot sẵn sàng
      await new Promise((resolve) => {
        const checkReady = () => {
          if (discordClient.isReady()) {
            resolve();
          } else {
            setTimeout(checkReady, 1000);
          }
        };
        checkReady();
      });
    }

    log(`🔍 Đang tìm kênh Discord với ID: ${CONFIG.discord.channelId}`);

    // Liệt kê các kênh mà bot có thể truy cập
    const availableChannels = discordClient.channels.cache.map(
      (channel) => `${channel.name} (${channel.id})`
    );
    log(
      `📋 Các kênh có sẵn: ${
        availableChannels.join(", ") || "Không có kênh nào"
      }`
    );

    // Thử lấy kênh từ cache trước
    let channel = discordClient.channels.cache.get(CONFIG.discord.channelId);

    // Nếu không có trong cache, thử fetch
    if (!channel) {
      try {
        channel = await discordClient.channels.fetch(CONFIG.discord.channelId);
        log(`✅ Đã fetch được kênh: ${channel.name}`);
      } catch (fetchError) {
        log(`❌ Không thể fetch kênh: ${fetchError.message}`);
        throw new Error(
          `Không tìm thấy kênh với ID: ${CONFIG.discord.channelId}. Lỗi: ${fetchError.message}`
        );
      }
    }

    if (!channel) {
      throw new Error(
        `Không tìm thấy kênh với ID: ${CONFIG.discord.channelId}`
      );
    }

    // Kiểm tra quyền gửi tin nhắn
    if (!channel.permissionsFor(discordClient.user).has("SendMessages")) {
      throw new Error(
        `Bot không có quyền gửi tin nhắn trong kênh ${channel.name}`
      );
    }

    // Tạo embed message
    const embed = new EmbedBuilder()
      .setColor(
        message.includes("CẢNH BÁO")
          ? 0xffa500
          : message.includes("LỖI")
          ? 0xff0000
          : 0x00ff00
      )
      .setTitle(
        message.includes("CẢNH BÁO")
          ? "⚠️ CẢNH BÁO"
          : message.includes("LỖI")
          ? "❌ LỖI"
          : "✅ THÀNH CÔNG"
      )
      .setDescription(message.replace(/<b>|<\/b>/g, ""))
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    log(`✅ Đã gửi tin nhắn Discord đến kênh ${channel.name}`);
  } catch (error) {
    log(`❌ Lỗi khi gửi tin nhắn Discord: ${error.message}`);

    // Thêm thông tin debug
    if (discordClient) {
      log(
        `🤖 Bot đang đăng nhập với tên: ${
          discordClient.user?.tag || "Chưa đăng nhập"
        }`
      );
      log(
        `🔌 Trạng thái kết nối: ${
          discordClient.isReady() ? "Đã sẵn sàng" : "Chưa sẵn sàng"
        }`
      );

      const guilds = discordClient.guilds.cache.map(
        (g) => `${g.name} (${g.id})`
      );
      log(
        `🏠 Các server bot đang tham gia: ${
          guilds.join(", ") || "Không có server nào"
        }`
      );
    }
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
      const warningMessage = `⚠️ <b>CẢNH BÁO</b>: Chỉ còn ${remainingDays} ngày nữa là hết videos!\nNgày hiện tại: ${currentDay}/${totalBackgrounds}`;
      await sendDiscordMessage(warningMessage);
    }

    // Kiểm tra nếu đã hết ngày
    if (remainingDays < 0) {
      const errorMessage = `❌ <b>LỖI</b>: Đã hết video! Không thể tiếp tục render.\nNgày hiện tại: ${currentDay}/${totalBackgrounds}`;
      log(errorMessage);
      await sendDiscordMessage(errorMessage);
      return;
    }

    // Chạy render.js
    await runRenderScript(currentDay, CONFIG.videosPerFolder);

    // Gửi thông báo thành công
    const successMessage = `✅ <b>THÀNH CÔNG</b>: Đã render video cho ngày ${currentDay}/${totalBackgrounds}.\nCòn lại: ${remainingDays} ngày`;
    log(successMessage);
    await sendDiscordMessage(successMessage);

    log("✅ Hoàn thành quy trình tự động render video");
  } catch (error) {
    const errorMessage = `❌ <b>LỖI</b>: ${error.message}`;
    log(`❌ Lỗi trong quy trình tự động: ${error.message}`);
    await sendDiscordMessage(errorMessage);
    process.exit(1);
  } finally {
    log(`================================================================`);
  }
};

// Chạy chương trình
main();
