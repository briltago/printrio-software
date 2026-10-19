import { buildApp, defaultDriverFactories } from "./app.ts";
import { deleteExpiredSessions } from "./auth/sessions.ts";
import { loadConfig } from "./config.ts";
import { resolveAppSecret, SecretBox } from "./crypto.ts";
import { createDatabase, runMigrations } from "./db/client.ts";
import { PrinterManager } from "./printers/manager.ts";
import { connectStoredPrinters } from "./routes/printers.ts";

const config = loadConfig();
const { db, close } = createDatabase(config.DATABASE_URL);
await runMigrations(db);
const secrets = new SecretBox(await resolveAppSecret(config.APP_SECRET, config.DATA_DIR));

const manager = new PrinterManager(defaultDriverFactories());
const app = await buildApp({ config, db, secrets, manager });
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
