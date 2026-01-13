# Hướng dẫn Build App VidMaster

## Cài đặt Dependencies

```bash
npm install
```

## Chạy App ở chế độ Development

```bash
npm run dev
```

Hoặc:

```bash
npm start
```

## Build thành file .exe

```bash
npm run build:win
```

File .exe sẽ được tạo trong thư mục `dist/`

## Lưu ý

1. App sử dụng Electron để tạo GUI
2. Mỗi chức năng được đặt trong một tab riêng
3. Input folder sẽ có nút chọn folder (tính năng này có thể được mở rộng)
4. Input số/option sẽ có ô nhập hoặc dropdown

## Cấu trúc

- `electron-main.js` - Main process của Electron
- `preload.cjs` - Preload script (bridge giữa main và renderer)
- `renderer.html` - Giao diện HTML
- `renderer.js` - Logic của giao diện
- Các file script hiện có (`render.js`, `download.js`, etc.) được giữ nguyên
