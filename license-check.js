import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import machineId from "node-machine-id";

const { machineIdSync } = machineId;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình server URL - thay đổi URL này theo server của bạn
const LICENSE_SERVER_URL = "http://103.162.21.31:3456/api/check-license";

// Grace period cho phép offline (7 ngày = 7 * 24 * 60 * 60 * 1000 ms)
const OFFLINE_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

// Đường dẫn file cache license
function getLicenseCachePath() {
  const userDataPath = process.env.APPDATA || 
    (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
  const appDataPath = path.join(userDataPath, 'VidMaster');
  if (!fs.existsSync(appDataPath)) {
    fs.mkdirSync(appDataPath, { recursive: true });
  }
  return path.join(appDataPath, '.license-cache.json');
}

// Lưu license status vào cache
function saveLicenseCache(registered, machineId) {
  try {
    const cachePath = getLicenseCachePath();
    const cacheData = {
      registered,
      machineId,
      timestamp: Date.now(),
    };
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));
  } catch (error) {
    console.error("Error saving license cache:", error);
  }
}

// Đọc license status từ cache
function loadLicenseCache() {
  try {
    const cachePath = getLicenseCachePath();
    if (fs.existsSync(cachePath)) {
      const cacheContent = fs.readFileSync(cachePath, "utf-8");
      const cacheData = JSON.parse(cacheContent);
      return cacheData;
    }
  } catch (error) {
    console.error("Error loading license cache:", error);
  }
  return null;
}

// Kiểm tra xem cache có còn hợp lệ không (trong grace period)
function isCacheValid(cacheData) {
  if (!cacheData || !cacheData.registered) {
    return false;
  }
  const cacheAge = Date.now() - cacheData.timestamp;
  return cacheAge < OFFLINE_GRACE_PERIOD_MS;
}
/**
 * Kiểm tra license của máy
 * @returns {Promise<{registered: boolean, machineId: string, error?: string}>}
 */
export async function checkLicense() {
  try {
    // Lấy machineId
    const id = machineIdSync({ original: true });

    // Gửi request lên server để check
    try {
      const response = await axios.post(
        LICENSE_SERVER_URL,
        {
          machineId: id,
        },
        {
          timeout: 10000, // 10 seconds timeout
        }
      );

      // Server trả về { registered: true/false }
      if (response.data && response.data.registered === true) {
        // Lưu vào cache khi check thành công
        saveLicenseCache(true, id);
        return {
          registered: true,
          machineId: id,
        };
      } else {
        // Server trả về registered: false - chắc chắn bị revoke
        saveLicenseCache(false, id);
        return {
          registered: false,
          machineId: id,
          error: "License của bạn đã bị admin khóa hoặc thu hồi.",
        };
      }
    } catch (error) {
      // Nếu lỗi network, kiểm tra cache
      const isNetworkError =
        error.code === "ECONNREFUSED" ||
        error.code === "ETIMEDOUT" ||
        error.code === "ENOTFOUND" ||
        error.code === "ECONNRESET" ||
        error.message.includes("Network Error") ||
        error.message.includes("timeout");

      if (isNetworkError) {
        console.warn("⚠️ Lỗi kết nối mạng, kiểm tra cache license...");
        const cacheData = loadLicenseCache();

        // Nếu có cache hợp lệ và machineId khớp, cho phép offline
        if (cacheData && cacheData.machineId === id && isCacheValid(cacheData)) {
          const cacheAgeDays = Math.floor(
            (Date.now() - cacheData.timestamp) / (24 * 60 * 60 * 1000)
          );
          console.log(
            `✅ Sử dụng license cache (còn ${OFFLINE_GRACE_PERIOD_MS / (24 * 60 * 60 * 1000) - cacheAgeDays} ngày offline)`
          );
          return {
            registered: true,
            machineId: id,
            fromCache: true,
            cacheAgeDays: cacheAgeDays,
          };
        } else {
          // Cache không hợp lệ hoặc hết hạn
          console.error("❌ Cache license không hợp lệ hoặc đã hết hạn");
          return {
            registered: false,
            machineId: id,
            error:
              "Không thể kết nối đến server và không có license cache hợp lệ. Vui lòng kiểm tra kết nối mạng.",
          };
        }
      }

      // Lỗi khác (không phải network)
      console.error("Error checking license:", error.message);
      return {
        registered: false,
        machineId: id,
        error: error.message,
      };
    }
  } catch (error) {
    console.error("Error getting machineId:", error);
    return {
      registered: false,
      machineId: null,
      error: "Không thể lấy Machine ID: " + error.message,
    };
  }
}

/**
 * Lấy machineId (đồng bộ)
 * @returns {string}
 */
export function getMachineId() {
  try {
    return machineIdSync({ original: true });
  } catch (error) {
    console.error("Error getting machineId:", error);
    return "ERROR";
  }
}
