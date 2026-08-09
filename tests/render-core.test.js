import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildComplexFilter,
  resolveFfmpegPaths,
  buildStudioInputs,
  blurFrameLayers,
  frameGeometry,
  frameOverlayGeometry,
  pickAsset,
  resolveBlurFrameAssets,
  encoderSettings,
  extractFfmpegError,
  pickPersonPos,
  personGeometry,
  personOverlayX,
  cropPersonLayer,
  resolvePersonAsset,
  resolvePresetAssets,
  renderOne,
} from "../sheet/render-core.js";

test("topTransparent uses opacity and overlay at 0:0", () => {
  const f = buildComplexFilter("topTransparent", { opacity: 0.7 });
  const joined = f.join("|");
  assert.match(joined, /colorchannelmixer=aa=0\.7\[top_video\]/);
  assert.ok(f.includes("[base_video][top_video]overlay=0:0[combined_video]"));
  assert.ok(f.includes("[1:a]volume=1.0[overlay_audio]"));
});

test("chromaKey embeds color + similarity, overlay at H-h", () => {
  const f = buildComplexFilter("chromaKey", { chromaColor: "D4F9D7", chromaSimilarity: 0.3 });
  assert.match(f.join("|"), /colorkey=0xD4F9D7:0\.3:0\.1,format=yuva420p\[overlay_video\]/);
  assert.ok(f.includes("[0:v][overlay_video]overlay=0:H-h[combined_video]"));
});

test("crop uses cropHeight/cropYOffset", () => {
  const f = buildComplexFilter("crop", { cropHeight: 150, cropYOffset: 550 });
  assert.match(f.join("|"), /crop=1280:150:0:550\[cropped\]/);
  assert.ok(f.includes("[0:v][overlay_video]overlay=0:H-h[combined_video]"));
});

// ===== Mode crop: lớp ảnh người phía trên dải crop =====

const personCfg = (over = {}) => ({
  cropHeight: 220, cropYOffset: 490,
  personEnabled: true, personFile: "/img/co-gai.png", personPos: "center", personScale: 0.9,
  ...over,
});

test("pickPersonPos: random bốc một trong ba, giá trị lạ về center", () => {
  assert.equal(pickPersonPos("left"), "left");
  assert.equal(pickPersonPos("right"), "right");
  assert.equal(pickPersonPos("center"), "center");
  assert.equal(pickPersonPos("lung tung"), "center");
  assert.equal(pickPersonPos(undefined), "center");
  // rand cố định -> chốt được từng nhánh của "random".
  assert.equal(pickPersonPos("random", () => 0), "left");
  assert.equal(pickPersonPos("random", () => 0.5), "center");
  assert.equal(pickPersonPos("random", () => 0.99), "right");
});

test("personGeometry: cao theo personScale, đáy sát mép trên dải crop", () => {
  // Phần khung trên dải crop = 720 - 220 = 500; 500 * 0.9 = 450
  assert.deepEqual(personGeometry(personCfg()), { h: 450, y: 720 - 220 - 450 });
  // Kịch trần: cao đúng bằng phần khung còn lại, y = 0
  assert.deepEqual(personGeometry(personCfg({ personScale: 1 })), { h: 500, y: 0 });
});

test("personGeometry: chiều cao luôn chẵn (yuv420p) và personScale lạ về mặc định", () => {
  // 720-150=570; 570*0.9=513 -> phải làm tròn xuống 512
  assert.equal(personGeometry(personCfg({ cropHeight: 150 })).h, 512);
  const fallback = personGeometry(personCfg({ personScale: 0.9 })).h;
  for (const bad of [0, -1, 5, "abc", undefined]) {
    assert.equal(personGeometry(personCfg({ personScale: bad })).h, fallback, `hỏng với ${bad}`);
  }
});

test("personOverlayX: trái/phải sát mép, giữa căn giữa", () => {
  assert.equal(personOverlayX("left"), "0");
  assert.equal(personOverlayX("center"), "(W-w)/2");
  assert.equal(personOverlayX("right"), "W-w");
});

