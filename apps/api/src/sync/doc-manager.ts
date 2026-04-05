import type { DB } from "@tarmak/db";
import { crdtRepo } from "@tarmak/db";
import * as Y from "yjs";

export class DocManager {
  private docs = new Map<string, Y.Doc>();

  constructor(private db: DB) {}

  getOrCreate(boardId: string): Y.Doc {
    let doc = this.docs.get(boardId);
    if (doc) return doc;
    doc = new Y.Doc();
    this.docs.set(boardId, doc);
    return doc;
  }

  initFromDb(boardId: string): Y.Doc {
    const doc = this.getOrCreate(boardId);
    const state = crdtRepo.loadState(this.db, boardId);
    if (state) {
      Y.applyUpdate(doc, state);
    }
    return doc;
  }

  encodeFullState(boardId: string): Uint8Array {
    const doc = this.getOrCreate(boardId);
    return Y.encodeStateAsUpdate(doc);
  }

  persist(boardId: string): void {
    const doc = this.docs.get(boardId);
    if (!doc) return;
    const state = Y.encodeStateAsUpdate(doc);
    try {
      crdtRepo.saveState(this.db, boardId, state);
    } catch {
      // Board may have been deleted before the persist timer fired — ignore
    }
  }

  remove(boardId: string): void {
    const doc = this.docs.get(boardId);
    if (doc) {
      doc.destroy();
      this.docs.delete(boardId);
    }
  }
}
