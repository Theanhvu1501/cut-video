# Flexible Resolution Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `download.js` so YouTube downloads succeed for videos that don't expose an exact 720p H.264 stream, while keeping render output at 1280×720.

**Architecture:** Single-line change to the yt-dlp `format` selector in `downloadVideo()`. Verification harness uses `yt-dlp --simulate --print format_id` to assert what the selector picks for known URLs — no test framework required. `render.js` already scales arbitrary input to 1280×720 on every filter branch, so no render-side changes.

**Tech Stack:** Node.js, Electron, yt-dlp (bundled at `bin/yt-dlp.exe`), ffmpeg (bundled at `bin/ffmpeg.exe`), youtube-dl-exec, PowerShell on Windows.

**Reference spec:** `docs/superpowers/specs/2026-05-19-download-flexible-resolution-design.md`

---

## Files

- Modify: `download.js` (lines 192–193, inside `downloadVideo`)

No new files. No deletions. `downloadVideoWithYtdl` (line 233) is unused dead code — leave it alone per spec non-goals.

---

## Verification Strategy (read this once before starting)

This project has no test framework (`package.json` line 11 returns an error for `npm test`). For a single-line yt-dlp format-string change, introducing one is overkill. Instead, the plan uses `yt-dlp --simulate` as the verification harness:

```
.\bin\yt-dlp.exe -f "<FORMAT_STRING>" --simulate --print "format_id" --print "resolution" --print "vcodec" <URL>
```

`--simulate` does format selection and prints the chosen stream's metadata WITHOUT downloading. This lets us assert "given this format selector, yt-dlp picks stream X for URL Y" — equivalent to a unit test for the selector logic.

Pick **two known test URLs** before starting:
- **URL_A** — a video that you know exposes 1080p H.264 (most major YouTube channels). If unsure, use `https://www.youtube.com/watch?v=jNQXAC9IVRw` (the first ever YouTube video, 240p only — handy for the "low-res fallback" case) plus any modern 4K channel for the 1080p case.
- **URL_B** — a video that previously failed with the strict 720p selector (from `failed_urls.txt` if you have one). If none available, any current video where `--list-formats` shows no entry with exactly height=720 + H.264.

Substitute these URLs literally into the commands below.

---

## Task 1: Establish Baseline (current selector behavior)

**Files:** None modified. Read-only verification.

- [ ] **Step 1: Inspect current format string**

Read `download.js` lines 192–193 and confirm it matches:

```js
format:
  "bestvideo[height=720][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height=720][ext=mp4][vcodec^=avc]",
```

Expected: exact match. If different, STOP and reconcile with spec before continuing.

- [ ] **Step 2: Dry-run current selector against URL_A (the "should pick 1080p" case)**

Run in PowerShell from repo root:

```powershell
.\bin\yt-dlp.exe -f "bestvideo[height=720][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height=720][ext=mp4][vcodec^=avc]" --simulate --print "format_id" --print "resolution" --print "vcodec" "<URL_A>"
```

Expected output: prints a 720p H.264 format (resolution `1280x720`, vcodec starts with `avc1`). Record the output — this is the baseline.

- [ ] **Step 3: Dry-run current selector against URL_B (the "previously failing" case)**

Run:

```powershell
.\bin\yt-dlp.exe -f "bestvideo[height=720][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height=720][ext=mp4][vcodec^=avc]" --simulate --print "format_id" --print "resolution" --print "vcodec" "<URL_B>"
```

Expected: `ERROR: Requested format is not available` (or similar). This confirms the strict selector is the failure cause.

If URL_B succeeds with the current selector, pick a different URL_B — one that genuinely fails today — otherwise the change cannot be validated.

---

## Task 2: Update the format string

**Files:**
- Modify: `download.js:192-193`

- [ ] **Step 1: Apply the change**

Replace the `format` field inside the `options` object of `downloadVideo` (line 190–207 region).

Before:

```js
  const options = {
    output: output,
    format:
      "bestvideo[height=720][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height=720][ext=mp4][vcodec^=avc]",
    mergeOutputFormat: "mp4",
```

After:

```js
  const options = {
    output: output,
    format:
      "bestvideo[height<=1080][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4][vcodec^=avc]/bestvideo[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[ext=mp4][vcodec^=avc]",
    mergeOutputFormat: "mp4",
```

Only the `format:` line changes. Indentation matches the surrounding code (2 spaces). Trailing comma preserved.

- [ ] **Step 2: Verify the file still parses**

Run from repo root:

```powershell
node --check download.js
```

Expected: no output (exit 0). If syntax error reported, fix the quoting/escaping in the format string before continuing.

---

## Task 3: Verify new selector behavior

**Files:** None modified.

- [ ] **Step 1: Dry-run new selector against URL_A**

```powershell
.\bin\yt-dlp.exe -f "bestvideo[height<=1080][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4][vcodec^=avc]/bestvideo[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[ext=mp4][vcodec^=avc]" --simulate --print "format_id" --print "resolution" --print "vcodec" "<URL_A>"
```

Expected: resolution is at most `1920x1080`, vcodec starts with `avc1`. If URL_A has 1080p H.264 available, resolution should be `1920x1080` (improved over the 720p baseline from Task 1 Step 2). If not, it should be 720p H.264 (same as baseline, still valid).

- [ ] **Step 2: Dry-run new selector against URL_B (the previously failing case)**

