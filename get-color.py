
import cv2
import os
from PIL import Image
import numpy as np
from collections import Counter

def get_dominant_color_from_frame(frame):
    """Trả về màu xuất hiện nhiều nhất (RGB -> HEX) trong 1 frame"""
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    pixels = np.array(img).reshape(-1, 3)  # dàn hết pixel thành mảng [N,3]
    # Đếm pixel
    counter = Counter(map(tuple, pixels))
    most_common_rgb = counter.most_common(1)[0][0]  # (R,G,B)
    dominant_hex = '#%02x%02x%02x' % most_common_rgb
    return dominant_hex

def process_videos(folder, output_file="colors.txt"):
    results = []
    video_files = sorted(
        [f for f in os.listdir(folder) if f.lower().endswith((".mp4", ".avi", ".mkv", ".mov"))]
    )

    for video_file in video_files:
        video_path = os.path.join(folder, video_file)
        cap = cv2.VideoCapture(video_path)
        success, frame = cap.read()
        cap.release()

        if success:
            # Màu tối nhất
            darkest_hex = get_darkest_color_from_frame(frame)
            # Màu phổ biến nhất
            dominant_hex = get_dominant_color_from_frame(frame)

            results.append((video_file, darkest_hex, dominant_hex))
            print(f"{video_file} -> Darkest: {darkest_hex}, Dominant: {dominant_hex}")
        else:
            print(f"⚠️ Không đọc được video: {video_file}")

    # Ghi ra file txt (bỏ dấu #)
    with open(output_file, "w", encoding="utf-8") as f:
        for video_file, darkest, dominant in results:
            f.write(f"{dominant.lstrip('#')}\n")

    print(f"\n✅ Đã lưu kết quả vào {output_file}")

# Hàm cũ lấy màu tối nhất
def get_darkest_color_from_frame(frame):
    """Trả về màu tối nhất (RGB, HEX) từ 1 frame numpy array"""
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    pixels = np.array(img)
    luma = 0.299 * pixels[:, :, 0] + 0.587 * pixels[:, :, 1] + 0.114 * pixels[:, :, 2]
    min_idx = np.unravel_index(np.argmin(luma), luma.shape)
    darkest_rgb = pixels[min_idx[0], min_idx[1], :]
    darkest_hex = '#%02x%02x%02x' % tuple(darkest_rgb)
    return darkest_hex

# Chạy thử
process_videos("./overlays", "chromaKey.txt")
