import * as Y from "yjs";
import type { DocManager } from "./doc-manager";

export interface SyncClient {
  boardId: string;
  send(data: Uint8Array): void;
}

export class SyncServer {
  private rooms = new Map<string, Set<SyncClient>>();
  private persistTimers = new Map<string, NodeJS.Timeout>();

  constructor(private docManager: DocManager) {}

  join(client: SyncClient): void {
    const { boardId } = client;
    if (!this.rooms.has(boardId)) {
      this.rooms.set(boardId, new Set());
      this.docManager.initFromDb(boardId);
    }
    this.rooms.get(boardId)?.add(client);

    // Send full state as sync step 1
    const state = this.docManager.encodeFullState(boardId);
    client.send(state);
  }

  handleMessage(client: SyncClient, data: Uint8Array): void {
    const { boardId } = client;
    const doc = this.docManager.getOrCreate(boardId);
    Y.applyUpdate(doc, data);

    // Broadcast to other clients in same board
    const room = this.rooms.get(boardId);
    if (room) {
      for (const peer of room) {
        if (peer !== client) {
          peer.send(data);
        }
      }
    }

    // Debounced persistence
    this.schedulePersist(boardId);
  }

  leave(client: SyncClient): void {
    const { boardId } = client;
    const room = this.rooms.get(boardId);
    if (!room) return;
    room.delete(client);

    if (room.size === 0) {
      this.rooms.delete(boardId);
      this.docManager.persist(boardId);
      this.docManager.remove(boardId);
      const timer = this.persistTimers.get(boardId);
      if (timer) {
        clearTimeout(timer);
        this.persistTimers.delete(boardId);
      }
    }
  }

  private schedulePersist(boardId: string): void {
    if (this.persistTimers.has(boardId)) return;
    this.persistTimers.set(
      boardId,
      setTimeout(() => {
        this.persistTimers.delete(boardId);
        this.docManager.persist(boardId);
      }, 1000),
    );
  }
}
