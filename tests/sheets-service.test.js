import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfigRows, parseUrlRows, testSheetConnection, findStatsColumns, STATS_KEYS, writeChannelStats, appendUrls, colLetter } from "../sheet/sheets-service.js";
import { pickDownloadedFile } from "../sheet/channel-download.js";

const HEADER = ["sheetName","enabled","videosPerDay","renderMode","opacity","chromaColor","chromaSimilarity","keepColors","cropHeight","cropYOffset","proxy"];

test("parseConfigRows maps columns and defaults enabled=true when blank", () => {
  const rows = [HEADER,
    ["Kênh A","TRUE","3","topTransparent","0.7","","","","","",""],
    ["Kênh B","","5","chromaKey","","D4F9D7","0.3","","","","socks5://1.2.3.4:1080"],
    ["Kênh C","FALSE","2","keepColor","","","","F6FF00, FBFF02","150","550",""],
  ];
  const out = parseConfigRows(rows);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], {
    sheetName: "Kênh A", enabled: true, videosPerDay: 3, renderMode: "topTransparent",
    cfg: { opacity: 0.7 }, proxy: "", gpmProfileId: "", postTimes: "",
    rowIndex: 2, channelUrl: "", sourceHandle: "",
  });
  assert.equal(out[1].enabled, true);
  assert.equal(out[1].proxy, "socks5://1.2.3.4:1080");
  assert.deepEqual(out[1].cfg, { chromaColor: "D4F9D7", chromaSimilarity: 0.3 });
  assert.equal(out[2].enabled, false);
  assert.deepEqual(out[2].cfg, { keepColors: ["F6FF00", "FBFF02"], cropHeight: 150, cropYOffset: 550 });
});

test("parseConfigRows accepts Vietnamese header names (with/without accents)", () => {
  const header = ["Tên kênh","Bật","Video mỗi ngày","Kiểu render","Bảng màu tự dò","Màu phông","Độ nhạy chroma","Độ mờ","Màu giữ lại","Bật cắt (giữ màu)","Chiều cao cắt (giữ màu)","Vị trí Y (giữ màu)","Độ nhạy giữ màu","Lớp nền tối","Chiều cao cắt","Vị trí Y cắt","Proxy tải"];
  const rows = [header,
    ["Kenh_A","","5","chromaKeyAuto","22BDD6,2B4052","","0.3","","","","","","","","","",""],
    ["Kenh_D","false","2","keepColor","","","","","F6FF00","true","150","550","0.2","false","","",""],
  ];
  const out = parseConfigRows(rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].renderMode, "chromaKeyAuto");
  assert.deepEqual(out[0].chromaPalette, ["22BDD6","2B4052"]);
  assert.equal(out[0].cfg.chromaSimilarity, 0.3);
  assert.equal(out[1].enabled, false);
  assert.deepEqual(out[1].cfg, {
    keepColors: ["F6FF00"], keepCrop: true, keepHeight: 150,
    keepYOffset: 550, keepSimilarity: 0.2, keepAddDarkLayer: false,
  });
});

test("parseConfigRows accepts Vietnamese header without accents (ten kenh)", () => {
  const rows = [
    ["ten kenh","bat","video moi ngay","kieu render"],
    ["Kenh_X","","7","topTransparent"],
  ];
  const out = parseConfigRows(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].sheetName, "Kenh_X");
  assert.equal(out[0].videosPerDay, 7);
  assert.equal(out[0].renderMode, "topTransparent");
});

test("parseConfigRows skips a mode-group row above the header", () => {
  const groupRow = ["THÔNG TIN KÊNH","","","","keepColor","","crop"];
  const header = ["sheetName","enabled","videosPerDay","renderMode","keepColors","keepCrop","cropHeight"];
  const rows = [groupRow, header,
    ["Kênh A","","5","keepColor","F6FF00","true","150"],
  ];
  const out = parseConfigRows(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].sheetName, "Kênh A");
  assert.equal(out[0].renderMode, "keepColor");
});

test("parseConfigRows parses keepColor crop columns", () => {
  const header = ["sheetName","enabled","videosPerDay","renderMode","keepColors","keepCrop","keepHeight","keepYOffset","keepSimilarity","keepAddDarkLayer"];
  const rows = [header,
    ["Kênh A","","5","keepColor","F6FF00, FBFF02","true","150","550","0.2","false"],
    ["Kênh B","","5","keepColor","F6FF00","","","","",""],
  ];
  const out = parseConfigRows(rows);
  assert.deepEqual(out[0].cfg, {
    keepColors: ["F6FF00","FBFF02"], keepCrop: true, keepHeight: 150,
    keepYOffset: 550, keepSimilarity: 0.2, keepAddDarkLayer: false,
  });
  // ô trống -> không set (dùng mặc định của render-core)
  assert.deepEqual(out[1].cfg, { keepColors: ["F6FF00"] });
});

