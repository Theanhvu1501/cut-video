// Helper to check if electronAPI is available
function checkElectronAPI() {
  if (!window.electronAPI) {
    alert("Lỗi: Electron API chưa sẵn sàng. Vui lòng khởi động lại ứng dụng.");
    return false;
  }
  return true;
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

// Settings management
async function saveSettings() {
  const settings = {
    // Render settings
    render: {
      day: document.getElementById("render-day")?.value || "1",
      videos: document.getElementById("render-videos")?.value || "1",
      renderMode:
        document.querySelector('input[name="render-mode"]:checked')?.value ||
        "topTransparent",
      opacity: document.getElementById("render-opacity")?.value || "0.7",
      chromaKeyMode:
        document.querySelector('input[name="chromakey-mode"]:checked')?.value ||
        "color",
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
    },
    // Download settings
    download: {
      urlsFile: selectedUrlsFile,
      outputFolder: selectedDownloadOutputFolder,
      overlayImagesFolder: selectedDownloadOverlayImagesFolder,
      thumbsFolder: selectedDownloadThumbsFolder,
      cookiesFile: selectedDownloadCookiesFile,
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
  };

  // Lưu vào localStorage
  localStorage.setItem("cutVideoAppSettings", JSON.stringify(settings));

  // Lưu render config vào file để giữ lại khi tắt/bật lại ứng dụng
  if (checkElectronAPI() && window.electronAPI && settings.render) {
    try {
      // Lấy tất cả các giá trị từ form để đảm bảo có giá trị mới nhất
      const currentRenderMode =
        document.querySelector('input[name="render-mode"]:checked')?.value ||
        settings.render.renderMode ||
        "topTransparent";
      const currentOpacity = parseFloat(
        document.getElementById("render-opacity")?.value ||
          settings.render.opacity ||
          "0.7"
      );
      const currentChromaKeyMode =
        document.querySelector('input[name="chromakey-mode"]:checked')?.value ||
        settings.render.chromaKeyMode ||
        "color";
      const currentChromaKeyColor =
        document.getElementById("render-chromakey-color")?.value ||
        settings.render.chromaKeyColor ||
        "D4F9D7";
      const currentChromaKeyFile =
        selectedRenderChromaKeyFile || settings.render.chromaKeyFile || null;
      const currentKeepColorColors =
        document.getElementById("render-keepcolor-colors")?.value ||
        settings.render.keepColorColors ||
        "FBFF02";
      const currentKeepColorCrop =
        document.getElementById("render-keepcolor-crop")?.checked ??
        (settings.render.keepColorCrop || false);
      const currentKeepColorHeight = parseInt(
        document.getElementById("render-keepcolor-height")?.value ||
          settings.render.keepColorHeight ||
          "220"
      );
      const currentKeepColorYOffset = parseInt(
        document.getElementById("render-keepcolor-y-offset")?.value ||
          settings.render.keepColorYOffset ||
          "490"
      );
      const currentUseGPU =
        document.getElementById("render-use-gpu")?.checked ??
        (settings.render.useGPU || false);
      const currentMaxConcurrent = parseInt(
        document.getElementById("render-max-concurrent")?.value ||
          settings.render.maxConcurrentProcesses ||
          "2"
      );
      const currentGpuCodec =
        document.getElementById("render-gpu-codec")?.value ||
        settings.render.gpuVideoCodec ||
        "h264_nvenc";
      const currentHeight = parseInt(
        document.getElementById("render-height")?.value ||
          settings.render.height ||
          "220"
      );
      const currentYOffset = parseInt(
        document.getElementById("render-y-offset")?.value ||
          settings.render.y_offset ||
          "490"
      );

      const renderConfig = {
        renderMode: currentRenderMode,
        opacity: currentOpacity,
        chromaKeyMode: currentChromaKeyMode,
        chromaKeyColor: currentChromaKeyColor,
        chromaKeyFile: currentChromaKeyFile,
        keepColorColors: currentKeepColorColors
          ? [currentKeepColorColors]
          : null,
        keepColorCrop: currentKeepColorCrop,
        keepColorHeight: currentKeepColorHeight,
        keepColorYOffset: currentKeepColorYOffset,
        useGPU: currentUseGPU,
        maxConcurrentProcesses: currentMaxConcurrent,
        gpuVideoCodec: currentGpuCodec,
        height: currentHeight,
        y_offset: currentYOffset,
        overlayFolder:
          selectedRenderOverlayFolder || settings.render.overlayFolder || null,
        backgroundFolder:
          selectedRenderBackgroundFolder ||
          settings.render.backgroundFolder ||
          null,
        outputFolder:
          selectedRenderOutputFolder || settings.render.outputFolder || null,
      };
      await window.electronAPI.saveRenderConfig(renderConfig);
    } catch (error) {
      console.error("Error saving render config to file:", error);
    }
  }
}

async function loadSettings() {
  try {
    // Ưu tiên đọc từ file config trước (để giữ lại lựa chọn khi tắt/bật lại)
    let fileConfig = null;
    if (checkElectronAPI() && window.electronAPI) {
      try {
        const result = await window.electronAPI.loadRenderConfig();
        if (result.success && result.config) {
          fileConfig = result.config;
        }
      } catch (error) {
        console.error("Error loading render config from file:", error);
      }
    }

    // Đọc từ localStorage
    const saved = localStorage.getItem("cutVideoAppSettings");
    let settings = saved ? JSON.parse(saved) : {};

    // Nếu có config từ file, merge vào settings (file config có ưu tiên cao hơn)
    if (fileConfig && fileConfig.renderMode) {
      if (!settings.render) settings.render = {};

      // Cập nhật settings từ file config
      if (fileConfig.renderMode)
        settings.render.renderMode = fileConfig.renderMode;
      if (fileConfig.opacity !== undefined)
        settings.render.opacity = fileConfig.opacity.toString();
      if (fileConfig.chromaKeyMode)
        settings.render.chromaKeyMode = fileConfig.chromaKeyMode;
      if (fileConfig.chromaKeyColor)
        settings.render.chromaKeyColor = fileConfig.chromaKeyColor;
      if (fileConfig.chromaKeyFile)
        settings.render.chromaKeyFile = fileConfig.chromaKeyFile;
      if (fileConfig.keepColorColors && fileConfig.keepColorColors.length > 0) {
        settings.render.keepColorColors = fileConfig.keepColorColors[0];
      }
      if (fileConfig.keepColorCrop !== undefined)
        settings.render.keepColorCrop = fileConfig.keepColorCrop;
      if (fileConfig.keepColorHeight !== undefined)
        settings.render.keepColorHeight = fileConfig.keepColorHeight.toString();
      if (fileConfig.keepColorYOffset !== undefined)
        settings.render.keepColorYOffset =
          fileConfig.keepColorYOffset.toString();
      if (fileConfig.useGPU !== undefined)
        settings.render.useGPU = fileConfig.useGPU;
      if (fileConfig.maxConcurrentProcesses !== undefined)
        settings.render.maxConcurrentProcesses =
          fileConfig.maxConcurrentProcesses.toString();
      if (fileConfig.gpuVideoCodec)
        settings.render.gpuVideoCodec = fileConfig.gpuVideoCodec;
      if (fileConfig.height !== undefined)
        settings.render.height = fileConfig.height.toString();
      if (fileConfig.y_offset !== undefined)
        settings.render.y_offset = fileConfig.y_offset.toString();
      if (fileConfig.overlayFolder)
        settings.render.overlayFolder = fileConfig.overlayFolder;
      if (fileConfig.backgroundFolder)
        settings.render.backgroundFolder = fileConfig.backgroundFolder;
      if (fileConfig.outputFolder)
        settings.render.outputFolder = fileConfig.outputFolder;

      // Lưu lại vào localStorage để đồng bộ
      localStorage.setItem("cutVideoAppSettings", JSON.stringify(settings));
    }

    // Load Render settings
    if (settings.render) {
      if (settings.render.day)
        document.getElementById("render-day").value = settings.render.day;
      if (settings.render.videos)
        document.getElementById("render-videos").value = settings.render.videos;
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
            `input[name="render-mode"][value="${settings.render.renderMode}"]`
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
            : "chromakey-file"
        ).checked = true;
        toggleChromaKeyMode();
      }
      if (settings.render.chromaKeyColor)
        document.getElementById("render-chromakey-color").value =
          settings.render.chromaKeyColor;
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
      if (settings.render.useGPU !== undefined) {
        document.getElementById("render-use-gpu").checked =
          settings.render.useGPU;
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
        document.getElementById(
          "render-overlay-path"
        ).textContent = `Đã chọn: ${settings.render.overlayFolder}`;
        document.getElementById("render-overlay-path").style.display = "block";
      }
      if (settings.render.backgroundFolder) {
        selectedRenderBackgroundFolder = settings.render.backgroundFolder;
        document.getElementById("render-background-folder").value =
          settings.render.backgroundFolder;
        document.getElementById(
          "render-background-path"
        ).textContent = `Đã chọn: ${settings.render.backgroundFolder}`;
        document.getElementById("render-background-path").style.display =
          "block";
      }
      if (settings.render.outputFolder) {
        selectedRenderOutputFolder = settings.render.outputFolder;
        document.getElementById("render-output-folder").value =
          settings.render.outputFolder;
        document.getElementById(
          "render-output-path"
        ).textContent = `Đã chọn: ${settings.render.outputFolder}`;
        document.getElementById("render-output-path").style.display = "block";
      }
      if (settings.render.chromaKeyFile) {
        selectedRenderChromaKeyFile = settings.render.chromaKeyFile;
        document.getElementById("render-chromakey-file").value =
          settings.render.chromaKeyFile;
        document.getElementById(
          "render-chromakey-file-path"
        ).textContent = `Đã chọn: ${settings.render.chromaKeyFile}`;
        document.getElementById("render-chromakey-file-path").style.display =
          "block";
      }
    }

    // Load Download settings
    if (settings.download) {
      if (settings.download.urlsFile) {
        selectedUrlsFile = settings.download.urlsFile;
        document.getElementById("download-urls-file").value =
          settings.download.urlsFile;
        document.getElementById(
          "download-urls-path"
        ).textContent = `Đã chọn: ${settings.download.urlsFile}`;
        document.getElementById("download-urls-path").style.display = "block";
      }
      if (settings.download.outputFolder) {
        selectedDownloadOutputFolder = settings.download.outputFolder;
        document.getElementById("download-output-folder").value =
          settings.download.outputFolder;
        document.getElementById(
          "download-output-path"
        ).textContent = `Đã chọn: ${settings.download.outputFolder}`;
        document.getElementById("download-output-path").style.display = "block";
      }
      if (settings.download.overlayImagesFolder) {
        selectedDownloadOverlayImagesFolder =
          settings.download.overlayImagesFolder;
        document.getElementById("download-overlay-images-folder").value =
          settings.download.overlayImagesFolder;
        document.getElementById(
          "download-overlay-images-path"
        ).textContent = `Đã chọn: ${settings.download.overlayImagesFolder}`;
        document.getElementById("download-overlay-images-path").style.display =
          "block";
      }
      if (settings.download.thumbsFolder) {
        selectedDownloadThumbsFolder = settings.download.thumbsFolder;
        document.getElementById("download-thumbs-folder").value =
          settings.download.thumbsFolder;
        document.getElementById(
          "download-thumbs-path"
        ).textContent = `Đã chọn: ${settings.download.thumbsFolder}`;
        document.getElementById("download-thumbs-path").style.display = "block";
      }
      if (settings.download.cookiesFile) {
        selectedDownloadCookiesFile = settings.download.cookiesFile;
        document.getElementById("download-cookies-file").value =
          settings.download.cookiesFile;
        document.getElementById(
          "download-cookies-path"
        ).textContent = `Đã chọn: ${settings.download.cookiesFile}`;
        document.getElementById("download-cookies-path").style.display =
          "block";
      }
    }

    // Load Video Snow settings
    if (settings.videoSnow) {
      if (settings.videoSnow.inputFolder) {
        selectedVideoSnowInputFolder = settings.videoSnow.inputFolder;
        document.getElementById("video-snow-input-folder").value =
          settings.videoSnow.inputFolder;
        document.getElementById(
          "video-snow-input-path"
        ).textContent = `Đã chọn: ${settings.videoSnow.inputFolder}`;
        document.getElementById("video-snow-input-path").style.display =
          "block";
      }
      if (settings.videoSnow.outputFolder) {
        selectedVideoSnowOutputFolder = settings.videoSnow.outputFolder;
        document.getElementById("video-snow-output-folder").value =
          settings.videoSnow.outputFolder;
        document.getElementById(
          "video-snow-output-path"
        ).textContent = `Đã chọn: ${settings.videoSnow.outputFolder}`;
        document.getElementById("video-snow-output-path").style.display =
          "block";
      }
      if (settings.videoSnow.snowFile) {
        selectedVideoSnowSnowFile = settings.videoSnow.snowFile;
        document.getElementById("video-snow-snow-file").value =
          settings.videoSnow.snowFile;
        document.getElementById(
          "video-snow-snow-path"
        ).textContent = `Đã chọn: ${settings.videoSnow.snowFile}`;
        document.getElementById("video-snow-snow-path").style.display = "block";
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
        document.getElementById(
          "bg-input-path"
        ).textContent = `Đã chọn: ${settings.bgVideo.inputFolder}`;
        document.getElementById("bg-input-path").style.display = "block";
      }
      if (settings.bgVideo.outputFolder) {
        selectedBgOutputFolder = settings.bgVideo.outputFolder;
        document.getElementById("bg-output-folder").value =
          settings.bgVideo.outputFolder;
        document.getElementById(
          "bg-output-path"
        ).textContent = `Đã chọn: ${settings.bgVideo.outputFolder}`;
        document.getElementById("bg-output-path").style.display = "block";
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
        document.getElementById(
          "trim-input-path"
        ).textContent = `Đã chọn: ${settings.trim.inputFolder}`;
        document.getElementById("trim-input-path").style.display = "block";
      }
      if (settings.trim.outputFolder) {
        selectedTrimOutputFolder = settings.trim.outputFolder;
        document.getElementById("trim-output-folder").value =
          settings.trim.outputFolder;
        document.getElementById(
          "trim-output-path"
        ).textContent = `Đã chọn: ${settings.trim.outputFolder}`;
        document.getElementById("trim-output-path").style.display = "block";
      }
    }

    // Load Cut BG settings
    if (settings.cutBg) {
      if (settings.cutBg.inputFolder) {
        selectedCutBgInputFolder = settings.cutBg.inputFolder;
        document.getElementById("cut-bg-input-folder").value =
          settings.cutBg.inputFolder;
        document.getElementById(
          "cut-bg-input-path"
        ).textContent = `Đã chọn: ${settings.cutBg.inputFolder}`;
        document.getElementById("cut-bg-input-path").style.display = "block";
      }
      if (settings.cutBg.outputFolder) {
        selectedCutBgOutputFolder = settings.cutBg.outputFolder;
        document.getElementById("cut-bg-output-folder").value =
          settings.cutBg.outputFolder;
        document.getElementById(
          "cut-bg-output-path"
        ).textContent = `Đã chọn: ${settings.cutBg.outputFolder}`;
        document.getElementById("cut-bg-output-path").style.display = "block";
      }
    }

    // Load Thumb settings
    if (settings.thumb) {
      if (settings.thumb.inputFolder) {
        selectedThumbInputFolder = settings.thumb.inputFolder;
        document.getElementById("thumb-input-folder").value =
          settings.thumb.inputFolder;
        document.getElementById(
          "thumb-input-path"
        ).textContent = `Đã chọn: ${settings.thumb.inputFolder}`;
        document.getElementById("thumb-input-path").style.display = "block";
      }
      if (settings.thumb.overlayFolder) {
        selectedThumbOverlayFolder = settings.thumb.overlayFolder;
        document.getElementById("thumb-overlay-folder").value =
          settings.thumb.overlayFolder;
        document.getElementById(
          "thumb-overlay-path"
        ).textContent = `Đã chọn: ${settings.thumb.overlayFolder}`;
        document.getElementById("thumb-overlay-path").style.display = "block";
      }
      if (settings.thumb.outputFolder) {
        selectedThumbOutputFolder = settings.thumb.outputFolder;
        document.getElementById("thumb-output-folder").value =
          settings.thumb.outputFolder;
        document.getElementById(
          "thumb-output-path"
        ).textContent = `Đã chọn: ${settings.thumb.outputFolder}`;
        document.getElementById("thumb-output-path").style.display = "block";
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
        document.getElementById(
          "get-url-output-path"
        ).textContent = `Đã chọn: ${settings.getUrl.outputFolder}`;
        document.getElementById("get-url-output-path").style.display = "block";
      }
    }

    // Load Normalize settings
    if (settings.normalize) {
      if (settings.normalize.inputFolder) {
        selectedNormalizeInputFolder = settings.normalize.inputFolder;
        document.getElementById("normalize-input-folder").value =
          settings.normalize.inputFolder;
        document.getElementById(
          "normalize-input-path"
        ).textContent = `Đã chọn: ${settings.normalize.inputFolder}`;
        document.getElementById("normalize-input-path").style.display = "block";
      }
    }
  } catch (error) {
    console.error("Error loading settings:", error);
  }
}

