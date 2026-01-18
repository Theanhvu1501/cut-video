# Hướng dẫn thiết lập Auto-Update cho VidMaster

## Tổng quan

Ứng dụng đã được cấu hình để tự động kiểm tra và cập nhật bản mới. Khi bạn build một bản mới, các bản cũ sẽ tự động phát hiện và đề xuất cập nhật.

## Cấu hình Update Server

### Cách 1: Sử dụng GitHub Releases (Khuyến nghị)

1. **Tạo repository trên GitHub** (nếu chưa có)

2. **Cập nhật URL trong package.json:**
```json
"publish": [
  {
    "provider": "github",
    "owner": "your-username",
    "repo": "your-repo-name"
  }
]
```

3. **Hoặc dùng generic URL:**
```json
"publish": [
  {
    "provider": "generic",
    "url": "https://github.com/your-username/your-repo/releases/latest/download/"
  }
]
```

4. **Khi build, upload files lên GitHub Releases:**
   - Tạo release mới trên GitHub
   - Upload các file: `latest.yml`, `VidMaster Setup X.X.X.exe`, `VidMaster Setup X.X.X.exe.blockmap`

### Cách 2: Sử dụng Server riêng

1. **Tạo thư mục trên server** để chứa các file update:
```
/releases/
  ├── latest.yml
  ├── VidMaster Setup 1.0.0.exe
  ├── VidMaster Setup 1.0.0.exe.blockmap
  └── ...
```

2. **Cấu hình URL trong package.json:**
```json
"publish": [
  {
    "provider": "generic",
    "url": "https://your-domain.com/releases/"
  }
]
```

3. **Cập nhật URL trong electron-main.js:**
```javascript
autoUpdater.setFeedURL({
  provider: "generic",
  url: "https://your-domain.com/releases/",
});
```

## Quy trình Build và Publish

### 1. Cập nhật version trong package.json
```json
{
  "version": "1.0.1"  // Tăng version mỗi lần build mới
}
```

### 2. Build ứng dụng
```bash
npm run build
```

### 3. Upload files lên server

Sau khi build, trong thư mục `dist/` sẽ có:
- `latest.yml` - File metadata về version mới nhất
- `VidMaster Setup X.X.X.exe` - File installer
- `VidMaster Setup X.X.X.exe.blockmap` - File để verify integrity

**Upload tất cả 3 files này lên update server.**

### 4. Kiểm tra cập nhật

Sau khi upload:
- Ứng dụng sẽ tự động kiểm tra update sau 5 giây khi khởi động
- Kiểm tra định kỳ mỗi 4 giờ
- Người dùng có thể kiểm tra thủ công từ UI (nếu có nút)

## Cấu trúc file trên server

Với GitHub Releases, electron-builder tự động upload files.

Với server riêng, cấu trúc thư mục nên như sau:
```
https://your-domain.com/releases/
├── latest.yml                          # File này MỚI NHẤT - luôn cần có
├── VidMaster Setup 1.0.0.exe          # Version cũ (có thể xóa)
├── VidMaster Setup 1.0.0.exe.blockmap # Version cũ
├── VidMaster Setup 1.0.1.exe          # Version mới
└── VidMaster Setup 1.0.1.exe.blockmap # Version mới
```

## Lưu ý quan trọng

1. **Version phải tăng mỗi lần build mới** (1.0.0 → 1.0.1 → 1.0.2, hoặc 1.0.0 → 1.1.0 → 2.0.0)

2. **File latest.yml là quan trọng nhất** - Electron-updater sẽ đọc file này để kiểm tra version mới

3. **CORS và HTTPS**: Update server phải hỗ trợ HTTPS và cho phép CORS nếu dùng server riêng

4. **Kiểm tra trong Development**: Auto-update KHÔNG hoạt động khi chạy `npm run dev`. Chỉ hoạt động với bản đã build.

## Test Auto-Update

1. Build version 1.0.0 và cài đặt
2. Build version 1.0.1 và upload lên server
3. Mở ứng dụng 1.0.0 - sẽ tự động phát hiện và đề xuất update

## Xử lý lỗi

- Nếu không phát hiện update: Kiểm tra URL trong package.json và electron-main.js có đúng không
- Nếu không tải được update: Kiểm tra server có hỗ trợ HTTPS và CORS không
- Nếu không cài được update: Đảm bảo file .exe và .blockmap đều có trên server
