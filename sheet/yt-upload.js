// Điều khiển YouTube Studio bằng playwright (gắn vào trình duyệt GPM qua CDP).
// 4 bước: b1 upload video → b2 đợi upload 100% → b3 thay thumb → b4 lên lịch.
//
// SELECTOR gom hết vào SEL bên dưới để dễ sửa khi UI/ngôn ngữ khác.
// Nguồn tham chiếu (đã chạy được): github.com/secondphantom/node-youtube-video-uploader-playwright
// → Hãy đối chiếu với script GPM Automate của bạn (03.auto_change_thumb / 04.auto_schedule)
//   và chỉnh SEL cho khớp UI thật của bạn nếu có chỗ lệch.

// ─────────────────────────────────────────────────────────────
// SELECTOR — sửa ở đây khi UI YouTube đổi
// ─────────────────────────────────────────────────────────────
export const SEL = {
  createIcon: "#create-icon",                 // nút "Tạo" ở góc phải Studio
  uploadMenuItem: "#text-item-0",             // menu "Tải video lên"
  selectFilesButton: "#select-files-button",  // nút chọn file video (mở file chooser)

  title: "#title-textarea #child-input #textbox",           // ô tiêu đề (contenteditable)
  description: "#description-textarea #child-input #textbox",// ô mô tả (contenteditable)
  addThumbnail: "#add-photo-icon",            // nút tải thumbnail tuỳ chỉnh (mở file chooser)

  uploadProgressLabel: ".progress-label",     // nhãn tiến trình upload, text chứa "...%"

  stepReview: '[test-id="REVIEW"]',           // bước "Hiển thị" (Visibility)
  scheduleRadio: "#schedule-radio-button",    // chọn "Lên lịch"
  datepickerTrigger: "#datepicker-trigger",   // mở lịch chọn ngày
  datePickerInput: ".ytcp-date-picker .tp-yt-paper-input input", // ô nhập ngày
  timePickerInput: ".ytcp-datetime-picker .tp-yt-paper-input input", // ô nhập giờ

  doneButton: "#done-button",                 // nút "Xong"
  prechecksWarningPrimary: "ytcp-prechecks-warning-dialog #primary-action-button", // dialog cảnh báo (nếu có)
  stillProcessingClose: ".ytcp-uploads-still-processing-dialog #close-button",      // dialog "đang xử lý" → đóng
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Nghỉ ngẫu nhiên để bớt "máy móc" (nhân-tính-hoá).
function rand(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}
async function humanPause(min = 400, max = 1200) {
  await sleep(rand(min, max));
}

// Chờ 1 selector xuất hiện rồi click (poll). Trả false nếu quá số lần thử.
async function existClick(page, selector, { intervalMs = 500, maxTries = Infinity } = {}) {
  let tries = 0;
  while (tries < maxTries) {
    const el = await page.$(selector);
    if (el) {
      await el.click();
      return true;
    }
    tries++;
    await sleep(intervalMs);
  }
  return false;
}

// Gõ vào ô contenteditable kiểu người (focus → gõ có delay).
async function humanType(page, selector, text, { intervalMs = 500 } = {}) {
  let el = null;
  while (!(el = await page.$(selector))) await sleep(intervalMs);
  await el.click();
  await humanPause(200, 500);
  await page.keyboard.type(String(text), { delay: rand(30, 90) });
}

// Mở file chooser bằng cách click trigger rồi set file.
async function fileChoose(page, triggerSelector, filePath, { intervalMs = 500 } = {}) {
  const chooserPromise = page.waitForEvent("filechooser");
  const clicked = await existClick(page, triggerSelector, { intervalMs, maxTries: 60 });
  if (!clicked) throw new Error(`Không thấy nút mở file: ${triggerSelector}`);
  const chooser = await chooserPromise;
  await chooser.setFiles(filePath);
}

// b2: đợi upload đạt 100% (hoặc chuyển sang trạng thái xử lý → coi như xong upload).
async function waitUploadComplete(page, { timeoutMs = 20 * 60 * 1000, intervalMs = 2000 } = {}) {
  const start = Date.now();
  let sawProgress = false;
  while (Date.now() - start < timeoutMs) {
    const el = await page.$(SEL.uploadProgressLabel);
    if (el) {
      const txt = (await el.innerText().catch(() => "")) || "";
      const m = txt.match(/(\d+)\s*%/);
      if (m) {
        sawProgress = true;
        if (Number(m[1]) >= 100) return; // đã 100%
      } else if (sawProgress) {
        return; // không còn % sau khi từng thấy % → đã xong upload, sang xử lý
      }
    }
    await sleep(intervalMs);
  }
  // Hết timeout: không chặn cứng, tiếp tục (nút thumbnail có thể đã sẵn sàng).
}

// Định dạng ngày/giờ theo locale để điền vào picker (text phải khớp ngôn ngữ UI).
function formatScheduleForPicker(scheduleISO, locale) {
  const m = String(scheduleISO).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) throw new Error(`scheduleISO không hợp lệ: ${scheduleISO}`);
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
  if (d <= new Date()) throw new Error("Giờ lịch phải ở tương lai.");
  const dateStr = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
  const timeStr = new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(d);
  return { dateStr, timeStr };
}

