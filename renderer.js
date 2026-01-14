// Helper to check if electronAPI is available
function checkElectronAPI() {
  if (!window.electronAPI) {
    alert("Lỗi: Electron API chưa sẵn sàng. Vui lòng khởi động lại ứng dụng.");
    return false;
  }
  return true;
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
      useThumbs: document.getElementById("concat-use-thumbs")?.checked ?? true,
      thumbDuration:
        document.getElementById("concat-thumb-duration")?.value || "3",
      inputFolder: selectedConcatInputFolder,
      thumbsFolder: selectedConcatThumbsFolder,
      outputFolder: selectedConcatOutputFolder,
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
        document.getElementById(
          "concat-input-path"
        ).textContent = `Đã chọn: ${settings.concat.inputFolder}`;
        document.getElementById("concat-input-path").style.display = "block";
      }
      if (settings.concat.thumbsFolder) {
        selectedConcatThumbsFolder = settings.concat.thumbsFolder;
        document.getElementById("concat-thumbs-folder").value =
          settings.concat.thumbsFolder;
        document.getElementById(
          "concat-thumbs-path"
        ).textContent = `Đã chọn: ${settings.concat.thumbsFolder}`;
        document.getElementById("concat-thumbs-path").style.display = "block";
      }
      if (settings.concat.outputFolder) {
        selectedConcatOutputFolder = settings.concat.outputFolder;
        document.getElementById("concat-output-folder").value =
          settings.concat.outputFolder;
        document.getElementById(
          "concat-output-path"
        ).textContent = `Đã chọn: ${settings.concat.outputFolder}`;
        document.getElementById("concat-output-path").style.display = "block";
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
    "concat-chunk-size",
    "concat-thumb-duration",
    "trim-start-time",
    "trim-duration",
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
    "concat-use-thumbs",
  ];

  checkboxesToWatch.forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener("change", () => {
        saveSettings();
        if (id === "render-keepcolor-crop") toggleKeepColorCrop();
        if (id === "concat-use-thumbs") toggleConcatThumbs();
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
    `🚀 Đang cắt video từ giây ${startTime}, độ dài ${duration}s...\n\n`
  );

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("trim", data);
    });

    const options = {
      trimConfig: {
        inputFolder: selectedTrimInputFolder || "./overlays",
        outputFolder: selectedTrimOutputFolder || "./overlays_trimmed",
        startTime: startTime,
        duration: duration,
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
    `,
  },
  retry: {
    title: "Hướng dẫn Tải lại video lỗi",
    content: `
      <h4>📋 Chức năng:</h4>
      <p>Tự động tải lại các video đã bị lỗi trong lần tải trước. Hệ thống sẽ đọc danh sách URL lỗi từ log file và thử tải lại.</p>
      
      <h4>🔄 Cách hoạt động:</h4>
      <ol>
        <li>Hệ thống đọc file log <code>failed_urls.txt</code> (tự động tạo khi có video lỗi)</li>
        <li>Lấy từng URL từ log file</li>
        <li>Thử tải lại video từ URL đó</li>
        <li>Nếu thành công: Xóa URL khỏi log</li>
        <li>Nếu vẫn lỗi: Giữ nguyên trong log để thử lại sau</li>
      </ol>
      
      <h4>💡 Lưu ý:</h4>
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
    document.getElementById(
      "concat-input-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("concat-input-path").style.display = "block";
    saveSettings();
  }
}

async function selectConcatThumbsFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedConcatThumbsFolder = folder;
    document.getElementById("concat-thumbs-folder").value = folder;
    document.getElementById(
      "concat-thumbs-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("concat-thumbs-path").style.display = "block";
    saveSettings();
  }
}

async function selectConcatOutputFolder() {
  if (!checkElectronAPI()) return;
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    selectedConcatOutputFolder = folder;
    document.getElementById("concat-output-folder").value = folder;
    document.getElementById(
      "concat-output-path"
    ).textContent = `Đã chọn: ${folder}`;
    document.getElementById("concat-output-path").style.display = "block";
    saveSettings();
  }
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
    `🚀 Đang ghép video với input="${selectedConcatInputFolder}", chunkSize=${chunkSize}, useThumbs=${useThumbs}...\n\n`
  );

  try {
    window.electronAPI.removeScriptOutputListener();
    window.electronAPI.onScriptOutput((data) => {
      showOutput("concat", data);
    });

    const options = {
      concatConfig: {
        chunkSize,
        useThumbs,
        thumbDuration: useThumbs ? thumbDuration : null,
        inputFolder: selectedConcatInputFolder,
        thumbsFolder: useThumbs ? selectedConcatThumbsFolder : null,
        outputFolder: selectedConcatOutputFolder,
      },
    };

    await window.electronAPI.runScript("concat-video.js", [], options);
    showOutput("concat", "\n\n✅ Hoàn thành!");
  } catch (error) {
    showOutput("concat", `\n\n❌ Lỗi: ${getErrorMessage(error)}\n`);
  }
}
