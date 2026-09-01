"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Languages } from "lucide-react";
import { cn } from "@/lib/cn";

export type Locale = "pt" | "en";

export const MESSAGES = {
  pt: {
    "nav.operation": "Operação",
    "nav.inbox": "Inbox",
    "nav.leads": "Leads",
    "nav.campaigns": "Campanhas",
    "nav.agents": "Agentes",
    "nav.admin": "Admin",
    "nav.overview": "Resumo",
    "nav.contacts": "Contactos",
    "nav.analytics": "Relatórios",
    "nav.channels": "Canais",
    "nav.channelInbox": "Inbox técnico",
    "nav.templates": "Templates",
    "nav.quickReplies": "Respostas rápidas",
    "nav.support": "Suporte",
    "nav.settings": "Definições",
    "nav.signOut": "Sair",
    "shell.companies": "Clínicas",
    "shell.loading": "A carregar...",
    "shell.loadingWorkspace": "A carregar workspace...",
    "shell.noCompanies": "Ainda não há clínicas.",
    "shell.newCompany": "Nova clínica",
    "shell.quickSwitch": "Abrir rápido...",
    "shell.searchPlaceholder": "Ir para conversa, página ou definição...",
    "shell.noMatches": "Sem resultados.",
    "shell.navigate": "navegar",
    "shell.open": "abrir",
    "shell.results": "resultado",
    "shell.resultsPlural": "resultados",
    "shell.groupNavigate": "Navegar",
    "shell.groupConversations": "Conversas",
    "shell.groupSettings": "Definições",
    "shell.workspaceSettings": "Definições da clínica",
    "shell.connectWhatsapp": "Conectar WhatsApp",
    "locale.label": "Idioma",
    "locale.pt": "PT 🇲🇿",
    "locale.en": "EN 🇬🇧",
    "status.new": "Novo",
    "status.interested": "Interessado",
    "status.asked_price": "Pediu preço",
    "status.wants_booking": "Quer agendar",
    "status.awaiting_human": "Aguardando equipa",
    "status.booked": "Agendado",
    "status.confirmed": "Confirmado",
    "status.lost": "Perdido",
    "op.title": "Operação de hoje",
    "op.eyebrow": "Sistema operacional",
    "op.subtitle":
      "O lead entra, a IA atende, o CRM atualiza, e a equipa só pega decisão, risco ou exceção.",
    "op.openInbox": "Abrir inbox",
    "op.createCampaign": "Criar campanha",
    "op.attention": "Precisa de atenção",
    "op.unread": "Não lidas",
    "op.human": "Aguardando equipa",
    "op.window": "Janela 24h aberta",
    "op.expiring": "A expirar",
    "op.activeBots": "Agentes em conversa",
    "op.pipeline": "Funil operacional",
    "op.recent": "Conversas recentes",
    "op.noRecent": "Nenhuma conversa recebida ainda.",
    "op.nextStep": "Próximo passo",
    "op.actionQueue": "Fila de ação",
    "op.channelsReady": "Canal pronto",
    "op.campaignHealth": "Campanhas",
    "op.agentHealth": "Agentes",
    "op.quickCreators": "Criadores rápidos",
    "op.creatorCampaign": "Campanha",
    "op.creatorAgent": "Agente",
    "op.creatorKnowledge": "Conhecimento",
    "op.creatorService": "Serviço",
    "op.creatorFollowup": "Follow-up",
    "op.action.connect_channel": "Conectar canal WhatsApp",
    "op.action.human_queue": "Responder casos humanos",
    "op.action.unread_threads": "Ler novas mensagens",
    "op.action.window_expiring": "Fechar janela 24h",
    "op.action.publish_agent": "Publicar agente",
    "op.action.agent_validation": "Corrigir agente",
    "op.action.first_campaign": "Criar primeira campanha",
    "op.action.stable": "Sistema estável",
    "op.actionBody.connect_channel": "Sem canal lab verificado para receber e enviar com segurança.",
    "op.actionBody.human_queue": "Há pedidos que a IA marcou para a equipa decidir.",
    "op.actionBody.unread_threads": "Novas mensagens podem mudar o estado do lead.",
    "op.actionBody.window_expiring": "Responder antes da janela de serviço fechar.",
    "op.actionBody.publish_agent": "Crie ou publique um agente antes de automatizar atendimento.",
    "op.actionBody.agent_validation": "Há erros de validação antes de publicar com segurança.",
    "op.actionBody.first_campaign": "Comece com um público pequeno e tracking real.",
    "op.actionBody.stable": "Continue monitorando conversas, agentes e campanhas.",
  },
  en: {
    "nav.operation": "Operation",
    "nav.inbox": "Inbox",
    "nav.leads": "Leads",
    "nav.campaigns": "Campaigns",
    "nav.agents": "Agents",
    "nav.admin": "Admin",
    "nav.overview": "Overview",
    "nav.contacts": "Contacts",
    "nav.analytics": "Reports",
    "nav.channels": "Channels",
    "nav.channelInbox": "Tech inbox",
    "nav.templates": "Templates",
    "nav.quickReplies": "Quick replies",
    "nav.support": "Support",
    "nav.settings": "Settings",
    "nav.signOut": "Sign out",
    "shell.companies": "Clinics",
    "shell.loading": "Loading...",
    "shell.loadingWorkspace": "Loading workspace...",
    "shell.noCompanies": "No clinics yet.",
    "shell.newCompany": "New clinic",
    "shell.quickSwitch": "Quick switch...",
    "shell.searchPlaceholder": "Jump to a conversation, page, or setting...",
    "shell.noMatches": "No matches.",
    "shell.navigate": "navigate",
    "shell.open": "open",
    "shell.results": "result",
    "shell.resultsPlural": "results",
    "shell.groupNavigate": "Navigate",
    "shell.groupConversations": "Conversations",
    "shell.groupSettings": "Settings",
    "shell.workspaceSettings": "Clinic settings",
    "shell.connectWhatsapp": "Connect WhatsApp",
    "locale.label": "Language",
    "locale.pt": "PT 🇲🇿",
    "locale.en": "EN 🇬🇧",
    "status.new": "New",
    "status.interested": "Interested",
    "status.asked_price": "Asked price",
    "status.wants_booking": "Wants booking",
    "status.awaiting_human": "Waiting for team",
    "status.booked": "Booked",
    "status.confirmed": "Confirmed",
    "status.lost": "Lost",
    "op.title": "Today operation",
    "op.eyebrow": "Operating system",
    "op.subtitle":
      "A lead enters, AI replies, CRM updates, and the team only handles decisions, risk, or exceptions.",
    "op.openInbox": "Open inbox",
    "op.createCampaign": "Create campaign",
    "op.attention": "Needs attention",
    "op.unread": "Unread",
    "op.human": "Waiting for team",
    "op.window": "24h window open",
    "op.expiring": "Expiring",
    "op.activeBots": "Agents in conversation",
    "op.pipeline": "Operational funnel",
    "op.recent": "Recent conversations",
    "op.noRecent": "No conversations received yet.",
    "op.nextStep": "Next step",
    "op.actionQueue": "Action queue",
    "op.channelsReady": "Channel ready",
    "op.campaignHealth": "Campaigns",
    "op.agentHealth": "Agents",
    "op.quickCreators": "Quick creators",
    "op.creatorCampaign": "Campaign",
    "op.creatorAgent": "Agent",
    "op.creatorKnowledge": "Knowledge",
    "op.creatorService": "Service",
    "op.creatorFollowup": "Follow-up",
    "op.action.connect_channel": "Connect WhatsApp channel",
    "op.action.human_queue": "Reply to human cases",
    "op.action.unread_threads": "Read new messages",
    "op.action.window_expiring": "Close 24h window",
    "op.action.publish_agent": "Publish agent",
    "op.action.agent_validation": "Fix agent",
    "op.action.first_campaign": "Create first campaign",
    "op.action.stable": "System stable",
    "op.actionBody.connect_channel": "No verified lab channel for safe receive/send.",
    "op.actionBody.human_queue": "Some requests were marked for team decision.",
    "op.actionBody.unread_threads": "New messages can change the lead state.",
    "op.actionBody.window_expiring": "Reply before the service window closes.",
    "op.actionBody.publish_agent": "Create or publish an agent before automating care.",
    "op.actionBody.agent_validation": "Validation errors block a safe publish.",
    "op.actionBody.first_campaign": "Start with a small audience and real tracking.",
    "op.actionBody.stable": "Keep monitoring conversations, agents, and campaigns.",
  },
} as const;

