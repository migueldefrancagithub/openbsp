"use client";

import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  BadgeCheck,
  BellOff,
  CheckCircle2,
  Clock3,
  Copy,
  Fingerprint,
  Loader2,
  MessageCircle,
  MoreVertical,
  PhoneCall,
  Search,
  SlidersHorizontal,
  Upload,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/EmptyState";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ImportCsvModal } from "./ImportCsvModal";
import { relativeTime } from "@/lib/relativeTime";
import { useI18n, type Locale } from "@/lib/i18n";

const CONSENT_PILL: Record<string, string> = {
  granted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  revoked: "bg-red-50 text-red-700 border-red-200",
  unknown: "bg-slate-100 text-slate-500 border-slate-200",
};

type ContactRow = {
  _id: Id<"contacts">;
  e164?: string;
  bsuid?: string;
  parentBsuid?: string;
  whatsappUsername?: string;
  name?: string;
  locale?: string;
  tags: string[];
  createdAt: number;
  marketingConsent: "granted" | "revoked" | "unknown";
  marketingConsentAt?: number;
  transactionalConsent: "granted" | "revoked" | "unknown";
  transactionalConsentAt?: number;
  lastConversationAt?: number;
  lastLeadSource?: string;
  opportunityStatus?: string;
  serviceWindowExpiresAt?: number;
};

type IdentityFilter = "all" | "phone" | "bsuid" | "username" | "needs_phone";
type ConsentFilter = "all" | "marketing_granted" | "marketing_revoked" | "marketing_unknown";

