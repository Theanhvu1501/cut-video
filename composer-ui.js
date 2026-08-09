// composer-ui.js — Giai đoạn 2A: toàn bộ UI của tab "Composer" (quản lý preset).
//
// File RIÊNG theo đúng ràng buộc của giai đoạn này: renderer.html chỉ thêm 3 chỗ (1 nút tab,
// 1 div rỗng #composer, 1 thẻ <script> nạp file này) — mọi logic UI mới nằm ở đây, không đụng
// renderer.js. Không dùng framework hay dependency ngoài nào, chỉ DOM API sẵn có của Chromium.
//
// Nạp bằng <script> THƯỜNG (không phải type="module"): renderer.html được tải qua file://, mà
// script kiểu module tải qua file:// có thể bị Chromium chặn CORS tuỳ cấu hình sandbox/
// webSecurity của BrowserWindow — rủi ro làm CẢ TAB composer trắng trơn, không một dòng lỗi dễ
// thấy. <script> thường thì chắc chắn chạy được, renderer.js đã dùng suốt từ đầu.
(function () {
  "use strict";

  const TAB_ID = "composer";
  const api = () => (window.electronAPI && window.electronAPI.composer) || null;
  // Giai đoạn 2B: hàm thuần tính anchor cho canvas (sheet/composer-geometry.cjs, nạp bằng
  // <script> riêng TRƯỚC file này — xem renderer.html). Gọi qua hàm G() thay vì hằng số thẳng vì
  // lúc composer-ui.js được PARSE thì window.ComposerGeometry đã tồn tại (thứ tự <script> đảm
  // bảo), nhưng gọi qua hàm vẫn an toàn hơn nếu thứ tự nạp lỡ đổi sau này — lỗi rõ ràng "G() is
  // null" thay vì lỗi mơ hồ lúc script nạp.
  const G = () => window.ComposerGeometry || null;
  const BASE_W = 1280;
  const BASE_H = 720;

  // Mirror thủ công của các hằng số trong sheet/layer-compiler.js — KHÔNG import được vì lý do
  // <script> thường ở trên. Đổi các hằng số này ở sheet/layer-compiler.js thì phải sửa tay ở
  // đây theo, không có gì tự đồng bộ (cùng kiểu đánh đổi mà layer-compiler.js/render-core.js
  // đã chấp nhận với evenDown()).
  const SOURCE_TYPES = ["background", "overlay", "image", "video", "solid", "waveform"];
  const FIT_MODES = ["full", "scale", "box", "none"];
  const ANCHOR_KEYS = [
    "top-left", "top-center", "top-right",
    "middle-left", "center", "middle-right",
    "bottom-left", "bottom-center", "bottom-right",
  ];
  const TREATMENT_KINDS = ["cropStrip", "grayContrast", "blur", "chromakey", "lumakey", "opacity", "keepColors"];
  const BLEND_MODES = ["normal", "screen"];

  const TYPE_LABELS = {
    background: "Nền (background)", overlay: "Video gốc (overlay)",
    image: "Ảnh", video: "Video phụ", solid: "Khối màu", waveform: "Waveform",
  };
  const FIT_LABELS = {
    full: "Phủ kín khung (full)", scale: "Co theo tỉ lệ (scale)",
    box: "Kích thước cố định (box)", none: "Giữ nguyên nguồn (none)",
  };
  const TREATMENT_LABELS = {
    cropStrip: "Cắt dải (cropStrip)", grayContrast: "Sáng/tương phản (grayContrast)",
    blur: "Làm mờ (blur)", chromakey: "Khử màu nền (chromakey)",
    lumakey: "Khử theo độ sáng (lumakey)", opacity: "Độ trong suốt (opacity)",
    keepColors: "Chỉ giữ vài màu (keepColors)",
  };
  // Tham số mặc định khi thêm treatment mới — dùng cùng con số mặc định mà layer-compiler.js/
  // render-core.js đang dùng khi preset không khai báo (numStr fallback, DEFAULT_RENDER_CFG).
  const TREATMENT_DEFAULTS = {
    cropStrip: { height: 220, yOffset: 0 },
    grayContrast: { brightness: "0", contrast: "1", gamma: "1", saturation: "1" },
    blur: { sigma: "20" },
    chromakey: { color: "00FF00", similarity: "0.3", blend: "0.1" },
    lumakey: { threshold: "0.15", tolerance: "0.1", softness: "0.1" },
    opacity: { value: "1" },
    keepColors: { colors: [], similarity: "0.1" },
  };

  // ── state ──────────────────────────────────────────────────────────────────────────────
  let built = false;            // đã dựng DOM bên trong #composer chưa (dựng LƯỜI)
  let presetNames = [];
  let currentName = null;       // tên preset đang mở TRÊN ĐĨA — null = preset mới chưa lưu lần nào
  let preset = null;            // bản sao trong bộ nhớ đang sửa (chưa chắc khớp file đã lưu)
  let dirty = false;
  let validation = null;        // { ok, errors } của lần Lưu/Validate gần nhất
  // Đường dẫn cho "Xem thử 1 khung" / "Render thử" — tách khỏi preset vì đây là input của
  // riêng thao tác xem/render thử, không phải một phần cấu trúc preset.
  const previewState = { overlayFile: "", backgroundFile: "" };
  const renderTestState = { overlayFolder: "", backgroundFolder: "", outputFolder: "" };

  // Giai đoạn 2B — canvas kéo thả. Tách state riêng, không trộn vào preset (đây là UI runtime,
  // không phải dữ liệu preset): scale cố định 50% (đủ vừa panel 1400px của app, không cần
  // ResizeObserver để tự co giãn — đơn giản hơn và không có gì để vỡ khi cửa sổ resize).
  const canvasState = {
    scale: 0.5,
    selectedIndex: null,     // đồng bộ 2 chiều với bảng thông số
    note: "",                // ghi chú 1 dòng cạnh canvas (vd: tự đổi fit sang "box")
    dragPreview: null,       // { index, x, y, w, h } — vị trí đang kéo, CHƯA ghi vào preset
    resizePreview: null,     // { index, w, h } — kích thước đang kéo, CHƯA ghi vào preset
    snapGuides: null,        // { v: x|null, h: y|null } — đường gióng đang hít, để vẽ lên canvas
  };
  // Cache khung hình đại diện phía renderer: cacheKey ("video:"+path / "image:"+path) ->
  // { status: "loading"|"ready"|"error", src, naturalW, naturalH, error }. Tách khỏi cache phía
  // main process (sheet/composer-ipc.js, theo videoPath) — cache này còn giữ luôn ảnh <img> đã
  // load để đọc naturalWidth/naturalHeight (suy tỉ lệ cho lớp w:-2), main process không biết gì
  // về việc đó.
  const mediaCache = {};

  // ── helpers ────────────────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function setPath(obj, pathStr, value) {
    const keys = pathStr.split(".");
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (o[k] == null || typeof o[k] !== "object") o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      o = o[k];
    }
    o[keys[keys.length - 1]] = value;
  }

  function newLayer(type) {
    const l = {
      id: `layer_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      label: TYPE_LABELS[type] || "Lớp mới",
      source: { type },
      geometry: { fit: "full", anchor: "center", dx: 0, dy: 0 },
      treatments: [],
      blend: "normal",
    };
    if (type === "image" || type === "video") l.source.path = "";
    if (type === "solid") {
      l.source.color = "black";
      l.geometry = { fit: "box", w: 1280, h: 200, anchor: "bottom-left", dx: 0, dy: 0 };
    }
    if (type === "waveform") {
      l.source.color = "white";
      l.source.mode = "cline";
      l.source.tolerance = 0.01;
      l.geometry = { fit: "box", w: 1280, h: 200, anchor: "bottom-left", dx: 0, dy: 0 };
    }
    return l;
  }

  function newTreatment(kind) {
    return { kind, ...JSON.parse(JSON.stringify(TREATMENT_DEFAULTS[kind] || {})) };
  }

  // Preset mới: nền + đúng 1 lớp overlay — thoả sẵn quy tắc "đúng 1 lớp overlay" của
  // validatePreset, người dùng không bị chặn Lưu ngay từ preset trống.
  function blankPreset() {
    return {
      version: 1, name: "", label: "",
      base: { w: 1280, h: 720 },
      layers: [
        { id: "bg", label: "Nền", source: { type: "background" }, geometry: { fit: "none" }, treatments: [], blend: "normal" },
        { id: "ov", label: "Video gốc", source: { type: "overlay" }, geometry: { fit: "full" }, treatments: [], blend: "normal" },
      ],
    };
  }

  // ── CSS riêng của composer, tiêm một lần lúc dựng UI (không đụng <style> tĩnh của renderer.html) ──
  const COMPOSER_CSS = `
    #composer .composer-shell { display: flex; gap: 20px; align-items: flex-start; }
    #composer .composer-sidebar { width: 260px; flex-shrink: 0; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; position: sticky; top: 0; }
    #composer .composer-sidebar h3 { margin: 0 0 12px; font-size: 14px; color: #2d3748; }
    #composer .composer-preset-item { padding: 10px 12px; border-radius: 8px; cursor: pointer; margin-bottom: 6px; font-size: 14px; color: #2d3748; border: 1px solid transparent; word-break: break-all; }
    #composer .composer-preset-item:hover { background: #edf2f7; }
    #composer .composer-preset-item.active { background: #667eea; color: #fff; border-color: #667eea; }
    #composer .composer-sidebar-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    #composer .composer-sidebar-actions .btn { min-width: auto; padding: 8px 10px; font-size: 12px; }
    #composer .composer-editor { flex: 1; min-width: 0; }
    #composer .composer-layer-card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 14px; background: #fff; }
    #composer .composer-layer-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    #composer .composer-layer-head input[type="text"] { flex: 1; padding: 8px 10px; }
    #composer .composer-layer-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    #composer .composer-layer-grid label, #composer .composer-treatment-row label { font-size: 11px; margin-bottom: 4px; }
    #composer .composer-layer-grid input, #composer .composer-layer-grid select { padding: 8px 10px; }
    #composer .composer-treatment-row { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; border-top: 1px dashed #e2e8f0; padding-top: 10px; margin-top: 10px; }
    #composer .composer-treatment-row input, #composer .composer-treatment-row select { padding: 6px 8px; width: auto; min-width: 90px; }
    #composer .composer-errors { background: #fff5f5; border: 1px solid #feb2b2; color: #c53030; padding: 12px 16px; border-radius: 10px; margin-bottom: 16px; }
    #composer .composer-warnings { background: #fffaf0; border: 1px solid #fbd38d; color: #9c4221; padding: 12px 16px; border-radius: 10px; margin-bottom: 16px; }
    #composer .composer-errors ul, #composer .composer-warnings ul { margin: 6px 0 0; padding-left: 20px; }
    #composer .composer-icon-btn { width: 30px; height: 30px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; cursor: pointer; font-size: 13px; flex-shrink: 0; }
    #composer .composer-icon-btn:hover:not(:disabled) { background: #edf2f7; }
    #composer .composer-icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    #composer .composer-preview-frame { max-width: 480px; width: 100%; border: 1px solid #e2e8f0; border-radius: 10px; margin-top: 12px; display: block; }
    #composer .composer-section { margin-top: 28px; padding-top: 20px; border-top: 2px solid #edf2f7; }
    #composer .composer-section h3 { margin: 0 0 14px; color: #2d3748; }

    /* ── Giai đoạn 2B: canvas kéo thả ──────────────────────────────────────────────────── */
    #composer .composer-canvas-section { margin: 20px 0 28px; padding-top: 20px; border-top: 2px solid #edf2f7; }
    #composer .composer-canvas-section h3 { margin: 0 0 10px; color: #2d3748; }
    #composer .composer-canvas-legend { font-size: 12px; color: #4a5568; margin-bottom: 14px; line-height: 1.6; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
    #composer .composer-canvas-legend kbd { background: #edf2f7; border: 1px solid #cbd5e0; border-radius: 4px; padding: 0 4px; font-size: 11px; }
    #composer .composer-canvas-columns { display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start; }
    #composer .composer-canvas-col { min-width: 0; }
    #composer .composer-canvas-preview-col { flex: 1; min-width: 260px; }
    #composer .composer-canvas-stage { position: relative; background: #1a202c; border: 2px solid #2d3748; border-radius: 6px; overflow: hidden; user-select: none; }
    #composer .composer-canvas-layer { position: absolute; box-sizing: border-box; border: 1px solid rgba(255,255,255,0.55); cursor: move; overflow: hidden; }
    /* pointer-events:none: lớp khoá kéo (đặc biệt blend:"screen") thường phủ TOÀN khung ở
       z-index cao — không có nó thì lớp khoá sẽ CHE MẤT chuột, không ai click/kéo được lớp nào
       nằm dưới nó nữa. Bug thật bắt được khi tự kiểm bằng kéo chuột CDP: kéo lớp #1 (ov) không
       có tác dụng gì vì lớp #3 (blend:screen, phủ kín, z-index cao nhất) nhận hết sự kiện chuột
       thay vì lớp #1 bên dưới. Đánh đổi: không click được để CHỌN riêng lớp khoá từ canvas nữa
       — chấp nhận được vì bảng thông số (layerCard) vẫn chọn được lớp đó bình thường. */
    #composer .composer-canvas-layer.locked { cursor: not-allowed; border-style: dashed; border-color: #fc8181; pointer-events: none; }
    #composer .composer-canvas-layer.blend-fade .composer-canvas-media, #composer .composer-canvas-layer.blend-fade .composer-canvas-img, #composer .composer-canvas-layer.blend-fade .composer-canvas-placeholder { opacity: 0.35; }
    #composer .composer-canvas-layer.approx { border-style: dashed; border-color: #f6ad55; }
    #composer .composer-canvas-layer.selected { outline: 2px solid #667eea; outline-offset: 1px; z-index: 999 !important; }
    #composer .composer-canvas-media { width: 100%; height: 100%; }
    #composer .composer-canvas-img { width: 100%; height: 100%; object-fit: cover; display: block; }
    #composer .composer-canvas-waveform { display: flex; align-items: center; background: #1a202c; color: #fff; }
    #composer .composer-canvas-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #2d3748; color: #a0aec0; font-size: 10px; text-align: center; padding: 2px; line-height: 1.3; }
    #composer .composer-canvas-tag { position: absolute; top: 0; left: 0; background: rgba(0,0,0,0.6); color: #fff; font-size: 10px; padding: 1px 4px; pointer-events: none; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #composer .composer-canvas-lock-note { position: absolute; bottom: 0; left: 0; right: 0; background: rgba(197,48,48,0.85); color: #fff; font-size: 9px; padding: 1px 3px; pointer-events: none; line-height: 1.3; }
    #composer .composer-canvas-approx-badge { position: absolute; top: 0; right: 0; background: rgba(191,124,15,0.9); color: #fff; font-size: 10px; padding: 0 4px; pointer-events: none; cursor: help; }
    /* right/bottom: 0 (không phải số âm) — lớp fit:"full" phủ đúng khít mép canvas, mà canvas
       có overflow:hidden để clip nội dung tràn; tay cầm đặt lệch RA NGOÀI mép (số âm) sẽ bị clip
       mất, không bấm được. Bug thật bắt được khi tự kiểm bằng CDP: elementFromPoint tại toạ độ
       tay cầm của lớp full-frame trả về phần tử CHA (ngoài canvas), không phải tay cầm. */
    #composer .composer-canvas-resize-handle { position: absolute; right: 0; bottom: 0; width: 10px; height: 10px; background: #667eea; border: 1px solid #fff; border-radius: 2px; cursor: nwse-resize; }
    #composer .composer-canvas-guide-v { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1px dashed #48bb78; pointer-events: none; }
    #composer .composer-canvas-guide-h { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed #48bb78; pointer-events: none; }
    #composer .composer-canvas-note { min-height: 16px; font-size: 12px; color: #c05621; margin-top: 8px; }
    #composer .composer-layer-card.selected { border-color: #667eea; box-shadow: 0 0 0 2px rgba(102,126,234,0.25); }
    #composer .composer-layer-card.drop-target { border-top: 3px solid #667eea; }
    #composer .composer-drag-handle { cursor: grab; }
    #composer .composer-layer-locknote { margin-top: 10px; font-size: 11px; color: #9c4221; background: #fffaf0; border: 1px solid #fbd38d; border-radius: 6px; padding: 6px 10px; }
  `;

  function injectStyles() {
    if (document.getElementById("composer-ui-styles")) return;
    const style = document.createElement("style");
    style.id = "composer-ui-styles";
    style.textContent = COMPOSER_CSS;
    document.head.appendChild(style);
  }

  // ── render: khung sườn ─────────────────────────────────────────────────────────────────
  const SHELL_HTML = `
    <div class="tab-header"><h2>Composer — quản lý bố cục preset</h2></div>
    <div id="composer-list-warnings"></div>
    <div class="composer-shell">
      <div class="composer-sidebar">
        <h3>Preset</h3>
        <div id="composer-preset-list"></div>
        <div class="composer-sidebar-actions">
          <button type="button" class="btn btn-secondary" id="composer-new">+ Tạo mới</button>
          <button type="button" class="btn btn-secondary" id="composer-duplicate">⧉ Nhân bản</button>
          <button type="button" class="btn btn-secondary" id="composer-delete">✕ Xoá</button>
        </div>
      </div>
      <div class="composer-editor"><div id="composer-editor-body"></div></div>
    </div>
  `;

  function renderSidebar() {
    const el = document.getElementById("composer-preset-list");
    if (!el) return;
    el.innerHTML = presetNames.length
      ? presetNames.map((n) => `<div class="composer-preset-item${n === currentName ? " active" : ""}" data-name="${esc(n)}">${esc(n)}</div>`).join("")
      : `<div style="color:#a0aec0;font-size:13px;">Chưa có preset nào.</div>`;
    el.querySelectorAll(".composer-preset-item").forEach((row) => {
      row.addEventListener("click", () => selectPreset(row.dataset.name));
    });
  }

  // ── render: 1 lớp ──────────────────────────────────────────────────────────────────────
  function layerCard(layer, index, total) {
    const type = layer?.source?.type || "image";
    const geo = layer.geometry || {};
    const fit = geo.fit || "full";
    const base = `layers.${index}`;

    const pathRow = (type === "image" || type === "video") ? `
      <div>
        <label>Đường dẫn (file hoặc thư mục)</label>
        <div class="folder-select">
          <div class="folder-input-wrap"><input type="text" readonly data-path="${base}.source.path" value="${esc(layer.source?.path || "")}" placeholder="Chưa chọn"></div>
          <button type="button" class="btn btn-secondary" data-action="pick-layer-path" data-layer-index="${index}">Chọn…</button>
        </div>
      </div>
      <div>
        <label>Khe (slot) — để trống nếu không cần Sheet ghi đè</label>
        <input type="text" data-path="${base}.slot" value="${esc(layer.slot || "")}">
      </div>` : "";

    const colorRow = (type === "solid" || type === "waveform") ? `
      <div>
        <label>Màu (${type === "solid" ? "khối màu" : "nét sóng"})</label>
        <input type="text" data-path="${base}.source.color" value="${esc(layer.source?.color || (type === "solid" ? "black" : "white"))}">
      </div>` : "";

    const waveformExtra = type === "waveform" ? `
      <div>
        <label>Kiểu vẽ (mode)</label>
        <select data-path="${base}.source.mode">
          ${["cline", "line", "point", "p2p"].map((m) => `<option value="${m}" ${(layer.source?.mode || "cline") === m ? "selected" : ""}>${m}</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Dung sai khử nền đen (tolerance)</label>
        <input type="text" data-path="${base}.source.tolerance" value="${esc(layer.source?.tolerance ?? 0.01)}">
      </div>` : "";

    const sizeFields = fit === "scale"
      ? `<div><label>Tỉ lệ (0–1)</label><input type="text" data-path="${base}.geometry.value" value="${esc(geo.value ?? 0.85)}"></div>`
      : fit === "box"
      ? `<div><label>Rộng (w, -2 = giữ tỉ lệ)</label><input type="text" data-path="${base}.geometry.w" value="${esc(geo.w ?? "")}"></div>
         <div><label>Cao (h)</label><input type="text" data-path="${base}.geometry.h" value="${esc(geo.h ?? "")}"></div>`
      : "";

    // Giai đoạn 2B: cùng 2 điều kiện MÀ CANVAS dùng để khoá kéo (xem canvasLayerBox/
    // computeLayerBoxBase phía dưới) — lặp lại phép kiểm ở đây (không phải một nguồn khác) để
    // bảng thông số và canvas LUÔN nói giống nhau về việc anchor/dx/dy có tác dụng hay không.
    const geom = G();
    const ignoredBottom = Boolean(geom) && index === 0 && geom.isBottomAnchorIgnored(layer);
    const ignoredBlend = Boolean(geom) && index !== 0 && geom.isBlendPositionIgnored(layer);
    const lockNoteHtml = ignoredBottom
      ? `<div class="composer-layer-locknote">🔒 Lớp dưới cùng: không có bước chồng lớp — anchor/dx/dy của lớp này bị compiler BỎ QUA hoàn toàn khi render. Kéo trên canvas cũng bị khoá vì lý do y hệt.</div>`
      : ignoredBlend
      ? `<div class="composer-layer-locknote">🔒 blend: "screen" phủ toàn khung, không đọc toạ độ — anchor/dx/dy của lớp này bị compiler BỎ QUA khi render. Kéo trên canvas cũng bị khoá vì lý do y hệt.</div>`
      : "";
    const selected = canvasState.selectedIndex === index;

    return `
    <div class="composer-layer-card${selected ? " selected" : ""}" data-layer-index="${index}">
      <div class="composer-layer-head">
        <button type="button" class="composer-icon-btn composer-drag-handle" data-action="layer-drag-handle" data-layer-index="${index}" title="Kéo để đổi thứ tự lớp">⠿</button>
        <span style="font-weight:700;color:#667eea;white-space:nowrap;">#${index}${index === 0 ? " (dưới cùng)" : index === total - 1 ? " (trên cùng)" : ""}</span>
        <input type="text" data-path="${base}.label" value="${esc(layer.label || "")}" placeholder="Nhãn lớp">
        <button type="button" class="composer-icon-btn" data-action="layer-up" data-layer-index="${index}" title="Di chuyển lên trong danh sách" ${index === 0 ? "disabled" : ""}>▲</button>
        <button type="button" class="composer-icon-btn" data-action="layer-down" data-layer-index="${index}" title="Di chuyển xuống trong danh sách" ${index === total - 1 ? "disabled" : ""}>▼</button>
        <button type="button" class="composer-icon-btn" data-action="layer-remove" data-layer-index="${index}" title="Xoá lớp">✕</button>
      </div>
      <div class="composer-layer-grid">
        <div>
          <label>Loại nguồn</label>
          <select data-path="${base}.source.type" data-structural="1">
            ${SOURCE_TYPES.map((t) => `<option value="${t}" ${t === type ? "selected" : ""}>${TYPE_LABELS[t]}</option>`).join("")}
          </select>
        </div>
        ${pathRow}
        ${colorRow}
        ${waveformExtra}
        <div>
          <label>Fit (cách chiếm chỗ)</label>
          <select data-path="${base}.geometry.fit" data-structural="1">
            ${FIT_MODES.map((f) => `<option value="${f}" ${f === fit ? "selected" : ""}>${FIT_LABELS[f]}</option>`).join("")}
          </select>
        </div>
        ${sizeFields}
        <div>
          <label>Vị trí neo (anchor)</label>
          <select data-path="${base}.geometry.anchor">
            ${ANCHOR_KEYS.map((a) => `<option value="${a}" ${(geo.anchor || "center") === a ? "selected" : ""}>${a}</option>`).join("")}
          </select>
        </div>
        <div><label>Lệch ngang (dx)</label><input type="text" data-path="${base}.geometry.dx" value="${esc(geo.dx ?? 0)}"></div>
        <div><label>Lệch dọc (dy)</label><input type="text" data-path="${base}.geometry.dy" value="${esc(geo.dy ?? 0)}"></div>
        <div>
          <label>Blend</label>
          <select data-path="${base}.blend" data-structural="1">
            ${BLEND_MODES.map((b) => `<option value="${b}" ${(layer.blend || "normal") === b ? "selected" : ""}>${b}</option>`).join("")}
          </select>
        </div>
      </div>
      ${lockNoteHtml}
      ${treatmentsBlock(layer, index)}
    </div>`;
  }

  function treatmentField(t, base, key, labelText, kindAttr) {
    const raw = t?.[key];
    const value = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
    return `<div><label>${labelText}</label><input type="text" data-path="${base}.${key}" ${kindAttr ? `data-kind="${kindAttr}"` : ""} value="${esc(value)}"></div>`;
  }

  function treatmentRow(t, li, ti) {
    const kind = t?.kind || "opacity";
    const base = `layers.${li}.treatments.${ti}`;
    let fields = "";
    if (kind === "cropStrip") fields = treatmentField(t, base, "height", "Chiều cao (height)") + treatmentField(t, base, "yOffset", "Lệch dọc (yOffset)");
    else if (kind === "grayContrast") fields = treatmentField(t, base, "brightness", "Brightness") + treatmentField(t, base, "contrast", "Contrast") + treatmentField(t, base, "gamma", "Gamma") + treatmentField(t, base, "saturation", "Saturation");
    else if (kind === "blur") fields = treatmentField(t, base, "sigma", "Sigma");
    else if (kind === "chromakey") fields = treatmentField(t, base, "color", "Màu (hex, không #)") + treatmentField(t, base, "similarity", "Similarity") + treatmentField(t, base, "blend", "Blend");
    else if (kind === "lumakey") fields = treatmentField(t, base, "threshold", "Threshold") + treatmentField(t, base, "tolerance", "Tolerance") + treatmentField(t, base, "softness", "Softness");
    else if (kind === "opacity") fields = treatmentField(t, base, "value", "Giá trị (0–1)");
    else if (kind === "keepColors") fields = treatmentField(t, base, "colors", "Màu giữ lại (phân cách bởi dấu phẩy, hex không #)", "csv") + treatmentField(t, base, "similarity", "Similarity");

    return `
      <div class="composer-treatment-row" data-treatment-index="${ti}">
        <div>
          <label>Kind</label>
          <select data-path="${base}.kind" data-structural="1">
            ${TREATMENT_KINDS.map((k) => `<option value="${k}" ${k === kind ? "selected" : ""}>${TREATMENT_LABELS[k]}</option>`).join("")}
          </select>
        </div>
        ${fields}
        <button type="button" class="composer-icon-btn" data-action="treatment-remove" data-layer-index="${li}" data-treatment-index="${ti}" title="Xoá treatment">✕</button>
      </div>`;
  }

  function treatmentsBlock(layer, index) {
    const treatments = layer.treatments || [];
    const rows = treatments.map((t, ti) => treatmentRow(t, index, ti)).join("");
    const addButtons = TREATMENT_KINDS.map((k) =>
      `<button type="button" class="btn btn-secondary" style="min-width:auto;padding:6px 10px;font-size:12px;" data-action="treatment-add" data-layer-index="${index}" data-kind="${k}">+ ${TREATMENT_LABELS[k]}</button>`
    ).join(" ");
    return `
      <div style="margin-top:14px;">
        <label style="display:block;margin-bottom:8px;font-size:12px;">Treatments (áp theo đúng thứ tự khai báo)</label>
        ${rows || '<div style="color:#a0aec0;font-size:13px;margin-bottom:8px;">Chưa có treatment nào.</div>'}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">${addButtons}</div>
      </div>`;
  }

  // ── Giai đoạn 2B: canvas kéo thả — khung hình đại diện thật ────────────────────────────
  // Đường dẫn file/thư mục Windows -> file URL, dùng chung cho <img src> của lớp "image" và cho
  // onPreview() bên dưới (tách khỏi onPreview để không duplicate cách dựng "file:///").
  function toFileUrl(p) {
    if (!p) return "";
    const normalized = String(p).replace(/\\/g, "/");
    return `file:///${normalized.replace(/^\/+/, "")}`;
  }

  // Lấy (và nếu cần, TRÍCH) khung hình đại diện cho một video/ảnh mẫu. Cache theo cacheKey để
  // không gọi lại IPC/không tải lại ảnh mỗi lần renderCanvasOnly() vẽ lại toàn bộ canvas (vẽ lại
  // xảy ra liên tục lúc kéo chuột). Trả về cache entry NGAY (có thể đang "loading") — khi
  // fetch/tải ảnh xong, tự gọi renderCanvasOnly() để vẽ lại với khung hình thật.
  function getMedia(kind, key) {
    if (!key) return null;
    const cacheKey = `${kind}:${key}`;
    const existing = mediaCache[cacheKey];
    if (existing) return existing;
    const entry = { status: "loading", src: null, naturalW: null, naturalH: null, error: null };
    mediaCache[cacheKey] = entry;
    const onImageReady = (img) => {
      entry.status = "ready";
      entry.naturalW = img.naturalWidth;
      entry.naturalH = img.naturalHeight;
      renderCanvasOnly();
    };
    if (kind === "image") {
      entry.src = toFileUrl(key);
      const img = new Image();
      img.onload = () => onImageReady(img);
      img.onerror = () => { entry.status = "error"; entry.error = "không tải được ảnh"; renderCanvasOnly(); };
      img.src = entry.src;
    } else {
      // "video": trích 1 khung PNG thật qua composer:extractThumb (sheet/composer-ipc.js, có
      // cache riêng phía main process theo videoPath) — KHÔNG dựng frame giả ở renderer.
      if (!api()) { entry.status = "error"; entry.error = "electronAPI.composer chưa sẵn sàng"; return entry; }
      api().extractThumb({ videoPath: key, atSecond: 1 }).then((res) => {
        if (!res || !res.ok) {
          entry.status = "error";
          entry.error = (res && res.error) || "không trích được khung hình";
          renderCanvasOnly();
          return;
        }
        entry.src = res.dataUri;
        const img = new Image();
        img.onload = () => onImageReady(img);
        // Có src nhưng không đọc được naturalWidth/Height (hiếm) — vẫn hiển thị ảnh, chỉ mất
        // phần suy tỉ lệ cho lớp w:-2.
        img.onerror = () => { entry.status = "ready"; renderCanvasOnly(); };
        img.src = entry.src;
      }).catch((err) => {
        entry.status = "error";
        entry.error = String(err?.message || err);
        renderCanvasOnly();
      });
    }
    return entry;
  }

  // 5 kind treatment này (+ waveform) xử lý ĐIỂM ẢNH — canvas dùng DOM/CSS thuần, không thể vẽ
  // đúng làm mờ/khử màu nền/khử độ sáng/chỉnh sáng-tương phản/hình sóng thật. Lớp có chúng PHẢI
  // được đánh dấu xấp xỉ, không được vẽ như thể chính xác — xem yêu cầu "3 trường hợp UI TUYỆT
  // ĐỐI KHÔNG được nói dối" trong thiết kế.
  const PIXEL_APPROX_KINDS = new Set(["chromakey", "blur", "keepColors", "lumakey", "grayContrast"]);
  function hasPixelApproxTreatment(layer) {
    if (layer?.source?.type === "waveform") return true;
    return (layer?.treatments || []).some((t) => PIXEL_APPROX_KINDS.has(t?.kind));
  }

  // Toạ độ + kích thước SỐ (hệ 1280x720 gốc, KHÔNG phải toạ độ đã thu nhỏ trên canvas) của một
  // lớp — dùng để vẽ box VÀ để biết lớp có kéo được không. Đây là nơi DUY NHẤT quyết định
  // draggable, dùng chung cho canvas lẫn ghi chú khoá kéo trong layerCard() ở trên.
  function computeLayerBoxBase(layer, index) {
    const geom = G();
    const geo = layer?.geometry || {};
    const type = layer?.source?.type;

    let natural = null;
    if (type === "background") natural = getMedia("video", previewState.backgroundFile);
    else if (type === "overlay") natural = getMedia("video", previewState.overlayFile);
    else if (type === "video") natural = getMedia("video", layer.source?.path);
    else if (type === "image") natural = getMedia("image", layer.source?.path);
    const naturalOpts = natural && natural.status === "ready"
      ? { naturalW: natural.naturalW, naturalH: natural.naturalH }
      : undefined;

    let size;
    if (geo.fit === "none" && (type === "background" || type === "overlay")) {
      // Khớp isTrustedFullFrame() của layer-compiler.js: toàn hệ thống tin hai luồng gốc này
      // luôn 1280x720 khi fit:"none" (xem comment ở đó) — override CỨNG, không để boxSize() suy
      // đoán theo ảnh mẫu (ảnh mẫu có thể lệch tỉ lệ 16:9 giả định của toàn hệ thống).
      size = { w: BASE_W, h: BASE_H, approx: false };
    } else if (geom) {
      size = geom.boxSize(geo, naturalOpts);
    } else {
      size = { w: BASE_W, h: BASE_H, approx: true };
    }

    // index===0: chỉ lớp ĐẦU TIÊN trong mảng mới có thể là "lớp dựng stage đầu tiên" của
    // compilePreset (giả định layer[0].source luôn dựng được — nếu lớp 0 có path rỗng/hỏng thật
    // sự thì compiler thật sẽ nhảy sang lớp kế tiếp làm nền, canvas ở đây sẽ đoán SAI lớp bị
    // khoá kéo; đây là giới hạn đã biết, chấp nhận được vì trường hợp preset hỏng đó vốn đã bị
    // validatePreset/previewFrame báo lỗi ở nơi khác).
    // index!==0 cho isBlendPositionIgnored: compilePreset KHÔNG BAO GIỜ đọc layer.blend của lớp
    // dựng stage đầu tiên (nhánh "stage === null" không có nhánh nào rẽ theo blend) — nên lớp 0
    // có blend:"screen" vẫn phải xét theo isBottomAnchorIgnored, không phải isBlendPositionIgnored.
    const ignoredBottom = Boolean(geom) && index === 0 && geom.isBottomAnchorIgnored(layer);
    const ignoredBlend = Boolean(geom) && index !== 0 && geom.isBlendPositionIgnored(layer);
    const draggable = !ignoredBottom && !ignoredBlend;

    const pos = draggable && geom
      ? geom.anchorPosition(geo.anchor || "center", size.w, size.h, geo.dx || 0, geo.dy || 0, BASE_W, BASE_H)
      // Vị trí KHÔNG có ý nghĩa (bị compiler bỏ qua) — cố định về góc (0,0) để không ai lỡ đọc
      // nhầm đây là một toạ độ thật.
      : { x: 0, y: 0 };

    return {
      x: pos.x, y: pos.y, w: size.w, h: size.h,
      approx: Boolean(size.approx) || hasPixelApproxTreatment(layer),
      draggable, ignoredBottom, ignoredBlend,
    };
  }

  const WAVEFORM_SVG = `<svg viewBox="0 0 100 20" preserveAspectRatio="none" width="100%" height="100%">
      <path d="M0,10 C5,2 10,2 12,10 C14,18 20,18 22,10 C24,4 28,4 30,10 C32,17 38,17 40,10 C42,3 47,3 50,10 C53,17 58,17 60,10 C62,4 67,4 70,10 C72,18 78,18 80,10 C82,3 88,3 90,10 C92,17 97,17 100,10"
        fill="none" stroke="currentColor" stroke-width="2"/>
    </svg>`;

  function placeholderHtml(text) {
    return `<div class="composer-canvas-placeholder">${esc(text)}</div>`;
  }
  function mediaFromCacheEntry(entry, missingLabel) {
    if (!entry) return placeholderHtml(missingLabel);
    if (entry.status === "loading") return placeholderHtml("Đang tải…");
    if (entry.status === "error") return placeholderHtml(entry.error || missingLabel);
    return `<img class="composer-canvas-img" src="${entry.src}" draggable="false" alt="">`;
  }

  // Hình đại diện THẬT theo từng loại nguồn — đây là điểm brief nhấn mạnh: KHÔNG vẽ ô xám cho
  // background/overlay/image/solid, chỉ waveform mới vẽ hình giả (và được ghi rõ là giả).
  function mediaHtmlForLayer(layer) {
    const type = layer?.source?.type;
    if (type === "solid") {
      return `<div class="composer-canvas-media" style="background:${esc(layer.source?.color || "black")};"></div>`;
    }
    if (type === "waveform") {
      return `<div class="composer-canvas-media composer-canvas-waveform">${WAVEFORM_SVG}</div>`;
    }
    if (type === "background") {
      return mediaFromCacheEntry(getMedia("video", previewState.backgroundFile), "Chưa chọn video nền mẫu (cột bên phải)");
    }
    if (type === "overlay") {
      return mediaFromCacheEntry(getMedia("video", previewState.overlayFile), "Chưa chọn video gốc mẫu (cột bên phải)");
    }
    if (type === "video") {
      const p = layer.source?.path;
      if (!p) return placeholderHtml("Chưa chọn file video");
      return mediaFromCacheEntry(getMedia("video", p), "Không trích được khung hình");
    }
    if (type === "image") {
      const p = layer.source?.path;
      if (!p) return placeholderHtml("Chưa chọn ảnh");
      return mediaFromCacheEntry(getMedia("image", p), "Không tải được ảnh");
    }
    return placeholderHtml(type || "?");
  }

  function resizeHandleHtml() {
    return `<div class="composer-canvas-resize-handle" title="Kéo để đổi kích thước — chỉ fit:&quot;box&quot; có w/h cố định, kéo trên lớp full/scale sẽ tự đổi sang box"></div>`;
  }

  // Vẽ 1 lớp lên canvas — box HTML nhận toạ độ/kích thước đã được tính sẵn (base 1280x720, sau
  // khi đã áp dragPreview/resizePreview nếu đang kéo — xem buildCanvasBoxesHtml).
  function canvasLayerBox(layer, index, box) {
    const scale = canvasState.scale;
    const style = [
      `left:${(box.x * scale).toFixed(1)}px`,
      `top:${(box.y * scale).toFixed(1)}px`,
      `width:${Math.max(box.w * scale, 3).toFixed(1)}px`,
      `height:${Math.max(box.h * scale, 3).toFixed(1)}px`,
      `z-index:${index + 1}`, // lớp sau đè lên lớp trước, đúng thứ tự chồng của compilePreset.
    ].join(";");
    const classes = ["composer-canvas-layer"];
    if (!box.draggable) classes.push("locked");
    // blend:"screen" luôn phủ ĐÚNG TOÀN KHUNG (1280x720) — nếu vẽ đặc như mọi lớp khác nó sẽ che
    // kín mọi lớp bên dưới trên canvas (khác thật với video render ra, nơi screen-blend hoà màu
    // chứ không che). Làm mờ phần MEDIA (không mờ nhãn/ghi chú) để canvas còn dùng được, không
    // phải vì đây là số liệu chính xác của phép blend thật (canvas vốn không vẽ được phép blend
    // điểm ảnh, xem info-box "Xem thử 1 khung hình" để thấy đúng).
    if (box.ignoredBlend) classes.push("blend-fade");
    if (box.approx) classes.push("approx");
    if (canvasState.selectedIndex === index) classes.push("selected");
    const lockNote = box.ignoredBottom
      ? `<div class="composer-canvas-lock-note">Lớp dưới cùng — không qua bước chồng, kéo vô tác dụng</div>`
      : box.ignoredBlend
      ? `<div class="composer-canvas-lock-note">blend:"screen" — phủ toàn khung, không có toạ độ</div>`
      : "";
    const approxBadge = box.approx
      ? `<div class="composer-canvas-approx-badge" title="Xử lý điểm ảnh (làm mờ/khử màu nền/khử độ sáng/sáng-tương phản/waveform thật…) hoặc kích thước tự suy (w:-2) không hiển thị chính xác trên canvas — bấm &quot;Xem thử 1 khung hình&quot; ở cột bên phải để xem đúng.">≈</div>`
      : "";
    return `
      <div class="${classes.join(" ")}" data-layer-index="${index}" style="${style}">
        ${mediaHtmlForLayer(layer)}
        ${approxBadge}
        <div class="composer-canvas-tag">#${index} ${esc(layer.label || layer.source?.type || "")}</div>
        ${lockNote}
        ${box.draggable ? resizeHandleHtml() : ""}
      </div>`;
  }

  function buildGuideHtml(guides) {
    if (!guides) return "";
    const scale = canvasState.scale;
    let html = "";
    if (guides.v !== null && guides.v !== undefined) {
      html += `<div class="composer-canvas-guide-v" style="left:${(guides.v * scale).toFixed(1)}px;"></div>`;
    }
    if (guides.h !== null && guides.h !== undefined) {
      html += `<div class="composer-canvas-guide-h" style="top:${(guides.h * scale).toFixed(1)}px;"></div>`;
    }
    return html;
  }

  // Dựng HTML của TOÀN BỘ canvas (mọi lớp + đường gióng đang hít nếu có). Tách khỏi renderEditor
  // để renderCanvasOnly() gọi lại được mà không phải dựng lại cả bảng thông số (giữ focus của ô
  // đang gõ, và mượt hơn khi vẽ lại liên tục lúc kéo chuột).
  function buildCanvasBoxesHtml() {
    if (!preset) return "";
    const layers = preset.layers || [];
    const boxesHtml = layers.map((layer, i) => {
      let box = computeLayerBoxBase(layer, i);
      if (canvasState.dragPreview && canvasState.dragPreview.index === i) {
        box = { ...box, x: canvasState.dragPreview.x, y: canvasState.dragPreview.y };
      } else if (canvasState.resizePreview && canvasState.resizePreview.index === i) {
        box = { ...box, w: canvasState.resizePreview.w, h: canvasState.resizePreview.h };
      }
      return canvasLayerBox(layer, i, box);
    }).join("");
    return boxesHtml + buildGuideHtml(canvasState.snapGuides);
  }

  // Vẽ lại CHỈ phần canvas (không đụng bảng thông số) — dùng khi kéo/resize (liên tục) và khi
  // đổi field không "structural" trong bảng (dx/dy/anchor/đường dẫn ảnh mẫu…).
  function renderCanvasOnly() {
    const stage = document.getElementById("composer-canvas-stage");
    if (!stage) return;
    stage.innerHTML = buildCanvasBoxesHtml();
    const noteEl = document.getElementById("composer-canvas-note");
    if (noteEl) noteEl.textContent = canvasState.note || "";
  }

  // Đồng bộ 2 chiều: tô sáng ĐÚNG 1 lớp ở cả canvas lẫn bảng thông số, không phải render lại cả
  // hai (tránh mất focus ô đang gõ / giật hình lúc kéo). scrollToCard=true khi chọn TỪ canvas
  // (người dùng cần thấy ngay ô thông số tương ứng); false khi chọn từ chính bảng (đã nhìn thấy
  // rồi, cuộn thêm chỉ gây khó chịu).
  function syncSelectionHighlight(scrollToCard) {
    const idx = canvasState.selectedIndex;
    document.querySelectorAll("#composer .composer-layer-card").forEach((el) => {
      el.classList.toggle("selected", Number(el.dataset.layerIndex) === idx);
    });
    document.querySelectorAll("#composer .composer-canvas-layer").forEach((el) => {
      el.classList.toggle("selected", Number(el.dataset.layerIndex) === idx);
    });
    if (scrollToCard && idx !== null) {
      const card = document.querySelector(`#composer .composer-layer-card[data-layer-index="${idx}"]`);
      if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function selectLayer(index, scrollToCard) {
    if (canvasState.selectedIndex === index) return;
    canvasState.selectedIndex = index;
    syncSelectionHighlight(Boolean(scrollToCard));
  }

  // ── Giai đoạn 2B: kéo thả trên canvas — hít vào 9 điểm neo + 2 đường tâm (đặc biệt chính là
  // 3x3 điểm {0,(L-l)/2,L-l} theo mỗi chiều — cột giữa/hàng giữa CHÍNH LÀ đường tâm) trong
  // ngưỡng 8px THEO TOẠ ĐỘ CANVAS ĐÃ THU NHỎ (brief ghi rõ), nên phải quy đổi ngưỡng đó về hệ
  // toạ độ gốc 1280x720 bằng cách chia cho scale trước khi so.
  function computeSnap(x, y, w, h) {
    const scale = canvasState.scale;
    const thresholdBase = 8 / scale;
    const candidatesX = [0, (BASE_W - w) / 2, BASE_W - w];
    const candidatesY = [0, (BASE_H - h) / 2, BASE_H - h];
    let outX = x, outY = y, guideV = null, guideH = null, bestXd = Infinity, bestYd = Infinity;
    for (const cx of candidatesX) {
      const d = Math.abs(x - cx);
      if (d <= thresholdBase && d < bestXd) { bestXd = d; outX = cx; guideV = cx; }
    }
    for (const cy of candidatesY) {
      const d = Math.abs(y - cy);
      if (d <= thresholdBase && d < bestYd) { bestYd = d; outY = cy; guideH = cy; }
    }
    return { x: outX, y: outY, guides: { v: guideV, h: guideH } };
  }

  function startMoveDrag(e, index, layer, info) {
    const scale = canvasState.scale;
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startX = info.x;
    const startY = info.y;
    function onMove(ev) {
      const dxBase = (ev.clientX - startMouseX) / scale;
      const dyBase = (ev.clientY - startMouseY) / scale;
      const rawX = startX + dxBase;
      const rawY = startY + dyBase;
      // Giữ Alt để tắt hít — đọc trực tiếp ev.altKey mỗi lần di chuột, không chốt lúc mousedown,
      // để người dùng bấm/nhả Alt giữa chừng vẫn có tác dụng ngay.
      const snap = ev.altKey ? null : computeSnap(rawX, rawY, info.w, info.h);
      canvasState.dragPreview = { index, x: snap ? snap.x : rawX, y: snap ? snap.y : rawY, w: info.w, h: info.h };
      canvasState.snapGuides = snap ? snap.guides : null;
      renderCanvasOnly();
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const preview = canvasState.dragPreview;
      canvasState.dragPreview = null;
      canvasState.snapGuides = null;
      const geom = G();
      if (preview && geom) {
        // ĐÂY LÀ BƯỚC CHỐT của thiết kế: nhả chuột KHÔNG ghi toạ độ tuyệt đối vào preset, mà gọi
        // pickAnchor() để suy ra anchor + phần lệch dx/dy nhỏ nhất — giữ đúng hành vi "dán sát
        // đáy bất kể lớp cao bao nhiêu" mà compiler cần ở biểu thức anchor.
        const picked = geom.pickAnchor({ x: preview.x, y: preview.y, w: preview.w, h: preview.h, W: BASE_W, H: BASE_H });
        const geo = layer.geometry || (layer.geometry = {});
        geo.anchor = picked.anchor;
        geo.dx = picked.dx;
        geo.dy = picked.dy;
        dirty = true;
        renderEditor();
      } else {
        renderCanvasOnly();
      }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function startResizeDrag(e, index, layer, info) {
    const scale = canvasState.scale;
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startW = info.w;
    const startH = info.h;
    const wasMinus2 = Number(layer.geometry?.w) === -2;
    const aspect = startH > 0 ? startW / startH : 1;
    function onMove(ev) {
      const dW = (ev.clientX - startMouseX) / scale;
      const dH = (ev.clientY - startMouseY) / scale;
      const newH = Math.max(4, startH + dH);
      // Lớp w:-2 (giữ tỉ lệ gốc): bỏ qua hẳn deltaX, chiều rộng LUÔN suy theo tỉ lệ hiện tại —
      // đúng yêu cầu "kéo chiều cao vẫn giữ w:-2", không biến nó thành số khi đang kéo.
      const newW = wasMinus2 ? Math.max(4, newH * aspect) : Math.max(4, startW + dW);
      canvasState.resizePreview = { index, w: newW, h: newH };
      renderCanvasOnly();
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const preview = canvasState.resizePreview;
      canvasState.resizePreview = null;
      if (preview) {
        const geo = layer.geometry || (layer.geometry = {});
        if (geo.fit !== "box") {
          // Resize CHỈ có nghĩa với fit:"box" (kích thước cố định) — full/scale/none không có
          // w/h riêng để lưu. Tự đổi sang box và NÓI RÕ cho người dùng bằng 1 dòng ghi chú cạnh
          // canvas, đúng yêu cầu "không phải hộp thoại".
          canvasState.note = `Đã tự đổi lớp "${layer.label || layer.source?.type || `#${index}`}" sang fit: "box" vì bạn vừa đổi kích thước bằng tay trên canvas — chỉ fit "box" mới có chiều rộng/cao cố định để lưu lại.`;
          geo.fit = "box";
          if (!geo.anchor) geo.anchor = "center";
        }
        geo.h = Math.max(2, Math.round(preview.h));
        // wasMinus2: GIỮ NGUYÊN -2 trong dữ liệu preset — preview.w chỉ là số ước lượng để vẽ lúc
        // kéo, không bao giờ được ghi ngược lại geometry.w (đúng yêu cầu của thiết kế).
        geo.w = wasMinus2 ? -2 : Math.max(2, Math.round(preview.w));
        dirty = true;
        renderEditor();
      } else {
        renderCanvasOnly();
      }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function onCanvasBoxMouseDown(e, boxEl) {
    if (!preset) return;
    const index = Number(boxEl.dataset.layerIndex);
    const layer = preset.layers[index];
    if (!layer) return;
    selectLayer(index, false);
    const info = computeLayerBoxBase(layer, index);
    if (!info.draggable) return; // đã chọn xong — 2 trường hợp brief cấm kéo, dừng đúng ở đây.
    e.preventDefault();
    const handleEl = e.target.closest(".composer-canvas-resize-handle");
    if (handleEl) startResizeDrag(e, index, layer, info);
    else startMoveDrag(e, index, layer, info);
  }

  // ── Giai đoạn 2B: kéo để đổi thứ tự lớp trong danh sách (thêm bên cạnh nút ▲▼ có sẵn, không
  // thay thế — brief cho phép giữ cả hai, và ▲▼ là đường lùi chắc chắn nếu kéo bị lỡ tay). ────
  function moveArrayItem(arr, from, to) {
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
  }

  function startLayerReorderDrag(e, sourceIndex) {
    e.preventDefault();
    let targetIndex = sourceIndex;
    function currentCards() {
      return Array.from(document.querySelectorAll("#composer .composer-layer-card"));
    }
    function onMove(ev) {
      const cards = currentCards();
      let ti = sourceIndex;
      for (let i = 0; i < cards.length; i++) {
        const rect = cards[i].getBoundingClientRect();
        if (ev.clientY < rect.top + rect.height / 2) { ti = i; break; }
        ti = i;
      }
      targetIndex = Math.max(0, Math.min(cards.length - 1, ti));
      cards.forEach((c, i) => c.classList.toggle("drop-target", i === targetIndex));
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      currentCards().forEach((c) => c.classList.remove("drop-target"));
      if (preset && targetIndex !== sourceIndex) {
        moveArrayItem(preset.layers, sourceIndex, targetIndex);
        dirty = true;
        canvasState.selectedIndex = targetIndex;
        renderEditor();
      }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ── render: toàn bộ panel bên phải ─────────────────────────────────────────────────────
  function renderEditor() {
    const el = document.getElementById("composer-editor-body");
    if (!el) return;
    if (!api()) {
      el.innerHTML = `<div class="composer-errors">Không thấy window.electronAPI.composer — preload.cjs chưa expose kênh composer, hoặc trang này không chạy trong Electron.</div>`;
      return;
    }
    if (!preset) {
      el.innerHTML = `<div class="info-box"><p>Chưa chọn preset nào. Bấm "+ Tạo mới" hoặc chọn một preset ở danh sách bên trái.</p></div>`;
      return;
    }
    const errBlock = validation && !validation.ok
      ? `<div class="composer-errors"><strong>⚠️ Preset chưa hợp lệ — sửa hết các lỗi sau rồi Lưu lại:</strong><ul>${validation.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`
      : "";
    const layersHtml = (preset.layers || []).map((l, i) => layerCard(l, i, preset.layers.length)).join("");
    const stageW = Math.round(BASE_W * canvasState.scale);
    const stageH = Math.round(BASE_H * canvasState.scale);

    el.innerHTML = `
      ${errBlock}
      <div class="form-group" style="display:flex;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          <label>Tên preset (dùng làm tên file)</label>
          <input type="text" data-path="name" value="${esc(preset.name || "")}">
        </div>
        <div style="flex:1;min-width:200px;">
          <label>Nhãn hiển thị</label>
          <input type="text" data-path="label" value="${esc(preset.label || "")}">
        </div>
      </div>

      <div class="composer-canvas-section">
        <h3>Canvas — kéo thả để đặt vị trí (khung 1280×720, thu nhỏ ${Math.round(canvasState.scale * 100)}%)</h3>
        <div class="composer-canvas-legend">
          Khung hình THẬT cho background/overlay (theo video mẫu ở cột bên phải) và ảnh; khối màu vẽ đúng màu; waveform vẽ SVG giả chỉ để định vị.
          Viền nét đứt + nhãn "≈" = kích thước hoặc xử lý điểm ảnh chỉ là ƯỚC LƯỢNG (làm mờ/khử màu nền/khử độ sáng/sáng-tương phản/hình sóng thật KHÔNG vẽ được trên canvas) — bấm "Xem thử 1 khung hình" bên phải để xem đúng.
          Giữ <kbd>Alt</kbd> khi kéo để tắt hít (snap) vào 9 điểm neo/2 đường tâm.
        </div>
        <div class="composer-canvas-columns">
          <div class="composer-canvas-col">
            <div class="composer-canvas-stage" id="composer-canvas-stage" style="width:${stageW}px;height:${stageH}px;">
              ${buildCanvasBoxesHtml()}
            </div>
            <div id="composer-canvas-note" class="composer-canvas-note">${esc(canvasState.note || "")}</div>
          </div>
          <div class="composer-canvas-col composer-canvas-preview-col">
            <h4 style="margin:0 0 8px;color:#2d3748;">Xem thử 1 khung hình</h4>
            <div class="info-box">
              <p><strong>Hai điều KHÔNG phải lỗi khi xem thử:</strong></p>
              <p>1) Ảnh xuất ra không thể hiện tốc độ video (videoSpeed / setpts, atempo) — bước đó chỉ được chèn khi render video thật.</p>
              <p>2) Waveform vẽ theo đúng đoạn âm thanh TẠI giây đang xem — xem ở giây khác ra hình sóng khác là bình thường, không phải lỗi.</p>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;">
              <div>
                <label>Video gốc (overlay) để xem thử — CŨNG dùng làm khung đại diện của lớp overlay trên canvas</label>
                <div class="folder-select">
                  <div class="folder-input-wrap"><input type="text" readonly id="composer-preview-overlay" value="${esc(previewState.overlayFile)}"></div>
                  <button type="button" class="btn btn-secondary" data-action="pick-preview-overlay">Chọn…</button>
                </div>
              </div>
              <div>
                <label>Video nền (background) để xem thử — CŨNG dùng làm khung đại diện của lớp background trên canvas</label>
                <div class="folder-select">
                  <div class="folder-input-wrap"><input type="text" readonly id="composer-preview-background" value="${esc(previewState.backgroundFile)}"></div>
                  <button type="button" class="btn btn-secondary" data-action="pick-preview-background">Chọn…</button>
                </div>
              </div>
              <div style="max-width:160px;">
                <label>Tại giây thứ</label>
                <input type="number" min="0" step="0.5" id="composer-preview-second" value="0">
              </div>
            </div>
            <div style="margin-top:12px;"><button type="button" class="btn btn-primary" data-action="preview">🖼 Xem thử 1 khung</button></div>
            <div id="composer-preview-result" style="margin-top:12px;"></div>
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0 16px;flex-wrap:wrap;gap:8px;">
        <span style="font-weight:600;color:#2d3748;">Lớp — xếp theo thứ tự dưới → trên (#0 dưới cùng, cuối cùng trên cùng): ${preset.layers.length}. Kéo tay cầm ⠿ hoặc dùng ▲▼ để đổi thứ tự.</span>
        <button type="button" class="btn btn-secondary" data-action="layer-add">+ Thêm lớp</button>
      </div>
      ${layersHtml}
      <div style="margin-top:10px;">
        <button type="button" class="btn btn-primary" data-action="save">💾 Lưu preset</button>
        ${dirty ? '<span style="margin-left:10px;color:#c05621;font-size:13px;">● có thay đổi chưa lưu</span>' : ""}
      </div>

      <div class="composer-section">
        <h3>Render thử</h3>
        <div class="composer-layer-grid">
          <div>
            <label>Thư mục Overlay</label>
            <div class="folder-select">
              <div class="folder-input-wrap"><input type="text" readonly id="composer-rt-overlay" value="${esc(renderTestState.overlayFolder)}"></div>
              <button type="button" class="btn btn-secondary" data-action="pick-rt-overlay-folder">Chọn…</button>
            </div>
          </div>
          <div>
            <label>Thư mục Background (phải có thư mục con theo số ngày, vd backgrounds/1/)</label>
            <div class="folder-select">
              <div class="folder-input-wrap"><input type="text" readonly id="composer-rt-background" value="${esc(renderTestState.backgroundFolder)}"></div>
              <button type="button" class="btn btn-secondary" data-action="pick-rt-background-folder">Chọn…</button>
            </div>
          </div>
          <div>
            <label>Thư mục Output</label>
            <div class="folder-select">
              <div class="folder-input-wrap"><input type="text" readonly id="composer-rt-output" value="${esc(renderTestState.outputFolder)}"></div>
              <button type="button" class="btn btn-secondary" data-action="pick-rt-output-folder">Chọn…</button>
            </div>
          </div>
          <div><label>Số ngày</label><input type="number" min="1" id="composer-rt-day" value="1"></div>
          <div><label>Số video mỗi folder</label><input type="number" min="1" id="composer-rt-videos" value="1"></div>
          <div><label>Tốc độ video</label><input type="number" min="0.1" step="0.01" id="composer-rt-speed" value="0.95"></div>
          <div style="display:flex;align-items:flex-end;">
            <label style="display:flex;align-items:center;gap:8px;font-weight:normal;"><input type="checkbox" id="composer-rt-gpu"> Dùng GPU (NVENC)</label>
          </div>
        </div>
        <div style="margin-top:12px;"><button type="button" class="btn btn-primary" data-action="render-test">▶ Render thử</button></div>
        <pre id="composer-rendertest-log" class="output" style="display:block;height:220px;"></pre>
      </div>
    `;
  }

  // ── actions: preset ────────────────────────────────────────────────────────────────────
  async function refreshList() {
    if (!api()) return;
    const res = await api().list();
    presetNames = res.names || [];
    const warnEl = document.getElementById("composer-list-warnings");
    if (warnEl) {
      warnEl.innerHTML = (res.warnings && res.warnings.length)
        ? `<div class="composer-warnings"><strong>Cảnh báo khi nạp preset dựng sẵn:</strong><ul>${res.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>`
        : "";
    }
    renderSidebar();
    if (!currentName && !preset && presetNames.length) await selectPreset(presetNames[0]);
  }

  async function selectPreset(name) {
    const loaded = await api().load(name);
    if (!loaded) { alert(`Không đọc được preset "${name}".`); return; }
    currentName = name;
    preset = loaded;
    dirty = false;
    validation = null;
    renderSidebar();
    renderEditor();
  }

  function onNewPreset() {
    currentName = null;
    preset = blankPreset();
    dirty = true;
    validation = null;
    renderSidebar();
    renderEditor();
  }

  function onDuplicate() {
    if (!preset) return;
    const clone = JSON.parse(JSON.stringify(preset));
    clone.name = `${clone.name || "preset"}-copy`;
    currentName = null; // bản nhân bản coi như preset mới, chưa gắn với file nào
    preset = clone;
    dirty = true;
    validation = null;
    renderSidebar();
    renderEditor();
  }

  async function onDelete() {
    if (!preset) return;
    if (!currentName) {
      // Preset mới chưa từng lưu — không có file để xoá, chỉ cần bỏ khỏi bộ nhớ.
      preset = null; dirty = false; validation = null; renderEditor(); return;
    }
    if (!confirm(`Xoá preset "${currentName}"? Không thể hoàn tác.`)) return;
    const res = await api().delete(currentName);
    if (!res.ok) { alert(`Không xoá được: ${res.error}`); return; }
    currentName = null; preset = null; dirty = false; validation = null;
    await refreshList();
    renderEditor();
  }

  async function onSave() {
    if (!preset) return;
    const v = await api().validate(preset);
    validation = v;
    if (!v.ok) { renderEditor(); return; }
    const res = await api().save(preset);
    if (!res.ok) { validation = { ok: false, errors: res.errors || ["lỗi không rõ khi lưu"] }; renderEditor(); return; }
    currentName = preset.name;
    dirty = false;
    validation = { ok: true, errors: [] };
    await refreshList();
    renderEditor();
  }

  // ── actions: lớp / treatment ───────────────────────────────────────────────────────────
  function moveLayer(index, dir) {
    const j = index + dir;
    if (!preset || j < 0 || j >= preset.layers.length) return;
    const [item] = preset.layers.splice(index, 1);
    preset.layers.splice(j, 0, item);
    dirty = true;
    renderEditor();
  }
  function removeLayer(index) {
    if (!preset) return;
    preset.layers.splice(index, 1);
    dirty = true;
    renderEditor();
  }
  function addLayer() {
    if (!preset) return;
    preset.layers.push(newLayer("image"));
    dirty = true;
    renderEditor();
  }
  function addTreatment(layerIndex, kind) {
    if (!preset) return;
    const l = preset.layers[layerIndex];
    l.treatments = l.treatments || [];
    l.treatments.push(newTreatment(kind));
    dirty = true;
    renderEditor();
  }
  function removeTreatment(layerIndex, tIndex) {
    if (!preset) return;
    preset.layers[layerIndex].treatments.splice(tIndex, 1);
    dirty = true;
    renderEditor();
  }
  async function pickLayerPath(index) {
    const p = await api().pickAsset({ kind: "any" });
    if (p) { preset.layers[index].source.path = p; dirty = true; renderEditor(); }
  }
  async function pickInto(stateObj, key, options) {
    const p = await api().pickAsset(options);
    if (p) { stateObj[key] = p; renderEditor(); }
  }

  // ── actions: xem thử / render thử ──────────────────────────────────────────────────────
  async function onPreview() {
    const out = document.getElementById("composer-preview-result");
    if (!preset || !out) return;
    const atSecond = Number(document.getElementById("composer-preview-second")?.value || 0);
    out.innerHTML = "<em>Đang xuất khung hình…</em>";
    const res = await api().previewFrame({
      preset, overlayFile: previewState.overlayFile, backgroundFile: previewState.backgroundFile, atSecond,
    });
    if (!res.ok) {
      out.innerHTML = `<div class="composer-errors"><strong>Không xem được:</strong><ul>${(res.errors || []).map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`;
      return;
    }
    const warn = (res.warnings || []).length
      ? `<div class="composer-warnings"><strong>Cảnh báo:</strong><ul>${res.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>`
      : "";
    // Đường dẫn Windows "C:\...\file.png" -> file URL "file:///C:/.../file.png" (toFileUrl(),
    // dùng chung với <img> của lớp "image" trên canvas — xem phần Giai đoạn 2B phía trên). Mỗi
    // lần xem thử đều ra một file PNG MỚI (tên có Date.now(), xem composer-ipc.js) nên không cần
    // cache-bust, nhưng vẫn không hại gì nếu thêm.
    const url = `${toFileUrl(res.framePath)}?t=${Date.now()}`;
    out.innerHTML = `${warn}<img class="composer-preview-frame" src="${url}" alt="Khung xem thử">`;
  }

  async function onRenderTest() {
    const log = document.getElementById("composer-rendertest-log");
    if (!preset) return;
    if (log) log.textContent = "";
    api().removeRenderTestLogListener();
    api().onRenderTestLog((line) => { if (log) { log.textContent += line; log.scrollTop = log.scrollHeight; } });
    const res = await api().renderTest({
      preset,
      overlayFolder: renderTestState.overlayFolder,
      backgroundFolder: renderTestState.backgroundFolder,
      outputFolder: renderTestState.outputFolder,
      videos: Number(document.getElementById("composer-rt-videos")?.value || 1),
      day: Number(document.getElementById("composer-rt-day")?.value || 1),
      videoSpeed: Number(document.getElementById("composer-rt-speed")?.value || 0.95),
      useGPU: Boolean(document.getElementById("composer-rt-gpu")?.checked),
    });
    if (log) log.textContent += res.ok ? "\n✅ Render thử hoàn tất.\n" : `\n❌ ${res.error}\n`;
  }

  // ── sự kiện dùng chung (delegate trên #composer) ───────────────────────────────────────
  // Áp giá trị một ô input/select vào preset trong bộ nhớ — TÁCH khỏi onEditorChange để dùng lại
  // được cho cả "input" (gõ tới đâu cập nhật canvas tới đó) lẫn "change" (blur/chọn xong), không
  // phải viết 2 lần logic đọc t.type/t.dataset.kind. Trả về null nếu không có gì để áp (không có
  // data-path, hoặc chưa có preset đang mở).
  function applyFieldChange(t) {
    const p = t.dataset.path;
    if (!p || !preset) return null;

    // Đổi "kind" của một treatment: THAY hẳn bằng bộ tham số mặc định của kind mới, không
    // giữ tham số cũ lại (vd còn sót "sigma" khi vừa đổi từ blur sang opacity).
    const treatmentKindMatch = /^layers\.(\d+)\.treatments\.(\d+)\.kind$/.exec(p);
    if (treatmentKindMatch) {
      const [, li, ti] = treatmentKindMatch;
      preset.layers[Number(li)].treatments[Number(ti)] = newTreatment(t.value);
      dirty = true;
      return { structural: true };
    }

    let value;
    if (t.type === "checkbox") value = t.checked;
    else if (t.dataset.kind === "csv") value = t.value.split(",").map((s) => s.trim()).filter(Boolean);
    else value = t.value;

    setPath(preset, p, value);
    dirty = true;
    return { structural: t.dataset.structural === "1" };
  }

  function onEditorChange(e) {
    const res = applyFieldChange(e.target);
    if (!res) return;
    // Structural (source.type/fit/treatment.kind/blend): bố cục panel đổi hẳn (hiện/ẩn field
    // khác) nên phải dựng lại toàn bộ — renderEditor() tự vẽ lại canvas mới nhất kèm theo.
    // Không structural (label/đường dẫn/dx/dy/anchor…): canvas VẪN phải khớp NGAY theo đúng yêu
    // cầu "sửa số trong bảng thì canvas vẽ lại ngay" — chỉ vẽ lại canvas, giữ nguyên focus của ô
    // vừa sửa trong bảng.
    if (res.structural) renderEditor();
    else renderCanvasOnly();
  }

  // "input" bắn liên tục lúc gõ (khác "change" chỉ bắn lúc rời khỏi ô) — chỉ xử lý ô ảnh hưởng
  // trực tiếp tới hình vẽ trên canvas (geometry.*) để canvas cập nhật NGAY trong lúc gõ, không
  // phải đợi blur. Gọi applyFieldChange() lại lúc "change" (blur) là VÔ HẠI — cùng giá trị cuối
  // cùng được ghi lần nữa, không phải xử lý hai lần theo hai đường khác nhau.
  function onEditorInput(e) {
    const t = e.target;
    const p = t.dataset.path;
    if (!p || !preset || t.dataset.structural === "1" || !/\.geometry\./.test(p)) return;
    applyFieldChange(t);
    renderCanvasOnly();
  }

  // Gõ/chọn vào một field bất kỳ trong 1 layer-card thì tô sáng đúng lớp đó trên canvas — nửa
  // còn lại của đồng bộ 2 chiều (nửa kia là onCanvasBoxMouseDown chọn lớp trên canvas).
  function onEditorFocusIn(e) {
    const card = e.target.closest(".composer-layer-card");
    if (!card) return;
    selectLayer(Number(card.dataset.layerIndex), false);
  }

  // mousedown gộp CHUNG cho 2 việc bắt đầu kéo bằng chuột: kéo lớp trên canvas (di chuyển/resize)
  // và kéo tay cầm ⠿ để đổi thứ tự lớp trong danh sách — cả hai đều cần theo dõi mousemove/mouseup
  // trên toàn document (chuột có thể ra khỏi phần tử ban đầu khi kéo), nên không dùng "click".
  function onEditorMouseDown(e) {
    const handle = e.target.closest('[data-action="layer-drag-handle"]');
    if (handle) { startLayerReorderDrag(e, Number(handle.dataset.layerIndex)); return; }
    const box = e.target.closest(".composer-canvas-layer");
    if (box) { onCanvasBoxMouseDown(e, box); return; }
  }

  function onEditorClick(e) {
    // Bấm vào bất kỳ đâu trong 1 layer-card (kể cả không trúng nút) cũng chọn lớp đó — chọn
    // xong vẫn để action bên dưới chạy tiếp bình thường (vd vừa chọn vừa bấm ✕ xoá).
    const card = e.target.closest(".composer-layer-card");
    if (card) selectLayer(Number(card.dataset.layerIndex), false);

    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const li = btn.dataset.layerIndex !== undefined ? Number(btn.dataset.layerIndex) : undefined;
    const ti = btn.dataset.treatmentIndex !== undefined ? Number(btn.dataset.treatmentIndex) : undefined;
    if (action === "layer-up") moveLayer(li, -1);
    else if (action === "layer-down") moveLayer(li, 1);
    else if (action === "layer-remove") removeLayer(li);
    else if (action === "layer-add") addLayer();
    else if (action === "treatment-add") addTreatment(li, btn.dataset.kind || "opacity");
    else if (action === "treatment-remove") removeTreatment(li, ti);
    else if (action === "pick-layer-path") pickLayerPath(li);
    else if (action === "save") onSave();
    else if (action === "preview") onPreview();
    else if (action === "render-test") onRenderTest();
    else if (action === "pick-preview-overlay") pickInto(previewState, "overlayFile", { kind: "file" });
    else if (action === "pick-preview-background") pickInto(previewState, "backgroundFile", { kind: "file" });
    else if (action === "pick-rt-overlay-folder") pickInto(renderTestState, "overlayFolder", { kind: "folder" });
    else if (action === "pick-rt-background-folder") pickInto(renderTestState, "backgroundFolder", { kind: "folder" });
    else if (action === "pick-rt-output-folder") pickInto(renderTestState, "outputFolder", { kind: "folder" });
  }

  // ── dựng lười ───────────────────────────────────────────────────────────────────────────
  function ensureBuilt() {
    if (built) return;
    const root = document.getElementById(TAB_ID);
    if (!root) return; // renderer.html chưa có div#composer — không có gì để dựng vào.
    built = true;
    injectStyles();
    root.innerHTML = SHELL_HTML;
    root.addEventListener("change", onEditorChange);
    root.addEventListener("input", onEditorInput);
    root.addEventListener("click", onEditorClick);
    root.addEventListener("mousedown", onEditorMouseDown);
    root.addEventListener("focusin", onEditorFocusIn);
    document.getElementById("composer-new")?.addEventListener("click", onNewPreset);
    document.getElementById("composer-duplicate")?.addEventListener("click", onDuplicate);
    document.getElementById("composer-delete")?.addEventListener("click", onDelete);
    renderEditor();
    refreshList();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.querySelector('.tab-button[data-tab="composer"]');
    if (btn) btn.addEventListener("click", ensureBuilt);
    // Phòng khi tab composer lỡ "active" sẵn lúc tải trang (không phải kịch bản mặc định của
    // renderer.html hiện tại, nơi tab "render" mới là active) — vẫn dựng ngay, không đợi click.
    const tabEl = document.getElementById(TAB_ID);
    if (tabEl && tabEl.classList.contains("active")) ensureBuilt();
  });
})();
