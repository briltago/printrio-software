import { useSyncExternalStore } from "react";

export type ThemePreference = "system" | "dark" | "light";
const KEY = "printrio-theme";
const listeners = new Set<() => void>();

function read(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === "dark" || value === "light" ? value : "system";
  } catch {
    return "system";
  }
}

const media = () => window.matchMedia("(prefers-color-scheme: light)");

/** Applies the effective theme to <html data-theme>; CSS tokens switch on it. */
export function applyTheme(preference = read()) {
  const effective = preference === "system" ? (media().matches ? "light" : "dark") : preference;
  document.documentElement.dataset.theme = effective;
  document.documentElement.style.colorScheme = effective;
  // Status bar / browser chrome colour on phones follows the theme.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", effective === "light" ? "#eceef2" : "#111216");
}

export function setTheme(preference: ThemePreference) {
  try {
    localStorage.setItem(KEY, preference);
  } catch {}
  applyTheme(preference);
  for (const listener of listeners) listener();
}

export function initTheme() {
  applyTheme();
  media().addEventListener("change", () => applyTheme());
}

export function useTheme(): ThemePreference {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => "system",
  );
}

export function nextTheme(current: ThemePreference): ThemePreference {
  const effective = current === "system" ? document.documentElement.dataset.theme : current;
  return effective === "dark" ? "light" : "dark";
}
