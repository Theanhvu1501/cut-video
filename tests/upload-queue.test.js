import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareJob, createUploadQueue } from "../sheet/upload-queue.js";

const NOW = new Date(2026, 6, 8, 15, 0, 0); // 2026-07-08 15:00

test("prepareJob: lấy thumb trong overlays theo title + cấp slot ngày mai", () => {
  const r = prepareJob({
    videoPath: "/ch/output/Câu Chuyện.mp4",
    overlaysDir: "/ch/overlays",
    postTimes: "8:00, 18:00",
    usedSlots: [],
    now: NOW,
    listFiles: () => ["Câu Chuyện.mp4", "Câu Chuyện.jpg", "Khác.jpg"],
  });
  assert.equal(r.thumbnailPath, "/ch/overlays/Câu Chuyện.jpg");
  assert.equal(r.scheduleISO, "2026-07-09T08:00:00");
});

test("prepareJob: không có thumb khớp -> thumbnailPath null", () => {
  const r = prepareJob({
    videoPath: "/ch/output/A.mp4",
    overlaysDir: "/ch/overlays",
    postTimes: "8:00",
    usedSlots: [],
    now: NOW,
    listFiles: () => ["B.jpg"],
  });
  assert.equal(r.thumbnailPath, null);
  assert.equal(r.scheduleISO, "2026-07-09T08:00:00");
});

test("prepareJob: hết slot -> scheduleISO null", () => {
  const r = prepareJob({
    videoPath: "/ch/output/A.mp4",
    overlaysDir: "/ch/overlays",
    postTimes: "8:00",
    usedSlots: ["2026-07-09T08:00:00"],
    now: NOW,
    listFiles: () => ["A.jpg"],
  });
  assert.equal(r.scheduleISO, null);
});

const emptyUploads = async () => ({ scheduledUrls: new Set(), usedSlots: [] });

test("queue: chạy tuần tự, 2 video cùng kênh vào 2 slot khác nhau (cache tích luỹ)", async () => {
  const calls = [];
  const q = createUploadQueue({
    readChannelUploads: emptyUploads,
    connect: async () => ({ page: {} }),
    runUpload: async ({ title, scheduleISO }) => { calls.push({ title, scheduleISO }); },
    now: () => NOW,
    listFiles: () => ["v1.jpg", "v2.jpg"],
  });

  q.enqueue({ sheetName: "K", gpmHost: "h", profileId: "p", videoPath: "/o/v1.mp4", overlaysDir: "/ov", title: "v1", postTimes: "8:00, 18:00", sourceUrl: "http://u/1" });
  q.enqueue({ sheetName: "K", gpmHost: "h", profileId: "p", videoPath: "/o/v2.mp4", overlaysDir: "/ov", title: "v2", postTimes: "8:00, 18:00", sourceUrl: "http://u/2" });
  await q.drain();

  assert.deepEqual(calls, [
    { title: "v1", scheduleISO: "2026-07-09T08:00:00" },
    { title: "v2", scheduleISO: "2026-07-09T18:00:00" },
  ]);
});

test("queue: URL đã lên lịch trên Sheet thì bỏ qua (tránh trùng)", async () => {
  let ran = false;
  const q = createUploadQueue({
    readChannelUploads: async () => ({ scheduledUrls: new Set(["http://u/1"]), usedSlots: ["2026-07-09T08:00:00"] }),
    connect: async () => ({ page: {} }),
    runUpload: async () => { ran = true; },
    now: () => NOW,
    listFiles: () => [],
  });
  await q.enqueue({ sheetName: "K", gpmHost: "h", profileId: "p", videoPath: "/o/v1.mp4", overlaysDir: "/ov", title: "v1", postTimes: "8:00", sourceUrl: "http://u/1" });
  assert.equal(ran, false);
});

test("queue: retry khi lỗi TRƯỚC upload rồi thành công", async () => {
  const statuses = [];
  let attempts = 0;
  const q = createUploadQueue({
    readChannelUploads: emptyUploads,
    connect: async () => ({ page: {} }),
    runUpload: async ({ onUploaded }) => {
      attempts++;
      if (attempts === 1) throw new Error("lỗi tạm");
      onUploaded();
    },
    now: () => NOW, listFiles: () => ["v1.jpg"],
    retries: 3, retryDelayMs: 1, sleepFn: () => Promise.resolve(),
    setUploadStatus: async (ch, row, st) => { statuses.push(st); },
  });
  await q.enqueue({ sheetName: "K", gpmHost: "h", profileId: "p", videoPath: "/o/v1.mp4", overlaysDir: "/ov", title: "v1", postTimes: "8:00", rowIndex: 2, sourceUrl: "http://u/1" });
  await q.drain();
  assert.equal(attempts, 2);
  assert.ok(statuses.some((s) => /lên lịch/.test(s)));
});

