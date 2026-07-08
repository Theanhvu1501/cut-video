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
