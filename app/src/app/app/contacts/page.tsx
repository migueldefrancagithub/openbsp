"use client";

import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  BellOff,
  Columns3,
  Copy,
  Loader2,
  MessageCircle,
  MoreVertical,
  PhoneCall,
  Search,
  SlidersHorizontal,
  Star,
  Upload,
  Users,
  X,
} from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/EmptyState";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ImportCsvModal } from "./ImportCsvModal";
import { relativeTime } from "@/lib/relativeTime";

const CONSENT_PILL: Record<string, string> = {
  granted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  revoked: "bg-red-50 text-red-700 border-red-200",
  unknown: "bg-slate-100 text-slate-500 border-slate-200",
};

export default function ContactsPage() {
  const contacts = useQuery(api.contacts.list, {});
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

  const visibleContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (contacts ?? [])
      .filter((contact) => {
        if (!term) return true;
        return [
          contact.name,
          contact.e164,
          contact.bsuid,
          contact.whatsappUsername,
          contact.tags.join(" "),
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(term));
      })
      .sort((a, b) =>
        sortOrder === "desc"
          ? b.createdAt - a.createdAt
          : a.createdAt - b.createdAt,
      );
  }, [contacts, search, sortOrder]);

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
        setNotice("Contact request sent.");
        setRequestContact(null);
      } else {
        setError(result.reason ?? "Meta rejected the contact request.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Audience"
        title="Contacts"
        description="People you can reach via WhatsApp, with consent provenance per contact."
        action={
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-[#0a1b33] transition-all"
          >
            <Upload size={14} strokeWidth={2.5} />
            Import CSV
          </button>
        }
      />

      <div className="px-8 py-8 max-w-7xl space-y-5">
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
          <div className="text-slate-400 text-sm">Loading…</div>
        ) : contacts.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No contacts yet"
            description="Import a CSV with one row per contact. Add a consent proof URL or text per row to record marketing consent at import time — we store it for RGPD compliance."
            action={
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#0a1b33] transition-all"
              >
                <Upload size={14} strokeWidth={2.5} />
                Import your first CSV
              </button>
            }
          />
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="grid gap-3 xl:grid-cols-[1fr_auto_auto_auto]">
                <label className="relative block">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search contacts by name, phone, BSUID..."
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm text-[#0a1b33] outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400"
                  />
                </label>
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] transition-colors hover:border-slate-300"
                >
                  <SlidersHorizontal size={15} />
                  Filters
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] transition-colors hover:border-slate-300"
                >
                  <Columns3 size={15} />
                  Columns
                </button>
                <label className="inline-flex h-11 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600">
                  Explain Match
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
                  Sort by:
                </span>
                <select className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33]">
                  <option>Created Date</option>
                </select>
                <select
                  value={sortOrder}
                  onChange={(event) =>
                    setSortOrder(event.target.value as "desc" | "asc")
                  }
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33]"
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
            </section>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <div className="min-w-[1040px]">
                <div className="grid grid-cols-[44px_1.35fr_1fr_0.8fr_0.8fr_0.55fr_0.6fr_1fr_0.7fr] gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3 text-[12px] font-semibold text-slate-500">
                  <span />
                  <span>Name</span>
                  <span>Phone</span>
                  <span>Created</span>
                  <span>Updated</span>
                  <span>DND</span>
                  <span>Starred</span>
                  <span>Contact groups</span>
                  <span>Actions</span>
                </div>
                <ul className="divide-y divide-slate-100">
              {visibleContacts.map((c) => {
                // Display name fallback chain: name → username → phone → BSUID
                const primary =
                  c.name ||
                  (c.whatsappUsername ? `@${c.whatsappUsername}` : null) ||
                  c.e164 ||
                  c.bsuid ||
                  "(unknown)";
                const initial = (
                  c.name?.charAt(0) ??
                  c.whatsappUsername?.charAt(0) ??
                  c.e164?.charAt(1) ??
                  c.bsuid?.charAt(0) ??
                  "?"
                ).toUpperCase();
                const secondaryParts: string[] = [];
                if (c.e164) secondaryParts.push(c.e164);
                else if (c.bsuid) secondaryParts.push(`BSUID ${c.bsuid.slice(0, 18)}…`);
                if (c.whatsappUsername && primary !== `@${c.whatsappUsername}`)
                  secondaryParts.push(`@${c.whatsappUsername}`);
                secondaryParts.push(`added ${relativeTime(c.createdAt)}`);
                return (
                <li
                  key={c._id}
                  className="grid grid-cols-[44px_1.35fr_1fr_0.8fr_0.8fr_0.55fr_0.6fr_1fr_0.7fr] items-center gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50"
                >
                  <input type="checkbox" className="h-4 w-4 accent-violet-600" />
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-violet-50 flex flex-shrink-0 items-center justify-center text-[12px] font-semibold text-violet-600">
                      {initial}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-semibold text-[#0a1b33]">
                        {primary}
                      </div>
                      {explainMatch && (
                        <div className="mt-0.5 truncate text-[11px] text-slate-500">
                          {secondaryParts.join(" · ")}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex min-w-0 items-center gap-1 text-sm font-semibold text-[#0a1b33]">
                    <span className="truncate">
                      {c.e164
                        ? maskPhone(c.e164)
                        : c.bsuid
                          ? `BSUID ${c.bsuid.slice(0, 8)}...`
                          : "-"}
                    </span>
                    {(c.e164 || c.bsuid) && (
                      <Copy size={13} className="shrink-0 text-slate-400" />
                    )}
                  </div>
                  <span className="text-sm text-slate-500">
                    {relativeTime(c.createdAt)}
                  </span>
                  <span className="text-sm text-slate-500">
                    {relativeTime(c.createdAt)}
                  </span>
                  <BellOff
                    size={16}
                    className={
                      c.marketingConsent === "revoked"
                        ? "text-red-500"
                        : "text-slate-300"
                    }
                  />
                  <Star size={16} className="text-slate-300" />
                  <span className="truncate text-sm text-slate-500">
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
                        aria-label="Request phone"
                      >
                        <PhoneCall size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-violet-600 hover:bg-violet-50"
                      aria-label="Open chat"
                    >
                      <MessageCircle size={16} />
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                      aria-label="More actions"
                    >
                      <MoreVertical size={16} />
                    </button>
                  </div>
                  <div className="hidden">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border ${CONSENT_PILL[c.marketingConsent]}`}
                  >
                    {c.marketingConsent}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border ${CONSENT_PILL[c.transactionalConsent]}`}
                  >
                    {c.transactionalConsent}
                  </span>
                  {c.bsuid && !c.e164 && (
                    <button
                      type="button"
                      onClick={() =>
                        setRequestContact({ id: c._id, name: primary })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#0a1b33] transition-colors hover:border-slate-300"
                    >
                      <PhoneCall size={12} />
                      Request phone
                    </button>
                  )}
                  </div>
                </li>
                );
              })}
                </ul>
                {visibleContacts.length === 0 && (
                  <div className="p-10 text-center">
                    <Users size={26} className="mx-auto text-slate-300" />
                    <h2 className="mt-3 font-[var(--font-outfit)] text-lg font-semibold text-[#0a1b33]">
                      No contacts match
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Clear search or import a richer contact list.
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
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
                  Request phone
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
                  Message
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
                Send request
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
