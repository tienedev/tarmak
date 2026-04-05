import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { createApp } from "./app";
import { DocManager } from "./sync/doc-manager";
import { SyncServer } from "./sync/ws";
import type { SyncClient } from "./sync/ws";
import { startDeadlineChecker } from "./background/deadlines";
import { startSessionCleanup } from "./background/sessions";
import { logger } from "./logger";
import { resolveUser } from "./auth/resolve-user";
import { boardsRepo } from "@tarmak/db";

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
    const server = serve({ fetch: app.fetch, port });

    // WebSocket sync
    const docManager = new DocManager(db);
    const syncServer = new SyncServer(docManager);
    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url!, `http://localhost:${port}`);
      const match = url.pathname.match(/^\/ws\/(.+)$/);
      if (!match) {
        socket.destroy();
        return;
      }
      const boardId = match[1]!;

      // Authenticate WebSocket connection
      const token = url.searchParams.get("token");
      const authHeader = token
        ? `Bearer ${token}`
        : req.headers.authorization;
      const user = resolveUser(db, authHeader);
      if (!user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // Check board membership
      const role = boardsRepo.getMemberRole(db, boardId, user.id);
      if (!role) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const client: SyncClient = {
          boardId,
          send: (data) => ws.send(data),
        };
        syncServer.join(client);
        ws.on("message", (msg) => {
          try {
            const data = Buffer.isBuffer(msg) ? msg : Buffer.from(msg as ArrayBuffer);
            syncServer.handleMessage(client, new Uint8Array(data));
          } catch (err) {
            logger.warn({ err }, "WebSocket message error");
          }
        });
        ws.on("close", () => {
          try {
            syncServer.leave(client);
          } catch (err) {
            logger.warn({ err }, "WebSocket close error");
          }
        });
      });
    });

    // Graceful shutdown
    function shutdown() {
      clearInterval(deadlineTimer);
      clearInterval(sessionTimer);
      wss.close();
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
