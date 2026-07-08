# Sheet Watch — Windows End-to-End Manual Test Checklist

> Run this on a Windows machine with `bin/yt-dlp.exe` and `bin/ffmpeg.exe` present.
> Check each box as you complete it. Record actual vs. expected results in the "Result" column.

---

## 1. Prepare the Google Sheet

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| 1.1 | Create a new Google Spreadsheet (or reuse one). Note the Spreadsheet ID from the URL. | Sheet is accessible. | |
| 1.2 | Create a tab named exactly **`⚙config`**. In row 1 add headers: `Tên kênh | Bật | Số video/ngày | Overlay | Opacity`. In row 2 add: `Kênh Test | TRUE | 2 | topTransparent | 0.7` | Tab exists, row 2 has the channel config. | |
| 1.3 | Create a tab named **`Kênh Test`** (must match the name in ⚙config row 2). | Tab exists. | |
| 1.4 | In the `Kênh Test` tab, put **3 valid YouTube video URLs** in column A (rows 1, 2, 3). Column B should be empty. | 3 URLs visible, col B blank. | |
| 1.5 | Create a Google Cloud service account, download its JSON key file (e.g. `creds.json`). Share the spreadsheet with the service account email (Editor access). | Service account has read/write access. | |

---

## 2. Prepare the Folder Layout

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| 2.1 | Choose a root folder, e.g. `C:\Videos`. | Folder exists. | |
| 2.2 | Create `C:\Videos\Kênh Test\backgrounds\`. | Directory exists. | |
| 2.3 | Place **at least 1** `.mp4` file inside `C:\Videos\Kênh Test\backgrounds\`. | File is present. | |

---

## 3. First Run — "Chạy tất cả ngay"

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| 3.1 | Open the app. Navigate to the **Theo dõi Sheet** tab. | Tab is visible and responsive. | |
| 3.2 | Enter **Spreadsheet ID** (from step 1.1). | Field accepts the ID. | |
| 3.3 | Click "Chọn file credentials" and select the `creds.json` from step 1.5. | Path appears in the field. | |
| 3.4 | Click "Chọn thư mục gốc" and select `C:\Videos`. | Path appears in the field. | |
| 3.5 | Leave "Số giây poll" at default (300) or any value. | Field has a numeric value. | |
| 3.6 | Click **Lưu**. | Settings saved, no error. | |
| 3.7 | Click **"Chạy tất cả ngay"**. | Runner starts; status events appear in the UI. | |
| 3.8 | Wait for the run to complete. | Exactly **2** videos downloaded and rendered (quota = 2, not 3). | |
| 3.9 | Check `C:\Videos\Kênh Test\output\` — confirm 2 `.mp4` files exist. | 2 output mp4 files present. | |
| 3.10 | Open the Google Sheet `Kênh Test` tab. Confirm column B of the 2 processed rows = **`done`**. The 3rd row's col B remains empty. | 2 rows have "done"; 1 row still blank. | |
| 3.11 | Check `C:\Videos\runner-state.json`. Confirm it contains `{ "Kênh Test": { "countToday": 2, ... } }`. | countToday = 2. | |
| 3.12 | Open each of the 2 rendered `.mp4` files in `output\`. Confirm that each video corresponds to the URL in the same sheet row — i.e. the video content matches the source URL listed in col A (guards against row/video misattribution from concurrent downloads). | Video 1 matches row 1's URL; video 2 matches row 2's URL. | |

---

## 4. Re-run — Quota Already Met

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| 4.1 | Click **"Chạy tất cả ngay"** again (same day). | Runner runs but downloads **0** additional videos (daily quota = 2 already met). | |
| 4.2 | `runner-state.json` countToday still = 2. | No change in state. | |
| 4.3 | Output folder still has exactly 2 mp4 files. | No new files. | |

---

## 5. Error URL Handling

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| 5.1 | In the Google Sheet `Kênh Test` tab, clear column B for all 3 rows (to reset status). | Col B is blank for all 3 rows. | |
| 5.2 | Edit one of the 3 URLs to be intentionally invalid (e.g. remove some characters). | URL looks broken. | |
| 5.3 | Delete or edit `runner-state.json` to reset `countToday` to 0 (or delete the file). | State reset. | |
| 5.4 | Click **"Chạy tất cả ngay"**. | Runner attempts to process 2 URLs (quota). | |
| 5.5 | The bad URL's col B = `error: <message>`. The other processed URL's col B = `done`. | Error in one row; done in another; 3rd row (unprocessed) remains blank. | |
| 5.6 | No crash; the runner finishes normally. | App still responsive. | |

---

## 6. Auto-Run on App Open

| Step | Action | Expected | Result |
|------|--------|----------|--------|
| 6.1 | In the **Theo dõi Sheet** settings, enable **"Tự chạy khi mở app"** (autoRunOnOpen). Click **Lưu**. | Checkbox/toggle is on; settings saved. | |
| 6.2 | Reset sheet state: clear col B for all rows in `Kênh Test`, reset/delete `runner-state.json`. | Sheet and state are clean. | |
| 6.3 | Close the app completely. | App process is gone. | |
| 6.4 | Reopen the app. | App opens normally. | |
| 6.5 | Wait ~5 seconds. The sheet-watch runner should auto-start without clicking anything. | Runner begins automatically; events appear in Theo dõi Sheet tab after ~4 s. | |
| 6.6 | After the run completes, confirm 2 output mp4 files in `C:\Videos\Kênh Test\output\` and 2 rows with "done" in the sheet. | Same pass/fail outcome as step 3.8–3.11. | |

---

## 7. Pass Criteria

The feature passes if ALL of the following hold:

- [ ] Exactly `videosPerDay` (= 2) files downloaded and rendered per day, not more.
- [ ] Col B of processed rows = `done`; bad URLs = `error: <message>`.
- [ ] `runner-state.json` correctly reflects `countToday`.
- [ ] A second "Chạy tất cả ngay" on the same day does nothing (quota met).
- [ ] Enabling `autoRunOnOpen` and reopening the app causes the runner to start automatically within ~5 seconds.
- [ ] No unhandled crashes or frozen UI during any step.

---

## 8. If Something Fails

1. Check the Electron console (DevTools → Console, or open DevTools from the app if available).
2. Check `C:\Videos\runner-state.json` for unexpected values.
3. Check the Google Sheet for unexpected col B values.
4. Common issues:
   - **Credentials error**: Confirm the service account has Editor access to the sheet.
   - **backgrounds folder empty**: Ensure at least 1 `.mp4` file is in `C:\Videos\Kênh Test\backgrounds\`.
   - **yt-dlp not found**: Confirm `bin\yt-dlp.exe` exists in the app directory.
   - **ffmpeg not found**: Confirm `bin\ffmpeg.exe` exists in the app directory.
   - **autoRunOnOpen not triggering**: Confirm settings were saved (open settings panel and verify the checkbox state).
