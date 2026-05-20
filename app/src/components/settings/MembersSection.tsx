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

type InviteRole = "admin" | "agent" | "marketing";

export function MembersSection() {
  const members = useQuery(api.memberInvites.listMembers, {});
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
      setError(formatError(err));
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
    <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-[#0a1b33] text-[15px]">
          Members &amp; invites
        </h2>
        {!inviting && !justInvited && (
          <button
            type="button"
            onClick={() => setInviting(true)}
            className="inline-flex items-center gap-1.5 bg-[#0a152d] text-white text-[12px] font-medium px-3 py-1.5 rounded-lg hover:bg-[#0a1b33] transition-all"
          >
            <UserPlus size={12} strokeWidth={2.5} />
            Invite
          </button>
        )}
      </div>

      <div className="px-6 py-5 space-y-4">
        {justInvited && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-emerald-800">
              <Check size={14} />
              Invite sent to {justInvited.email}
            </div>
            <div className="text-[11px] text-emerald-700">
              Send them this link. Expires in 7 days.
            </div>
            <div className="flex items-stretch gap-2">
              <code className="flex-1 bg-white border border-emerald-200 rounded-md px-3 py-2 text-[11px] font-[var(--font-mono)] text-[#0a1b33] break-all">
                {justInvited.link}
              </code>
              <button
                type="button"
                onClick={copyLink}
                className="bg-emerald-600 text-white px-3 rounded-md hover:bg-emerald-700 transition-colors flex items-center gap-1 text-[12px] font-medium"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setJustInvited(null)}
              className="text-[12px] text-emerald-800 font-medium hover:underline"
            >
              Done
            </button>
          </div>
        )}

        {inviting && (
          <div className="rounded-lg border border-slate-200 p-4 space-y-3">
            <div>
              <label className="text-[11px] text-slate-500 font-medium">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colega@example.pt"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/20"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 font-medium">
                Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as InviteRole)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/20"
              >
                <option value="agent">agent — handle inbox</option>
                <option value="marketing">marketing — send campaigns</option>
                <option value="admin">admin — manage workspace</option>
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
                className="text-[12px] text-slate-500 hover:text-slate-700 px-2 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleInvite}
                disabled={!email.trim() || busy}
                className="inline-flex items-center gap-1.5 bg-[#0a152d] text-white text-[12px] font-medium px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-[#0a1b33] transition-all"
              >
                {busy && <Loader2 size={12} className="animate-spin" />}
                Send invite
              </button>
            </div>
          </div>
        )}

        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium mb-2">
            Active members
          </div>
          {members === undefined ? (
            <div className="text-slate-400 text-[12px]">Loading…</div>
          ) : (
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
              {(members ?? []).map((m) => (
                <li
                  key={m._id}
                  className="flex items-center gap-3 px-4 py-3 bg-white"
                >
                  <Users size={14} className="text-slate-500" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-[#0a1b33]">
                      {m.email ?? "(no email)"}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {m.role} · joined {relativeTime(m.createdAt)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {activeInvites.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium mb-2">
              Pending invites
            </div>
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
              {activeInvites.map((inv) => (
                <li
                  key={inv._id}
                  className="flex items-center gap-3 px-4 py-3 bg-white"
                >
                  <UserPlus size={14} className="text-amber-500" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-[#0a1b33]">
                      {inv.email}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {inv.role} · expires{" "}
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Revoke invite to ${inv.email}?`)) {
                        revoke({ inviteId: inv._id });
                      }
                    }}
                    className="text-slate-400 hover:text-red-600 p-1.5"
                    title="Revoke"
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

function formatError(err: unknown): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data: unknown }).data;
    if (typeof data === "object" && data !== null) {
      const d = data as Record<string, unknown>;
      if (typeof d.message === "string") return d.message;
      if (typeof d.code === "string") return d.code;
    }
  }
  return err instanceof Error ? err.message : "Unknown error";
}