// Tab switching
document.addEventListener("DOMContentLoaded", async () => {
  // Load saved settings first
  await loadSettings();

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      const tabId = button.getAttribute("data-tab");

      // Remove active class from all tabs and buttons
      document
        .querySelectorAll(".tab-button")
        .forEach((btn) => btn.classList.remove("active"));
      document
        .querySelectorAll(".tab-content")
        .forEach((content) => content.classList.remove("active"));

      // Add active class to clicked tab
      button.classList.add("active");
      document.getElementById(tabId).classList.add("active");
    });
  });

  // Add event listeners to save settings on change
  const inputsToWatch = [
    "render-day",
    "render-videos",
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
  ];

  inputsToWatch.forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener("change", saveSettings);
      element.addEventListener("input", saveSettings);
    }
  });

  // Watch checkboxes
  const checkboxesToWatch = ["render-use-gpu", "render-keepcolor-crop"];

  checkboxesToWatch.forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener("change", () => {
        saveSettings();
        if (id === "render-keepcolor-crop") toggleKeepColorCrop();
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
      document.getElementById(
        "render-chromakey-file-path"
      ).textContent = `Đã chọn: ${filePath}`;
      document.getElementById("render-chromakey-file-path").style.display =
        "block";
      saveSettings();
    }
  } catch (error) {
    console.error("Error selecting file:", error);
    alert("Lỗi khi chọn file: " + error.message);
  }
}

