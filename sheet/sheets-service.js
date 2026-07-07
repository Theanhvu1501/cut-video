function truthy(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "") return true; // trống = bật
  return s === "true" || s === "1" || s === "yes";
}

function num(v) {
  const s = String(v ?? "").trim();
  if (s === "") return undefined;
  const n = parseFloat(s);
  return Number.isNaN(n) ? undefined : n;
}

export function parseConfigRows(values) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const header = values[0].map((h) => String(h ?? "").trim().toLowerCase());
  const idx = (name) => header.indexOf(name.toLowerCase());
  const col = (row, name) => {
    const i = idx(name);
    return i >= 0 ? String(row[i] ?? "").trim() : "";
  };
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    const sheetName = col(row, "sheetName");
    if (!sheetName) continue;
    const cfg = {};
    const opacity = num(col(row, "opacity"));
    if (opacity !== undefined) cfg.opacity = opacity;
    const chromaColor = col(row, "chromaColor");
    if (chromaColor) cfg.chromaColor = chromaColor;
    const chromaSim = num(col(row, "chromaSimilarity"));
    if (chromaSim !== undefined) cfg.chromaSimilarity = chromaSim;
    const keepColors = col(row, "keepColors");
    if (keepColors) cfg.keepColors = keepColors.split(",").map((s) => s.trim()).filter(Boolean);
    const cropHeight = num(col(row, "cropHeight"));
    if (cropHeight !== undefined) cfg.cropHeight = cropHeight;
    const cropYOffset = num(col(row, "cropYOffset"));
    if (cropYOffset !== undefined) cfg.cropYOffset = cropYOffset;
    out.push({
      sheetName,
      enabled: truthy(col(row, "enabled")),
      videosPerDay: num(col(row, "videosPerDay")) || 0,
      renderMode: col(row, "renderMode") || "topTransparent",
      cfg,
      proxy: col(row, "proxy"),
    });
  }
  return out;
}

export function parseUrlRows(values) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    const url = String(row[0] ?? "").trim();
    if (r === 0 && !/https?:\/\//i.test(url)) continue; // dòng header
    if (!url) continue;
    out.push({ rowIndex: r + 1, url, status: String(row[1] ?? "").trim() });
  }
  return out;
}
