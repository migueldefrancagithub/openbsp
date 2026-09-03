"use client";

import { useState, FormEvent, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Send,
  Lock,
  Loader2,
  AlertCircle,
  FileText,
  Zap,
  Search,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";

type ComposerProps = {
  conversationId: Id<"conversations">;
  serviceWindowExpiresAt?: number;
};

export function Composer({ conversationId, serviceWindowExpiresAt }: ComposerProps) {
  const sendText = useMutation(api.messages.sendText);
  const sendTemplate = useMutation(api.messages.sendTemplate);
  const templates = useQuery(api.templates.list);
  const quickReplies = useQuery(api.quickReplies.list);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplySearch, setQuickReplySearch] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] =
    useState<Id<"templates"> | null>(null);
  const [templateVariables, setTemplateVariables] = useState<
    Record<string, string>
  >({});
  const nonceRef = useRef<string>(crypto.randomUUID());

  function insertQuickReply(content: string) {
    setText((prev) => (prev.trim() ? `${prev}\n${content}` : content));
    setShowQuickReplies(false);
  }

  const within24h =
    serviceWindowExpiresAt && serviceWindowExpiresAt > Date.now();
  const approvedTemplates = (templates ?? []).filter(
    (t) => t.status === "approved",
  );
  const filteredQuickReplies = (quickReplies ?? []).filter((reply) => {
    const needle = quickReplySearch.trim().toLowerCase();
    if (!needle) return true;
    return (
      reply.name.toLowerCase().includes(needle) ||
      reply.content.toLowerCase().includes(needle)
    );
  });
  const selectedTemplate = approvedTemplates.find(
    (template) => template._id === selectedTemplateId,
  );

  function selectTemplate(templateId: Id<"templates">) {
    const template = approvedTemplates.find((item) => item._id === templateId);
    setSelectedTemplateId(templateId);
    setTemplateVariables(
      Object.fromEntries(
        (template?.parameterSchema ?? []).map((param) => [
          String(param.index),
          param.example,
        ]),
      ),
    );
  }

  async function onSendTemplate(templateId: Id<"templates">) {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await sendTemplate({
        conversationId,
        templateId,
        variables: templateVariables,
        clientNonce: nonceRef.current,
      });
      nonceRef.current = crypto.randomUUID();
      setShowTemplates(false);
      setSelectedTemplateId(null);
      setTemplateVariables({});
    } catch (err: unknown) {
      const data =
        err && typeof err === "object" && "data" in err
          ? (err as { data: unknown }).data
          : null;
      let msg = "Failed to send template";
      if (data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        if (d.code === "MISSING_TEMPLATE_VARIABLE")
          msg = `Template requires variable ${d.index}.`;
        else if (d.code === "CONSENT_REQUIRED")
          msg = "Recipient has not granted consent for this template category.";
        else if (typeof d.message === "string") msg = d.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    setBusy(true);
    try {
      await sendText({
        conversationId,
        text: trimmed,
        clientNonce: nonceRef.current,
      });
      setText("");
      // Fresh nonce for the next send.
      nonceRef.current = crypto.randomUUID();
    } catch (err: unknown) {
      const data =
        err && typeof err === "object" && "data" in err
          ? (err as { data: unknown }).data
          : null;
      let msg = "Failed to send";
      if (data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        if (d.code === "SERVICE_WINDOW_EXPIRED")
          msg = "24h service window expired — use a template instead.";
        else if (d.code === "CONSENT_REQUIRED")
          msg = "No transactional consent for this contact yet.";
        else if (typeof d.message === "string") msg = d.message;
        else if (typeof d.code === "string") msg = String(d.code);
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-line bg-surface p-4">
      {!within24h && !showTemplates && (
        <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg mb-3">
          <Lock size={12} strokeWidth={2.5} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            24h service window expired — send an approved template instead.
          </div>
          <button
            type="button"
            onClick={() => setShowTemplates(true)}
            className="text-amber-900 font-semibold hover:underline"
          >
            Pick template
          </button>
        </div>
      )}
      {showTemplates && (
        <div className="mb-3 border border-line rounded-lg bg-surface max-h-48 overflow-y-auto">
          <div className="px-3 py-2 border-b border-line-soft flex items-center justify-between">
            <span className="text-[11px] font-semibold text-ink">
              Approved templates
            </span>
            <button
              type="button"
              onClick={() => setShowTemplates(false)}
              className="text-[11px] text-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
          {approvedTemplates.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-muted text-center">
              No approved templates yet.
            </div>
          ) : (
            <ul className="divide-y divide-line-soft">
              {approvedTemplates.map((t) => (
                <li key={t._id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => selectTemplate(t._id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-50 transition-colors"
                  >
                    <FileText
                      size={12}
                      className="text-faint flex-shrink-0"
                    />
                    <span className="text-[12px] font-medium text-ink flex-1 truncate">
                      {t.name}
                    </span>
                    <span className="text-[10px] text-faint">
                      {t.category} · {t.language}
                      {t.parameterCount > 0 && ` · ${t.parameterCount} vars`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selectedTemplate && (
            <div className="border-t border-line-soft p-3">
              <div className="mb-2 text-[11px] font-semibold text-ink">
                {selectedTemplate.name}
              </div>
              {selectedTemplate.bodyText && (
                <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-muted">
                  {selectedTemplate.bodyText}
                </p>
              )}
              {selectedTemplate.parameterSchema.length > 0 && (
                <div className="mb-3 grid gap-2">
                  {selectedTemplate.parameterSchema.map((param) => (
                    <label key={param.index} className="block">
                      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-faint">
                        {param.name || `Variable ${param.index}`}
                      </span>
                      <input
                        value={templateVariables[String(param.index)] ?? ""}
                        onChange={(event) =>
                          setTemplateVariables((prev) => ({
                            ...prev,
                            [String(param.index)]: event.target.value,
                          }))
                        }
                        placeholder={param.example}
                        className="w-full rounded-lg border border-line px-3 py-2 text-[12px] text-ink outline-none transition-colors focus:border-brand-solid/40"
                      />
                    </label>
                  ))}
                </div>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => onSendTemplate(selectedTemplate._id)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-nav-active px-3 py-2 text-[12px] font-medium text-white transition-all hover:bg-brand-solid disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Send template
              </button>
            </div>
          )}
        </div>
      )}
      {showQuickReplies && (
        <div className="mb-3 overflow-hidden rounded-xl border border-line bg-surface shadow-[0_18px_60px_-44px_rgba(15,23,42,0.65)]">
          <div className="flex items-center justify-between border-b border-line-soft px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Quick replies
            </span>
            <button
              type="button"
              onClick={() => {
                setShowQuickReplies(false);
                setQuickReplySearch("");
              }}
              className="text-[11px] text-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
          <div className="border-b border-line-soft p-2">
            <label className="relative block">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              />
              <input
                value={quickReplySearch}
                onChange={(event) => setQuickReplySearch(event.target.value)}
                placeholder="Search shortcut..."
                className="h-9 w-full rounded-lg border border-line bg-surface-2 pl-8 pr-3 text-[12px] text-ink outline-none focus:border-brand-solid/40 focus:bg-surface"
              />
            </label>
          </div>
          {(quickReplies ?? []).length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-muted text-center">
              No quick replies yet.{" "}
              <a
                href="/app/quick-replies"
                className="text-[#0a152d] font-medium hover:underline"
              >
                Create one →
              </a>
            </div>
          ) : (
            <ul className="max-h-72 divide-y divide-line-soft overflow-y-auto">
              {filteredQuickReplies.map((q) => (
                <li key={q._id}>
                  <button
                    type="button"
                    onClick={() => insertQuickReply(q.content)}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <Zap
                      size={12}
                      className="text-amber-500 flex-shrink-0 mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-[var(--font-mono)] text-[12px] font-semibold text-ink">
                        /{q.name}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted">
                        {q.content}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
              {filteredQuickReplies.length === 0 && (
                <li className="px-3 py-4 text-center text-[12px] text-muted">
                  No match
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg mb-3">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSubmit(e as unknown as FormEvent);
            }
          }}
          disabled={!within24h || busy}
          placeholder={within24h ? "Type a message…" : "Service window closed"}
          className={cn(
            "flex-1 resize-none rounded-xl border border-line px-3.5 py-2.5 text-[14px] text-ink placeholder:text-faint",
            "focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all",
            "disabled:bg-surface-2 disabled:cursor-not-allowed",
          )}
        />
        <button
          type="button"
          onClick={() => setShowQuickReplies((v) => !v)}
          disabled={!within24h || busy}
          title="Quick replies"
          className="text-muted hover:text-[#0a152d] p-2.5 rounded-xl border border-line hover:border-line disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0"
        >
          <Zap size={16} strokeWidth={2.5} />
        </button>
        <button
          type="submit"
          disabled={!within24h || busy || !text.trim()}
          className="bg-nav-active text-white p-2.5 rounded-xl shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-brand-solid disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0"
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} strokeWidth={2.5} />
          )}
        </button>
      </form>
    </div>
  );
}
