import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { startDeadlineChecker } from "./background/deadlines";
import { startSessionCleanup } from "./background/sessions";
import { logger } from "./logger";

const args = process.argv.slice(2);
const command = args[0] ?? "serve";

switch (command) {
  case "serve": {
    const port = Number(process.env.PORT ?? 4000);
    const dbPath = process.env.DATABASE_PATH ?? "./tarmak.db";

    const { app, db, broadcaster } = createApp(dbPath);

    // Start background jobs
    const deadlineTimer = startDeadlineChecker(db, broadcaster);
    const sessionTimer = startSessionCleanup(db);

    logger.info(`tarmak api listening on port ${port}`);
    serve({ fetch: app.fetch, port });

    // Graceful shutdown
    function shutdown() {
      clearInterval(deadlineTimer);
      clearInterval(sessionTimer);
      logger.info("Background jobs stopped");
      process.exit(0);
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    break;
  }

  case "mcp": {
    const { startMcpStdio } = await import("./mcp/stdio");
    await startMcpStdio();
    break;
  }

  case "backup": {
    const { runBackup } = await import("./cli/backup");
    await runBackup(args.slice(1));
    break;
  }

  case "restore": {
    const { runRestore } = await import("./cli/restore");
    await runRestore(args.slice(1));
    break;
  }

  case "export": {
    const { runExport } = await import("./cli/export");
    await runExport(args.slice(1));
    break;
  }

  case "import": {
    const { runImport } = await import("./cli/import");
    await runImport(args.slice(1));
    break;
  }

  case "users": {
    const { runUsers } = await import("./cli/users");
    await runUsers(args.slice(1));
    break;
  }

  default:
    console.log(`tarmak - Kanban board for AI-assisted development

Usage: tarmak <command> [options]

Commands:
  serve                              Start the HTTP server (default)
  mcp                                Start MCP stdio server
  backup <path>                      Backup database to file
  restore <path>                     Restore database from backup
  export [--output <path>]           Export all boards as JSON
  import <path>                      Import boards from JSON file
  users list                         List all users
  users reset-password <email> <pw>  Reset a user's password
`);
    process.exit(1);
}
