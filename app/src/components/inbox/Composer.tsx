"use client";

import { useState, FormEvent, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { Send, Lock, Loader2, AlertCircle, FileText, Zap } from "lucide-react";
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
    <div className="border-t border-slate-200 bg-white p-4">
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
        <div className="mb-3 border border-slate-200 rounded-lg bg-white max-h-48 overflow-y-auto">
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-700">
              Approved templates
            </span>
            <button
              type="button"
              onClick={() => setShowTemplates(false)}
              className="text-[11px] text-slate-500 hover:text-slate-900"
            >
              Cancel
            </button>
          </div>
          {approvedTemplates.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-slate-500 text-center">
              No approved templates yet.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {approvedTemplates.map((t) => (
                <li key={t._id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => selectTemplate(t._id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    <FileText
                      size={12}
                      className="text-slate-400 flex-shrink-0"
                    />
                    <span className="text-[12px] font-medium text-[#0a1b33] flex-1 truncate">
                      {t.name}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {t.category} · {t.language}
                      {t.parameterCount > 0 && ` · ${t.parameterCount} vars`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selectedTemplate && (
            <div className="border-t border-slate-100 p-3">
              <div className="mb-2 text-[11px] font-semibold text-slate-700">
                {selectedTemplate.name}
              </div>
              {selectedTemplate.bodyText && (
                <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                  {selectedTemplate.bodyText}
                </p>
              )}
              {selectedTemplate.parameterSchema.length > 0 && (
                <div className="mb-3 grid gap-2">
                  {selectedTemplate.parameterSchema.map((param) => (
                    <label key={param.index} className="block">
                      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-400">
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
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[12px] text-[#0a1b33] outline-none transition-colors focus:border-slate-400"
                      />
                    </label>
                  ))}
                </div>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => onSendTemplate(selectedTemplate._id)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0a152d] px-3 py-2 text-[12px] font-medium text-white transition-all hover:bg-[#0a1b33] disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Send template
              </button>
            </div>
          )}
        </div>
      )}
      {showQuickReplies && (
        <div className="mb-3 border border-slate-200 rounded-lg bg-white max-h-48 overflow-y-auto">
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-700">
              Quick replies
            </span>
            <button
              type="button"
              onClick={() => setShowQuickReplies(false)}
              className="text-[11px] text-slate-500 hover:text-slate-900"
            >
              Cancel
            </button>
          </div>
          {(quickReplies ?? []).length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-slate-500 text-center">
              No quick replies yet.{" "}
              <a
                href="/app/quick-replies"
                className="text-[#0a152d] font-medium hover:underline"
              >
                Create one →
              </a>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(quickReplies ?? []).map((q) => (
                <li key={q._id}>
                  <button
                    type="button"
                    onClick={() => insertQuickReply(q.content)}
                    className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
                  >
                    <Zap
                      size={12}
                      className="text-amber-500 flex-shrink-0 mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-[#0a1b33]">
                        /{q.name}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {q.content}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
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
            "flex-1 resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-[14px] text-[#0a1b33] placeholder:text-slate-400",
            "focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all",
            "disabled:bg-slate-50 disabled:cursor-not-allowed",
          )}
        />
        <button
          type="button"
          onClick={() => setShowQuickReplies((v) => !v)}
          disabled={!within24h || busy}
          title="Quick replies"
          className="text-slate-500 hover:text-[#0a152d] p-2.5 rounded-xl border border-slate-200 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0"
        >
          <Zap size={16} strokeWidth={2.5} />
        </button>
        <button
          type="submit"
          disabled={!within24h || busy || !text.trim()}
          className="bg-[#0a152d] text-white p-2.5 rounded-xl shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-[#0a1b33] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0"
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
