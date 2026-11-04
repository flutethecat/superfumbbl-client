// Owner 11-03 (lane 3, Sol r2): how many equal rows fit a box without a scrollbar or a partly visible row.
// n rows take n * rowHeight + (n - 1) * gap; the answer is the largest such n within `room`, from 0 up to `cap`.
export function rowsThatFit(room: number, rowHeight: number, gap: number, cap: number): number {
  if (!(rowHeight > 0) || !(room > 0) || !(cap > 0)) return 0;
  const n = Math.floor((room + Math.max(0, gap)) / (rowHeight + Math.max(0, gap)));
  return Math.max(0, Math.min(cap, n));
}
