"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Users,
  UserPlus,
  Copy,
  Check,
  Trash2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { relativeTime } from "@/lib/relativeTime";
import { useI18n, type Locale } from "@/lib/i18n";
import { convexErrorMessage } from "@/lib/convexErrorMessage";

type InviteRole = "admin" | "agent" | "marketing";

export function MembersSection() {
  const { locale, tr, t } = useI18n();
  const members = useQuery(api.memberInvites.listMembers, {});
  const me = useQuery(api.tenantsQueries.getActiveOptional);
  const changeRole = useMutation(api.members.changeRole);
  const setStatus = useMutation(api.members.setStatus);
  const [memberNotice, setMemberNotice] = useState<string | null>(null);
  const canManage = me?.role === "owner" || me?.role === "admin";
  async function runMemberAction(action: () => Promise<unknown>, success: string) {
    setMemberNotice(null);
    try {
      await action();
      setMemberNotice(success);
    } catch (cause) {
      setMemberNotice(formatError(cause, locale));
    }
  }
  const invites = useQuery(api.memberInvites.list, {});
  const invite = useAction(api.memberInvites.invite);
  const revoke = useMutation(api.memberInvites.revoke);

  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("agent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justInvited, setJustInvited] = useState<{
    email: string;
    link: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleInvite() {
    setError(null);
    setBusy(true);
    try {
      const r = await invite({ email: email.trim().toLowerCase(), role });
      const link = `${window.location.origin}/signup?invite=${r.plaintextToken}`;
      setJustInvited({ email: email.trim().toLowerCase(), link });
      setEmail("");
      setInviting(false);
    } catch (err) {
      setError(formatError(err, locale));
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    if (!justInvited) return;
    navigator.clipboard.writeText(justInvited.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const activeInvites = (invites ?? []).filter(
    (i) => i.status === "active",
  );

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="px-6 py-4 border-b border-line-soft flex items-center justify-between">
        <h2 className="font-semibold text-ink text-[15px]">
          {tr("Membros e convites", "Members & invites")}
        </h2>
        {!inviting && !justInvited && (
          <button
            type="button"
            onClick={() => setInviting(true)}
            className="inline-flex items-center gap-1.5 bg-nav-active text-white text-[12px] font-medium px-3 py-1.5 rounded-lg hover:bg-brand-solid transition-all"
          >
            <UserPlus size={12} strokeWidth={2.5} />
            {tr("Convidar", "Invite")}
          </button>
        )}
      </div>

      <div className="px-6 py-5 space-y-4">
        {justInvited && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-emerald-800">
              <Check size={14} />
              {tr("Convite enviado para", "Invite sent to")} {justInvited.email}
            </div>
            <div className="text-[11px] text-emerald-700">
              {tr("Envie este link. Expira em 7 dias.", "Send this link. It expires in 7 days.")}
            </div>
            <div className="flex items-stretch gap-2">
              <code className="flex-1 bg-surface border border-emerald-200 rounded-md px-3 py-2 text-[11px] font-[var(--font-mono)] text-ink break-all">
                {justInvited.link}
              </code>
              <button
                type="button"
                onClick={copyLink}
                className="bg-emerald-600 text-white px-3 rounded-md hover:bg-emerald-700 transition-colors flex items-center gap-1 text-[12px] font-medium"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? tr("Copiado", "Copied") : tr("Copiar", "Copy")}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setJustInvited(null)}
              className="text-[12px] text-emerald-800 font-medium hover:underline"
            >
              {tr("Concluído", "Done")}
            </button>
          </div>
        )}

        {inviting && (
          <div className="rounded-lg border border-line p-4 space-y-3">
            <div>
              <label className="text-[11px] text-muted font-medium">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colega@example.pt"
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/20"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted font-medium">
                {tr("Papel", "Role")}
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as InviteRole)}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/20"
              >
                <option value="agent">{tr("atendimento — gerir inbox", "agent — handle inbox")}</option>
                <option value="marketing">{tr("marketing — enviar campanhas", "marketing — send campaigns")}</option>
                <option value="admin">{tr("admin — gerir espaço", "admin — manage workspace")}</option>
              </select>
            </div>
            {error && (
              <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setInviting(false);
                  setEmail("");
                  setError(null);
                }}
                className="text-[12px] text-muted hover:text-ink px-2 py-1.5"
              >
                {tr("Cancelar", "Cancel")}
              </button>
              <button
                type="button"
                onClick={handleInvite}
                disabled={!email.trim() || busy}
                className="inline-flex items-center gap-1.5 bg-nav-active text-white text-[12px] font-medium px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-brand-solid transition-all"
              >
                {busy && <Loader2 size={12} className="animate-spin" />}
                {tr("Enviar convite", "Send invite")}
              </button>
            </div>
          </div>
        )}

        <div>
          <div className="text-[11px] uppercase tracking-wider text-faint font-medium mb-2">
            {tr("Membros ativos", "Active members")}
          </div>
          {members === undefined ? (
            <div className="text-faint text-[12px]">{tr("A carregar…", "Loading…")}</div>
          ) : (
            <ul className="divide-y divide-line-soft border border-line rounded-lg overflow-hidden">
              {(members ?? []).map((m) => (
                <li
                  key={m._id}
                  className="flex items-center gap-3 px-4 py-3 bg-surface"
                >
                  <Users size={14} className="text-muted" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-ink">
                      {m.email ?? tr("(sem email)", "(no email)")}
                      {me?.memberId === m._id && (
                        <span className="ml-1 text-[10px] font-normal text-faint">({t("members.you")})</span>
                      )}
                      {m.status === "suspended" && (
                        <span className="ml-2 rounded border border-line bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                          {t("members.suspended")}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5">
                      {roleLabel(m.role, locale)} · {tr("entrou", "joined")} {relativeTime(m.createdAt, Date.now(), locale)}
                    </div>
                  </div>
                  {canManage && me?.memberId !== m._id && (
                    <div className="flex shrink-0 items-center gap-1.5" data-member-controls>
                      <select
                        value={m.role}
                        onChange={(event) =>
                          void runMemberAction(
                            () => changeRole({ memberId: m._id, role: event.target.value as "owner" | "admin" | "agent" | "marketing" }),
                            t("members.roleChanged"),
                          )
                        }
                        aria-label={t("members.role")}
                        className="h-8 rounded-md border border-line bg-surface px-2 text-[11px] font-semibold text-ink outline-none focus:border-brand-solid/40"
                      >
                        {(["owner", "admin", "agent", "marketing"] as const).map((value) => (
                          <option key={value} value={value} disabled={value === "owner" && me?.role !== "owner"}>
                            {roleLabel(value, locale)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          void runMemberAction(
                            () => setStatus({ memberId: m._id, status: m.status === "suspended" ? "active" : "suspended" }),
                            m.status === "suspended" ? t("members.reactivate") : t("members.suspend"),
                          )
                        }
                        className="h-8 rounded-md border border-line px-2 text-[11px] font-semibold text-body hover:border-line"
                      >
                        {m.status === "suspended" ? t("members.reactivate") : t("members.suspend")}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {memberNotice && <p className="mt-2 text-[12px] text-body">{memberNotice}</p>}
        </div>

        {activeInvites.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-faint font-medium mb-2">
              {tr("Convites pendentes", "Pending invites")}
            </div>
            <ul className="divide-y divide-line-soft border border-line rounded-lg overflow-hidden">
              {activeInvites.map((inv) => (
                <li
                  key={inv._id}
                  className="flex items-center gap-3 px-4 py-3 bg-surface"
                >
                  <UserPlus size={14} className="text-amber-500" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-ink">
                      {inv.email}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5">
                      {roleLabel(inv.role, locale)} · {tr("expira em", "expires")} {" "}
                      {new Date(inv.expiresAt).toLocaleDateString(locale === "pt" ? "pt-MZ" : "en-GB")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(tr(`Revogar convite para ${inv.email}?`, `Revoke invite to ${inv.email}?`))) {
                        revoke({ inviteId: inv._id });
                      }
                    }}
                    className="text-faint hover:text-red-600 p-1.5"
                    title={tr("Revogar", "Revoke")}
                    aria-label={tr(`Revogar convite para ${inv.email}`, `Revoke invite to ${inv.email}`)}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function formatError(err: unknown, locale: Locale): string {
  return convexErrorMessage(err, locale, locale === "pt" ? "Erro desconhecido" : "Unknown error");
}

function roleLabel(role: string, locale: Locale) {
  if (locale !== "pt") return role;
  if (role === "agent") return "atendimento";
  if (role === "marketing") return "marketing";
  if (role === "admin") return "administrador";
  if (role === "owner") return "proprietário";
  return role;
}
