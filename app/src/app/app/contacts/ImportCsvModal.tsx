"use client";

import { useMemo, useState } from "react";
import { Upload, X, Check, AlertCircle, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

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
  const { locale, tr } = useI18n();
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const parsed = useMemo(() => {
    if (!rawText.trim()) return null;
    const raw = parseCsv(rawText);
    if (raw.length === 0) {
      return {
        rows: [],
        errors: [locale === "pt" ? "O ficheiro CSV está vazio." : "The CSV file is empty."],
      };
    }
    const headers = mapHeaders(raw[0]);
    if (!headers.includes("phone")) {
      return {
        rows: [],
        errors: [
          locale === "pt"
            ? 'Falta a coluna obrigatória "phone" (também aceitamos: telefone, whatsapp, number, numero).'
            : 'Missing required column "phone" (accepted aliases: telefone, whatsapp, number, numero).',
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
        errors.push(
          locale === "pt"
            ? `Linha ${i + 1}: telefone em falta`
            : `Row ${i + 1}: missing phone`,
        );
        continue;
      }
      const normalized = normalizePhone(row.phone);
      if (!E164_REGEX.test(normalized)) {
        errors.push(
          locale === "pt"
            ? `Linha ${i + 1}: telefone inválido "${row.phone}". Use o formato internacional com indicativo, por exemplo +258841234567`
            : `Row ${i + 1}: invalid phone "${row.phone}". Use international format with country code, for example +258841234567`,
        );
        continue;
      }
      row.phone = normalized;
      rows.push(row as ParsedRow);
    }
    return { rows, errors };
  }, [locale, rawText]);

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
            : tr("Erro desconhecido", "Unknown error");
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
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-lg border border-line bg-surface shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line-soft">
          <div>
            <h2 className="font-[var(--font-outfit)] text-[18px] font-medium text-ink">
              {tr("Importar contactos por CSV", "Import contacts from CSV")}
            </h2>
            <p className="text-[12px] text-muted mt-0.5">
              {tr("A primeira linha deve conter os cabeçalhos. Obrigatório:", "The first row must contain headers. Required:")} <code className="rounded bg-surface-3 px-1 py-0.5 font-[var(--font-mono)] text-[11px]">phone</code>.
              {" "}{tr("Opcionais: name, locale, tags, proofText e proofUrl.", "Optional: name, locale, tags, proofText and proofUrl.")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-faint hover:text-body transition-colors p-1"
            aria-label={tr("Fechar", "Close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!result && (
            <>
              <label className="block">
                <div className="border-2 border-dashed border-line rounded-xl px-6 py-8 text-center hover:border-line transition-colors cursor-pointer">
                  <Upload size={20} className="mx-auto text-faint mb-2" />
                  <div className="text-[13px] font-medium text-ink">
                    {fileName ?? tr("Clique para carregar um CSV", "Click to upload a CSV")}
                  </div>
                  <div className="text-[11px] text-muted mt-1">
                    {tr("ou cole os dados abaixo", "or paste the data below")}
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
                className="w-full mt-4 h-40 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] font-[var(--font-mono)] resize-none focus:outline-none focus:ring-2 focus:ring-[#0a152d]/20 focus:border-[#0a152d]/40"
              />

              {parsed && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2 text-[12px]">
                    <Check size={14} className="text-emerald-600" />
                    <span className="text-ink">
                      <strong>{validRows}</strong>{" "}
                      {locale === "pt"
                        ? validRows === 1
                          ? "linha válida pronta para importar"
                          : "linhas válidas prontas para importar"
                        : validRows === 1
                          ? "valid row ready to import"
                          : "valid rows ready to import"}
                    </span>
                  </div>
                  {parseErrors.length > 0 && (
                    <div className="rounded-lg border border-chip-warn-fg/25 bg-chip-warn p-3">
                      <div className="flex items-center gap-2 text-[12px] font-medium text-chip-warn-fg mb-1.5">
                        <AlertCircle size={14} />
                        {parseErrors.length}{" "}
                        {locale === "pt"
                          ? parseErrors.length === 1
                            ? "problema encontrado"
                            : "problemas encontrados"
                          : parseErrors.length === 1
                            ? "parse issue"
                            : "parse issues"}
                      </div>
                      <ul className="text-[11px] text-chip-warn-fg space-y-0.5 max-h-32 overflow-y-auto font-[var(--font-mono)]">
                        {parseErrors.slice(0, 20).map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                        {parseErrors.length > 20 && (
                          <li className="text-amber-600">
                            ... +{parseErrors.length - 20} {tr("restantes", "more")}
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
              <div className="rounded-lg border border-chip-success-fg/25 bg-chip-success p-4">
                <div className="flex items-center gap-2 text-[13px] font-medium text-chip-success-fg mb-1">
                  <Check size={16} />
                  {tr("Importação concluída", "Import complete")}
                </div>
                <div className="text-[12px] text-chip-success-fg space-y-0.5">
                  <div>
                    <strong>{result.created}</strong> {tr("criados", "created")} ·{" "}
                    <strong>{result.updated}</strong> {tr("atualizados", "updated")}
                  </div>
                  {result.consentsRecorded > 0 && (
                    <div>
                      <strong>{result.consentsRecorded}</strong>{" "}
                      {locale === "pt"
                        ? result.consentsRecorded === 1
                          ? "prova de consentimento de marketing registada"
                          : "provas de consentimento de marketing registadas"
                        : result.consentsRecorded === 1
                          ? "marketing consent proof recorded"
                          : "marketing consent proofs recorded"}
                    </div>
                  )}
                </div>
              </div>
              {result.skipped.length > 0 && (
                <div className="rounded-lg border border-chip-warn-fg/25 bg-chip-warn p-3">
                  <div className="flex items-center gap-2 text-[12px] font-medium text-chip-warn-fg mb-1.5">
                    <AlertCircle size={14} />
                    {result.skipped.length}{" "}
                    {locale === "pt"
                      ? result.skipped.length === 1
                        ? "contacto ignorado"
                        : "contactos ignorados"
                      : "skipped"}
                  </div>
                  <ul className="text-[11px] text-chip-warn-fg space-y-0.5 max-h-32 overflow-y-auto font-[var(--font-mono)]">
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

        <div className="px-6 py-4 border-t border-line-soft flex items-center justify-end gap-2">
          {!result ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="text-[13px] text-muted hover:text-ink px-3 py-2"
              >
                {tr("Cancelar", "Cancel")}
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={validRows === 0 || importing}
                className="inline-flex items-center gap-2 bg-nav-active text-white text-[13px] font-medium px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-solid transition-all"
              >
                {importing && <Loader2 size={14} className="animate-spin" />}
                {tr("Importar", "Import")} {validRows}{" "}
                {locale === "pt"
                  ? validRows === 1
                    ? "contacto"
                    : "contactos"
                  : validRows === 1
                    ? "contact"
                    : "contacts"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 bg-nav-active text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-brand-solid transition-all"
            >
              {tr("Concluir", "Done")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