async function selectRenderOverlayFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedRenderOverlayFolder = folder;
    document.getElementById("render-overlay-folder").value = folder;
    document.getElementById(
      "render-overlay-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("render-overlay-path").style.display = "block";
    saveSettings();
  }
}

async function selectRenderBackgroundFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedRenderBackgroundFolder = folder;
    document.getElementById("render-background-folder").value = folder;
    document.getElementById(
      "render-background-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("render-background-path").style.display = "block";
    saveSettings();
  }
}

async function selectRenderOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedRenderOutputFolder = folder;
    document.getElementById("render-output-folder").value = folder;
    document.getElementById(
      "render-output-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("render-output-path").style.display = "block";
    saveSettings();
  }
}

async function runRender() {
  const day = document.getElementById("render-day").value;
  const videos = document.getElementById("render-videos").value;
  const renderMode =
    document.querySelector('input[name="render-mode"]:checked')?.value ||
    "topTransparent";
  const useGPU = document.getElementById("render-use-gpu").checked;
  const maxConcurrentProcesses =
    parseInt(document.getElementById("render-max-concurrent").value) || 2;
  const gpuVideoCodec =
    document.getElementById("render-gpu-codec").value || "h264_nvenc";

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

  // Keep Color config
  let keepColorColors = null;
  let keepColorCrop = false;
  let keepColorHeight = 220;
  let keepColorYOffset = 490;
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
    `🚀 Đang chạy Render Video với ngày=${day}, videos=${videos}...\n\n`
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
        chromaKeyFile,
        keepColorColors,
        keepColorCrop,
        keepColorHeight,
        keepColorYOffset,
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
      },
    };

    await window.electronAPI.runScript("render.js", [day, videos], options);
    showOutput("render", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("render", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Download - Selected paths
let selectedUrlsFile = null;
let selectedDownloadOutputFolder = null;
let selectedDownloadOverlayImagesFolder = null;
let selectedDownloadThumbsFolder = null;
let selectedDownloadCookiesFile = null;

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
      document.getElementById(
        "download-urls-path"
      ).textContent = `Đã chọn: ${filePath}`;
      document.getElementById("download-urls-path").style.display = "block";
      saveSettings();
    }
  } catch (error) {
    console.error("Error selecting file:", error);
    alert("Lỗi khi chọn file: " + error.message);
  }
}

