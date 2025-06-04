import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";

// Load font tiếng Nhật
GlobalFonts.registerFromPath("./fonts/NotoSansJP-Regular.ttf", "Noto Sans JP");
GlobalFonts.registerFromPath("./fonts/KosugiMaru-Regular.ttf", "Noto Sans JP");
// Cấu hình có thể tùy chỉnh
const CONFIG = {
  // Cấu hình font chữ
  font: {
    family: "Kosugi Maru",
    sizeFactor: 18, // Kích thước font = chiều rộng ảnh / sizeFactor
    weight: "bold",
    lineHeightRatio: 1.1, // Khoảng cách giữa các dòng (hệ số nhân với fontSize)
  },

  // Cấu hình vị trí và kích thước
  layout: {
    sidePadding: 1, // Khoảng cách từ chữ đến hai bên
    bottomPadding: 25, // Khoảng cách từ chữ đến cạnh dưới
  },

  // Cấu hình màu sắc
  colors: {
    firstLine: "white", // Màu chữ dòng đầu
    secondLine: "#16f020", // Màu chữ dòng thứ hai (xanh lá cây sáng)
    stroke: "black", // Màu viền chữ
    strokeWidth: 8, // Độ dày viền chữ
  },

  // Cấu hình gradient
  gradient: {
    heightFactor: 0.8, // Chiều cao gradient = fontSize * heightFactor
    stops: [
      { position: 0, color: "rgba(0, 0, 0, 0.0)" }, // Trong suốt ở trên cùng
      { position: 0.1, color: "rgba(0, 0, 0, 0.3)" }, // Nhanh chóng chuyển sang đen
      { position: 0.3, color: "rgba(0, 0, 0, 0.8)" }, // Đen đậm ở vùng chữ dòng đầu
      { position: 0.6, color: "rgba(0, 0, 0, 0.9)" }, // Đen đậm hơn ở vùng chữ dòng hai
      { position: 1, color: "rgba(0, 0, 0, 0.9)" }, // Gần như đen hoàn toàn ở dưới cùng
    ],
  },
};

async function addTextToImage(imagePath, text, outputPath) {
  try {
    const image = await sharp(imagePath);
    const metadata = await image.metadata();
    const { width, height } = metadata;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Transparent background
    ctx.clearRect(0, 0, width, height);

    // Tính toán kích thước font dựa trên chiều rộng ảnh
    const fontSize = Math.floor(width / CONFIG.font.sizeFactor);
    ctx.font = `${CONFIG.font.weight} ${fontSize}px "${CONFIG.font.family}"`;

    // Giới hạn chỉ 2 dòng - Tăng chiều rộng tối đa để chữ sát ra hai bên hơn
    const maxWidth = width - CONFIG.layout.sidePadding;

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

    // Vẽ text - Điều chỉnh vị trí gần với cạnh dưới hơn và giảm khoảng cách giữa các dòng
    const lineHeight = fontSize * CONFIG.font.lineHeightRatio;
    // Điều chỉnh vị trí y để chữ thấp hơn, gần với cạnh dưới hơn
    const y1 = height - lineHeight - CONFIG.layout.bottomPadding;
    const y2 = height - CONFIG.layout.bottomPadding;

    // Tạo gradient đen ở dưới ảnh - Kéo dài từ dưới lên cao hơn cả dòng đầu
    const gradientStart = y1 - fontSize * CONFIG.gradient.heightFactor;

    // Tạo một gradient đậm hơn
    const gradient = ctx.createLinearGradient(0, gradientStart, 0, height);

    // Áp dụng các điểm dừng gradient từ cấu hình
    CONFIG.gradient.stops.forEach((stop) => {
      gradient.addColorStop(stop.position, stop.color);
    });

    ctx.fillStyle = gradient;
    ctx.fillRect(0, gradientStart, width, height - gradientStart);

    // Vẽ dòng đầu tiên
    const textWidth1 = ctx.measureText(firstLine).width;
    const x1 = (width - textWidth1) / 2;

    ctx.strokeStyle = CONFIG.colors.stroke;
    ctx.lineWidth = CONFIG.colors.strokeWidth;
    ctx.strokeText(firstLine, x1, y1);

    ctx.fillStyle = CONFIG.colors.firstLine;
    ctx.fillText(firstLine, x1, y1);

    // Vẽ dòng thứ hai
    if (secondLine) {
      const textWidth2 = ctx.measureText(secondLine).width;
      const x2 = (width - textWidth2) / 2;

      ctx.strokeStyle = CONFIG.colors.stroke;
      ctx.lineWidth = CONFIG.colors.strokeWidth;
      ctx.strokeText(secondLine, x2, y2);

      ctx.fillStyle = CONFIG.colors.secondLine;
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
