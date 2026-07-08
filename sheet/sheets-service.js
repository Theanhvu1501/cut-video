import { google } from "googleapis";
import fs from "fs";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

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

// Trống/không rõ = false (khác truthy: trống = true, dùng cho các cột bật/tắt tùy chọn)
function boolFalse(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

export function parseConfigRows(values) {
  if (!Array.isArray(values) || !values.length) return [];
  // Tìm dòng header: dòng đầu tiên có ô "sheetName" (bỏ qua dòng nhóm-mode phía trên nếu có).
  let hIdx = values.findIndex((row) =>
    Array.isArray(row) && row.some((c) => String(c ?? "").trim().toLowerCase() === "sheetname"));
  if (hIdx < 0) hIdx = 0;
  const header = (values[hIdx] || []).map((h) => String(h ?? "").trim().toLowerCase());
  const idx = (name) => header.indexOf(name.toLowerCase());
  const col = (row, name) => {
    const i = idx(name);
    return i >= 0 ? String(row[i] ?? "").trim() : "";
  };
  const out = [];
  for (let r = hIdx + 1; r < values.length; r++) {
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
    const keepCropRaw = col(row, "keepCrop");
    if (keepCropRaw) cfg.keepCrop = boolFalse(keepCropRaw);
    const keepHeight = num(col(row, "keepHeight"));
    if (keepHeight !== undefined) cfg.keepHeight = keepHeight;
    const keepYOffset = num(col(row, "keepYOffset"));
    if (keepYOffset !== undefined) cfg.keepYOffset = keepYOffset;
    const keepSimilarity = num(col(row, "keepSimilarity"));
    if (keepSimilarity !== undefined) cfg.keepSimilarity = keepSimilarity;
    const keepAddDarkLayerRaw = col(row, "keepAddDarkLayer");
    if (keepAddDarkLayerRaw) cfg.keepAddDarkLayer = boolFalse(keepAddDarkLayerRaw);
    const cropHeight = num(col(row, "cropHeight"));
    if (cropHeight !== undefined) cfg.cropHeight = cropHeight;
    const cropYOffset = num(col(row, "cropYOffset"));
    if (cropYOffset !== undefined) cfg.cropYOffset = cropYOffset;
    const chromaPalette = col(row, "chromaPalette")
      .split(",")
      .map((p) => p.trim().replace("#", "").toUpperCase())
      .filter((p) => /^[0-9A-F]{6}$/.test(p));
    const channel = {
      sheetName,
      enabled: truthy(col(row, "enabled")),
      videosPerDay: num(col(row, "videosPerDay")) || 0,
      renderMode: col(row, "renderMode") || "topTransparent",
      cfg,
      proxy: col(row, "proxy"),
    };
    if (chromaPalette.length) channel.chromaPalette = chromaPalette;
    out.push(channel);
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

export function createSheetsClient(credentialsPath) {
  if (!fs.existsSync(credentialsPath))
    throw new Error(`Không tìm thấy file credentials: ${credentialsPath}`);
  const key = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
  const auth = new google.auth.GoogleAuth({ credentials: key, scopes: SCOPES });
  return google.sheets({ version: "v4", auth });
}

export async function listSheetTabs(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  return (res.data.sheets || []).map((s) => s.properties.title);
}

export async function readConfigSheet(sheets, spreadsheetId, configTab = "⚙config") {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${configTab}!A:Z` });
  return parseConfigRows(res.data.values || []);
}

export async function readChannelUrls(sheets, spreadsheetId, sheetName) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:B` });
  return parseUrlRows(res.data.values || []);
}

export async function setUrlStatus(sheets, spreadsheetId, sheetName, rowIndex, status) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!B${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [[status]] },
  });
}