```powershell
.\bin\yt-dlp.exe -f "bestvideo[height<=1080][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4][vcodec^=avc]/bestvideo[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[ext=mp4][vcodec^=avc]" --simulate --print "format_id" --print "resolution" --print "vcodec" "<URL_B>"
```

Expected: prints a format (any height, vcodec `avc1*`) — NO error. This is the core regression-fix evidence. Record the output.

- [ ] **Step 3: Sanity check the 4K cap**

If you have a known 4K YouTube URL (URL_C), confirm the selector still caps at 1080p:

```powershell
.\bin\yt-dlp.exe -f "bestvideo[height<=1080][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4][vcodec^=avc]/bestvideo[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/best[ext=mp4][vcodec^=avc]" --simulate --print "resolution" "<URL_C>"
```

Expected: `1920x1080` (NOT 3840x2160 or higher). If you skip this URL, note that you skipped it in the commit message body so a future reader knows the 4K cap wasn't end-to-end verified.

---

## Task 4: Commit the change

**Files:** Already staged from Task 2.

- [ ] **Step 1: Review the diff one more time**

```powershell
git diff download.js
```

Expected: single-line change to the `format:` field, nothing else.

- [ ] **Step 2: Stage and commit**

```powershell
git add download.js
git commit -m @'
feat: allow YouTube downloads up to 1080p with graceful fallback

Replace strict `height=720` selector with `height<=1080`, fallback
chain to any H.264 mp4 if 1080p/720p H.264 unavailable. render.js
already scales arbitrary input to 1280x720, so no render changes
required.

Spec: docs/superpowers/specs/2026-05-19-download-flexible-resolution-design.md
'@
```

Expected: commit created. If pre-commit hook fails, fix the underlying issue and create a NEW commit (do NOT `--amend`).

- [ ] **Step 3: Confirm clean state**

```powershell
git status
```

Expected: working tree clean for `download.js`. The unrelated `M package.json`, `M projects/Line.json`, `M thumb.js` from the session start may still be present — that's fine, they're out of scope.

---

## Task 5: End-to-end smoke test (real download + render)

**Files:** None modified. This is post-change validation.

This task is slower (depends on real download + render times) but is the only way to confirm the change is correct in production. If you're confident in the simulation results from Task 3, this is still required before declaring done.

- [ ] **Step 1: Prepare a fresh test URL list**

Create a temporary file `urls.test.txt` at repo root with 2–3 URLs:
- URL_A (1080p H.264 expected)
- URL_B (previously failing, now expected to succeed)
- One arbitrary URL of your choice

```powershell
@"
<URL_A>
<URL_B>
<URL_C_or_any>
"@ | Out-File -Encoding utf8 urls.test.txt
```

- [ ] **Step 2: Point the project config at the test list**

Open `projects/Line.json` (or whichever project you use for testing). Temporarily set `settings.download.urlsFile` to `./urls.test.txt`. Note the original value so you can restore it.

If you'd rather not touch the project JSON, instead run the download with the env override directly — but the project config path is simpler.

- [ ] **Step 3: Run the download**

From the Electron app, trigger the download via the UI as normal. Or from CLI:

```powershell
$env:PROJECT_NAME = "Line"; node download.js
```

Expected: all 3 URLs download successfully. The files land in the `overlays/` directory configured in the project. Resolutions will vary per source (1080p, 720p, or whatever yt-dlp picks).

- [ ] **Step 4: Verify resolutions of downloaded files**

```powershell
Get-ChildItem overlays\*.mp4 | ForEach-Object { $info = .\bin\ffprobe.exe -v error -select_streams v:0 -show_entries stream=width,height,codec_name -of csv=p=0 $_.FullName; Write-Host "$($_.Name) -> $info" }
```

Or just one at a time:

```powershell
.\bin\ffprobe.exe -v error -select_streams v:0 -show_entries stream=width,height,codec_name -of default=nw=1 overlays\<filename>.mp4
```

Expected: `width<=1920`, `height<=1080`, `codec_name=h264`. At least one file should now be larger than 720p (proving the cap moved up); URL_B's file should exist (proving the fallback works).

- [ ] **Step 5: Run render against the downloaded files**

Trigger a render via the Electron UI (or however you normally invoke `render.js`) against the test project. Verify the output video is 1280×720 and looks correct (no distortion, no color/aspect issues).

```powershell
.\bin\ffprobe.exe -v error -select_streams v:0 -show_entries stream=width,height -of default=nw=1 <output_file>.mp4
```

Expected: `width=1280`, `height=720`.

- [ ] **Step 6: Restore project config and clean up**

Restore `settings.download.urlsFile` in `projects/Line.json` to its original value. Delete `urls.test.txt`. Optionally delete the test files from `overlays/` if you don't want them in your real working set.

```powershell
Remove-Item urls.test.txt
# Restore projects/Line.json manually or via git checkout if untouched elsewhere
```

- [ ] **Step 7: Final status check**

```powershell
git status
```

Expected: no new changes from this task. Only the single download.js commit from Task 4 in the branch.

---

## Done criteria

All five tasks checked off, AND:
- Task 3 Step 2 printed a valid format (not an error) for URL_B
- Task 5 Step 4 showed at least one downloaded file > 720p height (or, if none of your test URLs happened to expose 1080p H.264, an explicit note in the commit explaining why)
- Task 5 Step 5 produced a 1280×720 render with no visual issues

If any of those don't hold, the plan is not complete — diagnose before declaring done.
