// Chia danh sách URL thành từng lô để nghỉ giữa các lô.
//
// Bản portable chạy 30 video rồi nghỉ 120s. Tải liên tục hàng trăm URL từ một IP là
// cách nhanh nhất để bị YouTube gắn cờ, kể cả khi đã có PO token và cookie sạch —
// nghỉ giữa lô là điểm "hạ nhiệt" để tránh chuyện đó.

// size <= 0 (hoặc không phải số) = tắt chia lô -> một lô duy nhất, giữ nguyên hành
// vi cũ. Danh sách rỗng trả mảng rỗng chứ không phải [[]], để chỗ gọi không phải
// nghỉ giữa hai lô không tồn tại.
export function chunkIntoBatches(items, size) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];

  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0 || n >= list.length) return [list];

  const batches = [];
  for (let i = 0; i < list.length; i += n) batches.push(list.slice(i, i + n));
  return batches;
}
