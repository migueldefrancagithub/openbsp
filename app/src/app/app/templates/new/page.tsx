"use client";

import { useEffect, useState, useMemo, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ChevronLeft,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Plus,
  Trash2,
  FileText,
  MessageSquare,
  MousePointerClick,
  SlidersHorizontal,
} from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { SegmentedTabs } from "@/components/app/SegmentedTabs";
import { WhatsAppIosPreview } from "@/components/WhatsAppIosPreview";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { TemplateCategory } from "@/lib/whatsappTemplateAdvisor";
import { BRAND_NAME } from "@/components/Brand";
import { useI18n } from "@/lib/i18n";

type TemplateButton =
  | { type: "quick_reply"; text: string }
  | { type: "url"; text: string; url: string }
  | { type: "phone_number"; text: string; phoneNumber: string };
type TemplateTabKey = "setup" | "message" | "buttons" | "guardrails";

const TEMPLATE_PRESETS: Array<{
  label: [string, string];
  name: string;
  category: TemplateCategory;
  bodyText: string;
  examples: Record<number, string>;
  buttons: TemplateButton[];
}> = [
  {
    label: ["Lembrete de consulta", "Appointment reminder"],
    name: "appointment_reminder",
    category: "utility",
    bodyText:
      "Ola {{1}}, lembrete da sua consulta em {{2}} com {{3}}. Responda 1 para confirmar ou 2 para remarcar.",
    examples: { 1: "Maria", 2: "amanha as 10h00", 3: "Dra. Sofia" },
    buttons: [
      { type: "quick_reply", text: "Confirmar" },
      { type: "quick_reply", text: "Remarcar" },
    ],
  },
  {
    label: ["Reativação de paciente", "Patient reactivation"],
    name: "reactivation_offer",
    category: "marketing",
    bodyText:
      "Ola {{1}}, temos vagas esta semana para {{2}}. Quer reservar? Responda SIM. Para sair, responda STOP.",
    examples: { 1: "Maria", 2: "limpeza facial" },
    buttons: [
      { type: "quick_reply", text: "Tenho interesse" },
      { type: "quick_reply", text: "Parar mensagens" },
    ],
  },
  {
    label: ["Código de autenticação", "Authentication code"],
    name: "login_code",
    category: "authentication",
    bodyText: `{{1}} e o seu codigo ${BRAND_NAME}. Valido por 10 minutos. Nao partilhe este codigo.`,
    examples: { 1: "493021" },
    buttons: [],
  },
];

