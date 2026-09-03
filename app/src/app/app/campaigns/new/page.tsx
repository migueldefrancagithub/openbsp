"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, Loader2, Rocket, ShieldCheck } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageHeader } from "@/components/app/EmptyState";
import { AudienceBuilder, DEFAULT_AUDIENCE, toAudienceArgs, type AudienceDraft } from "@/components/campaigns/AudienceBuilder";
import { DEFAULT_MESSAGE, MessageComposer, type MessageDraft } from "@/components/campaigns/MessageComposer";
import { blockReasonLabel, estimateDurationMs, humanDuration } from "@/components/campaigns/campaignLabels";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";

type Step = 1 | 2 | 3;

export default function NewCampaignPage() {
  const { locale, tr } = useI18n();
  const router = useRouter();
  const channels = useQuery(api.channels.list);
  const productChannels = useMemo(
    () => (channels ?? []).filter((c) => c.provider === "iasolution_hub" && c.operationalTerritory === "openbsp"),
    [channels],
  );
  const [channelId, setChannelId] = useState<Id<"channels"> | "">("");
  useEffect(() => {
    if (!channelId && productChannels.length >= 1) setChannelId(productChannels[0]._id);
  }, [channelId, productChannels]);

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [audience, setAudience] = useState<AudienceDraft>(DEFAULT_AUDIENCE);
  const [message, setMessage] = useState<MessageDraft>(DEFAULT_MESSAGE);
  const [campaignId, setCampaignId] = useState<Id<"campaigns"> | null>(null);
  const [clientNonce] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())));
  const [attest, setAttest] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation(api.channelCampaigns.create);
  const setAudienceMutation = useMutation(api.channelCampaigns.setAudience);
  const updateDraft = useMutation(api.channelCampaigns.updateDraft);
  const launch = useMutation(api.channelCampaigns.launch);
  const detail = useQuery(api.channelCampaigns.get, campaignId ? { campaignId } : "skip");

  const audienceArgs = useMemo(() => toAudienceArgs(audience), [audience]);
  const preview = useQuery(
    api.channelCampaigns.previewAudience,
    channelId ? { channelId, audience: audienceArgs, kind: message.kind } : "skip",
  );

  const messageValid =
    message.kind === "channel_text"
      ? message.text.trim().length > 0 && message.text.length <= 4096
      : Boolean(message.channelTemplateId) &&
        message.bindings.every((b) =>
          b.source === "static" ? b.value.trim().length > 0 : b.source === "tracked_link" ? /^https:\/\/\S+$/.test(b.value.trim()) : true,
        );
  const nameValid = name.trim().length >= 2 && name.trim().length <= 80;

  async function ensureDraft(): Promise<Id<"campaigns"> | null> {
    if (!channelId) return null;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        channelId,
        name: name.trim(),
        kind: message.kind,
        channelTemplateId: message.kind === "channel_template" ? (message.channelTemplateId as Id<"channelTemplates">) : undefined,
        variableBindings:
          message.kind === "channel_template"
            ? message.bindings.map((b) => ({ index: b.index, source: b.source, value: b.value.trim() || undefined }))
            : undefined,
        messageText: message.kind === "channel_text" ? message.text.trim() : undefined,
        audience: audienceArgs,
      };
      if (campaignId) {
        await updateDraft({
          campaignId,
          name: payload.name,
          messageText: payload.messageText,
          channelTemplateId: payload.channelTemplateId,
          variableBindings: payload.variableBindings,
        });
        await setAudienceMutation({ campaignId, audience: audienceArgs });
        return campaignId;
      }
      const id = await create({ ...payload, clientNonce });
      setCampaignId(id);
      return id;
    } catch (err) {
      setError(convexErrorMessage(err, locale));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function goToConfirm() {
    const id = await ensureDraft();
    if (id) setStep(3);
  }

  async function handleLaunch() {
    if (!campaignId) return;
    setBusy(true);
    setError(null);
    try {
      const when = scheduleMode === "later" && scheduledAt ? new Date(scheduledAt).getTime() : undefined;
      await launch({ campaignId, attestConsent: attest, scheduledAt: when });
      router.push(`/app/campaigns/${campaignId}`);
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    } finally {
      setBusy(false);
    }
  }

  const steps: Array<{ n: Step; label: string }> = [
    { n: 1, label: tr("Público", "Audience") },
    { n: 2, label: tr("Mensagem", "Message") },
    { n: 3, label: tr("Confirmação", "Confirm") },
  ];

  const summary = detail?.audienceSummary;
  const audienceReady = detail?.campaign.audienceStatus === "ready";
  const audienceEmpty = detail?.campaign.audienceStatus === "empty";
  const estimate = detail ? estimateDurationMs(summary?.eligible ?? 0, detail.batchSize, detail.batchIntervalMs) : 0;

  const inputClass =
    "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand-solid/40";

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={tr("Campanhas", "Campaigns")}
        title={tr("Nova campanha", "New campaign")}
        description={tr("Três passos: quem recebe, o que recebe e a confirmação segura.", "Three steps: who receives it, what they receive, and a safe confirmation.")}
        action={
          <Link href="/app/campaigns" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12px] font-semibold text-body">
            <ArrowLeft size={14} /> {tr("Voltar", "Back")}
          </Link>
        }
      />

      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6 xl:px-8">
        <ol className="grid grid-cols-3 gap-2">
          {steps.map((s) => {
            const done = s.n < step;
            const active = s.n === step;
            return (
              <li key={s.n} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-semibold", active ? "border-brand-solid bg-brand-solid text-white" : done ? "border-[#0d6b61]/30 bg-chip-success text-chip-success-fg" : "border-line bg-surface text-muted")}>
                <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px]", active ? "bg-white/15" : done ? "bg-[#0d6b61] text-white" : "bg-surface-3")}>
                  {done ? <CheckCircle2 size={12} /> : s.n}
                </span>
                <span className="truncate">{s.label}</span>
              </li>
            );
          })}
        </ol>

        {error && <div className="rounded-lg border border-[#e0533d]/30 bg-chip-danger px-4 py-3 text-[13px] text-chip-danger-fg">{error}</div>}

        {step === 1 && (
          <section className="space-y-5 rounded-lg border border-line bg-surface p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-[11px] font-medium text-muted">{tr("Nome da campanha", "Campaign name")}</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("Vagas de setembro", "September slots")} className={`mt-1 ${inputClass}`} maxLength={80} />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-muted">{tr("Canal", "Channel")}</span>
                <select value={channelId} onChange={(e) => setChannelId(e.target.value as Id<"channels"> | "")} className={`mt-1 ${inputClass}`}>
                  {productChannels.length === 0 && <option value="">{tr("Nenhum canal ligado", "No channel connected")}</option>}
                  {productChannels.map((c) => (
                    <option key={c._id} value={c._id}>{c.displayName}</option>
                  ))}
                </select>
              </label>
            </div>
            <AudienceBuilder channelId={channelId} kind={message.kind} draft={audience} onChange={setAudience} />
            <div className="flex justify-end">
              <button
                type="button"
                disabled={!nameValid || !channelId || (preview?.eligible ?? 0) === 0}
                onClick={() => setStep(2)}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-solid px-4 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {tr("Continuar", "Continue")} <ArrowRight size={14} />
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-5 rounded-lg border border-line bg-surface p-5">
            <MessageComposer channelId={channelId} draft={message} onChange={setMessage} serviceWindowHint={preview?.blocked.SERVICE_WINDOW_EXPIRED} />
            <div className="flex justify-between">
              <button type="button" onClick={() => setStep(1)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[13px] font-semibold text-body">
                <ArrowLeft size={14} /> {tr("Público", "Audience")}
              </button>
              <button
                type="button"
                disabled={!messageValid || busy}
                onClick={() => void goToConfirm()}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-solid px-4 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {tr("Rever e confirmar", "Review and confirm")} <ArrowRight size={14} />
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="space-y-5 rounded-lg border border-line bg-surface p-5">
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="space-y-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">{tr("Resumo", "Summary")}</div>
                <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-[13px]">
                  <dt className="text-muted">{tr("Nome", "Name")}</dt><dd className="font-semibold text-ink">{name}</dd>
                  <dt className="text-muted">{tr("Canal", "Channel")}</dt><dd className="text-ink">{detail?.channelName ?? "—"}</dd>
                  <dt className="text-muted">{tr("Mensagem", "Message")}</dt>
                  <dd className="text-ink">{message.kind === "channel_text" ? tr("Texto (janela 24h)", "Text (24h window)") : `${tr("Template", "Template")} ${detail?.templateName ?? ""}`}</dd>
                  <dt className="text-muted">{tr("Ritmo", "Pace")}</dt>
                  <dd className="text-ink">
                    {detail ? tr(`${detail.batchSize} a cada ${Math.round(detail.batchIntervalMs / 1000)} s · ${humanDuration(estimate, locale)}`, `${detail.batchSize} every ${Math.round(detail.batchIntervalMs / 1000)} s · ${humanDuration(estimate, locale)}`) : "—"}
                  </dd>
                </dl>
                <div className="rounded-lg border border-line bg-surface-2 p-3 text-[13px] leading-relaxed text-ink whitespace-pre-wrap">
                  {detail?.messageText ?? detail?.campaign.contentPreview ?? message.text}
                </div>
              </div>
              <div className="space-y-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">{tr("Público final", "Final audience")}</div>
                {!detail || (!audienceReady && !audienceEmpty) ? (
                  <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-3 text-[13px] text-muted">
                    <Loader2 size={14} className="animate-spin" /> {tr("A calcular destinatários…", "Calculating recipients…")}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-[#0d6b61]/30 bg-chip-success px-3 py-2">
                        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-chip-success-fg">{tr("Vão receber", "Will receive")}</div>
                        <div className="font-[var(--font-outfit)] text-[26px] font-medium text-chip-success-fg">{summary?.eligible ?? 0}</div>
                      </div>
                      <div className="rounded-lg border border-chip-warn-fg/25 bg-chip-warn px-3 py-2">
                        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-chip-warn-fg">{tr("Bloqueadas", "Blocked")}</div>
                        <div className="font-[var(--font-outfit)] text-[26px] font-medium text-chip-warn-fg">{(summary?.matched ?? 0) - (summary?.eligible ?? 0)}</div>
                      </div>
                    </div>
                    <ul className="space-y-1 text-[12px] text-body">
                      {Object.entries(summary?.blocked ?? {}).filter(([, n]) => n > 0).map(([code, n]) => (
                        <li key={code} className="flex justify-between"><span>{blockReasonLabel(code, locale)}</span><b className="text-ink">{n}</b></li>
                      ))}
                    </ul>
                    {audienceEmpty && (
                      <p className="rounded-lg border border-[#e0533d]/30 bg-chip-danger px-3 py-2 text-[12px] text-chip-danger-fg">
                        {tr("Nenhum destinatário elegível. Volte ao público ou peça a inclusão dos números no piloto.", "No eligible recipients. Revisit the audience or ask for the numbers to join the pilot.")}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="grid gap-3 rounded-lg border border-line bg-surface-2 p-4 sm:grid-cols-[1fr_auto]">
              <label className="flex items-start gap-2 text-[13px] text-ink">
                <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0a1b33]" />
                <span>
                  <ShieldCheck size={13} className="mr-1 inline text-chip-success-fg" />
                  {tr(
                    "Confirmo que estes pacientes deram consentimento para receber mensagens da clínica e que a mensagem respeita as regras do WhatsApp.",
                    "I confirm these patients consented to receive messages from the clinic and the message follows WhatsApp's rules.",
                  )}
                </span>
              </label>
              <div className="flex flex-col gap-1.5">
                <div className="inline-flex rounded-lg border border-line bg-surface p-1 text-[12px] font-semibold">
                  {(["now", "later"] as const).map((mode) => (
                    <button key={mode} type="button" onClick={() => setScheduleMode(mode)} className={cn("rounded-md px-3 py-1.5", scheduleMode === mode ? "bg-brand-solid text-white" : "text-muted")}>
                      {mode === "now" ? tr("Enviar agora", "Send now") : tr("Agendar", "Schedule")}
                    </button>
                  ))}
                </div>
                {scheduleMode === "later" && (
                  <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2 text-[12px] text-ink outline-none" />
                )}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <button type="button" onClick={() => setStep(2)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[13px] font-semibold text-body">
                <ArrowLeft size={14} /> {tr("Mensagem", "Message")}
              </button>
              <button
                type="button"
                disabled={!campaignId || !audienceReady || !attest || busy || (scheduleMode === "later" && !scheduledAt)}
                onClick={() => void handleLaunch()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0d6b61] px-5 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : scheduleMode === "later" ? <CalendarClock size={14} /> : <Rocket size={14} />}
                {scheduleMode === "later" ? tr("Agendar campanha", "Schedule campaign") : tr("Lançar campanha", "Launch campaign")}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
