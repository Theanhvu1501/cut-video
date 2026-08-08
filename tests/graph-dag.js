// So sánh hai filter_complex theo ĐỒ THỊ, không theo chuỗi. Thứ tự câu lệnh trong
// filter_complex không ảnh hưởng ffmpeg — nhãn mới là thứ ràng buộc chúng — và tên nhãn
// trung gian là tuỳ ý. So chuỗi thô sẽ báo "khác nhau" ở graph thực chất giống nhau.

// Nhãn là hợp đồng với renderOne: không được đổi tên khi chuẩn hoá.
const CONTRACT_LABELS = new Set(["combined_video", "overlay_audio"]);

// Nhãn nguồn của ffmpeg: [0:v], [1:a]... Chúng cố định, giữ nguyên.
const SOURCE_LABEL = /^\d+:[va]$/;

// Bóc "[a][b]filter=x[c]" thành 3 phần. Không dùng regex cho phần giữa: chuỗi filter có
// thể chứa dấu ngoặc (blend=all_expr='max(A,B)'), regex tham lam sẽ bóc sai.
export function parseStatement(text) {
  const s = String(text);
  let i = 0;
  const ins = [];
  while (s[i] === "[") {
    const end = s.indexOf("]", i);
    if (end < 0) break;
    ins.push(s.slice(i + 1, end));
    i = end + 1;
  }
  let j = s.length;
  const outs = [];
  while (s[j - 1] === "]") {
    const start = s.lastIndexOf("[", j - 1);
    if (start < 0) break;
    outs.unshift(s.slice(start + 1, j - 1));
    j = start;
  }
  return { ins, filter: s.slice(i, j), outs };
}

// Code hiện tại join một số câu lệnh bằng ";" thành một phần tử mảng, số khác để riêng.
export function flattenStatements(filterConfig) {
  return (filterConfig || [])
    .flatMap((part) => String(part).split(";"))
    .map((s) => s.trim())
    .filter(Boolean);
}

// Chẻ "a=1,b=2" thành ["a=1","b=2"]. Không cắt ở dấu phẩy nằm trong ngoặc hoặc trong dấu
// nháy: blend=all_expr='max(A,B)' có dấu phẩy bên trong, chẻ bừa là làm hỏng filter.
export function splitChain(filterText) {
  const s = String(filterText || "");
  const out = [];
  let buf = "";
  let depth = 0;
  let quote = null;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      buf += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; buf += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { out.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out.map((f) => f.trim()).filter(Boolean);
}

// Bung mỗi câu lệnh thành từng filter một, mỗi filter một câu lệnh riêng.
// Lý do: chỗ đặt nhãn trung gian là TUỲ Ý người viết — code cũ chẻ chuỗi của mode crop
// thành 3 câu lệnh, compiler gộp thành 1, hai thứ tương đương hoàn toàn với ffmpeg. Bung
// ra thì dạng chuẩn không còn phụ thuộc chỗ đặt nhãn.
// Filter đầu giữ nhãn vào gốc, filter cuối giữ nhãn ra gốc, ở giữa cấp nhãn tạm.
function expandChains(statements) {
  const out = [];
  let seq = 0;
  for (const s of statements) {
    const filters = splitChain(s.filter);
    if (filters.length <= 1) { out.push(s); continue; }
    let prev = null;
    filters.forEach((f, i) => {
      const first = i === 0;
      const last = i === filters.length - 1;
      const ins = first ? s.ins : [prev];
      const outs = last ? s.outs : [`__ex${seq++}`];
      out.push({ ins, filter: f, outs });
      prev = outs[0];
    });
  }
  return out;
}

// overlay=X:Y[:opt...] -> overlay=@:@[:opt...]. Tách theo ":" chứ không regex: biểu thức
// toạ độ như (W-w)/2 không chứa ":" nên tách an toàn, và các tham số sau phải giữ lại để
// vẫn so được shortest=1.
function blurOverlayCoords(filter) {
  if (!filter.startsWith("overlay=")) return filter;
  const parts = filter.slice("overlay=".length).split(":");
  const rest = parts.length > 2 ? ":" + parts.slice(2).join(":") : "";
  return `overlay=@:@${rest}`;
}

export function canonicalGraph(filterConfig, opts = {}) {
  // Bung chuỗi TRƯỚC khi áp tuỳ chọn: sau khi bung thì mỗi câu lệnh đúng một filter, nên
  // blurOverlayCoords chỉ nhìn vào filter overlay thật, không nhìn vào cả chuỗi.
  const stmts = expandChains(
    flattenStatements(filterConfig).map((t) => parseStatement(t))
  ).map((s) => {
    let filter = s.filter;
    if (opts.ignoreOverlayCoords) filter = blurOverlayCoords(filter);
    if (opts.ignoreShortest) filter = filter.replace(/:shortest=1/g, "");
    return { ...s, filter };
  });

  const map = new Map();
  const known = new Set();
  for (const s of stmts) {
    for (const l of s.ins) {
      if (SOURCE_LABEL.test(l)) { map.set(l, l); known.add(l); }
    }
  }

  let n = 0;
  const pending = [...stmts];
  const ordered = [];
  while (pending.length) {
    const ready = pending.filter((s) => s.ins.every((l) => known.has(l)));
    if (!ready.length) {
      throw new Error(`graph có nhãn treo hoặc vòng lặp: ${pending.map((s) => s.filter).join(" | ")}`);
    }
    // Sắp thứ tự trong cùng một lớp topo bằng chuỗi filter + tên nhãn ĐÃ chuẩn hoá của
    // input — hai thứ đó so được giữa hai graph khác tên nhãn, nên số L{n} gán ra giống
    // nhau cho hai graph đẳng cấu.
    ready.sort((a, b) => {
      const ka = `${a.filter}\u0000${a.ins.map((l) => map.get(l)).join(",")}`;
      const kb = `${b.filter}\u0000${b.ins.map((l) => map.get(l)).join(",")}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    for (const s of ready) {
      for (const l of s.outs) {
        map.set(l, CONTRACT_LABELS.has(l) ? l : `L${n++}`);
        known.add(l);
      }
      ordered.push(s);
      pending.splice(pending.indexOf(s), 1);
    }
  }

  // Sắp cuối cùng theo chuỗi: tên nhãn đã mã hoá vị trí topo nên sắp xếp là an toàn và
  // xoá hẳn ảnh hưởng của thứ tự câu lệnh gốc.
  return ordered
    .map((s) => {
      const ins = s.ins.map((l) => `[${map.get(l)}]`).join("");
      const outs = s.outs.map((l) => `[${map.get(l)}]`).join("");
      return `${ins}${s.filter}${outs}`;
    })
    .sort()
    .join("\n");
}
