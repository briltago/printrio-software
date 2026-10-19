import { buildApp } from "./app.ts";
import { deleteExpiredSessions } from "./auth/sessions.ts";
import { loadConfig } from "./config.ts";
import { createDatabase, runMigrations } from "./db/client.ts";

const config = loadConfig();
const { db, close } = createDatabase(config.DATABASE_URL);
await runMigrations(db);

const app = await buildApp({ config, db });

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
