"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useI18n } from "@/lib/i18n";
import { convexErrorMessage } from "@/lib/convexErrorMessage";

type FieldValue = string | number | boolean;

/**
 * Tenant-defined patient fields, edited inline with autosave. Values live on
 * the thread; definitions come from Settings.
 */
export function CustomFieldsSection({
  threadId,
  values,
}: {
  threadId: Id<"channelThreads">;
  values: Record<string, FieldValue> | undefined;
}) {
  const { locale, t } = useI18n();
  const definitions = useQuery(api.customFields.listDefinitions, {});
  const updateThread = useMutation(api.inboxOperations.updateThread);
  const [error, setError] = useState<string | null>(null);

  async function save(key: string, value: FieldValue | "") {
    setError(null);
    try {
      await updateThread({ threadId, customFields: { [key]: value } });
    } catch (cause) {
      setError(convexErrorMessage(cause, locale));
    }
  }

  if (definitions === undefined) return null;
  if (definitions.length === 0) {
    return <p className="text-[10px] text-slate-400">{t("fields.empty")}</p>;
  }
  const inputClass =
    "mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] text-[#0a1b33] outline-none focus:border-slate-400";

  return (
    <div className="grid grid-cols-2 gap-2" data-custom-fields>
      {definitions.map((definition) => {
        const current = values?.[definition.key];
        return (
          <label key={definition._id} className="min-w-0 text-[10px] font-semibold text-slate-400">
            <span className="block truncate">{definition.label}</span>
            {definition.type === "select" ? (
              <select
                value={typeof current === "string" ? current : ""}
                onChange={(event) => void save(definition.key, event.target.value)}
                className={inputClass}
              >
                <option value="">—</option>
                {(definition.options ?? []).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            ) : definition.type === "boolean" ? (
              <select
                value={current === true ? "true" : current === false ? "false" : ""}
                onChange={(event) =>
                  void save(definition.key, event.target.value === "" ? "" : event.target.value === "true")
                }
                className={inputClass}
              >
                <option value="">—</option>
                <option value="true">{t("fields.yes")}</option>
                <option value="false">{t("fields.no")}</option>
              </select>
            ) : (
              <input
                key={`${definition.key}:${String(current ?? "")}`}
                type={definition.type === "number" ? "number" : definition.type === "date" ? "date" : "text"}
                defaultValue={current === undefined ? "" : String(current)}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next === String(current ?? "")) return;
                  void save(definition.key, definition.type === "number" && next !== "" ? Number(next) : next);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur();
                }}
                className={inputClass}
              />
            )}
          </label>
        );
      })}
      {error && <p className="col-span-2 text-[10px] text-[#b3261e]">{error}</p>}
    </div>
  );
}
