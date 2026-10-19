/** Pure helpers for the G-code console (history, autocomplete, macro calls). */

export const MAX_HISTORY = 100;

/** Adds a sent command to the history (newest last), dropping an immediate repeat. */
export function pushHistory(history: string[], command: string): string[] {
  if (history.at(-1) === command) return history;
  return [...history, command].slice(-MAX_HISTORY);
}

/**
 * Moves through the history like a shell: `index` is null while editing a new
 * line, otherwise the position of the recalled entry.
 */
export function stepHistory(
  history: string[],
  index: number | null,
  direction: "up" | "down",
): { index: number | null; value: string | null } {
  if (history.length === 0) return { index, value: null };
  if (direction === "up") {
    const next = index === null ? history.length - 1 : Math.max(0, index - 1);
    return { index: next, value: history[next] ?? null };
  }
  if (index === null) return { index: null, value: null };
  const next = index + 1;
  return next >= history.length
    ? { index: null, value: "" }
    : { index: next, value: history[next] ?? null };
}

export interface CommandSuggestion {
  name: string;
  description: string | null;
}

/** Commands matching the word being typed (only while typing the command itself, not its parameters). */
export function suggestCommands(
  input: string,
  commands: CommandSuggestion[],
  limit = 8,
): CommandSuggestion[] {
  const word = input.trimStart();
  if (!word || /\s/.test(word)) return [];
  const query = word.toUpperCase();
  const starts = commands.filter((c) => c.name.toUpperCase().startsWith(query));
  const contains = commands.filter(
    (c) => !c.name.toUpperCase().startsWith(query) && c.name.toUpperCase().includes(query),
  );
  return [...starts, ...contains].filter((c) => c.name.toUpperCase() !== query).slice(0, limit);
}

/** `NAME KEY=value …` for the filled-in parameters; empty values fall back to the macro default. */
export function macroCall(name: string, values: Record<string, string>): string {
  const args = Object.entries(values)
    .map(([key, value]) => [key, value.trim()] as const)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}=${/\s/.test(value) ? `"${value}"` : value}`);
  return [name, ...args].join(" ");
}

/** Visual tone of a console line, following Klipper's conventions ("!!" errors, "//" info). */
export function lineTone(message: string): "error" | "info" | "plain" {
  if (message.startsWith("!!")) return "error";
  if (message.startsWith("//")) return "info";
  return "plain";
}
