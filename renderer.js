// Helper to check if electronAPI is available
function checkElectronAPI() {
  if (!window.electronAPI) {
    alert("Lỗi: Electron API chưa sẵn sàng. Vui lòng khởi động lại ứng dụng.");
    return false;
  }
  return true;
}

// Settings Menu Functions
function toggleSettingsMenu() {
  const dropdown = document.getElementById("settings-dropdown");
  const btn = document.getElementById("settings-btn");
  if (dropdown && btn) {
    const isActive = dropdown.classList.contains("active");
    if (isActive) {
      closeSettingsMenu();
    } else {
      // Tính toán vị trí dropdown
      const rect = btn.getBoundingClientRect();
      const dropdownWidth = 220; // min-width của dropdown
      const estimatedHeight = 250; // Ước tính chiều cao dropdown

      // Reset styles
      dropdown.style.maxHeight = "";
      dropdown.style.overflowY = "";

      // Tính vị trí right - căn chỉnh với cạnh phải của button
      const rightEdge = window.innerWidth - rect.right;
      dropdown.style.right = rightEdge + "px";
      dropdown.style.left = "auto";

      // Kiểm tra và điều chỉnh nếu dropdown bị tràn ra ngoài
      const leftEdge = rect.right - dropdownWidth;
      if (leftEdge < 20) {
        // Nếu không đủ chỗ bên trái, đặt cách lề phải 20px
        dropdown.style.right = "20px";
      }

      // Tính vị trí top/bottom
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;

      if (spaceAbove >= estimatedHeight + 20) {
        // Có đủ chỗ ở trên, hiển thị ở trên
        dropdown.style.top = rect.top - estimatedHeight - 8 + "px";
        dropdown.style.bottom = "auto";
      } else if (spaceBelow >= estimatedHeight + 20) {
        // Có đủ chỗ ở dưới, hiển thị ở dưới
        dropdown.style.top = rect.bottom + 8 + "px";
        dropdown.style.bottom = "auto";
      } else {
        // Không đủ chỗ, hiển thị ở trên với scroll
        dropdown.style.top =
          Math.max(20, rect.top - estimatedHeight - 8) + "px";
        dropdown.style.bottom = "auto";
        dropdown.style.maxHeight = window.innerHeight - 40 + "px";
        dropdown.style.overflowY = "auto";
      }

      dropdown.style.zIndex = "99999";
      dropdown.style.position = "fixed";

      dropdown.classList.add("active");
      btn.classList.add("active");
    }
  }
}

function closeSettingsMenu() {
  const dropdown = document.getElementById("settings-dropdown");
  const btn = document.getElementById("settings-btn");
  if (dropdown && btn) {
    dropdown.classList.remove("active");
    btn.classList.remove("active");
  }
}

// Đóng settings menu khi click bên ngoài
document.addEventListener("click", function (event) {
  const settingsWrapper = document.querySelector(".settings-menu-wrapper");
  const dropdown = document.getElementById("settings-dropdown");
  if (settingsWrapper && dropdown && !settingsWrapper.contains(event.target)) {
    closeSettingsMenu();
  }
});

// Settings Menu Functions
function toggleSettingsMenu() {
  const dropdown = document.getElementById("settings-dropdown");
  const btn = document.getElementById("settings-btn");
  if (dropdown && btn) {
    const isActive = dropdown.classList.contains("active");
    if (isActive) {
      closeSettingsMenu();
    } else {
      dropdown.classList.add("active");
      btn.classList.add("active");
    }
  }
}

function closeSettingsMenu() {
  const dropdown = document.getElementById("settings-dropdown");
  const btn = document.getElementById("settings-btn");
  if (dropdown && btn) {
    dropdown.classList.remove("active");
    btn.classList.remove("active");
  }
}

// Đóng settings menu khi click bên ngoài
if (typeof document !== "undefined") {
  document.addEventListener("click", function (event) {
    const settingsWrapper = document.querySelector(".settings-menu-wrapper");
    const dropdown = document.getElementById("settings-dropdown");
    if (
      settingsWrapper &&
      dropdown &&
      !settingsWrapper.contains(event.target)
    ) {
      closeSettingsMenu();
    }
  });
}

// Mở cửa sổ mới để chạy job đồng thời
async function openNewWindow() {
  if (!checkElectronAPI()) return;

  try {
    await window.electronAPI.openNewWindow();
    // Có thể thêm thông báo nếu muốn
  } catch (error) {
    alert(`Lỗi khi mở cửa sổ mới: ${getErrorMessage(error)}`);
  }
}

