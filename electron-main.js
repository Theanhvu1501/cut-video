import { spawn } from "child_process";
import { app, BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import fs from "fs";
import https from "https";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { checkLicense } from "./license-check.js";
import pLimit from "p-limit";
import sharp from "sharp";
import { createSheetRunner } from "./sheet/sheet-runner.js";
import { createSheetsClient, readConfigSheet, readConfigValues, parseConfigRows, findStatsColumns, STATS_KEYS, writeChannelStats, appendUrls, readChannelUrls, setUrlStatus, setUploadStatus, readUploadStatuses, testSheetConnection } from "./sheet/sheets-service.js";
import { createYoutubeClient, fetchChannelStats, fetchSourceVideos, pickNewUrls, DEFAULT_YT_API_KEY } from "./sheet/youtube-api.js";
import { parseScheduledISO, formatStamp } from "./sheet/schedule-slots.js";
import { testGpmConnection, connectAndOpenStudio } from "./sheet/gpm-client.js";
import { createUploadQueue } from "./sheet/upload-queue.js";
import { sendTelegram, buildDigest } from "./sheet/telegram-notify.js";
import { renderOne, resolveFfmpegPaths } from "./sheet/render-core.js";
import { detectChromaColor } from "./sheet/chroma-detect.js";
import { downloadOne } from "./sheet/channel-download.js";
import { loadState, saveState, todayStr, computeRemaining } from "./sheet/runner-state.js";
import { loadResume, saveResume } from "./sheet/resume-state.js";

const require = createRequire(import.meta.url);
const { autoUpdater } = require("electron-updater");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to get config directory (userData in production, __dirname in development)
function getConfigDir() {
  // In production (packaged), use userData directory
  // In development, use __dirname
  if (app.isPackaged) {
    return app.getPath("userData");
  } else {
    return __dirname;
  }
}

// Helper function to get app path (works in both dev and production)
function getAppPath() {
  if (app.isPackaged) {
    // In production, scripts are unpacked to app.asar.unpacked
    // process.resourcesPath points to the resources folder
    // Scripts will be in: resources/app.asar.unpacked/
    const resourcesPath = process.resourcesPath;
    const unpackedPath = path.join(resourcesPath, "app.asar.unpacked");

    // Check if unpacked directory exists (where scripts are unpacked)
    if (fs.existsSync(unpackedPath)) {
      return unpackedPath;
    }

    // Fallback: use resources path
    return resourcesPath;
  } else {
    return __dirname;
  }
}

let mainWindow;

// =================================================================
// AUTO UPDATER CONFIGURATION
// =================================================================

// Cấu hình auto-updater - GitHub Releases
autoUpdater.setFeedURL({
  provider: "github",
  owner: "Theanhvu1501",
  repo: "vid-master",
});

// Chỉ check update trong production (không check khi dev)
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// Flag để test auto-update trong dev mode (set = true để test)
const ENABLE_DEV_UPDATE_TEST = false; // ⚠️ CHỈ BẬT KHI CẦN TEST, NHỚ TẮT LẠI SAU!

// Override app.isPackaged để force test update trong dev mode
// CHỈ BẬT KHI ENABLE_DEV_UPDATE_TEST = true
if (ENABLE_DEV_UPDATE_TEST && !app.isPackaged) {
  console.log("🧪 [DEV MODE] Overriding app.isPackaged để test auto-update");
  Object.defineProperty(app, "isPackaged", {
    get: () => true,
    configurable: true,
  });

  // Force dev update config trong electron-updater (nếu có property này)
  try {
    if (
      autoUpdater &&
      typeof autoUpdater.forceDevUpdateConfig !== "undefined"
    ) {
      autoUpdater.forceDevUpdateConfig = true;
      console.log("🧪 [DEV MODE] Đã set forceDevUpdateConfig = true");
    }
  } catch (e) {
    // Property có thể không tồn tại, không sao
  }
}

// Log update events
autoUpdater.logger = {
  info: (message) => console.log(`[AutoUpdater] ${message}`),
  warn: (message) => console.warn(`[AutoUpdater] ${message}`),
  error: (message) => console.error(`[AutoUpdater] ${message}`),
};

// Các event handlers cho auto-updater
autoUpdater.on("checking-for-update", () => {
  console.log("🔍 [AutoUpdater] Đang kiểm tra cập nhật...");
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", {
      status: "checking",
      message: "Đang kiểm tra cập nhật...",
    });
  } else {
    console.warn("⚠️ [AutoUpdater] mainWindow chưa sẵn sàng để gửi message");
  }
});

autoUpdater.on("update-available", (info) => {
  console.log(`✅ [AutoUpdater] Có bản cập nhật mới: ${info.version}`);
  console.log(`📋 [AutoUpdater] Release notes:`, info.releaseNotes);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", {
      status: "available",
      message: `Có bản cập nhật mới: v${info.version}`,
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
    console.log(
      "✅ [AutoUpdater] Đã gửi update-status 'available' đến renderer"
    );
  } else {
    console.warn("⚠️ [AutoUpdater] mainWindow chưa sẵn sàng để gửi message");
  }
  // Không hiển thị dialog native, để renderer hiển thị custom dialog đẹp hơn
});

autoUpdater.on("update-not-available", (info) => {
  const currentVersion = app.getVersion();
  console.log(
    `✅ [AutoUpdater] Đã sử dụng phiên bản mới nhất: ${info?.version || "N/A"}`
  );
  console.log(`📌 [AutoUpdater] Phiên bản hiện tại của app: ${currentVersion}`);
  console.log(`📋 [AutoUpdater] Info object:`, JSON.stringify(info, null, 2));
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", {
      status: "not-available",
      message: "Đã sử dụng phiên bản mới nhất",
      version: info?.version || currentVersion,
    });
  }
});

autoUpdater.on("error", (error) => {
  console.error(`❌ [AutoUpdater] Lỗi kiểm tra cập nhật: ${error.message}`);
  console.error(`❌ [AutoUpdater] Error stack:`, error.stack);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", {
      status: "error",
      message: `Lỗi: ${error.message}`,
    });
  }
});

autoUpdater.on("download-progress", (progressObj) => {
  const percent = Math.round(progressObj.percent);
  console.log(`📥 Đang tải: ${percent}%`);
  if (mainWindow) {
    mainWindow.webContents.send("update-progress", {
      percent,
      transferred: progressObj.transferred,
      total: progressObj.total,
    });
  }
});

autoUpdater.on("update-downloaded", (info) => {
  console.log(`✅ Đã tải xong bản cập nhật: ${info.version}`);
  if (mainWindow) {
    // Lưu version để hiển thị thông báo sau khi update
    const configDir = getConfigDir();
    const updateVersionPath = path.join(
      configDir,
      ".last-updated-version.json"
    );
    try {
      fs.writeFileSync(
        updateVersionPath,
        JSON.stringify({
          version: info.version,
          updatedAt: new Date().toISOString(),
        }),
        "utf-8"
      );
    } catch (err) {
      console.error("Error saving update version:", err);
    }

    mainWindow.webContents.send("update-status", {
      status: "downloaded",
      message: `Đã tải xong v${info.version}. Ứng dụng sẽ khởi động lại để cài đặt.`,
      version: info.version,
    });
  }
  // Không hiển thị dialog native, để renderer hiển thị custom dialog đẹp hơn
});

