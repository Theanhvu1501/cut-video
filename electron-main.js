import { spawn } from "child_process";
import { app, BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import fs from "fs";
import https from "https";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { checkLicense } from "./license-check.js";

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

// Log update events
autoUpdater.logger = {
  info: (message) => console.log(`[AutoUpdater] ${message}`),
  warn: (message) => console.warn(`[AutoUpdater] ${message}`),
  error: (message) => console.error(`[AutoUpdater] ${message}`),
};

// Các event handlers cho auto-updater
autoUpdater.on("checking-for-update", () => {
  console.log("🔍 Đang kiểm tra cập nhật...");
  if (mainWindow) {
    mainWindow.webContents.send("update-status", {
      status: "checking",
      message: "Đang kiểm tra cập nhật...",
    });
  }
});

autoUpdater.on("update-available", (info) => {
  console.log(`✅ Có bản cập nhật mới: ${info.version}`);
  if (mainWindow) {
    mainWindow.webContents.send("update-status", {
      status: "available",
      message: `Có bản cập nhật mới: v${info.version}`,
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  }
  // Không hiển thị dialog native, để renderer hiển thị custom dialog đẹp hơn
});

autoUpdater.on("update-not-available", (info) => {
  console.log(`✅ Đã sử dụng phiên bản mới nhất: ${info.version}`);
  if (mainWindow) {
    mainWindow.webContents.send("update-status", {
      status: "not-available",
      message: "Đã sử dụng phiên bản mới nhất",
      version: info.version,
    });
  }
});

autoUpdater.on("error", (error) => {
  console.error(`❌ Lỗi kiểm tra cập nhật: ${error.message}`);
  if (mainWindow) {
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

// Hàm kiểm tra update (chỉ chạy trong production)
// Chỉ chạy khi người dùng yêu cầu (manual update)
function checkForUpdates() {
  if (app.isPackaged) {
    console.log("🚀 Đang kiểm tra cập nhật...");
    autoUpdater.checkForUpdates().catch((error) => {
      console.error("Lỗi khi kiểm tra update:", error);
    });
  } else {
    console.log("⚠️ Chế độ development - bỏ qua kiểm tra update");
  }
}

// Tự động kiểm tra update sau 3 giây khi app khởi động
setTimeout(() => {
  checkForUpdates();
}, 3000);

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

    // Cập nhật settings
    projectData.settings = config;
    projectData.updatedAt = new Date().toISOString();

    fs.writeFileSync(projectPath, JSON.stringify(projectData, null, 2));
    return { success: true };
  } catch (error) {
    console.error("Error saving project config:", error);
    return { success: false, error: error.message };
  }
});

// IPC handler để load config của project
ipcMain.handle("load-project-config", async (event, projectName) => {
  try {
    if (!projectName || projectName.trim() === "") {
      return { success: true, config: {} };
    }

    const projectPath = getProjectConfigPath(projectName);
    if (!fs.existsSync(projectPath)) {
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
ipcMain.handle("get-current-project", async () => {
  try {
    const currentProjectPath = getCurrentProjectPath();
    if (!fs.existsSync(currentProjectPath)) {
      return { success: true, projectName: null };
    }

    const content = fs.readFileSync(currentProjectPath, "utf-8");
    const data = JSON.parse(content);
    return { success: true, projectName: data.projectName || null };
  } catch (error) {
    console.error("Error getting current project:", error);
    return { success: false, error: error.message, projectName: null };
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
ipcMain.handle("save-render-config", async (event, config) => {
  try {
    const configDir = getConfigDir();
    const configPath = path.join(configDir, ".render-config.json");
    // Đọc config hiện tại nếu có
    let currentConfig = {};
    if (fs.existsSync(configPath)) {
      try {
        const existingContent = fs.readFileSync(configPath, "utf-8");
        currentConfig = JSON.parse(existingContent);
      } catch (err) {
        console.error(`Error reading existing config: ${err.message}`);
      }
    }
    // Merge config mới với config hiện tại
    const mergedConfig = { ...currentConfig, ...config };
    fs.writeFileSync(configPath, JSON.stringify(mergedConfig, null, 2));
    return { success: true };
  } catch (err) {
    console.error(`Error saving render config: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// IPC handler để đọc render config từ file
ipcMain.handle("load-render-config", async () => {
  try {
    const configDir = getConfigDir();
    const configPath = path.join(configDir, ".render-config.json");
    if (!fs.existsSync(configPath)) {
      return { success: true, config: null };
    }
    const configContent = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(configContent);
    return { success: true, config };
  } catch (err) {
    console.error(`Error loading render config: ${err.message}`);
    return { success: false, error: err.message, config: null };
  }
});

// IPC handler để sync config files từ project settings
ipcMain.handle("sync-config-files", async (event, configs) => {
  try {
    const configDir = getConfigDir();
    const errors = [];

    // Sync download config
    if (configs.downloadConfig) {
      try {
        const configPath = path.join(configDir, ".download-config.json");
        fs.writeFileSync(
          configPath,
          JSON.stringify(configs.downloadConfig, null, 2)
        );
      } catch (err) {
        errors.push(`Download config: ${err.message}`);
      }
    }

    // Sync thumb config
    if (configs.thumbConfig) {
      try {
        const configPath = path.join(configDir, ".thumb-config.json");
        fs.writeFileSync(
          configPath,
          JSON.stringify(configs.thumbConfig, null, 2)
        );
      } catch (err) {
        errors.push(`Thumb config: ${err.message}`);
      }
    }

    // Sync video snow config
    if (configs.videoSnowConfig) {
      try {
        const configPath = path.join(configDir, ".video-snow-config.json");
        fs.writeFileSync(
          configPath,
          JSON.stringify(configs.videoSnowConfig, null, 2)
        );
      } catch (err) {
        errors.push(`Video snow config: ${err.message}`);
      }
    }

    // Sync trim config
    if (configs.trimConfig) {
      try {
        const configPath = path.join(configDir, ".trim-config.json");
        fs.writeFileSync(
          configPath,
          JSON.stringify(configs.trimConfig, null, 2)
        );
      } catch (err) {
        errors.push(`Trim config: ${err.message}`);
      }
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }
    return { success: true };
  } catch (err) {
    console.error(`Error syncing config files: ${err.message}`);
    return { success: false, error: err.message };
  }
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

        // Set environment variables để scripts biết đọc config và tìm node_modules
        // Phải khai báo env trước khi sử dụng
        const env = {
          ...process.env,
          CONFIG_DIR: configDir,
          ...options.env,
        };

        // Tạo config file cho các script nếu cần
        if (options.renderConfig) {
          try {
            // Sử dụng unique config file để tránh conflict khi chạy đồng thời
            const configPath = path.join(
              configDir,
              `.render-config-${jobId}.json`
            );
            fs.writeFileSync(
              configPath,
              JSON.stringify(options.renderConfig, null, 2)
            );
            // Set environment variable để script biết dùng config file nào
            env.RENDER_CONFIG_FILE = `.render-config-${jobId}.json`;
          } catch (err) {
            console.error(
              `Error creating render config file: ${getErrorMessage(err)}`
            );
            event.sender.send(
              "script-output",
              `⚠️ Cảnh báo: Lỗi khi tạo config file: ${getErrorMessage(err)}\n`
            );
          }
        }

        if (options.downloadConfig) {
          try {
            const configPath = path.join(configDir, ".download-config.json");
            fs.writeFileSync(
              configPath,
              JSON.stringify(options.downloadConfig, null, 2)
            );
          } catch (err) {
            console.error(
              `Error creating download config file: ${getErrorMessage(err)}`
            );
            event.sender.send(
              "script-output",
              `⚠️ Cảnh báo: Lỗi khi tạo config file: ${getErrorMessage(err)}\n`
            );
          }
        }

        if (options.trimConfig) {
          try {
            const configPath = path.join(configDir, ".trim-config.json");
            fs.writeFileSync(
              configPath,
              JSON.stringify(options.trimConfig, null, 2)
            );
          } catch (err) {
            console.error(
              `Error creating trim config file: ${getErrorMessage(err)}`
            );
            event.sender.send(
              "script-output",
              `⚠️ Cảnh báo: Lỗi khi tạo config file: ${getErrorMessage(err)}\n`
            );
          }
        }

        if (options.videoSnowConfig) {
          try {
            const configPath = path.join(configDir, ".video-snow-config.json");
            fs.writeFileSync(
              configPath,
              JSON.stringify(options.videoSnowConfig, null, 2)
            );
          } catch (err) {
            console.error(
              `Error creating video snow config file: ${getErrorMessage(err)}`
            );
            event.sender.send(
              "script-output",
              `⚠️ Cảnh báo: Lỗi khi tạo config file: ${getErrorMessage(err)}\n`
            );
          }
        }

        if (options.bgVideoConfig) {
          try {
            const configPath = path.join(configDir, ".bg-video-config.json");
            fs.writeFileSync(
              configPath,
              JSON.stringify(options.bgVideoConfig, null, 2)
            );
          } catch (err) {
            console.error(
              `Error creating bg video config file: ${getErrorMessage(err)}`
            );
            event.sender.send(
              "script-output",
              `⚠️ Cảnh báo: Lỗi khi tạo config file: ${getErrorMessage(err)}\n`
            );
          }
        }

        if (options.cutBgConfig) {
          try {
            const configPath = path.join(configDir, ".cut-bg-config.json");
            fs.writeFileSync(
              configPath,
              JSON.stringify(options.cutBgConfig, null, 2)
            );
          } catch (err) {
            console.error(
              `Error creating cut bg config file: ${getErrorMessage(err)}`
            );
            event.sender.send(
              "script-output",
              `⚠️ Cảnh báo: Lỗi khi tạo config file: ${getErrorMessage(err)}\n`
            );
          }
        }

        if (options.thumbConfig) {
          try {
            const configPath = path.join(configDir, ".thumb-config.json");
            fs.writeFileSync(
              configPath,
              JSON.stringify(options.thumbConfig, null, 2)
            );
          } catch (err) {
            console.error(
              `Error creating thumb config file: ${getErrorMessage(err)}`
            );
            event.sender.send(
              "script-output",
              `⚠️ Cảnh báo: Lỗi khi tạo config file: ${getErrorMessage(err)}\n`
            );
          }
        }

        if (options.normalizeConfig) {
          try {
            const configPath = path.join(configDir, ".normalize-config.json");
            fs.writeFileSync(
              configPath,
              JSON.stringify(options.normalizeConfig, null, 2)
            );
          } catch (err) {
            console.error(
              `Error creating normalize config file: ${getErrorMessage(err)}`
            );
            event.sender.send(
              "script-output",
              `⚠️ Cảnh báo: Lỗi khi tạo config file: ${getErrorMessage(err)}\n`
            );
          }
        }

        if (options.getUrlConfig) {
          try {
            const configPath = path.join(configDir, ".get-url-config.json");
            fs.writeFileSync(
              configPath,
              JSON.stringify(options.getUrlConfig, null, 2)
            );
          } catch (err) {
            console.error(
              `Error creating get url config file: ${getErrorMessage(err)}`
            );
            event.sender.send(
              "script-output",
              `⚠️ Cảnh báo: Lỗi khi tạo config file: ${getErrorMessage(err)}\n`
            );
          }
        }

        if (options.concatConfig) {
          try {
            const configPath = path.join(configDir, ".concat-config.json");
            fs.writeFileSync(
              configPath,
              JSON.stringify(options.concatConfig, null, 2)
            );
          } catch (err) {
            console.error(
              `Error creating concat config file: ${getErrorMessage(err)}`
            );
            event.sender.send(
              "script-output",
              `⚠️ Cảnh báo: Lỗi khi tạo config file: ${getErrorMessage(err)}\n`
            );
          }
        }

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
          // Cleanup: Xóa các config file tạm sau khi job hoàn thành
          try {
            // Xóa render config file nếu có
            if (options.renderConfig && env.RENDER_CONFIG_FILE) {
              const configPath = path.join(configDir, env.RENDER_CONFIG_FILE);
              if (fs.existsSync(configPath)) {
                fs.unlinkSync(configPath);
                console.log(`Đã xóa config file: ${env.RENDER_CONFIG_FILE}`);
              }
            }
            // Xóa các config file khác nếu có
            if (options.downloadConfig) {
              const downloadConfigPath = path.join(
                configDir,
                ".download-config.json"
              );
              if (fs.existsSync(downloadConfigPath)) {
                fs.unlinkSync(downloadConfigPath);
              }
            }
            if (options.trimConfig) {
              const trimConfigPath = path.join(configDir, ".trim-config.json");
              if (fs.existsSync(trimConfigPath)) {
                fs.unlinkSync(trimConfigPath);
              }
            }
            if (options.videoSnowConfig) {
              const videoSnowConfigPath = path.join(
                configDir,
                ".video-snow-config.json"
              );
              if (fs.existsSync(videoSnowConfigPath)) {
                fs.unlinkSync(videoSnowConfigPath);
              }
            }
            if (options.bgVideoConfig) {
              const bgVideoConfigPath = path.join(
                configDir,
                ".bg-video-config.json"
              );
              if (fs.existsSync(bgVideoConfigPath)) {
                fs.unlinkSync(bgVideoConfigPath);
              }
            }
          } catch (cleanupError) {
            console.warn(
              `Lỗi khi cleanup config files: ${cleanupError.message}`
            );
          }

          if (code === 0) {
            resolve({ success: true, output: stdout });
          } else {
            const errorMsg = stderr || `Script exited with code ${code}`;
            reject({ success: false, error: errorMsg, code });
          }
        });

        child.on("error", (error) => {
          // Cleanup config files khi có lỗi
          try {
            if (options.renderConfig && env.RENDER_CONFIG_FILE) {
              const configPath = path.join(configDir, env.RENDER_CONFIG_FILE);
              if (fs.existsSync(configPath)) {
                fs.unlinkSync(configPath);
              }
            }
          } catch (cleanupError) {
            console.warn(
              `Lỗi khi cleanup config files: ${cleanupError.message}`
            );
          }

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
