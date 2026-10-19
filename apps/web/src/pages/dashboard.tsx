const STATS = [
  { label: "Printers ready", value: "0", unit: "/0", foot: "Fleet status" },
  { label: "Active prints", value: "0", unit: "", foot: "Across 0 printers" },
  { label: "Filament inventory", value: "—", unit: "", foot: "No spools yet" },
  { label: "Print time", value: "—", unit: "", foot: "This week" },
];

export function DashboardPage() {
  return (
    <main className="mx-auto max-w-6xl p-6 md:p-8">
      <p className="kicker">Workspace</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Operations overview</h1>

      <section aria-label="Statistics" className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {STATS.map((stat) => (
          <div key={stat.label} className="card p-4">
            <p className="text-xs text-subtle">{stat.label}</p>
            <p className="mt-1 text-3xl font-semibold tracking-[-0.06em]">
              {stat.value}
              <span className="ml-1 text-sm font-normal tracking-normal text-subtle">
                {stat.unit}
              </span>
            </p>
            <p className="mt-1 text-xs text-subtle">{stat.foot}</p>
          </div>
        ))}
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="card p-5">
          <h2 className="border-line border-b pb-3 text-sm font-semibold">Printers</h2>
          <div className="py-10 text-center">
            <p className="font-medium">No printers connected yet</p>
            <p className="mt-1 text-sm text-muted">
              Klipper printers connect through Moonraker. Adding printers arrives with the Moonraker
              driver.
            </p>
          </div>
        </div>
        <div className="card p-5">
          <h2 className="border-line border-b pb-3 text-sm font-semibold">Filament inventory</h2>
          <div className="py-10 text-center">
            <p className="font-medium">No spools yet</p>
            <p className="mt-1 text-sm text-muted">Track every spool and its remaining weight.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
