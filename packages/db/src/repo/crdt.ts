import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { DB } from "../connection";
import { boardCrdtState } from "../schema/index";

export function loadState(db: DB, boardId: string): Buffer | null {
  const row = db
    .select({ state: boardCrdtState.state })
    .from(boardCrdtState)
    .where(eq(boardCrdtState.board_id, boardId))
    .get();
  return row?.state ?? null;
}

export function saveState(db: DB, boardId: string, state: Buffer): void {
  const now = new Date().toISOString();
  db.run(
    sql`INSERT OR REPLACE INTO board_crdt_state (board_id, state, updated_at) VALUES (${boardId}, ${state}, ${now})`,
  );
}