test("cropPersonLayer: cần cả công tắc lẫn file đã chốt", () => {
  assert.equal(cropPersonLayer(personCfg()), true);
  assert.equal(cropPersonLayer(personCfg({ personEnabled: false })), false);
  assert.equal(cropPersonLayer(personCfg({ personFile: "" })), false);
});

test("crop: lớp người tắt -> graph y hệt trước đây (chống hồi quy)", () => {
  const truoc = [
    "[1:v]scale=1280:720,crop=1280:150:0:550[cropped];" +
      "[cropped]eq=brightness=-1.0:contrast=3.0:gamma=1.2:saturation=0[filtered];" +
      "[filtered]format=yuva420p,colorchannelmixer=aa=0.8[overlay_video]",
    "[0:v][overlay_video]overlay=0:H-h[combined_video]",
    "[1:a]volume=1.0[overlay_audio]",
  ];
  assert.deepEqual(buildComplexFilter("crop", { cropHeight: 150, cropYOffset: 550 }), truoc);
  // Có đường dẫn nhưng chưa bật công tắc thì cũng không đổi gì.
  assert.deepEqual(
    buildComplexFilter("crop", { cropHeight: 150, cropYOffset: 550, personFile: "/img/a.png" }),
    truoc,
  );
});

test("crop: lớp người bật -> scale giữ tỉ lệ, dải crop đè LÊN TRÊN người", () => {
  const f = buildComplexFilter("crop", personCfg({ personPos: "right" }));
  const joined = f.join("|");

  assert.match(joined, /\[2:v\]scale=-2:450\[person\]/, "giữ tỉ lệ gốc, cao 450");
  assert.match(joined, /\[0:v\]\[person\]overlay=W-w:50\[with_person\]/, "người nằm trên nền");
  assert.ok(
    f.includes("[with_person][overlay_video]overlay=0:H-h[combined_video]"),
    "dải crop phải là lớp cuối, không được để ảnh che phụ đề",
  );
  assert.ok(f.includes("[1:a]volume=1.0[overlay_audio]"));
});

test("buildStudioInputs: crop nạp ảnh người bằng -loop 1", () => {
  assert.deepEqual(buildStudioInputs("crop", personCfg()), [
    { file: "/img/co-gai.png", inputOptions: ["-loop", "1"] },
  ]);
  assert.deepEqual(buildStudioInputs("crop", personCfg({ personEnabled: false })), []);
  // Mode khác không được ăn theo lớp người.
  assert.deepEqual(buildStudioInputs("topTransparent", personCfg()), []);
});

test("resolvePersonAsset: đường dẫn hỏng -> cảnh báo, KHÔNG ném lỗi", () => {
  const r = resolvePersonAsset({ personEnabled: true, personPath: "/khong/co/that" });
  assert.equal(r.personFile, "");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /ảnh người/i);

  // Tắt công tắc thì không kiểm tra gì, không cảnh báo.
  assert.deepEqual(resolvePersonAsset({ personEnabled: false, personPath: "/khong/co/that" }), {
    personFile: "", warnings: [],
  });
});

