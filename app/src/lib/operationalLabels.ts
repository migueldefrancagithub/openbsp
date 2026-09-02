import type { Locale } from "@/lib/i18n";

type LabelPair = readonly [pt: string, en: string];

const ROLES: Record<string, LabelPair> = {
  owner: ["Proprietário", "Owner"],
  admin: ["Administrador", "Administrator"],
  manager: ["Gestor", "Manager"],
  agent: ["Atendente", "Agent"],
  staff: ["Equipa", "Staff"],
  member: ["Membro", "Member"],
  auditor: ["Auditor", "Auditor"],
};

const VERTICALS: Record<string, LabelPair> = {
  clinic: ["Clínica", "Clinic"],
  healthcare: ["Saúde", "Healthcare"],
  beauty: ["Estética e beleza", "Beauty and aesthetics"],
  dental: ["Clínica dentária", "Dental clinic"],
  agency: ["Agência", "Agency"],
  ecommerce: ["Comércio eletrónico", "E-commerce"],
  general: ["Serviços", "Services"],
};

const CHANNEL_STATES: Record<string, LabelPair> = {
  active: ["Ativo", "Active"],
  connected: ["Ligado", "Connected"],
  configured: ["Configurado", "Configured"],
  pending: ["Pendente", "Pending"],
  pending_number: ["Aguardando número", "Waiting for number"],
  pending_webhook: ["Aguardando webhook", "Waiting for webhook"],
  degraded: ["Com atenção", "Needs attention"],
  unhealthy: ["Com falha", "Unhealthy"],
  disabled: ["Desativado", "Disabled"],
  disconnected: ["Desligado", "Disconnected"],
  not_created: ["Ainda não criado", "Not created"],
  unknown: ["Desconhecido", "Unknown"],
  verified: ["Verificado", "Verified"],
  failed: ["Falhou", "Failed"],
  healthy: ["Saudável", "Healthy"],
  ready: ["Pronto", "Ready"],
  blocked: ["Bloqueado", "Blocked"],
};

const SEND_MODES: Record<string, LabelPair> = {
  disabled: ["Envios desativados", "Sending disabled"],
  pilot: ["Piloto autorizado", "Pilot enabled"],
  allowlist: ["Apenas lista autorizada", "Allowlist only"],
  enabled: ["Envios ativos", "Sending enabled"],
  live: ["Em produção", "Live"],
};

const TOKEN_STATES: Record<string, LabelPair> = {
  encrypted: ["Encriptado", "Encrypted"],
  legacy_plaintext: ["Legado sem encriptação", "Legacy unencrypted"],
  missing: ["Em falta", "Missing"],
  valid: ["Válido", "Valid"],
  expiring: ["A expirar", "Expiring"],
  expired: ["Expirado", "Expired"],
  revoked: ["Revogado", "Revoked"],
  unchecked: ["Ainda não verificado", "Not checked"],
  unknown: ["Desconhecido", "Unknown"],
};

const BAN_STATES: Record<string, LabelPair> = {
  clear: ["Sem bloqueio", "Clear"],
  none: ["Sem bloqueio", "None"],
  restricted: ["Restrito", "Restricted"],
  banned: ["Bloqueado", "Banned"],
  blocked: ["Bloqueado", "Blocked"],
  unknown: ["Desconhecido", "Unknown"],
};

const SIGNUP_STATES: Record<string, LabelPair> = {
  created: ["Iniciado", "Started"],
  callback_received: ["Retorno recebido", "Callback received"],
  assets_received: ["Ativos recebidos", "Assets received"],
  connected: ["Ligado", "Connected"],
  failed: ["Falhou", "Failed"],
};

const TEMPLATE_CATEGORIES: Record<string, LabelPair> = {
  marketing: ["Marketing", "Marketing"],
  utility: ["Utilidade", "Utility"],
  authentication: ["Autenticação", "Authentication"],
};

export function roleLabel(value: string | null | undefined, locale: Locale) {
  return labelFrom(ROLES, value, locale);
}

export function verticalLabel(value: string | null | undefined, locale: Locale) {
  return labelFrom(VERTICALS, value, locale);
}

export function channelStateLabel(value: string | null | undefined, locale: Locale) {
  return labelFrom(CHANNEL_STATES, value, locale);
}

export function sendModeLabel(value: string | null | undefined, locale: Locale) {
  return labelFrom(SEND_MODES, value, locale);
}

export function tokenStateLabel(value: string | null | undefined, locale: Locale) {
  return labelFrom(TOKEN_STATES, value, locale);
}

export function banStateLabel(value: string | null | undefined, locale: Locale) {
  return labelFrom(BAN_STATES, value, locale);
}

export function signupStateLabel(value: string | null | undefined, locale: Locale) {
  return labelFrom(SIGNUP_STATES, value, locale);
}

export function templateCategoryLabel(value: string | null | undefined, locale: Locale) {
  return labelFrom(TEMPLATE_CATEGORIES, value, locale);
}

function labelFrom(
  labels: Record<string, LabelPair>,
  value: string | null | undefined,
  locale: Locale,
) {
  if (!value) return locale === "pt" ? "Não informado" : "Not provided";
  const pair = labels[value.trim().toLowerCase()];
  if (pair) return locale === "pt" ? pair[0] : pair[1];
  return humanizeCode(value);
}

function humanizeCode(value: string) {
  const label = value.replace(/[_-]+/g, " ").trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : value;
}