test("parseConfigRows parses chromaPalette and chromaKeyAuto mode", () => {
  const header = ["sheetName","enabled","videosPerDay","renderMode","chromaPalette"];
  const rows = [header,
    ["Kênh A","","5","chromaKeyAuto","22BDD6, 2b4052 , zzz, 7097B8"],
    ["Kênh B","","5","chromaKey",""],
  ];
  const out = parseConfigRows(rows);
  assert.equal(out[0].renderMode, "chromaKeyAuto");
  assert.deepEqual(out[0].chromaPalette, ["22BDD6", "2B4052", "7097B8"]);
  assert.equal("chromaPalette" in out[1], false);
});

test("parseConfigRows skips rows without sheetName", () => {
  const rows = [HEADER, ["","TRUE","3","topTransparent","","","","","","",""]];
  assert.equal(parseConfigRows(rows).length, 0);
});

test("parseUrlRows keeps 1-based index, skips blanks and header", () => {
  const rows = [
    ["URL","status"],
    ["https://youtu.be/a",""],
    ["",""],
    ["https://youtu.be/b","done"],
  ];
  const out = parseUrlRows(rows);
  assert.deepEqual(out, [
    { rowIndex: 2, url: "https://youtu.be/a", status: "" },
    { rowIndex: 4, url: "https://youtu.be/b", status: "done" },
  ]);
});

test("parseUrlRows treats first row as data if it is a URL", () => {
  const out = parseUrlRows([["https://youtu.be/x",""]]);
  assert.deepEqual(out, [{ rowIndex: 1, url: "https://youtu.be/x", status: "" }]);
});

test("testSheetConnection summarizes tabs and channels", async () => {
  const fakeSheets = {
    spreadsheets: {
      get: async () => ({ data: { sheets: [
        { properties: { title: "⚙config" } },
        { properties: { title: "Kenh_A" } },
      ] } }),
      values: { get: async () => ({ data: { values: [
        ["Tên kênh","Bật","Video mỗi ngày","Kiểu render"],
        ["Kenh_A","true","3","chromaKey"],
        ["Kenh_B","false","3","crop"],
      ] } }) },
    },
  };
  const info = await testSheetConnection(fakeSheets, "SID");
  assert.deepEqual(info.tabs, ["⚙config", "Kenh_A"]);
  assert.equal(info.channelCount, 2);
  assert.equal(info.enabledCount, 1);
  assert.equal(info.hasConfigTab, true);
});

test("pickDownloadedFile returns the new mp4", () => {
  const before = ["old.mp4"];
  const after = ["old.mp4", "New Title.mp4", "New Title.jpg"];
  assert.equal(pickDownloadedFile(before, after), "New Title.mp4");
});

test("pickDownloadedFile returns null when no new mp4", () => {
  assert.equal(pickDownloadedFile(["a.mp4"], ["a.mp4"]), null);
});

test("parseConfigRows đọc cột gpmProfileId qua alias tiếng Việt", () => {
  const rows = [
    ["Tên kênh", "Video mỗi ngày", "GPM Profile ID"],
    ["kenh-a", "2", "  abc123  "],
    ["kenh-b", "1", ""],
  ];
  const out = parseConfigRows(rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].gpmProfileId, "abc123");
  assert.equal(out[1].gpmProfileId, "");
});

test("parseConfigRows gpmProfileId rỗng khi không có cột", () => {
  const rows = [
    ["Tên kênh", "Video mỗi ngày"],
    ["kenh-a", "2"],
  ];
  const out = parseConfigRows(rows);
  assert.equal(out[0].gpmProfileId, "");
});

// Header có dòng nhóm-mode phía trên, đúng như Sheet thật.
const CONFIG_VALUES = [
  ["", "", "", "Nhóm render", "", ""],
  ["Tên kênh", "Bật", "Link kênh", "@handle nguồn", "Sub", "Tổng view", "Số video", "Cập nhật lúc"],
  ["Kênh A", "true", "https://www.youtube.com/@kenha", "@nguona", "1230", "45678", "120", "09/07/2026 14:32"],
  ["Kênh B", "true", "", "", "", "", "", ""],
];

test("parseConfigRows trả rowIndex, channelUrl, sourceHandle", () => {
  const rows = parseConfigRows(CONFIG_VALUES);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rowIndex, 3, "dòng 'Kênh A' là dòng thứ 3 trong Sheet (1-based)");
  assert.equal(rows[0].channelUrl, "https://www.youtube.com/@kenha");
  assert.equal(rows[0].sourceHandle, "@nguona");
  assert.equal(rows[1].rowIndex, 4);
  assert.equal(rows[1].channelUrl, "");
  assert.equal(rows[1].sourceHandle, "");
});

test("findStatsColumns tìm đủ 4 cột", () => {
  const { headerRowIndex, cols } = findStatsColumns(CONFIG_VALUES);
  assert.equal(headerRowIndex, 1);
  assert.deepEqual(cols, { subscribers: 4, totalViews: 5, videoCount: 6, statsUpdatedAt: 7 });
  assert.deepEqual(STATS_KEYS, ["subscribers", "totalViews", "videoCount", "statsUpdatedAt"]);
});

test("findStatsColumns bỏ qua cột thiếu", () => {
  const values = [["Tên kênh", "Bật", "Sub", "Số video"]];
  const { cols } = findStatsColumns(values);
  assert.deepEqual(cols, { subscribers: 2, videoCount: 3 });
});