test("resolvePersonAsset: trỏ vào thư mục thì bốc một ảnh trong đó", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "person-"));
  fs.writeFileSync(path.join(dir, "a.png"), "x");
  fs.writeFileSync(path.join(dir, "b.png"), "x");
  fs.writeFileSync(path.join(dir, "bo-qua.txt"), "x");
  try {
    const r = resolvePersonAsset({ personEnabled: true, personPath: dir }, () => 0);
    assert.equal(r.personFile, path.join(dir, "a.png"));
    assert.deepEqual(r.warnings, []);
    assert.equal(
      resolvePersonAsset({ personEnabled: true, personPath: dir }, () => 0.99).personFile,
      path.join(dir, "b.png"),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("keepColor builds per-color masks and alphamerge", () => {
  const f = buildComplexFilter("keepColor", { keepColors: ["F6FF00"], keepSimilarity: 0.2 });
  const joined = f.join("|");
  assert.match(joined, /colorkey=0xF6FF00:0\.2:0\.1,alphaextract,negate\[mask_0\]/);
  assert.match(joined, /\[src_main\]\[mask_0\]alphamerge\[final_isolated\]/);
});

test("chromaKeyAuto uses same filter as chromaKey (color already resolved)", () => {
  const cfg = { chromaColor: "2B4052", chromaSimilarity: 0.3 };
  const auto = buildComplexFilter("chromaKeyAuto", cfg);
  const manual = buildComplexFilter("chromaKey", cfg);
  assert.deepEqual(auto, manual);
  assert.match(auto.join("|"), /colorkey=0x2B4052:0\.3:0\.1/);
});

test("invalid mode falls back to topTransparent", () => {
  const f = buildComplexFilter("nope", {});
  assert.ok(f.some((s) => s.includes("[base_video][top_video]overlay=0:0[combined_video]")));
});

// ===== blurFrame: nền mờ + video gốc thu nhỏ + khung + hiệu ứng =====

const BF = {
  frameEnabled: true,
  frameFile: "khung.png",
  effectEnabled: true,
  effectFile: "mua.mp4",
  bgBlurEnabled: true,
  bgBlur: 25,
  effectBlend: "screen",
  effectOpacity: 0.6,
};

test("blurFrame: cả 4 lớp — chỉ số input và thứ tự chồng lớp", () => {
  const f = buildComplexFilter("blurFrame", BF);
  assert.ok(f.includes("[0:v]scale=1280:720,gblur=sigma=25[bf_bg]"));
  assert.ok(
    f.includes("[1:v]scale=1088:612,format=yuva420p,colorchannelmixer=aa=0.85[bf_main]")
  );
  assert.ok(f.includes("[bf_bg][bf_main]overlay=96:54:shortest=1[bf_stage1]"));
  assert.ok(f.includes("[2:v]scale=1088:612[bf_frame]"));
  assert.ok(f.includes("[bf_stage1][bf_frame]overlay=96:54:shortest=1[bf_stage2]"));
  assert.ok(f.includes("[3:v]scale=1280:720,format=yuv420p[bf_fx]"));
  assert.ok(
    f.includes("[bf_stage2][bf_fx]blend=all_mode=screen:all_opacity=0.6:shortest=1[combined_video]")
  );
  assert.ok(f.includes("[1:a]volume=1.0[overlay_audio]"));
});

test("blurFrame: tắt hết 3 công tắc — chỉ còn nền sắc nét + video gốc", () => {
  const f = buildComplexFilter("blurFrame", {});
  assert.ok(f.includes("[0:v]scale=1280:720[bf_bg]"));
  assert.ok(!f.join("|").includes("gblur"));
  assert.ok(f.includes("[bf_bg][bf_main]overlay=96:54:shortest=1[combined_video]"));
  assert.ok(!f.join("|").includes("[2:v]"));
  assert.ok(!f.join("|").includes("blend="));
});

test("blurFrame: tắt khung thì hiệu ứng tụt xuống [2:v]", () => {
  const f = buildComplexFilter("blurFrame", { ...BF, frameEnabled: false });
  const joined = f.join("|");
  assert.ok(!joined.includes("bf_frame"));
  assert.ok(f.includes("[2:v]scale=1280:720,format=yuv420p[bf_fx]"));
  assert.ok(!joined.includes("[3:v]"));
  assert.ok(
    f.includes("[bf_stage1][bf_fx]blend=all_mode=screen:all_opacity=0.6:shortest=1[combined_video]")
  );
});

test("blurFrame: tắt hiệu ứng thì khung là bước cuối", () => {
  const f = buildComplexFilter("blurFrame", { ...BF, effectEnabled: false });
  assert.ok(f.includes("[bf_stage1][bf_frame]overlay=96:54:shortest=1[combined_video]"));
  assert.ok(!f.join("|").includes("[3:v]"));
});

test("blurFrame: mọi tổ hợp công tắc đều có đúng một [combined_video]", () => {
  for (const frameEnabled of [false, true]) {
    for (const effectEnabled of [false, true]) {
      for (const bgBlurEnabled of [false, true]) {
        const f = buildComplexFilter("blurFrame", {
          ...BF,
          frameEnabled,
          effectEnabled,
          bgBlurEnabled,
        });
        const outs = f.join("|").match(/\[combined_video\]/g) || [];
        assert.equal(outs.length, 1, `tổ hợp ${frameEnabled}/${effectEnabled}/${bgBlurEnabled}`);
      }
    }
  }
});

test("blurFrame: công tắc bật nhưng thiếu file thì bỏ qua lớp đó", () => {
  const layers = blurFrameLayers({ frameEnabled: true, frameFile: "", effectEnabled: true, effectFile: "" });
  assert.equal(layers.frame, false);
  assert.equal(layers.effect, false);
  const f = buildComplexFilter("blurFrame", { frameEnabled: true, effectEnabled: true });
  assert.ok(f.includes("[bf_bg][bf_main]overlay=96:54:shortest=1[combined_video]"));
});

test("blurFrame: bgBlur = 0 coi như tắt làm mờ", () => {
  const f = buildComplexFilter("blurFrame", { bgBlurEnabled: true, bgBlur: 0 });
  assert.ok(!f.join("|").includes("gblur"));
});

test("blurFrame: mainScale/mainOpacity tuỳ chỉnh được", () => {
  const f = buildComplexFilter("blurFrame", { mainScale: 0.5, mainOpacity: 0.4 });
  assert.ok(f.includes("[1:v]scale=640:360,format=yuva420p,colorchannelmixer=aa=0.4[bf_main]"));
  assert.ok(f.includes("[bf_bg][bf_main]overlay=320:180:shortest=1[combined_video]"));
});

test("effectBlend normal (mặc định) — chồng thẳng đúng như Premiere", () => {
  const f = buildComplexFilter("blurFrame", { effectEnabled: true, effectFile: "fx.mp4" });
  const joined = f.join("|");
  assert.ok(!joined.includes("blend="), "Normal không dùng blend");
  assert.ok(!joined.includes("lumakey"), "Normal không khử nền tối");
  // Premiere: Opacity 15%, Blend Mode Normal
  assert.ok(
    f.includes("[2:v]scale=1280:720,format=yuva420p,colorchannelmixer=aa=0.15[bf_fx]")
  );
  assert.ok(f.includes("[bf_stage1][bf_fx]overlay=0:0:shortest=1[combined_video]"));
});

test("effectBlend screen — cộng sáng như cũ", () => {
  const f = buildComplexFilter("blurFrame", {
    effectEnabled: true, effectFile: "fx.mp4", effectBlend: "screen", effectOpacity: 0.6,
  });
  assert.ok(f.includes("[2:v]scale=1280:720,format=yuv420p[bf_fx]"));
  assert.ok(
    f.includes("[bf_stage1][bf_fx]blend=all_mode=screen:all_opacity=0.6:shortest=1[combined_video]")
  );
});

test("effectBlend lumakey — khử nền tối rồi chồng", () => {
  const f = buildComplexFilter("blurFrame", {
    effectEnabled: true, effectFile: "fx.mp4",
    effectBlend: "lumakey", effectKeyThreshold: 0.2, effectOpacity: 0.8,
  });
  assert.ok(!f.join("|").includes("blend="));
  assert.ok(
    f.includes("[2:v]scale=1280:720,format=yuva420p,lumakey=threshold=0.2:tolerance=0.1:softness=0.1,colorchannelmixer=aa=0.8[bf_fx]")
  );
  assert.ok(f.includes("[bf_stage1][bf_fx]overlay=0:0:shortest=1[combined_video]"));
});

test("effectBlend rác rơi về normal", () => {
  const f = buildComplexFilter("blurFrame", {
    effectEnabled: true, effectFile: "fx.mp4", effectBlend: "hỏng",
  });
  const joined = f.join("|");
  assert.ok(!joined.includes("blend="));
  assert.ok(!joined.includes("lumakey"));
  assert.ok(f.includes("[bf_stage1][bf_fx]overlay=0:0:shortest=1[combined_video]"));
});

test("effectBlend vẫn đúng chỉ số input khi có cả khung", () => {
  for (const blend of ["normal", "screen", "lumakey"]) {
    const f = buildComplexFilter("blurFrame", {
      frameEnabled: true, frameFile: "k.png",
      effectEnabled: true, effectFile: "fx.mp4", effectBlend: blend,
    });
    assert.ok(f.some((s) => s.startsWith("[2:v]") && s.includes("bf_frame")), blend);
    assert.ok(f.some((s) => s.startsWith("[3:v]") && s.includes("bf_fx")), blend);
    assert.equal((f.join("|").match(/\[combined_video\]/g) || []).length, 1, blend);
  }
});

test("thông số mặc định khớp bảng Premiere của dự án", () => {
  const f = buildComplexFilter("blurFrame", {
    frameEnabled: true, frameFile: "k.png", effectEnabled: true, effectFile: "fx.mp4",
    bgBlurEnabled: true, bgBlur: 33,
  });
  // Nền 1920x1080 fit khung + Gaussian Blur
  assert.ok(f.includes("[0:v]scale=1280:720,gblur=sigma=33[bf_bg]"));
  // Video gốc: Scale 85 -> 1088x612 tại (96,54), Opacity 85%
  assert.ok(
    f.includes("[1:v]scale=1088:612,format=yuva420p,colorchannelmixer=aa=0.85[bf_main]")
  );
  assert.ok(f.some((s) => s.includes("overlay=96:54")));
  // Hiệu ứng 640x360 fit khung, Opacity 15%, Blend Normal
  assert.ok(f.some((s) => s.includes("colorchannelmixer=aa=0.15[bf_fx]")));
});

test("frameScale mặc định 1.0 — khung phủ khít đúng vùng video", () => {
  const f = buildComplexFilter("blurFrame", { frameEnabled: true, frameFile: "k.png" });
  assert.ok(f.includes("[2:v]scale=1088:612[bf_frame]"));
  assert.ok(f.includes("[bf_stage1][bf_frame]overlay=96:54:shortest=1[combined_video]"));
});

test("frameScale > 1 phóng khung quanh cùng tâm để bù viền trong suốt", () => {
  const f = buildComplexFilter("blurFrame", {
    frameEnabled: true, frameFile: "k.png", frameScale: 1.1,
  });
  // 1088*1.1 = 1196.8 -> chẵn 1196 ; 612*1.1 = 673.2 -> chẵn 672
  assert.ok(f.includes("[2:v]scale=1196:672[bf_frame]"));
  assert.ok(f.includes("[bf_stage1][bf_frame]overlay=42:24:shortest=1[combined_video]"));
});

test("frameScale đủ lớn thì khung tràn ra ngoài, overlay toạ độ âm", () => {
  const g = frameOverlayGeometry(0.85, 1.3);
  assert.ok(g.w > 1280, `w=${g.w}`);
  assert.ok(g.x < 0, `x=${g.x}`);
  assert.equal(g.x * 2 + g.w, 1280); // vẫn căn giữa
});

test("frameOverlayGeometry rơi về 1.0 khi hệ số vô lý, luôn chẵn và căn giữa", () => {
  assert.deepEqual(frameOverlayGeometry(0.85, 0), frameOverlayGeometry(0.85, 1));
  assert.deepEqual(frameOverlayGeometry(0.85, -2), frameOverlayGeometry(0.85, 1));
  assert.deepEqual(frameOverlayGeometry(0.85, "hỏng"), frameOverlayGeometry(0.85, 1));
  for (const s of [0.5, 1, 1.07, 1.25]) {
    const g = frameOverlayGeometry(0.85, s);
    assert.equal(g.w % 2, 0);
    assert.equal(g.h % 2, 0);
    assert.equal(g.x * 2 + g.w, 1280);
    assert.equal(g.y * 2 + g.h, 720);
  }
});

test("frameScale không đụng tới lớp video gốc", () => {
  const a = buildComplexFilter("blurFrame", { frameEnabled: true, frameFile: "k.png", frameScale: 1.2 });
  const b = buildComplexFilter("blurFrame", { frameEnabled: true, frameFile: "k.png" });
  const main = (f) => f.find((s) => s.includes("[bf_main]"));
  assert.equal(main(a), main(b));
});

test("frameGeometry luôn trả kích thước chẵn và căn giữa", () => {
  for (const r of [0.85, 0.8449, 0.77, 0.9, 0.66, 1]) {
    const g = frameGeometry(r);
    assert.equal(g.w % 2, 0, `w lẻ ở tỉ lệ ${r}`);
    assert.equal(g.h % 2, 0, `h lẻ ở tỉ lệ ${r}`);
    assert.equal(g.x * 2 + g.w, 1280);
    assert.equal(g.y * 2 + g.h, 720);
  }
});

test("frameGeometry rơi về 0.85 khi tỉ lệ vô lý", () => {
  assert.deepEqual(frameGeometry(0), frameGeometry(0.85));
  assert.deepEqual(frameGeometry(5), frameGeometry(0.85));
  assert.deepEqual(frameGeometry("hỏng"), frameGeometry(0.85));
});

test("buildStudioInputs khớp thứ tự với filter, rỗng với mode cũ", () => {
  assert.deepEqual(buildStudioInputs("topTransparent", BF), []);
  assert.deepEqual(buildStudioInputs("chromaKey", BF), []);
  assert.deepEqual(buildStudioInputs("blurFrame", BF), [
    { file: "khung.png", inputOptions: ["-loop", "1"] },
    { file: "mua.mp4", inputOptions: ["-stream_loop", "-1"] },
  ]);
  assert.deepEqual(buildStudioInputs("blurFrame", { ...BF, frameEnabled: false }), [
    { file: "mua.mp4", inputOptions: ["-stream_loop", "-1"] },
  ]);
});

test("pickAsset: file dùng nguyên, thư mục bốc ngẫu nhiên, hỏng trả rỗng", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-"));
  const a = path.join(dir, "a.png");
  const b = path.join(dir, "b.png");
  fs.writeFileSync(a, "x");
  fs.writeFileSync(b, "x");
  fs.writeFileSync(path.join(dir, "bo-qua.txt"), "x");

  assert.equal(pickAsset(a, [".png"]), a);
  assert.equal(pickAsset(dir, [".png"], () => 0), a);
  assert.equal(pickAsset(dir, [".png"], () => 0.99), b);
  assert.equal(pickAsset(dir, [".mp4"]), "");
  assert.equal(pickAsset(path.join(dir, "khong-ton-tai.png"), [".png"]), "");
  assert.equal(pickAsset("", [".png"]), "");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolveBlurFrameAssets cảnh báo thay vì ném lỗi khi đường dẫn hỏng", () => {
  const r = resolveBlurFrameAssets({
    frameEnabled: true,
    framePath: "/khong/co/that.png",
    effectEnabled: true,
    effectPath: "",
  });
  assert.equal(r.frameFile, "");
  assert.equal(r.effectFile, "");
  assert.equal(r.warnings.length, 2);
  assert.ok(r.warnings[0].includes("khung"));
  assert.ok(r.warnings[1].includes("hiệu ứng"));
});

test("resolveBlurFrameAssets im lặng khi cả hai công tắc đều tắt", () => {
  const r = resolveBlurFrameAssets({ framePath: "/khong/co/that.png" });
  assert.deepEqual(r.warnings, []);
  assert.equal(r.frameFile, "");
});

test("resolveFfmpegPaths returns string paths", () => {
  const { ffmpegPath, ffprobePath } = resolveFfmpegPaths();
  assert.equal(typeof ffmpegPath, "string");
  assert.equal(typeof ffprobePath, "string");
  assert.ok(ffmpegPath.length > 0);
  assert.ok(ffprobePath.length > 0);
});

test("encoderSettings: tắt GPU thì dùng libx264 + crf", () => {
  const { codec, options } = encoderSettings(false, "h264_nvenc");
  assert.equal(codec, "libx264");
  assert.ok(options.includes("-crf 23"));
  assert.ok(options.includes("-preset ultrafast"));
});

test("encoderSettings: nvenc dùng cq/vbr chứ không dùng crf", () => {
  const { codec, options } = encoderSettings(true, "h264_nvenc");
  assert.equal(codec, "h264_nvenc");
  assert.ok(options.includes("-cq:v 23"));
  assert.ok(options.includes("-rc:v vbr"));
  assert.ok(!options.some((o) => o.startsWith("-crf")));
});

test("encoderSettings: GPU không phải nvenc chỉ nhận tham số tối thiểu", () => {
  const { codec, options } = encoderSettings(true, "h264_qsv");
  assert.equal(codec, "h264_qsv");
  assert.deepEqual(options, ["-pix_fmt yuv420p", "-movflags +faststart"]);
});

test("encoderSettings: lùi về CPU cho ra đúng cấu hình libx264", () => {
  assert.deepEqual(encoderSettings(false, "h264_nvenc"), encoderSettings(false, "h264_qsv"));
});

test("extractFfmpegError giữ lại dòng [...] mà fluent-ffmpeg vứt bỏ", () => {
  const stderr = [
    "  Stream #0:0 -> #0:0 (h264 -> h264_nvenc)",
    "[h264_nvenc @ 0000021b] Cannot load nvcuda.dll",
    "[h264_nvenc @ 0000021b] The minimum required Nvidia driver for nvenc is 551.76 or newer",
    "Error initializing output stream 0:0",
    "frame=    0 fps=0.0 q=0.0 Lsize=       0KiB",
    "Conversion failed!",
  ].join("\n");
  const out = extractFfmpegError(stderr);
  assert.ok(out.includes("Cannot load nvcuda.dll"));
  assert.ok(out.includes("Error initializing output stream"));
  assert.ok(!out.includes("Conversion failed!"));
});

test("extractFfmpegError trả chuỗi rỗng khi stderr không có dòng lỗi nào", () => {
  assert.equal(extractFfmpegError("frame=  120 fps=30\nvideo:1kB"), "");
  assert.equal(extractFfmpegError(""), "");
  assert.equal(extractFfmpegError(undefined), "");
});

// ===== Composer: chốt asset của preset trước khi dựng graph =====

test("resolvePresetAssets chốt file cụ thể khi path là thư mục", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-anh-"));
  fs.writeFileSync(path.join(dir, "a.png"), "x");
  const preset = {
    layers: [
      { id: "bg", source: { type: "background" }, geometry: { fit: "full" } },
      { id: "im", source: { type: "image", path: dir }, geometry: { fit: "full" } },
      { id: "ov", source: { type: "overlay" }, geometry: { fit: "full" } },
    ],
  };
  const r = resolvePresetAssets(preset, () => 0);
  assert.equal(r.preset.layers[1].source.path, path.join(dir, "a.png"));
  assert.deepEqual(r.warnings, []);
});

