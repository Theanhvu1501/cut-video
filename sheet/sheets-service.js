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

// Chuẩn hoá tên cột: bỏ dấu tiếng Việt, đổi đ->d, hạ chữ thường, gộp khoảng trắng.
function norm(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "d")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// canonical (tên máy) -> danh sách tên hiển thị tiếng Việt được chấp nhận.
const HEADER_ALIASES = {
  sheetName: ["tên kênh"],
  enabled: ["bật", "kích hoạt"],
  videosPerDay: ["video mỗi ngày", "số video mỗi ngày"],
  renderMode: ["kiểu render", "chế độ render"],
  chromaPalette: ["bảng màu tự dò", "palette"],
  chromaColor: ["màu phông", "màu chroma"],
  chromaSimilarity: ["độ nhạy chroma"],
  opacity: ["độ mờ"],
  keepColors: ["màu giữ lại"],
  keepCrop: ["bật cắt (giữ màu)", "cắt (giữ màu)"],
  keepHeight: ["chiều cao cắt (giữ màu)"],
  keepYOffset: ["vị trí y (giữ màu)"],
  keepSimilarity: ["độ nhạy giữ màu"],
  keepAddDarkLayer: ["lớp nền tối"],
  cropHeight: ["chiều cao cắt"],
  cropYOffset: ["vị trí y cắt"],
  proxy: ["proxy tải", "proxy"],
  gpmProfileId: ["gpm profile id", "gpm", "profile gpm"],
  postTimes: ["giờ đăng", "lịch đăng", "post times", "giờ post"],
  channelUrl: ["link kênh", "url kênh"],
  sourceHandle: ["@handle nguồn", "handle nguồn", "kênh nguồn"],
  subscribers: ["sub", "subs", "người đăng ký"],
  totalViews: ["tổng view", "tổng lượt xem"],
  videoCount: ["số video"],
  statsUpdatedAt: ["cập nhật lúc"],
};

function acceptedNorms(canonical) {
  return [norm(canonical), ...(HEADER_ALIASES[canonical] || []).map(norm)];
}

export function parseConfigRows(values) {
  if (!Array.isArray(values) || !values.length) return [];
  // Tìm dòng header: dòng đầu tiên có ô khớp tên "sheetName" (Anh hoặc Việt),
  // bỏ qua dòng nhóm-mode phía trên nếu có.
  const snNorms = acceptedNorms("sheetName");
  let hIdx = values.findIndex((row) =>
    Array.isArray(row) && row.some((c) => snNorms.includes(norm(c))));
  if (hIdx < 0) hIdx = 0;
  const headerRow = values[hIdx] || [];
  const idx = (name) => {
    const accepted = acceptedNorms(name);
    return headerRow.findIndex((c) => accepted.includes(norm(c)));
  };
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
      gpmProfileId: col(row, "gpmProfileId"),
      postTimes: col(row, "postTimes"),
      rowIndex: r + 1, // 1-based, dùng thẳng trong A1 notation
      channelUrl: col(row, "channelUrl"),
      sourceHandle: col(row, "sourceHandle"),
    };
    if (chromaPalette.length) channel.chromaPalette = chromaPalette;
    out.push(channel);
  }
  return out;
}

export const STATS_KEYS = ["subscribers", "totalViews", "videoCount", "statsUpdatedAt"];

// Tìm chỉ số cột (0-based) của 4 cột stats. Cột không có trong Sheet thì vắng
// mặt trong `cols` — app không bao giờ tự tạo cột.
export function findStatsColumns(values) {
  if (!Array.isArray(values) || !values.length) return { headerRowIndex: -1, cols: {} };
  const snNorms = acceptedNorms("sheetName");
  const hIdx = values.findIndex((row) =>
    Array.isArray(row) && row.some((c) => snNorms.includes(norm(c))));
  if (hIdx < 0) return { headerRowIndex: -1, cols: {} };
  const headerRow = values[hIdx] || [];
  const cols = {};
  for (const name of STATS_KEYS) {
    const accepted = acceptedNorms(name);
    const i = headerRow.findIndex((c) => accepted.includes(norm(c)));
    if (i >= 0) cols[name] = i;
  }
  return { headerRowIndex: hIdx, cols };
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

// Đọc thô tab ⚙config. Range A:AZ (không phải A:Z) vì bảng cấu hình đã có 24 cột.
export async function readConfigValues(sheets, spreadsheetId, configTab = "⚙config") {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${configTab}!A:AZ` });
  return res.data.values || [];
}

export async function readConfigSheet(sheets, spreadsheetId, configTab = "⚙config") {
  return parseConfigRows(await readConfigValues(sheets, spreadsheetId, configTab));
}

// Kiểm tra kết nối: đọc danh sách tab + tab ⚙config, trả về tóm tắt.
export async function testSheetConnection(sheets, spreadsheetId) {
  const tabs = await listSheetTabs(sheets, spreadsheetId);
  const channels = await readConfigSheet(sheets, spreadsheetId);
  return {
    tabs,
    channelCount: channels.length,
    enabledCount: channels.filter((c) => c.enabled).length,
    hasConfigTab: tabs.includes("⚙config"),
  };
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

// Đọc cột A (url) + C (trạng thái upload) của tab kênh → [{ url, uploadStatus }].
// Dùng làm nguồn sự thật cho việc lên lịch (thay file JSON).
export async function readUploadStatuses(sheets, spreadsheetId, sheetName) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:C` });
  const rows = res.data.values || [];
  const out = [];
  for (let r = 0; r < rows.length; r++) {
    const url = String(rows[r]?.[0] ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue; // bỏ dòng header/không phải url
    out.push({ url, uploadStatus: String(rows[r]?.[2] ?? "").trim() });
  }
  return out;
}

// Ghi trạng thái upload (các bước GPM) vào cột C của tab kênh, tách khỏi cột B (trạng thái render).
export async function setUploadStatus(sheets, spreadsheetId, sheetName, rowIndex, status) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!C${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [[status]] },
  });
}