async function selectDownloadOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedDownloadOutputFolder = folder;
    document.getElementById("download-output-folder").value = folder;
    document.getElementById(
      "download-output-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("download-output-path").style.display = "block";
    saveSettings();
  }
}

async function selectDownloadOverlayImagesFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedDownloadOverlayImagesFolder = folder;
    document.getElementById("download-overlay-images-folder").value = folder;
    document.getElementById(
      "download-overlay-images-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("download-overlay-images-path").style.display =
      "block";
    saveSettings();
  }
}

async function selectDownloadThumbsFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedDownloadThumbsFolder = folder;
    document.getElementById("download-thumbs-folder").value = folder;
    document.getElementById(
      "download-thumbs-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("download-thumbs-path").style.display = "block";
    saveSettings();
  }
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
      document.getElementById(
        "download-cookies-path"
      ).textContent = `Đã chọn: ${filePath}`;
      document.getElementById("download-cookies-path").style.display = "block";
      saveSettings();
    }
  } catch (error) {
    console.error("Error selecting cookies file:", error);
    alert("Lỗi khi chọn file: " + error.message);
  }
}

async function runDownload() {
  if (!checkElectronAPI()) return;

  clearOutput("download");
  showOutput("download", "🚀 Đang tải video...\n\n");

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("download", data);
    });

    const options = {
      downloadConfig: {
        urlsFile: selectedUrlsFile || "./urls.txt",
        downloadDir: selectedDownloadOutputFolder || "./overlays",
        overlayImagesDir: selectedDownloadOverlayImagesFolder || "./images",
        outputThumbsBaseDir: selectedDownloadThumbsFolder || "./thumbs",
        cookiesFile: selectedDownloadCookiesFile || "./cookies.txt",
      },
    };

    await window.electronAPI.runScript("download.js", [], options);
    showOutput("download", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("download", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}

// Retry
async function runRetry() {
  if (!checkElectronAPI()) return;

  clearOutput("retry");
  showOutput("retry", "🚀 Đang tải lại video lỗi...\n\n");

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("retry", data);
    });

    await window.electronAPI.runScript("download.js", ["retry"]);
    showOutput("retry", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("retry", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
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
    document.getElementById(
      "video-snow-input-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("video-snow-input-path").style.display = "block";
    saveSettings();
  }
}

async function selectVideoSnowOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedVideoSnowOutputFolder = folder;
    document.getElementById("video-snow-output-folder").value = folder;
    document.getElementById(
      "video-snow-output-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("video-snow-output-path").style.display = "block";
    saveSettings();
  }
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
      document.getElementById(
        "video-snow-snow-path"
      ).textContent = `Đã chọn: ${filePath}`;
      document.getElementById("video-snow-snow-path").style.display = "block";
      saveSettings();
    }
  } catch (error) {
    console.error("Error selecting file:", error);
    alert("Lỗi khi chọn file: " + error.message);
  }
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

    const options = {
      videoSnowConfig: {
        imageBackgroundFolder:
          selectedVideoSnowInputFolder || "./image_backgrounds",
        outputRootFolder: selectedVideoSnowOutputFolder || "./output_segments",
        snowOverlay: selectedVideoSnowSnowFile || "./snow1.mp4",
        maxConcurrent,
        segmentMin,
        segmentMax,
      },
    };

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
    document.getElementById("bg-input-path").textContent = `Đã chọn: ${folder}`;
    document.getElementById("bg-input-path").style.display = "block";
    saveSettings();
  }
}

