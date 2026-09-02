"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { FileText, MessageSquareText } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { WhatsAppIosPreview } from "@/components/WhatsAppIosPreview";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import type { TemplateCategory } from "@/lib/whatsappTemplateAdvisor";

export type BindingDraft = { index: number; source: "static" | "first_name" | "tracked_link"; value: string };

export type MessageDraft = {
  kind: "channel_template" | "channel_text";
  channelTemplateId: Id<"channelTemplates"> | "";
  bindings: BindingDraft[];
  text: string;
};

export const DEFAULT_MESSAGE: MessageDraft = {
  kind: "channel_template",
  channelTemplateId: "",
  bindings: [],
  text: "",
};

export function templateBody(components: unknown): string {
  if (!Array.isArray(components)) return "";
  const body = components.find(
    (c) => c && typeof c === "object" && String((c as { type?: unknown }).type ?? "").toUpperCase() === "BODY",
  ) as { text?: string } | undefined;
  return body?.text ?? "";
}

export function templateVariableCount(components: unknown): number {
  let max = 0;
  for (const match of templateBody(components).matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    max = Math.max(max, Number(match[1]));
  }
  return max;
}

export function renderPreview(body: string, bindings: BindingDraft[], firstName: string): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
    const binding = bindings.find((b) => b.index === Number(n));
    if (!binding) return `{{${n}}}`;
    if (binding.source === "first_name") return firstName;
    if (binding.source === "tracked_link") return "https://…/r/abc123";
    return binding.value || `{{${n}}}`;
  });
}

function categoryOf(value: string | undefined): TemplateCategory {
  const lower = (value ?? "").toLowerCase();
  if (lower === "utility" || lower === "authentication") return lower;
  return "marketing";
}

