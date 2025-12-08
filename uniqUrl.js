import fs from "fs";

// Đọc 2 file txt, tách thành mảng, loại bỏ dòng rỗng
const urls1 = fs
  .readFileSync("./channels/ch-hz9yz/youtube.txt", "utf-8")
  .split("\n")
  .map((u) => u.trim())
  .filter(Boolean);

const urls2 = fs
  .readFileSync("./channels/ch-hz9yz/youtubeSheet.txt", "utf-8")
  .split("\n")
  .map((u) => u.trim())
  .filter(Boolean);

// Tạo Set từ file2 để so sánh nhanh
const set2 = new Set(urls2);

// Lọc ra các URL trong file1 mà không có trong file2
const uniqueUrls = urls1.filter((u) => !set2.has(u));

// Ghi ra file url.txt
fs.writeFileSync("url.txt", uniqueUrls.join("\n"), "utf-8");

console.log(
  `Đã xuất ${uniqueUrls.length} URL từ file1 mà không có trong file2 vào url.txt`
);
