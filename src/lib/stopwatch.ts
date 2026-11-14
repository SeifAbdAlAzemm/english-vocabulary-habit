import type { Interval } from "./model";

export function validIntervals(value: unknown): value is Interval[] {
  if (!Array.isArray(value) || value.length > 10000) return false;
  let lastEnd = 0;
  return value.every(item => {
    if (!item || !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < lastEnd || item.end < item.start || item.end > 8640000000000000) return false;
    lastEnd = item.end;
    return true;
  });
}
export function activeMilliseconds(intervals: Interval[]) {
  return intervals.reduce((sum, interval) => sum + interval.end - interval.start, 0);
}
// A delayed heartbeat is a suspended tab/device, not evidence of active study.
export function heartbeat(intervals: Interval[], delta: number): { intervals: Interval[]; running: boolean } {
  if (delta < 0 || delta > 3000 || !Number.isFinite(delta) || !intervals.length) return { intervals, running: false };
  return { intervals: intervals.map((interval, index) => index === intervals.length - 1 ? { ...interval, end: interval.end + delta } : interval), running: true };
}
export function formatTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
