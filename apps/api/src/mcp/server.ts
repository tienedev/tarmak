import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DB } from "@tarmak/db";
import { registerBoardQueryTool } from "./tools/board-query";
import { registerBoardMutateTool } from "./tools/board-mutate";
import { registerBoardSyncTool } from "./tools/board-sync";
import { registerBoardAskTool } from "./tools/board-ask";

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