// Hàm kiểm tra update (chỉ chạy trong production, hoặc dev nếu ENABLE_DEV_UPDATE_TEST = true)
// Chỉ chạy khi người dùng yêu cầu (manual update)
function checkForUpdates() {
  const shouldCheck = app.isPackaged || ENABLE_DEV_UPDATE_TEST;

  if (shouldCheck) {
    if (!app.isPackaged && ENABLE_DEV_UPDATE_TEST) {
      console.log("🧪 [DEV MODE] Auto-update testing được bật!");
    }
    const currentVersion = app.getVersion();
    console.log(
      `🚀 Đang kiểm tra cập nhật... (Phiên bản hiện tại: ${currentVersion})`
    );
    console.log(`📦 GitHub repo: Theanhvu1501/vid-master`);

    // Đảm bảo mainWindow sẵn sàng trước khi check
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.warn("⚠️ mainWindow chưa sẵn sàng, bỏ qua check update");
      return;
    }

    // Set timeout để detect nếu không có response
    let timeoutId = setTimeout(() => {
      console.warn(
        "⚠️ Timeout: Không nhận được phản hồi từ auto-updater sau 30 giây"
      );
      console.warn(
        "⚠️ Có thể do: GitHub không accessible, hoặc không có event được trigger"
      );
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-status", {
          status: "error",
          message:
            "Timeout: Không thể kiểm tra cập nhật. Vui lòng thử lại sau.",
        });
      }
    }, 30000); // 30 giây timeout

    // Clear timeout khi có event nào đó
    const clearTimeoutWrapper = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    // Lắng nghe tạm thời các event để clear timeout
    const checkHandler = () => clearTimeoutWrapper();
    autoUpdater.once("update-available", checkHandler);
    autoUpdater.once("update-not-available", checkHandler);
    autoUpdater.once("error", checkHandler);

    autoUpdater
      .checkForUpdates()
      .then((result) => {
        clearTimeoutWrapper();
        console.log("✅ [checkForUpdates] Promise resolved");
        if (result && result.updateInfo) {
          console.log(
            `📋 [checkForUpdates] Update info:`,
            JSON.stringify(result.updateInfo, null, 2)
          );
        } else {
          console.log(
            `📋 [checkForUpdates] Result:`,
            JSON.stringify(result, null, 2)
          );
        }
      })
      .catch((error) => {
        clearTimeoutWrapper();
        console.error("❌ [checkForUpdates] Lỗi khi kiểm tra update:", error);
        console.error("❌ [checkForUpdates] Error details:", {
          message: error.message,
          stack: error.stack,
          code: error.code,
          errno: error.errno,
        });
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("update-status", {
            status: "error",
            message: `Lỗi kiểm tra cập nhật: ${error.message}`,
          });
        }
      });
  } else {
    console.log("⚠️ Chế độ development - bỏ qua kiểm tra update");
    console.log(
      "💡 Để test update trong dev mode, set ENABLE_DEV_UPDATE_TEST = true ở dòng 175"
    );
  }
}

// Auto check update sẽ được gọi sau khi window load xong (trong createWindow)
// Không cần gọi ở đây nữa vì có thể window chưa sẵn sàng

/**
 * Hiển thị dialog thông báo chưa đăng ký và copy machineId
 */
function showUnregisteredDialog(machineId) {
  return new Promise((resolve) => {
    // Copy machineId vào clipboard
    clipboard.writeText(machineId);

    const licenseWindow = new BrowserWindow({
      width: 550,
      height: 650,
      resizable: false,
      frame: false,
      transparent: false,
      backgroundColor: "#667eea",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false,
      },
      modal: true,
      show: false,
    });

    // Đọc file HTML và replace placeholder
    const dialogPath = path.join(__dirname, "license-dialog.html");
    let htmlContent = fs.readFileSync(dialogPath, "utf-8");
    htmlContent = htmlContent.replace("MACHINE_ID_PLACEHOLDER", machineId);

    // Load HTML từ data URL
    licenseWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`
    );

    // Hiển thị window khi sẵn sàng
    licenseWindow.once("ready-to-show", () => {
      licenseWindow.show();
    });

    // Khi window đóng, quit app
    licenseWindow.on("closed", () => {
      app.quit();
      resolve();
    });

    // Prevent close by clicking outside (modal behavior)
    licenseWindow.setAlwaysOnTop(true);
  });
}

/**
 * Hiển thị dialog thông báo license đã bị khóa
 */
function showLicenseRevokedDialog(errorMessage) {
  return new Promise((resolve) => {
    // Disable mainWindow để không thể tương tác
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setEnabled(false);
    }

    const revokedWindow = new BrowserWindow({
      width: 550,
      height: 600,
      resizable: false,
      frame: false,
      transparent: false,
      backgroundColor: "#dc3545",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false,
      },
      modal: true,
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      show: false,
    });

    // Đọc file HTML
    const dialogPath = path.join(__dirname, "license-revoked-dialog.html");
    let htmlContent = fs.readFileSync(dialogPath, "utf-8");

    // Inject error message vào HTML nếu có
    if (errorMessage) {
      // Escape HTML để tránh XSS
      const escapedError = errorMessage
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

      // Thay thế error text và hiển thị error details
      htmlContent = htmlContent.replace(
        '<div id="errorText"></div>',
        `<div id="errorText">${escapedError}</div>`
      );
      htmlContent = htmlContent.replace(
        'id="errorDetails" style="display: none;">',
        'id="errorDetails">'
      );
    }

    // Load HTML từ data URL
    revokedWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`
    );

    // Hiển thị window khi sẵn sàng
    revokedWindow.once("ready-to-show", () => {
      revokedWindow.show();
      revokedWindow.focus();
      revokedWindow.setAlwaysOnTop(true);
    });

    // Ngăn chặn đóng bằng cách khác (như Alt+F4, ESC)
    revokedWindow.on("close", (event) => {
      // Chỉ cho phép đóng khi người dùng click nút đóng
      // Hoặc force quit
      app.quit();
    });

    // Khi window đóng, quit app
    revokedWindow.on("closed", () => {
      app.quit();
      resolve();
    });

    // Ngăn chặn minimize
    revokedWindow.on("minimize", (event) => {
      event.preventDefault();
      revokedWindow.show();
    });
  });
}

/**
 * Kiểm tra license trước khi mở app
 */
