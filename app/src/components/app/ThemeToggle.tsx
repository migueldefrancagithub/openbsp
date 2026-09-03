"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "openbsp-theme";

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // A browser with storage blocked still gets the theme for this session.
  }
}

/**
 * Light, dark, or whatever the machine says. "System" is the default because a
 * clinic laptop set to dark at night should not be argued with.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { tr } = useI18n();
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "dark" || stored === "light") setTheme(stored);
    } catch {
      /* ignore */
    }
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    apply(next);
  }

  const options: Array<{ key: Theme; Icon: typeof Sun; label: string }> = [
    { key: "light", Icon: Sun, label: tr("Claro", "Light") },
    { key: "dark", Icon: Moon, label: tr("Escuro", "Dark") },
    { key: "system", Icon: Monitor, label: tr("Sistema", "System") },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={tr("Tema", "Theme")}
      className={cn("inline-flex rounded-lg border border-line bg-surface-2 p-0.5", compact && "scale-95")}
    >
      {options.map(({ key, Icon, label }) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={theme === key}
          title={label}
          onClick={() => choose(key)}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
            theme === key ? "bg-surface text-ink shadow-[var(--shadow-card)]" : "text-faint hover:text-ink",
          )}
        >
          <Icon size={13} />
        </button>
      ))}
    </div>
  );
}