/**
 * Upload 1 video rồi thay thumbnail + lên lịch (serial, trọn vẹn 1 video).
 * @param {object} args
 * @param {import('playwright-core').Page} args.page - page từ trình duyệt GPM (CDP).
 * @param {string} args.videoPath - đường dẫn file video.
 * @param {string} args.title - tiêu đề.
 * @param {string} [args.description] - mô tả.
 * @param {string} [args.thumbnailPath] - đường dẫn file thumbnail.
 * @param {string} args.scheduleISO - giờ lịch "YYYY-MM-DDTHH:MM:00" (từ schedule-slots).
 * @param {string} [args.locale="vi"] - ngôn ngữ UI YouTube (để định dạng ngày/giờ picker).
 * @param {(msg:string)=>void} [args.log] - callback log.
 */
export async function uploadAndSchedule({
  page,
  videoPath,
  title,
  description,
  thumbnailPath,
  scheduleISO,
  locale = "vi",
  log = () => {},
}) {
  // Kiểm tra tham số đầu vào bắt buộc.
  if (!page) throw new Error("Thiếu page (trình duyệt GPM).");
  if (!videoPath) throw new Error("Thiếu videoPath.");
  if (!scheduleISO) throw new Error("Thiếu scheduleISO.");

  // ══════════════════════════════════════════════════════════
  // b1: UPLOAD VIDEO
  // ══════════════════════════════════════════════════════════
  log("b1: mở Studio và bắt đầu upload…");
  // Mở trang YouTube Studio (dùng phiên đã login sẵn của profile GPM).
  await page.goto("https://studio.youtube.com", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await humanPause(800, 1600);
  // Bấm nút "Tạo" (góc trên phải). Nếu không thấy → sai selector hoặc chưa login.
  if (!(await existClick(page, SEL.createIcon, { maxTries: 60 }))) throw new Error("Không thấy nút Tạo (#create-icon).");
  await humanPause();
  // Trong menu vừa mở, chọn "Tải video lên".
  await existClick(page, SEL.uploadMenuItem, { maxTries: 30 });
  // Bấm nút chọn file → mở hộp thoại chọn file → nạp đường dẫn video.
  await fileChoose(page, SEL.selectFilesButton, videoPath);
  log("b1: đã chọn file video.");

  // ══════════════════════════════════════════════════════════
  // b2: ĐỢI UPLOAD 100%
  // (bắt buộc trước khi thay thumb — nút thumbnail chỉ sẵn sàng khi upload xong)
  // ══════════════════════════════════════════════════════════
  log("b2: đợi upload đạt 100%…");
  await waitUploadComplete(page);
  log("b2: upload xong.");

  // Điền tiêu đề (gõ kiểu người). YouTube tự điền tiêu đề = tên file,
  // nên nếu muốn giữ nguyên tên file thì có thể bỏ dòng này.
  await humanType(page, SEL.title, title);
  // Điền mô tả nếu có.
  if (description) {
    await humanPause();
    await humanType(page, SEL.description, description);
  }

  // ══════════════════════════════════════════════════════════
  // b3: THAY THUMBNAIL
  // ══════════════════════════════════════════════════════════
  if (thumbnailPath) {
    log("b3: thay thumbnail…");
    await humanPause();
    // Bấm nút thêm thumbnail → mở hộp thoại → nạp đường dẫn ảnh.
    await fileChoose(page, SEL.addThumbnail, thumbnailPath);
    log("b3: đã đặt thumbnail.");
  }

  // ══════════════════════════════════════════════════════════
  // b4: LÊN LỊCH
  // ══════════════════════════════════════════════════════════
  log(`b4: lên lịch ${scheduleISO}…`);
  await humanPause();
  // Nhảy tới bước "Hiển thị" (Visibility) — nơi có tuỳ chọn lên lịch.
  if (!(await existClick(page, SEL.stepReview, { maxTries: 60 }))) throw new Error("Không tới được bước Hiển thị (REVIEW).");
  await humanPause();
  // Đổi giờ lịch ISO → chuỗi ngày & giờ theo ngôn ngữ UI (để điền đúng vào picker).
  const { dateStr, timeStr } = formatScheduleForPicker(scheduleISO, locale);
  // Chọn ô "Lên lịch" (thay vì Công khai/Riêng tư).
  await existClick(page, SEL.scheduleRadio, { maxTries: 30 });
  await humanPause();
  // Mở lịch chọn ngày, điền ngày, Enter.
  await existClick(page, SEL.datepickerTrigger, { maxTries: 30 });
  await humanType(page, SEL.datePickerInput, dateStr);
  await page.keyboard.press("Enter");
  await humanPause();
  // Điền giờ, Enter.
  await humanType(page, SEL.timePickerInput, timeStr);
  await page.keyboard.press("Enter");
  log("b4: đã đặt ngày giờ.");

  // ══════════════════════════════════════════════════════════
  // HOÀN TẤT — bấm Xong + đóng các hộp thoại có thể hiện
  // ══════════════════════════════════════════════════════════
  await humanPause();
  // Bấm "Xong" để lưu.
  await existClick(page, SEL.doneButton, { maxTries: 60 });
  // Nếu hiện hộp thoại cảnh báo tiền-kiểm → bấm nút xác nhận (không phải lúc nào cũng có).
  await existClick(page, SEL.prechecksWarningPrimary, { intervalMs: 1000, maxTries: 10 });
  // Nếu hiện hộp thoại "video vẫn đang xử lý" → đóng (chờ tối đa ~60s).
  await existClick(page, SEL.stillProcessingClose, { intervalMs: 1000, maxTries: 60 });
  log("✅ Xong video này.");
  return { ok: true };
}
