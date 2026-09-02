import type { Locale } from "@/lib/i18n";

export function appointmentStatusLabel(status: string, locale: Locale): string {
  const pt: Record<string, string> = {
    scheduled: "Marcada",
    confirmed: "Confirmada",
    cancelled: "Cancelada",
    completed: "Compareceu",
    no_show: "Faltou",
  };
  const en: Record<string, string> = {
    scheduled: "Booked",
    confirmed: "Confirmed",
    cancelled: "Cancelled",
    completed: "Attended",
    no_show: "No-show",
  };
  return (locale === "pt" ? pt : en)[status] ?? status;
}

export function appointmentStatusTone(status: string): string {
  switch (status) {
    case "confirmed":
    case "completed":
      return "border-[#0d6b61]/30 bg-[#edf8f6] text-[#0d6b61]";
    case "scheduled":
      return "border-[#2b4f8a]/30 bg-[#eef3fb] text-[#2b4f8a]";
    case "no_show":
    case "cancelled":
      return "border-[#e0533d]/30 bg-[#fdf1ef] text-[#b3261e]";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

export function formatTimeIn(timestamp: number, timeZone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(timestamp);
}

export function formatDayIn(date: string, locale: Locale): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { weekday: "short", day: "2-digit", month: "short" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function addDaysLocal(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function startOfWeek(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday first
  return addDaysLocal(date, diff);
}