test("resolvePresetAssets KHÔNG sửa preset đầu vào", () => {
  const preset = {
    layers: [{ id: "im", source: { type: "image", path: "/khong/co" }, geometry: { fit: "full" } }],
  };
  resolvePresetAssets(preset, () => 0);
  assert.equal(preset.layers[0].source.path, "/khong/co");
});

test("resolvePresetAssets cảnh báo và để path rỗng khi đường dẫn hỏng, không ném", () => {
  const preset = {
    layers: [
      { id: "im", label: "Khung", source: { type: "image", path: "/khong/co/thuc" }, geometry: { fit: "full" } },
    ],
  };
  const r = resolvePresetAssets(preset, () => 0);
  assert.equal(r.preset.layers[0].source.path, "");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Khung/);
});

test("resolvePresetAssets bỏ qua lớp không cần file", () => {
  const preset = {
    layers: [
      { id: "bg", source: { type: "background" }, geometry: { fit: "full" } },
      { id: "s", source: { type: "solid", color: "black" }, geometry: { fit: "box", w: 10, h: 10 } },
      { id: "w", source: { type: "waveform" }, geometry: { fit: "box", w: 10, h: 10 } },
      { id: "ov", source: { type: "overlay" }, geometry: { fit: "full" } },
    ],
  };
  const r = resolvePresetAssets(preset, () => 0);
  assert.deepEqual(r.warnings, []);
});

