export function hexToRgb(hex) {
  const num = parseInt(String(hex).replace("#", ""), 16);
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

export function rgbToHex({ r, g, b }) {
  return [r, g, b]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function distanceSq(a, b) {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

export function mapToNearest(rgb, paletteHex) {
  const palette = paletteHex.map((hex) => ({ hex: hex.replace("#", "").toUpperCase(), rgb: hexToRgb(hex) }));
  let best = palette[0];
  let bestDist = distanceSq(rgb, best.rgb);
  for (let i = 1; i < palette.length; i++) {
    const d = distanceSq(rgb, palette[i].rgb);
    if (d < bestDist) { best = palette[i]; bestDist = d; }
  }
  return best.hex;
}

export function extractFirstFrameBuffer(videoPath, ffmpegPath, { spawn }) {
  return new Promise((resolve, reject) => {
    const args = ["-ss", "0", "-i", videoPath, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"];
    const ff = spawn(ffmpegPath, args);
    const chunks = [];
    let stderr = "";
    ff.stdout.on("data", (d) => chunks.push(d));
    ff.stderr.on("data", (d) => { stderr += d.toString(); });
    ff.on("error", (e) => reject(e));
    ff.on("close", (code) => {
      if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exit ${code} khi trích frame ${videoPath}: ${stderr}`));
    });
  });
}

export async function averageColor(buffer, { sharp }) {
  const { data, info } = await sharp(buffer)
    .resize(64, 64, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let rSum = 0, gSum = 0, bSum = 0;
  const total = width * height;
  for (let i = 0; i < data.length; i += channels) {
    rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2];
  }
  return { r: Math.round(rSum / total), g: Math.round(gSum / total), b: Math.round(bSum / total) };
}

export async function detectChromaColor(videoPath, paletteHex, { ffmpegPath, spawn, sharp }) {
  if (!paletteHex || !paletteHex.length) throw new Error("chromaPalette rỗng");
  const buf = await extractFirstFrameBuffer(videoPath, ffmpegPath, { spawn });
  const avg = await averageColor(buf, { sharp });
  return mapToNearest(avg, paletteHex);
}