export default function ContactsPage() {
  const { locale, tr } = useI18n();
  const contacts = useQuery(api.contacts.list, {}) as ContactRow[] | undefined;
  const bulkImport = useMutation(api.contacts.bulkImport);
  const sendContactRequest = useAction(api.contactRequest.send);
  const [open, setOpen] = useState(false);
  const [requestContact, setRequestContact] = useState<{
    id: Id<"contacts">;
    name: string;
  } | null>(null);
  const [requestBody, setRequestBody] = useState(
    "Para continuarmos o atendimento, pode partilhar o seu numero de telefone?",
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [explainMatch, setExplainMatch] = useState(false);
  const [identityFilter, setIdentityFilter] = useState<IdentityFilter>("all");
  const [consentFilter, setConsentFilter] = useState<ConsentFilter>("all");

  const visibleContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (contacts ?? [])
      .filter((contact) => {
        const matchesIdentity =
          identityFilter === "all" ||
          (identityFilter === "phone" && Boolean(contact.e164)) ||
          (identityFilter === "bsuid" && Boolean(contact.bsuid)) ||
          (identityFilter === "username" && Boolean(contact.whatsappUsername)) ||
          (identityFilter === "needs_phone" && Boolean(contact.bsuid) && !contact.e164);
        if (!matchesIdentity) return false;

        const matchesConsent =
          consentFilter === "all" ||
          (consentFilter === "marketing_granted" &&
            contact.marketingConsent === "granted") ||
          (consentFilter === "marketing_revoked" &&
            contact.marketingConsent === "revoked") ||
          (consentFilter === "marketing_unknown" &&
            contact.marketingConsent === "unknown");
        if (!matchesConsent) return false;

        if (!term) return true;
        return [
          contact.name,
          contact.e164,
          contact.bsuid,
          contact.parentBsuid,
          contact.whatsappUsername,
          contact.lastLeadSource,
          contact.opportunityStatus,
          contact.tags.join(" "),
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(term));
      })
      .sort((a, b) =>
        sortOrder === "desc"
          ? (b.lastConversationAt ?? b.createdAt) - (a.lastConversationAt ?? a.createdAt)
          : (a.lastConversationAt ?? a.createdAt) - (b.lastConversationAt ?? b.createdAt),
      );
  }, [contacts, consentFilter, identityFilter, search, sortOrder]);

  const contactStats = useMemo(() => {
    const rows = contacts ?? [];
    return {
      total: rows.length,
      bsuid: rows.filter((contact) => contact.bsuid).length,
      needsPhone: rows.filter((contact) => contact.bsuid && !contact.e164).length,
      marketingGranted: rows.filter(
        (contact) => contact.marketingConsent === "granted",
      ).length,
    };
  }, [contacts]);

  async function handleSendContactRequest() {
    if (!requestContact) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await sendContactRequest({
        contactId: requestContact.id,
        bodyText: requestBody,
      });
      if (result.ok) {
        setNotice(tr("Pedido de contacto enviado.", "Contact request sent."));
        setRequestContact(null);
      } else {
        setError(
          result.reason ??
            tr("O WhatsApp rejeitou o pedido de contacto.", "WhatsApp rejected the contact request."),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("Ocorreu um erro.", "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  async function copyIdentity(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setNotice(tr(`${label} copiado.`, `${label} copied.`));
    window.setTimeout(() => setNotice(null), 1600);
  }

  return (
    <>
      <PageHeader
        eyebrow={tr("PACIENTES", "PATIENTS")}
        title={tr("Contactos", "Contacts")}
        description={tr(
          "Pacientes, identidades WhatsApp, consentimentos e histórico de atendimento.",
          "Patients, WhatsApp identities, consent, and service history.",
        )}
        action={
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-[#0a1b33] transition-all"
          >
            <Upload size={14} strokeWidth={2.5} />
            {tr("Importar CSV", "Import CSV")}
          </button>
        }
      />

      <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        {(notice || error) && (
          <div
            className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
              error
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {error ?? notice}
          </div>
        )}
        {contacts === undefined ? (
          <div className="text-sm text-slate-400">{tr("A carregar...", "Loading...")}</div>
        ) : contacts.length === 0 ? (
          <EmptyState
            icon={Users}
            title={tr("Ainda não há contactos", "No contacts yet")}
            description={tr(
              "Importe um CSV com uma linha por contacto. A prova de consentimento fica guardada para auditoria RGPD.",
              "Import a CSV with one row per contact. Consent evidence is stored for GDPR audit.",
            )}
            action={
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#0a1b33] transition-all"
              >
                <Upload size={14} strokeWidth={2.5} />
                {tr("Importar primeiro CSV", "Import first CSV")}
              </button>
            }
          />
        ) : (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-4 grid gap-3 md:grid-cols-4">
                <ContactStat icon={Users} label="Total" value={contactStats.total} tone="neutral" />
                <ContactStat icon={Fingerprint} label={tr("Identidade conhecida", "Known identity")} value={contactStats.bsuid} tone="good" />
                <ContactStat icon={PhoneCall} label={tr("Sem telefone", "Need phone")} value={contactStats.needsPhone} tone="warn" />
                <ContactStat icon={BadgeCheck} label={tr("Consentiram marketing", "Marketing opt-in")} value={contactStats.marketingGranted} tone="good" />
              </div>
              <div className="grid gap-3 xl:grid-cols-[1fr_180px_210px_auto]">
                <label className="relative block">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={tr("Pesquisar nome, telefone ou identidade...", "Search name, phone, or identity...")}
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm text-[#0a1b33] outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400"
                  />
                </label>
                <select
                  value={identityFilter}
                  onChange={(event) =>
                    setIdentityFilter(event.target.value as IdentityFilter)
                  }
                  className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] outline-none focus:border-slate-400"
                >
                  <option value="all">{tr("Todas as identidades", "All identities")}</option>
                  <option value="phone">{tr("Com telefone", "Has phone")}</option>
                  <option value="bsuid">{tr("Com identidade WhatsApp", "Has WhatsApp identity")}</option>
                  <option value="username">{tr("Com utilizador", "Has username")}</option>
                  <option value="needs_phone">{tr("Identidade sem telefone", "Identity, no phone")}</option>
                </select>
                <select
                  value={consentFilter}
                  onChange={(event) =>
                    setConsentFilter(event.target.value as ConsentFilter)
                  }
                  className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] outline-none focus:border-slate-400"
                >
                  <option value="all">{tr("Todos os consentimentos", "All marketing consent")}</option>
                  <option value="marketing_granted">{tr("Marketing autorizado", "Marketing granted")}</option>
                  <option value="marketing_revoked">{tr("Marketing recusado", "Marketing revoked")}</option>
                  <option value="marketing_unknown">{tr("Marketing desconhecido", "Marketing unknown")}</option>
                </select>
                <label className="inline-flex h-11 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600">
                  {tr("Explicar correspondência", "Explain match")}
                  <input
                    type="checkbox"
                    checked={explainMatch}
                    onChange={(event) => setExplainMatch(event.target.checked)}
                    className="h-4 w-4 accent-[#0a152d]"
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-[#0a1b33]">
                  {tr("Ordenar por:", "Sort by:")}
                </span>
                <select className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33]">
                  <option>{tr("Última atividade", "Last activity")}</option>
                </select>
                {(identityFilter !== "all" || consentFilter !== "all" || search) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setIdentityFilter("all");
                      setConsentFilter("all");
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] transition-colors hover:border-slate-300"
                  >
                    <SlidersHorizontal size={15} />
                    {tr("Limpar filtros", "Reset filters")}
                  </button>
                )}
                <select
                  value={sortOrder}
                  onChange={(event) =>
                    setSortOrder(event.target.value as "desc" | "asc")
                  }
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33]"
                >
                  <option value="desc">{tr("Mais recentes", "Newest first")}</option>
                  <option value="asc">{tr("Mais antigos", "Oldest first")}</option>
                </select>
              </div>
            </section>

            <div className="space-y-2 md:hidden">
              {visibleContacts.map((contact) => {
                const primary =
                  contact.name ||
                  (contact.whatsappUsername ? `@${contact.whatsappUsername}` : null) ||
                  contact.e164 ||
                  contact.bsuid ||
                  tr("Contacto desconhecido", "Unknown contact");
                const initial = primary.charAt(0).toUpperCase();
                return (
                  <article
                    key={contact._id}
                    className="rounded-lg border border-slate-200 bg-white p-4"
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sm font-semibold text-sky-700">
                        {initial}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-sm font-semibold text-[#0a1b33]">
                          {primary}
                        </h2>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {contact.e164
                            ? maskPhone(contact.e164)
                            : tr("Telefone em falta", "Phone missing")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {contact.bsuid && !contact.e164 && (
                          <button
                            type="button"
                            onClick={() =>
                              setRequestContact({ id: contact._id, name: primary })
                            }
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-50"
                            aria-label={tr("Pedir telefone", "Request phone")}
                          >
                            <PhoneCall size={16} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-sky-700 hover:bg-sky-50"
                          aria-label={tr("Abrir conversa", "Open chat")}
                        >
                          <MessageCircle size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs">
                      <div>
                        <span className="text-slate-400">{tr("Etapa", "Stage")}</span>
                        <p className="mt-1 truncate font-medium text-[#0a1b33]">
                          {contact.opportunityStatus ?? tr("Sem etapa", "No stage")}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">{tr("Atividade", "Activity")}</span>
                        <p className="mt-1 font-medium text-[#0a1b33]">
                          {relativeTime(
                            contact.lastConversationAt ?? contact.createdAt,
                            Date.now(),
                            locale,
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <ConsentPill
                        label="Marketing"
                        status={contact.marketingConsent}
                        at={contact.marketingConsentAt}
                        locale={locale}
                      />
                      {contact.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden rounded-lg border border-slate-200 bg-white md:block">
              <div>
                <div className="grid grid-cols-[36px_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_88px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-[12px] font-semibold text-slate-500 xl:grid-cols-[36px_1.25fr_1.25fr_1.1fr_1fr_0.9fr_1fr_88px] xl:px-5">
                  <span />
                  <span>{tr("Nome", "Name")}</span>
                  <span>{tr("Identidade WhatsApp", "WhatsApp identity")}</span>
                  <span className="hidden xl:block">{tr("Consentimento", "Consent")}</span>
                  <span className="hidden xl:block">{tr("Origem / etapa", "Source / stage")}</span>
                  <span>{tr("Última atividade", "Last activity")}</span>
                  <span className="hidden xl:block">{tr("Etiquetas", "Tags")}</span>
                  <span>{tr("Ações", "Actions")}</span>
                </div>
                <ul className="divide-y divide-slate-100">
              {visibleContacts.map((c) => {
                // Display name fallback chain: name → username → phone → BSUID
                const primary =
                  c.name ||
                  (c.whatsappUsername ? `@${c.whatsappUsername}` : null) ||
                  c.e164 ||
                  c.bsuid ||
                  tr("(desconhecido)", "(unknown)");
                const initial = (
                  c.name?.charAt(0) ??
                  c.whatsappUsername?.charAt(0) ??
                  c.e164?.charAt(1) ??
                  c.bsuid?.charAt(0) ??
                  "?"
                ).toUpperCase();
                const secondaryParts = contactEvidence(c, locale);
                return (
                <li
                  key={c._id}
                  className="grid grid-cols-[36px_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_88px] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50 xl:grid-cols-[36px_1.25fr_1.25fr_1.1fr_1fr_0.9fr_1fr_88px] xl:px-5"
                >
                  <input type="checkbox" className="h-4 w-4 accent-sky-600" />
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-sky-50 text-[12px] font-semibold text-sky-700">
                      {initial}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-semibold text-[#0a1b33]">
                        {primary}
                      </div>
                      {explainMatch && (
                        <div className="mt-0.5 truncate text-[11px] text-slate-500">
                          {secondaryParts}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="min-w-0 space-y-1">
                    <IdentityLine
                      icon={PhoneCall}
                      label="Phone"
                      value={c.e164 ? maskPhone(c.e164) : tr("Em falta", "Missing")}
                      tone={c.e164 ? "good" : "warn"}
                      copy={c.e164 ? () => copyIdentity(c.e164 as string, "Phone") : undefined}
                    />
                    <IdentityLine
                      icon={Fingerprint}
                      label="BSUID"
                      value={c.bsuid ? compactId(c.bsuid) : tr("Não detetada", "Not seen")}
                      tone={c.bsuid ? "good" : "neutral"}
                      copy={c.bsuid ? () => copyIdentity(c.bsuid as string, "BSUID") : undefined}
                    />
                    {c.whatsappUsername && (
                      <IdentityLine
                        icon={BadgeCheck}
                        label="User"
                        value={`@${c.whatsappUsername}`}
                        tone="neutral"
                        copy={() =>
                          copyIdentity(c.whatsappUsername as string, "Username")
                        }
                      />
                    )}
                  </div>
                  <div className="hidden space-y-1 xl:block">
                    <ConsentPill label="Marketing" status={c.marketingConsent} at={c.marketingConsentAt} locale={locale} />
                    <ConsentPill label={tr("Transacional", "Transactional")} status={c.transactionalConsent} at={c.transactionalConsentAt} locale={locale} />
                  </div>
                  <div className="hidden min-w-0 space-y-1 text-sm xl:block">
                    <div className="truncate font-semibold capitalize text-[#0a1b33]">
                      {c.lastLeadSource ?? tr("origem desconhecida", "unknown source")}
                    </div>
                    <div className="truncate text-xs font-medium text-slate-500">
                      {c.opportunityStatus ?? tr("sem etapa", "no stage")}
                    </div>
                  </div>
                  <div className="space-y-1 text-sm text-slate-500">
                    <div className="inline-flex items-center gap-1">
                      <Clock3 size={14} />
                      {c.lastConversationAt
                        ? relativeTime(c.lastConversationAt, Date.now(), locale)
                        : relativeTime(c.createdAt, Date.now(), locale)}
                    </div>
                    <div className="text-xs">
                      {serviceWindowLabel(c.serviceWindowExpiresAt, locale)}
                    </div>
                  </div>
                  <span className="hidden truncate text-sm text-slate-500 xl:block">
                    {c.tags.length > 0 ? c.tags.join(", ") : "-"}
                  </span>
                  <div className="flex items-center gap-2">
                    {c.bsuid && !c.e164 && (
                      <button
                        type="button"
                        onClick={() =>
                          setRequestContact({ id: c._id, name: primary })
                        }
                        className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50"
                        aria-label={tr("Pedir telefone", "Request phone")}
                      >
                        <PhoneCall size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-sky-700 hover:bg-sky-50"
                      aria-label={tr("Abrir conversa", "Open chat")}
                    >
                      <MessageCircle size={16} />
                    </button>
                    {c.marketingConsent === "revoked" && (
                      <BellOff size={16} className="text-red-500" />
                    )}
                    {c.bsuid && !c.e164 && (
                      <AlertTriangle size={16} className="text-amber-500" />
                    )}
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                      aria-label={tr("Mais ações", "More actions")}
                    >
                      <MoreVertical size={16} />
                    </button>
                  </div>
                </li>
                );
              })}
                </ul>
                {visibleContacts.length === 0 && (
                  <div className="p-10 text-center">
                    <Users size={26} className="mx-auto text-slate-300" />
                    <h2 className="mt-3 font-[var(--font-outfit)] text-lg font-semibold text-[#0a1b33]">
                      {tr("Nenhum contacto corresponde", "No contacts match")}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {tr(
                        "Limpe os filtros ou importe uma lista mais completa.",
                        "Clear filters or import a richer contact list.",
                      )}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {open && (
        <ImportCsvModal
          onClose={() => setOpen(false)}
          onImport={async (rows) => bulkImport({ rows })}
        />
      )}
      {requestContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
                  {tr("Pedir telefone", "Request phone")}
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  {requestContact.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRequestContact(null)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-slate-500">
                  {tr("Mensagem", "Message")}
                </span>
                <textarea
                  value={requestBody}
                  onChange={(event) => setRequestBody(event.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#0a1b33] outline-none transition-colors focus:border-slate-400"
                />
              </label>
              <button
                type="button"
                onClick={handleSendContactRequest}
                disabled={busy || requestBody.trim().length === 0}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0a152d] px-4 py-2 text-[13px] font-medium text-white transition-all hover:bg-[#0a1b33] disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <PhoneCall size={14} />}
                {tr("Enviar pedido", "Send request")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function maskPhone(value: string): string {
  if (value.length <= 7) return value;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function ContactStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: "good" | "warn" | "neutral";
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-100 bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "border-amber-100 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] opacity-75">
          {label}
        </span>
        <Icon size={15} />
      </div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
    </div>
  );
}

function IdentityLine({
  icon: Icon,
  label,
  value,
  tone,
  copy,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: "good" | "warn" | "neutral";
  copy?: () => void;
}) {
  const { tr } = useI18n();
  const toneClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-slate-600";
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <Icon size={13} className={`shrink-0 ${toneClass}`} />
      <span className="shrink-0 font-semibold text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-[#0a1b33]">
        {value}
      </span>
      {copy && (
        <button
          type="button"
          onClick={copy}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-[#0a1b33]"
          aria-label={tr(`Copiar ${label}`, `Copy ${label}`)}
        >
          <Copy size={12} />
        </button>
      )}
    </div>
  );
}

function ConsentPill({
  label,
  status,
  at,
  locale,
}: {
  label: string;
  status: "granted" | "revoked" | "unknown";
  at?: number;
  locale: Locale;
}) {
  const Icon =
    status === "granted"
      ? CheckCircle2
      : status === "revoked"
        ? BellOff
        : AlertTriangle;
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${CONSENT_PILL[status]}`}
      >
        <Icon size={11} />
        {label}: {consentLabel(status, locale)}
      </span>
      {at && (
        <span className="text-[10px] text-slate-400">
          {relativeTime(at, Date.now(), locale)}
        </span>
      )}
    </div>
  );
}

function consentLabel(status: "granted" | "revoked" | "unknown", locale: Locale) {
  const labels = {
    granted: ["autorizado", "granted"],
    revoked: ["revogado", "revoked"],
    unknown: ["desconhecido", "unknown"],
  } satisfies Record<string, [string, string]>;
  return locale === "pt" ? labels[status][0] : labels[status][1];
}

function serviceWindowLabel(expiresAt: number | undefined, locale: Locale) {
  if (!expiresAt) return locale === "pt" ? "sem janela de atendimento" : "no service window";
  if (expiresAt <= Date.now()) {
    return locale === "pt" ? "janela de atendimento fechada" : "service window expired";
  }
  return locale === "pt"
    ? `janela aberta por ${relativeTime(expiresAt, Date.now(), locale)}`
    : `service window ${relativeTime(expiresAt, Date.now(), locale)}`;
}

function contactEvidence(contact: ContactRow, locale: Locale) {
  const parts: string[] = [];
  if (contact.e164) parts.push(`${locale === "pt" ? "telefone" : "phone"} ${contact.e164}`);
  if (contact.bsuid) parts.push(`BSUID ${compactId(contact.bsuid)}`);
  if (contact.parentBsuid) parts.push(`${locale === "pt" ? "principal" : "parent"} ${compactId(contact.parentBsuid)}`);
  if (contact.whatsappUsername) parts.push(`@${contact.whatsappUsername}`);
  parts.push(
    `${locale === "pt" ? "adicionado" : "added"} ${relativeTime(contact.createdAt, Date.now(), locale)}`,
  );
  return parts.join(" · ");
}

function compactId(value: string) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-5)}`;
}
