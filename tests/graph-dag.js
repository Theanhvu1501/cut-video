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

// Bước 1 của việc phá tie: nếu hai câu lệnh trong cùng lớp topo có filter + nhãn vào đã
// chuẩn hoá GIỐNG HỆT nhau, không được lấy vị trí trong mảng gốc để phân định — vị trí đó
// vô nghĩa về cấu trúc (đó chính là thứ công cụ này tồn tại để loại bỏ), nhưng
// Array.prototype.sort ổn định sẽ ngầm rơi về nó nếu sort key không phân biệt được hai
// phần tử. Nhìn xuống MỘT tầng: multiset chuỗi filter của các câu lệnh tiêu thụ trực tiếp
// output của nó (downstream). Tính từ toàn bộ danh sách câu lệnh qua nhãn nối chúng, nên
// chỉ phụ thuộc cấu trúc đồ thị, không phụ thuộc thứ tự mảng đầu vào — hai graph đẳng cấu
// dù đảo thứ tự mảng vẫn ra cùng khoá downstream cho từng câu lệnh tương ứng.
function downstreamConsumerKeys(stmts) {
  const consumersByLabel = new Map();
  for (const s of stmts) {
    for (const l of s.ins) {
      if (!consumersByLabel.has(l)) consumersByLabel.set(l, []);
      consumersByLabel.get(l).push(s.filter);
    }
  }
  const keys = new Map();
  for (const s of stmts) {
    const consumers = [];
    for (const l of s.outs) consumers.push(...(consumersByLabel.get(l) || []));
    consumers.sort();
    keys.set(s, consumers.join(" "));
  }
  return keys;
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

  // Lookahead một tầng để phá tie đúng cấu trúc — xem comment tại downstreamConsumerKeys.
  // Tính một lần cho cả graph, dùng chung cho mọi lớp topo.
  const downstreamKeys = downstreamConsumerKeys(stmts);

  let n = 0;
  const pending = [...stmts];
  const ordered = [];
  while (pending.length) {
    const ready = pending.filter((s) => s.ins.every((l) => known.has(l)));
    if (!ready.length) {
      throw new Error(`graph có nhãn treo hoặc vòng lặp: ${pending.map((s) => s.filter).join(" | ")}`);
    }
    // Sắp thứ tự trong cùng một lớp topo bằng chuỗi filter + tên nhãn ĐÃ chuẩn hoá của
    // input, cộng thêm lookahead downstream để phá tie khi hai câu lệnh có filter+input
    // giống hệt nhau — ba thứ đó so được giữa hai graph khác tên nhãn, nên số L{n} gán ra
    // giống nhau cho hai graph đẳng cấu bất kể thứ tự mảng gốc.
    const readyKeyed = ready
      .map((s) => ({
        s,
        key: `${s.filter} ${s.ins.map((l) => map.get(l)).join(",")} ${downstreamKeys.get(s)}`,
      }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    // Nếu sau lookahead vẫn còn hai câu lệnh trùng key hoàn toàn thì đó là hai nhánh đối
    // xứng THẬT — không còn thông tin cấu trúc nào phân biệt được chúng nữa. Phải NÉM LỖI
    // chứ không được đoán: với một oracle dùng làm test hồi quy, "từ chối so kèm lý do rõ"
    // là an toàn, còn "đoán rồi coi hai nhánh tương đương" có thể gán nhầm nhãn qua lại,
    // khiến hai graph thực sự khác nhau bị báo "bằng nhau" một cách âm thầm — sai lệch đó
    // sẽ không ai phát hiện ra cho tới khi ffmpeg render sai.
    for (let i = 1; i < readyKeyed.length; i++) {
      if (readyKeyed[i].key === readyKeyed[i - 1].key) {
        throw new Error(
          `graph có nhánh đối xứng, normalizer không phân biệt được: ${readyKeyed[i - 1].s.filter}, ${readyKeyed[i].s.filter}`
        );
      }
    }

    for (const { s } of readyKeyed) {
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
