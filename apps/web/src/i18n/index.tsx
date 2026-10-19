import { createContext, type ReactNode, useContext } from "react";
import { en, type Messages } from "./en.ts";

/**
 * Minimal i18n: typed dot-path keys into a messages object with {param}
 * interpolation. Only English ships today; add a locale by adding a file
 * shaped like `Messages` and registering it in LOCALES.
 */

type DeepString<T> = { [K in keyof T]: T[K] extends string ? string : DeepString<T[K]> };
type Paths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Paths<Messages>;
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

const LOCALES: Record<string, DeepString<Messages>> = { en };
const DEFAULT_LOCALE = "en";

function lookup(messages: DeepString<Messages>, key: string): string {
  const value = key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], messages);
  return typeof value === "string" ? value : key;
}

export function createTranslator(locale = DEFAULT_LOCALE): Translate {
  const messages = LOCALES[locale] ?? en;
  return (key, params) =>
    lookup(messages, key).replace(/\{(\w+)\}/g, (match, name: string) =>
      params && name in params ? String(params[name]) : match,
    );
}

const I18nContext = createContext<Translate>(createTranslator());

export function I18nProvider({
  locale = DEFAULT_LOCALE,
  children,
}: {
  locale?: string;
  children: ReactNode;
}) {
  return <I18nContext.Provider value={createTranslator(locale)}>{children}</I18nContext.Provider>;
}

export const useT = () => useContext(I18nContext);