async function checkLicenseBeforeStart() {
  try {
    const licenseResult = await checkLicense();

    if (!licenseResult.registered) {
      // Nếu có machineId, hiển thị dialog và chặn app
      if (licenseResult.machineId) {
        await showUnregisteredDialog(licenseResult.machineId);
        // Dialog đóng sẽ quit app, không cần return false
        return false;
      } else {
        // Nếu không lấy được machineId, hiển thị lỗi và quit
        await dialog.showMessageBox(null, {
          type: "error",
          title: "Lỗi",
          message: "Không thể lấy Machine ID",
          detail: licenseResult.error || "Đã xảy ra lỗi không xác định",
          buttons: ["OK"],
        });
        app.quit();
        return false;
      }
    }

    // Nếu license hợp lệ (từ server hoặc cache), cho phép mở app
    if (licenseResult.fromCache) {
      console.log(
        `⚠️ Đang sử dụng license cache (offline ${licenseResult.cacheAgeDays} ngày). Vui lòng kết nối mạng để cập nhật.`
      );
    }

    return true;
  } catch (error) {
    console.error("Error in license check:", error);
    // Nếu có lỗi nghiêm trọng, có thể cho phép mở app hoặc chặn
    // Hiện tại chặn app để đảm bảo an toàn
    await dialog.showMessageBox(null, {
      type: "error",
      title: "Lỗi",
      message: "Lỗi kiểm tra license",
      detail: error.message,
      buttons: ["OK"],
    });
    app.quit();
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: path.join(__dirname, "assets/icon.ico"),
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.loadFile("renderer.html");

  // Auto-run sheet-watch khi mở app nếu người dùng đã bật "Tự chạy khi mở app"
  // Delay 4 s để renderer kịp gắn listener 'sheet:event' trước khi runner bắt đầu emit
  try {
    const sw = loadSheetSettings();
    if (sw.autoRunOnOpen && sw.spreadsheetId && sw.credentialsPath && sw.channelsRoot) {
      setTimeout(() => {
        try {
          sheetRunner = buildSheetRunner(mainWindow);
          sheetRunner.start((sw.pollSec || 300) * 1000);
        } catch (err) { console.error("Auto-run sheet-watch lỗi:", err); }
      }, 4000);
    }
  } catch (err) { console.error(err); }

  // Đợi window load xong rồi mới check update
  // Đảm bảo renderer.js đã load và setup listeners
  mainWindow.webContents.once("did-finish-load", () => {
    console.log("✅ Window đã load xong, bắt đầu check update sau 2 giây...");
    // Đợi thêm 2 giây để đảm bảo renderer.js đã setup listeners
    setTimeout(() => {
      checkForUpdates();
    }, 2000);
  });

  // Open DevTools in development (uncomment to enable)
  // mainWindow.webContents.openDevTools();
}

// Biến lưu interval check license
let licenseCheckInterval = null;

// Cấu hình thời gian kiểm tra license (có thể thay đổi ở đây)
// Mặc định: 30 phút = 30 * 60 * 1000 ms
const LICENSE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 giờ
// Để thay đổi thời gian, sửa giá trị trên (ví dụ: 15 * 60 * 1000 = 15 phút)

// Kiểm tra license định kỳ
async function checkLicensePeriodically() {
  try {
    console.log("🔍 Đang kiểm tra license định kỳ...");
    const licenseResult = await checkLicense();

    if (!licenseResult.registered) {
      // Chỉ đóng app nếu chắc chắn license bị revoke (không phải lỗi network)
      // Nếu là lỗi network, checkLicense() đã xử lý cache và có thể trả về registered: true từ cache
      console.log("❌ License không hợp lệ, đóng ứng dụng...");
      // Hiển thị dialog đẹp thông báo license bị khóa
      await showLicenseRevokedDialog(
        licenseResult.error || "License của bạn đã bị admin khóa hoặc thu hồi."
      );
      // app.quit() sẽ được gọi trong showLicenseRevokedDialog
    } else {
      if (licenseResult.fromCache) {
        console.log(
          `✅ License hợp lệ (từ cache, offline ${licenseResult.cacheAgeDays} ngày)`
        );
      } else {
        console.log("✅ License hợp lệ");
      }
    }
  } catch (error) {
    console.error("Error in periodic license check:", error);
    // Nếu lỗi network, không đóng app (có thể là mạng tạm thời)
    // checkLicense() đã xử lý cache, nên không cần làm gì thêm
  }
}

// Bắt đầu kiểm tra license định kỳ
function startPeriodicLicenseCheck() {
  // Dừng interval cũ nếu có
  if (licenseCheckInterval) {
    clearInterval(licenseCheckInterval);
  }

  console.log(
    `⏰ Bắt đầu kiểm tra license định kỳ mỗi ${
      LICENSE_CHECK_INTERVAL / 1000 / 60
    } phút`
  );

  // Check ngay lần đầu sau 1 phút (để app khởi động xong)
  setTimeout(() => {
    checkLicensePeriodically();
  }, 60 * 1000); // 1 phút

  // Sau đó check định kỳ
  licenseCheckInterval = setInterval(() => {
    checkLicensePeriodically();
  }, LICENSE_CHECK_INTERVAL);
}

// Dừng kiểm tra license định kỳ
function stopPeriodicLicenseCheck() {
  if (licenseCheckInterval) {
    clearInterval(licenseCheckInterval);
    licenseCheckInterval = null;
    console.log("⏹️ Đã dừng kiểm tra license định kỳ");
  }
}

// Hàm kiểm tra và hiển thị thông báo update thành công
async function checkAndShowUpdateSuccess() {
  try {
    const configDir = getConfigDir();
    const updateVersionPath = path.join(
      configDir,
      ".last-updated-version.json"
    );

    if (!fs.existsSync(updateVersionPath)) {
      return; // Không có file, chưa từng update
    }

    const updateInfo = JSON.parse(fs.readFileSync(updateVersionPath, "utf-8"));
    const currentVersion = app.getVersion();

    // Logic: Nếu version trong file khớp với version hiện tại
    // và file được tạo gần đây (trong 1 giờ) → đã update thành công
    if (
      updateInfo.version &&
      updateInfo.version === currentVersion &&
      updateInfo.updatedAt
    ) {
      const updateTime = new Date(updateInfo.updatedAt);
      const now = new Date();
      const hoursSinceUpdate = (now - updateTime) / (1000 * 60 * 60);

      // Chỉ hiển thị nếu update trong vòng 1 giờ trước
      if (hoursSinceUpdate < 1) {
        // Gửi message để renderer hiển thị custom dialog đẹp
        setTimeout(() => {
          // Đợi window sẵn sàng
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("update-status", {
              status: "update-success",
              message: `Đã cập nhật lên phiên bản ${currentVersion}`,
              version: currentVersion,
            });

            // Xóa file sau khi đã gửi message
            setTimeout(() => {
              try {
                fs.unlinkSync(updateVersionPath);
              } catch (err) {
                console.error("Error deleting update version file:", err);
              }
            }, 3000);
          }
        }, 2000); // Đợi 2 giây sau khi window load
        return;
      }
    }

    // Nếu không khớp điều kiện, xóa file để tránh hiển thị lại
    try {
      fs.unlinkSync(updateVersionPath);
    } catch (err) {
      console.error("Error deleting update version file:", err);
    }
  } catch (error) {
    console.error("Error checking update success:", error);
    // Xóa file nếu có lỗi parse
    try {
      const configDir = getConfigDir();
      const updateVersionPath = path.join(
        configDir,
        ".last-updated-version.json"
      );
      if (fs.existsSync(updateVersionPath)) {
        fs.unlinkSync(updateVersionPath);
      }
    } catch (err) {
      // Ignore
    }
  }
}

app.whenReady().then(async () => {
  // Kiểm tra license trước khi mở window
  const canContinue = await checkLicenseBeforeStart();
  if (canContinue) {
    createWindow();
    // Bắt đầu kiểm tra license định kỳ sau khi window được tạo
    startPeriodicLicenseCheck();
    // Kiểm tra và hiển thị thông báo update thành công
    checkAndShowUpdateSuccess();
  }
});

app.on("window-all-closed", () => {
  // Dừng kiểm tra license khi đóng tất cả windows
  stopPeriodicLicenseCheck();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  // Dừng kiểm tra license trước khi quit
  stopPeriodicLicenseCheck();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handler để mở cửa sổ mới
ipcMain.handle("open-new-window", async () => {
  createWindow();
  return { success: true };
});

// Helper function để lấy projects directory
function getProjectsDir() {
  const configDir = getConfigDir();
  return path.join(configDir, "projects");
}

// Helper function để đảm bảo projects directory tồn tại
function ensureProjectsDir() {
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }
  return projectsDir;
}

// Helper function để lấy file path của project config
function getProjectConfigPath(projectName) {
  const projectsDir = ensureProjectsDir();
  // Sanitize project name để tránh invalid file names
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(projectsDir, `${sanitizedName}.json`);
}

// Helper function để lấy file path của current project
function getCurrentProjectPath() {
  const configDir = getConfigDir();
  return path.join(configDir, ".current-project.json");
}

// IPC handler để lấy danh sách projects
ipcMain.handle("get-projects", async () => {
  try {
    const projectsDir = ensureProjectsDir();
    const files = fs.readdirSync(projectsDir);
    const projects = files
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(".json", ""));
    return { success: true, projects };
  } catch (error) {
    console.error("Error getting projects:", error);
    return { success: false, error: error.message, projects: [] };
  }
});