export function MessageComposer({
  channelId,
  draft,
  onChange,
  serviceWindowHint,
}: {
  channelId: Id<"channels"> | "";
  draft: MessageDraft;
  onChange: (next: MessageDraft) => void;
  serviceWindowHint?: number;
}) {
  const { locale, tr } = useI18n();
  const templates = useQuery(api.channels.listTemplates, channelId ? { channelId } : "skip");
  const selected = useMemo(
    () => (templates ?? []).find((row) => row._id === draft.channelTemplateId),
    [templates, draft.channelTemplateId],
  );
  const body = templateBody(selected?.components);
  const variableCount = templateVariableCount(selected?.components);

  function selectTemplate(id: string) {
    const template = (templates ?? []).find((row) => row._id === id);
    const count = templateVariableCount(template?.components);
    onChange({
      ...draft,
      channelTemplateId: id as Id<"channelTemplates"> | "",
      bindings: Array.from({ length: count }, (_, i) => draft.bindings[i] ?? { index: i + 1, source: "static", value: "" }),
    });
  }

  function updateBinding(index: number, patch: Partial<BindingDraft>) {
    onChange({
      ...draft,
      bindings: draft.bindings.map((b) => (b.index === index ? { ...b, ...patch } : b)),
    });
  }

  const previewText =
    draft.kind === "channel_text"
      ? draft.text.replace(/\{\{\s*(nome|name|first_name|primeiro_nome)\s*\}\}/gi, "Ana")
      : renderPreview(body, draft.bindings, "Ana");

  const inputClass =
    "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33] outline-none focus:border-slate-400";

  return (
    <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
      <div className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { kind: "channel_template", icon: FileText, title: tr("Template aprovado", "Approved template"), desc: tr("Chega a qualquer conversa, mesmo fora da janela de 24h.", "Reaches any conversation, even outside the 24h window.") },
              { kind: "channel_text", icon: MessageSquareText, title: tr("Texto livre", "Free text"), desc: tr("Só para conversas com janela de 24h aberta.", "Only for conversations with an open 24h window.") },
            ] as const
          ).map((option) => {
            const Icon = option.icon;
            const active = draft.kind === option.kind;
            return (
              <button
                key={option.kind}
                type="button"
                onClick={() => onChange({ ...draft, kind: option.kind })}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  active ? "border-[#0a1b33] bg-[#0a1b33] text-white" : "border-slate-200 bg-white hover:border-slate-300",
                )}
              >
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", active ? "bg-white/10" : "bg-slate-100 text-slate-600")}>
                  <Icon size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">{option.title}</span>
                  <span className={cn("block text-[11px]", active ? "text-white/80" : "text-slate-500")}>{option.desc}</span>
                </span>
              </button>
            );
          })}
        </div>

        {draft.kind === "channel_template" ? (
          <>
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500">{tr("Template", "Template")}</span>
              <select value={draft.channelTemplateId} onChange={(e) => selectTemplate(e.target.value)} className={`mt-1 ${inputClass}`} disabled={!channelId}>
                <option value="">{templates === undefined ? tr("A carregar…", "Loading…") : tr("Escolher template aprovado", "Pick an approved template")}</option>
                {(templates ?? []).map((row) => (
                  <option key={row._id} value={row._id}>
                    {row.name} · {row.languageCode}{row.category ? ` · ${row.category}` : ""}
                  </option>
                ))}
              </select>
              {templates !== undefined && templates.length === 0 && (
                <p className="mt-1.5 text-[11px] text-amber-700">
                  {tr("Nenhum template aprovado neste canal. Sincronize em Templates.", "No approved template on this channel. Sync in Templates.")}
                </p>
              )}
            </label>
            {selected && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px] leading-relaxed text-[#0a1b33] whitespace-pre-wrap">
                {body || tr("(template sem corpo)", "(template without body)")}
              </div>
            )}
            {variableCount > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">{tr("Variáveis", "Variables")}</div>
                {draft.bindings.map((binding) => (
                  <div key={binding.index} className="grid gap-2 sm:grid-cols-[80px_170px_1fr]">
                    <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-white px-3 font-mono text-[12px] text-slate-500">{`{{${binding.index}}}`}</div>
                    <select
                      value={binding.source}
                      onChange={(e) => updateBinding(binding.index, { source: e.target.value as BindingDraft["source"] })}
                      className={inputClass}
                    >
                      <option value="static">{tr("Texto fixo", "Fixed text")}</option>
                      <option value="first_name">{tr("Primeiro nome", "First name")}</option>
                      <option value="tracked_link">{tr("Link rastreado", "Tracked link")}</option>
                    </select>
                    <input
                      value={binding.value}
                      onChange={(e) => updateBinding(binding.index, { value: e.target.value })}
                      placeholder={
                        binding.source === "tracked_link"
                          ? "https://…"
                          : binding.source === "first_name"
                            ? tr("Valor se não houver nome (ex.: paciente)", "Fallback when no name (e.g. patient)")
                            : tr("Valor", "Value")
                      }
                      className={inputClass}
                    />
                  </div>
                ))}
                <p className="text-[11px] text-slate-500">
                  {tr("O link rastreado passa por /r/{token} e regista cliques por destinatário.", "Tracked links go through /r/{token} and record clicks per recipient.")}
                </p>
              </div>
            )}
          </>
        ) : (
          <label className="block">
            <span className="text-[11px] font-medium text-slate-500">{tr("Mensagem", "Message")}</span>
            <textarea
              value={draft.text}
              onChange={(e) => onChange({ ...draft, text: e.target.value })}
              rows={6}
              maxLength={4096}
              placeholder={tr("Olá {{nome}}, abrimos vagas esta semana. Quer marcar?", "Hi {{name}}, we opened slots this week. Want to book?")}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0a1b33] outline-none focus:border-slate-400"
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>{tr("Use {{nome}} para o primeiro nome.", "Use {{name}} for the first name.")}</span>
              <span>{draft.text.length}/4096</span>
            </div>
            {serviceWindowHint !== undefined && serviceWindowHint > 0 && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                {tr(
                  `${serviceWindowHint} conversa(s) do público estão fora da janela de 24h e ficarão bloqueadas. Use um template para as alcançar.`,
                  `${serviceWindowHint} conversation(s) in the audience are outside the 24h window and will be blocked. Use a template to reach them.`,
                )}
              </p>
            )}
          </label>
        )}
      </div>

      <aside className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 text-[13px] font-semibold text-[#0a1b33]">{tr("Pré-visualização", "Preview")}</div>
        <WhatsAppIosPreview
          category={draft.kind === "channel_text" ? "utility" : categoryOf(selected?.category)}
          bodyText={previewText || tr("A sua mensagem aparece aqui.", "Your message shows up here.")}
          examples={{}}
          hasMarketingOptIn
          serviceWindowOpen={draft.kind === "channel_text"}
          freeEntryWindowOpen={false}
          title={locale === "pt" ? "Clínica" : "Clinic"}
        />
      </aside>
    </div>
  );
}
