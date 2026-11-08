import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { loadDotEnv, resolveConfig, type ServerConfig } from "./config.js";

/** Boot entry (§17): env, migrations, listen on 0.0.0.0:PORT (default 8080). */

// .env from the current working directory (repo root or apps/server); existing
// process env always wins so the shell can override.
loadDotEnv(resolve(process.cwd(), ".env"));

function loadConfig(): ServerConfig {
  try {
    return resolveConfig();
  } catch (error) {
    // Configuration errors must be visible without leaking values.
    console.error(`configuration error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

void boot();

async function boot(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config });
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error) {
    app.log.error(`failed to listen: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const shutdown = (signal: string): void => {
    app.log.info({ signal }, "shutting down");
    // Drain deadline: a hung close (open sockets, stalled pool) must not keep
    // the process alive past the orchestrator's kill grace period anyway.
    const forceTimer = setTimeout(() => process.exit(1), 10_000);
    void app.close()
      .then(() => {
        clearTimeout(forceTimer);
        process.exit(0);
      })
      .catch((error) => {
        app.log.error(`close failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Keeps the import well-known for tooling that resolves the package entry.
export const ENTRY = fileURLToPath(import.meta.url);
