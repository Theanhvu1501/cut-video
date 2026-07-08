// Điều khiển YouTube Studio bằng playwright (gắn vào trình duyệt GPM qua CDP).
// 4 bước: b1 upload video → b2 đợi upload 100% → b3 thay thumb → b4 lên lịch.
//
// SELECTOR gom hết vào SEL bên dưới để dễ sửa khi UI/ngôn ngữ khác.
// Nguồn tham chiếu (đã chạy được): github.com/secondphantom/node-youtube-video-uploader-playwright
// → Hãy đối chiếu với script GPM Automate của bạn (03.auto_change_thumb / 04.auto_schedule)
//   và chỉnh SEL cho khớp UI thật của bạn nếu có chỗ lệch.

import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────
// SELECTOR — sửa ở đây khi UI YouTube đổi
// ─────────────────────────────────────────────────────────────
export const SEL = {
  createIcon: "ytcp-button.ytcpAppHeaderCreateIcon", // nút "Tạo" ở góc phải Studio (class, không phụ thuộc ngôn ngữ)
  uploadMenuItem: "#text-item-0", // menu "Tải video lên"
  selectFilesButton: "#select-files-button", // nút chọn file video (mở file chooser)
  videoFileInput: 'input[type="file"]', // ô input file ẩn của video (nạp thẳng — ổn định nhất)

  title: "#title-textarea #child-input #textbox", // ô tiêu đề (contenteditable)
  description: "#description-textarea #child-input #textbox", // ô mô tả (contenteditable)
  addThumbnail: "#add-photo-icon", // nút tải thumbnail tuỳ chỉnh (mở file chooser)
  thumbnailFileInput: "", // (để trống nếu chưa biết input ẩn của thumbnail; điền sau khi dò DOM)

  uploadProgressLabel: ".progress-label", // nhãn tiến trình upload, text chứa "...%"

  stepReview: '[test-id="REVIEW"]', // bước "Hiển thị" (Visibility)
  scheduleRadio: "#second-container-expand-button", // mở/chọn khối "Lên lịch" (UI mới, thay #schedule-radio-button)
  datepickerTrigger: "#datepicker-trigger", // mở lịch chọn ngày
  datePickerInput: ".ytcp-date-picker .tp-yt-paper-input input", // ô nhập ngày
  timePickerInput: ".ytcp-datetime-picker .tp-yt-paper-input input", // ô nhập giờ

  doneButton: "#done-button", // nút "Xong"
  prechecksWarningPrimary:
    "ytcp-prechecks-warning-dialog #primary-action-button", // dialog cảnh báo (nếu có)
  stillProcessingClose: ".ytcp-uploads-still-processing-dialog #close-button", // dialog "đang xử lý" → đóng
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Nghỉ ngẫu nhiên để bớt "máy móc" (nhân-tính-hoá).
function rand(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}
async function humanPause(min = 600, max = 1500) {
  await sleep(rand(min, max));
}

// Di chuột kiểu người tới element trước khi click (đường đi nhiều bước như GPM).
async function humanMouseTo(page, el) {
  try {
    // Cuộn element vào tầm nhìn nếu cần.
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    if (box) {
      // Nhắm 1 điểm ngẫu nhiên trong element (tránh mép, giống người).
      const x = box.x + box.width * (0.3 + Math.random() * 0.4);
      const y = box.y + box.height * (0.3 + Math.random() * 0.4);
      // Di chuột qua nhiều bước (interpolate) thay vì nhảy thẳng.
      await page.mouse.move(x, y, { steps: rand(10, 25) });
      await humanPause(80, 220);
    }
  } catch {
    // Không lấy được toạ độ (element ẩn…) → bỏ qua, click thường vẫn chạy.
  }
}

// Chờ 1 selector xuất hiện rồi click (poll). Trả false + log nếu quá số lần thử.
async function existClick(
  page,
  selector,
  { intervalMs = 500, maxTries = Infinity, label = selector, log = () => {} } = {},
) {
  let tries = 0;
  while (tries < maxTries) {
    const el = await page.$(selector);
    if (el) {
      await humanMouseTo(page, el); // di chuột kiểu người trước
      await el.click();
      log(`   ✓ click: ${label}`);
      return true;
    }
    tries++;
    await sleep(intervalMs);
  }
  log(`   ✗ KHÔNG thấy (sai SEL?): ${label}  →  selector: ${selector}`);
  return false;
}

// Gõ vào ô contenteditable/input kiểu người (focus → gõ có delay). Trả false + log nếu không thấy.
async function humanType(
  page,
  selector,
  text,
  { intervalMs = 500, maxTries = 60, label = selector, log = () => {} } = {},
) {
  let el = null;
  let tries = 0;
  while (!(el = await page.$(selector)) && tries < maxTries) {
    tries++;
    await sleep(intervalMs);
  }
  if (!el) {
    log(`   ✗ KHÔNG thấy ô nhập (sai SEL?): ${label}  →  selector: ${selector}`);
    return false;
  }
  await el.click();
  await humanPause(200, 500);
  await page.keyboard.type(String(text), { delay: rand(30, 90) });
  log(`   ✓ nhập "${text}" vào ${label}`);
  return true;
}

// Như humanType nhưng XOÁ dữ liệu cũ trong ô trước khi gõ (Ctrl+A → Delete).
async function clearAndType(
  page,
  selector,
  text,
  { intervalMs = 500, maxTries = 60, label = selector, log = () => {} } = {},
) {
  let el = null;
  let tries = 0;
  while (!(el = await page.$(selector)) && tries < maxTries) {
    tries++;
    await sleep(intervalMs);
  }
  if (!el) {
    log(`   ✗ KHÔNG thấy ô nhập (sai SEL?): ${label}  →  selector: ${selector}`);
    return false;
  }
  await humanMouseTo(page, el);
  await el.click();
  await humanPause(150, 400);
  // Xoá sạch nội dung có sẵn.
  await page.keyboard.press("Control+A");
  await humanPause(80, 200);
  await page.keyboard.press("Delete");
  await humanPause(120, 300);
  await page.keyboard.type(String(text), { delay: rand(60, 140) });
  log(`   ✓ (xoá cũ) nhập "${text}" vào ${label}`);
  return true;
}

// Nạp file vào input[type=file] qua CDP DOM.setFileInputFiles — truyền ĐƯỜNG DẪN, không truyền
// nội dung → KHÔNG dính giới hạn 50MB của connectOverCDP. Tìm cả trong shadow DOM (pierce).
async function setFileViaCDP(page, cssSelector, filePath) {
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("DOM.getDocument", { depth: 0 });
    const { searchId, resultCount } = await cdp.send("DOM.performSearch", {
      query: cssSelector,
      includeUserAgentShadowDOM: true,
    });
    if (!resultCount) {
      await cdp.send("DOM.discardSearchResults", { searchId }).catch(() => {});
      return false;
    }
    const { nodeIds } = await cdp.send("DOM.getSearchResults", { searchId, fromIndex: 0, toIndex: resultCount });
    await cdp.send("DOM.setFileInputFiles", { files: [absPath], nodeId: nodeIds[0] });
    await cdp.send("DOM.discardSearchResults", { searchId }).catch(() => {});
    return true;
  } finally {
    try { await cdp.detach(); } catch { /* ignore */ }
  }
}