// IPC handler để lấy danh sách projects kèm metadata (cho dashboard)
ipcMain.handle("get-projects-with-meta", async () => {
  try {
    const projectsDir = ensureProjectsDir();
    const currentProjectPath = getCurrentProjectPath();
    let currentProjectName = null;
    if (fs.existsSync(currentProjectPath)) {
      try {
        const content = fs.readFileSync(currentProjectPath, "utf-8");
        currentProjectName = JSON.parse(content).projectName;
      } catch (err) {
        // ignore
      }
    }
    const files = fs.readdirSync(projectsDir).filter((f) => f.endsWith(".json"));
    const list = [];
    for (const file of files) {
      const name = file.replace(".json", "");
      const filePath = path.join(projectsDir, file);
      let createdAt = null;
      let updatedAt = null;
      let projectName = name;
      let renderDay = null;
      let renderVideos = null;
      let outputFolder = null;
      let cycleDays = 1;
      let lastRenderAt = null;
      let starred = false;
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const data = JSON.parse(content);
        createdAt = data.createdAt || null;
        updatedAt = data.updatedAt || null;
        if (data.projectName) projectName = data.projectName;
        starred = !!data.starred;
        if (data.settings && data.settings.render) {
          const r = data.settings.render;
          renderDay = r.day != null ? String(r.day) : null;
          renderVideos = r.videos != null ? String(r.videos) : null;
          outputFolder = r.outputFolder || null;
          cycleDays = typeof r.cycleDays !== "undefined" ? Math.max(1, parseInt(r.cycleDays, 10) || 1) : (parseInt(r.day, 10) || 1);
          lastRenderAt = r.lastRenderAt || null;
        }
      } catch (err) {
        // ignore
      }
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      let daysLeft = null;
      if (lastRenderAt) {
        const last = new Date(lastRenderAt).getTime();
        const nextDeadline = last + cycleDays * dayMs;
        daysLeft = Math.ceil((nextDeadline - now) / dayMs);
      } else {
        daysLeft = 0;
      }
      list.push({
        name,
        displayName: name === "default" ? "Mặc định" : projectName,
        createdAt,
        updatedAt,
        isCurrent: name === currentProjectName,
        renderDay,
        renderVideos,
        outputFolder,
        cycleDays,
        lastRenderAt,
        daysLeft,
        starred,
      });
    }
    // Sắp xếp: có sao (BKT) luôn ở đầu, trong mỗi nhóm sort theo ngày còn lại (gần deadline trước)
    list.sort((a, b) => {
      if (a.starred && !b.starred) return -1;
      if (!a.starred && b.starred) return 1;
      const da = a.daysLeft ?? 9999;
      const db = b.daysLeft ?? 9999;
      return da - db;
    });
    return { success: true, projects: list };
  } catch (error) {
    console.error("Error getting projects with meta:", error);
    return { success: false, error: error.message, projects: [] };
  }
});

// IPC handler: đánh dấu BKT (ngôi sao) cho dự án
ipcMain.handle("set-project-starred", async (event, projectName, starred) => {
  try {
    if (!projectName || projectName.trim() === "") {
      return { success: false, error: "Tên dự án không hợp lệ" };
    }
    const projectPath = getProjectConfigPath(projectName);
    if (!fs.existsSync(projectPath)) {
      return { success: false, error: "Dự án không tồn tại" };
    }
    const content = fs.readFileSync(projectPath, "utf-8");
    const data = JSON.parse(content);
    data.starred = !!starred;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(projectPath, JSON.stringify(data, null, 2));
    return { success: true };
  } catch (error) {
    console.error("Error set-project-starred:", error);
    return { success: false, error: error.message };
  }
});

// IPC handler: cập nhật thời điểm render cuối (sau khi chạy render xong)
ipcMain.handle("set-project-last-render", async (event, projectName) => {
  try {
    if (!projectName || projectName.trim() === "") {
      return { success: false, error: "Tên dự án không hợp lệ" };
    }
    const projectPath = getProjectConfigPath(projectName);
    if (!fs.existsSync(projectPath)) {
      return { success: false, error: "Dự án không tồn tại" };
    }
    const content = fs.readFileSync(projectPath, "utf-8");
    const data = JSON.parse(content);
    if (!data.settings) data.settings = {};
    if (!data.settings.render) data.settings.render = {};
    data.settings.render.lastRenderAt = new Date().toISOString();
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(projectPath, JSON.stringify(data, null, 2));
    return { success: true };
  } catch (error) {
    console.error("Error set-project-last-render:", error);
    return { success: false, error: error.message };
  }
});

// IPC handler để tạo project mới
ipcMain.handle("create-project", async (event, projectName) => {
  try {
    if (!projectName || projectName.trim() === "") {
      return { success: false, error: "Tên dự án không được để trống" };
    }

    const sanitizedName = projectName.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    if (sanitizedName === "") {
      return { success: false, error: "Tên dự án không hợp lệ" };
    }

    const projectPath = getProjectConfigPath(sanitizedName);
    if (fs.existsSync(projectPath)) {
      return { success: false, error: "Dự án đã tồn tại" };
    }

    // Tạo config mặc định cho project mới
    const defaultConfig = {
      projectName: sanitizedName,
      createdAt: new Date().toISOString(),
      settings: {},
    };

    fs.writeFileSync(projectPath, JSON.stringify(defaultConfig, null, 2));
    return { success: true, projectName: sanitizedName };
  } catch (error) {
    console.error("Error creating project:", error);
    return { success: false, error: error.message };
  }
});

