"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Archive, Loader2, Plus } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { convexErrorMessage } from "@/lib/convexErrorMessage";

const TYPES = ["text", "number", "date", "select", "boolean"] as const;
type FieldType = (typeof TYPES)[number];

export function CustomFieldsSettingsSection() {
  const { locale, t } = useI18n();
  const definitions = useQuery(api.customFields.listDefinitions, {});
  const saveDefinition = useMutation(api.customFields.saveDefinition);
  const archiveDefinition = useMutation(api.customFields.archiveDefinition);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [options, setOptions] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await saveDefinition({
        label,
        type,
        options: type === "select" ? options.split("\n").map((row) => row.trim()).filter(Boolean) : undefined,
      });
      setLabel("");
      setOptions("");
      setNotice(t("fields.saved"));
    } catch (cause) {
      setNotice(convexErrorMessage(cause, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface" data-custom-fields-settings>
      <div className="border-b border-line-soft px-6 py-4">
        <h2 className="text-[15px] font-semibold text-ink">{t("fields.settingsTitle")}</h2>
        <p className="mt-0.5 text-[12px] text-muted">{t("fields.settingsSubtitle")}</p>
      </div>
      <div className="grid gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          {definitions === undefined ? (
            <Loader2 size={15} className="animate-spin text-faint" />
          ) : definitions.length === 0 ? (
            <p className="text-[12px] text-faint">{t("fields.empty")}</p>
          ) : (
            <ul className="divide-y divide-line-soft rounded-lg border border-line-soft">
              {definitions.map((definition) => (
                <li key={definition._id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-ink">{definition.label}</div>
                    <div className="text-[10px] uppercase tracking-wide text-faint">
                      {t(`fields.type.${definition.type}` as TranslationKey)}
                      {definition.options?.length ? ` · ${definition.options.join(", ")}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void archiveDefinition({ definitionId: definition._id })}
                    className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-muted hover:border-line"
                  >
                    <Archive size={12} />
                    {t("fields.archive")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <form onSubmit={submit} className="space-y-2 rounded-lg bg-surface-2 p-3">
          <label className="block text-[11px] font-semibold text-muted">
            {t("fields.label")}
            <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={40} required className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-2.5 text-[12px] outline-none focus:border-brand-solid/40" />
          </label>
          <label className="block text-[11px] font-semibold text-muted">
            {t("fields.type")}
            <select value={type} onChange={(event) => setType(event.target.value as FieldType)} className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-2 text-[12px] outline-none">
              {TYPES.map((value) => (
                <option key={value} value={value}>{t(`fields.type.${value}` as TranslationKey)}</option>
              ))}
            </select>
          </label>
          {type === "select" && (
            <label className="block text-[11px] font-semibold text-muted">
              {t("fields.options")}
              <textarea value={options} onChange={(event) => setOptions(event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-line bg-surface px-2.5 py-2 text-[12px] outline-none focus:border-brand-solid/40" />
            </label>
          )}
          {notice && <p className="text-[11px] text-body">{notice}</p>}
          <button type="submit" disabled={busy || label.trim().length < 2} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-nav-active text-[12px] font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {t("fields.add")}
          </button>
        </form>
      </div>
    </section>
  );
}
