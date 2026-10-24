/** 24×24 stroke icons (lucide-style, 1.8px) used by the navigation, settings and toolbars. */
const PATHS = {
  printers: ["M6 3h12v6H6z", "M3 9h18v9H3z", "M7 18v3h10v-3", "M7 13h4"],
  jobs: ["M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  library: ["M4 4h6l2 2h8v13H4z", "M4 10h16"],
  filament: [
    "M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18z",
    "M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6z",
    "M12 3v3",
    "M21 12h-3",
  ],
  costs: ["M4 20V10", "M10 20V4", "M16 20v-7", "M22 20H2"],
  orders: ["M6 3h12l2 4v14H4V7z", "M4 7h16", "M9 11h6"],
  settings: [
    "M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6z",
    "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  ],
  queue: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  production: ["M3 21h18", "M5 21V9l5 3V9l5 3V5h4v16"],
  customers: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8z",
    "M22 21v-2a4 4 0 0 0-3-3.87",
    "M16 3.13a4 4 0 0 1 0 7.75",
  ],
  stats: ["M3 3v18h18", "m7 14 4-4 3 3 5-6"],
  pipeline: ["M4 4h4v16H4z", "M10 4h4v10h-4z", "M16 4h4v6h-4z"],
  crm: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", "M8 9h8", "M8 13h5"],
  quotes: ["M14 3H6v18h12V7z", "M14 3v4h4", "M9 13h6", "M9 17h4"],
  file: ["M14 3H6v18h12V7z", "M14 3v4h4"],
  invoices: ["M6 3h12v18l-3-2-3 2-3-2-3 2z", "M9 8h6", "M9 12h6", "M9 16h3"],
  stock: ["M21 8 12 3 3 8v8l9 5 9-5z", "m3 8 9 5 9-5", "M12 13v8"],
  sites: [
    "M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z",
    "M12 12a2 2 0 1 0 0-4a2 2 0 0 0 0 4z",
  ],
  module: [
    "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
    "M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z",
  ],
  search: ["M11 18a7 7 0 1 0 0-14a7 7 0 0 0 0 14z", "m20 20-3.5-3.5"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  chevron: ["m9 6 6 6-6 6"],
  signOut: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9"],
  upload: ["M12 15V3", "m7 8 5-5 5 5", "M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"],
  // Settings tabs
  general: [
    "M4 21v-7",
    "M4 10V3",
    "M12 21v-9",
    "M12 8V3",
    "M20 21v-5",
    "M20 12V3",
    "M1 14h6",
    "M9 8h6",
    "M17 16h6",
  ],
  appearance: ["M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z", "M12 3v18", "M12 3a9 9 0 0 1 0 18"],
  sidebar: ["M3 4h18v16H3z", "M9 4v16"],
  groups: ["M12 2 2 7l10 5 10-5-10-5z", "m2 17 10 5 10-5", "m2 12 10 5 10-5"],
  slicer: ["M12 15V3", "m7 8 5-5 5 5", "M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"],
  users: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8z",
    "M22 21v-2a4 4 0 0 0-3-3.87",
    "M16 3.13a4 4 0 0 1 0 7.75",
  ],
  sso: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "m9 12 2 2 4-4"],
  backups: ["M3 5h18v4H3z", "M5 9v10h14V9", "M10 13h4"],
  licence: [
    "M7.5 15.5a4.5 4.5 0 1 0 0-9a4.5 4.5 0 0 0 0 9z",
    "M10.7 9.3 21 2",
    "m18 5 3 3",
    "m15 8 2.5 2.5",
  ],
  bell: ["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0"],
  plug: ["M12 22v-5", "M9 8V2", "M15 8V2", "M18 8v5a6 6 0 0 1-12 0V8z"],
  roles: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "M12 8v4", "M12 16h.01"],
  money: ["M12 2v20", "M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"],
  cart: ["M6 6h15l-1.5 9h-12z", "M6 6 5 3H2", "M9 20h.01", "M18 20h.01"],
} as const;

export type IconName = keyof typeof PATHS;

export const isIconName = (value: string): value is IconName => Object.hasOwn(PATHS, value);

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** A navigation icon: a drawn icon by name, or a module's own text glyph. */
export function NavIcon({ icon, size = 16 }: { icon: string; size?: number }) {
  if (isIconName(icon)) return <Icon name={icon} size={size} />;
  return (
    <span aria-hidden="true" className="inline-grid w-4 shrink-0 place-items-center text-[13px]">
      {icon}
    </span>
  );
}
