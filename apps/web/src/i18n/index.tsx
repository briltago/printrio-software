import { createContext, type ReactNode, useContext } from "react";
import { cs } from "./cs.ts";
import { de } from "./de.ts";
import { en, type Messages, type Translation } from "./en.ts";

/**
 * Minimal i18n: typed dot-path keys into a messages object with {param}
 * interpolation and plurals written as {count|one|few|other} (forms by
 * Intl.PluralRules: English and German use one|other, Czech one|few|other).
 */

type Paths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Paths<Messages>;
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export const LOCALES = { en, cs, de } satisfies Record<string, Translation>;
export type Locale = keyof typeof LOCALES;
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", cs: "Čeština", de: "Deutsch" };
const DEFAULT_LOCALE: Locale = "en";
const STORAGE_KEY = "printrio-locale";

const isLocale = (value: unknown): value is Locale => typeof value === "string" && value in LOCALES;

/** The language chosen in this browser, if any ("system" otherwise). */
export function storedLocale(): Locale | "system" {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : "system";
  } catch {
    return "system";
  }
}

/** Chosen language, else the browser's first supported language, else English. */
export function detectLocale(): Locale {
  const stored = storedLocale();
  return stored === "system" ? detectLocaleIgnoringChoice() : stored;
}

/** The browser's first supported language (what "Automatic" means). */
export function detectLocaleIgnoringChoice(): Locale {
  const languages =
    typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]);
  for (const language of languages) {
    const base = language?.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** Saves the choice and reloads, so every page and module renders in it. */
export function setLocale(locale: Locale | "system") {
  try {
    if (locale === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, locale);
  } catch {}
  window.location.reload();
}

let current: Locale = DEFAULT_LOCALE;
/** Language of the running app, for formatting outside React (dates, numbers). */
export const currentLocale = () => current;

function lookup(messages: Translation, key: string): string {
  const value = key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], messages);
  return typeof value === "string" ? value : key;
}

const PLURAL_ORDER = ["one", "few", "many", "other"] as const;

export function createTranslator(locale: string = DEFAULT_LOCALE): Translate {
  const known = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const messages = LOCALES[known];
  const plural = new Intl.PluralRules(known);
  return (key, params) =>
    lookup(messages, key)
      .replace(/\{(\w+)\|([^}]*)\}/g, (match, name: string, forms: string) => {
        if (!params || !(name in params)) return match;
        const options = forms.split("|");
        const category = plural.select(Number(params[name]));
        // Forms are listed in PLURAL_ORDER, skipping categories the language does not use.
        const categories: string[] = plural.resolvedOptions().pluralCategories;
        const used: string[] = PLURAL_ORDER.filter((c) => categories.includes(c));
        const index = Math.min(used.indexOf(category), options.length - 1);
        return options[index < 0 ? options.length - 1 : index] ?? match;
      })
      .replace(/\{(\w+)\}/g, (match, name: string) =>
        params && name in params ? String(params[name]) : match,
      );
}

const I18nContext = createContext<Translate>(createTranslator());

export function I18nProvider({
  locale = detectLocale(),
  children,
}: {
  locale?: Locale;
  children: ReactNode;
}) {
  current = locale;
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  return <I18nContext.Provider value={createTranslator(locale)}>{children}</I18nContext.Provider>;
}

export const useT = () => useContext(I18nContext);