// I1(b) (bản vá theo review toàn nhánh 2026-08-08): renderOne phải là lớp phòng thủ THỨ HAI
// cho preset composer — sheet-runner.js kiểm trước khi tải video (lớp thứ nhất). render.js
// KHÔNG gọi renderOne (nó có pipeline ffmpeg riêng, chỉ import compilePreset/validatePreset/
// resolvePresetAssets); người gọi renderOne duy nhất ngoài test là electron-main.js. Vẫn cần
// lớp phòng thủ này vì renderOne là hàm export công khai, không tự biết nơi gọi đã kiểm chưa.
// validatePreset ném TRƯỚC khi chạm ffprobe/ffmpeg nên test này gọi renderOne được mà không
// cần file video thật hay mock fluent-ffmpeg: lỗi phải là throw ĐỒNG BỘ, không phải promise
// reject, vì check này nằm trước dòng "return new Promise(...)".
test("renderOne composer: preset không hợp lệ (thiếu lớp overlay) -> ném lỗi TRƯỚC khi chạm ffprobe", () => {
  const badPreset = {
    version: 1, name: "x",
    layers: [{ id: "bg", source: { type: "background" }, geometry: { fit: "full" } }],
  };
  assert.throws(
    () => renderOne({
      overlayFile: "khong-ton-tai.mp4", backgroundFile: "khong-ton-tai.mp4", outputPath: "out.mp4",
      renderMode: "composer", cfg: { preset: badPreset },
    }),
    /preset composer không hợp lệ.*đúng một lớp video gốc/
  );
});

test("renderOne composer: preset hợp lệ -> KHÔNG ném ở bước kiểm (lỗi sau đó, nếu có, đến từ ffprobe file không tồn tại)", () => {
  const okPreset = {
    version: 1, name: "x",
    layers: [
      { id: "bg", source: { type: "background" }, geometry: { fit: "full" } },
      { id: "ov", source: { type: "overlay" }, geometry: { fit: "full" } },
    ],
  };
  // Không throw đồng bộ: renderOne phải đi tới được return new Promise(...). Promise đó rồi
  // sẽ reject vì file không tồn tại (ffprobe thật) — không đợi/assert phần đó, chỉ cần biết
  // hàm không ném lỗi validatePreset ở bước đồng bộ.
  let threwSync = false;
  let p;
  try {
    p = renderOne({
      overlayFile: "khong-ton-tai.mp4", backgroundFile: "khong-ton-tai.mp4", outputPath: "out.mp4",
      renderMode: "composer", cfg: { preset: okPreset },
    });
  } catch {
    threwSync = true;
  }
  assert.equal(threwSync, false);
  assert.ok(p instanceof Promise);
  p.catch(() => {}); // tránh unhandledRejection khi ffprobe thất bại thật ở nền
});
