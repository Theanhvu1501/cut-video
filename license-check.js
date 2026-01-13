import axios from "axios";

import machineId from "node-machine-id";

const { machineIdSync } = machineId;

// Cấu hình server URL - thay đổi URL này theo server của bạn

const LICENSE_SERVER_URL = "http://103.218.122.151:3456/api/check-license";
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
        return {
          registered: true,
          machineId: id,
        };
      } else {
        return {
          registered: false,
          machineId: id,
        };
      }
    } catch (error) {
      // Nếu server không phản hồi hoặc lỗi, coi như chưa đăng ký
      // Bạn có thể thay đổi logic này nếu muốn
      console.error("Error checking license:", error.message);

      // Nếu lỗi network, vẫn trả về để hiển thị popup
      if (
        error.code === "ECONNREFUSED" ||
        error.code === "ETIMEDOUT" ||
        error.message.includes("Network Error")
      ) {
        return {
          registered: false,
          machineId: id,
          error:
            "Không thể kết nối đến server. Vui lòng kiểm tra kết nối mạng.",
        };
      }

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