// Nạp file: ưu tiên CDP theo path (chịu được file lớn); fallback click nút mở hộp thoại (file nhỏ).
// Trả về true nếu nạp được, false + log nếu không.
async function setFile(page, { inputSelector, triggerSelector, filePath, label, log = () => {} }) {
  // Cách 1: CDP DOM.setFileInputFiles theo path — không lo file >50MB, tìm được cả trong shadow DOM.
  if (inputSelector) {
    try {
      if (await setFileViaCDP(page, inputSelector, filePath)) {
        log(`   ✓ nạp ${label} qua CDP path (${inputSelector})`);
        return true;
      }
      log(`   … không thấy input (${inputSelector}) qua CDP, thử nút mở hộp thoại…`);
    } catch (e) {
      log(`   … CDP nạp file lỗi (${e.message}), thử nút mở hộp thoại…`);
    }
  }
  // Cách 2: click nút → bắt filechooser (chỉ hợp file nhỏ <50MB, vd thumbnail).
  if (triggerSelector) {
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 15000 }).catch(() => null);
    const clicked = await existClick(page, triggerSelector, { maxTries: 30, label, log });
    if (!clicked) return false;
    const chooser = await chooserPromise;
    if (!chooser) {
      log(`   ✗ click được nhưng hộp thoại chọn file không mở: ${label}`);
      return false;
    }
    await chooser.setFiles(filePath);
    log(`   ✓ nạp ${label} qua hộp thoại`);
    return true;
  }
  return false;
}

