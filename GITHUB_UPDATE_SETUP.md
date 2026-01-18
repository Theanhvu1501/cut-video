# Hướng dẫn thiết lập Auto-Update với GitHub Releases

## Tổng quan

Ứng dụng đã được cấu hình để sử dụng GitHub Releases để host bản update. Người dùng sẽ **kiểm tra và cập nhật thủ công** (không tự động).

Repository: [https://github.com/Theanhvu1501/vid-master](https://github.com/Theanhvu1501/vid-master)

## Cấu hình đã thiết lập

### 1. Package.json
- Provider: `github`
- Owner: `Theanhvu1501`
- Repo: `vid-master`

### 2. Electron Main
- URL: Tự động từ GitHub Releases
- Auto check: **ĐÃ TẮT** (người dùng check thủ công)
- Auto download: Tắt (người dùng chọn tải)

## Quy trình Build và Publish lên GitHub

### Bước 1: Cài đặt package mới (nếu chưa)
```bash
npm install
```

### Bước 2: Tăng version trong package.json
```json
{
  "version": "1.0.2"  // Tăng từ 1.0.1
}
```

### Bước 3: Build ứng dụng
```bash
npm run build
```

### Bước 4: Upload files lên GitHub Releases

Sau khi build, trong thư mục `dist/` sẽ có các files:

1. **latest.yml** - File metadata quan trọng nhất
2. **VidMaster Setup X.X.X.exe** - File installer
3. **VidMaster Setup X.X.X.exe.blockmap** - File verify integrity

**Cách upload:**

1. Vào [GitHub Releases](https://github.com/Theanhvu1501/vid-master/releases)
2. Click **"Draft a new release"**
3. Tag version: `v1.0.2` (phải khớp với version trong package.json)
4. Release title: `v1.0.2` hoặc tên mô tả
5. Mô tả release notes (tùy chọn)
6. Upload 3 files:
   - `latest.yml`
   - `VidMaster Setup 1.0.2.exe`
   - `VidMaster Setup 1.0.2.exe.blockmap`
7. Click **"Publish release"**

### Bước 5: Kiểm tra

Sau khi publish release:
- File `latest.yml` sẽ được electron-updater đọc để kiểm tra version mới
- Người dùng có thể check update thủ công từ trong app

## Lưu ý quan trọng

### ⚠️ Version phải tăng mỗi lần
- Version mới phải **LỚN HƠN** version cũ
- Format: `MAJOR.MINOR.PATCH` (ví dụ: 1.0.0 → 1.0.1 → 1.0.2)

### ⚠️ File latest.yml là bắt buộc
- Electron-updater sẽ đọc file này để biết version mới nhất
- File này phải có trong mỗi release

### ⚠️ Tag phải khớp với version
- Tag release: `v1.0.2`
- Version trong package.json: `1.0.2`
- Không cần "v" trong package.json, nhưng cần trong tag

### ⚠️ Public Repository
- Repository phải là **Public** hoặc bạn cần cấu hình GitHub token (nếu private)

## Cách người dùng cập nhật

1. Mở ứng dụng
2. Tìm nút "Kiểm tra cập nhật" trong menu/UI (cần thêm nút này vào renderer.js nếu chưa có)
3. Click để kiểm tra
4. Nếu có update mới, sẽ hiển thị dialog
5. Chọn "Tải về ngay" để tải update
6. Sau khi tải xong, chọn "Khởi động lại ngay" để cài đặt

## Troubleshooting

### Lỗi: "Error checking for updates"
- Kiểm tra repository có public không
- Kiểm tra tag version có khớp với package.json không
- Kiểm tra file latest.yml có trong release không

### Không phát hiện update mới
- Đảm bảo version mới > version cũ
- Kiểm tra file latest.yml đã được upload chưa
- Kiểm tra tag release có đúng format `vX.X.X` không

### Lỗi khi tải update
- Kiểm tra file .exe và .blockmap có trong release không
- Kiểm tra kết nối internet
- Thử xóa cache update (nếu có)

## Cấu trúc GitHub Release

Release nên có cấu trúc như sau:
```
Release v1.0.2
├── latest.yml                          # Bắt buộc
├── VidMaster Setup 1.0.2.exe          # Bắt buộc
└── VidMaster Setup 1.0.2.exe.blockmap # Bắt buộc
```

## Thêm nút kiểm tra update trong UI

Bạn có thể thêm nút vào renderer.js để người dùng check update thủ công:

```javascript
// Trong renderer.js
async function checkForAppUpdate() {
  if (!checkElectronAPI()) return;
  
  try {
    const result = await window.electronAPI.checkForUpdates();
    if (result.success) {
      alert("Đang kiểm tra cập nhật...");
    } else {
      alert(result.message || "Lỗi khi kiểm tra cập nhật");
    }
  } catch (error) {
    alert("Lỗi: " + error.message);
  }
}

// Thêm listener để nhận update status
window.electronAPI.onUpdateStatus((data) => {
  console.log("Update status:", data);
  // Có thể hiển thị thông báo cho người dùng
});
```