export default function NewTemplatePage() {
  const { locale, tr } = useI18n();
  const router = useRouter();
  const accounts = useQuery(api.whatsappAccounts.listForTenant);
  const create = useMutation(api.templates.createDraft);
  const createAndSubmit = useAction(api.templates.createAndSubmitForApproval);

  const [whatsappAccountId, setWhatsappAccountId] = useState<string>("");
  const [name, setName] = useState("appointment_reminder");
  const [language, setLanguage] = useState("pt_PT");
  const [category, setCategory] = useState<"marketing" | "utility" | "authentication">("utility");
  const [hasMarketingOptIn, setHasMarketingOptIn] = useState(false);
  const [serviceWindowOpen, setServiceWindowOpen] = useState(true);
  const [freeEntryWindowOpen, setFreeEntryWindowOpen] = useState(false);
  const [bodyText, setBodyText] = useState(
    "Olá {{1}}, lembrete da sua consulta amanhã às {{2}} com a {{3}}.",
  );
  const [buttons, setButtons] = useState<TemplateButton[]>([
    { type: "quick_reply", text: "Confirmar" },
    { type: "quick_reply", text: "Remarcar" },
  ]);
  const [examples, setExamples] = useState<Record<number, string>>({
    1: "Maria",
    2: "10h00",
    3: "Dra. Sofia",
  });
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templateTab, setTemplateTab] = useState<TemplateTabKey>("setup");

  const detectedIndices = useMemo(() => {
    const set = new Set<number>();
    const re = /\{\{(\d+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(bodyText)) !== null) set.add(Number(m[1]));
    return Array.from(set).sort((a, b) => a - b);
  }, [bodyText]);

  useEffect(() => {
    if (whatsappAccountId === "" && accounts && accounts.length > 0) {
      setWhatsappAccountId(accounts[0]._id);
    }
  }, [accounts, whatsappAccountId]);

  function templatePayload() {
    return {
      whatsappAccountId: whatsappAccountId as Id<"whatsappAccounts">,
      name: name.trim(),
      language: language.trim(),
      category,
      bodyText,
      buttons: buttons.length > 0 ? buttons : undefined,
      parameterSchema: detectedIndices.map((i) => ({
        index: i,
        name: `var_${i}`,
        example: examples[i] ?? "",
      })),
    };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("draft");
    try {
      const id = await create(templatePayload());
      router.push(`/app/templates/${id}`);
    } catch (err: unknown) {
      const data =
        err && typeof err === "object" && "data" in err
          ? (err as { data: unknown }).data
          : null;
      const msg =
        data && typeof data === "object" && "message" in data
          ? String((data as { message: unknown }).message)
          : err instanceof Error
            ? err.message
            : tr("Não foi possível criar o template", "Could not create template");
      setError(msg);
    } finally {
      setBusy(null);
    }
  }

  async function onCreateAndSubmit() {
    setError(null);
    setBusy("submit");
    try {
      const result = await createAndSubmit(templatePayload());
      if (result.submissionState === "submitted") {
        router.push(`/app/templates/${result.templateId}?submission=submitted`);
        return;
      }
      const reason = encodeURIComponent(
        result.submissionError ?? tr("A submissão à Meta falhou.", "Meta submission failed."),
      );
      router.push(
        `/app/templates/${result.templateId}?submission=draft_saved&reason=${reason}`,
      );
    } catch (err: unknown) {
      const data =
        err && typeof err === "object" && "data" in err
          ? (err as { data: unknown }).data
          : null;
      const msg =
        data && typeof data === "object" && "message" in data
          ? String((data as { message: unknown }).message)
          : err instanceof Error
            ? err.message
            : tr("Não foi possível criar e submeter o template", "Could not create and submit template");
      setError(msg);
    } finally {
      setBusy(null);
    }
  }

  function applyPreset(preset: (typeof TEMPLATE_PRESETS)[number]) {
    setName(preset.name);
    setCategory(preset.category);
    setBodyText(preset.bodyText);
    setExamples(preset.examples);
    setButtons(preset.buttons);
    setHasMarketingOptIn(preset.category !== "marketing");
    setServiceWindowOpen(preset.category === "utility");
    setFreeEntryWindowOpen(false);
  }

  function defaultButton(type: TemplateButton["type"]): TemplateButton {
    if (type === "url") {
      return { type, text: tr("Abrir link", "Open link"), url: "https://example.com" };
    }
    if (type === "phone_number") {
      return { type, text: tr("Ligar", "Call"), phoneNumber: "+258840000000" };
    }
    return { type, text: tr("Responder", "Reply") };
  }

  function updateButton(index: number, next: TemplateButton) {
    setButtons((prev) => prev.map((button, i) => (i === index ? next : button)));
  }

  function updateButtonText(index: number, text: string) {
    setButtons((prev) =>
      prev.map((button, i) => (i === index ? { ...button, text } : button)),
    );
  }

  if (accounts && accounts.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Templates" title={tr("Novo template", "New template")} description="" />
        <div className="max-w-2xl px-4 py-5 sm:px-6">
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p className="font-semibold text-amber-900">
              {tr(
                "Criar templates aqui exige uma ligação WhatsApp direta (Meta).",
                "Creating templates here requires a direct WhatsApp (Meta) connection.",
              )}
            </p>
            <p>
              {tr(
                "No canal do piloto (Hub), os templates são aprovados no próprio canal e aparecem em",
                "On the pilot (Hub) channel, templates are approved on the channel itself and show up in",
              )}{" "}
              <Link href="/app/templates" className="font-medium underline">
                Templates
              </Link>{" "}
              {tr("depois de sincronizar em", "after syncing in")}{" "}
              <Link href="/app/settings?tab=whatsapp#hub" className="font-medium underline">
                {tr("Definições › WhatsApp", "Settings › WhatsApp")}
              </Link>
              .
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Templates"
        title={tr("Novo template", "New template")}
        description={tr("Crie uma mensagem aprovada para iniciar atendimentos fora da janela de 24 horas.", "Create an approved message for starting conversations outside the 24-hour window.")}
        action={
          <Link
            href="/app/templates"
            className="inline-flex items-center gap-1 text-[13px] text-slate-600 hover:text-[#0a1b33] transition-colors"
          >
            <ChevronLeft size={14} />
            {tr("Voltar", "Back")}
          </Link>
        }
      />
      <div className="grid gap-5 px-4 py-5 sm:px-6 xl:grid-cols-[minmax(0,760px)_360px]">
        <form onSubmit={onSubmit} className="space-y-5">
          <SegmentedTabs
            selected={templateTab}
            onChange={(key) => setTemplateTab(key as TemplateTabKey)}
            items={[
              { key: "setup", label: tr("Configuração", "Setup"), value: category, icon: ShieldCheck },
              {
                key: "message",
                label: tr("Mensagem", "Message"),
                value: `${detectedIndices.length} ${tr("variáveis", "variables")}`,
                icon: MessageSquare,
              },
              {
                key: "buttons",
                label: tr("Botões", "Buttons"),
                value: `${buttons.length}/3`,
                icon: MousePointerClick,
              },
              {
                key: "guardrails",
                label: tr("Segurança", "Guardrails"),
                value: hasMarketingOptIn ? "Opt-in" : tr("Rever", "Review"),
                icon: SlidersHorizontal,
              },
            ]}
          />

          {templateTab === "setup" && (
          <>
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-[#0a1b33]">
                <ShieldCheck size={17} />
              </div>
              <div>
                <h2 className="font-[var(--font-outfit)] text-[17px] font-medium text-[#0a1b33]">
                  {tr("Cenários prontos", "Ready scenarios")}
                </h2>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  {tr("Comece com um caso clínico real e ajuste a mensagem com validação imediata.", "Start from a real clinic use case and adjust the message with immediate validation.")}
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {TEMPLATE_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-[12px] font-medium text-[#0a1b33] transition-colors hover:border-slate-300 hover:bg-white"
                >
                  {preset.label[locale === "pt" ? 0 : 1]}
                </button>
              ))}
            </div>
          </section>

          <Field label={tr("Nome (3-40 caracteres, minúsculas, _)", "Name (3-40 characters, lowercase, _)")}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-[var(--font-mono)] text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d]"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("Idioma", "Language")}>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d]"
              >
                <option value="pt_PT">pt_PT - {tr("Português (Portugal)", "Portuguese (Portugal)")}</option>
                <option value="pt_BR">pt_BR - {tr("Português (Brasil)", "Portuguese (Brazil)")}</option>
                <option value="en_US">en_US - {tr("Inglês", "English")}</option>
                <option value="es_ES">es_ES - {tr("Espanhol", "Spanish")}</option>
              </select>
            </Field>
            <Field label={tr("Categoria", "Category")}>
              <select
                value={category}
                onChange={(e) => {
                  const nextCategory = e.target.value as typeof category;
                  setCategory(nextCategory);
                  if (nextCategory === "authentication") setButtons([]);
                }}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d]"
              >
                <option value="utility">{tr("Utilidade (transacional)", "Utility (transactional)")}</option>
                <option value="marketing">{tr("Marketing (exige opt-in)", "Marketing (requires opt-in)")}</option>
                <option value="authentication">{tr("Autenticação (OTP)", "Authentication (OTP)")}</option>
              </select>
            </Field>
          </div>

          <Field label={tr("Conta WhatsApp Business", "WhatsApp Business Account")}>
            <select
              value={whatsappAccountId}
              onChange={(e) => setWhatsappAccountId(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d]"
            >
              {accounts?.map((a) => (
                <option key={a._id} value={a._id}>
                  WABA {a.wabaId}
                </option>
              ))}
            </select>
          </Field>
          </>
          )}

          {templateTab === "message" && (
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-[#0a1b33]">
                <FileText size={17} />
              </div>
              <div>
                <h2 className="font-[var(--font-outfit)] text-[17px] font-medium text-[#0a1b33]">
                  {tr("Conteúdo da mensagem", "Message body")}
                </h2>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  {tr("As variáveis e os exemplos são enviados à Meta com o template.", "Variables and examples are sent to Meta with the template.")}
                </p>
              </div>
            </div>
          <Field label={tr("Texto (use {{1}}, {{2}}, ... para variáveis)", "Body text (use {{1}}, {{2}}, ... for variables)")}>
            <textarea
              rows={5}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] resize-none font-mono"
            />
            <p className="text-[11px] text-slate-400 mt-1.5">
              {bodyText.length} / 1024 {tr("caracteres", "characters")} · {detectedIndices.length}{" "}
              {locale === "pt"
                ? detectedIndices.length === 1 ? "variável detetada" : "variáveis detetadas"
                : detectedIndices.length === 1 ? "variable detected" : "variables detected"}
            </p>
          </Field>

          {detectedIndices.length > 0 && (
            <Field label={tr("Exemplos (a Meta exige um por variável)", "Examples (Meta requires one per variable)")}>
              <div className="space-y-2">
                {detectedIndices.map((i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[12px] font-[var(--font-mono)] text-slate-500 w-12">
                      {`{{${i}}}`}
                    </span>
                    <input
                      type="text"
                      value={examples[i] ?? ""}
                      onChange={(e) =>
                        setExamples((prev) => ({ ...prev, [i]: e.target.value }))
                      }
                      required
                      placeholder={tr("Valor de exemplo", "Example value")}
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d]"
                    />
                  </div>
                ))}
              </div>
            </Field>
          )}
          </section>
          )}

          {templateTab === "buttons" && (
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-[var(--font-outfit)] text-[17px] font-medium text-[#0a1b33]">
                  {tr("Botões do template", "Template buttons")}
                </h2>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  {tr("Respostas, links e chamadas são enviados com o pedido de aprovação.", "Replies, links and calls are sent with the approval request.")}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setButtons((prev) => [...prev, defaultButton("quick_reply")])
                }
                disabled={buttons.length >= 3}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-[#0a1b33] transition-colors hover:bg-white disabled:opacity-40"
                title={tr("Adicionar botão", "Add button")}
              >
                <Plus size={15} />
              </button>
            </div>

            {buttons.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-[12px] text-slate-500">
                {tr("Este template não tem botões.", "This template has no buttons.")}
              </div>
            ) : (
              <div className="space-y-3">
                {buttons.map((button, index) => (
                  <div
                    key={`${button.type}-${index}`}
                    className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[150px_1fr_auto]"
                  >
                    <select
                      value={button.type}
                      onChange={(event) =>
                        updateButton(
                          index,
                          defaultButton(event.target.value as TemplateButton["type"]),
                        )
                      }
                      className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[12px] text-[#0a1b33] outline-none focus:border-slate-400"
                    >
                      <option value="quick_reply">{tr("Resposta rápida", "Quick reply")}</option>
                      <option value="url">URL</option>
                      <option value="phone_number">{tr("Telefone", "Phone")}</option>
                    </select>
                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        type="text"
                        value={button.text}
                        onChange={(event) =>
                          updateButtonText(index, event.target.value)
                        }
                        maxLength={25}
                        placeholder={tr("Texto do botão", "Button text")}
                        className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[12px] text-[#0a1b33] outline-none focus:border-slate-400"
                      />
                      {button.type === "url" && (
                        <input
                          type="url"
                          value={button.url}
                          onChange={(event) =>
                            updateButton(index, {
                              ...button,
                              url: event.target.value,
                            })
                          }
                          placeholder="https://..."
                          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[12px] text-[#0a1b33] outline-none focus:border-slate-400"
                        />
                      )}
                      {button.type === "phone_number" && (
                        <input
                          type="tel"
                          value={button.phoneNumber}
                          onChange={(event) =>
                            updateButton(index, {
                              ...button,
                              phoneNumber: event.target.value,
                            })
                          }
                          placeholder="+351..."
                          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[12px] text-[#0a1b33] outline-none focus:border-slate-400"
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setButtons((prev) => prev.filter((_, i) => i !== index))
                      }
                      className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:text-red-600"
                      title={tr("Remover botão", "Remove button")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          )}

          {templateTab === "guardrails" && (
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-[var(--font-outfit)] text-[17px] font-medium text-[#0a1b33]">
              {tr("Condições de envio", "Sending context")}
            </h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Toggle
                label={tr("Consentimento de marketing", "Marketing opt-in")}
                checked={hasMarketingOptIn}
                onChange={setHasMarketingOptIn}
              />
              <Toggle
                label={tr("Janela de atendimento de 24h", "24h service window")}
                checked={serviceWindowOpen}
                onChange={setServiceWindowOpen}
              />
              <Toggle
                label={tr("Entrada gratuita CTWA de 72h", "72h CTWA free entry")}
                checked={freeEntryWindowOpen}
                onChange={setFreeEntryWindowOpen}
              />
            </div>
          </section>
          )}

          {error && (
            <div className="flex items-start gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
              <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-3">
            <button
              type="submit"
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-medium text-[#0a1b33] transition-all hover:border-slate-300 disabled:opacity-50"
            >
              {busy === "draft" && <Loader2 size={14} className="animate-spin" />}
              {tr("Guardar rascunho", "Save draft")}
            </button>
            <button
              type="button"
              onClick={onCreateAndSubmit}
              disabled={busy !== null || !whatsappAccountId}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0a152d] px-4 py-2.5 text-[13px] font-medium text-white transition-all hover:bg-[#0a1b33] disabled:opacity-50"
            >
              {busy === "submit" && <Loader2 size={14} className="animate-spin" />}
              {tr("Criar e submeter à Meta", "Create and submit to Meta")}
            </button>
          </div>
        </form>

        <div className="xl:sticky xl:top-6 xl:self-start">
          <WhatsAppIosPreview
            category={category}
            bodyText={bodyText}
            buttons={buttons}
            examples={examples}
            hasMarketingOptIn={hasMarketingOptIn}
            serviceWindowOpen={serviceWindowOpen}
            freeEntryWindowOpen={freeEntryWindowOpen}
          />
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-medium text-[#0a1b33]">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[#0a152d]"
      />
    </label>
  );
}
