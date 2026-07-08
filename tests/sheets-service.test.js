import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfigRows, parseUrlRows, testSheetConnection } from "../sheet/sheets-service.js";
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
    cfg: { opacity: 0.7 }, proxy: "",
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