test("findStatsColumns khi không có cột stats nào và khi không có header", () => {
  assert.deepEqual(findStatsColumns([["Tên kênh", "Bật"]]).cols, {});
  assert.deepEqual(findStatsColumns([["Linh tinh"]]), { headerRowIndex: -1, cols: {} });
  assert.deepEqual(findStatsColumns([]), { headerRowIndex: -1, cols: {} });
});

// Client Sheets giả: ghi lại mọi tham số của batchUpdate/append.
function fakeSheets() {
  const calls = { batchUpdate: [], append: [] };
  return {
    calls,
    spreadsheets: {
      values: {
        batchUpdate: async (p) => { calls.batchUpdate.push(p); return { data: {} }; },
        append: async (p) => { calls.append.push(p); return { data: {} }; },
      },
    },
  };
}

test("colLetter: 0->A, 25->Z, 26->AA, 51->AZ", () => {
  assert.equal(colLetter(0), "A");
  assert.equal(colLetter(25), "Z");
  assert.equal(colLetter(26), "AA");
  assert.equal(colLetter(51), "AZ");
});

test("writeChannelStats ghi đúng 4 ô vào đúng dòng", async () => {
  const sheets = fakeSheets();
  const cols = { subscribers: 4, totalViews: 5, videoCount: 6, statsUpdatedAt: 7 };
  const n = await writeChannelStats(sheets, "SID", "⚙config", 3, cols, {
    subscribers: 1230, views: 45678, videoCount: 120, hidden: false, updatedAt: "09/07/2026 14:32",
  });
  assert.equal(n, 4);
  const { data, valueInputOption } = sheets.calls.batchUpdate[0].requestBody;
  assert.equal(valueInputOption, "RAW");
  assert.deepEqual(data.map((d) => d.range), [
    "⚙config!E3", "⚙config!F3", "⚙config!G3", "⚙config!H3",
  ]);
  assert.deepEqual(data.map((d) => d.values[0][0]), [1230, 45678, 120, "09/07/2026 14:32"]);
});

test("writeChannelStats chỉ ghi các cột có thật, kênh ẩn sub ghi dấu gạch", async () => {
  const sheets = fakeSheets();
  const n = await writeChannelStats(sheets, "SID", "⚙config", 5, { subscribers: 2, videoCount: 9 }, {
    subscribers: null, views: 100, videoCount: 8, hidden: true, updatedAt: "09/07/2026 14:32",
  });
  assert.equal(n, 2);
  const { data } = sheets.calls.batchUpdate[0].requestBody;
  assert.deepEqual(data.map((d) => d.range), ["⚙config!C5", "⚙config!J5"]);
  assert.equal(data[0].values[0][0], "—");
  assert.equal(data[1].values[0][0], 8);
});

test("writeChannelStats không gọi API khi Sheet thiếu cả 4 cột", async () => {
  const sheets = fakeSheets();
  assert.equal(await writeChannelStats(sheets, "SID", "⚙config", 3, {}, { updatedAt: "x" }), 0);
  assert.equal(sheets.calls.batchUpdate.length, 0);
});

test("appendUrls nối vào cột A, không đụng cột B/C", async () => {
  const sheets = fakeSheets();
  const n = await appendUrls(sheets, "SID", "Kênh A", ["u1", "u2"]);
  assert.equal(n, 2);
  const p = sheets.calls.append[0];
  assert.equal(p.range, "Kênh A!A:A");
  assert.equal(p.insertDataOption, "INSERT_ROWS");
  assert.equal(p.valueInputOption, "RAW");
  assert.deepEqual(p.requestBody.values, [["u1"], ["u2"]]);
});

test("appendUrls không gọi API khi danh sách rỗng", async () => {
  const sheets = fakeSheets();
  assert.equal(await appendUrls(sheets, "SID", "Kênh A", []), 0);
  assert.equal(await appendUrls(sheets, "SID", "Kênh A", undefined), 0);
  assert.equal(sheets.calls.append.length, 0);
});

test("writeChannelStats không ghi ô khi giá trị undefined, nhưng ghi 0", async () => {
  const sheets = fakeSheets();
  const cols = { subscribers: 2, totalViews: 5, videoCount: 6 };
  // subscribers undefined, totalViews is 0 (should write), videoCount is 10 (should write)
  const n = await writeChannelStats(sheets, "SID", "⚙config", 3, cols, {
    subscribers: undefined, views: 0, videoCount: 10, hidden: false, updatedAt: "09/07/2026 14:32",
  });
  // Should write only totalViews (0) and videoCount (10), not subscribers (undefined)
  assert.equal(n, 2, "chỉ ghi 2 ô (totalViews + videoCount), không ghi subscribers undefined");
  const { data } = sheets.calls.batchUpdate[0].requestBody;
  assert.equal(data.length, 2);
  assert.deepEqual(data.map((d) => d.range), ["⚙config!F3", "⚙config!G3"]);
  assert.equal(data[0].values[0][0], 0, "totalViews: 0 IS written");
  assert.equal(data[1].values[0][0], 10, "videoCount: 10 IS written");
});