export type TranslationKey = keyof typeof MESSAGES.pt;

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function storageKey(scope?: string) {
  return scope ? `openbsp.locale.${scope}` : "openbsp.locale";
}

function isLocale(value: string | null): value is Locale {
  return value === "pt" || value === "en";
}

export function I18nProvider({
  children,
  storageScope,
}: {
  children: ReactNode;
  storageScope?: string;
}) {
  const [locale, setLocaleState] = useState<Locale>("pt");

  useEffect(() => {
    const scoped = localStorage.getItem(storageKey(storageScope));
    const global = localStorage.getItem(storageKey());
    setLocaleState(isLocale(scoped) ? scoped : isLocale(global) ? global : "pt");
  }, [storageScope]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale: (next) => {
        setLocaleState(next);
        localStorage.setItem(storageKey(storageScope), next);
        localStorage.setItem(storageKey(), next);
      },
      t: (key) => MESSAGES[locale][key] ?? MESSAGES.pt[key] ?? key,
    }),
    [locale, storageScope],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1",
        className,
      )}
      aria-label={t("locale.label")}
    >
      <Languages size={13} className="ml-1 text-slate-400" aria-hidden />
      {(["pt", "en"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLocale(option)}
          className={cn(
            "h-7 rounded-md px-2 text-[11px] font-semibold transition-colors",
            locale === option
              ? "bg-white text-[#0a1b33] shadow-sm"
              : "text-slate-500 hover:bg-white/70 hover:text-[#0a1b33]",
          )}
        >
          {t(option === "pt" ? "locale.pt" : "locale.en")}
        </button>
      ))}
    </div>
  );
}
