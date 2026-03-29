import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDb, migrateDb } from "@tarmak/db";
import { createMcpServer } from "./server";

export async function startMcpStdio(): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? "./tarmak.db";
  const db = createDb(dbPath);
  migrateDb(db);

  const mcpServer = createMcpServer(db);
  const transport = new StdioServerTransport();

  await mcpServer.connect(transport);
}
