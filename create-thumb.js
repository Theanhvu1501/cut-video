import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";

// Load font tiếng Nhật
GlobalFonts.registerFromPath("./fonts/NotoSansJP-Regular.ttf", "Noto Sans JP");

async function addTextToImage(imagePath, text, outputPath) {
  try {
    const image = await sharp(imagePath);
    const metadata = await image.metadata();
    const { width, height } = metadata;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Transparent background
    ctx.clearRect(0, 0, width, height);

    // Tăng kích thước font
    const fontSize = Math.floor(width / 15); // Tăng kích thước font
    ctx.font = `bold ${fontSize}px "Noto Sans JP"`;

    // Giới hạn chỉ 2 dòng
    const maxWidth = width - 60;

    // Tính toán vị trí chia dòng tốt nhất
    const textLength = text.length;
    const halfLength = Math.ceil(textLength / 2);

    let firstLine = text.substring(0, halfLength);
    let secondLine = text.substring(halfLength);

    // Điều chỉnh vị trí chia dòng nếu dòng đầu quá dài
    const firstLineWidth = ctx.measureText(firstLine).width;
    if (firstLineWidth > maxWidth) {
      // Tìm vị trí chia dòng phù hợp hơn
      let adjustedHalfLength = halfLength;
      while (
        adjustedHalfLength > 0 &&
        ctx.measureText(text.substring(0, adjustedHalfLength)).width > maxWidth
      ) {
        adjustedHalfLength--;
      }

      firstLine = text.substring(0, adjustedHalfLength);
      secondLine = text.substring(adjustedHalfLength);
    }

    // Kiểm tra nếu dòng thứ hai quá dài
    const secondLineWidth = ctx.measureText(secondLine).width;
    if (secondLineWidth > maxWidth) {
      // Cắt bớt dòng thứ hai và thêm dấu "..."
      while (
        ctx.measureText(secondLine + "...").width > maxWidth &&
        secondLine.length > 0
      ) {
        secondLine = secondLine.substring(0, secondLine.length - 1);
      }
      secondLine += "...";
    }

    // Vẽ text - Điều chỉnh vị trí gần với cạnh dưới hơn
    const lineHeight = fontSize * 1.2;
    // Điều chỉnh vị trí y để chữ thấp hơn, gần với cạnh dưới hơn
    const y1 = height - lineHeight - 30; // Giảm khoảng cách từ dòng cuối đến cạnh dưới
    const y2 = height - 30; // Dòng thứ hai gần với cạnh dưới

    // Tạo gradient đen ở dưới ảnh - Kéo dài từ dưới lên cao hơn cả dòng đầu
    const gradientStart = y1 - fontSize * 1.5; // Bắt đầu từ trên dòng đầu khá xa

    // Tạo một gradient đậm hơn
    const gradient = ctx.createLinearGradient(0, gradientStart, 0, height);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)"); // Trong suốt ở trên cùng
    gradient.addColorStop(0.1, "rgba(0, 0, 0, 0.5)"); // Nhanh chóng chuyển sang đen
    gradient.addColorStop(0.3, "rgba(0, 0, 0, 0.7)"); // Đen đậm ở vùng chữ dòng đầu
    gradient.addColorStop(0.6, "rgba(0, 0, 0, 0.8)"); // Đen đậm hơn ở vùng chữ dòng hai
    gradient.addColorStop(1, "rgba(0, 0, 0, 0.9)"); // Gần như đen hoàn toàn ở dưới cùng

    ctx.fillStyle = gradient;
    ctx.fillRect(0, gradientStart, width, height - gradientStart);

    // Vẽ dòng đầu tiên (màu trắng)
    const textWidth1 = ctx.measureText(firstLine).width;
    const x1 = (width - textWidth1) / 2;

    ctx.strokeStyle = "black";
    ctx.lineWidth = 5;
    ctx.strokeText(firstLine, x1, y1);

    ctx.fillStyle = "white";
    ctx.fillText(firstLine, x1, y1);

    // Vẽ dòng thứ hai (màu xanh)
    if (secondLine) {
      const textWidth2 = ctx.measureText(secondLine).width;
      const x2 = (width - textWidth2) / 2;

      ctx.strokeStyle = "black";
      ctx.lineWidth = 5;
      ctx.strokeText(secondLine, x2, y2);

      ctx.fillStyle = "#16f020"; // Màu xanh da trời
      ctx.fillText(secondLine, x2, y2);
    }

    const textBuffer = canvas.toBuffer("image/png");

    await sharp(imagePath)
      .composite([{ input: textBuffer }])
      .toFile(outputPath);

    console.log(`Đã tạo ảnh thành công: ${outputPath}`);
  } catch (error) {
    console.error("Lỗi khi xử lý ảnh:", error);
  }
}

// Sử dụng hàm
addTextToImage(
  "./eQe8yZO3FmQ-HD.jpg",
  "掃除婦を英語でバカにする若手社員 英語で返された瞬間、社員たちは絶句…",
  "./output.jpg"
);
