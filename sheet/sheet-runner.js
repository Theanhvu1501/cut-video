import path from "path";
import { todayStr, computeRemaining, recordRendered } from "./runner-state.js";

export function pickRandomBackground(files, rand = Math.random) {
  if (!files.length) return null;
  return files[Math.min(files.length - 1, Math.floor(rand() * files.length))];
}

export function createSheetRunner(deps) {
  const {
    config, sheetsApi, downloader, renderer, listBackgrounds,
    ensureDirs, stateStore, emit, now, pLimitFn, rand, unlink,
  } = deps;
  let timer = null;

  async function runChannel(ch, today) {
    if (!ch.enabled) return;
    const channelRoot = path.join(config.channelsRoot, ch.sheetName);
    const { backgroundsDir, overlaysDir, outputDir } = ensureDirs(channelRoot);
    const backgrounds = listBackgrounds(backgroundsDir);
    if (!backgrounds.length) {
      emit({ type: "error", channel: ch.sheetName, message: "Chưa có background (.mp4) trong folder kênh." });
      return;
    }
    const state = stateStore.load();
    const remaining = computeRemaining(state[ch.sheetName], ch.videosPerDay, today);
    if (remaining <= 0) { emit({ type: "channel-status", channel: ch.sheetName, status: "đủ hôm nay" }); return; }

    const urls = await sheetsApi.readChannelUrls(ch.sheetName);
    const pending = urls.filter((u) => u.status === "").slice(0, remaining);
    if (!pending.length) { emit({ type: "channel-status", channel: ch.sheetName, status: "hết URL mới" }); return; }

    const limit = pLimitFn(config.renderConcurrency || 2);
    await Promise.all(pending.map((item) => limit(async () => {
      try {
        emit({ type: "channel-status", channel: ch.sheetName, status: "đang tải", url: item.url });
        const dl = await downloader(item.url, overlaysDir, { proxy: ch.proxy });
        const bg = pickRandomBackground(backgrounds, rand);
        const outputPath = path.join(outputDir, `${dl.title}.mp4`);
        emit({ type: "channel-status", channel: ch.sheetName, status: "đang render", url: item.url });
        await renderer({
          overlayFile: dl.filePath, backgroundFile: path.join(backgroundsDir, bg),
          outputPath, renderMode: ch.renderMode, cfg: ch.cfg,
        });
        await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, "done");
        // stateStore.load/save are synchronous — no await between them, so concurrent
        // pLimit tasks cannot interleave this load-modify-save (no lost increments).
        const s = stateStore.load();
        recordRendered(s, ch.sheetName, today);
        stateStore.save(s);
        try { unlink(dl.filePath); } catch { /* ignore */ }
        emit({ type: "video-rendered", channel: ch.sheetName, outputPath, sourceUrl: item.url, title: dl.title });
      } catch (e) {
        const msg = String(e?.message || e).slice(0, 200);
        try { await sheetsApi.setUrlStatus(ch.sheetName, item.rowIndex, `error: ${msg}`); } catch { /* ignore */ }
        emit({ type: "error", channel: ch.sheetName, url: item.url, message: msg });
      }
    })));
  }

  async function runNow(sheetName) {
    const today = todayStr(now());
    let channels = await sheetsApi.readConfigSheet();
    if (sheetName) channels = channels.filter((c) => c.sheetName === sheetName);
    for (const ch of channels) await runChannel(ch, today);
    emit({ type: "done" });
  }

  function start(intervalMs) {
    stop();
    runNow().catch((e) => emit({ type: "error", message: String(e?.message || e) }));
    timer = setInterval(() => runNow().catch((e) => emit({ type: "error", message: String(e?.message || e) })), intervalMs);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  return { runNow, start, stop };
}