// Kiểm tra cập nhật ứng dụng (thủ công)
async function checkForAppUpdate() {
  if (!checkElectronAPI()) return;

  // Đánh dấu là check thủ công để hiển thị dialog khi không có update
  window.updateCheckManual = true;

  // Hiển thị notification nhỏ khi đang check (không phải dialog)
  const statusMsg = document.createElement("div");
  statusMsg.id = "update-checking-notification";
  statusMsg.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
    z-index: 10000;
    font-size: 14px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 10px;
    animation: slideInRight 0.3s ease-out;
  `;
  statusMsg.innerHTML =
    '<span style="font-size: 20px;">🔄</span> <span>Đang kiểm tra cập nhật...</span>';
  document.body.appendChild(statusMsg);

  try {
    const result = await window.electronAPI.checkForUpdates();

    // Xóa notification sau 1 giây (để user thấy đã check xong)
    setTimeout(() => {
      if (statusMsg.parentNode) {
        statusMsg.style.animation = "slideOutRight 0.3s ease-out";
        setTimeout(() => {
          if (statusMsg.parentNode) {
            statusMsg.parentNode.removeChild(statusMsg);
          }
        }, 300);
      }
    }, 1000);

    if (!result.success) {
      // Nếu có lỗi, hiển thị dialog error
      showUpdateDialog("error", {
        message: result.message || "Lỗi khi kiểm tra cập nhật",
      });
    }
    // Nếu success, dialog sẽ được hiển thị từ event listeners (available/not-available)
  } catch (error) {
    // Xóa notification nếu có lỗi
    if (statusMsg.parentNode) {
      statusMsg.parentNode.removeChild(statusMsg);
    }
    // Hiển thị dialog error
    showUpdateDialog("error", {
      message: "Lỗi: " + getErrorMessage(error),
    });
  }
}

// Update Dialog Management
let currentUpdateVersion = null;

function showUpdateDialog(type, data) {
  const dialog = document.getElementById("update-dialog");
  const icon = document.getElementById("update-dialog-icon");
  const title = document.getElementById("update-dialog-title");
  const message = document.getElementById("update-message");
  const releaseNotes = document.getElementById("update-release-notes");
  const progressContainer = document.getElementById(
    "update-progress-container",
  );
  const progressFill = document.getElementById("update-progress-fill");
  const progressText = document.getElementById("update-progress-text");
  const actions = document.getElementById("update-actions");
  const btnPrimary = document.getElementById("update-btn-primary");
  const btnSecondary = document.getElementById("update-btn-secondary");

  // Reset btnSecondary về hiển thị mặc định
  btnSecondary.style.display = "block";

  if (type === "available") {
    currentUpdateVersion = data.version;
    icon.textContent = "🔄";
    icon.style.display = "block";
    title.textContent = "Cập nhật có sẵn";
    message.innerHTML = `<strong>Phiên bản mới ${
      data.version
    } đã có sẵn!</strong>${
      data.releaseNotes ? "\n\n" + data.releaseNotes : ""
    }`;

    if (data.releaseNotes) {
      releaseNotes.textContent = data.releaseNotes;
      releaseNotes.style.display = "block";
    } else {
      releaseNotes.style.display = "none";
    }

    progressContainer.classList.remove("active");
    btnPrimary.textContent = "Tải về ngay";
    btnPrimary.onclick = () => {
      btnPrimary.disabled = true;
      btnSecondary.disabled = true;
      progressContainer.classList.add("active");
      if (checkElectronAPI() && window.electronAPI) {
        window.electronAPI.downloadUpdate();
      }
    };
    btnSecondary.textContent = "Để sau";
    btnSecondary.onclick = () => {
      dialog.classList.remove("active");
    };
    btnPrimary.disabled = false;
    btnSecondary.disabled = false;
    dialog.classList.add("active");
  } else if (type === "downloaded") {
    icon.textContent = "✅";
    title.textContent = "Cập nhật đã sẵn sàng";
    message.innerHTML = `<strong>Phiên bản ${data.version} đã được tải về thành công!</strong>\n\nỨng dụng sẽ khởi động lại để cài đặt cập nhật.`;
    releaseNotes.style.display = "none";
    progressContainer.classList.remove("active");
    btnPrimary.textContent = "Khởi động lại ngay";
    btnPrimary.onclick = () => {
      if (checkElectronAPI() && window.electronAPI) {
        window.electronAPI.installUpdate();
      }
    };
    btnSecondary.textContent = "Để sau";
    btnSecondary.onclick = () => {
      dialog.classList.remove("active");
    };
    btnPrimary.disabled = false;
    btnSecondary.disabled = false;
    dialog.classList.add("active");
  } else if (type === "update-success") {
    icon.textContent = "🎉";
    title.textContent = "Cập nhật thành công!";
    message.innerHTML = `<strong>Đã cập nhật lên phiên bản ${data.version}</strong>\n\nỨng dụng đã được cập nhật thành công.`;
    releaseNotes.style.display = "none";
    progressContainer.classList.remove("active");
    btnPrimary.textContent = "Tuyệt vời!";
    btnPrimary.onclick = () => {
      dialog.classList.remove("active");
    };
    btnSecondary.style.display = "none";
    btnPrimary.disabled = false;
    dialog.classList.add("active");
  } else if (type === "not-available") {
    icon.textContent = "✅";
    icon.style.display = "block";
    title.textContent = "Đã là phiên bản mới nhất";
    const currentVersion = data.version || "N/A";
    message.innerHTML = `<strong>Bạn đang sử dụng phiên bản mới nhất!</strong><br><br>Phiên bản hiện tại: <span style="color: #667eea; font-weight: 600;">${currentVersion}</span>`;
    releaseNotes.style.display = "none";
    progressContainer.classList.remove("active");
    btnPrimary.textContent = "Tuyệt vời!";
    btnPrimary.onclick = () => {
      dialog.classList.remove("active");
    };
    btnSecondary.style.display = "none";
    btnPrimary.disabled = false;
    dialog.classList.add("active");
  } else if (type === "error") {
    icon.textContent = "❌";
    icon.style.display = "block";
    title.textContent = "Lỗi cập nhật";
    message.innerHTML = `<strong>Đã xảy ra lỗi khi cập nhật</strong><br><br><span style="color: #dc3545;">${
      data.message || "Lỗi không xác định"
    }</span>`;
    releaseNotes.style.display = "none";
    progressContainer.classList.remove("active");
    btnPrimary.textContent = "Đóng";
    btnPrimary.onclick = () => {
      dialog.classList.remove("active");
    };
    btnSecondary.style.display = "none";
    btnPrimary.disabled = false;
    dialog.classList.add("active");
  }
}

function updateProgress(percent, transferred, total) {
  const progressFill = document.getElementById("update-progress-fill");
  const progressText = document.getElementById("update-progress-text");

  progressFill.style.width = `${percent}%`;
  progressFill.textContent = `${percent}%`;

  const transferredMB = (transferred / 1024 / 1024).toFixed(1);
  const totalMB = (total / 1024 / 1024).toFixed(1);
  progressText.textContent = `Đang tải: ${transferredMB} MB / ${totalMB} MB (${percent}%)`;
}

// Setup listeners cho update status - sẽ được gọi trong DOMContentLoaded
function setupUpdateListeners() {
  console.log("🔧 Setting up update listeners...");

  if (
    typeof window !== "undefined" &&
    window.electronAPI &&
    window.electronAPI.onUpdateStatus
  ) {
    console.log("✅ ElectronAPI available, setting up listeners");

    // Listen for update status
    window.electronAPI.onUpdateStatus((data) => {
      console.log("📨 Update status received:", data);

      // Hiển thị custom dialog đẹp thay vì alert
      if (data.status === "available") {
        console.log("✅ Update available, showing dialog");
        showUpdateDialog("available", data);
      } else if (data.status === "downloaded") {
        console.log("✅ Update downloaded, showing dialog");
        showUpdateDialog("downloaded", data);
      } else if (data.status === "update-success") {
        console.log("🎉 Update success, showing dialog");
        showUpdateDialog("update-success", data);
      } else if (data.status === "not-available") {
        console.log("ℹ️ No update available");
        // Chỉ hiển thị dialog khi check thủ công, không hiển thị khi auto check
        if (window.updateCheckManual) {
          showUpdateDialog("not-available", data);
          window.updateCheckManual = false;
        }
      } else if (data.status === "error") {
        console.error("❌ Update error:", data.message);
        showUpdateDialog("error", data);
      } else if (data.status === "checking") {
        console.log("🔍 Checking for updates...");
      }
    });

    // Listen for update progress
    if (window.electronAPI.onUpdateProgress) {
      window.electronAPI.onUpdateProgress((data) => {
        console.log(`📥 Update progress: ${data.percent}%`);
        updateProgress(data.percent, data.transferred || 0, data.total || 0);
      });
    }
  } else {
    console.warn("⚠️ ElectronAPI not available for update listeners");
  }
}

// Setup listeners ngay khi script load (trước DOMContentLoaded)
// Để đảm bảo listeners sẵn sàng khi electron-main gửi messages
if (typeof window !== "undefined") {
  // Thử setup ngay nếu electronAPI đã sẵn
  if (window.electronAPI) {
    setupUpdateListeners();
  } else {
    // Nếu chưa sẵn, đợi một chút rồi thử lại
    setTimeout(() => {
      if (window.electronAPI) {
        setupUpdateListeners();
      }
    }, 500);
  }
}

// Helper to extract error message from error object
function getErrorMessage(error) {
  if (!error) return "Lỗi không xác định";
  if (typeof error === "string") return error;
  if (error.error) return String(error.error);
  if (error.message) return String(error.message);
  if (error.toString) return error.toString();
  return String(error);
}

// Hàm xử lý khi bật/tắt GPU - tự động phát hiện codec
async function handleGpuToggle() {
  const useGpuCheckbox = document.getElementById("render-use-gpu");
  const gpuCodecInput = document.getElementById("render-gpu-codec");
  const gpuCodecGroup = document.getElementById("render-gpu-codec-group");
  
  if (!useGpuCheckbox || !gpuCodecInput) return;
  
  // Hiển thị/ẩn field GPU codec
  if (gpuCodecGroup) {
    gpuCodecGroup.style.display = useGpuCheckbox.checked ? "block" : "none";
  }
  
  if (useGpuCheckbox.checked) {
    // Khi bật GPU, tự động phát hiện codec
    if (checkElectronAPI() && window.electronAPI) {
      try {
        gpuCodecInput.value = "Đang phát hiện...";
        const result = await window.electronAPI.detectGpuCodec();
        if (result.success && result.codec) {
          gpuCodecInput.value = result.codec;
          console.log(`✅ Đã tự động phát hiện GPU codec: ${result.codec}`);
          saveSettings();
        } else {
          // Nếu không phát hiện được GPU, tắt checkbox và cảnh báo
          useGpuCheckbox.checked = false;
          if (gpuCodecGroup) {
            gpuCodecGroup.style.display = "none";
          }
          alert("⚠️ Không phát hiện GPU encoder nào trên hệ thống. Vui lòng kiểm tra driver GPU hoặc sử dụng CPU.");
          saveSettings();
        }
      } catch (error) {
        console.error("Lỗi khi phát hiện GPU codec:", error);
        // Nếu có lỗi, vẫn giữ giá trị mặc định
        if (!gpuCodecInput.value || gpuCodecInput.value === "Đang phát hiện...") {
          gpuCodecInput.value = "h264_nvenc";
        }
      }
    }
  } else {
    // Khi tắt GPU, xóa giá trị codec
    gpuCodecInput.value = "";
  }
}

// Settings management
async function saveSettings() {
  const settings = {
    // Render settings
    render: {
      day: document.getElementById("render-day")?.value || "1",
      videos: document.getElementById("render-videos")?.value || "1",
      videoSpeed: document.getElementById("render-video-speed")?.value || "0.95",
      renderMode:
        document.querySelector('input[name="render-mode"]:checked')?.value ||
        "topTransparent",
      opacity: document.getElementById("render-opacity")?.value || "0.7",
      chromaKeyMode:
        document.querySelector('input[name="chromakey-mode"]:checked')?.value ||
        "color",
      chromaKeyColor:
        document.getElementById("render-chromakey-color")?.value || "D4F9D7",
      chromaKeySimilarity:
        document.getElementById("render-chromakey-similarity")?.value || "0.3",
      keepColorColors:
        document.getElementById("render-keepcolor-colors")?.value || "FBFF02",
      keepColorCrop:
        document.getElementById("render-keepcolor-crop")?.checked || false,
      keepColorHeight:
        document.getElementById("render-keepcolor-height")?.value || "220",
      keepColorYOffset:
        document.getElementById("render-keepcolor-y-offset")?.value || "490",
      keepColorAddDarkLayer:
        document.getElementById("render-keepcolor-add-dark-layer")?.checked || false,
      useGPU: document.getElementById("render-use-gpu")?.checked || false,
      maxConcurrentProcesses:
        document.getElementById("render-max-concurrent")?.value || "2",
      gpuVideoCodec:
        document.getElementById("render-gpu-codec")?.value || "h264_nvenc",
      height: document.getElementById("render-height")?.value || "220",
      y_offset: document.getElementById("render-y-offset")?.value || "490",
      overlayFolder: selectedRenderOverlayFolder,
      backgroundFolder: selectedRenderBackgroundFolder,
      outputFolder: selectedRenderOutputFolder,
      chromaKeyFile: selectedRenderChromaKeyFile,
      cycleDays: document.getElementById("render-cycle-days")?.value || "1",
    },
    // Download settings
    download: {
      urlsFile: selectedUrlsFile,
      outputFolder: selectedDownloadOutputFolder,
      descFolder: selectedDownloadDescFolder,
      overlayImagesFolder: selectedDownloadOverlayImagesFolder,
      thumbsFolder: selectedDownloadThumbsFolder,
      cookiesFile: selectedDownloadCookiesFile,
      maxConcurrent: document.getElementById("download-max-concurrent")?.value || "2",
      proxy: (() => {
        const proxyInput = document.getElementById("download-proxy");
        const proxyValue = proxyInput?.value?.trim();
        // Nếu input field có giá trị, dùng giá trị đó (ưu tiên nhất)
        if (proxyValue) {
          return proxyValue;
        }
        // Nếu input field trống, trả về null (để xóa proxy khỏi config)
        return null;
      })(),
      downloadDrive: selectedDownloadDrive || false,
      driveLanguage: selectedDriveLanguage || "jp",
    },
    // Stock Download (Pexels & Pixabay) settings
    stockDownload: {
      usePexels: document.getElementById("stock-use-pexels")?.checked ?? false,
      usePixabay: document.getElementById("stock-use-pixabay")?.checked ?? false,
      pexelsApiKey: document.getElementById("stock-pexels-api-key")?.value?.trim() || "",
      pixabayApiKey: document.getElementById("stock-pixabay-api-key")?.value?.trim() || "",
      searchQuery: document.getElementById("stock-search-query")?.value?.trim() || "",
      maxVideos: document.getElementById("stock-max-videos")?.value || "30",
      outputFolder: selectedStockOutputFolder || "",
      orientation: document.getElementById("stock-orientation")?.value || "landscape",
      convert720: document.getElementById("stock-convert-720")?.checked ?? true,
      removeAudio: document.getElementById("stock-remove-audio")?.checked ?? true,
      cut: document.getElementById("stock-cut")?.checked ?? false,
      trimSeconds: document.getElementById("stock-trim-seconds")?.value || "3",
    },
    // Video Snow settings
    videoSnow: {
      inputFolder: selectedVideoSnowInputFolder,
      outputFolder: selectedVideoSnowOutputFolder,
      snowFile: selectedVideoSnowSnowFile,
      maxConcurrent:
        document.getElementById("video-snow-max-concurrent")?.value || "3",
      segmentMin:
        document.getElementById("video-snow-segment-min")?.value || "10",
      segmentMax:
        document.getElementById("video-snow-segment-max")?.value || "15",
    },
    // Background Video settings
    bgVideo: {
      count: document.getElementById("bg-count")?.value || "3",
      inputFolder: selectedBgInputFolder,
      outputFolder: selectedBgOutputFolder,
      targetDuration:
        document.getElementById("bg-target-duration")?.value || "3600",
      sourceCount: document.getElementById("bg-source-count")?.value || "10",
      avgClipDuration:
        document.getElementById("bg-avg-clip-duration")?.value || "12",
    },
    // Trim settings
    trim: {
      inputFolder: selectedTrimInputFolder,
      outputFolder: selectedTrimOutputFolder,
      startTime: document.getElementById("trim-start-time")?.value || "0",
      duration: document.getElementById("trim-duration")?.value || "30",
    },
    // Cut BG settings
    cutBg: {
      inputFolder: selectedCutBgInputFolder,
      outputFolder: selectedCutBgOutputFolder,
      darken: document.getElementById("cut-bg-darken")?.value || "",
      blur: document.getElementById("cut-bg-blur")?.value || "",
      useGPU: document.getElementById("cut-bg-use-gpu")?.checked || false,
      maxConcurrent:
        document.getElementById("cut-bg-max-concurrent")?.value || "2",
    },
    // Thumb settings
    thumb: {
      inputFolder: selectedThumbInputFolder,
      overlayFolder: selectedThumbOverlayFolder,
      outputFolder: selectedThumbOutputFolder,
    },
    // Get URL settings
    getUrl: {
      handle: document.getElementById("channel-handle")?.value || "",
      outputFolder: selectedGetUrlOutputFolder,
    },
    // Normalize settings
    normalize: {
      inputFolder: selectedNormalizeInputFolder,
    },
    // Concat settings
    concat: {
      chunkSize: document.getElementById("concat-chunk-size")?.value || "2",
      useThumbs: document.getElementById("concat-use-thumbs")?.checked ?? true,
      thumbDuration:
        document.getElementById("concat-thumb-duration")?.value || "3",
      inputFolder: selectedConcatInputFolder,
      thumbsFolder: selectedConcatThumbsFolder,
      outputFolder: selectedConcatOutputFolder,
    },
  };

  // Lưu vào localStorage (backup)
  localStorage.setItem("cutVideoAppSettings", JSON.stringify(settings));

  // Luôn lưu vào project config (mặc định là "default")
  const projectToSave = currentProjectName || "default";
  if (checkElectronAPI() && window.electronAPI) {
    try {
      await window.electronAPI.saveProjectConfig(projectToSave, settings);
      console.log(`Đã lưu settings vào project: ${projectToSave}`);
    } catch (error) {
      console.error("Error saving project config:", error);
    }
  }

  // Không còn lưu render config vào file riêng lẻ nữa
  // Tất cả config đã được lưu trong project JSON ở trên
}

async function loadSettings() {
  try {
    // Luôn load từ project config (mặc định là "default")
    let settings = {};
    // Đảm bảo có project được chọn (mặc định là "default")
    const projectToLoad = currentProjectName || "default";
    
    if (checkElectronAPI() && window.electronAPI) {
      try {
        const result =
          await window.electronAPI.loadProjectConfig(projectToLoad);
        if (result.success && result.config) {
          settings = result.config;
          console.log(
            `Loaded settings from project: ${projectToLoad}`,
            settings,
          );
        }
      } catch (error) {
        console.error("Error loading project config:", error);
      }
    }

    // Fallback: Nếu không có config từ project, đọc từ localStorage (tạm thời giữ lại để tương thích)
    if (Object.keys(settings).length === 0) {
      const saved = localStorage.getItem("cutVideoAppSettings");
      if (saved) {
        try {
          settings = JSON.parse(saved);
          console.log("Loaded settings from localStorage (fallback)");
          // Lưu settings từ localStorage vào project "default"
          if (checkElectronAPI() && window.electronAPI && projectToLoad === "default") {
            await window.electronAPI.saveProjectConfig("default", settings);
            localStorage.removeItem("cutVideoAppSettings"); // Xóa sau khi migrate
          }
        } catch (e) {
          console.error("Error parsing localStorage settings:", e);
        }
      }
    }

    // Không còn dùng file config riêng lẻ nữa - tất cả đều trong project JSON

    // Load Render settings
    if (settings.render) {
      if (settings.render.day)
        document.getElementById("render-day").value = settings.render.day;
      if (settings.render.videos)
        document.getElementById("render-videos").value = settings.render.videos;
      if (settings.render.videoSpeed)
        document.getElementById("render-video-speed").value = settings.render.videoSpeed;
      if (settings.render.cycleDays != null)
        document.getElementById("render-cycle-days").value = settings.render.cycleDays;
   
      if (settings.render.renderMode) {
        // Map renderMode value to actual radio button ID (HTML uses kebab-case)
        const modeIdMap = {
          topTransparent: "render-mode-top-transparent",
          chromaKey: "render-mode-chromakey",
          crop: "render-mode-crop",
          keepColor: "render-mode-keepcolor",
        };
        const modeId =
          modeIdMap[settings.render.renderMode] ||
          `render-mode-${settings.render.renderMode}`;
        const modeRadio = document.getElementById(modeId);
        if (modeRadio) {
          modeRadio.checked = true;
          toggleRenderMode();
        } else {
          // Fallback: try to find by value attribute
          const radioByValue = document.querySelector(
            `input[name="render-mode"][value="${settings.render.renderMode}"]`,
          );
          if (radioByValue) {
            radioByValue.checked = true;
            toggleRenderMode();
          }
        }
      }
      if (settings.render.opacity)
        document.getElementById("render-opacity").value =
          settings.render.opacity;
      if (settings.render.chromaKeyMode) {
        document.getElementById(
          settings.render.chromaKeyMode === "color"
            ? "chromakey-color"
            : "chromakey-file",
        ).checked = true;
        toggleChromaKeyMode();
      }
      if (settings.render.chromaKeyColor)
        document.getElementById("render-chromakey-color").value =
          settings.render.chromaKeyColor;
      if (settings.render.chromaKeySimilarity)
        document.getElementById("render-chromakey-similarity").value =
          settings.render.chromaKeySimilarity;
      if (settings.render.keepColorColors)
        document.getElementById("render-keepcolor-colors").value =
          settings.render.keepColorColors;
      if (settings.render.keepColorCrop !== undefined) {
        document.getElementById("render-keepcolor-crop").checked =
          settings.render.keepColorCrop;
        toggleKeepColorCrop();
      }
      if (settings.render.keepColorHeight)
        document.getElementById("render-keepcolor-height").value =
          settings.render.keepColorHeight;
      if (settings.render.keepColorYOffset)
        document.getElementById("render-keepcolor-y-offset").value =
          settings.render.keepColorYOffset;
      if (settings.render.keepColorAddDarkLayer !== undefined) {
        document.getElementById("render-keepcolor-add-dark-layer").checked =
          settings.render.keepColorAddDarkLayer;
      }
      if (settings.render.useGPU !== undefined) {
        document.getElementById("render-use-gpu").checked =
          settings.render.useGPU;
        // Cập nhật hiển thị field GPU codec
        const gpuCodecGroup = document.getElementById("render-gpu-codec-group");
        if (gpuCodecGroup) {
          gpuCodecGroup.style.display = settings.render.useGPU ? "block" : "none";
        }
      }
      if (settings.render.maxConcurrentProcesses)
        document.getElementById("render-max-concurrent").value =
          settings.render.maxConcurrentProcesses;
      if (settings.render.gpuVideoCodec)
        document.getElementById("render-gpu-codec").value =
          settings.render.gpuVideoCodec;
      if (settings.render.height)
        document.getElementById("render-height").value = settings.render.height;
      if (settings.render.y_offset)
        document.getElementById("render-y-offset").value =
          settings.render.y_offset;

      if (settings.render.overlayFolder) {
        selectedRenderOverlayFolder = settings.render.overlayFolder;
        document.getElementById("render-overlay-folder").value =
          settings.render.overlayFolder;
        // Removed folder path display
      }
      if (settings.render.backgroundFolder) {
        selectedRenderBackgroundFolder = settings.render.backgroundFolder;
        document.getElementById("render-background-folder").value =
          settings.render.backgroundFolder;
        // Removed folder path display
      }
      if (settings.render.outputFolder) {
        selectedRenderOutputFolder = settings.render.outputFolder;
        document.getElementById("render-output-folder").value =
          settings.render.outputFolder;
        // Removed folder path display
      }
      if (settings.render.chromaKeyFile) {
        selectedRenderChromaKeyFile = settings.render.chromaKeyFile;
        document.getElementById("render-chromakey-file").value =
          settings.render.chromaKeyFile;
        // Removed folder path display
      }
    }

    // Load Download settings
    if (settings.download) {
      if (settings.download.urlsFile) {
        selectedUrlsFile = settings.download.urlsFile;
        document.getElementById("download-urls-file").value =
          settings.download.urlsFile;
        // Removed folder path display
      }
      if (settings.download.outputFolder) {
        selectedDownloadOutputFolder = settings.download.outputFolder;
        document.getElementById("download-output-folder").value =
          settings.download.outputFolder;
        // Removed folder path display
      }
      if (settings.download.descFolder) {
        selectedDownloadDescFolder = settings.download.descFolder;
        const el = document.getElementById("download-desc-folder");
        if (el) el.value = settings.download.descFolder;
      }
      if (settings.download.overlayImagesFolder) {
        selectedDownloadOverlayImagesFolder =
          settings.download.overlayImagesFolder;
        document.getElementById("download-overlay-images-folder").value =
          settings.download.overlayImagesFolder;
        // Removed folder path display
      }
      if (settings.download.thumbsFolder) {
        selectedDownloadThumbsFolder = settings.download.thumbsFolder;
        document.getElementById("download-thumbs-folder").value =
          settings.download.thumbsFolder;
        // Removed folder path display
      }
      if (settings.download.cookiesFile) {
        selectedDownloadCookiesFile = settings.download.cookiesFile;
        document.getElementById("download-cookies-file").value =
          settings.download.cookiesFile;
        // Removed folder path display
      }
      if (settings.download.maxConcurrent) {
        document.getElementById("download-max-concurrent").value =
          settings.download.maxConcurrent;
      }
      // Chỉ restore proxy nếu có giá trị hợp lệ (không phải null, undefined, hoặc empty string)
      if (settings.download.proxy !== undefined && settings.download.proxy !== null) {
        const proxyValue = settings.download.proxy.toString().trim();
        if (proxyValue) {
          selectedDownloadProxy = proxyValue;
          const proxyInput = document.getElementById("download-proxy");
          if (proxyInput) {
            proxyInput.value = proxyValue;
          }
        } else {
          // Nếu proxy là empty string, clear nó
          selectedDownloadProxy = null;
          const proxyInput = document.getElementById("download-proxy");
          if (proxyInput) {
            proxyInput.value = "";
          }
        }
      } else {
        // Nếu proxy là null hoặc undefined, clear nó
        selectedDownloadProxy = null;
        const proxyInput = document.getElementById("download-proxy");
        if (proxyInput) {
          proxyInput.value = "";
        }
      }
      if (settings.download.downloadDrive !== undefined) {
        selectedDownloadDrive = settings.download.downloadDrive;
        const driveCheckbox = document.getElementById("download-drive");
        if (driveCheckbox) {
          driveCheckbox.checked = settings.download.downloadDrive;
          // Hiển thị/ẩn dropdown ngôn ngữ
          const languageGroup = document.getElementById("drive-language-group");
          if (languageGroup) {
            languageGroup.style.display = settings.download.downloadDrive
              ? "block"
              : "none";
          }
        }
      }
      if (settings.download.driveLanguage !== undefined) {
        selectedDriveLanguage = settings.download.driveLanguage;
        const languageSelect = document.getElementById("drive-language");
        if (languageSelect) {
          languageSelect.value = settings.download.driveLanguage;
        }
      }
    }

    // Load Stock Download (Pexels & Pixabay) settings
    if (settings.stockDownload) {
      const sd = settings.stockDownload;
      if (sd.usePexels !== undefined) {
        const cb = document.getElementById("stock-use-pexels");
        if (cb) {
          cb.checked = sd.usePexels;
          toggleStockPexels();
        }
      }
      if (sd.usePixabay !== undefined) {
        const cb = document.getElementById("stock-use-pixabay");
        if (cb) {
          cb.checked = sd.usePixabay;
          toggleStockPixabay();
        }
      }
      if (sd.pexelsApiKey !== undefined) {
        const input = document.getElementById("stock-pexels-api-key");
        if (input) input.value = sd.pexelsApiKey;
      }
      if (sd.pixabayApiKey !== undefined) {
        const input = document.getElementById("stock-pixabay-api-key");
        if (input) input.value = sd.pixabayApiKey;
      }
      if (sd.searchQuery !== undefined) {
        const input = document.getElementById("stock-search-query");
        if (input) input.value = sd.searchQuery;
      }
      if (sd.maxVideos !== undefined) {
        const input = document.getElementById("stock-max-videos");
        if (input) input.value = sd.maxVideos;
      }
      if (sd.outputFolder) {
        selectedStockOutputFolder = sd.outputFolder;
        const input = document.getElementById("stock-output-folder");
        if (input) input.value = sd.outputFolder;
      }
      if (sd.orientation !== undefined) {
        const sel = document.getElementById("stock-orientation");
        if (sel) sel.value = sd.orientation;
      }
      if (sd.convert720 !== undefined) {
        const el = document.getElementById("stock-convert-720");
        if (el) el.checked = sd.convert720;
      }
      if (sd.removeAudio !== undefined) {
        const el = document.getElementById("stock-remove-audio");
        if (el) el.checked = sd.removeAudio;
      }
      if (sd.cut !== undefined) {
        const el = document.getElementById("stock-cut");
        if (el) {
          el.checked = sd.cut;
          toggleStockCut();
        }
      }
      if (sd.trimSeconds !== undefined) {
        const el = document.getElementById("stock-trim-seconds");
        if (el) el.value = sd.trimSeconds;
      }
    }

    // Load Video Snow settings
    if (settings.videoSnow) {
      if (settings.videoSnow.inputFolder) {
        selectedVideoSnowInputFolder = settings.videoSnow.inputFolder;
        document.getElementById("video-snow-input-folder").value =
          settings.videoSnow.inputFolder;
        // Removed folder path display
      }
      if (settings.videoSnow.outputFolder) {
        selectedVideoSnowOutputFolder = settings.videoSnow.outputFolder;
        document.getElementById("video-snow-output-folder").value =
          settings.videoSnow.outputFolder;
        // Removed folder path display
      }
      if (settings.videoSnow.snowFile) {
        selectedVideoSnowSnowFile = settings.videoSnow.snowFile;
        document.getElementById("video-snow-snow-file").value =
          settings.videoSnow.snowFile;
        // Removed folder path display
      }
      if (settings.videoSnow.maxConcurrent) {
        document.getElementById("video-snow-max-concurrent").value =
          settings.videoSnow.maxConcurrent;
      }
      if (settings.videoSnow.segmentMin) {
        document.getElementById("video-snow-segment-min").value =
          settings.videoSnow.segmentMin;
      }
      if (settings.videoSnow.segmentMax) {
        document.getElementById("video-snow-segment-max").value =
          settings.videoSnow.segmentMax;
      }
    }

    // Load Background Video settings
    if (settings.bgVideo) {
      if (settings.bgVideo.count)
        document.getElementById("bg-count").value = settings.bgVideo.count;
      if (settings.bgVideo.inputFolder) {
        selectedBgInputFolder = settings.bgVideo.inputFolder;
        document.getElementById("bg-input-folder").value =
          settings.bgVideo.inputFolder;
        // Removed folder path display
      }
      if (settings.bgVideo.outputFolder) {
        selectedBgOutputFolder = settings.bgVideo.outputFolder;
        document.getElementById("bg-output-folder").value =
          settings.bgVideo.outputFolder;
        // Removed folder path display
      }
      if (settings.bgVideo.targetDuration) {
        document.getElementById("bg-target-duration").value =
          settings.bgVideo.targetDuration;
      }
      if (settings.bgVideo.sourceCount) {
        document.getElementById("bg-source-count").value =
          settings.bgVideo.sourceCount;
      }
      if (settings.bgVideo.avgClipDuration) {
        document.getElementById("bg-avg-clip-duration").value =
          settings.bgVideo.avgClipDuration;
      }
    }

    // Load Trim settings
    if (settings.trim) {
      if (settings.trim.inputFolder) {
        selectedTrimInputFolder = settings.trim.inputFolder;
        document.getElementById("trim-input-folder").value =
          settings.trim.inputFolder;
        // Removed folder path display
      }
      if (settings.trim.outputFolder) {
        selectedTrimOutputFolder = settings.trim.outputFolder;
        document.getElementById("trim-output-folder").value =
          settings.trim.outputFolder;
        // Removed folder path display
      }
      if (settings.trim.startTime)
        document.getElementById("trim-start-time").value =
          settings.trim.startTime;
      if (settings.trim.duration)
        document.getElementById("trim-duration").value = settings.trim.duration;
    }

    // Load Cut BG settings
    if (settings.cutBg) {
      if (settings.cutBg.inputFolder) {
        selectedCutBgInputFolder = settings.cutBg.inputFolder;
        document.getElementById("cut-bg-input-folder").value =
          settings.cutBg.inputFolder;
        // Removed folder path display
      }
      if (settings.cutBg.outputFolder) {
        selectedCutBgOutputFolder = settings.cutBg.outputFolder;
        document.getElementById("cut-bg-output-folder").value =
          settings.cutBg.outputFolder;
        // Removed folder path display
      }
      if (settings.cutBg.darken !== undefined) {
        document.getElementById("cut-bg-darken").value = settings.cutBg.darken;
      }
      if (settings.cutBg.blur !== undefined) {
        document.getElementById("cut-bg-blur").value = settings.cutBg.blur;
      }
      if (settings.cutBg.useGPU !== undefined) {
        document.getElementById("cut-bg-use-gpu").checked =
          !!settings.cutBg.useGPU;
      }
      if (settings.cutBg.maxConcurrent !== undefined) {
        document.getElementById("cut-bg-max-concurrent").value =
          settings.cutBg.maxConcurrent;
      }
    }

    // Load Thumb settings
    if (settings.thumb) {
      if (settings.thumb.inputFolder) {
        selectedThumbInputFolder = settings.thumb.inputFolder;
        document.getElementById("thumb-input-folder").value =
          settings.thumb.inputFolder;
        // Removed folder path display
      }
      if (settings.thumb.overlayFolder) {
        selectedThumbOverlayFolder = settings.thumb.overlayFolder;
        document.getElementById("thumb-overlay-folder").value =
          settings.thumb.overlayFolder;
        // Removed folder path display
      }
      if (settings.thumb.outputFolder) {
        selectedThumbOutputFolder = settings.thumb.outputFolder;
        document.getElementById("thumb-output-folder").value =
          settings.thumb.outputFolder;
        // Removed folder path display
      }
    }

    // Load Get URL settings
    if (settings.getUrl) {
      if (settings.getUrl.handle)
        document.getElementById("channel-handle").value =
          settings.getUrl.handle;
      if (settings.getUrl.outputFolder) {
        selectedGetUrlOutputFolder = settings.getUrl.outputFolder;
        document.getElementById("get-url-output-folder").value =
          settings.getUrl.outputFolder;
        // Removed folder path display
      }
    }

    // Load Normalize settings
    if (settings.normalize) {
      if (settings.normalize.inputFolder) {
        selectedNormalizeInputFolder = settings.normalize.inputFolder;
        document.getElementById("normalize-input-folder").value =
          settings.normalize.inputFolder;
        // Removed folder path display
      }
    }

    // Load Concat settings
    if (settings.concat) {
      if (settings.concat.chunkSize)
        document.getElementById("concat-chunk-size").value =
          settings.concat.chunkSize;
      if (settings.concat.useThumbs !== undefined) {
        document.getElementById("concat-use-thumbs").checked =
          settings.concat.useThumbs;
        toggleConcatThumbs();
      }
      if (settings.concat.thumbDuration)
        document.getElementById("concat-thumb-duration").value =
          settings.concat.thumbDuration;
      if (settings.concat.inputFolder) {
        selectedConcatInputFolder = settings.concat.inputFolder;
        document.getElementById("concat-input-folder").value =
          settings.concat.inputFolder;
        // Removed folder path display
      }
      if (settings.concat.thumbsFolder) {
        selectedConcatThumbsFolder = settings.concat.thumbsFolder;
        document.getElementById("concat-thumbs-folder").value =
          settings.concat.thumbsFolder;
        // Removed folder path display
      }
      if (settings.concat.outputFolder) {
        selectedConcatOutputFolder = settings.concat.outputFolder;
        document.getElementById("concat-output-folder").value =
          settings.concat.outputFolder;
        // Removed folder path display
      }
    }
  } catch (error) {
    console.error("Error loading settings:", error);
  }
}

// Project management
let currentProjectName = null;
// Khi xóa từ dashboard, lưu tên dự án cần xóa (confirmDeleteProject sẽ dùng)
let deleteTargetProjectName = null;

// Load danh sách projects và project hiện tại
async function loadProjects() {
  if (!checkElectronAPI()) return;

  try {
    // Load project hiện tại
    const currentResult = await window.electronAPI.getCurrentProject();
    if (currentResult.success) {
      currentProjectName = currentResult.projectName;
    }

    // Load danh sách projects
    const projectsResult = await window.electronAPI.getProjects();
    const projectSelect = document.getElementById("project-select");

    if (!projectSelect) return;

    if (projectsResult.success) {
      projectSelect.innerHTML = "";

      // Đảm bảo project "default" luôn có trong danh sách
      let projects = [...projectsResult.projects];
      if (!projects.includes("default")) {
        projects.unshift("default"); // Thêm "default" vào đầu danh sách
      }

      // Cập nhật badge số lượng (không tính "default")
      const projectCountBadge = document.getElementById("project-count");
      if (projectCountBadge) {
        const actualProjects = projects.filter(p => p !== "default");
        if (actualProjects.length > 0) {
          projectCountBadge.textContent = actualProjects.length;
          projectCountBadge.style.display = "inline-block";
        } else {
          projectCountBadge.style.display = "none";
        }
      }

      // Thêm các projects (đã bao gồm "default")
      projects.forEach((project) => {
        const option = document.createElement("option");
        option.value = project;
        // Hiển thị "Mặc định" thay vì "default" cho project default
        option.textContent = project === "default" ? "Mặc định" : project;
        if (project === currentProjectName || (!currentProjectName && project === "default")) {
          option.selected = true;
          // Cập nhật currentProjectName nếu chưa có
          if (!currentProjectName) {
            currentProjectName = "default";
          }
        }
        projectSelect.appendChild(option);
      });

      // Cập nhật trạng thái nút xóa trong menu
      const deleteMenuItem = document.getElementById(
        "delete-project-menu-item",
      );
      if (deleteMenuItem) {
        if (!currentProjectName || currentProjectName === "") {
          deleteMenuItem.classList.add("disabled");
          deleteMenuItem.disabled = true;
        } else {
          deleteMenuItem.classList.remove("disabled");
          deleteMenuItem.disabled = false;
        }
      }
    } else {
      projectSelect.innerHTML =
        '<option value="">Lỗi khi tải danh sách</option>';
    }
  } catch (error) {
    console.error("Error loading projects:", error);
  }
}

// Chuyển đổi project
async function switchProject() {
  if (!checkElectronAPI()) return;

  const projectSelect = document.getElementById("project-select");
  if (!projectSelect) return;

  const selectedProject = projectSelect.value;

  // Nếu chọn cùng project, không làm gì
  if (selectedProject === currentProjectName) {
    return;
  }

  // Lưu settings hiện tại trước khi chuyển
  if (currentProjectName) {
    await saveCurrentProjectSettings();
  }

  // Set project mới (nếu rỗng hoặc null, dùng "default")
  currentProjectName = selectedProject && selectedProject.trim() !== "" 
    ? selectedProject.trim() 
    : "default";
  await window.electronAPI.setCurrentProject(currentProjectName);

  // Cập nhật trạng thái nút xóa trong menu
  const deleteMenuItem = document.getElementById("delete-project-menu-item");
  if (deleteMenuItem) {
    if (!currentProjectName || currentProjectName === "") {
      deleteMenuItem.classList.add("disabled");
      deleteMenuItem.disabled = true;
    } else {
      deleteMenuItem.classList.remove("disabled");
      deleteMenuItem.disabled = false;
    }
  }

  // Load settings của project mới
  await loadSettings();

  // Không còn cần sync config files nữa - scripts đọc trực tiếp từ project JSON
  // thông qua environment variable PROJECT_NAME

  // Hiển thị thông báo ngắn
  if (currentProjectName && currentProjectName !== "default") {
    showProjectNotification(
      `Đã chuyển sang dự án: ${currentProjectName}`,
      "success",
    );
  } else {
    showProjectNotification("Đã chuyển sang chế độ mặc định", "info");
  }
}

// Hiển thị thông báo ngắn cho project
function showProjectNotification(message, type = "info") {
  // Tạo notification element nếu chưa có
  let notification = document.getElementById("project-notification");
  if (!notification) {
    notification = document.createElement("div");
    notification.id = "project-notification";
    notification.style.cssText = `
      position: fixed;
      top: 100px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      color: white;
      font-size: 13px;
      font-weight: 600;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      opacity: 0;
      transform: translateX(100px);
      transition: all 0.3s ease;
      pointer-events: none;
    `;
    document.body.appendChild(notification);
  }

  // Set màu theo type
  const colors = {
    success: "linear-gradient(135deg, #4caf50 0%, #45a049 100%)",
    info: "linear-gradient(135deg, #2196f3 0%, #1976d2 100%)",
    error: "linear-gradient(135deg, #f44336 0%, #d32f2f 100%)",
  };
  notification.style.background = colors[type] || colors.info;
  notification.textContent = message;

  // Hiển thị
  setTimeout(() => {
    notification.style.opacity = "1";
    notification.style.transform = "translateX(0)";
  }, 10);

  // Ẩn sau 3 giây
  setTimeout(() => {
    notification.style.opacity = "0";
    notification.style.transform = "translateX(100px)";
  }, 3000);
}

// Mở dialog thêm project
function openAddProjectDialog() {
  const modal = document.getElementById("addProjectModal");
  const nameInput = document.getElementById("new-project-name");
  const statusDiv = document.getElementById("add-project-status");

  if (!modal || !nameInput) return;

  nameInput.value = "";
  statusDiv.style.display = "none";
  statusDiv.textContent = "";
  modal.classList.add("active");
  nameInput.focus();
}

// Đóng dialog thêm project
function closeAddProjectDialog() {
  const modal = document.getElementById("addProjectModal");
  if (modal) {
    modal.classList.remove("active");
  }
}

// Tạo project mới
async function createNewProject() {
  if (!checkElectronAPI()) return;

  const nameInput = document.getElementById("new-project-name");
  const statusDiv = document.getElementById("add-project-status");

  if (!nameInput || !statusDiv) return;

  const projectName = nameInput.value.trim();

  if (!projectName) {
    statusDiv.style.display = "block";
    statusDiv.style.background = "#ffebee";
    statusDiv.style.color = "#c62828";
    statusDiv.style.border = "1px solid #f44336";
    statusDiv.innerHTML = "❌ <strong>Vui lòng nhập tên dự án</strong>";
    nameInput.focus();
    return;
  }

  // Validate tên dự án (ít nhất 2 ký tự)
  if (projectName.length < 2) {
    statusDiv.style.display = "block";
    statusDiv.style.background = "#ffebee";
    statusDiv.style.color = "#c62828";
    statusDiv.style.border = "1px solid #f44336";
    statusDiv.innerHTML =
      "❌ <strong>Tên dự án phải có ít nhất 2 ký tự</strong>";
    nameInput.focus();
    return;
  }

  try {
    statusDiv.style.display = "block";
    statusDiv.style.background = "#e3f2fd";
    statusDiv.style.color = "#1565c0";
    statusDiv.style.border = "1px solid #2196f3";
    statusDiv.innerHTML = "⏳ <strong>Đang tạo dự án...</strong>";

    const result = await window.electronAPI.createProject(projectName);

    if (result.success) {
      statusDiv.style.background = "#e8f5e9";
      statusDiv.style.color = "#2e7d32";
      statusDiv.style.border = "1px solid #4caf50";
      statusDiv.innerHTML = `✅ <strong>Đã tạo dự án "${result.projectName}" thành công!</strong><br><small>Đang chuyển sang dự án mới...</small>`;

      await loadProjects();
      refreshDashboard();
      const projectSelect = document.getElementById("project-select");
      if (projectSelect) {
        projectSelect.value = result.projectName;
        await switchProject();
      }
      setTimeout(() => {
        closeAddProjectDialog();
        showProjectNotification(
          `Dự án "${result.projectName}" đã được tạo và kích hoạt!`,
          "success",
        );
      }, 2000);
    } else {
      statusDiv.style.background = "#ffebee";
      statusDiv.style.color = "#c62828";
      statusDiv.style.border = "1px solid #f44336";
      statusDiv.innerHTML = `❌ <strong>Lỗi:</strong> ${
        result.error || "Không thể tạo dự án"
      }`;
      nameInput.focus();
    }
  } catch (error) {
    statusDiv.style.background = "#ffebee";
    statusDiv.style.color = "#c62828";
    statusDiv.style.border = "1px solid #f44336";
    statusDiv.innerHTML = `❌ <strong>Lỗi:</strong> ${getErrorMessage(error)}`;
    nameInput.focus();
  }
}

// Hiển thị dialog xác nhận xóa dự án (từ work view hoặc từ dashboard với projectName)
function showDeleteProjectDialog(projectNameFromDashboard) {
  if (!checkElectronAPI()) return;

  const projectToDelete = projectNameFromDashboard != null
    ? projectNameFromDashboard
    : (document.getElementById("project-select") && document.getElementById("project-select").value);

  if (!projectToDelete) {
    showProjectNotification("Vui lòng chọn dự án cần xóa", "error");
    return;
  }

  if (projectNameFromDashboard != null) {
    deleteTargetProjectName = projectNameFromDashboard;
  } else {
    deleteTargetProjectName = null;
  }

  // Hiển thị tên dự án trong dialog
  const nameDisplay = document.getElementById("delete-project-name-display");
  if (nameDisplay) {
    nameDisplay.textContent = `Dự án "${projectToDelete}" sẽ bị xóa.`;
  }

  // Hiển thị dialog
  const dialog = document.getElementById("deleteProjectDialog");
  if (dialog) {
    dialog.classList.add("active");
  }
}

// Đóng dialog xác nhận xóa
function closeDeleteProjectDialog() {
  const dialog = document.getElementById("deleteProjectDialog");
  if (dialog) {
    dialog.classList.remove("active");
  }
}

// Xác nhận xóa dự án
async function confirmDeleteProject() {
  if (!checkElectronAPI()) return;

  const projectToDelete = deleteTargetProjectName != null
    ? deleteTargetProjectName
    : (document.getElementById("project-select") && document.getElementById("project-select").value);

  if (!projectToDelete) {
    closeDeleteProjectDialog();
    showProjectNotification("Vui lòng chọn dự án cần xóa", "error");
    return;
  }

  const fromDashboard = deleteTargetProjectName != null;

  try {
    const result = await window.electronAPI.deleteProject(projectToDelete);

    if (result.success) {
      closeDeleteProjectDialog();
      deleteTargetProjectName = null;

      if (fromDashboard) {
        await refreshDashboard();
        showProjectNotification(
          `Đã xóa dự án "${projectToDelete}" thành công!`,
          "success",
        );
      } else {
        await loadProjects();
        currentProjectName = null;
        await window.electronAPI.setCurrentProject(null);
        await loadSettings();
        showProjectNotification(
          `Đã xóa dự án "${projectToDelete}" thành công!`,
          "success",
        );
      }
    } else {
      closeDeleteProjectDialog();
      deleteTargetProjectName = null;
      showProjectNotification(
        `Lỗi: ${result.error || "Không thể xóa dự án"}`,
        "error",
      );
    }
  } catch (error) {
    closeDeleteProjectDialog();
    deleteTargetProjectName = null;
    showProjectNotification(`Lỗi: ${getErrorMessage(error)}`, "error");
  }
}

// Xóa project hiện tại (giữ lại để tương thích)
async function deleteCurrentProject() {
  showDeleteProjectDialog();
}

// ========== Dashboard (màn hình mặc định) ==========
function formatProjectDate(isoStr) {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return "—";
  }
}

async function refreshDashboard() {
  const empty = document.getElementById("dashboard-empty");
  const searchInput = document.getElementById("dashboard-search");
  const cardsEl = document.getElementById("dashboard-cards");
  if (!empty || !cardsEl) return;

  if (!window.electronAPI || !window.electronAPI.getProjectsWithMeta) {
    cardsEl.style.display = "none";
    empty.style.display = "block";
    empty.innerHTML = "<strong>Lỗi</strong> Không thể tải danh sách dự án.";
    return;
  }

  const result = await window.electronAPI.getProjectsWithMeta();
  let list = result.success ? result.projects || [] : [];
  const query = (searchInput && searchInput.value || "").trim().toLowerCase();
  if (query) {
    list = list.filter(
      (p) =>
        (p.displayName && p.displayName.toLowerCase().includes(query)) ||
        (p.name && p.name.toLowerCase().includes(query)),
    );
  }

  if (list.length === 0) {
    cardsEl.style.display = "none";
    empty.style.display = "block";
    empty.innerHTML = query
      ? "<strong>Không tìm thấy dự án</strong> Thử đổi từ khóa tìm kiếm."
      : '<strong>Chưa có dự án</strong> Tạo dự án từ menu ⚙️ → Thêm dự án mới.';
    return;
  }
  empty.style.display = "none";
  cardsEl.style.display = "grid";
  cardsEl.innerHTML = "";

  const todayStr = formatProjectDate(new Date().toISOString());

  list.forEach((p) => {
    const cycleVal = p.cycleDays != null ? String(p.cycleDays) : "—";
    const lastRenderStr = p.lastRenderAt ? formatProjectDate(p.lastRenderAt) : "—";
    let daysLeftText = "—";
    let tagClass = "tag-muted";
    if (p.daysLeft != null) {
      if (p.daysLeft >= 3) {
        daysLeftText = `${p.daysLeft} ngày còn lại`;
        tagClass = "tag-green";
      } else if (p.daysLeft === 2) {
        daysLeftText = "2 ngày còn lại";
        tagClass = "tag-yellow";
      } else if (p.daysLeft === 1) {
        daysLeftText = "1 ngày còn lại";
        tagClass = "tag-red";
      } else if (p.daysLeft === 0) {
        daysLeftText = "Cần render ngay";
        tagClass = "tag-red";
      } else {
        daysLeftText = `Quá hạn ${-p.daysLeft} ngày`;
        tagClass = "tag-red";
      }
    }
    const card = document.createElement("div");
    card.className = "dashboard-card";
    const starClass = p.starred ? "dashboard-card-star starred" : "dashboard-card-star";
    const starChar = p.starred ? "★" : "☆";
    card.innerHTML = `
      <span class="${starClass}" data-project="${escapeHtml(p.name)}" data-starred="${p.starred ? "1" : "0"}" title="${p.starred ? "BKT (bỏ đánh dấu)" : "Đánh dấu BKT"}">${starChar}</span>
      <div class="dashboard-card-header">
        <span class="dashboard-card-title">${escapeHtml(p.displayName || p.name)}</span>
      </div>
      <div class="dashboard-card-meta">
        <span><span class="label">Chu kỳ</span><span class="value">${escapeHtml(cycleVal)} ngày</span></span>
        <span><span class="label">Ngày render gần nhất</span><span class="value">${escapeHtml(lastRenderStr)}</span></span>
        <span><span class="label">Ngày hiện tại</span><span class="value">${escapeHtml(todayStr)}</span></span>
      </div>
      <div class="dashboard-card-status">
        <span class="status-label">Trạng thái:</span>
        <span class="dashboard-tag ${escapeHtml(tagClass)}">${escapeHtml(daysLeftText)}</span>
      </div>
    `;
    const starEl = card.querySelector(".dashboard-card-star");
    if (starEl && window.electronAPI && window.electronAPI.setProjectStarred) {
      starEl.addEventListener("click", async (e) => {
        e.stopPropagation();
        const proj = starEl.getAttribute("data-project");
        const cur = starEl.getAttribute("data-starred") === "1";
        await window.electronAPI.setProjectStarred(proj, !cur);
        refreshDashboard();
      });
    }
    cardsEl.appendChild(card);
  });
}

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function openProjectFromDashboard(projectName) {
  if (!projectName || !window.electronAPI) return;
  await window.electronAPI.setCurrentProject(projectName);
  currentProjectName = projectName;
  await loadProjects();
  await loadSettings();
  showProjectNotification(`Đã chuyển sang dự án: ${projectName === "default" ? "Mặc định" : projectName}`, "success");
}

async function runRenderFromDashboard(projectName, day, videos) {
  if (!projectName || !window.electronAPI) return;
  const dayVal = (day != null && day !== "" && day !== "—") ? String(day) : "1";
  const videosVal = (videos != null && videos !== "" && videos !== "—") ? String(videos) : "1";

  const panel = document.getElementById("dashboard-output-panel");
  const bodyEl = document.getElementById("dashboard-output-body");
  if (panel) panel.classList.remove("hidden");
  if (bodyEl) bodyEl.textContent = `🚀 Đang chạy Render cho dự án "${projectName}" (ngày=${dayVal}, videos=${videosVal})...\n\n`;

  await window.electronAPI.setCurrentProject(projectName);
  currentProjectName = projectName;

  window.electronAPI.removeScriptOutputListener?.();
  window.electronAPI.onScriptOutput?.((data) => {
    const b = document.getElementById("dashboard-output-body");
    if (b) b.textContent += data;
  });

  try {
    await window.electronAPI.runScript("render.js", [dayVal, videosVal], {});
    if (bodyEl) bodyEl.textContent += "\n\n✅ Hoàn thành!";
    if (window.electronAPI.setProjectLastRender) {
      await window.electronAPI.setProjectLastRender(projectName);
    }
    showProjectNotification(`Render dự án "${projectName}" đã xong.`, "success");
    refreshDashboard();
  } catch (err) {
    if (bodyEl) bodyEl.textContent += `\n\n❌ Lỗi: ${getErrorMessage(err)}`;
    showProjectNotification(`Lỗi render: ${getErrorMessage(err)}`, "error");
  }
}

// Lưu settings của project hiện tại
async function saveCurrentProjectSettings() {
  // Luôn lưu vào project (mặc định là "default")
  const projectToSave = currentProjectName || "default";

  if (!checkElectronAPI()) return;

  try {
    // Lấy tất cả settings hiện tại (sử dụng logic từ saveSettings)
    const settings = {
      // Render settings
      render: {
        day: document.getElementById("render-day")?.value || "1",
        videos: document.getElementById("render-videos")?.value || "1",
        videoSpeed: document.getElementById("render-video-speed")?.value || "0.95",
        renderMode:
          document.querySelector('input[name="render-mode"]:checked')?.value ||
          "topTransparent",
        opacity: document.getElementById("render-opacity")?.value || "0.7",
        chromaKeyMode:
          document.querySelector('input[name="chromakey-mode"]:checked')
            ?.value || "color",
        chromaKeyColor:
          document.getElementById("render-chromakey-color")?.value || "D4F9D7",
        keepColorColors:
          document.getElementById("render-keepcolor-colors")?.value || "FBFF02",
        keepColorCrop:
          document.getElementById("render-keepcolor-crop")?.checked || false,
        keepColorHeight:
          document.getElementById("render-keepcolor-height")?.value || "220",
        keepColorYOffset:
          document.getElementById("render-keepcolor-y-offset")?.value || "490",
        keepColorAddDarkLayer:
          document.getElementById("render-keepcolor-add-dark-layer")?.checked || false,
        useGPU: document.getElementById("render-use-gpu")?.checked || false,
        maxConcurrentProcesses:
          document.getElementById("render-max-concurrent")?.value || "2",
        gpuVideoCodec:
          document.getElementById("render-gpu-codec")?.value || "h264_nvenc",
        height: document.getElementById("render-height")?.value || "220",
        y_offset: document.getElementById("render-y-offset")?.value || "490",
        overlayFolder: selectedRenderOverlayFolder,
        backgroundFolder: selectedRenderBackgroundFolder,
        outputFolder: selectedRenderOutputFolder,
        chromaKeyFile: selectedRenderChromaKeyFile,
        cycleDays: document.getElementById("render-cycle-days")?.value || "1",
      },
      // Download settings
      download: {
        urlsFile: selectedUrlsFile,
        outputFolder: selectedDownloadOutputFolder,
        descFolder: selectedDownloadDescFolder,
        overlayImagesFolder: selectedDownloadOverlayImagesFolder,
        thumbsFolder: selectedDownloadThumbsFolder,
        cookiesFile: selectedDownloadCookiesFile,
        maxConcurrent: document.getElementById("download-max-concurrent")?.value || "2",
        proxy: (() => {
          const proxyInput = document.getElementById("download-proxy");
          const proxyValue = proxyInput?.value?.trim();
          // Nếu input field có giá trị, dùng giá trị đó (ưu tiên nhất)
          if (proxyValue) {
            return proxyValue;
          }
          // Nếu input field trống, trả về null (để xóa proxy khỏi config)
          return null;
        })(),
        downloadDrive: selectedDownloadDrive || false,
        driveLanguage: selectedDriveLanguage || "auto",
      },
      // Stock Download (Pexels & Pixabay) settings
      stockDownload: {
        usePexels: document.getElementById("stock-use-pexels")?.checked ?? false,
        usePixabay: document.getElementById("stock-use-pixabay")?.checked ?? false,
        pexelsApiKey: document.getElementById("stock-pexels-api-key")?.value?.trim() || "",
        pixabayApiKey: document.getElementById("stock-pixabay-api-key")?.value?.trim() || "",
        searchQuery: document.getElementById("stock-search-query")?.value?.trim() || "",
        maxVideos: document.getElementById("stock-max-videos")?.value || "30",
        outputFolder: selectedStockOutputFolder || "",
        orientation: document.getElementById("stock-orientation")?.value || "landscape",
        convert720: document.getElementById("stock-convert-720")?.checked ?? true,
        removeAudio: document.getElementById("stock-remove-audio")?.checked ?? true,
        cut: document.getElementById("stock-cut")?.checked ?? false,
        trimSeconds: document.getElementById("stock-trim-seconds")?.value || "3",
      },
      // Video Snow settings
      videoSnow: {
        inputFolder: selectedVideoSnowInputFolder,
        outputFolder: selectedVideoSnowOutputFolder,
        snowFile: selectedVideoSnowSnowFile,
        maxConcurrent:
          document.getElementById("video-snow-max-concurrent")?.value || "3",
        segmentMin:
          document.getElementById("video-snow-segment-min")?.value || "10",
        segmentMax:
          document.getElementById("video-snow-segment-max")?.value || "15",
      },
      // Background Video settings
      bgVideo: {
        count: document.getElementById("bg-count")?.value || "3",
        inputFolder: selectedBgInputFolder,
        outputFolder: selectedBgOutputFolder,
        targetDuration:
          document.getElementById("bg-target-duration")?.value || "3600",
        sourceCount: document.getElementById("bg-source-count")?.value || "10",
        avgClipDuration:
          document.getElementById("bg-avg-clip-duration")?.value || "12",
      },
      // Trim settings
      trim: {
        inputFolder: selectedTrimInputFolder,
        outputFolder: selectedTrimOutputFolder,
        startTime: document.getElementById("trim-start-time")?.value || "0",
        duration: document.getElementById("trim-duration")?.value || "30",
      },
      // Cut BG settings
      cutBg: {
        inputFolder: selectedCutBgInputFolder,
        outputFolder: selectedCutBgOutputFolder,
      },
      // Thumb settings
      thumb: {
        inputFolder: selectedThumbInputFolder,
        overlayFolder: selectedThumbOverlayFolder,
        outputFolder: selectedThumbOutputFolder,
      },
      // Get URL settings
      getUrl: {
        handle: document.getElementById("channel-handle")?.value || "",
        outputFolder: selectedGetUrlOutputFolder,
      },
      // Normalize settings
      normalize: {
        inputFolder: selectedNormalizeInputFolder,
      },
      // Concat settings
      concat: {
        chunkSize: document.getElementById("concat-chunk-size")?.value || "2",
        useThumbs:
          document.getElementById("concat-use-thumbs")?.checked ?? true,
        thumbDuration:
          document.getElementById("concat-thumb-duration")?.value || "3",
        inputFolder: selectedConcatInputFolder,
        thumbsFolder: selectedConcatThumbsFolder,
        outputFolder: selectedConcatOutputFolder,
      },
    };

    await window.electronAPI.saveProjectConfig(projectToSave, settings);
  } catch (error) {
    console.error("Error saving project settings:", error);
  }
}

// Tab switching
document.addEventListener("DOMContentLoaded", async () => {
  setupUpdateListeners();

  await loadProjects();
  await loadSettings();

  const dashboardSearch = document.getElementById("dashboard-search");
  if (dashboardSearch) {
    let dashboardSearchDebounce = null;
    const DASHBOARD_SEARCH_DEBOUNCE_MS = 300;
    dashboardSearch.addEventListener("input", () => {
      if (dashboardSearchDebounce) clearTimeout(dashboardSearchDebounce);
      dashboardSearchDebounce = setTimeout(() => {
        dashboardSearchDebounce = null;
        refreshDashboard();
      }, DASHBOARD_SEARCH_DEBOUNCE_MS);
    });
    dashboardSearch.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        dashboardSearch.value = "";
        if (dashboardSearchDebounce) clearTimeout(dashboardSearchDebounce);
        dashboardSearchDebounce = null;
        refreshDashboard();
      }
    });
  }
  const dashboardAddBtn = document.getElementById("dashboard-add-project");
  if (dashboardAddBtn) {
    dashboardAddBtn.addEventListener("click", openAddProjectDialog);
  }
  const dashboardOutputClose = document.getElementById("dashboard-output-close");
  if (dashboardOutputClose) {
    dashboardOutputClose.addEventListener("click", () => {
      const panel = document.getElementById("dashboard-output-panel");
      if (panel) panel.classList.add("hidden");
    });
  }

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      const tabId = button.getAttribute("data-tab");

      document
        .querySelectorAll(".tab-button")
        .forEach((btn) => btn.classList.remove("active"));
      document
        .querySelectorAll(".tab-content")
        .forEach((content) => content.classList.remove("active"));

      button.classList.add("active");
      const tabEl = document.getElementById(tabId);
      if (tabEl) tabEl.classList.add("active");
      if (tabId === "dashboard") refreshDashboard();
    });
  });

  // Add event listeners to save settings on change
  const inputsToWatch = [
    "render-day",
    "render-videos",
    "render-cycle-days",
    "render-opacity",
    "render-chromakey-color",
    "render-keepcolor-colors",
    "render-keepcolor-height",
    "render-keepcolor-y-offset",
    "render-height",
    "render-y-offset",
    "render-max-concurrent",
    "render-gpu-codec",
    "bg-count",
    "bg-target-duration",
    "bg-source-count",
    "bg-avg-clip-duration",
    "channel-handle",
    "video-snow-max-concurrent",
    "video-snow-segment-min",
    "video-snow-segment-max",
    "concat-chunk-size",
    "concat-thumb-duration",
    "trim-start-time",
    "trim-duration",
    "download-proxy", // Thêm proxy input để tự động lưu khi thay đổi
    "download-max-concurrent",
    "render-video-speed",
    "stock-search-query",
    "stock-max-videos",
    "stock-orientation",
    "stock-pexels-api-key",
    "stock-pixabay-api-key",
    "stock-trim-seconds",
  ];

  inputsToWatch.forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener("change", saveSettings);
      element.addEventListener("input", saveSettings);
    }
  });

  // Watch checkboxes
  const checkboxesToWatch = [
    "render-use-gpu",
    "render-keepcolor-crop",
    "render-keepcolor-add-dark-layer",
    "concat-use-thumbs",
    "stock-use-pexels",
    "stock-use-pixabay",
    "stock-convert-720",
    "stock-remove-audio",
    "stock-cut",
  ];

  checkboxesToWatch.forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener("change", () => {
        saveSettings();
        if (id === "render-keepcolor-crop") toggleKeepColorCrop();
        if (id === "concat-use-thumbs") toggleConcatThumbs();
        if (id === "render-use-gpu") {
          handleGpuToggle();
        }
        if (id === "stock-use-pexels") toggleStockPexels();
        if (id === "stock-use-pixabay") toggleStockPixabay();
        if (id === "stock-cut") toggleStockCut();
      });
    }
  });

  // Watch radio buttons for render mode
  document.querySelectorAll('input[name="render-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      saveSettings();
      toggleRenderMode();
    });
  });

  // Watch radio buttons for chromakey mode
  document.querySelectorAll('input[name="chromakey-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      saveSettings();
      toggleChromaKeyMode();
    });
  });
});

// Helper function to show output
function showOutput(tabId, message) {
  const outputDiv = document.getElementById(`${tabId}-output`);
  if (outputDiv) {
    outputDiv.style.display = "block";
    outputDiv.textContent += message;
    outputDiv.scrollTop = outputDiv.scrollHeight;
  }
}

function clearOutput(tabId) {
  const outputDiv = document.getElementById(`${tabId}-output`);
  if (outputDiv) {
    outputDiv.textContent = "";
    outputDiv.style.display = "none";
  }
}

// Render Video - Selected folders
let selectedRenderOverlayFolder = null;
let selectedRenderBackgroundFolder = null;
let selectedRenderOutputFolder = null;
let selectedRenderChromaKeyFile = null;

// Toggle functions for render options
function toggleRenderMode() {
  const mode =
    document.querySelector('input[name="render-mode"]:checked')?.value ||
    "topTransparent";

  // Hide all option groups
  document.getElementById("render-opacity-group").style.display = "none";
  document.getElementById("render-chromakey-group").style.display = "none";
  document.getElementById("render-crop-group").style.display = "none";
  document.getElementById("render-keepcolor-group").style.display = "none";

  // Show relevant option group based on mode
  if (mode === "topTransparent") {
    document.getElementById("render-opacity-group").style.display = "block";
  } else if (mode === "chromaKey") {
    document.getElementById("render-chromakey-group").style.display = "block";
  } else if (mode === "crop") {
    document.getElementById("render-crop-group").style.display = "block";
  } else if (mode === "keepColor") {
    document.getElementById("render-keepcolor-group").style.display = "block";
    toggleKeepColorCrop();
  }
}

function toggleChromaKeyMode() {
  const mode =
    document.querySelector('input[name="chromakey-mode"]:checked')?.value ||
    "color";
  document.getElementById("chromakey-color-input").style.display =
    mode === "color" ? "block" : "none";
  document.getElementById("chromakey-file-input").style.display =
    mode === "file" ? "block" : "none";
}

function toggleKeepColorCrop() {
  const checked =
    document.getElementById("render-keepcolor-crop")?.checked || false;
  document.getElementById("render-keepcolor-crop-group").style.display = checked
    ? "block"
    : "none";
}

async function selectRenderChromaKeyFile() {
  if (!checkElectronAPI()) return;
  try {
    const filePath = await window.electronAPI.selectFile({
      filters: [
        { name: "Text Files", extensions: ["txt"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (filePath) {
      selectedRenderChromaKeyFile = filePath;
      document.getElementById("render-chromakey-file").value = filePath;
      saveSettings();
    }
  } catch (error) {
    console.error("Error selecting file:", error);
    alert("Lỗi khi chọn file: " + error.message);
  }
}

function clearRenderChromaKeyFile() {
  selectedRenderChromaKeyFile = null;
  const input = document.getElementById("render-chromakey-file");
  if (input) input.value = "";
  saveSettings();
}

// Tự động lấy màu chroma key từ video (dùng get-video-chroma.js)
async function autoDetectChromaKeyFromVideos() {
  console.log("🔵 [autoDetectChromaKeyFromVideos] Bắt đầu...");
  
  if (!checkElectronAPI()) {
    console.error("❌ [autoDetectChromaKeyFromVideos] Electron API không khả dụng");
    alert("❌ Electron API không khả dụng. Vui lòng khởi động lại ứng dụng.");
    return;
  }
  
  console.log("✅ [autoDetectChromaKeyFromVideos] Electron API OK");

  // Lấy video từ Folder Overlay (video đầu vào)
  const inputFolder =
    selectedRenderOverlayFolder ||
    document.getElementById("render-overlay-folder")?.value ||
    "./overlays";
  
  console.log("📁 [autoDetectChromaKeyFromVideos] Input folder:", inputFolder);

  // File chromaKey target: ưu tiên file đã chọn, nếu không có thì dùng ./chromaKey.txt
  const chromaKeyFile =
    selectedRenderChromaKeyFile ||
    document.getElementById("render-chromakey-file")?.value ||
    "./chromaKey.txt";
  
  console.log("📄 [autoDetectChromaKeyFromVideos] ChromaKey file:", chromaKeyFile);

  // Lấy các màu (nếu có) từ input, dạng "RRGGBB,RRGGBB,..."
  const paletteInput = document
    .getElementById("render-chromakey-palette")
    ?.value.trim();

  let paletteArg = null;
  if (paletteInput) {
    const parts = paletteInput
      .split(",")
      .map((p) => p.trim().replace("#", "").toUpperCase())
      .filter((p) => /^[0-9A-F]{6}$/.test(p));

    if (parts.length > 0) {
      paletteArg = parts.join(",");
    } else {
      alert(
        "Danh sách màu không hợp lệ. Vui lòng nhập mã hex hợp lệ, cách nhau bởi dấu phẩy (ví dụ: 22BDD6,2B4052,7FBFDE,7097B8).",
      );
      return;
    }
  }

  if (!inputFolder) {
    console.error("❌ [autoDetectChromaKeyFromVideos] Thiếu input folder");
    return;
  }

  if (!chromaKeyFile) {
    console.error("❌ [autoDetectChromaKeyFromVideos] Thiếu chromaKey file");
    return;
  }
  
  console.log("✅ [autoDetectChromaKeyFromVideos] Validation OK, bắt đầu chạy script...");

  // Hiển thị output tab và thông báo bắt đầu
  const outputDiv = document.getElementById("render-output");
  if (outputDiv) {
    outputDiv.style.display = "block";
  }

  clearOutput("render");
  showOutput(
    "render",
    `🎨 Bắt đầu tự động lấy màu chroma key...\n`,
  );
  showOutput(
    "render",
    `📁 Folder video: ${inputFolder}\n`,
  );
  showOutput(
    "render",
    `📄 File output: ${chromaKeyFile}\n`,
  );
  if (paletteArg) {
    showOutput(
      "render",
      `🎨 Palette: ${paletteArg}\n`,
    );
  }
  showOutput(
    "render",
    `\n⏳ Đang xử lý...\n\n`,
  );

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("render", data);
    });

    const args = [inputFolder, chromaKeyFile];
    if (paletteArg) {
      args.push(paletteArg);
    }
    
    console.log("🚀 [autoDetectChromaKeyFromVideos] Gọi script với args:", args);

    await window.electronAPI.runScript(
      "get-video-chroma.js",
      args,
      {},
    );
    
    console.log("✅ [autoDetectChromaKeyFromVideos] Script chạy xong");

    // Thông báo thành công rõ ràng
    showOutput(
      "render",
      `\n\n✅ ✅ ✅ HOÀN THÀNH! ✅ ✅ ✅\n`,
    );
    showOutput(
      "render",
      `✅ Đã lấy màu thành công và ghi vào file: ${chromaKeyFile}\n`,
    );
    showOutput(
      "render",
      `✅ Bạn có thể kiểm tra file để xem kết quả.\n`,
    );
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    showOutput("render", `\n\n❌ ❌ ❌ LỖI! ❌ ❌ ❌\n`);
    showOutput("render", `❌ ${errorMsg}\n`);
    alert(`❌ Lỗi khi lấy màu:\n\n${errorMsg}`);
  }
}

async function selectRenderOverlayFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedRenderOverlayFolder = folder;
    document.getElementById("render-overlay-folder").value = folder;
    // Removed folder path display
    saveSettings();
  }
}

function clearRenderOverlayFolder() {
  selectedRenderOverlayFolder = null;
  const input = document.getElementById("render-overlay-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectRenderBackgroundFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedRenderBackgroundFolder = folder;
    document.getElementById("render-background-folder").value = folder;
    // Removed folder path display
    saveSettings();
  }
}

function clearRenderBackgroundFolder() {
  selectedRenderBackgroundFolder = null;
  const input = document.getElementById("render-background-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectRenderOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedRenderOutputFolder = folder;
    document.getElementById("render-output-folder").value = folder;
    // Removed folder path display
    saveSettings();
  }
}

function clearRenderOutputFolder() {
  selectedRenderOutputFolder = null;
  const input = document.getElementById("render-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function runRender() {
  const day = document.getElementById("render-day").value;
  const videos = document.getElementById("render-videos").value;
  const videoSpeed = document.getElementById("render-video-speed").value;
  const renderMode =
    document.querySelector('input[name="render-mode"]:checked')?.value ||
    "topTransparent";
  const useGPU = document.getElementById("render-use-gpu").checked;
  const maxConcurrentProcesses =
    parseInt(document.getElementById("render-max-concurrent").value) || 2;
  
  // Tự động phát hiện GPU codec nếu useGPU được bật nhưng chưa có codec
  let gpuVideoCodec = document.getElementById("render-gpu-codec").value;
  if (useGPU && !gpuVideoCodec) {
    if (checkElectronAPI() && window.electronAPI) {
      try {
        const result = await window.electronAPI.detectGpuCodec();
        if (result.success && result.codec) {
          gpuVideoCodec = result.codec;
          document.getElementById("render-gpu-codec").value = gpuVideoCodec;
        } else {
          alert("⚠️ Không phát hiện GPU encoder nào. Vui lòng kiểm tra driver GPU.");
          return;
        }
      } catch (error) {
        console.error("Lỗi khi phát hiện GPU codec:", error);
        gpuVideoCodec = "h264_nvenc"; // Fallback
      }
    } else {
      gpuVideoCodec = "h264_nvenc"; // Fallback
    }
  } else if (!useGPU) {
    gpuVideoCodec = "h264_nvenc"; // Giá trị mặc định, không được sử dụng
  }

  const opacity =
    parseFloat(document.getElementById("render-opacity").value) || 0.7;
  const height =
    parseInt(document.getElementById("render-height").value) || 220;
  const y_offset =
    parseInt(document.getElementById("render-y-offset").value) || 490;

  // Chroma Key config
  let chromaKeyMode = "color";
  let chromaKeyColor = null;
  let chromaKeyFile = null;
  if (renderMode === "chromaKey") {
    chromaKeyMode =
      document.querySelector('input[name="chromakey-mode"]:checked')?.value ||
      "color";
    if (chromaKeyMode === "color") {
      chromaKeyColor =
        document
          .getElementById("render-chromakey-color")
          .value.trim()
          .toUpperCase() || "D4F9D7";
    } else {
      chromaKeyFile = selectedRenderChromaKeyFile;
    }
  }

  const chromaKeySimilarity =
    parseFloat(document.getElementById("render-chromakey-similarity")?.value) ||
    0.3;

  // Keep Color config
  let keepColorColors = null;
  let keepColorCrop = false;
  let keepColorHeight = 220;
  let keepColorYOffset = 490;
  let keepColorAddDarkLayer = false;
  if (renderMode === "keepColor") {
    const colorsInput = document
      .getElementById("render-keepcolor-colors")
      .value.trim()
      .toUpperCase();
    if (colorsInput) {
      keepColorColors = colorsInput
        .split(",")
        .map((c) => c.trim())
        .filter((c) => /^[0-9A-F]{6}$/.test(c));
    }
    keepColorCrop = document.getElementById("render-keepcolor-crop").checked;
    if (keepColorCrop) {
      keepColorHeight =
        parseInt(document.getElementById("render-keepcolor-height").value) ||
        220;
      keepColorYOffset =
        parseInt(document.getElementById("render-keepcolor-y-offset").value) ||
        490;
      keepColorAddDarkLayer = document.getElementById("render-keepcolor-add-dark-layer").checked || false;
    }
  }

  if (!day || !videos) {
    alert("Vui lòng nhập đầy đủ thông tin!");
    return;
  }

  if (!checkElectronAPI()) return;

  clearOutput("render");
  showOutput(
    "render",
    `🚀 Đang chạy Render Video với ngày=${day}, videos=${videos}...\n\n`,
  );

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("render", data);
    });

    const options = {
      // Không dùng fileMapping cho render vì render.js sẽ đọc path trực tiếp từ config
      renderConfig: {
        renderMode,
        chromaKeyMode,
        chromaKeyColor,
        chromaKeySimilarity,
        chromaKeyFile,
        keepColorColors,
        keepColorCrop,
        keepColorHeight,
        keepColorYOffset,
        keepColorAddDarkLayer,
        useGPU,
        maxConcurrentProcesses,
        gpuVideoCodec,
        opacity,
        height,
        y_offset,
        // Sử dụng path trực tiếp từ GUI, không copy
        overlayFolder: selectedRenderOverlayFolder || "./overlays",
        backgroundFolder: selectedRenderBackgroundFolder || "./backgrounds",
        outputFolder: selectedRenderOutputFolder || "./done",
        videoSpeed,
      },
    };

    await window.electronAPI.runScript("render.js", [day, videos], options);
    showOutput("render", "\n\n✅ Hoàn thành!");
    const proj = currentProjectName || "default";
    if (window.electronAPI.setProjectLastRender) {
      await window.electronAPI.setProjectLastRender(proj);
    }
  } catch (error) {
    showOutput("render", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Download - Selected paths
let selectedUrlsFile = null;
let selectedDownloadOutputFolder = null;
let selectedDownloadDescFolder = null;
let selectedDownloadOverlayImagesFolder = null;
let selectedDownloadThumbsFolder = null;
let selectedDownloadCookiesFile = null;
let selectedDownloadProxy = null;
let selectedDownloadDrive = false;
let selectedDriveLanguage = "jp"; // Mặc định là tiếng Nhật
let selectedStockOutputFolder = null;

async function selectDownloadFile() {
  if (!checkElectronAPI()) return;
  try {
    const filePath = await window.electronAPI.selectFile({
      filters: [
        { name: "Text Files", extensions: ["txt"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (filePath) {
      selectedUrlsFile = filePath;
      document.getElementById("download-urls-file").value = filePath;
      // Removed folder path display
      saveSettings();
    }
  } catch (error) {
    console.error("Error selecting file:", error);
    alert("Lỗi khi chọn file: " + error.message);
  }
}

function clearDownloadUrlsFile() {
  selectedUrlsFile = null;
  const input = document.getElementById("download-urls-file");
  if (input) input.value = "";
  saveSettings();
}

async function selectDownloadOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedDownloadOutputFolder = folder;
    document.getElementById("download-output-folder").value = folder;
    // Removed folder path display
    saveSettings();
  }
}

function clearDownloadOutputFolder() {
  selectedDownloadOutputFolder = null;
  const input = document.getElementById("download-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectDownloadDescFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedDownloadDescFolder = folder;
    document.getElementById("download-desc-folder").value = folder;
    saveSettings();
  }
}

function clearDownloadDescFolder() {
  selectedDownloadDescFolder = null;
  const input = document.getElementById("download-desc-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectDownloadOverlayImagesFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedDownloadOverlayImagesFolder = folder;
    document.getElementById("download-overlay-images-folder").value = folder;
    // Removed folder path display
    saveSettings();
  }
}

function clearDownloadOverlayImagesFolder() {
  selectedDownloadOverlayImagesFolder = null;
  const input = document.getElementById("download-overlay-images-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectDownloadThumbsFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedDownloadThumbsFolder = folder;
    document.getElementById("download-thumbs-folder").value = folder;
    saveSettings();
  }
}

function clearDownloadThumbsFolder() {
  selectedDownloadThumbsFolder = null;
  const input = document.getElementById("download-thumbs-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectDownloadCookiesFile() {
  if (!checkElectronAPI()) return;
  try {
    const filePath = await window.electronAPI.selectFile({
      filters: [
        { name: "Text Files", extensions: ["txt"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (filePath) {
      selectedDownloadCookiesFile = filePath;
      document.getElementById("download-cookies-file").value = filePath;
      saveSettings();
    }
  } catch (error) {
    console.error("Error selecting cookies file:", error);
    alert("Lỗi khi chọn file: " + error.message);
  }
}

function clearDownloadCookiesFile() {
  selectedDownloadCookiesFile = null;
  const input = document.getElementById("download-cookies-file");
  if (input) input.value = "";
  saveSettings();
}

function toggleDownloadDrive() {
  const driveCheckbox = document.getElementById("download-drive");
  const languageGroup = document.getElementById("drive-language-group");

  if (driveCheckbox) {
    selectedDownloadDrive = driveCheckbox.checked;

    // Hiển thị/ẩn dropdown ngôn ngữ
    if (languageGroup) {
      languageGroup.style.display = selectedDownloadDrive ? "block" : "none";
    }

    saveSettings();
  }
}

function updateDriveLanguage() {
  const languageSelect = document.getElementById("drive-language");
  if (languageSelect) {
    selectedDriveLanguage = languageSelect.value;
    saveSettings();
  }
}

async function downloadYtDlp() {
  if (!checkElectronAPI()) return;

  const btn = document.getElementById("download-ytdlp-btn");
  const statusDiv = document.getElementById("ytdlp-download-status");

  if (!btn || !statusDiv) return;

  // Disable button and show status
  btn.disabled = true;
  btn.textContent = "⏳";
  statusDiv.style.display = "block";
  statusDiv.innerHTML = "🔄 Đang tải yt-dlp mới nhất từ GitHub...";
  statusDiv.style.color = "#1565c0";
  statusDiv.style.background = "#e3f2fd";

  try {
    const result = await window.electronAPI.downloadYtDlp();

    if (result.success) {
      statusDiv.innerHTML = `✅ ${
        result.message || "Đã tải yt-dlp mới nhất thành công!"
      }<br><small style="display: block; margin-top: 5px;">Bạn có thể sử dụng ngay mà không cần khởi động lại ứng dụng.</small>`;
      statusDiv.style.color = "#2e7d32";
      statusDiv.style.background = "#e8f5e9";
      btn.textContent = "📥";
    } else {
      statusDiv.innerHTML = `❌ Lỗi: ${result.error || "Không thể tải yt-dlp"}`;
      statusDiv.style.color = "#c62828";
      statusDiv.style.background = "#ffebee";
      btn.textContent = "📥";
    }
  } catch (error) {
    statusDiv.innerHTML = `❌ Lỗi: ${getErrorMessage(error)}`;
    statusDiv.style.color = "#c62828";
    statusDiv.style.background = "#ffebee";
    btn.textContent = "📥";
  } finally {
    btn.disabled = false;
  }
}

async function runDownload() {
  if (!checkElectronAPI()) return;

  clearOutput("download");
  showOutput("download", "🚀 Đang tải video...\n\n");

  // Đảm bảo load settings từ project hiện tại trước khi chạy
  // để đảm bảo dùng settings mới nhất từ project file
  if (currentProjectName && checkElectronAPI() && window.electronAPI) {
    try {
      const result =
        await window.electronAPI.loadProjectConfig(currentProjectName);
      if (result.success && result.config && result.config.download) {
        // Cập nhật các biến từ project config
        if (result.config.download.urlsFile) {
          selectedUrlsFile = result.config.download.urlsFile;
        }
        if (result.config.download.outputFolder) {
          selectedDownloadOutputFolder = result.config.download.outputFolder;
        }
        if (result.config.download.descFolder) {
          selectedDownloadDescFolder = result.config.download.descFolder;
        }
        if (result.config.download.overlayImagesFolder) {
          selectedDownloadOverlayImagesFolder =
            result.config.download.overlayImagesFolder;
        }
        if (result.config.download.thumbsFolder) {
          selectedDownloadThumbsFolder = result.config.download.thumbsFolder;
        }
        if (result.config.download.cookiesFile) {
          selectedDownloadCookiesFile = result.config.download.cookiesFile;
        }
        // Không ghi đè input field proxy ở đây - để user có thể update proxy
        // và giá trị đó sẽ được ưu tiên khi lấy từ input field bên dưới
        // Chỉ load proxy từ config nếu input field đang trống (user chưa chỉnh sửa)
        const proxyInput = document.getElementById("download-proxy");
        const currentProxyValue = proxyInput?.value?.trim();
        
        if (!currentProxyValue && result.config.download.proxy !== undefined) {
          const configProxy = result.config.download.proxy;
          // Chỉ set nếu config có giá trị hợp lệ (không phải null hoặc empty)
          if (configProxy && typeof configProxy === 'string' && configProxy.trim()) {
            selectedDownloadProxy = configProxy.trim();
            if (proxyInput) {
              proxyInput.value = configProxy.trim();
            }
          } else {
            // Nếu config có proxy null/empty, clear nó
            selectedDownloadProxy = null;
            if (proxyInput) {
              proxyInput.value = "";
            }
          }
        } else if (currentProxyValue) {
          // Nếu input field đã có giá trị (user đã chỉnh sửa), dùng giá trị đó
          selectedDownloadProxy = currentProxyValue;
        } else {
          // Nếu cả input field và config đều không có proxy, clear nó
          selectedDownloadProxy = null;
        }
        if (result.config.download.downloadDrive !== undefined) {
          selectedDownloadDrive = result.config.download.downloadDrive;
          const driveCheckbox = document.getElementById("download-drive");
          if (driveCheckbox) {
            driveCheckbox.checked = result.config.download.downloadDrive;
            // Hiển thị/ẩn dropdown ngôn ngữ
            const languageGroup = document.getElementById(
              "drive-language-group",
            );
            if (languageGroup) {
              languageGroup.style.display = result.config.download.downloadDrive
                ? "block"
                : "none";
            }
          }
        }
        if (result.config.download.driveLanguage !== undefined) {
          selectedDriveLanguage = result.config.download.driveLanguage;
          const languageSelect = document.getElementById("drive-language");
          if (languageSelect) {
            languageSelect.value = result.config.download.driveLanguage;
          }
        }
      }
    } catch (error) {
      console.error("Error loading project config before download:", error);
    }
  }

  // Lấy proxy từ input field (nếu có thay đổi)
  const proxyInput = document.getElementById("download-proxy");
  if (proxyInput) {
    const proxyValue = proxyInput.value.trim();
    // Nếu proxy bị bỏ trống, set thành null (không phải empty string)
    selectedDownloadProxy = proxyValue || null;
  }

  // Lấy downloadDrive từ checkbox (nếu có thay đổi)
  const driveCheckbox = document.getElementById("download-drive");
  if (driveCheckbox) {
    selectedDownloadDrive = driveCheckbox.checked;
    // Hiển thị/ẩn dropdown ngôn ngữ
    const languageGroup = document.getElementById("drive-language-group");
    if (languageGroup) {
      languageGroup.style.display = driveCheckbox.checked ? "block" : "none";
    }
  }

  // Lấy driveLanguage từ dropdown (nếu có thay đổi)
  const languageSelect = document.getElementById("drive-language");
  if (languageSelect) {
    selectedDriveLanguage = languageSelect.value;
  }

  let hasError = false;
  let errorMessage = "";

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("download", data);
      // Kiểm tra các lỗi phổ biến của yt-dlp
      const errorPatterns = [
        /yt-dlp.*error/i,
        /ERROR/i,
        /Unable to download/i,
        /This video is unavailable/i,
        /Sign in to confirm your age/i,
        /Video unavailable/i,
        /Private video/i,
        /yt-dlp.*not found/i,
        /executable.*not found/i,
      ];

      const lowerData = data.toLowerCase();
      if (errorPatterns.some((pattern) => pattern.test(data))) {
        hasError = true;
        if (!errorMessage) {
          errorMessage = data;
        }
      }
    });

    // Không cần truyền downloadConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript("download.js", [], options);

    if (hasError) {
      showOutput(
        "download",
        "\n\n⚠️ Có một số lỗi xảy ra trong quá trình tải.\n",
      );
      showOutput(
        "download",
        "💡 Gợi ý: Nếu gặp lỗi liên quan đến yt-dlp, vui lòng tải lại yt-dlp mới nhất ở phần trên.\n",
      );
    } else {
      showOutput("download", "\n\n✅ Hoàn thành!");
    }
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    showOutput("download", `\n\n❌ Lỗi: ${errorMsg}\n`);
    showOutput(
      "download",
      "\n💡 Gợi ý: Nếu lỗi liên quan đến yt-dlp, vui lòng tải lại yt-dlp mới nhất ở phần trên.\n",
    );
  }
}

// Retry - Tải lại video lỗi (đã chuyển vào tab download)
async function runRetry() {
  if (!checkElectronAPI()) return;

  clearOutput("download");
  showOutput("download", "🚀 Đang tải lại video lỗi...\n\n");

  // Đảm bảo load settings từ project hiện tại trước khi chạy
  // để đảm bảo dùng settings mới nhất từ project file
  if (currentProjectName && checkElectronAPI() && window.electronAPI) {
    try {
      const result =
        await window.electronAPI.loadProjectConfig(currentProjectName);
      if (result.success && result.config && result.config.download) {
        // Cập nhật các biến từ project config
        if (result.config.download.urlsFile) {
          selectedUrlsFile = result.config.download.urlsFile;
        }
        if (result.config.download.outputFolder) {
          selectedDownloadOutputFolder = result.config.download.outputFolder;
        }
        if (result.config.download.descFolder) {
          selectedDownloadDescFolder = result.config.download.descFolder;
        }
        if (result.config.download.overlayImagesFolder) {
          selectedDownloadOverlayImagesFolder =
            result.config.download.overlayImagesFolder;
        }
        if (result.config.download.thumbsFolder) {
          selectedDownloadThumbsFolder = result.config.download.thumbsFolder;
        }
        if (result.config.download.cookiesFile) {
          selectedDownloadCookiesFile = result.config.download.cookiesFile;
        }
      }
    } catch (error) {
      console.error("Error loading project config before retry:", error);
    }
  }

  // Không cần truyền downloadConfig nữa - script sẽ đọc trực tiếp từ project JSON
  const options = {};

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("download", data);
    });

    await window.electronAPI.runScript("download.js", ["retry"], options);
    showOutput("download", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("download", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Stock Download (Pexels & Pixabay)
function toggleStockPexels() {
  const use = document.getElementById("stock-use-pexels")?.checked;
  const group = document.getElementById("stock-pexels-api-group");
  if (group) group.style.display = use ? "block" : "none";
}

function toggleStockPixabay() {
  const use = document.getElementById("stock-use-pixabay")?.checked;
  const group = document.getElementById("stock-pixabay-api-group");
  if (group) group.style.display = use ? "block" : "none";
}

function toggleStockCut() {
  const cut = document.getElementById("stock-cut")?.checked;
  const group = document.getElementById("stock-trim-seconds-group");
  if (group) group.style.display = cut ? "block" : "none";
}

async function selectStockOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedStockOutputFolder = folder;
    document.getElementById("stock-output-folder").value = folder;
    saveSettings();
  }
}

function clearStockOutputFolder() {
  selectedStockOutputFolder = null;
  const input = document.getElementById("stock-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function runStockDownload() {
  if (!checkElectronAPI()) return;

  const usePexels = document.getElementById("stock-use-pexels")?.checked ?? false;
  const usePixabay = document.getElementById("stock-use-pixabay")?.checked ?? false;
  if (!usePexels && !usePixabay) {
    alert("Chọn ít nhất một nguồn: Pexels hoặc Pixabay.");
    return;
  }
  if (usePexels && !document.getElementById("stock-pexels-api-key")?.value?.trim()) {
    alert("Bật Pexels cần nhập API key Pexels.");
    return;
  }
  if (usePixabay && !document.getElementById("stock-pixabay-api-key")?.value?.trim()) {
    alert("Bật Pixabay cần nhập API key Pixabay.");
    return;
  }
  const query = document.getElementById("stock-search-query")?.value?.trim();
  if (!query) {
    alert("Nhập từ khóa tìm kiếm (Search query).");
    return;
  }
  const maxVideos = parseInt(document.getElementById("stock-max-videos")?.value || "30", 10) || 30;
  const outFolder = selectedStockOutputFolder || "";

  clearOutput("stock-download");
  showOutput("stock-download", "🚀 Đang tải video từ Pexels/Pixabay...\n\n");

  const cut = document.getElementById("stock-cut")?.checked ?? false;
  const trimSeconds = cut ? (parseInt(document.getElementById("stock-trim-seconds")?.value || "3", 10) || 3) : 0;
  const env = {
    STOCK_USE_PEXELS: usePexels ? "1" : "0",
    STOCK_USE_PIXABAY: usePixabay ? "1" : "0",
    STOCK_PEXELS_API_KEY: usePexels ? (document.getElementById("stock-pexels-api-key")?.value?.trim() || "") : "",
    STOCK_PIXABAY_API_KEY: usePixabay ? (document.getElementById("stock-pixabay-api-key")?.value?.trim() || "") : "",
    STOCK_QUERY: query,
    STOCK_MAX_VIDEOS: String(maxVideos),
    STOCK_OUT_DIR: outFolder || "",
    STOCK_ORIENTATION: document.getElementById("stock-orientation")?.value || "landscape",
    STOCK_CONVERT_720: document.getElementById("stock-convert-720")?.checked ? "1" : "0",
    STOCK_REMOVE_AUDIO: document.getElementById("stock-remove-audio")?.checked ? "1" : "0",
    STOCK_TRIM_SECONDS: String(trimSeconds),
  };

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("stock-download", data);
    });
    await window.electronAPI.runScript("stockDownloader.js", [], { env });
    showOutput("stock-download", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("stock-download", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Video Snow
let selectedVideoSnowInputFolder = null;
let selectedVideoSnowOutputFolder = null;
let selectedVideoSnowSnowFile = null;

async function selectVideoSnowInputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedVideoSnowInputFolder = folder;
    document.getElementById("video-snow-input-folder").value = folder;
    saveSettings();
  }
}

function clearVideoSnowInputFolder() {
  selectedVideoSnowInputFolder = null;
  const input = document.getElementById("video-snow-input-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectVideoSnowOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedVideoSnowOutputFolder = folder;
    document.getElementById("video-snow-output-folder").value = folder;
    saveSettings();
  }
}

function clearVideoSnowOutputFolder() {
  selectedVideoSnowOutputFolder = null;
  const input = document.getElementById("video-snow-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectVideoSnowSnowFile() {
  if (!checkElectronAPI()) return;
  try {
    const filePath = await window.electronAPI.selectFile({
      filters: [
        { name: "Video Files", extensions: ["mp4", "mov", "avi", "mkv"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (filePath) {
      selectedVideoSnowSnowFile = filePath;
      document.getElementById("video-snow-snow-file").value = filePath;
      saveSettings();
    }
  } catch (error) {
    console.error("Error selecting file:", error);
    alert("Lỗi khi chọn file: " + error.message);
  }
}

function clearVideoSnowSnowFile() {
  selectedVideoSnowSnowFile = null;
  const input = document.getElementById("video-snow-snow-file");
  if (input) input.value = "";
  saveSettings();
}

async function runVideoSnow() {
  if (!checkElectronAPI()) return;

  clearOutput("video-snow");
  showOutput("video-snow", "🚀 Đang tạo video từ ảnh...\n\n");

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("video-snow", data);
    });

    const maxConcurrent =
      parseInt(document.getElementById("video-snow-max-concurrent").value) || 3;
    const segmentMin =
      parseInt(document.getElementById("video-snow-segment-min").value) || 10;
    const segmentMax =
      parseInt(document.getElementById("video-snow-segment-max").value) || 15;

    // Không cần truyền videoSnowConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript("createVideoSnow.js", [], options);
    showOutput("video-snow", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("video-snow", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Background Video
let selectedBgInputFolder = null;
let selectedBgOutputFolder = null;

async function selectBgInputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedBgInputFolder = folder;
    document.getElementById("bg-input-folder").value = folder;
    saveSettings();
  }
}

function clearBgInputFolder() {
  selectedBgInputFolder = null;
  const input = document.getElementById("bg-input-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectBgOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedBgOutputFolder = folder;
    document.getElementById("bg-output-folder").value = folder;
    saveSettings();
  }
}

function clearBgOutputFolder() {
  selectedBgOutputFolder = null;
  const input = document.getElementById("bg-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function runBgVideo() {
  const count = document.getElementById("bg-count").value;

  if (!count) {
    alert("Vui lòng nhập số lượng video!");
    return;
  }

  if (!checkElectronAPI()) return;

  clearOutput("bg-video");
  showOutput(
    "bg-video",
    `🚀 Đang tạo video backgrounds với count=${count}...\n\n`,
  );

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("bg-video", data);
    });

    const targetDuration =
      parseInt(document.getElementById("bg-target-duration").value) || 3600;
    const sourceCount =
      parseInt(document.getElementById("bg-source-count").value) || 10;
    const avgClipDuration =
      parseInt(document.getElementById("bg-avg-clip-duration").value) || 12;

    // Không cần truyền bgVideoConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript(
      "createVideoBackgrounds.js",
      [count],
      options,
    );
    showOutput("bg-video", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("bg-video", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Trim
let selectedTrimInputFolder = null;
let selectedTrimOutputFolder = null;

async function selectTrimInputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedTrimInputFolder = folder;
    document.getElementById("trim-input-folder").value = folder;
    saveSettings();
  }
}

function clearTrimInputFolder() {
  selectedTrimInputFolder = null;
  const input = document.getElementById("trim-input-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectTrimOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedTrimOutputFolder = folder;
    document.getElementById("trim-output-folder").value = folder;
    // Removed folder path display
    saveSettings();
  }
}

async function runTrim() {
  if (!checkElectronAPI()) return;

  const startTime =
    parseFloat(document.getElementById("trim-start-time").value) || 0;
  const duration =
    parseFloat(document.getElementById("trim-duration").value) || 30;

  if (startTime < 0) {
    alert("Thời gian bắt đầu phải lớn hơn hoặc bằng 0!");
    return;
  }

  if (duration <= 0) {
    alert("Thời gian cắt phải lớn hơn 0!");
    return;
  }

  clearOutput("trim");
  showOutput(
    "trim",
    `🚀 Đang cắt video từ giây ${startTime}, độ dài ${duration}s...\n\n`,
  );

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("trim", data);
    });

    // Không cần truyền trimConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript("trim-videos.js", [], options);
    showOutput("trim", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("trim", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Cut BG
let selectedCutBgInputFolder = null;
let selectedCutBgOutputFolder = null;

async function selectCutBgInputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedCutBgInputFolder = folder;
    document.getElementById("cut-bg-input-folder").value = folder;
    saveSettings();
  }
}

function clearCutBgInputFolder() {
  selectedCutBgInputFolder = null;
  const input = document.getElementById("cut-bg-input-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectCutBgOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedCutBgOutputFolder = folder;
    document.getElementById("cut-bg-output-folder").value = folder;
    saveSettings();
  }
}

function clearCutBgOutputFolder() {
  selectedCutBgOutputFolder = null;
  const input = document.getElementById("cut-bg-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function runCutBg() {
  if (!checkElectronAPI()) return;

  await saveSettings(); // Lưu settings trước khi chạy script

  clearOutput("cut-bg");
  showOutput("cut-bg", "🚀 Đang cắt video background...\n\n");

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("cut-bg", data);
    });

    // Không cần truyền cutBgConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript("cut-bg.js", [], options);
    showOutput("cut-bg", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("cut-bg", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Thumb
let selectedThumbInputFolder = null;
let selectedThumbOverlayFolder = null;
let selectedThumbOutputFolder = null;

async function selectThumbInputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedThumbInputFolder = folder;
    document.getElementById("thumb-input-folder").value = folder;
    saveSettings();
  }
}

function clearThumbInputFolder() {
  selectedThumbInputFolder = null;
  const input = document.getElementById("thumb-input-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectThumbOverlayFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedThumbOverlayFolder = folder;
    document.getElementById("thumb-overlay-folder").value = folder;
    saveSettings();
  }
}

function clearThumbOverlayFolder() {
  selectedThumbOverlayFolder = null;
  const input = document.getElementById("thumb-overlay-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectThumbOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedThumbOutputFolder = folder;
    document.getElementById("thumb-output-folder").value = folder;
    saveSettings();
  }
}

function clearThumbOutputFolder() {
  selectedThumbOutputFolder = null;
  const input = document.getElementById("thumb-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function runThumb() {
  if (!checkElectronAPI()) return;

  clearOutput("thumb");
  showOutput("thumb", "🚀 Đang tạo ảnh thu nhỏ...\n\n");

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("thumb", data);
    });

    // Không cần truyền thumbConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript("thumb.js", [], options);
    showOutput("thumb", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("thumb", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Get URL
let selectedGetUrlOutputFolder = null;

async function selectGetUrlOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedGetUrlOutputFolder = folder;
    document.getElementById("get-url-output-folder").value = folder;
    saveSettings();
  }
}

function clearGetUrlOutputFolder() {
  selectedGetUrlOutputFolder = null;
  const input = document.getElementById("get-url-output-folder");
  if (input) input.value = "";
  saveSettings();
}

async function runGetUrl() {
  const handle = document.getElementById("channel-handle").value.trim();

  if (!handle) {
    alert("Vui lòng nhập channel handle!");
    return;
  }

  if (!checkElectronAPI()) return;

  clearOutput("get-url");
  showOutput("get-url", `🚀 Đang lấy URL từ channel ${handle}...\n\n`);

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("get-url", data);
    });

    // Không cần truyền getUrlConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript("get-url.js", [handle], options);
    showOutput("get-url", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("get-url", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Normalize
let selectedNormalizeInputFolder = null;

async function selectNormalizeInputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedNormalizeInputFolder = folder;
    document.getElementById("normalize-input-folder").value = folder;
    saveSettings();
  }
}

function clearNormalizeInputFolder() {
  selectedNormalizeInputFolder = null;
  const input = document.getElementById("normalize-input-folder");
  if (input) input.value = "";
  saveSettings();
}

async function runNormalize() {
  if (!checkElectronAPI()) return;

  clearOutput("normalize");
  showOutput("normalize", "🚀 Đang sửa tên ảnh thu nhỏ...\n\n");

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("normalize", data);
    });

    // Không cần truyền normalizeConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript("convertNormalize.js", [], options);
    showOutput("normalize", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("normalize", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Help Modal Functions
const helpContents = {
  render: {
    title: "Hướng dẫn Render Video",
    content: `
      <h4>📋 Chức năng:</h4>
      <p>Render video bằng cách kết hợp video overlay với video background theo các chế độ khác nhau. Hệ thống sẽ tự động xử lý nhiều video cùng lúc dựa trên số ngày và số video mỗi folder.</p>
      
      <h4>🔧 Các tham số chi tiết:</h4>
      <ul>
        <li><strong>Số ngày:</strong> Render ngày số nào. Ví dụ: nhập "1" sẽ render video cho ngày số 1. Mỗi ngày sẽ có folder riêng trong output.</li>
        <li><strong>Số video mỗi folder:</strong> Số lượng video sẽ được render trong mỗi folder của mỗi ngày. Ví dụ: "5" nghĩa là mỗi ngày sẽ có 5 video được render trong folder(Tương ứng với folder trong backgrounds).</li>
        <li><strong>Folder Overlay:</strong> Folder chứa video overlay (video chính cần render). Cấu trúc: <code>./overlays/video1.mp4</code>. Để trống sẽ dùng <code>./overlays</code></li>
        <li><strong>Folder Background:</strong> Folder chứa video background (nền). Cấu trúc: <code>./backgrounds/1/bg1.mp4</code>. Để trống sẽ dùng <code>./backgrounds</code></li>
        <li><strong>Chu kỳ (ngày):</strong> Số ngày mà mẻ video đó up lên kênh (dùng cho Dashboard: còn X ngày là phải có video)</li>
      </ul>
      
      <h4>🎨 Các chế độ Render:</h4>
      <li><strong>Top Transparent:</strong> 
          <ul>
            <li>Đặt video overlay lên trên video background với độ trong suốt</li>
            <li>Opacity: Điều chỉnh độ trong suốt (0.0 = hoàn toàn trong suốt, 1.0 = không trong suốt)</li>
            <li>Mặc định: 0.7 (70% độ mờ)</li>
          </ul>
        </li>
        <li><strong>Chroma Key:</strong> 
          <ul>
            <li>Xóa nền của video overlay dựa trên màu chỉ định</li>
            <li>Dùng màu: Nhập mã màu hex (ví dụ: D4F9D7) để xóa nền có màu đó</li>
            <li>Dùng file: Chọn file <code>chromaKey.txt</code> chứa mã màu (mỗi dòng một màu)</li>
            <li>Phù hợp cho video có nền xanh lá (green screen) hoặc nền đồng nhất</li>
          </ul>
        </li>
        <li><strong>Crop:</strong> 
          <ul>
            <li>Cắt một phần của video overlay</li>
            <li>Crop Height: Chiều cao phần cần cắt (pixel, mặc định: 220)</li>
            <li>Crop Y Offset: Vị trí bắt đầu cắt từ trên xuống (pixel, mặc định: 490)</li>
            <li>Ví dụ: Height=220, Y Offset=490 nghĩa là cắt 220px từ vị trí 490px</li>
          </ul>
        </li>
        <li><strong>Keep Color:</strong> 
          <ul>
            <li>Chỉ giữ lại các màu được chỉ định, xóa các màu khác</li>
            <li>Mảng màu: Nhập mã màu hex, cách nhau bởi dấu phẩy (ví dụ: FBFF02,FF0000)</li>
            <li>Có thể bật Crop để kết hợp cắt video</li>
          </ul>
        </li>
      </ul>
      
      <h4>⚙️ Tùy chọn nâng cao:</h4>
      <ul>
        <li><strong>Use GPU (NVIDIA):</strong> Bật để sử dụng card đồ họa NVIDIA tăng tốc render. Yêu cầu card NVIDIA và driver mới nhất.</li>
        <li><strong>GPU Video Codec:</strong> Codec sử dụng khi render bằng GPU (mặc định: h264_nvenc)</li>
        <li><strong>Max Concurrent Processes:</strong> Số video render đồng thời (mặc định: 2). Tăng số này sẽ nhanh hơn nhưng tốn nhiều tài nguyên hơn.</li>
      </ul>
      
      <h4>💡 Lưu ý quan trọng:</h4>
      <ul>
        <li>Đảm bảo cấu trúc folder input đúng: <code>overlays/video1.mp4</code>, <code>backgrounds/1/bg1.mp4</code></li>
        <li>Tên file video trong overlay và background nên khớp nhau để render đúng</li>
        <li>Video output sẽ được lưu tự động với tên giống video overlay</li>
        <li>Nếu dùng GPU, đảm bảo card NVIDIA đã cài đặt driver và hỗ trợ hardware encoding</li>
        <li>Quá trình render có thể mất nhiều thời gian tùy vào độ dài video và số lượng</li>
      </ul>
    `,
  },
  download: {
    title: "Hướng dẫn Tải video",
    content: `
      <h4>📋 Chức năng:</h4>
      <p>Tải video từ YouTube, TikTok, hoặc các nền tảng khác từ danh sách URL. Hệ thống sẽ tự động tải video, tạo thumbnail và xử lý overlay.</p>
      
      <h4>🔧 Các tham số chi tiết:</h4>
      <ul>
        <li><strong>File URLs:</strong> 
          <ul>
            <li>File text chứa danh sách URL (mỗi URL một dòng)</li>
            <li>Ví dụ nội dung file: <br><code>https://youtube.com/watch?v=abc123<br>https://tiktok.com/@user/video/123456</code></li>
            <li>Để trống sẽ dùng <code>./urls.txt</code></li>
            <li>Có thể tạo file này bằng chức năng "Lấy URL"</li>
          </ul>
        </li>
        <li><strong>Folder tải về:</strong> 
          <ul>
            <li>Folder lưu video đã tải về</li>
            <li>Video sẽ được đặt tên tự động theo tên video gốc</li>
            <li>Để trống sẽ dùng <code>./overlays</code></li>
          </ul>
        </li>
        <li><strong>Folder ảnh overlay:</strong> 
          <ul>
            <li>Folder chứa ảnh overlay sẽ được thêm vào thumbnail</li>
            <li>Ảnh overlay sẽ được kết hợp với thumbnail gốc của video</li>
            <li>Để trống sẽ dùng <code>./images</code></li>
          </ul>
        </li>
        <li><strong>Folder output thumbs:</strong> 
          <ul>
            <li>Folder lưu thumbnail đã xử lý (có overlay)</li>
            <li>Thumbnail sẽ được tạo tự động từ video và kết hợp với ảnh overlay</li>
            <li>Cấu trúc: <code>./thumbs/ngày1/video1.jpg</code></li>
            <li>Để trống sẽ dùng <code>./thumbs</code></li>
          </ul>
        </li>
        <li><strong>File cookies.txt:</strong> 
          <ul>
            <li>File cookies để tải video có bảo vệ hoặc video riêng tư</li>
            <li>Định dạng: Netscape HTTP Cookie File</li>
            <li>Có thể export từ trình duyệt (Chrome/Firefox extension)</li>
            <li>Để trống sẽ dùng <code>./cookies.txt</code></li>
            <li>Không bắt buộc nếu video công khai</li>
          </ul>
        </li>
      </ul>
      
      <h4>🔄 Quy trình hoạt động:</h4>
      <ol>
        <li>Đọc danh sách URL từ file</li>
        <li>Tải video từ mỗi URL (sử dụng yt-dlp)</li>
        <li>Lưu video vào folder tải về</li>
        <li>Tạo thumbnail từ video</li>
        <li>Kết hợp thumbnail với ảnh overlay</li>
        <li>Lưu thumbnail đã xử lý vào folder output thumbs</li>
      </ol>
      
      <h4>💡 Lưu ý quan trọng:</h4>
      <ul>
        <li>File urls.txt phải có định dạng UTF-8, mỗi URL một dòng</li>
        <li>Video sẽ được tải với chất lượng tốt nhất có sẵn</li>
        <li>Nếu video tải lỗi, URL sẽ được ghi vào log để tải lại sau</li>
        <li>Thumbnail sẽ tự động khớp với tên video (ví dụ: video.mp4 → video.jpg)</li>
        <li>Quá trình tải có thể mất nhiều thời gian tùy vào số lượng và độ dài video</li>
        <li>Đảm bảo có kết nối internet ổn định</li>
      </ul>
      
      <h4>🔄 Tải lại video lỗi:</h4>
      <p>Sau khi tải video, nếu có video bị lỗi, bạn có thể sử dụng nút <strong>"Tải lại video lỗi"</strong> để tự động tải lại các video đã bị lỗi.</p>
      
      <h4>📋 Cách hoạt động:</h4>
      <ol>
        <li>Hệ thống đọc file log <code>failed_urls.txt</code> (tự động tạo khi có video lỗi)</li>
        <li>Lấy từng URL từ log file</li>
        <li>Thử tải lại video từ URL đó</li>
        <li>Nếu thành công: Xóa URL khỏi log</li>
        <li>Nếu vẫn lỗi: Giữ nguyên trong log để thử lại sau</li>
      </ol>
      
      <h4>💡 Lưu ý về tải lại:</h4>
      <ul>
        <li>Chức năng này chỉ hoạt động sau khi đã chạy "Tải video" và có video bị lỗi</li>
        <li>File <code>failed_urls.txt</code> được tạo tự động trong thư mục gốc</li>
        <li>Có thể chạy nhiều lần cho đến khi tất cả video được tải thành công</li>
        <li>Nếu video vẫn lỗi sau nhiều lần thử, có thể do:
          <ul>
            <li>Video đã bị xóa hoặc không còn tồn tại</li>
            <li>Video bị giới hạn quyền truy cập</li>
            <li>Vấn đề về kết nối mạng</li>
            <li>URL không hợp lệ</li>
          </ul>
        </li>
      </ul>
    `,
  },
  "video-snow": {
    title: "Hướng dẫn Tạo video từ ảnh",
    content: `
      <h4>📋 Chức năng:</h4>
      <p>Chuyển đổi ảnh tĩnh thành video động với hiệu ứng tuyết rơi overlay. Mỗi ảnh sẽ được tạo thành một video segment có độ dài ngẫu nhiên.</p>
      
      <h4>🔧 Các tham số chi tiết:</h4>
      <ul>
        <li><strong>Folder ảnh input:</strong> 
          <ul>
            <li>Folder chứa các ảnh cần chuyển thành video</li>
            <li>Hỗ trợ định dạng: .jpg, .jpeg, .png</li>
            <li>Mỗi ảnh sẽ tạo một video segment riêng</li>
            <li>Để trống sẽ dùng <code>./image_backgrounds</code></li>
          </ul>
        </li>
        <li><strong>Folder output:</strong> 
          <ul>
            <li>Folder lưu video đã tạo</li>
            <li>Video sẽ có tên giống ảnh gốc (đổi extension thành .mp4)</li>
            <li>Ví dụ: <code>image1.jpg</code> → <code>image1.mp4</code></li>
            <li>Để trống sẽ dùng <code>./output_segments</code></li>
          </ul>
        </li>
        <li><strong>File Snow Video:</strong> 
          <ul>
            <li>File video hiệu ứng tuyết rơi sẽ được overlay lên ảnh</li>
            <li>Video này sẽ được lặp lại để phủ toàn bộ thời lượng video</li>
            <li>Đảm bảo file video có độ dài đủ để lặp</li>
            <li>Để trống sẽ dùng <code>./snow1.mp4</code></li>
          </ul>
        </li>
        <li><strong>Max Concurrent:</strong> 
          <ul>
            <li>Số video được tạo đồng thời (mặc định: 3)</li>
            <li>Tăng số này sẽ nhanh hơn nhưng tốn nhiều CPU/RAM hơn</li>
            <li>Khuyến nghị: 2-5 tùy vào cấu hình máy</li>
          </ul>
        </li>
        <li><strong>Segment Min (giây):</strong> 
          <ul>
            <li>Độ dài tối thiểu của mỗi video segment (mặc định: 10 giây)</li>
            <li>Mỗi video sẽ có độ dài ngẫu nhiên từ Min đến Max</li>
          </ul>
        </li>
        <li><strong>Segment Max (giây):</strong> 
          <ul>
            <li>Độ dài tối đa của mỗi video segment (mặc định: 15 giây)</li>
            <li>Ví dụ: Min=10, Max=15 → video sẽ dài 10-15 giây ngẫu nhiên</li>
          </ul>
        </li>
      </ul>
      
      <h4>🔄 Quy trình hoạt động:</h4>
      <ol>
        <li>Đọc danh sách ảnh từ folder input</li>
        <li>Với mỗi ảnh:
          <ul>
            <li>Chuyển ảnh thành video với độ dài ngẫu nhiên (Min-Max giây)</li>
            <li>Overlay video hiệu ứng tuyết lên ảnh</li>
            <li>Lưu video segment vào folder output</li>
          </ul>
        </li>
        <li>Xử lý nhiều ảnh đồng thời theo Max Concurrent</li>
      </ol>
      
      <h4>💡 Lưu ý:</h4>
      <ul>
        <li>Ảnh sẽ được scale để phù hợp với video tuyết</li>
        <li>Video output sẽ có chất lượng tốt, phù hợp để dùng làm background</li>
        <li>Có thể dùng các video segment này cho chức năng "Tạo video backgrounds"</li>
        <li>Đảm bảo file snow video có chất lượng tốt để overlay đẹp</li>
      </ul>
    `,
  },
  "bg-video": {
    title: "Hướng dẫn Tạo video backgrounds",
    content: `
      <h4>Chức năng:</h4>
      <p>Tạo video backgrounds dài từ các segments ngắn</p>
      
      <h4>Các bước sử dụng:</h4>
      <ul>
        <li><strong>Số lượng video mỗi folder:</strong> Số video background sẽ tạo cho mỗi folder</li>
        <li><strong>Folder input segments:</strong> Chọn folder chứa các video segments. Để trống sẽ dùng <code>./output_segments</code></li>
        <li><strong>Folder output:</strong> Chọn folder lưu video backgrounds. Để trống sẽ dùng <code>./backgrounds</code></li>
        <li><strong>Target Duration:</strong> Độ dài mục tiêu của video background (giây, mặc định: 3600 = 1 giờ)</li>
        <li><strong>Source Count:</strong> Số lượng segments nguồn sử dụng (mặc định: 10)</li>
        <li><strong>Avg Clip Duration:</strong> Độ dài trung bình mỗi clip (giây, mặc định: 12)</li>
      </ul>
      
      <h4>Lưu ý:</h4>
      <ul>
        <li>Video backgrounds sẽ được tạo bằng cách ghép các segments ngẫu nhiên</li>
        <li>Độ dài video sẽ gần bằng Target Duration</li>
      </ul>
    `,
  },
  trim: {
    title: "Hướng dẫn Cắt video",
    content: `
      <h4>📋 Chức năng:</h4>
      <p>Cắt video với thời gian và vị trí tùy chỉnh. Có thể cắt từ bất kỳ vị trí nào trong video và với độ dài tùy chọn.</p>
      
      <h4>🔧 Các tham số chi tiết:</h4>
      <ul>
        <li><strong>Folder input:</strong> 
          <ul>
            <li>Folder chứa video cần cắt</li>
            <li>Hỗ trợ định dạng: .mp4, .mov, .avi, .mkv, .webm</li>
            <li>Để trống sẽ dùng <code>./overlays</code></li>
          </ul>
        </li>
        <li><strong>Folder output:</strong> 
          <ul>
            <li>Folder lưu video đã cắt</li>
            <li>Video output sẽ giữ nguyên tên file gốc</li>
            <li>Để trống sẽ dùng <code>./overlays_trimmed</code></li>
          </ul>
        </li>
        <li><strong>Cắt từ giây thứ (Start time):</strong> 
          <ul>
            <li>Vị trí bắt đầu cắt trong video (giây)</li>
            <li>Giá trị: 0 = từ đầu video, 10 = từ giây thứ 10</li>
            <li>Có thể nhập số thập phân (ví dụ: 5.5 = 5 giây 500ms)</li>
            <li>Mặc định: 0 (từ đầu video)</li>
          </ul>
        </li>
        <li><strong>Thời gian cắt (Duration):</strong> 
          <ul>
            <li>Độ dài video sau khi cắt (giây)</li>
            <li>Ví dụ: Start time = 10, Duration = 30 → cắt từ giây 10 đến giây 40</li>
            <li>Có thể nhập số thập phân (ví dụ: 15.5 = 15 giây 500ms)</li>
            <li>Mặc định: 30 giây</li>
          </ul>
        </li>
      </ul>
      
      <h4>💡 Ví dụ cụ thể:</h4>
      <ul>
        <li><strong>Ví dụ 1:</strong> Start time = 0, Duration = 30
          <ul>
            <li>→ Cắt 30 giây đầu tiên của video</li>
          </ul>
        </li>
        <li><strong>Ví dụ 2:</strong> Start time = 10, Duration = 20
          <ul>
            <li>→ Cắt từ giây thứ 10 đến giây thứ 30 (20 giây)</li>
          </ul>
        </li>
        <li><strong>Ví dụ 3:</strong> Start time = 60, Duration = 15
          <ul>
            <li>→ Cắt từ giây thứ 60 đến giây thứ 75 (15 giây)</li>
          </ul>
        </li>
      </ul>
      
      <h4>⚠️ Lưu ý quan trọng:</h4>
      <ul>
        <li>Tất cả video trong folder input sẽ được cắt với cùng tham số</li>
        <li>Nếu video ngắn hơn (startTime + duration), sẽ cắt đến hết video</li>
        <li>Nếu startTime vượt quá độ dài video, video đó sẽ bị bỏ qua</li>
        <li>Video output sẽ được encode lại với codec H.264 (có thể mất thời gian)</li>
        <li>Chất lượng video được giữ ở mức tốt (CRF 23)</li>
      </ul>
    `,
  },
  "cut-bg": {
    title: "Hướng dẫn Cắt video background",
    content: `
      <h4>Chức năng:</h4>
      <p>Cắt video background thành các segments ngắn</p>
      
      <h4>Các bước sử dụng:</h4>
      <ul>
        <li><strong>Folder input:</strong> Chọn folder chứa video background cần cắt. Để trống sẽ dùng <code>./bgs</code></li>
        <li><strong>Folder output:</strong> Chọn folder lưu các segments đã cắt. Để trống sẽ dùng <code>./backgrounds</code></li>
      </ul>
      
      <h4>Lưu ý:</h4>
      <ul>
        <li>Video background sẽ được cắt thành nhiều segments ngẫu nhiên</li>
        <li>Mỗi segment có độ dài khác nhau</li>
      </ul>
    `,
  },
  thumb: {
    title: "Hướng dẫn Tạo ảnh thu nhỏ",
    content: `
      <h4>Chức năng:</h4>
      <p>Tạo ảnh thumbnail từ video với overlay</p>
      
      <h4>Các bước sử dụng:</h4>
      <ul>
        <li><strong>Folder input video:</strong> Chọn folder chứa video cần tạo thumbnail. Để trống sẽ dùng <code>./overlays</code></li>
        <li><strong>Folder ảnh overlay:</strong> Chọn folder chứa ảnh overlay. Để trống sẽ dùng <code>./images</code></li>
        <li><strong>Folder output thumbs:</strong> Chọn folder lưu thumbnail. Để trống sẽ dùng <code>./thumbs</code></li>
      </ul>
      
      <h4>Lưu ý:</h4>
      <ul>
        <li>Thumbnail sẽ được tạo từ frame đầu tiên của video</li>
        <li>Ảnh overlay sẽ được thêm vào thumbnail</li>
        <li>Cấu trúc folder output sẽ giống với folder input</li>
      </ul>
    `,
  },
  "get-url": {
    title: "Hướng dẫn Lấy URL",
    content: `
      <h4>Chức năng:</h4>
      <p>Lấy danh sách URL từ YouTube channel</p>
      
      <h4>Các bước sử dụng:</h4>
      <ul>
        <li><strong>Channel handle:</strong> Nhập handle của channel (ví dụ: <code>@line4091</code>)</li>
        <li><strong>Folder lưu kết quả:</strong> Chọn folder lưu file chứa danh sách URL. Để trống sẽ dùng <code>./channels</code></li>
      </ul>
      
      <h4>Lưu ý:</h4>
      <ul>
        <li>Handle channel phải bắt đầu bằng <code>@</code></li>
        <li>Danh sách URL sẽ được lưu vào file text</li>
        <li>Có thể dùng file này cho chức năng "Tải video"</li>
      </ul>
    `,
  },
  normalize: {
    title: "Hướng dẫn Sửa tên ảnh thu nhỏ",
    content: `
      <h4>Chức năng:</h4>
      <p>Chuẩn hóa tên file ảnh thu nhỏ</p>
      
      <h4>Các bước sử dụng:</h4>
      <ul>
        <li><strong>Folder thumbs:</strong> Chọn folder chứa ảnh thu nhỏ cần sửa tên. Để trống sẽ dùng <code>./thumbs</code></li>
      </ul>
      
      <h4>Lưu ý:</h4>
      <ul>
        <li>Tên file sẽ được chuẩn hóa để phù hợp với video tương ứng</li>
        <li>Chức năng này sẽ xử lý tất cả các ảnh trong folder và các folder con</li>
      </ul>
    `,
  },
  "stock-download": {
    title: "Hướng dẫn Tải video Pexels & Pixabay",
    content: `
      <h4>📋 Chức năng:</h4>
      <p>Tải video stock từ Pexels và/hoặc Pixabay theo từ khóa tìm kiếm. Có thể chọn một hoặc cả hai nguồn.</p>
      
      <h4>🔧 Các bước sử dụng:</h4>
      <ul>
        <li><strong>Tải từ Pexels:</strong> Tích vào ô "Tải từ Pexels" và nhập API key (lấy tại <a href="https://www.pexels.com/api/" target="_blank" rel="noopener">pexels.com/api</a>).</li>
        <li><strong>Tải từ Pixabay:</strong> Tích vào ô "Tải từ Pixabay" và nhập API key (lấy tại <a href="https://pixabay.com/api/docs/" target="_blank" rel="noopener">pixabay.com/api/docs</a>).</li>
        <li><strong>Từ khóa tìm kiếm:</strong> Nhập từ khóa tiếng Anh (ví dụ: nature, ocean, city).</li>
        <li><strong>Số lượng video:</strong> Số video cần tải (tổng từ cả hai nguồn nếu chọn cả Pexels và Pixabay).</li>
        <li><strong>Folder lưu video:</strong> Chọn thư mục lưu. Nếu để trống, video sẽ lưu vào thư mục mặc định.</li>
        <li><strong>Hướng video:</strong> Landscape (ngang), Portrait (dọc), hoặc Square (vuông).</li>
      </ul>
      
      <h4>Xử lý video sau khi tải:</h4>
      <ul>
        <li><strong>Convert về 720p:</strong> Bật để chuyển video về độ phân giải 720p; tắt thì giữ nguyên gốc.</li>
        <li><strong>Xóa âm thanh:</strong> Bật để bỏ track âm thanh; tắt thì giữ nguyên.</li>
        <li><strong>Cắt video:</strong> Bật để chỉ lấy N giây đầu; nhập số giây cần cắt. Tắt thì giữ full video.</li>
      </ul>
      
      <h4>💡 Lưu ý:</h4>
      <ul>
        <li>Chọn ít nhất một nguồn (Pexels hoặc Pixabay). Có thể tích cả hai để tải từ cả hai nguồn.</li>
        <li>API key được lưu trong cấu hình dự án, không gửi lên server nào khác.</li>
      </ul>
    `,
  },
  concat: {
    title: "Hướng dẫn Ghép video",
    content: `
      <h4>📋 Chức năng:</h4>
      <p>Ghép nhiều video ngắn lại thành video dài hơn. Có thể chèn thumbnail giữa các video để tạo hiệu ứng chuyển cảnh mượt mà, hoặc ghép trực tiếp không có thumbnail.</p>
      
      <h4>🔧 Các tham số chi tiết:</h4>
      <ul>
        <li><strong>Folder video input:</strong> 
          <ul>
            <li>Folder chứa các video cần ghép (BẮT BUỘC)</li>
            <li>Video phải có định dạng .mp4 hoặc .mov</li>
            <li>Video sẽ được sắp xếp theo tên (alphabetical order)</li>
            <li>Ví dụ: <code>video1.mp4, video2.mp4, video3.mp4</code></li>
          </ul>
        </li>
        <li><strong>Folder output:</strong> 
          <ul>
            <li>Folder lưu video đã ghép (BẮT BUỘC)</li>
            <li>Video output sẽ có tên theo video đầu tiên trong mỗi nhóm</li>
            <li>Ví dụ: Nhóm [video1, video2] → output: video1.mp4</li>
          </ul>
        </li>
        <li><strong>Chunk size:</strong> 
          <ul>
            <li>Số video sẽ ghép trong mỗi nhóm (mặc định: 2, tối thiểu: 2)</li>
            <li>Ví dụ: Chunk size = 2, có 6 video → tạo 3 video output</li>
            <li>Ví dụ: Chunk size = 3, có 9 video → tạo 3 video output</li>
            <li>Nhóm cuối cùng nếu ít hơn chunk size sẽ bị bỏ qua</li>
          </ul>
        </li>
        <li><strong>Chèn thumbnail giữa các video:</strong>
          <ul>
            <li><strong>BẬT:</strong> Video sẽ được ghép với thumbnail chèn giữa</li>
            <li style="margin-left: 20px;">Cấu trúc: Video1 → Thumbnail2 → Video2 → Thumbnail3 → Video3</li>
            <li style="margin-left: 20px;">Thumbnail sẽ được chuyển thành video với độ dài chỉ định</li>
            <li style="margin-left: 20px;">Tạo hiệu ứng chuyển cảnh mượt mà, chuyên nghiệp</li>
            <li><strong>TẮT:</strong> Video sẽ được ghép trực tiếp không có thumbnail</li>
            <li style="margin-left: 20px;">Cấu trúc: Video1 → Video2 → Video3</li>
            <li style="margin-left: 20px;">Nhanh hơn, không cần folder thumbnail</li>
          </ul>
        </li>
        <li><strong>Folder chứa thumb:</strong> (Chỉ hiện khi bật chèn thumbnail)
          <ul>
            <li>Folder chứa file thumbnail (ảnh .jpg)</li>
            <li>Tên file thumbnail PHẢI khớp với tên video</li>
            <li>Ví dụ: <code>video1.mp4</code> → <code>video1.jpg</code></li>
            <li>Ví dụ: <code>clip_001.mp4</code> → <code>clip_001.jpg</code></li>
            <li>Thumbnail sẽ được tìm tự động dựa trên tên video tiếp theo</li>
          </ul>
        </li>
        <li><strong>Thời gian thumbnail:</strong> (Chỉ hiện khi bật chèn thumbnail)
          <ul>
            <li>Thời gian hiển thị mỗi thumbnail (giây, mặc định: 3)</li>
            <li>Có thể điều chỉnh từ 0.1 giây trở lên</li>
            <li>Thời gian ngắn (1-2s): Chuyển cảnh nhanh, nhịp độ nhanh</li>
            <li>Thời gian dài (3-5s): Chuyển cảnh chậm, nhịp độ chậm</li>
          </ul>
        </li>
      </ul>
      
      <h4>🔄 Quy trình hoạt động:</h4>
      <ol>
        <li>Đọc danh sách video từ folder input</li>
        <li>Sắp xếp video theo tên (alphabetical)</li>
        <li>Chia video thành các nhóm (chunk) theo chunk size</li>
        <li>Với mỗi nhóm:
          <ul>
            <li>Nếu bật thumbnail: Ghép Video1 → Thumbnail2 → Video2 → Thumbnail3 → ...</li>
            <li>Nếu tắt thumbnail: Ghép Video1 → Video2 → Video3 → ...</li>
            <li>Sử dụng FFmpeg với codec copy (nhanh, không re-encode)</li>
          </ul>
        </li>
        <li>Lưu video output với tên video đầu tiên trong nhóm</li>
      </ol>
      
      <h4>💡 Ví dụ cụ thể:</h4>
      <p><strong>Trường hợp 1: Có thumbnail, chunk size = 2</strong></p>
      <ul>
        <li>Input: video1.mp4, video2.mp4, video3.mp4, video4.mp4</li>
        <li>Thumbnails: video2.jpg, video3.jpg, video4.jpg</li>
        <li>Output 1: video1.mp4 (chứa: video1 → video2.jpg → video2)</li>
        <li>Output 2: video3.mp4 (chứa: video3 → video4.jpg → video4)</li>
      </ul>
      
      <p><strong>Trường hợp 2: Không thumbnail, chunk size = 3</strong></p>
      <ul>
        <li>Input: video1.mp4, video2.mp4, video3.mp4, video4.mp4</li>
        <li>Output 1: video1.mp4 (chứa: video1 → video2 → video3)</li>
        <li>Video4 bị bỏ qua (nhóm cuối chỉ có 1 video)</li>
      </ul>
      
      <h4>⚠️ Lưu ý quan trọng:</h4>
      <ul>
        <li>Video input phải có định dạng .mp4 hoặc .mov</li>
        <li>Nếu dùng thumbnail, đảm bảo tên file thumbnail khớp chính xác với tên video</li>
        <li>Video output sẽ có tên theo video đầu tiên trong mỗi nhóm</li>
        <li>Nhóm cuối cùng nếu ít hơn chunk size sẽ bị bỏ qua</li>
        <li>Quá trình ghép sử dụng codec copy nên rất nhanh, không làm giảm chất lượng</li>
        <li>Thumbnail sẽ được chuyển thành video với thông số audio/video khớp với video gốc</li>
        <li>Đảm bảo có đủ dung lượng ổ cứng cho video output</li>
      </ul>
    `,
  },
};

function showHelp(tabId) {
  const modal = document.getElementById("helpModal");
  const title = document.getElementById("helpModalTitle");
  const body = document.getElementById("helpModalBody");

  if (helpContents[tabId]) {
    title.textContent = helpContents[tabId].title;
    body.innerHTML = helpContents[tabId].content;
    modal.classList.add("active");
  }
}

function closeHelp() {
  const modal = document.getElementById("helpModal");
  modal.classList.remove("active");
}

// Đóng modal khi click bên ngoài
document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("helpModal");
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeHelp();
    }
  });

  // Đóng modal bằng phím ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("active")) {
      closeHelp();
    }
  });
});

// Concat Video
let selectedConcatInputFolder = null;
let selectedConcatThumbsFolder = null;
let selectedConcatOutputFolder = null;

async function selectConcatInputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedConcatInputFolder = folder;
    document.getElementById("concat-input-folder").value = folder;
    saveSettings();
  }
}

function clearConcatInputFolder() {
  selectedConcatInputFolder = null;
  const input = document.getElementById("concat-input-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectConcatThumbsFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedConcatThumbsFolder = folder;
    document.getElementById("concat-thumbs-folder").value = folder;
    saveSettings();
  }
}

function clearConcatThumbsFolder() {
  selectedConcatThumbsFolder = null;
  const input = document.getElementById("concat-thumbs-folder");
  if (input) input.value = "";
  saveSettings();
}

async function selectConcatOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedConcatOutputFolder = folder;
    document.getElementById("concat-output-folder").value = folder;
    saveSettings();
  }
}

function clearConcatOutputFolder() {
  selectedConcatOutputFolder = null;
  const input = document.getElementById("concat-output-folder");
  if (input) input.value = "";
  saveSettings();
}

function toggleConcatThumbs() {
  const useThumbs = document.getElementById("concat-use-thumbs").checked;
  const thumbsOptions = document.getElementById("concat-thumbs-options");
  if (thumbsOptions) {
    thumbsOptions.style.display = useThumbs ? "block" : "none";
  }
}

async function runConcat() {
  const chunkSize =
    parseInt(document.getElementById("concat-chunk-size").value) || 2;
  const useThumbs = document.getElementById("concat-use-thumbs").checked;
  const thumbDuration =
    parseFloat(document.getElementById("concat-thumb-duration").value) || 3;

  if (!selectedConcatInputFolder) {
    alert("Vui lòng chọn folder video input!");
    return;
  }

  if (!selectedConcatOutputFolder) {
    alert("Vui lòng chọn folder output!");
    return;
  }

  if (chunkSize < 2) {
    alert("Chunk size phải lớn hơn hoặc bằng 2!");
    return;
  }

  if (useThumbs) {
    if (!selectedConcatThumbsFolder) {
      alert("Vui lòng chọn folder chứa thumbnail!");
      return;
    }
    if (thumbDuration <= 0) {
      alert("Thời gian thumbnail phải lớn hơn 0!");
      return;
    }
  }

  if (!checkElectronAPI()) return;

  clearOutput("concat");
  showOutput(
    "concat",
    `🚀 Đang ghép video với input="${selectedConcatInputFolder}", chunkSize=${chunkSize}, useThumbs=${useThumbs}...\n\n`,
  );

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("concat", data);
    });

    // Không cần truyền concatConfig nữa - script sẽ đọc trực tiếp từ project JSON
    const options = {};

    await window.electronAPI.runScript("concat-video.js", [], options);
    showOutput("concat", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("concat", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// ===== Tab Theo dõi Sheet =====
(function initSheetWatch() {
  const api = window.electronAPI?.sheet;
  if (!api) return;
  const $ = (id) => document.getElementById(id);
  const logEl = $("sw-log");
  const statusBody = $("sw-status-table")?.querySelector("tbody");
  const rows = new Map(); // channel -> {statusEl, todayEl, errEl}
  const rendered = new Map(); // channel -> count rendered this session

  function log(msg) {
    if (!logEl) return;
    logEl.textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  function ensureRow(channel) {
    if (!statusBody) return null;
    if (rows.has(channel)) return rows.get(channel);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td style="padding:8px 12px;">${channel}</td><td class="st" style="padding:8px 12px;"></td><td class="td" style="padding:8px 12px;"></td><td class="er" style="padding:8px 12px;color:#c00"></td>`;
    statusBody.appendChild(tr);
    const r = { statusEl: tr.querySelector(".st"), todayEl: tr.querySelector(".td"), errEl: tr.querySelector(".er") };
    rows.set(channel, r);
    return r;
  }

  async function loadSettings() {
    const s = await api.loadSettings();
    $("sw-spreadsheet-id").value = s.spreadsheetId || "";
    $("sw-cred-path").value = s.credentialsPath || "";
    $("sw-root").value = s.channelsRoot || "";
    $("sw-poll").value = s.pollSec || 300;
    $("sw-auto-open").checked = !!s.autoRunOnOpen;
    $("sw-video-speed").value = (typeof s.videoSpeed === "number" && s.videoSpeed > 0) ? s.videoSpeed : 0.95;
    $("sw-use-gpu").checked = !!s.useGPU;
    $("sw-gpm-enabled").checked = !!s.gpmEnabled;
    $("sw-gpm-host").value = s.gpmHost || "127.0.0.1:19995";
    $("sw-gpm-tg-enabled").checked = !!s.gpmTelegramEnabled;
    $("sw-gpm-tg-token").value = s.gpmTelegramToken || "";
    $("sw-gpm-tg-chat").value = s.gpmTelegramChatId || "";
    $("sw-gpm-tg-fields").style.display = s.gpmTelegramEnabled ? "" : "none";
    $("sw-gpm-panel").style.display = s.gpmEnabled ? "" : "none";
  }
  function currentSettings() {
    return {
      spreadsheetId: $("sw-spreadsheet-id").value.trim(),
      credentialsPath: $("sw-cred-path").value.trim(),
      channelsRoot: $("sw-root").value.trim(),
      pollSec: parseInt($("sw-poll").value, 10) || 300,
      autoRunOnOpen: $("sw-auto-open").checked,
      videoSpeed: parseFloat($("sw-video-speed").value) > 0 ? parseFloat($("sw-video-speed").value) : 0.95,
      useGPU: $("sw-use-gpu").checked,
      gpmEnabled: $("sw-gpm-enabled").checked,
      gpmHost: $("sw-gpm-host").value.trim() || "127.0.0.1:19995",
      gpmTelegramEnabled: $("sw-gpm-tg-enabled").checked,
      gpmTelegramToken: $("sw-gpm-tg-token").value.trim(),
      gpmTelegramChatId: $("sw-gpm-tg-chat").value.trim(),
    };
  }

  // Tự động lưu cấu hình mỗi khi thay đổi (bỏ nút "Lưu cấu hình").
  let saveTimer = null;
  async function saveNow() { await api.saveSettings(currentSettings()); }
  function saveDebounced() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
  ["sw-spreadsheet-id", "sw-poll", "sw-video-speed"].forEach((id) =>
    $(id)?.addEventListener("input", saveDebounced));
  ["sw-auto-open", "sw-use-gpu", "sw-gpm-enabled"].forEach((id) =>
    $(id)?.addEventListener("change", saveNow));
  ["sw-gpm-host", "sw-gpm-tg-token", "sw-gpm-tg-chat"].forEach((id) =>
    $(id)?.addEventListener("input", saveDebounced));
  $("sw-gpm-enabled")?.addEventListener("change", () => {
    $("sw-gpm-panel").style.display = $("sw-gpm-enabled").checked ? "" : "none";
  });
  $("sw-gpm-tg-enabled")?.addEventListener("change", () => {
    $("sw-gpm-tg-fields").style.display = $("sw-gpm-tg-enabled").checked ? "" : "none";
    saveNow();
  });

  $("sw-pick-cred")?.addEventListener("click", async () => {
    const p = await api.selectCredentials(); if (p) { $("sw-cred-path").value = p; await saveNow(); }
  });
  $("sw-pick-root")?.addEventListener("click", async () => {
    const p = await api.selectRoot(); if (p) { $("sw-root").value = p; await saveNow(); }
  });
  $("sw-test")?.addEventListener("click", async () => {
    const btn = $("sw-test");
    const statusEl = $("sw-test-status");
    if (btn) btn.disabled = true;
    if (statusEl) { statusEl.textContent = "⏳ đang kiểm tra…"; statusEl.style.color = "#666"; }
    log("🔌 Đang kiểm tra kết nối tới Sheet…");
    try {
      await saveNow();
      const r = await api.testConnection(currentSettings());
      if (r?.success) {
        log(`✅ Kết nối OK — ${r.channelCount} kênh (${r.enabledCount} đang bật).`);
        log(`   Tab: ${r.tabs.join(", ")}`);
        if (!r.hasConfigTab) log("⚠️ Không thấy tab ⚙config — kiểm tra lại tên tab cấu hình.");
        if (statusEl) { statusEl.textContent = `✅ OK — ${r.channelCount} kênh`; statusEl.style.color = "#1a7f37"; }
      } else {
        log(`❌ Kết nối thất bại: ${r?.error || "lỗi không rõ"}`);
        if (statusEl) { statusEl.textContent = "❌ Thất bại"; statusEl.style.color = "#c00"; }
      }
    } catch (e) {
      log(`❌ Kết nối thất bại: ${e?.message || e}`);
      if (statusEl) { statusEl.textContent = "❌ Thất bại"; statusEl.style.color = "#c00"; }
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  $("sw-start")?.addEventListener("click", async () => { await api.saveSettings(currentSettings()); await api.start(); log("▶ Bắt đầu theo dõi."); });
  $("sw-stop")?.addEventListener("click", async () => { await api.stop(); log("⏹ Đã dừng."); });
  $("sw-run-now")?.addEventListener("click", async () => { await api.saveSettings(currentSettings()); log("Chạy tất cả ngay…"); await api.runNow(); });

  api.onEvent((evt) => {
    if (evt.type === "channel-status") {
      const r = ensureRow(evt.channel); r.statusEl.textContent = evt.status;
      log(`[${evt.channel}] ${evt.status}${evt.url ? " — " + evt.url : ""}`);
    } else if (evt.type === "video-rendered") {
      const r = ensureRow(evt.channel); r.statusEl.textContent = "xong";
      const n = (rendered.get(evt.channel) || 0) + 1;
      rendered.set(evt.channel, n);
      r.todayEl.textContent = String(n);
      log(`[${evt.channel}] ✅ ${evt.title}`);
    } else if (evt.type === "error") {
      const r = evt.channel ? ensureRow(evt.channel) : null;
      if (r) r.errEl.textContent = evt.message;
      log(`❌ ${evt.channel ? "[" + evt.channel + "] " : ""}${evt.message}`);
    } else if (evt.type === "done") {
      log("— Hoàn tất lượt chạy —");
    }
  });

  // ===== GPM =====
  $("sw-gpm-test")?.addEventListener("click", async () => {
    const statusEl = $("sw-gpm-test-status");
    statusEl.textContent = "⏳ đang kiểm tra…"; statusEl.style.color = "#666";
    const r = await api.gpmTest($("sw-gpm-host").value.trim());
    if (r?.ok) { statusEl.textContent = `✅ ${r.profiles.length} profiles`; statusEl.style.color = "#1a7f37"; }
    else { statusEl.textContent = `❌ ${r?.error || "lỗi"}`; statusEl.style.color = "#c00"; }
  });

  $("sw-gpm-tg-test")?.addEventListener("click", async () => {
    const statusEl = $("sw-gpm-tg-status");
    const token = $("sw-gpm-tg-token").value.trim();
    const chatId = $("sw-gpm-tg-chat").value.trim();
    if (!token || !chatId) { statusEl.textContent = "❌ thiếu token/chat ID"; statusEl.style.color = "#c00"; return; }
    statusEl.textContent = "⏳ đang gửi…"; statusEl.style.color = "#666";
    await saveNow();
    const r = await api.gpmTestTelegram(token, chatId);
    if (r?.ok) { statusEl.textContent = "✅ đã gửi — kiểm tra Telegram"; statusEl.style.color = "#1a7f37"; }
    else { statusEl.textContent = `❌ ${r?.error || "lỗi"}`; statusEl.style.color = "#c00"; }
  });

  function gpmRenderRow(ch) {
    const tb = $("sw-gpm-table").querySelector("tbody");
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #eee";
    tr.innerHTML = `
      <td style="padding:8px 12px;">${ch.sheetName}</td>
      <td style="padding:8px 12px;">${ch.gpmProfileId || '<span style="color:#c00;">(chưa có)</span>'}</td>
      <td style="padding:8px 12px;"><button class="btn btn-secondary gpm-connect-btn"${ch.gpmProfileId ? "" : " disabled"}>Connect</button></td>
      <td class="gpm-st" style="padding:8px 12px;"></td>`;
    const btn = tr.querySelector(".gpm-connect-btn");
    const st = tr.querySelector(".gpm-st");
    btn?.addEventListener("click", () => gpmConnectOne(ch, st, btn));
    tb.appendChild(tr);
    return { st, btn, ch };
  }

  async function gpmConnectOne(ch, st, btn) {
    if (!ch.gpmProfileId) return;
    if (btn) btn.disabled = true;
    st.textContent = "⏳ đang kết nối…"; st.style.color = "#666";
    const r = await api.gpmConnect({ gpmHost: $("sw-gpm-host").value.trim(), profileId: ch.gpmProfileId, sheetName: ch.sheetName });
    if (r?.ok) { st.textContent = "✅ đã mở Studio"; st.style.color = "#1a7f37"; }
    else { st.textContent = `❌ ${r?.error || "lỗi"}`; st.style.color = "#c00"; }
    if (btn) btn.disabled = false;
  }

  let gpmRows = [];
  $("sw-gpm-list")?.addEventListener("click", async () => {
    const tb = $("sw-gpm-table").querySelector("tbody");
    tb.innerHTML = "";
    gpmRows = [];
    const r = await api.gpmListChannels();
    if (!r?.ok) { alert(r?.error || "Không tải được danh sách kênh."); return; }
    gpmRows = r.channels.map((ch) => gpmRenderRow(ch));
  });

  $("sw-gpm-connect-all")?.addEventListener("click", async () => {
    for (const row of gpmRows) {
      if (row.ch.gpmProfileId) await gpmConnectOne(row.ch, row.st, row.btn);
    }
  });

  loadSettings();
})();
