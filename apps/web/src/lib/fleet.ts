import type { Printer, PrinterGroup, PrinterState } from "@printrio/shared";

/** Filter order: what is running, what needs someone, what is free, what is away. */
export const FLEET_STATES: PrinterState[] = [
  "printing",
  "error",
  "paused",
  "idle",
  "offline",
  "connecting",
];

export interface FleetFilter {
  search: string;
  /** A printer state, or "" for all. */
  state: string;
  groupId: string;
  tag: string;
}

export const NO_FILTER: FleetFilter = { search: "", state: "", groupId: "", tag: "" };

export const isFiltered = (filter: FleetFilter) =>
  Boolean(filter.search.trim() || filter.state || filter.groupId || filter.tag);

/**
 * Printers matching every active filter. Search looks at the name, the group,
 * tags and the file being printed, so "benchy" finds the printer printing it.
 */
export function filterPrinters(printers: Printer[], groups: PrinterGroup[], filter: FleetFilter) {
  const query = filter.search.trim().toLowerCase();
  const groupName = new Map(groups.map((group) => [group.id, group.name]));
  return printers.filter((printer) => {
    if (filter.state && printer.status.state !== filter.state) return false;
    if (filter.groupId && printer.groupId !== filter.groupId) return false;
    if (filter.tag && !printer.tags.includes(filter.tag)) return false;
    if (!query) return true;
    return [
      printer.name,
      printer.groupId ? groupName.get(printer.groupId) : null,
      ...printer.tags,
      printer.status.job?.fileName,
    ].some((value) => value?.toLowerCase().includes(query));
  });
}

/** How many printers are in each state (states a newer server adds are counted too). */
export function countStates(printers: Printer[]) {
  const counts = new Map<string, number>();
  for (const printer of printers)
    counts.set(printer.status.state, (counts.get(printer.status.state) ?? 0) + 1);
  return counts;
}

/**
 * States offered as filters: known states that occur, in FLEET_STATES order,
 * then unknown ones; the selected state stays even at 0, so a printer leaving
 * it does not make the active filter disappear.
 */
export function stateOptions(counts: Map<string, number>, selected: string) {
  const known: string[] = FLEET_STATES.filter((state) => counts.has(state) || state === selected);
  const unknown = [...counts.keys(), ...(selected ? [selected] : [])]
    .filter((state) => !(FLEET_STATES as string[]).includes(state))
    .filter((state, index, all) => all.indexOf(state) === index)
    .sort();
  return [...known, ...unknown].map((state) => ({ state, count: counts.get(state) ?? 0 }));
}

export const isKnownState = (state: string): state is PrinterState =>
  (FLEET_STATES as string[]).includes(state);
