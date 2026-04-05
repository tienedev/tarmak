import type { DB } from "@tarmak/db";
import { boardsRepo, columnsRepo } from "@tarmak/db";

export class BoardService {
  constructor(private db: DB) {}

  createBoard(name: string, description?: string) {
    return boardsRepo.createBoard(this.db, name, description);
  }

  getBoard(id: string) {
    return boardsRepo.getBoard(this.db, id);
  }

  listBoards() {
    return boardsRepo.listBoards(this.db);
  }

  getBoardWithColumns(id: string) {
    const board = boardsRepo.getBoard(this.db, id);
    if (!board) return null;
    const cols = columnsRepo.listColumns(this.db, id);
    return { ...board, columns: cols };
  }
}
