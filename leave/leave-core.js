// Tính phép năm.
//
// Quy tắc:
//  1. Năm vào chính thức: tích 1 ngày/tháng. Vào giữa tháng vẫn tính tròn 1 ngày
//     cho tháng đó, và cộng ngay từ đầu tháng (vào 15/10 là dùng được trong T10).
//  2. Từ năm thứ hai trở đi: cấp trọn 12 ngày vào 01/01, không phải tích dần.
//  3. Phép của năm Y dùng tiếp được đến hết 31/03 năm Y+1; qua mốc đó phần chưa
//     nghỉ bị xoá, không cộng dồn tiếp.
//  4. Trong quý 1 tồn tại hai quỹ (năm cũ + năm mới) thì trừ quỹ năm cũ trước,
//     vì nó sắp hết hạn.
//
// Ngày tháng dùng chuỗi "YYYY-MM-DD" và so sánh trực tiếp bằng phép so sánh chuỗi
// — đúng thứ tự thời gian với định dạng ISO, mà tránh hẳn lệch múi giờ của Date.

export const DEFAULT_POLICY = {
  firstYearMonthlyAccrual: 1, // ngày/tháng trong năm vào chính thức
  annualGrant: 12, // ngày cấp trọn vào 01/01 từ năm thứ hai
  carryOverUntil: "03-31", // hạn dùng phép năm cũ, tính trong năm kế tiếp
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(s, label) {
  if (typeof s !== "string" || !DATE_RE.test(s))
    throw new Error(`${label} phải có dạng YYYY-MM-DD, nhận được: ${JSON.stringify(s)}`);
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31)
    throw new Error(`${label} không phải ngày hợp lệ: ${s}`);
  return { y, m, d };
}

// Hạn dùng của quỹ năm Y: hết ngày 31/03 năm Y+1.
export function expiryOf(year, policy = DEFAULT_POLICY) {
  return `${year + 1}-${policy.carryOverUntil}`;
}

// Số ngày phép của quỹ năm `year` đã được cộng tính đến thời điểm `at`.
export function grantedAsOf(year, officialStart, at, policy = DEFAULT_POLICY) {
  const start = parseDate(officialStart, "officialStart");
  const now = parseDate(at, "at");
  if (year < start.y) return 0; // chưa vào làm
  if (at < officialStart) return 0;

  if (year > start.y) {
    // Cấp trọn gói đầu năm: có đủ ngay 01/01, miễn là đã tới năm đó.
    return now.y >= year ? policy.annualGrant : 0;
  }

  // Năm đầu: cộng dần theo tháng, tính từ tháng vào chính thức.
  const lastMonth = now.y > year ? 12 : now.m;
  const months = lastMonth - start.m + 1;
  return Math.max(0, months) * policy.firstYearMonthlyAccrual;
}

function sortTaken(taken) {
  return [...taken]
    .map((t, i) => {
      const days = Number(t.days);
      if (!Number.isFinite(days) || days <= 0)
        throw new Error(`taken[${i}].days phải là số dương, nhận được: ${JSON.stringify(t.days)}`);
      parseDate(t.date, `taken[${i}].date`);
      return { date: t.date, days, note: t.note };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Tính số dư phép tại một thời điểm.
 *
 * @param officialStart ngày vào chính thức, "YYYY-MM-DD"
 * @param asOf          thời điểm cần biết số dư, "YYYY-MM-DD"
 * @param taken         các lần đã nghỉ: [{ date, days, note? }]
 * @returns {{
 *   balance: number,       số ngày còn dùng được tại asOf
 *   buckets: Array,        chi tiết từng quỹ theo năm
 *   forfeited: number,     tổng số ngày đã mất vì quá hạn 31/03
 *   shortfall: Array,      những lần nghỉ vượt quỹ (không đủ phép để trừ)
 *   expiringSoon: object|null  quỹ sắp hết hạn và hạn chót của nó
 * }}
 */
export function computeLeave({ officialStart, asOf, taken = [], policy = DEFAULT_POLICY }) {
  const start = parseDate(officialStart, "officialStart");
  const now = parseDate(asOf, "asOf");
  if (asOf < officialStart)
    throw new Error(`asOf (${asOf}) không được trước ngày vào chính thức (${officialStart})`);

  const years = [];
  for (let y = start.y; y <= now.y; y++) years.push(y);

  const used = new Map(years.map((y) => [y, 0]));
  const shortfall = [];

  // Trừ theo thứ tự thời gian, mỗi lần nghỉ lấy từ quỹ cũ nhất còn hạn.
  for (const t of sortTaken(taken)) {
    let need = t.days;
    for (const y of years) {
      if (need <= 0) break;
      if (t.date > expiryOf(y, policy)) continue; // quỹ đã hết hạn tại thời điểm nghỉ
      const avail = grantedAsOf(y, officialStart, t.date, policy) - used.get(y);
      if (avail <= 0) continue;
      const take = Math.min(avail, need);
      used.set(y, used.get(y) + take);
      need -= take;
    }
    if (need > 0) shortfall.push({ date: t.date, days: need, note: t.note });
  }

  let balance = 0;
  let forfeited = 0;
  const buckets = years.map((y) => {
    const expiresOn = expiryOf(y, policy);
    const expired = asOf > expiresOn;
    // Khi đã quá hạn, chốt theo số ngày được cộng tính tới đúng ngày hết hạn.
    const granted = grantedAsOf(y, officialStart, expired ? expiresOn : asOf, policy);
    const u = used.get(y);
    const left = Math.max(0, granted - u);
    if (expired) forfeited += left;
    else balance += left;
    return { year: y, granted, used: u, remaining: expired ? 0 : left, expired, expiresOn };
  });

  // Quỹ sắp hết hạn: quỹ còn hạn cũ nhất mà vẫn còn ngày chưa nghỉ.
  const soon = buckets.find((b) => !b.expired && b.remaining > 0) || null;

  return {
    balance,
    buckets,
    forfeited,
    shortfall,
    expiringSoon: soon ? { year: soon.year, remaining: soon.remaining, expiresOn: soon.expiresOn } : null,
  };
}
