"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

type Binding = { keys: string; pt: string; en: string };

const BINDINGS: Binding[] = [
  { keys: "j", pt: "Conversa seguinte", en: "Next conversation" },
  { keys: "k", pt: "Conversa anterior", en: "Previous conversation" },
  { keys: "r", pt: "Focar a resposta", en: "Focus the reply" },
  { keys: "Enter", pt: "Enviar a mensagem", en: "Send the message" },
  { keys: "Shift + Enter", pt: "Quebrar linha sem enviar", en: "New line without sending" },
  { keys: "Esc", pt: "Sair do composer", en: "Leave the composer" },
  { keys: "?", pt: "Mostrar atalhos", en: "Show shortcuts" },
];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true;
}

/**
 * Keyboard navigation for the inbox. Moving between conversations is a link
 * click, not a second selection state: the URL is already the selection, so
 * j/k drive the rendered list instead of a parallel index that could disagree
 * with it.
 */
export function InboxShortcuts() {
  const { tr } = useI18n();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    function move(delta: number) {
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>("[data-thread-link]"),
      );
      if (links.length === 0) return;
      const current = links.findIndex((link) => link.getAttribute("aria-current") === "true");
      const next = current === -1 ? (delta > 0 ? 0 : links.length - 1) : current + delta;
      const target = links[Math.min(Math.max(next, 0), links.length - 1)];
      target?.scrollIntoView({ block: "nearest" });
      target?.click();
    }
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) {
        if (event.key === "Escape") (event.target as HTMLElement).blur();
        return;
      }
      if (event.key === "j") {
        event.preventDefault();
        move(1);
      } else if (event.key === "k") {
        event.preventDefault();
        move(-1);
      } else if (event.key === "r") {
        const composer = document.querySelector<HTMLTextAreaElement>("[data-composer-input]");
        if (composer) {
          event.preventDefault();
          composer.focus();
        }
      } else if (event.key === "?") {
        event.preventDefault();
        setHelpOpen((open) => !open);
      } else if (event.key === "Escape") {
        setHelpOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!helpOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a1b33]/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={() => setHelpOpen(false)}
    >
      <div className="w-full max-w-sm rounded-xl bg-surface p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 font-[var(--font-outfit)] text-[15px] font-medium text-ink">
          {tr("Atalhos do inbox", "Inbox shortcuts")}
        </h2>
        <ul className="space-y-1">
          {BINDINGS.map((binding) => (
            <li key={binding.keys} className="flex items-center justify-between gap-3 text-[12px]">
              <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink">
                {binding.keys}
              </kbd>
              <span className="text-body">{tr(binding.pt, binding.en)}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setHelpOpen(false)}
          className="mt-3 h-8 w-full rounded-md border border-line text-[12px] font-semibold text-body"
        >
          {tr("Fechar", "Close")}
        </button>
      </div>
    </div>
  );
}
