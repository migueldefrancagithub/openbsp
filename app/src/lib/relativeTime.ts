const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return `${m}m`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h}h`;
  }
  if (diff < WEEK) {
    const d = Math.floor(diff / DAY);
    return `${d}d`;
  }
  // Older: short date
  const date = new Date(timestamp);
  const month = date.toLocaleDateString("en-GB", { month: "short" });
  return `${date.getDate()} ${month}`;
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
