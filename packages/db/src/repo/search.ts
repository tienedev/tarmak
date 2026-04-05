import { sql } from "drizzle-orm";
import type { SearchResult } from "@tarmak/shared";
import type { DB } from "../connection";

export function search(
  db: DB,
  boardId: string,
  query: string,
  options?: { includeArchived?: boolean },
): SearchResult[] {
  const includeArchived = options?.includeArchived ?? false;

  if (includeArchived) {
    const rows = db.all<{
      entity_type: string;
      entity_id: string;
      board_id: string;
      task_id: string | null;
      snippet: string;
      rank: number;
      archived: number;
    }>(
      sql`SELECT entity_type, entity_id, board_id, task_id, snippet(search_index, 4, '<b>', '</b>', '...', 32) as snippet, rank, COALESCE((SELECT archived FROM tasks WHERE id = search_index.task_id), 0) as archived FROM search_index WHERE search_index MATCH ${query} AND board_id = ${boardId} ORDER BY rank LIMIT 50`,
    );
    return rows.map((r) => ({ ...r, archived: Boolean(r.archived) }));
  }

  // Filter out archived tasks via sub-select
  const rows = db.all<{
    entity_type: string;
    entity_id: string;
    board_id: string;
    task_id: string | null;
    snippet: string;
    rank: number;
    archived: number;
  }>(
    sql`SELECT entity_type, entity_id, board_id, task_id, snippet(search_index, 4, '<b>', '</b>', '...', 32) as snippet, rank, 0 as archived FROM search_index WHERE search_index MATCH ${query} AND board_id = ${boardId} AND (task_id IS NULL OR task_id NOT IN (SELECT id FROM tasks WHERE archived = 1)) ORDER BY rank LIMIT 50`,
  );
  return rows.map((r) => ({ ...r, archived: Boolean(r.archived) }));
}
