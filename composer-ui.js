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

    return `
    <div class="composer-layer-card" data-layer-index="${index}">
      <div class="composer-layer-head">
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
          <select data-path="${base}.blend">
            ${BLEND_MODES.map((b) => `<option value="${b}" ${(layer.blend || "normal") === b ? "selected" : ""}>${b}</option>`).join("")}
          </select>
        </div>
      </div>
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
      <div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0 16px;flex-wrap:wrap;gap:8px;">
        <span style="font-weight:600;color:#2d3748;">Lớp — xếp theo thứ tự dưới → trên (#0 dưới cùng, cuối cùng trên cùng): ${preset.layers.length}</span>
        <button type="button" class="btn btn-secondary" data-action="layer-add">+ Thêm lớp</button>
      </div>
      ${layersHtml}
      <div style="margin-top:10px;">
        <button type="button" class="btn btn-primary" data-action="save">💾 Lưu preset</button>
        ${dirty ? '<span style="margin-left:10px;color:#c05621;font-size:13px;">● có thay đổi chưa lưu</span>' : ""}
      </div>

      <div class="composer-section">
        <h3>Xem thử 1 khung hình</h3>
        <div class="info-box">
          <p><strong>Hai điều KHÔNG phải lỗi khi xem thử:</strong></p>
          <p>1) Ảnh xuất ra không thể hiện tốc độ video (videoSpeed / setpts, atempo) — bước đó chỉ được chèn khi render video thật.</p>
          <p>2) Waveform vẽ theo đúng đoạn âm thanh TẠI giây đang xem — xem ở giây khác ra hình sóng khác là bình thường, không phải lỗi.</p>
        </div>
        <div class="composer-layer-grid">
          <div>
            <label>Video gốc (overlay) để xem thử</label>
            <div class="folder-select">
              <div class="folder-input-wrap"><input type="text" readonly id="composer-preview-overlay" value="${esc(previewState.overlayFile)}"></div>
              <button type="button" class="btn btn-secondary" data-action="pick-preview-overlay">Chọn…</button>
            </div>
          </div>
          <div>
            <label>Video nền (background) để xem thử</label>
            <div class="folder-select">
              <div class="folder-input-wrap"><input type="text" readonly id="composer-preview-background" value="${esc(previewState.backgroundFile)}"></div>
              <button type="button" class="btn btn-secondary" data-action="pick-preview-background">Chọn…</button>
            </div>
          </div>
          <div>
            <label>Tại giây thứ</label>
            <input type="number" min="0" step="0.5" id="composer-preview-second" value="0">
          </div>
        </div>
        <div style="margin-top:12px;"><button type="button" class="btn btn-primary" data-action="preview">🖼 Xem thử 1 khung</button></div>
        <div id="composer-preview-result" style="margin-top:12px;"></div>
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
    // Đường dẫn Windows "C:\...\file.png" -> file URL "file:///C:/.../file.png". Mỗi lần xem
    // thử đều ra một file PNG MỚI (tên có Date.now(), xem composer-ipc.js) nên không cần
    // cache-bust, nhưng vẫn không hại gì nếu thêm.
    const normalized = String(res.framePath).replace(/\\/g, "/");
    const url = `file:///${normalized.replace(/^\/+/, "")}?t=${Date.now()}`;
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
  function onEditorChange(e) {
    const t = e.target;
    const p = t.dataset.path;
    if (!p || !preset) return;

    // Đổi "kind" của một treatment: THAY hẳn bằng bộ tham số mặc định của kind mới, không
    // giữ tham số cũ lại (vd còn sót "sigma" khi vừa đổi từ blur sang opacity).
    const treatmentKindMatch = /^layers\.(\d+)\.treatments\.(\d+)\.kind$/.exec(p);
    if (treatmentKindMatch) {
      const [, li, ti] = treatmentKindMatch;
      preset.layers[Number(li)].treatments[Number(ti)] = newTreatment(t.value);
      dirty = true;
      renderEditor();
      return;
    }

    let value;
    if (t.type === "checkbox") value = t.checked;
    else if (t.dataset.kind === "csv") value = t.value.split(",").map((s) => s.trim()).filter(Boolean);
    else value = t.value;

    setPath(preset, p, value);
    dirty = true;
    if (t.dataset.structural === "1") renderEditor();
  }

  function onEditorClick(e) {
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
    root.addEventListener("click", onEditorClick);
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
