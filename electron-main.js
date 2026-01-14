import { spawn } from "child_process";
import { app, BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkLicense } from "./license-check.js";

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

app.whenReady().then(async () => {
  // Kiểm tra license trước khi mở window
  const canContinue = await checkLicenseBeforeStart();
  if (canContinue) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
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
        const jobId = options.jobId || `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Tạo config file cho các script nếu cần
        if (options.renderConfig) {
          try {
            // Sử dụng unique config file để tránh conflict khi chạy đồng thời
            const configPath = path.join(configDir, `.render-config-${jobId}.json`);
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
            path.join(process.resourcesPath, "app.asar.unpacked", "bin", "node.exe"),
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
              `Node executable không tìm thấy. Đã kiểm tra: ${possibleNodePaths.join(", ")}. Sử dụng 'node' từ PATH`
            );
          }
        }

        // Set environment variables để scripts biết đọc config và tìm node_modules
        const env = {
          ...process.env,
          CONFIG_DIR: configDir,
          ...options.env,
        };

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
          if (code === 0) {
            resolve({ success: true, output: stdout });
          } else {
            const errorMsg = stderr || `Script exited with code ${code}`;
            reject({ success: false, error: errorMsg, code });
          }
        });

        child.on("error", (error) => {
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
