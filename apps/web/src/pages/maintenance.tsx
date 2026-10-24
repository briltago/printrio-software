import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { EmptyState, PageHeader, StateBadge } from "../components.tsx";
import { BedMeshPanel } from "../features/bed-mesh-panel.tsx";
import { ConfigEditor } from "../features/config-editor.tsx";
import { LogsViewer } from "../features/logs-viewer.tsx";
import { SystemPanel } from "../features/system-panel.tsx";
import { UpdatesPanel } from "../features/updates-panel.tsx";
import { useT } from "../i18n/index.tsx";
import { printersQuery } from "../lib/queries.ts";
import { meQuery } from "../lib/session.ts";

export const MAINTENANCE_TABS = ["mesh", "config", "logs", "updates", "system"] as const;
export type MaintenanceTab = (typeof MAINTENANCE_TABS)[number];
const ADMIN_TABS = new Set<MaintenanceTab>(["config", "logs", "updates", "system"]);

/** Printer administration (stage B): everything Mainsail/Fluidd offer beyond daily operation. */
export function MaintenancePage() {
  const t = useT();
  const { printerId } = useParams({ from: "/app/printers/$printerId/maintenance" });
  const { tab } = useSearch({ from: "/app/printers/$printerId/maintenance" });
  const { data } = useSuspenseQuery(printersQuery);
  const { data: me } = useSuspenseQuery(meQuery);
  const printer = data.printers.find((p) => p.id === printerId);
  const isAdmin = me?.role === "admin";
  const tabs = MAINTENANCE_TABS.filter((id) => isAdmin || !ADMIN_TABS.has(id));
  const active = tab && tabs.includes(tab) ? tab : tabs[0];

  if (!printer || !active) {
    return (
      <main className="page">
        <EmptyState
          title={printer ? t("maintenance.adminOnly") : t("printer.notFound")}
          text={printer ? t("maintenance.adminOnlyText") : t("printer.notFoundText")}
          action={
            <Link to="/printers" className="btn btn-secondary">
              {t("printer.allPrinters")}
            </Link>
          }
        />
      </main>
    );
  }

  const connected = printer.status.state !== "offline" && printer.status.state !== "connecting";
  const busy = printer.status.state === "printing" || printer.status.state === "paused";

  return (
    <main className="page">
      <PageHeader
        crumbs={
          <>
            <Link to="/printers" className="hover:text-text hover:underline">
              {t("nav.printers")}
            </Link>
            <span aria-hidden="true" className="text-subtle">
              /
            </span>
            <Link
              to="/printers/$printerId"
              params={{ printerId }}
              className="truncate hover:text-text hover:underline"
            >
              {printer.name}
            </Link>
          </>
        }
        title={t("maintenance.kicker")}
        subtitle={
          <>
            <span className="font-medium text-text">{printer.name}</span>
            <StateBadge state={printer.status.state} />
          </>
        }
      />
      <nav className="tabs mt-5" aria-label={t("maintenance.kicker")}>
        {tabs.map((id) => (
          <Link
            key={id}
            to="/printers/$printerId/maintenance"
            params={{ printerId }}
            search={{ tab: id }}
            className="tab"
            aria-current={active === id ? "page" : undefined}
          >
            {t(`maintenance.tabs.${id}`)}
          </Link>
        ))}
      </nav>
      <div className="mt-6">
        {!connected ? (
          <EmptyState title={t("maintenance.offline")} text={t("maintenance.offlineText")} />
        ) : (
          <>
            {active === "mesh" && (
              <BedMeshPanel printerId={printerId} busy={busy} isAdmin={isAdmin} />
            )}
            {active === "config" && <ConfigEditor printerId={printerId} busy={busy} />}
            {active === "logs" && <LogsViewer printerId={printerId} />}
            {active === "updates" && <UpdatesPanel printerId={printerId} busy={busy} />}
            {active === "system" && <SystemPanel printerId={printerId} busy={busy} />}
          </>
        )}
      </div>
    </main>
  );
}