test("queue: KHÔNG retry sau khi đã bắt đầu upload (tránh trùng)", async () => {
  const statuses = [];
  let attempts = 0;
  const q = createUploadQueue({
    readChannelUploads: emptyUploads,
    connect: async () => ({ page: {} }),
    runUpload: async ({ onUploaded }) => { attempts++; onUploaded(); throw new Error("lỗi sau upload"); },
    now: () => NOW, listFiles: () => [], retries: 3, sleepFn: () => Promise.resolve(),
    setUploadStatus: async (ch, row, st) => { statuses.push(st); },
  });
  await q.enqueue({ sheetName: "K", gpmHost: "h", profileId: "p", videoPath: "/o/v1.mp4", overlaysDir: "/ov", title: "v1", postTimes: "8:00", rowIndex: 2, sourceUrl: "http://u/1" });
  await q.drain();
  assert.equal(attempts, 1);
  assert.ok(statuses.some((s) => s.startsWith("❌")));
  assert.ok(!statuses.some((s) => /lên lịch/.test(s)));
});

// ---- Đóng trình duyệt GPM khi hàng đợi rảnh ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const job = (n) => ({
  sheetName: "K", gpmHost: "h", profileId: "p", videoPath: `/o/v${n}.mp4`,
  overlaysDir: "/ov", title: `v${n}`, postTimes: "8:00, 18:00", sourceUrl: `http://u/${n}`,
});

// Hàng đợi với connect/closeConn ghi sự kiện; idleCloseMs nhỏ để test nhanh.
function idleQueue(over = {}) {
  const events = [];
  const logs = [];
  const q = createUploadQueue({
    readChannelUploads: emptyUploads,
    connect: async () => { events.push("connect"); return { page: {}, browser: {} }; },
    closeConn: async (gpmHost, profileId) => { events.push(`close ${gpmHost}/${profileId}`); },
    runUpload: async () => {},
    now: () => NOW, listFiles: () => [],
    idleCloseMs: 5, flushMs: 1000, sleepFn: () => Promise.resolve(),
    log: (m) => logs.push(m),
    ...over,
  });
  return { q, events, logs };
}

test("idle close: rảnh quá hạn -> đóng trình duyệt, job sau mở lại", async () => {
  const { q, events } = idleQueue();
  await q.enqueue(job(1));
  await q.drain();
  await sleep(40);
  assert.deepEqual(events, ["connect", "close h/p"]);

  await q.enqueue(job(2));
  await q.drain();
  assert.deepEqual(events, ["connect", "close h/p", "connect"]); // conns đã xoá -> mở lại được
});

test("idle close: job mới trước hạn -> tái dùng trình duyệt, chỉ đóng sau khi xong hết", async () => {
  const { q, events } = idleQueue({ idleCloseMs: 60 });
  await q.enqueue(job(1));
  await q.drain();
  await sleep(5); // ngắn hơn idleCloseMs -> hẹn giờ bị huỷ
  await q.enqueue(job(2));
  await q.drain();
  assert.deepEqual(events, ["connect"]); // chưa đóng, và KHÔNG connect lần hai

  await sleep(120);
  assert.deepEqual(events, ["connect", "close h/p"]);
});

test("idle close: lượt chạy đang diễn ra (runActive) thì không đóng", async () => {
  const { q, events } = idleQueue();
  q.beginRun();
  await q.enqueue(job(1));
  await q.drain();
  await sleep(40);
  assert.deepEqual(events, ["connect"]); // pending=0 nhưng runActive -> giữ nguyên

  q.endRun();
  await sleep(40);
  assert.deepEqual(events, ["connect", "close h/p"]);
});

test("idle close: idleCloseMs=0 -> không bao giờ đóng", async () => {
  const { q, events } = idleQueue({ idleCloseMs: 0 });
  await q.enqueue(job(1));
  await q.drain();
  await sleep(40);
  assert.deepEqual(events, ["connect"]);
});

test("idle close: closeConn ném lỗi -> ghi log, hàng đợi vẫn sống", async () => {
  const { q, events, logs } = idleQueue({
    closeConn: async () => { events.push("close"); throw new Error("GPM tắt rồi"); },
  });
  await q.enqueue(job(1));
  await q.drain();
  await sleep(40);
  assert.ok(logs.some((m) => /Đóng profile p thất bại: GPM tắt rồi/.test(m)));

  await q.enqueue(job(2)); // vẫn kết nối lại được
  await q.drain();
  assert.deepEqual(events, ["connect", "close", "connect"]);
});