async function selectBgOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedBgOutputFolder = folder;
    document.getElementById("bg-output-folder").value = folder;
    document.getElementById(
      "bg-output-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("bg-output-path").style.display = "block";
    saveSettings();
  }
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
    `🚀 Đang tạo video backgrounds với count=${count}...\n\n`
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

    const options = {
      bgVideoConfig: {
        inputRoot: selectedBgInputFolder || "./output_segments",
        outputRoot: selectedBgOutputFolder || "./backgrounds",
        targetDuration,
        sourceCount,
        avgClipDuration,
      },
    };

    await window.electronAPI.runScript(
      "createVideoBackgrounds.js",
      [count],
      options
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
    document.getElementById(
      "trim-input-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("trim-input-path").style.display = "block";
    saveSettings();
  }
}

async function selectTrimOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedTrimOutputFolder = folder;
    document.getElementById("trim-output-folder").value = folder;
    document.getElementById(
      "trim-output-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("trim-output-path").style.display = "block";
    saveSettings();
  }
}

async function runTrim() {
  if (!checkElectronAPI()) return;

  clearOutput("trim");
  showOutput("trim", "🚀 Đang cắt video thành 30s...\n\n");

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("trim", data);
    });

    const options = {
      trimConfig: {
        inputFolder: selectedTrimInputFolder || "./overlays",
        outputFolder: selectedTrimOutputFolder || "./overlays_trimmed",
      },
    };

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
    document.getElementById(
      "cut-bg-input-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("cut-bg-input-path").style.display = "block";
    saveSettings();
  }
}