// b2: đợi upload đạt 100% (hoặc chuyển sang trạng thái xử lý → coi như xong upload).
async function waitUploadComplete(
  page,
  { timeoutMs = 20 * 60 * 1000, intervalMs = 2000 } = {},
) {
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
  const m = String(scheduleISO).match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/,
  );
  if (!m) throw new Error(`scheduleISO không hợp lệ: ${scheduleISO}`);
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
  if (d <= new Date()) throw new Error("Giờ lịch phải ở tương lai.");
  const dateStr = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  }).format(d);
  const timeStr = new Intl.DateTimeFormat(locale, {
    timeStyle: "short",
  }).format(d);
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

  // Kiểm tra file tồn tại (để phân biệt lỗi "sai path" với lỗi "sai SEL").
  if (!fs.existsSync(videoPath)) throw new Error(`SAI PATH: file video không tồn tại: ${videoPath}`);
  if (thumbnailPath && !fs.existsSync(thumbnailPath)) {
    log(`⚠ SAI PATH: file thumbnail không tồn tại: ${thumbnailPath} → sẽ bỏ qua bước thumb.`);
    thumbnailPath = null;
  }
  log(`Paths OK → video: ${videoPath}`);
  log(`          thumb: ${thumbnailPath || "(không có)"} | lịch: ${scheduleISO}`);

  // ══════════════════════════════════════════════════════════
  // b1: UPLOAD VIDEO
  // ══════════════════════════════════════════════════════════
  log("b1: mở Studio và bắt đầu upload…");
  // Mở trang YouTube Studio (dùng phiên đã login sẵn của profile GPM).
  await page.goto("https://studio.youtube.com", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await humanPause(800, 1600);
  // Bấm nút "Tạo" (góc trên phải). Nếu không thấy → sai selector hoặc chưa login.
  if (!(await existClick(page, SEL.createIcon, { maxTries: 60, label: "nút Tạo", log })))
    throw new Error("Không thấy nút Tạo — kiểm tra SEL.createIcon hoặc chưa login GPM.");
  await humanPause();
  // Trong menu vừa mở, chọn "Tải video lên".
  await existClick(page, SEL.uploadMenuItem, { maxTries: 30, label: "menu Tải video lên", log });
  await humanPause();
  // Nạp file video: ưu tiên input[type=file] ẩn, fallback nút chọn file.
  const okVideo = await setFile(page, {
    inputSelector: SEL.videoFileInput,
    triggerSelector: SEL.selectFilesButton,
    filePath: videoPath,
    label: "video",
    log,
  });
  if (!okVideo) throw new Error("Không nạp được file video — kiểm tra SEL.videoFileInput / SEL.selectFilesButton.");
  log("b1: đã nạp file video.");

  // ══════════════════════════════════════════════════════════
  // b2: ĐỢI UPLOAD 100%
  // (bắt buộc trước khi thay thumb — nút thumbnail chỉ sẵn sàng khi upload xong)
  // ══════════════════════════════════════════════════════════
  log("b2: đợi upload đạt 100%…");
  await waitUploadComplete(page);
  log("b2: upload xong.");

  // Điền tiêu đề (gõ kiểu người). YouTube tự điền tiêu đề = tên file,
  // nên nếu muốn giữ nguyên tên file thì có thể bỏ dòng này.
  // await humanType(page, SEL.title, title);
  // Điền mô tả nếu có.
  // if (description) {
  //   await humanPause();
  //   await humanType(page, SEL.description, description);
  // }

  // ══════════════════════════════════════════════════════════
  // b3: THAY THUMBNAIL
  // ══════════════════════════════════════════════════════════
  if (thumbnailPath) {
    log("b3: thay thumbnail…");
    await humanPause();
    // Nạp ảnh thumbnail: thử input ẩn của thumbnail, fallback nút thêm ảnh.
    const okThumb = await setFile(page, {
      inputSelector: SEL.thumbnailFileInput, // để trống nếu chưa biết → dùng nút bên dưới
      triggerSelector: SEL.addThumbnail,
      filePath: thumbnailPath,
      label: "thumbnail",
      log,
    });
    if (!okThumb) {
      log("⚠ b3: KHÔNG đặt được thumbnail — kiểm tra SEL.addThumbnail / SEL.thumbnailFileInput.");
    } else {
      // Đợi ảnh thumbnail upload xong rồi mới qua bước sau (tránh click khi chưa xong).
      log("b3: đã chọn ảnh, đợi thumbnail upload xong…");
      await humanPause(5000, 8000);
      log("b3: xong thumbnail.");
    }
  }

  // ══════════════════════════════════════════════════════════
  // b4: LÊN LỊCH
  // ══════════════════════════════════════════════════════════
  log(`b4: lên lịch ${scheduleISO}…`);
  await humanPause();
  // Nhảy tới bước "Hiển thị" (Visibility) — nơi có tuỳ chọn lên lịch.
  if (!(await existClick(page, SEL.stepReview, { maxTries: 60, label: "bước Hiển thị", log })))
    throw new Error("Không tới được bước Hiển thị — kiểm tra SEL.stepReview.");
  await humanPause(1000, 1800);
  // Chỉ lấy GIỜ (bỏ nhập ngày theo yêu cầu — ngày để mặc định của YouTube).
  const { timeStr } = formatScheduleForPicker(scheduleISO, locale);
  log(`b4: chỉ đặt GIỜ="${timeStr}" (ngày để mặc định của YouTube).`);
  // Mở/chọn khối "Lên lịch".
  await existClick(page, SEL.scheduleRadio, { maxTries: 30, label: "ô Lên lịch", log });
  await humanPause(1000, 1800);
  // Nhập GIỜ — XOÁ dữ liệu cũ trước rồi mới gõ.
  await clearAndType(page, SEL.timePickerInput, timeStr, { label: "ô giờ", log });
  await humanPause(400, 900);
  await page.keyboard.press("Enter");
  log("b4: đã đặt giờ.");

  // --- NHẬP NGÀY: đang TẮT theo yêu cầu. Bật lại nếu cần đặt ngày cụ thể: ---
  // const { dateStr } = formatScheduleForPicker(scheduleISO, locale);
  // await existClick(page, SEL.datepickerTrigger, { maxTries: 30, label: "mở lịch ngày", log });
  // await clearAndType(page, SEL.datePickerInput, dateStr, { label: "ô ngày", log });
  // await page.keyboard.press("Enter");

  // ══════════════════════════════════════════════════════════
  // HOÀN TẤT — bấm Xong + đóng các hộp thoại có thể hiện
  // ══════════════════════════════════════════════════════════
  await humanPause();
  // Bấm "Xong" để lưu.
  await existClick(page, SEL.doneButton, { maxTries: 60, label: "nút Xong", log });
  // Nếu hiện hộp thoại cảnh báo tiền-kiểm → bấm nút xác nhận (không phải lúc nào cũng có).
  await existClick(page, SEL.prechecksWarningPrimary, {
    intervalMs: 1000,
    maxTries: 10,
    label: "dialog cảnh báo (nếu có)",
    log,
  });
  // Nếu hiện hộp thoại "video vẫn đang xử lý" → đóng (chờ tối đa ~60s).
  await existClick(page, SEL.stillProcessingClose, {
    intervalMs: 1000,
    maxTries: 60,
    label: "đóng dialog đang xử lý",
    log,
  });
  log("✅ Xong video này.");
  return { ok: true };
}
