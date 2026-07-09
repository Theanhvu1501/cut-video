// Chẩn đoán tab ⚙config: in ra ĐÚNG thứ app nhìn thấy, để biết vì sao một cột
// không được nhận. Chỉ đọc, không ghi gì vào Sheet, không gọi YouTube API.
//
// Dùng:
//   node sheet/diag-config.js <đường-dẫn-credentials.json> <spreadsheetId>

import {
  createSheetsClient, readConfigValues, parseConfigRows, findStatsColumns, STATS_KEYS, colLetter,
} from "./sheets-service.js";

const [credentialsPath, spreadsheetId] = process.argv.slice(2);
if (!credentialsPath || !spreadsheetId) {
  console.error("Thiếu tham số. Dùng:");
  console.error("  node sheet/diag-config.js <credentials.json> <spreadsheetId>");
  process.exit(1);
}

const sheets = createSheetsClient(credentialsPath);
const values = await readConfigValues(sheets, spreadsheetId);

console.log(`Đọc được ${values.length} dòng từ ⚙config!A:AZ\n`);

const channels = parseConfigRows(values);
const { headerRowIndex, cols } = findStatsColumns(values);

if (headerRowIndex < 0) {
  console.log('❌ KHÔNG tìm thấy dòng header (dòng chứa ô "Tên kênh").');
  console.log('   App tìm ô khớp CHÍNH XÁC "Tên kênh" sau khi bỏ dấu/hạ chữ thường.');
} else {
  console.log(`Dòng header = dòng ${headerRowIndex + 1} trong Sheet.`);
}

// In từng ô của dòng nhóm (nếu có) và dòng header, kèm chữ cái cột.
const show = (label, r) => {
  if (r < 0 || !values[r]) return;
  console.log(`\n${label} (dòng ${r + 1}):`);
  values[r].forEach((c, i) => {
    const t = String(c ?? "").trim();
    if (t) console.log(`  ${colLetter(i).padStart(2)} | ${t}`);
  });
};
show("Dòng nhóm-mode phía trên", headerRowIndex - 1);
show("Dòng header", headerRowIndex);

console.log("\n--- Cột stats app tìm thấy ---");
for (const k of STATS_KEYS) {
  console.log(cols[k] === undefined
    ? `  ${k.padEnd(15)} ❌ KHÔNG thấy`
    : `  ${k.padEnd(15)} ✅ cột ${colLetter(cols[k])}`);
}

console.log("\n--- Kênh đọc được ---");
if (!channels.length) console.log("  (không kênh nào — dòng header sai?)");
for (const c of channels) {
  console.log(`  dòng ${c.rowIndex}: "${c.sheetName}"`);
  console.log(`      Link kênh    : ${c.channelUrl || "❌ TRỐNG"}`);
  console.log(`      @handle nguồn: ${c.sourceHandle || "❌ TRỐNG"}`);
  console.log(`      Giờ đăng     : ${c.postTimes || "(trống)"}`);
}
