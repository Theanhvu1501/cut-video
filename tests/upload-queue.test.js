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

test("queue: chạy tuần tự, ghi state đã lên lịch + slot đã dùng", async () => {
  let state = {};
  const calls = [];
  const q = createUploadQueue({
    loadState: () => state,
    saveState: (s) => { state = s; },
    connect: async () => ({ page: {} }),
    runUpload: async ({ title, scheduleISO }) => { calls.push({ title, scheduleISO }); },
    now: () => NOW,
    listFiles: () => ["v1.jpg", "v2.jpg"],
  });

  q.enqueue({ sheetName: "K", gpmHost: "h", profileId: "p", videoPath: "/o/v1.mp4", overlaysDir: "/ov", title: "v1", postTimes: "8:00, 18:00" });
  q.enqueue({ sheetName: "K", gpmHost: "h", profileId: "p", videoPath: "/o/v2.mp4", overlaysDir: "/ov", title: "v2", postTimes: "8:00, 18:00" });
  await q.drain();

  // Hai video cùng kênh vào 2 slot khác nhau của ngày mai.
  assert.deepEqual(calls, [
    { title: "v1", scheduleISO: "2026-07-09T08:00:00" },
    { title: "v2", scheduleISO: "2026-07-09T18:00:00" },
  ]);
  assert.equal(state.K.videos["/o/v1.mp4"].status, "scheduled");
  assert.deepEqual(state.K.usedSlots, ["2026-07-09T08:00:00", "2026-07-09T18:00:00"]);
});

test("queue: video đã lên lịch thì bỏ qua (resume)", async () => {
  let state = { K: { usedSlots: ["2026-07-09T08:00:00"], videos: { "/o/v1.mp4": { status: "scheduled" } } } };
  let ran = false;
  const q = createUploadQueue({
    loadState: () => state,
    saveState: (s) => { state = s; },
    connect: async () => ({ page: {} }),
    runUpload: async () => { ran = true; },
    now: () => NOW,
    listFiles: () => [],
  });
  await q.enqueue({ sheetName: "K", gpmHost: "h", profileId: "p", videoPath: "/o/v1.mp4", overlaysDir: "/ov", title: "v1", postTimes: "8:00" });
  assert.equal(ran, false);
});