test("idle close: job tới giữa lúc đang đóng -> chờ đóng xong rồi mới mở lại", async () => {
  let resolveClose;
  const { q, events } = idleQueue({
    closeConn: async () => {
      events.push("close-start");
      await new Promise((r) => { resolveClose = r; });
      events.push("close-end");
    },
  });
  await q.enqueue(job(1));
  await q.drain();
  await sleep(30);
  assert.deepEqual(events, ["connect", "close-start"]); // đang kẹt trong closeConn

  const p = q.enqueue(job(2));
  await sleep(30);
  assert.deepEqual(events, ["connect", "close-start"]); // KHÔNG được mở lại giữa chừng

  resolveClose();
  await p;
  await q.drain();
  assert.deepEqual(events, ["connect", "close-start", "close-end", "connect"]);
});

test("queue: gửi digest khi rảnh + ghi trạng thái vào Sheet", async () => {
  const statuses = [];
  let digest = null;
  const q = createUploadQueue({
    readChannelUploads: emptyUploads,
    connect: async () => ({ page: {} }),
    runUpload: async ({ onStep }) => { await onStep("b2: upload xong"); },
    now: () => NOW, listFiles: () => ["v1.jpg"],
    flushMs: 5, sleepFn: () => Promise.resolve(),
    setUploadStatus: async (ch, row, st) => { statuses.push([ch, row, st]); },
    notifyDigest: async (batch) => { digest = batch; },
  });
  await q.enqueue({ sheetName: "K", gpmHost: "h", profileId: "p", videoPath: "/o/v1.mp4", overlaysDir: "/ov", title: "v1", postTimes: "8:00", rowIndex: 5, sourceUrl: "http://u/1" });
  await q.drain();
  await new Promise((r) => setTimeout(r, 40)); // đợi flush timer
  assert.ok(digest && digest.length === 1 && digest[0].ok === true);
  assert.ok(statuses.some((s) => s[2] === "⏳ đang upload"));
  assert.ok(statuses.some((s) => /lên lịch/.test(s[2])));
  assert.ok(statuses.every((s) => s[1] === 5));
});

// ─── Tin báo theo từng kênh (ảnh + kết quả trong cùng một tin) ────────────────

// Helper: hàng đợi tối giản có bật khâu chụp ảnh + báo theo kênh.
function reportQueue(over = {}) {
  const logs = [];
  const sent = [];      // [{ sheetName, results, image }]
  const captured = [];  // page đã được chụp
  const closed = [];
  let connects = 0;
  const q = createUploadQueue({
    readChannelUploads: emptyUploads,
    connect: async () => { connects++; return { page: {} }; },
    closeConn: async (host, id) => { closed.push(id); },
    runUpload: async () => {},
    now: () => NOW,
    listFiles: () => ["v1.jpg", "v2.jpg"],
    log: (m) => logs.push(m),
    notifyDigest: async () => {},
    notifyChannel: async (sheetName, results, image) => { sent.push({ sheetName, results, image }); },
    capture: async (page) => { captured.push(page); return Buffer.from("PNG"); },
    flushMs: 1,
    ...over,
  });
  return { q, logs, sent, captured, closed, connects: () => connects };
}

