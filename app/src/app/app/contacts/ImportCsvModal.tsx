"use client";

import { useMemo, useState } from "react";
import { Upload, X, Check, AlertCircle, Loader2 } from "lucide-react";

type ParsedRow = {
  phone: string;
  name?: string;
  locale?: string;
  tags?: string[];
  marketingConsentProofText?: string;
  marketingConsentProofUrl?: string;
};

type ImportResult = {
  created: number;
  updated: number;
  skipped: Array<{ phone: string; reason: string }>;
  consentsRecorded: number;
};

type Props = {
  onClose: () => void;
  onImport: (rows: ParsedRow[]) => Promise<ImportResult>;
};

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/** Minimal CSV parser: handles quoted fields, escaped quotes, and CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        cur.push(field);
        field = "";
      } else if (ch === "\n") {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      } else if (ch === "\r") {
        // Skip; \n handles the row break.
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

const HEADER_ALIASES: Record<string, keyof ParsedRow> = {
  phone: "phone",
  telefone: "phone",
  whatsapp: "phone",
  number: "phone",
  numero: "phone",
  name: "name",
  nome: "name",
  locale: "locale",
  idioma: "locale",
  tags: "tags",
  marketingconsentprooftext: "marketingConsentProofText",
  consenttext: "marketingConsentProofText",
  prooftext: "marketingConsentProofText",
  marketingconsentproofurl: "marketingConsentProofUrl",
  consenturl: "marketingConsentProofUrl",
  proofurl: "marketingConsentProofUrl",
};

function mapHeaders(headerRow: string[]): Array<keyof ParsedRow | null> {
  return headerRow.map((h) => {
    const key = h.trim().toLowerCase().replace(/[\s_-]/g, "");
    return HEADER_ALIASES[key] ?? null;
  });
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return "+" + digits;
}

export function ImportCsvModal({ onClose, onImport }: Props) {
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const parsed = useMemo(() => {
    if (!rawText.trim()) return null;
    const raw = parseCsv(rawText);
    if (raw.length === 0) return { rows: [], errors: ["Empty CSV."] };
    const headers = mapHeaders(raw[0]);
    if (!headers.includes("phone")) {
      return {
        rows: [],
        errors: [
          'Missing required column "phone" (or one of: telefone, whatsapp, number, numero).',
        ],
      };
    }
    const rows: ParsedRow[] = [];
    const errors: string[] = [];
    for (let i = 1; i < raw.length; i++) {
      const cells = raw[i];
      const row: Partial<ParsedRow> = {};
      for (let c = 0; c < headers.length; c++) {
        const key = headers[c];
        const value = (cells[c] ?? "").trim();
        if (!key || !value) continue;
        if (key === "tags") {
          row.tags = value
            .split(/[,;|]/)
            .map((t) => t.trim())
            .filter(Boolean);
        } else {
          (row as Record<string, string>)[key] = value;
        }
      }
      if (!row.phone) {
        errors.push(`Row ${i + 1}: missing phone`);
        continue;
      }
      const normalized = normalizePhone(row.phone);
      if (!E164_REGEX.test(normalized)) {
        errors.push(
          `Row ${i + 1}: invalid phone "${row.phone}" — must be E.164 with country code, e.g. +5511999999999`,
        );
        continue;
      }
      row.phone = normalized;
      rows.push(row as ParsedRow);
    }
    return { rows, errors };
  }, [rawText]);

  async function handleFile(file: File) {
    const text = await file.text();
    setRawText(text);
    setFileName(file.name);
    setResult(null);
  }

  async function handleImport() {
    if (!parsed || parsed.rows.length === 0) return;
    setImporting(true);
    try {
      const r = await onImport(parsed.rows);
      setResult(r);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "data" in err
            ? JSON.stringify((err as { data: unknown }).data)
            : "Unknown error";
      setResult({
        created: 0,
        updated: 0,
        consentsRecorded: 0,
        skipped: [{ phone: "(server)", reason: msg }],
      });
    } finally {
      setImporting(false);
    }
  }

  const validRows = parsed?.rows.length ?? 0;
  const parseErrors = parsed?.errors ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
              Import contacts from CSV
            </h2>
            <p className="text-[12px] text-slate-500 mt-0.5">
              First row must be headers. Required: <code className="font-[var(--font-mono)] text-[11px] bg-slate-100 px-1 py-0.5 rounded">phone</code>.
              Optional: name, locale, tags, proofText, proofUrl.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors p-1"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!result && (
            <>
              <label className="block">
                <div className="border-2 border-dashed border-slate-200 rounded-xl px-6 py-8 text-center hover:border-slate-300 transition-colors cursor-pointer">
                  <Upload size={20} className="mx-auto text-slate-400 mb-2" />
                  <div className="text-[13px] font-medium text-[#0a1b33]">
                    {fileName ?? "Click to upload a CSV"}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    or paste below
                  </div>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                    }}
                    className="hidden"
                  />
                </div>
              </label>

              <textarea
                value={rawText}
                onChange={(e) => {
                  setRawText(e.target.value);
                  setFileName(null);
                }}
                placeholder={`phone,name,proofText\n+5511999999999,Maria,"Aceitou no formulário do site em 2026-05-10"\n+351912345678,João,`}
                className="w-full mt-4 h-40 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-[var(--font-mono)] resize-none focus:outline-none focus:ring-2 focus:ring-[#0a152d]/20 focus:border-[#0a152d]/40"
              />

              {parsed && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2 text-[12px]">
                    <Check size={14} className="text-emerald-600" />
                    <span className="text-slate-700">
                      <strong>{validRows}</strong> valid row{validRows === 1 ? "" : "s"} ready to import
                    </span>
                  </div>
                  {parseErrors.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="flex items-center gap-2 text-[12px] font-medium text-amber-800 mb-1.5">
                        <AlertCircle size={14} />
                        {parseErrors.length} parse issue{parseErrors.length === 1 ? "" : "s"}
                      </div>
                      <ul className="text-[11px] text-amber-700 space-y-0.5 max-h-32 overflow-y-auto font-[var(--font-mono)]">
                        {parseErrors.slice(0, 20).map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                        {parseErrors.length > 20 && (
                          <li className="text-amber-600">
                            … +{parseErrors.length - 20} more
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {result && (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 text-[13px] font-medium text-emerald-800 mb-1">
                  <Check size={16} />
                  Import complete
                </div>
                <div className="text-[12px] text-emerald-700 space-y-0.5">
                  <div>
                    <strong>{result.created}</strong> created ·{" "}
                    <strong>{result.updated}</strong> updated
                  </div>
                  {result.consentsRecorded > 0 && (
                    <div>
                      <strong>{result.consentsRecorded}</strong> marketing consent
                      proof{result.consentsRecorded === 1 ? "" : "s"} recorded
                    </div>
                  )}
                </div>
              </div>
              {result.skipped.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center gap-2 text-[12px] font-medium text-amber-800 mb-1.5">
                    <AlertCircle size={14} />
                    {result.skipped.length} skipped
                  </div>
                  <ul className="text-[11px] text-amber-700 space-y-0.5 max-h-32 overflow-y-auto font-[var(--font-mono)]">
                    {result.skipped.slice(0, 30).map((s, i) => (
                      <li key={i}>
                        {s.phone} — {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
          {!result ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="text-[13px] text-slate-500 hover:text-slate-700 px-3 py-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={validRows === 0 || importing}
                className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#0a1b33] transition-all"
              >
                {importing && <Loader2 size={14} className="animate-spin" />}
                Import {validRows} contact{validRows === 1 ? "" : "s"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#0a1b33] transition-all"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
