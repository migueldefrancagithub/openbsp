import type { Locale } from "@/lib/i18n";

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export function campaignStatusLabel(status: string, locale: Locale): string {
  const pt: Record<string, string> = {
    draft: "Rascunho",
    scheduled: "Agendada",
    running: "A enviar",
    paused: "Pausada",
    completed: "Concluída",
    failed: "Falhou",
    cancelled: "Cancelada",
  };
  const en: Record<string, string> = {
    draft: "Draft",
    scheduled: "Scheduled",
    running: "Sending",
    paused: "Paused",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return (locale === "pt" ? pt : en)[status] ?? status;
}

export function campaignStatusTone(status: string): string {
  switch (status) {
    case "running":
      return "border-[#2b4f8a]/30 bg-[#eef3fb] text-[#2b4f8a]";
    case "completed":
      return "border-[#0d6b61]/30 bg-[#edf8f6] text-[#0d6b61]";
    case "paused":
    case "scheduled":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "failed":
    case "cancelled":
      return "border-[#e0533d]/30 bg-[#fdf1ef] text-[#b3261e]";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

export function campaignKindLabel(kind: string, locale: Locale): string {
  switch (kind) {
    case "channel_template":
      return locale === "pt" ? "Template aprovado" : "Approved template";
    case "channel_text":
      return locale === "pt" ? "Texto (janela 24h)" : "Text (24h window)";
    case "micro_lab":
      return locale === "pt" ? "Micro-campanha" : "Micro campaign";
    default:
      return locale === "pt" ? "Legado (Meta direto)" : "Legacy (Meta direct)";
  }
}

export function recipientStatusLabel(status: string, locale: Locale): string {
  const pt: Record<string, string> = {
    pending: "Na fila",
    queued: "A enviar",
    dispatching: "Sem confirmação",
    sent: "Enviada",
    delivered: "Entregue",
    read: "Lida",
    replied: "Respondeu",
    clicked: "Clicou",
    failed: "Falhou",
    skipped: "Bloqueada",
  };
  const en: Record<string, string> = {
    pending: "Queued",
    queued: "Sending",
    dispatching: "Unconfirmed",
    sent: "Sent",
    delivered: "Delivered",
    read: "Read",
    replied: "Replied",
    clicked: "Clicked",
    failed: "Failed",
    skipped: "Blocked",
  };
  return (locale === "pt" ? pt : en)[status] ?? status;
}

export function recipientStatusTone(status: string): string {
  switch (status) {
    case "sent":
    case "delivered":
      return "bg-[#eef3fb] text-[#2b4f8a]";
    case "read":
    case "replied":
    case "clicked":
      return "bg-[#edf8f6] text-[#0d6b61]";
    case "failed":
      return "bg-[#fdf1ef] text-[#b3261e]";
    case "skipped":
    case "dispatching":
      return "bg-amber-50 text-amber-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export function blockReasonLabel(code: string | undefined, locale: Locale): string {
  const pt: Record<string, string> = {
    RECIPIENT_NOT_ALLOWLISTED: "Fora da allowlist do piloto",
    DND: "Não incomodar",
    LOST: "Lead perdido",
    OPT_OUT: "Pediu para não receber",
    RECENT_CAMPAIGN: "Recebeu campanha recente",
    SERVICE_WINDOW_EXPIRED: "Janela de 24h fechada",
    INVALID_RECIPIENT: "Número inválido",
    CANCELLED: "Campanha cancelada",
    OUTBOX_UNKNOWN: "Sem confirmação do provedor",
    SEND_FAILED: "Envio falhou",
    CHANNEL_TEMPLATE_NOT_APPROVED: "Template não aprovado",
    HUB_PILOT_KILL_SWITCH_ACTIVE: "Kill switch do piloto",
  };
  const en: Record<string, string> = {
    RECIPIENT_NOT_ALLOWLISTED: "Outside the pilot allowlist",
    DND: "Do not disturb",
    LOST: "Lost lead",
    OPT_OUT: "Opted out",
    RECENT_CAMPAIGN: "Got a recent campaign",
    SERVICE_WINDOW_EXPIRED: "24h window closed",
    INVALID_RECIPIENT: "Invalid number",
    CANCELLED: "Campaign cancelled",
    OUTBOX_UNKNOWN: "No provider confirmation",
    SEND_FAILED: "Send failed",
    CHANNEL_TEMPLATE_NOT_APPROVED: "Template not approved",
    HUB_PILOT_KILL_SWITCH_ACTIVE: "Pilot kill switch",
  };
  if (!code) return "";
  return (locale === "pt" ? pt : en)[code] ?? code.replace(/_/g, " ").toLowerCase();
}

export function leadStatusLabel(status: string | undefined, locale: Locale): string {
  const pt: Record<string, string> = {
    new: "Novo",
    interested: "Interessado",
    asked_price: "Pediu preço",
    wants_booking: "Quer agendar",
    awaiting_human: "Aguarda equipa",
    booked: "Agendado",
    confirmed: "Confirmado",
    attended: "Compareceu",
    no_show: "Faltou",
    lost: "Perdido",
  };
  const en: Record<string, string> = {
    new: "New",
    interested: "Interested",
    asked_price: "Asked price",
    wants_booking: "Wants booking",
    awaiting_human: "Awaiting team",
    booked: "Booked",
    confirmed: "Confirmed",
    attended: "Attended",
    no_show: "No-show",
    lost: "Lost",
  };
  return (locale === "pt" ? pt : en)[status ?? "new"] ?? status ?? "";
}

export function percent(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

/** Pilot pacing: 15 sends every ~65 s. */
export function estimateDurationMs(eligible: number, batchSize: number, batchIntervalMs: number): number {
  if (eligible <= 0) return 0;
  return Math.ceil(eligible / batchSize) * batchIntervalMs;
}

export function humanDuration(ms: number, locale: Locale): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return locale === "pt" ? `~${minutes} min` : `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return locale === "pt" ? `~${hours}h${rest ? ` ${rest}min` : ""}` : `~${hours}h${rest ? ` ${rest}m` : ""}`;
}
