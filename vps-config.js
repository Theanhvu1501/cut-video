import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Lấy đường dẫn thư mục hiện tại
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình
const CONFIG = {
  vpsListFile: path.join(__dirname, "vps.txt"),
  logFile: path.join(__dirname, "vps-config.log"),
  ftpUser: "administrator",
  ftpPassword: "Abcde12345-"
};

// Hàm ghi log
const log = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  console.log(message);

  // Ghi log vào file
  fs.appendFileSync(CONFIG.logFile, logMessage);
};

// Hàm đọc danh sách VPS từ file
const readVpsList = () => {
  try {
    if (!fs.existsSync(CONFIG.vpsListFile)) {
      log(`⚠️ Không tìm thấy file ${CONFIG.vpsListFile}`);
      return [];
    }

    const content = fs.readFileSync(CONFIG.vpsListFile, "utf-8");
    const vpsList = content
      .split("\n")
      .map(line => line.trim())
      .filter(line => line && !line.startsWith("#")); // Bỏ qua dòng trống và comment

    log(`📋 Đã đọc ${vpsList.length} VPS từ file ${CONFIG.vpsListFile}`);
    return vpsList;
  } catch (error) {
    log(`❌ Lỗi khi đọc file VPS: ${error.message}`);
    return [];
  }
};

// Hàm phân tích dòng VPS
const parseVpsLine = (line) => {
  const parts = line.split(":");
  if (parts.length !== 2) {
    throw new Error(`Định dạng không hợp lệ: ${line}. Định dạng đúng là "ip:name"`);
  }
  
  return {
    ip: parts[0].trim(),
    name: parts[1].trim()
  };
};

// Hàm chạy lệnh rclone config
const createRcloneConfig = (configName, host, user, pass) => {
  return new Promise((resolve, reject) => {
    // Tạo lệnh rclone config create
    const rcloneCmd = `rclone config create ${configName} ftp host ${host} user ${user} pass ${pass}`;
    
    log(`Đang chạy lệnh: ${rcloneCmd}`);
    
    // Chạy lệnh trong CMD
    const process = spawn("cmd.exe", ["/c", rcloneCmd], {
      stdio: "inherit", // Hiển thị output trực tiếp trong console
    });
    
    process.on("close", (code) => {
      if (code === 0) {
        log(`✅ Đã tạo cấu hình rclone thành công: ${configName} (${host})`);
        resolve();
      } else {
        log(`❌ Lỗi khi tạo cấu hình rclone cho ${configName}, mã thoát: ${code}`);
        reject(new Error(`Lệnh thoát với mã lỗi ${code}`));
      }
    });
    
    process.on("error", (error) => {
      log(`❌ Lỗi khi chạy lệnh: ${error.message}`);
      reject(error);
    });
  });
};

// Hàm chính
const main = async () => {
  log("=== Bắt đầu cấu hình rclone ===");
  
  try {
    // Đọc danh sách VPS
    const vpsList = readVpsList();
    
    if (vpsList.length === 0) {
      log("❌ Không có VPS nào để cấu hình");
      return;
    }
    
    // Xử lý từng VPS
    for (const vpsLine of vpsList) {
      try {
        const { ip, name } = parseVpsLine(vpsLine);
        log(`🔄 Đang cấu hình VPS: ${name} (${ip})`);
        
        // Tạo cấu hình FTP
        await createRcloneConfig(
          name,
          ip,
          CONFIG.ftpUser,
          CONFIG.ftpPassword
        );
      } catch (error) {
        log(`⚠️ Bỏ qua VPS "${vpsLine}": ${error.message}`);
      }
    }
    
    log("=== Hoàn thành cấu hình rclone ===");
  } catch (error) {
    log(`❌ Lỗi: ${error.message}`);
    process.exit(1);
  }
};

// Chạy chương trình
main();