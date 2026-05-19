# Flexible Resolution Download (720p → up to 1080p)

**Date:** 2026-05-19
**Status:** Approved, ready for implementation plan
**Affected files:** `download.js`

## Background

`download.js` currently forces YouTube downloads to exactly 720p H.264 via the yt-dlp format selector:

```
bestvideo[height=720][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height=720][ext=mp4][vcodec^=avc]
```

YouTube increasingly omits the exact 720p H.264 stream for some videos (only 480p H.264 + 1080p VP9 available, etc.). The strict `height=720` constraint then causes those downloads to fail and the URLs end up in `failed_urls.txt`.

## Goal

Make the download step succeed for videos that don't expose an exact 720p stream, while keeping the render pipeline unchanged. The output of `render.js` remains 1280×720.

## Non-goals

- Higher output resolution (still 720p output)
- Codec changes in the render pipeline
- Changes to `stockDownloader.js` (already has its own `OPTION_CONVERT_720` path)
- Config knobs per project for min/max height (YAGNI)
- Auto-delete of source files after render
- Fixing cookies-related download errors (separate issue, tracked elsewhere)
- Cleaning up the unused `downloadVideoWithYtdl` function

## Design

### Approach

Change only the yt-dlp format string in `download.js`. The render pipeline already scales arbitrary input to 1280×720 on every filter branch — no render-side changes required.

Two alternatives considered and rejected:
- **Pre-normalize after download** (extra ffmpeg pass to convert to 720p before render): redundant, wastes I/O and CPU. `render.js` already does the scale.
- **Per-project config knobs** (`minHeight`, `maxHeight`, `codec` in `projects/<name>.json`): no concrete need yet. Can be added later when a real use case appears.

### Change

**File:** `download.js`
**Function:** `downloadVideo` (line 177)
**Field:** `options.format` (currently line 192–193)

**Before:**
```js
format:
  "bestvideo[height=720][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height=720][ext=mp4][vcodec^=avc]",
```

**After:**
```js
format:
  "bestvideo[height<=1080][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4][vcodec^=avc]/bestvideo[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[ext=mp4][vcodec^=avc]",
```

### How yt-dlp resolves the new selector

yt-dlp tries each `/`-separated branch left-to-right and picks the first one with a match. Each `bestvideo[...]` picks the highest-resolution stream that satisfies the constraints.

| Available streams | Branch chosen | Result |
|---|---|---|
| 1080p H.264 mp4 + m4a audio | 1 | Downloads 1080p H.264 |
| 720p H.264 mp4 + m4a audio (no 1080p H.264) | 1 | Downloads 720p H.264 |
| Only pre-muxed `best` ≤ 1080p H.264 | 2 | Downloads pre-muxed file |
| Only 480p H.264 or lower | 3 | Downloads highest H.264 available |
| Any pre-muxed mp4 H.264 | 4 | Pre-muxed fallback |
| No H.264 mp4 at all | (none) | URL written to `failed_urls.txt` |

### Render-side compatibility

Already verified via grep on `render.js`. All filter branches start with `scale=1280:720`:

- Overlay branches (chroma key, crop, isolated): lines 505, 518, 539, 556, 563, 568
- Background branches: lines 532, 535
- Black/dim overlay branches: lines 611, 614

ffmpeg's `scale` filter handles both upscale (480p → 720p) and downscale (1080p → 720p) transparently. No render-side changes needed.

## Decisions log

| # | Decision | Rationale |
|---|---|---|
| 1 | Motivation: reliability, not quality | YouTube no longer always exposes 720p H.264 |
| 2 | Fallback when no ≥720p stream | Download highest available; render.js upscales |
| 3 | Upper cap | 1080p (avoids 4K bandwidth/storage blowup, marginal quality gain) |
| 4 | Codec | Keep H.264 only (`vcodec^=avc`) — stable render pipeline, ubiquitous up to 1080p |

## Risks

- **Larger source files.** 1080p mp4 is ~2× the size of 720p. Storage and download time both go up. Acceptable.
- **Slightly slower render.** ffmpeg reads/scales larger source. Negligible on SSD + modern CPU. If it becomes a problem, the existing `convertCodec` helper (line 325, currently commented out) can be enabled as a pre-render step.
- **Aspect ratio.** YouTube videos are virtually all 16:9, so `scale=1280:720` is clean. Non-16:9 sources would be distorted — same risk as today, not new.

## Verification after implementation

1. Pick 2–3 URLs known to expose 1080p H.264 → confirm file lands at 1080p in `overlays/` directory.
2. Pick a URL that previously failed because of strict `height=720` → confirm it now succeeds at whatever resolution yt-dlp picks.
3. Run `render.js` against the mixed-resolution batch → confirm output is 1280×720 and visually clean.