const jobOf = (sheetName, profileId, n) => ({
  sheetName, gpmHost: "h", profileId,
  videoPath: `/o/v${n}.mp4`, overlaysDir: "/ov", title: `v${n}`,
  postTimes: "8:00, 18:00", sourceUrl: `http://u/${sheetName}/${n}`,
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("report: mỗi kênh xong -> 1 tin, mang đúng kết quả của kênh đó", async () => {
  const { q, sent } = reportQueue();
  q.enqueue(jobOf("KenhA", "p1", 1));
  q.enqueue(jobOf("KenhA", "p1", 2));
  q.endChannel("KenhA");
  q.enqueue(jobOf("KenhB", "p2", 1));
  q.endChannel("KenhB");
  await q.drain();

  assert.equal(sent.length, 2, "2 kênh -> 2 tin");
  const a = sent.find((s) => s.sheetName === "KenhA");
  const b = sent.find((s) => s.sheetName === "KenhB");
  assert.equal(a.results.length, 2);
  assert.ok(a.results.every((r) => r.sheetName === "KenhA"), "không lẫn kết quả kênh khác");
  assert.equal(b.results.length, 1);
  assert.equal(a.image.toString(), "PNG");
});

test("report: kênh không có video mới -> không gửi tin, không chụp", async () => {
  const { q, sent, captured } = reportQueue({
    readChannelUploads: async () => ({ scheduledUrls: new Set(["http://u/KenhA/1"]), usedSlots: [] }),
  });
  q.enqueue(jobOf("KenhA", "p1", 1)); // Sheet báo đã lên lịch -> bỏ qua, không có kết quả
  q.endChannel("KenhA");
  await q.drain();

  assert.deepEqual(sent, []);
  assert.deepEqual(captured, [], "không tốn ~20s chụp cho kênh chẳng có gì báo");
});

test("report: gửi đúng 1 lần dù endChannel tới trước hay sau khi job xong", async () => {
  const early = reportQueue();
  early.q.enqueue(jobOf("KenhA", "p1", 1));
  early.q.endChannel("KenhA"); // job chưa chạy xong
  await early.q.drain();
  assert.equal(early.sent.length, 1);

  const late = reportQueue();
  await late.q.enqueue(jobOf("KenhA", "p1", 1));
  await late.q.drain();
  late.q.endChannel("KenhA"); // job đã xong hẳn
  await late.q.drain();
  assert.equal(late.sent.length, 1);
});

test("report: digest tổng đi SAU mọi tin từng kênh và nhận đủ kết quả", async () => {
  const order = [];
  const { q } = reportQueue({
    capture: async () => { await wait(30); return Buffer.from("PNG"); },
    notifyChannel: async (sheetName) => { order.push(`ch:${sheetName}`); },
    notifyDigest: async (batch) => { order.push(`digest:${batch.length}`); },
  });
  q.enqueue(jobOf("KenhA", "p1", 1));
  q.endChannel("KenhA");
  q.enqueue(jobOf("KenhB", "p2", 1));
  q.endChannel("KenhB");
  await q.drain();
  await wait(120);

  assert.equal(order.at(-1), "digest:2", "digest phải là tin cuối và đủ 2 kết quả");
  assert.deepEqual(order.slice(0, 2).sort(), ["ch:KenhA", "ch:KenhB"]);
});

test("report: chụp lỗi -> vẫn gửi tin, image null", async () => {
  const { q, sent, logs } = reportQueue({
    capture: async () => { throw new Error("page chết"); },
  });
  q.enqueue(jobOf("KenhA", "p1", 1));
  q.endChannel("KenhA");
  await q.drain();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].image, null, "mất ảnh không được làm mất kết quả");
  assert.ok(logs.some((m) => /chụp trang Nội dung lỗi: page chết/.test(m)));
});

// Đường phòng thủ: tới lúc báo mà `conns` không còn entry của profile (lượt đóng
// đang bay đã xoá conns, hoặc trình duyệt đã bị đóng). flushMs lớn để digest chưa
// kịp splice `results` — đúng như khi chạy thật, lúc đó runActive vẫn đang bật.
test("report: trình duyệt đã đóng -> gửi tin không ảnh, KHÔNG mở lại profile", async () => {
  const { q, sent, logs, connects } = reportQueue({ idleCloseMs: 1, flushMs: 5000 });
  await q.enqueue(jobOf("KenhA", "p1", 1));
  await q.drain();
  await wait(40);          // hết hạn rảnh -> đóng trình duyệt
  q.endChannel("KenhA");
  await q.drain();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].image, null);
  assert.equal(connects(), 1, "KHÔNG được mở lại profile GPM chỉ để chụp");
  assert.ok(logs.some((m) => /trình duyệt GPM đã đóng/.test(m)));
});

test("report: tắt công tắc ảnh (notifyChannel null) -> không chụp, digest vẫn gửi", async () => {
  let digests = 0;
  const { q, captured } = reportQueue({
    notifyChannel: null,
    notifyDigest: async () => { digests++; },
  });
  q.enqueue(jobOf("KenhA", "p1", 1));
  q.endChannel("KenhA");
  await q.drain();
  await wait(40);

  assert.deepEqual(captured, []);
  assert.equal(digests, 1);
});

test("report: notifyChannel ném lỗi thì hàng đợi không sập", async () => {
  const { q, logs } = reportQueue({
    notifyChannel: async () => { throw new Error("mạng die"); },
  });
  q.enqueue(jobOf("KenhA", "p1", 1));
  q.endChannel("KenhA");
  await q.drain();

  assert.ok(logs.some((m) => /lỗi gửi Telegram: mạng die/.test(m)));
  await q.enqueue(jobOf("KenhA", "p1", 2)); // vẫn nhận job mới bình thường
});

test("report: hẹn giờ đóng trình duyệt bị huỷ trong lúc đang chụp", async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { q, closed } = reportQueue({
    idleCloseMs: 5,
    capture: async () => { await held; return Buffer.from("PNG"); },
  });
  q.enqueue(jobOf("KenhA", "p1", 1));
  q.endChannel("KenhA");
  await wait(60);

  assert.deepEqual(closed, [], "đang chụp thì tuyệt đối không được đóng trình duyệt");
  release();
  await q.drain();
  await wait(60);
  assert.deepEqual(closed, ["p1"], "chụp xong mới hẹn lại giờ đóng");
});