async function selectCutBgOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedCutBgOutputFolder = folder;
    document.getElementById("cut-bg-output-folder").value = folder;
    document.getElementById(
      "cut-bg-output-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("cut-bg-output-path").style.display = "block";
    saveSettings();
  }
}

async function runCutBg() {
  if (!checkElectronAPI()) return;

  clearOutput("cut-bg");
  showOutput("cut-bg", "🚀 Đang cắt video background...\n\n");

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("cut-bg", data);
    });

    const options = {
      cutBgConfig: {
        inputRoot: selectedCutBgInputFolder || "./bgs",
        outputRoot: selectedCutBgOutputFolder || "./backgrounds",
      },
    };

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
    document.getElementById(
      "thumb-input-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("thumb-input-path").style.display = "block";
    saveSettings();
  }
}

async function selectThumbOverlayFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedThumbOverlayFolder = folder;
    document.getElementById("thumb-overlay-folder").value = folder;
    document.getElementById(
      "thumb-overlay-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("thumb-overlay-path").style.display = "block";
    saveSettings();
  }
}

async function selectThumbOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedThumbOutputFolder = folder;
    document.getElementById("thumb-output-folder").value = folder;
    document.getElementById(
      "thumb-output-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("thumb-output-path").style.display = "block";
    saveSettings();
  }
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

    const options = {
      thumbConfig: {
        downloadDir: selectedThumbInputFolder || "./overlays",
        overlayImagesDir: selectedThumbOverlayFolder || "./images",
        outputThumbsBaseDir: selectedThumbOutputFolder || "./thumbs",
      },
    };

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
    document.getElementById(
      "get-url-output-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("get-url-output-path").style.display = "block";
    saveSettings();
  }
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

    const options = {
      fileMapping: {},
      getUrlConfig: {
        outputBaseFolder: selectedGetUrlOutputFolder || "./channels",
      },
    };

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
    document.getElementById(
      "normalize-input-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("normalize-input-path").style.display = "block";
    saveSettings();
  }
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

    const options = {
      normalizeConfig: {
        rootFolder: selectedNormalizeInputFolder || "./thumbs",
      },
    };

    await window.electronAPI.runScript("convertNormalize.js", [], options);
    showOutput("normalize", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("normalize", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}
