import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DB } from "@tarmak/db";
import { registerBoardAskTool } from "./tools/board-ask";
import { registerBoardMutateTool } from "./tools/board-mutate";
import { registerBoardQueryTool } from "./tools/board-query";
import { registerBoardSyncTool } from "./tools/board-sync";

export function createMcpServer(db: DB): McpServer {
  const server = new McpServer({
    name: "tarmak",
    version: "0.1.0",
  });

  registerBoardQueryTool(server, db);
  registerBoardMutateTool(server, db);
  registerBoardSyncTool(server, db);
  registerBoardAskTool(server, db);

  return server;
}
