"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Bot, CheckCircle2, KeyRound, Loader2, PlugZap, Save, XCircle } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

type Provider = "anthropic" | "openai" | "google" | "mock";
const PROVIDERS: Array<{ id: Provider; label: string }> = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI (GPT)" },
  { id: "google", label: "Google (Gemini)" },
];
const inputClass = "mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand-solid/40";

export function AiSettingsSection() {
  const { locale, tr } = useI18n();
  const settings = useQuery(api.aiSettings.get, {});
  const update = useMutation(api.aiSettings.update);
  const setKey = useMutation(api.aiSettings.setProviderKey);
  const clearKey = useMutation(api.aiSettings.clearProviderKey);
  const probe = useAction(api.aiProviders.probe);
  const [form, setForm] = useState<{ provider: Provider; routerModel: string; specialistModel: string; fallbackProvider: Provider | ""; fallbackModel: string; effort: "low" | "medium" | "high"; dailyBudgetUsd: string; maxTurnsPerThreadPerDay: number; maxToolCallsPerTurn: number; replyLanguage: "pt" | "en" } | null>(null);
  const [keyInput, setKeyInput] = useState<{ provider: Provider; value: string }>({ provider: "anthropic", value: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!settings || form) return;
    setForm({
      provider: settings.provider,
      routerModel: settings.routerModel,
      specialistModel: settings.specialistModel,
      fallbackProvider: settings.fallbackProvider ?? "",
      fallbackModel: settings.fallbackModel ?? "",
      effort: settings.effort,
      dailyBudgetUsd: (settings.dailyBudgetUsdCents / 100).toFixed(2),
      maxTurnsPerThreadPerDay: settings.maxTurnsPerThreadPerDay,
      maxToolCallsPerTurn: settings.maxToolCallsPerTurn,
      replyLanguage: settings.replyLanguage,
    });
    setKeyInput((current) => ({ ...current, provider: settings.provider }));
  }, [settings, form]);

  async function run(key: string, action: () => Promise<unknown>, success?: string) {
    setBusy(key);
    setNotice(null);
    try {
      await action();
      if (success) setNotice({ tone: "ok", text: success });
    } catch (err) {
      setNotice({ tone: "error", text: convexErrorMessage(err, locale) });
    } finally {
      setBusy(null);
    }
  }

  const suggestions = (settings?.suggestions ?? {}) as Record<Provider, { router: string[]; specialist: string[] }>;
  const primaryStatus = settings?.providerStatus.find((s) => s.provider === settings.provider && s.model === settings.specialistModel);

  return (
    <div className="space-y-6">
      {notice && <div className={cn("rounded-lg border px-4 py-3 text-sm", notice.tone === "error" ? "border-[#e0533d]/30 bg-[#fdf1ef] text-[#b3261e]" : "border-[#0d6b61]/30 bg-[#edf8f6] text-[#0d6b61]")}>{notice.text}</div>}

      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line-soft px-6 py-4">
          <Bot size={16} className="text-ink" />
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{tr("Inteligência artificial", "Artificial intelligence")}</h2>
            <p className="text-xs text-muted">{tr("Provedor, modelos e limites usados pelos agentes desta clínica. A chave nunca é mostrada depois de guardada.", "Provider, models and limits used by this clinic's agents. The key is never shown again after saving.")}</p>
          </div>
          {settings && (
            <span className={cn("ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold", settings.ready ? "border-[#0d6b61]/30 bg-[#edf8f6] text-[#0d6b61]" : "border-amber-200 bg-amber-50 text-amber-800")}>
              {settings.ready ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {settings.ready ? tr("Pronto", "Ready") : tr("Por testar", "Untested")}
            </span>
          )}
        </div>
        {!form || !settings ? (
          <div className="px-6 py-6"><Loader2 size={15} className="animate-spin text-faint" /></div>
        ) : (
          <div className="space-y-4 p-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-[11px] font-medium text-muted">
                {tr("Provedor principal", "Primary provider")}
                <select value={form.provider} onChange={(e) => { const provider = e.target.value as Provider; setForm({ ...form, provider, routerModel: suggestions[provider]?.router[0] ?? "", specialistModel: suggestions[provider]?.specialist[0] ?? "" }); }} className={inputClass}>
                  {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              <label className="block text-[11px] font-medium text-muted">
                {tr("Modelo do router (barato)", "Router model (cheap)")}
                <input list={`router-${form.provider}`} value={form.routerModel} onChange={(e) => setForm({ ...form, routerModel: e.target.value })} className={inputClass} />
                <datalist id={`router-${form.provider}`}>{(suggestions[form.provider]?.router ?? []).map((m) => <option key={m} value={m} />)}</datalist>
              </label>
              <label className="block text-[11px] font-medium text-muted">
                {tr("Modelo especialista", "Specialist model")}
                <input list={`spec-${form.provider}`} value={form.specialistModel} onChange={(e) => setForm({ ...form, specialistModel: e.target.value })} className={inputClass} />
                <datalist id={`spec-${form.provider}`}>{(suggestions[form.provider]?.specialist ?? []).map((m) => <option key={m} value={m} />)}</datalist>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-[11px] font-medium text-muted">
                {tr("Provedor de recurso", "Fallback provider")}
                <select value={form.fallbackProvider} onChange={(e) => setForm({ ...form, fallbackProvider: e.target.value as Provider | "", fallbackModel: e.target.value ? (suggestions[e.target.value as Provider]?.specialist[0] ?? "") : "" })} className={inputClass}>
                  <option value="">{tr("Nenhum", "None")}</option>
                  {PROVIDERS.filter((p) => p.id !== form.provider).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              <label className="block text-[11px] font-medium text-muted">
                {tr("Modelo de recurso", "Fallback model")}
                <input value={form.fallbackModel} onChange={(e) => setForm({ ...form, fallbackModel: e.target.value })} disabled={!form.fallbackProvider} className={inputClass} />
              </label>
              <label className="block text-[11px] font-medium text-muted">
                {tr("Esforço de raciocínio", "Reasoning effort")}
                <select value={form.effort} onChange={(e) => setForm({ ...form, effort: e.target.value as "low" | "medium" | "high" })} className={inputClass}>
                  <option value="low">{tr("Baixo (mais rápido)", "Low (fastest)")}</option>
                  <option value="medium">{tr("Médio", "Medium")}</option>
                  <option value="high">{tr("Alto (mais caro)", "High (costlier)")}</option>
                </select>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <label className="block text-[11px] font-medium text-muted">
                {tr("Orçamento diário (USD)", "Daily budget (USD)")}
                <input type="number" min={0} step="0.5" value={form.dailyBudgetUsd} onChange={(e) => setForm({ ...form, dailyBudgetUsd: e.target.value })} className={inputClass} />
              </label>
              <label className="block text-[11px] font-medium text-muted">
                {tr("Turnos por conversa/dia", "Turns per conversation/day")}
                <input type="number" min={1} max={200} value={form.maxTurnsPerThreadPerDay} onChange={(e) => setForm({ ...form, maxTurnsPerThreadPerDay: Number(e.target.value) })} className={inputClass} />
              </label>
              <label className="block text-[11px] font-medium text-muted">
                {tr("Ferramentas por turno", "Tools per turn")}
                <input type="number" min={1} max={12} value={form.maxToolCallsPerTurn} onChange={(e) => setForm({ ...form, maxToolCallsPerTurn: Number(e.target.value) })} className={inputClass} />
              </label>
              <label className="block text-[11px] font-medium text-muted">
                {tr("Idioma das respostas", "Reply language")}
                <select value={form.replyLanguage} onChange={(e) => setForm({ ...form, replyLanguage: e.target.value as "pt" | "en" })} className={inputClass}>
                  <option value="pt">Português</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] text-muted">
                {primaryStatus ? (
                  <span className={primaryStatus.ok ? "text-[#0d6b61]" : "text-[#b3261e]"}>
                    {primaryStatus.ok ? tr("Último teste OK", "Last test OK") : tr("Último teste falhou", "Last test failed")} · {primaryStatus.model} · {relativeTime(primaryStatus.checkedAt, Date.now(), locale)}{primaryStatus.latencyMs ? ` · ${primaryStatus.latencyMs} ms` : ""}{primaryStatus.error ? ` · ${primaryStatus.error}` : ""} · {tr("chave", "key")}: {primaryStatus.keySource === "tenant" ? tr("da clínica", "clinic") : primaryStatus.keySource === "platform" ? tr("da plataforma", "platform") : tr("nenhuma", "none")}
                  </span>
                ) : tr("Ainda não testado.", "Not tested yet.")}
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={busy !== null} onClick={() => void run("probe", () => probe({}), tr("Provedor respondeu.", "Provider responded."))} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[13px] font-semibold text-ink disabled:opacity-50">
                  {busy === "probe" ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} {tr("Testar ligação", "Test connection")}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      "save",
                      () =>
                        update({
                          provider: form.provider,
                          routerModel: form.routerModel,
                          specialistModel: form.specialistModel,
                          fallbackProvider: form.fallbackProvider || null,
                          fallbackModel: form.fallbackModel || null,
                          effort: form.effort,
                          dailyBudgetUsdCents: Math.round(Number(form.dailyBudgetUsd) * 100),
                          maxTurnsPerThreadPerDay: form.maxTurnsPerThreadPerDay,
                          maxToolCallsPerTurn: form.maxToolCallsPerTurn,
                          replyLanguage: form.replyLanguage,
                        }),
                      tr("Definições de IA guardadas. Teste a ligação para validar o modelo.", "AI settings saved. Test the connection to validate the model."),
                    )
                  }
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-solid px-4 text-[13px] font-semibold text-white disabled:opacity-50"
                >
                  {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {tr("Guardar", "Save")}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line-soft px-6 py-4">
          <KeyRound size={16} className="text-ink" />
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{tr("Chaves de API", "API keys")}</h2>
            <p className="text-xs text-muted">{tr("Opcional: chave própria da clínica por provedor (encriptada). Sem chave própria usa-se a da plataforma quando existir.", "Optional: the clinic's own key per provider (encrypted). Without one, the platform key is used when available.")}</p>
          </div>
        </div>
        <div className="space-y-3 p-6">
          <ul className="grid gap-2 sm:grid-cols-3">
            {PROVIDERS.map((p) => {
              const own = settings?.keys.find((k) => k.provider === p.id);
              const platform = settings?.platformKeys.includes(p.id);
              return (
                <li key={p.id} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px]">
                  <div className="font-semibold text-ink">{p.label}</div>
                  <div className="text-muted">
                    {own ? `${tr("chave da clínica", "clinic key")} ${own.masked}` : platform ? tr("chave da plataforma", "platform key") : tr("sem chave", "no key")}
                  </div>
                  {own && (
                    <button type="button" disabled={busy !== null} onClick={() => void run(`clear-${p.id}`, () => clearKey({ provider: p.id }), tr("Chave removida.", "Key removed."))} className="mt-1 text-[11px] font-semibold text-[#b3261e]">{tr("Remover", "Remove")}</button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
            <select value={keyInput.provider} onChange={(e) => setKeyInput({ ...keyInput, provider: e.target.value as Provider })} className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none">
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <input type="password" autoComplete="off" value={keyInput.value} onChange={(e) => setKeyInput({ ...keyInput, value: e.target.value })} placeholder={tr("Colar a chave (guardada encriptada)", "Paste the key (stored encrypted)")} className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none" />
            <button
              type="button"
              disabled={busy !== null || keyInput.value.trim().length < 16}
              onClick={() => void run("key", async () => { await setKey({ provider: keyInput.provider, apiKey: keyInput.value }); setKeyInput({ ...keyInput, value: "" }); }, tr("Chave guardada. Teste a ligação.", "Key saved. Test the connection."))}
              className="h-10 rounded-lg border border-line px-4 text-[13px] font-semibold text-ink disabled:opacity-50"
            >
              {tr("Guardar chave", "Save key")}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
