import fs from "fs";
import path from "path";
import { validatePreset } from "./layer-compiler.js";

// presetsDir truyền vào từ ngoài chứ không tự gọi app.getPath("userData"): render.js là
// tiến trình node riêng, không có đối tượng app của Electron, và test cần thư mục tạm.

// Tên preset đi thẳng vào tên file nên phải làm sạch: "../../x" không được thoát ra ngoài.
function safeName(name) {
  return String(name || "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "preset";
}

export function listPresets(presetsDir) {
  try {
    return fs
      .readdirSync(presetsDir)
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .map((f) => f.slice(0, -".json".length))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  } catch {
    return [];
  }
}

// Trả null thay vì ném: một file preset hỏng không đáng làm chết cả danh sách.
// Hợp đồng là object | null. File parse được nhưng là mảng/số/null thì không phải preset —
// trả null để người gọi không nhận về thứ nó không xử lý được.
export function loadPreset(presetsDir, name) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(presetsDir, `${safeName(name)}.json`), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePreset(presetsDir, preset) {
  const check = validatePreset(preset);
  if (!check.ok) return check;

  // Tên preset bị làm sạch thành tên file, nên hai tên KHÁC NHAU có thể rơi vào cùng một
  // file ("foo/bar" và "foo-bar"; hay "Alpha" và "alpha" trên ổ Windows). Ghi thẳng là xoá
  // mất preset kia mà không ai biết — preset là công sức người dùng, không được im lặng.
  // Lưu lại đúng preset đang có (cùng name) thì vẫn cho, đó là ghi đè hợp lệ.
  // KHÔNG kiểm typeof existing.name: loadPreset đã trả null cho mọi thứ không phải object
  // preset, nên tới đây existing chắc chắn là object. Một file thiếu hẳn trường name vẫn là
  // file của người dùng — thêm điều kiện kiểu chỉ mở lỗ cho nó bị xoá âm thầm.
  const existing = loadPreset(presetsDir, preset?.name);
  if (existing && existing.name !== preset?.name) {
    const cuaAi =
      typeof existing.name === "string"
        ? `preset "${existing.name}"`
        : "một file preset không rõ tên";
    return {
      ok: false,
      errors: [
        `tên "${preset?.name}" trùng chỗ lưu với ${cuaAi} — đổi tên khác, hoặc xoá file đó nếu không cần`,
      ],
    };
  }

  try {
    fs.mkdirSync(presetsDir, { recursive: true });
    fs.writeFileSync(
      path.join(presetsDir, `${safeName(preset?.name)}.json`),
      JSON.stringify(preset, null, 2),
      "utf8"
    );
    return { ok: true, errors: [] };
  } catch (err) {
    return { ok: false, errors: [`không ghi được preset: ${err.message}`] };
  }
}

// Copy preset dựng sẵn sang thư mục người dùng, KHÔNG ghi đè bản đã có: người dùng sửa
// preset dựng sẵn rồi thì lần mở app sau không được mất công sửa đó. Trả về { copied,
// warnings } chứ không chỉ mảng tên: hỏng một file không được làm bỏ những file còn lại,
// và lỗi thật (hết quyền, hết đĩa) phải nói ra được. Người dùng mở app thấy trống trơn
// mà không có lý do là tệ hơn nhiều so với một dòng cảnh báo.
export function ensureBuiltins(presetsDir, builtinDir) {
  const copied = [];
  const warnings = [];
  let files;
  try {
    fs.mkdirSync(presetsDir, { recursive: true });
    files = fs.readdirSync(builtinDir);
  } catch (err) {
    // Thiếu hẳn thư mục dựng sẵn là chuyện bình thường khi chạy từ mã nguồn; còn hỏng vì
    // quyền/đĩa thì phải báo. Không phân biệt được nên nói ra cả hai bằng một câu.
    return { copied, warnings: [`không nạp được preset dựng sẵn: ${err.message}`] };
  }
  for (const f of files) {
    if (!f.toLowerCase().endsWith(".json")) continue;
    const dst = path.join(presetsDir, f);
    if (fs.existsSync(dst)) {
      // Có file rồi thì KHÔNG ghi đè, kể cả khi nó hỏng: đó có thể là bản người dùng đã sửa
      // và chỉ sai một dấu phẩy — ghi đè là xoá mất công sức đó chứ không cứu được gì.
      // Nhưng phải nói ra, không thì người dùng thấy preset không hiện lên mà chẳng hiểu
      // vì sao. Đọc thẳng dst chứ không qua loadPreset: loadPreset áp safeName nên có thể
      // soi vào một file khác với file đang xét.
      let docDuoc = false;
      try {
        const parsed = JSON.parse(fs.readFileSync(dst, "utf8"));
        docDuoc = Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed);
      } catch {
        docDuoc = false;
      }
      if (!docDuoc) {
        warnings.push(`preset ${f} đã có nhưng đọc không được — giữ nguyên, cần sửa hoặc xoá tay`);
      }
      continue;
    }
    try {
      fs.copyFileSync(path.join(builtinDir, f), dst);
      copied.push(f.slice(0, -".json".length));
    } catch (err) {
      warnings.push(`không copy được preset dựng sẵn ${f}: ${err.message}`);
    }
  }
  return { copied, warnings };
}

// Ô Sheet có giá trị thì thắng; để trống thì dùng đường dẫn mặc định trong preset. Trả về
// BẢN SAO: preset gốc được nhiều kênh dùng chung, sửa tại chỗ là kênh sau ăn giá trị của
// kênh trước.
export function applySlotOverrides(preset, overrides = {}) {
  const clone = JSON.parse(JSON.stringify(preset || {}));
  for (const layer of clone.layers || []) {
    const v = layer.slot ? overrides[layer.slot] : undefined;
    if (v === undefined || v === null || String(v).trim() === "") continue;
    layer.source = { ...(layer.source || {}), path: String(v).trim() };
  }
  return clone;
}
