"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const subscribe = () => () => {};

const options = [
  { value: "light", icon: Sun, labelKey: "themeLight" },
  { value: "dark", icon: Moon, labelKey: "themeDark" },
  { value: "system", icon: Monitor, labelKey: "themeSystem" },
] as const;

export function ThemeToggle() {
  const t = useTranslations("Header");
  const { theme, setTheme } = useTheme();
  // The stored theme is unknown on the server; avoid hydration mismatches.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  return (
    <div role="group" aria-label={t("theme")} className="flex items-center gap-1">
      {options.map(({ value, icon: Icon, labelKey }) => (
        <Button
          key={value}
          type="button"
          variant={mounted && theme === value ? "default" : "ghost"}
          size="icon"
          aria-label={t(labelKey)}
          aria-pressed={mounted && theme === value}
          onClick={() => setTheme(value)}
        >
          <Icon aria-hidden="true" />
        </Button>
      ))}
    </div>
  );
}