// IPC handler để xóa project
ipcMain.handle("delete-project", async (event, projectName) => {
  try {
    if (!projectName || projectName.trim() === "") {
      return { success: false, error: "Tên dự án không hợp lệ" };
    }

    const projectPath = getProjectConfigPath(projectName);
    if (!fs.existsSync(projectPath)) {
      return { success: false, error: "Dự án không tồn tại" };
    }

    // Kiểm tra xem có phải project hiện tại không
    const currentProjectPath = getCurrentProjectPath();
    let currentProject = null;
    if (fs.existsSync(currentProjectPath)) {
      try {
        const currentContent = fs.readFileSync(currentProjectPath, "utf-8");
        currentProject = JSON.parse(currentContent).projectName;
      } catch (err) {
        // Ignore
      }
    }

    // Xóa file config
    fs.unlinkSync(projectPath);

    // Nếu là project hiện tại, xóa current project
    if (currentProject === projectName) {
      if (fs.existsSync(currentProjectPath)) {
        fs.unlinkSync(currentProjectPath);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Error deleting project:", error);
    return { success: false, error: error.message };
  }
});

// IPC handler để lưu config của project
ipcMain.handle("save-project-config", async (event, projectName, config) => {
  try {
    if (!projectName || projectName.trim() === "") {
      return { success: false, error: "Tên dự án không hợp lệ" };
    }

    const projectPath = getProjectConfigPath(projectName);
    let projectData = {
      projectName: projectName,
      settings: {},
    };

    // Đọc config hiện tại nếu có
    if (fs.existsSync(projectPath)) {
      try {
        const existingContent = fs.readFileSync(projectPath, "utf-8");
        projectData = JSON.parse(existingContent);
      } catch (err) {
        console.error(`Error reading existing project config: ${err.message}`);
      }
    }

    // Cập nhật settings, giữ lại lastRenderAt nếu config từ renderer không gửi
    const existingLastRender = projectData.settings?.render?.lastRenderAt;
    projectData.settings = config;
    if (existingLastRender && projectData.settings?.render && projectData.settings.render.lastRenderAt == null) {
      projectData.settings.render.lastRenderAt = existingLastRender;
    }
    projectData.updatedAt = new Date().toISOString();

    fs.writeFileSync(projectPath, JSON.stringify(projectData, null, 2));
    return { success: true };
  } catch (error) {
    console.error("Error saving project config:", error);
    return { success: false, error: error.message };
  }
});

// IPC handler để load config của project
// Mặc định load "default" nếu không có project được chỉ định
ipcMain.handle("load-project-config", async (event, projectName) => {
  try {
    // Nếu không có projectName hoặc là null, dùng "default"
    const projectToLoad = projectName && projectName.trim() !== "" 
      ? projectName.trim() 
      : "default";

    const projectPath = getProjectConfigPath(projectToLoad);
    if (!fs.existsSync(projectPath)) {
      // Nếu project không tồn tại, tạo project "default" với cấu trúc mẫu
      if (projectToLoad === "default") {
        const defaultProject = {
          projectName: "default",
          createdAt: new Date().toISOString(),
          settings: {},
          updatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(
          projectPath,
          JSON.stringify(defaultProject, null, 2)
        );
        return { success: true, config: {} };
      }
      return { success: true, config: {} };
    }

    const content = fs.readFileSync(projectPath, "utf-8");
    const projectData = JSON.parse(content);
    return { success: true, config: projectData.settings || {} };
  } catch (error) {
    console.error("Error loading project config:", error);
    return { success: false, error: error.message, config: {} };
  }
});

// IPC handler để lấy project hiện tại
// Mặc định trả về "default" nếu không có project được chọn
ipcMain.handle("get-current-project", async () => {
  try {
    const currentProjectPath = getCurrentProjectPath();
    if (!fs.existsSync(currentProjectPath)) {
      // Nếu không có project được chọn, mặc định là "default"
      return { success: true, projectName: "default" };
    }

    const content = fs.readFileSync(currentProjectPath, "utf-8");
    const data = JSON.parse(content);
    const projectName = data.projectName || "default";
    // Đảm bảo project "default" tồn tại
    if (projectName === "default") {
      const defaultProjectPath = getProjectConfigPath("default");
      if (!fs.existsSync(defaultProjectPath)) {
        // Tạo project "default" với cấu trúc mẫu
        const defaultProject = {
          projectName: "default",
          createdAt: new Date().toISOString(),
          settings: {},
          updatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(
          defaultProjectPath,
          JSON.stringify(defaultProject, null, 2)
        );
      }
    }
    return { success: true, projectName };
  } catch (error) {
    console.error("Error getting current project:", error);
    return { success: false, error: error.message, projectName: "default" };
  }
});

// IPC handler để set project hiện tại
ipcMain.handle("set-current-project", async (event, projectName) => {
  try {
    const currentProjectPath = getCurrentProjectPath();
    const data = { projectName: projectName || null };
    fs.writeFileSync(currentProjectPath, JSON.stringify(data, null, 2));
    return { success: true };
  } catch (error) {
    console.error("Error setting current project:", error);
    return { success: false, error: error.message };
  }
});

// Helper function để tải file với redirect handling
function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const download = (currentUrl) => {
      const file = fs.createWriteStream(filePath);

      https
        .get(currentUrl, (response) => {
          // Xử lý redirect
          if (
            response.statusCode === 301 ||
            response.statusCode === 302 ||
            response.statusCode === 307 ||
            response.statusCode === 308
          ) {
            file.close();
            fs.unlinkSync(filePath);
            const redirectUrl = response.headers.location;
            if (!redirectUrl) {
              reject({ success: false, error: "Redirect URL không hợp lệ" });
              return;
            }
            // Follow redirect
            download(redirectUrl);
            return;
          }

          // Kiểm tra status code
          if (response.statusCode !== 200) {
            file.close();
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
            reject({
              success: false,
              error: `Lỗi HTTP: ${response.statusCode} ${response.statusMessage}`,
            });
            return;
          }

          // Lấy content length để hiển thị progress (optional)
          const totalSize = parseInt(response.headers["content-length"], 10);
          let downloadedSize = 0;

          response.on("data", (chunk) => {
            downloadedSize += chunk.length;
          });

          response.pipe(file);

          file.on("finish", () => {
            file.close();
            resolve({
              success: true,
              message: `Đã tải yt-dlp mới nhất thành công!`,
              size: downloadedSize,
            });
          });
        })
        .on("error", (err) => {
          file.close();
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          reject({ success: false, error: `Lỗi kết nối: ${err.message}` });
        });
    };

    download(url);
  });
}

// IPC handlers cho auto-updater
ipcMain.handle("check-for-updates", async () => {
  if (!app.isPackaged) {
    return {
      success: false,
      message: "Chức năng này chỉ hoạt động trong phiên bản đã build",
    };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { success: true, message: "Đang kiểm tra cập nhật..." };
  } catch (error) {
    return {
      success: false,
      message: error.message || "Lỗi khi kiểm tra cập nhật",
    };
  }
});

ipcMain.handle("download-update", async () => {
  if (!app.isPackaged) {
    return {
      success: false,
      message: "Chức năng này chỉ hoạt động trong phiên bản đã build",
    };
  }
  try {
    await autoUpdater.downloadUpdate();
    return { success: true, message: "Đang tải cập nhật..." };
  } catch (error) {
    return {
      success: false,
      message: error.message || "Lỗi khi tải cập nhật",
    };
  }
});

ipcMain.handle("install-update", async () => {
  if (!app.isPackaged) {
    return {
      success: false,
      message: "Chức năng này chỉ hoạt động trong phiên bản đã build",
    };
  }
  try {
    // Lưu version để hiển thị thông báo sau khi update
    const updateVersionPath = path.join(
      getConfigDir(),
      ".last-updated-version.json"
    );
    try {
      // Lấy version từ update info (nếu có trong memory hoặc từ event trước đó)
      // Nếu không có, dùng current version + 1 (fallback)
      const currentVersion = app.getVersion();
      fs.writeFileSync(
        updateVersionPath,
        JSON.stringify({
          version: currentVersion, // Sẽ được update khi app khởi động lại với version mới
          updatedAt: new Date().toISOString(),
        }),
        "utf-8"
      );
    } catch (err) {
      console.error("Error saving update version:", err);
    }

    autoUpdater.quitAndInstall(false, true);
    return { success: true, message: "Đang khởi động lại để cài đặt..." };
  } catch (error) {
    return {
      success: false,
      message: error.message || "Lỗi khi cài đặt cập nhật",
    };
  }
});

// IPC handler để tải yt-dlp mới nhất
ipcMain.handle("download-ytdlp", async () => {
  try {
    const appPath = getAppPath();
    const binDir = path.join(appPath, "bin");
    const ytdlpPath = path.join(binDir, "yt-dlp.exe");
    const downloadUrl =
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

    // Đảm bảo thư mục bin tồn tại
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    // Tải file
    const result = await downloadFile(downloadUrl, ytdlpPath);
    return {
      ...result,
      message: result.message || "Đã tải yt-dlp mới nhất thành công!",
    };
  } catch (error) {
    const errorMsg =
      error?.error || error?.message || error?.toString() || String(error);
    console.error(`Error downloading yt-dlp: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
});

// IPC handler để tự động phát hiện GPU codec
ipcMain.handle("detect-gpu-codec", async () => {
  return new Promise((resolve) => {
    try {
      const appPath = getAppPath();
      const ffmpegPath = path.join(appPath, "bin", "ffmpeg.exe");
      
      // Kiểm tra xem ffmpeg có tồn tại không
      if (!fs.existsSync(ffmpegPath)) {
        console.warn(`FFmpeg không tìm thấy tại: ${ffmpegPath}`);
        resolve({ success: false, codec: null, error: "FFmpeg không tìm thấy" });
        return;
      }

      const checkProcess = spawn(ffmpegPath, ["-encoders"]);
      let output = "";

      checkProcess.stdout.on("data", (data) => {
        output += data.toString();
      });

      checkProcess.stderr.on("data", (data) => {
        output += data.toString();
      });

      checkProcess.on("close", () => {
        // Ưu tiên theo thứ tự: NVIDIA > Intel > AMD
        // Kiểm tra NVIDIA NVENC
        if (output.includes("h264_nvenc")) {
          console.log("✅ Phát hiện GPU: NVIDIA (h264_nvenc)");
          resolve({ success: true, codec: "h264_nvenc" });
          return;
        }
        
        // Kiểm tra Intel QuickSync
        if (output.includes("h264_qsv")) {
          console.log("✅ Phát hiện GPU: Intel QuickSync (h264_qsv)");
          resolve({ success: true, codec: "h264_qsv" });
          return;
        }
        
        // Kiểm tra AMD AMF
        if (output.includes("h264_amf")) {
          console.log("✅ Phát hiện GPU: AMD AMF (h264_amf)");
          resolve({ success: true, codec: "h264_amf" });
          return;
        }
        
        // Không tìm thấy GPU encoder nào
        console.warn("⚠️ Không phát hiện GPU encoder nào");
        resolve({ success: false, codec: null, error: "Không tìm thấy GPU encoder" });
      });

      checkProcess.on("error", (error) => {
        console.error(`❌ Lỗi khi kiểm tra GPU encoder: ${error.message}`);
        resolve({ success: false, codec: null, error: error.message });
      });
    } catch (error) {
      console.error(`❌ Lỗi trong detect-gpu-codec: ${error.message}`);
      resolve({ success: false, codec: null, error: error.message });
    }
  });
});

// ===== Sheet-watch feature =====
function sheetSettingsPath() {
  return path.join(getConfigDir(), "sheet-settings.json");
}
function loadSheetSettings() {
  try { return JSON.parse(fs.readFileSync(sheetSettingsPath(), "utf-8")); }
  catch { return { spreadsheetId: "", credentialsPath: "", channelsRoot: "", pollSec: 300, autoRunOnOpen: false, useGPU: false, videoSpeed: 0.95, gpuVideoCodec: "h264_nvenc", ytApiKey: "", gpmIdleCloseMin: 10 }; }
}
function saveSheetSettings(s) { fs.writeFileSync(sheetSettingsPath(), JSON.stringify(s, null, 2), "utf-8"); }

const YTDLP_PATH = path.join(getAppPath(), "bin", "yt-dlp.exe");
let sheetRunner = null;

function buildSheetRunner(win) {
  const s = loadSheetSettings();
  const sheets = createSheetsClient(s.credentialsPath);
  const statePath = path.join(s.channelsRoot, "runner-state.json");
  const resumePath = path.join(s.channelsRoot, "resume-state.json");
  const emitEvent = (evt) => { if (win && !win.isDestroyed()) win.webContents.send("sheet:event", evt); };
  // Hàng đợi upload GPM (state riêng, log ra cùng luồng sự kiện Sheet).
  const uploadQueue = createUploadQueue({
    // Nguồn sự thật = Sheet cột C: đọc trạng thái upload của kênh → slot đã dùng + url đã lên lịch.
    readChannelUploads: async (sheetName) => {
      const rows = await readUploadStatuses(sheets, s.spreadsheetId, sheetName);
      const scheduledUrls = new Set();
      const usedSlots = [];
      for (const { url, uploadStatus } of rows) {
        const iso = parseScheduledISO(uploadStatus);
        if (iso) { scheduledUrls.add(url); usedSlots.push(iso); }
      }
      return { scheduledUrls, usedSlots };
    },
    log: (message) => emitEvent({ type: "log", message }),
    emit: emitEvent, // phát sự kiện upload-status lên bảng UI
    // Rảnh bấy lâu thì tắt trình duyệt GPM (0 = luôn giữ mở). Đọc 1 lần lúc dựng runner:
    // đổi cấu hình khi đang chạy thì phải Dừng → Chạy lại.
    idleCloseMs: Math.max(0, Number(s.gpmIdleCloseMin ?? 10) || 0) * 60_000,

    // Ghi ngược trạng thái từng bước vào cột C của tab kênh.
    setUploadStatus: (sheetName, rowIndex, status) =>
      setUploadStatus(sheets, s.spreadsheetId, sheetName, rowIndex, status),
    // Gửi 1 digest Telegram khi hàng đợi upload rảnh.
    notifyDigest: async (results) => {
      if (!s.gpmTelegramEnabled) return; // người dùng tắt thông báo
      const text = buildDigest(results);
      if (!text) return;
      if (!s.gpmTelegramToken || !s.gpmTelegramChatId) return;
      const r = await sendTelegram(s.gpmTelegramToken, s.gpmTelegramChatId, text);
      if (!r.ok) emitEvent({ type: "log", message: `Telegram lỗi: ${r.error || "?"}` });
    },
  });
  return createSheetRunner({
    uploadQueue,
    refreshStats: async () => {
      const r = await refreshChannelStats();
      emitEvent({ type: "stats", ...r });
      if (!r.ok) throw new Error(r.error);
    },
    config: {
      spreadsheetId: s.spreadsheetId, channelsRoot: s.channelsRoot, statePath, renderConcurrency: 2,
      useGPU: !!s.useGPU,
      gpuVideoCodec: s.gpuVideoCodec || "h264_nvenc",
      videoSpeed: (typeof s.videoSpeed === "number" && s.videoSpeed > 0) ? s.videoSpeed : 0.95,
      gpmEnabled: !!s.gpmEnabled,
      gpmHost: s.gpmHost || "127.0.0.1:19995",
      gpmLocale: s.gpmLocale || "vi",
    },
    sheetsApi: {
      readConfigSheet: () => readConfigSheet(sheets, s.spreadsheetId),
      readChannelUrls: (name) => readChannelUrls(sheets, s.spreadsheetId, name),
      setUrlStatus: (name, row, status) => setUrlStatus(sheets, s.spreadsheetId, name, row, status),
      setUploadStatus: (name, row, status) => setUploadStatus(sheets, s.spreadsheetId, name, row, status),
    },
    downloader: (url, dir, opts) => downloadOne(url, dir, { ...opts, ytdlpPath: YTDLP_PATH }),
    renderer: (opts) => renderOne(opts),
    detectChroma: (videoPath, palette) =>
      detectChromaColor(videoPath, palette, { ffmpegPath: resolveFfmpegPaths().ffmpegPath, spawn, sharp }),
    listBackgrounds: (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".mp4")) : []),
    ensureDirs: (root) => {
      const dirs = {
        backgroundsDir: path.join(root, "backgrounds"),
        overlaysDir: path.join(root, "overlays"),
        outputDir: path.join(root, "output"),
      };
      for (const d of [dirs.overlaysDir, dirs.outputDir]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      return dirs;
    },
    stateStore: { load: () => loadState(statePath), save: (st) => saveState(statePath, st) },
    resumeStore: { load: () => loadResume(resumePath), save: (st) => saveResume(resumePath, st) },
    fileExists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
    emit: emitEvent,
    now: () => new Date(),
    pLimitFn: (n) => pLimit(n),
    rand: () => Math.random(),
    unlink: (p) => { try { fs.unlinkSync(p); } catch { /* ignore */ } },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
}

// ===== Theo dõi kênh YouTube =====
function ytClientFrom(st) {
  return createYoutubeClient((st.ytApiKey || "").trim() || DEFAULT_YT_API_KEY);
}

function requireSheetSettings(st) {
  if (!st.spreadsheetId) return "Chưa nhập Spreadsheet ID.";
  if (!st.credentialsPath) return "Chưa chọn file service account JSON.";
  return null;
}

// Đọc ⚙config một lần, gọi API, ghi ngược từng dòng, trả bảng cho UI.
// Một kênh hỏng chỉ làm hỏng dòng của nó.
async function refreshChannelStats() {
  const st = loadSheetSettings();
  const bad = requireSheetSettings(st);
  if (bad) return { ok: false, error: bad };

  const sheets = createSheetsClient(st.credentialsPath);
  const values = await readConfigValues(sheets, st.spreadsheetId);
  const channels = parseConfigRows(values);
  const { cols } = findStatsColumns(values);
  const missing = STATS_KEYS.filter((k) => cols[k] === undefined);

  const targets = channels.filter((c) => c.channelUrl);
  const stats = targets.length
    ? await fetchChannelStats(ytClientFrom(st), targets.map((c) => c.channelUrl))
    : [];
  const statByName = new Map(targets.map((c, i) => [c.sheetName, stats[i]]));
  const updatedAt = formatStamp(new Date());

  const rows = [];
  for (const ch of channels) {
    const base = { sheetName: ch.sheetName, sourceHandle: ch.sourceHandle || "", channelUrl: ch.channelUrl || "" };
    const s = statByName.get(ch.sheetName);
    if (!s) { rows.push({ ...base }); continue; } // kênh không khai Link kênh
    if (s.error) { rows.push({ ...base, error: s.error }); continue; }
    try {
      await writeChannelStats(sheets, st.spreadsheetId, "⚙config", ch.rowIndex, cols, { ...s, updatedAt });
    } catch (err) {
      rows.push({ ...base, error: String(err?.message || err) });
      continue;
    }
    rows.push({ ...base, subscribers: s.subscribers, views: s.views, videoCount: s.videoCount, hidden: s.hidden, updatedAt });
  }
  return { ok: true, rows, missing };
}

// Danh sách kênh cho bảng số liệu, chỉ đọc Sheet — KHÔNG gọi YouTube API.
// Nhờ vậy nút "Lấy URL nguồn" có ngay mà không tốn quota và không cần API key.
async function listStatsChannels() {
  const st = loadSheetSettings();
  const bad = requireSheetSettings(st);
  if (bad) return { ok: false, error: bad };

  const sheets = createSheetsClient(st.credentialsPath);
  const channels = await readConfigSheet(sheets, st.spreadsheetId);
  return {
    ok: true,
    rows: channels.map((c) => ({
      sheetName: c.sheetName,
      sourceHandle: c.sourceHandle || "",
      channelUrl: c.channelUrl || "",
    })),
    missing: [],
  };
}

async function fetchSourceUrlsFor(sheetName) {
  const st = loadSheetSettings();
  const bad = requireSheetSettings(st);
  if (bad) return { ok: false, error: bad };

  const sheets = createSheetsClient(st.credentialsPath);
  const channels = await readConfigSheet(sheets, st.spreadsheetId);
  const ch = channels.find((c) => c.sheetName === sheetName);
  if (!ch) return { ok: false, error: `Không thấy kênh "${sheetName}" trong ⚙config.` };
  if (!ch.sourceHandle) return { ok: false, error: "Kênh chưa điền cột @handle nguồn." };

  const videos = await fetchSourceVideos(ytClientFrom(st), ch.sourceHandle);
  const existing = (await readChannelUrls(sheets, st.spreadsheetId, sheetName)).map((r) => r.url);
  const fresh = pickNewUrls(existing, videos.map((v) => v.url));
  await appendUrls(sheets, st.spreadsheetId, sheetName, fresh);
  return { ok: true, added: fresh.length, skipped: videos.length - fresh.length };
}

ipcMain.handle("sheet:test-connection", async (e, s) => {
  try {
    const st = s || loadSheetSettings();
    if (!st.spreadsheetId) return { success: false, error: "Chưa nhập Spreadsheet ID." };
    if (!st.credentialsPath) return { success: false, error: "Chưa chọn file service account JSON." };
    const sheets = createSheetsClient(st.credentialsPath);
    const info = await testSheetConnection(sheets, st.spreadsheetId);
    return { success: true, ...info };
  } catch (err) {
    return { success: false, error: String(err?.message || err) };
  }
});
ipcMain.handle("sheet:load-settings", async () => loadSheetSettings());
ipcMain.handle("sheet:save-settings", async (e, s) => { saveSheetSettings(s); return { success: true }; });
ipcMain.handle("sheet:select-credentials", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("sheet:select-root", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("sheet:start", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const s = loadSheetSettings();
  if (sheetRunner) sheetRunner.stop();
  sheetRunner = buildSheetRunner(win);
  sheetRunner.start((s.pollSec || 300) * 1000);
  return { success: true };
});
ipcMain.handle("sheet:stop", async () => { if (sheetRunner) sheetRunner.stop(); return { success: true }; });
ipcMain.handle("sheet:run-now", async (e, sheetName) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const runner = sheetRunner || buildSheetRunner(win);
  await runner.runNow(sheetName || undefined);
  return { success: true };
});

ipcMain.handle("yt:list-channels", async () => {
  try { return await listStatsChannels(); }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
});

ipcMain.handle("yt:refresh-stats", async () => {
  try { return await refreshChannelStats(); }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
});

ipcMain.handle("yt:fetch-source-urls", async (e, { sheetName } = {}) => {
  try { return await fetchSourceUrlsFor((sheetName || "").trim()); }
  catch (err) { return { ok: false, error: String(err?.message || err) }; }
});

ipcMain.handle("gpm:test", async (e, { gpmHost } = {}) => {
  try {
    const host = (gpmHost || "").trim() || "127.0.0.1:19995";
    const profiles = await testGpmConnection(host);
    return { ok: true, profiles };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("gpm:list-channels", async () => {
  try {
    const st = loadSheetSettings();
    if (!st.spreadsheetId) return { ok: false, error: "Chưa nhập Spreadsheet ID." };
    if (!st.credentialsPath) return { ok: false, error: "Chưa chọn file service account JSON." };
    const sheets = createSheetsClient(st.credentialsPath);
    const channels = await readConfigSheet(sheets, st.spreadsheetId);
    // Quota hôm nay: đọc runner-state.json để card hiện "3/8". computeRemaining tự
    // coi quota là 0 khi lastRunDate khác hôm nay, nên không cần reset thủ công.
    const state = st.channelsRoot ? loadState(path.join(st.channelsRoot, "runner-state.json")) : {};
    const today = todayStr(new Date());
    return {
      ok: true,
      channels: channels.map((c) => {
        const perDay = parseInt(c.videosPerDay, 10) || 0;
        return {
          sheetName: c.sheetName,
          gpmProfileId: c.gpmProfileId || "",
          videosPerDay: perDay,
          enabled: !!c.enabled,
          countToday: perDay - computeRemaining(state[c.sheetName], perDay, today),
        };
      }),
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("gpm:test-telegram", async (e, { token, chatId } = {}) => {
  try {
    const r = await sendTelegram((token || "").trim(), (chatId || "").trim(),
      "✅ VidMaster: test thông báo Telegram thành công.");
    return r.ok ? { ok: true } : { ok: false, error: r.error || "gửi thất bại" };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("gpm:connect", async (e, { gpmHost, profileId } = {}) => {
  try {
    const host = (gpmHost || "").trim() || "127.0.0.1:19995";
    const pid = (profileId || "").trim();
    if (!pid) return { ok: false, error: "Kênh chưa có GPM Profile ID." };
    await connectAndOpenStudio(host, pid);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// IPC Handlers
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("select-file", async (event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: options.filters || [{ name: "All Files", extensions: ["*"] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

// IPC handler để lưu render config vào file
// DEPRECATED: Không còn tạo file .render-config.json riêng lẻ nữa
// Config được lưu trong project JSON
ipcMain.handle("save-render-config", async (event, config) => {
  // Không còn tạo file config riêng lẻ - config được lưu trong project JSON
  return { success: true };
});

// IPC handler để đọc render config từ file
// DEPRECATED: Không còn đọc từ file .render-config.json nữa
// Config được đọc từ project JSON
ipcMain.handle("load-render-config", async () => {
  // Không còn đọc từ file config riêng lẻ - config được đọc từ project JSON
  return { success: true, config: null };
});

// IPC handler để sync config files từ project settings
// DEPRECATED: Không còn tạo file config riêng lẻ nữa, scripts đọc trực tiếp từ project JSON
// Giữ lại để tương thích ngược nhưng không làm gì
ipcMain.handle("sync-config-files", async (event, configs) => {
  // Không còn tạo file config riêng lẻ - scripts đọc trực tiếp từ project JSON
  // Thông qua environment variable PROJECT_NAME
  return { success: true };
});

ipcMain.handle(
  "run-script",
  async (event, scriptPath, args = [], options = {}) => {
    try {
      return await new Promise((resolve, reject) => {
        // Không cần fileMapping nữa - scripts sẽ đọc paths trực tiếp từ config files
        // Config files sẽ được ghi vào userData directory (có thể ghi được trong production)

        const configDir = getConfigDir();
        const appPath = getAppPath();

        // Helper function để serialize error messages
        const getErrorMessage = (err) => {
          if (typeof err === "string") return err;
          if (err && err.message) return err.message;
          if (err && err.toString) return err.toString();
          return String(err);
        };

        // Tạo unique ID cho job để tránh conflict khi chạy đồng thời
        const jobId =
          options.jobId ||
          `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Lấy project name hiện tại (mặc định là "default")
        let projectName = "default";
        try {
          const currentProjectPath = getCurrentProjectPath();
          if (fs.existsSync(currentProjectPath)) {
            const content = fs.readFileSync(currentProjectPath, "utf-8");
            const data = JSON.parse(content);
            projectName = data.projectName || "default";
          }
        } catch (err) {
          console.warn("Error getting current project, using default:", err);
        }

        // Set environment variables để scripts biết đọc config từ project JSON
        // Phải khai báo env trước khi sử dụng
        const env = {
          ...process.env,
          CONFIG_DIR: configDir,
          PROJECT_NAME: projectName, // Truyền project name để scripts đọc từ project JSON
          PROJECTS_DIR: path.join(configDir, "projects"), // Đường dẫn đến thư mục projects
          ...options.env,
        };

        // Truyền renderConfig qua environment variable (JSON string) thay vì tạo file
        // Để tránh conflict khi chạy đồng thời nhiều job, mỗi job có jobId riêng
        if (options.renderConfig) {
          try {
            // Truyền config qua environment variable dưới dạng JSON string
            env.RENDER_CONFIG_JSON = JSON.stringify(options.renderConfig);
            env.RENDER_JOB_ID = jobId; // Truyền jobId để tránh conflict
          } catch (err) {
            console.error(
              `Error serializing render config: ${getErrorMessage(err)}`
            );
            event.sender.send(
              "script-output",
              `⚠️ Cảnh báo: Lỗi khi serialize config: ${getErrorMessage(err)}\n`
            );
          }
        }

        // KHÔNG TẠO các file .config.json riêng lẻ nữa
        // Scripts sẽ đọc trực tiếp từ projects/{PROJECT_NAME}.json

        // Xác định đường dẫn script và node executable
        let scriptFullPath = path.join(appPath, scriptPath);

        // Trong production, nếu script không tồn tại ở appPath, thử tìm ở các vị trí khác
        if (!fs.existsSync(scriptFullPath) && app.isPackaged) {
          // Thử các vị trí có thể:
          const possiblePaths = [
            path.join(appPath, scriptPath), // app.asar.unpacked (primary location)
            path.join(process.resourcesPath, "app.asar.unpacked", scriptPath), // explicit unpacked path
            path.join(process.resourcesPath, scriptPath), // resources folder (fallback)
          ];

          for (const possiblePath of possiblePaths) {
            if (fs.existsSync(possiblePath)) {
              scriptFullPath = possiblePath;
              console.log(`Found script at: ${scriptFullPath}`);
              break;
            }
          }
        }

        // Kiểm tra xem script có tồn tại không
        if (!fs.existsSync(scriptFullPath)) {
          const debugInfo = {
            scriptPath,
            appPath,
            isPackaged: app.isPackaged,
            asarPath: app.isPackaged ? app.getAppPath() : null,
            resourcesPath: process.resourcesPath,
            checkedPath: scriptFullPath,
          };
          const errorMsg = `Script không tồn tại: ${scriptPath}\nĐã kiểm tra: ${scriptFullPath}\nDebug: ${JSON.stringify(
            debugInfo,
            null,
            2
          )}`;
          console.error(errorMsg);
          event.sender.send("script-output", `❌ ${errorMsg}\n`);
          reject({
            success: false,
            error: `Script không tồn tại: ${scriptPath}`,
          });
          return;
        }

        console.log(`Running script: ${scriptFullPath}`);
        event.sender.send(
          "script-output",
          `📝 Đang chạy script: ${scriptPath}\n`
        );

        // Trong production, sử dụng node.exe từ app.asar.unpacked/bin nếu có
        // Trong development, sử dụng 'node' từ PATH
        let nodeExecutable = "node";
        if (app.isPackaged) {
          // Folder bin/ được unpack vào app.asar.unpacked/bin/
          const possibleNodePaths = [
            path.join(
              process.resourcesPath,
              "app.asar.unpacked",
              "bin",
              "node.exe"
            ),
            path.join(process.resourcesPath, "bin", "node.exe"), // Fallback
          ];

          let nodePath = null;
          for (const possiblePath of possibleNodePaths) {
            if (fs.existsSync(possiblePath)) {
              nodePath = possiblePath;
              break;
            }
          }

          if (nodePath) {
            nodeExecutable = nodePath;
            console.log(`Sử dụng Node.js từ: ${nodePath}`);
          } else {
            // Nếu không tìm thấy node.exe, thử dùng node từ PATH
            console.warn(
              `Node executable không tìm thấy. Đã kiểm tra: ${possibleNodePaths.join(
                ", "
              )}. Sử dụng 'node' từ PATH`
            );
          }
        }

        // env đã được khai báo ở trên, chỉ cần cập nhật NODE_PATH nếu cần

        // Trong production, set NODE_PATH để scripts có thể tìm node_modules
        if (app.isPackaged) {
          const asarPath = app.getAppPath();
          // node_modules có thể ở trong app.asar hoặc app.asar.unpacked
          const possibleNodeModulesPaths = [
            path.join(
              process.resourcesPath,
              "app.asar.unpacked",
              "node_modules"
            ), // unpacked first
            path.join(process.resourcesPath, "app.asar", "node_modules"), // in asar (if not unpacked)
          ];

          // Tìm node_modules path tồn tại
          let nodeModulesPath = null;
          for (const possiblePath of possibleNodeModulesPaths) {
            if (fs.existsSync(possiblePath)) {
              nodeModulesPath = possiblePath;
              break;
            }
          }

          // Nếu tìm thấy, thêm vào NODE_PATH
          if (nodeModulesPath) {
            const existingNodePath = env.NODE_PATH || "";
            env.NODE_PATH = existingNodePath
              ? `${nodeModulesPath}${path.delimiter}${existingNodePath}`
              : nodeModulesPath;
            console.log(`Set NODE_PATH to: ${env.NODE_PATH}`);
          } else {
            console.warn("Không tìm thấy node_modules trong production build");
          }
        }

        const child = spawn(nodeExecutable, [scriptFullPath, ...args], {
          cwd: appPath,
          stdio: "pipe",
          env: env,
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data) => {
          stdout += data.toString();
          event.sender.send("script-output", data.toString());
        });

        child.stderr.on("data", (data) => {
          stderr += data.toString();
          event.sender.send("script-output", data.toString());
        });

        child.on("close", (code) => {
          // Không cần cleanup nữa - không tạo file config riêng lẻ
          // Config được truyền qua environment variable hoặc đọc từ project JSON

          if (code === 0) {
            resolve({ success: true, output: stdout });
          } else {
            const errorMsg = stderr || `Script exited with code ${code}`;
            reject({ success: false, error: errorMsg, code });
          }
        });

        child.on("error", (error) => {
          // Không cần cleanup nữa - không tạo file config riêng lẻ

          const errorMsg = getErrorMessage(error);
          console.error(`Error spawning script: ${errorMsg}`);
          reject({ success: false, error: errorMsg });
        });
      });
    } catch (error) {
      // Catch any synchronous errors
      const errorMsg = error?.message || error?.toString() || String(error);
      console.error(`Error in run-script handler: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }
);
