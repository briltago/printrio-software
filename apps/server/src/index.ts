import { buildApp, defaultDriverFactories } from "./app.ts";
import { deleteExpiredSessions } from "./auth/sessions.ts";
import { Backups, backupBeforeMigrations } from "./backups/backups.ts";
import { loadConfig } from "./config.ts";
import { resolveAppSecret, SecretBox } from "./crypto.ts";
import { createDatabase, pendingMigrations, runMigrations } from "./db/client.ts";
import { PrinterManager } from "./printers/manager.ts";
import { connectStoredPrinters } from "./routes/printers.ts";
import { VERSION } from "./version.ts";

const config = loadConfig();
const { db, close } = createDatabase(config.DATABASE_URL);
const startupLog = {
  info: (message: string) => console.log(message),
  warn: (message: string) => console.warn(message),
  error: (message: string) => console.error(message),
};
const backups = new Backups({
  db,
  databaseUrl: config.DATABASE_URL,
  dataDir: config.DATA_DIR,
  version: VERSION,
  log: startupLog,
});
// An update that changes the database: keep a copy of the old one first.
const preUpdate = await backupBeforeMigrations(backups, await pendingMigrations(db));
if (preUpdate instanceof Error)
  startupLog.warn(`No backup before the update: ${preUpdate.message}`);
await runMigrations(db);
const secrets = new SecretBox(await resolveAppSecret(config.APP_SECRET, config.DATA_DIR));

const factories = defaultDriverFactories();
const manager = new PrinterManager(factories);
const app = await buildApp({ config, db, secrets, manager, factories, backups });
await connectStoredPrinters(db, manager, secrets);

const cleanup = setInterval(
  () => deleteExpiredSessions(db).catch((error) => app.log.error(error)),
  60 * 60 * 1000,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    clearInterval(cleanup);
    await app.close();
    await close();
    process.exit(0);
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
app.log.info(`Printrio ${VERSION} ready`);
