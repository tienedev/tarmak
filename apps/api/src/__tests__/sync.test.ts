import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { sql } from "drizzle-orm";
import { createDb, migrateDb, crdtRepo } from "@tarmak/db";
import { DocManager } from "../sync/doc-manager";
import { SyncServer, type SyncClient } from "../sync/ws";

function createTestDb() {
  const db = createDb();
  migrateDb(db);
  // Seed a board for foreign key constraints
  db.run(
    sql`INSERT INTO boards (id, name) VALUES ('board-1', 'Test Board')`,
  );
  return db;
}

describe("DocManager", () => {
  it("creates and returns a Y.Doc per board", () => {
    const db = createTestDb();
    const mgr = new DocManager(db);

    const doc1 = mgr.getOrCreate("board-1");
    const doc2 = mgr.getOrCreate("board-1");
    expect(doc1).toBe(doc2);

    const doc3 = mgr.getOrCreate("board-2");
    expect(doc3).not.toBe(doc1);
  });

  it("persists and reloads state from DB", () => {
    const db = createTestDb();
    const mgr = new DocManager(db);

    // Apply an update to the doc
    const doc = mgr.getOrCreate("board-1");
    const map = doc.getMap("test");
    map.set("key", "value");

    // Persist to DB
    mgr.persist("board-1");

    // Remove from memory
    mgr.remove("board-1");

    // Reload from DB
    const doc2 = mgr.initFromDb("board-1");
    const map2 = doc2.getMap("test");
    expect(map2.get("key")).toBe("value");
  });

  it("initFromDb works when no state exists in DB", () => {
    const db = createTestDb();
    const mgr = new DocManager(db);

    const doc = mgr.initFromDb("board-1");
    expect(doc).toBeDefined();
    expect(doc.getMap("test").size).toBe(0);
  });

  it("encodeFullState returns state update", () => {
    const db = createTestDb();
    const mgr = new DocManager(db);

    const doc = mgr.getOrCreate("board-1");
    doc.getMap("test").set("hello", "world");

    const state = mgr.encodeFullState("board-1");
    expect(state).toBeInstanceOf(Uint8Array);
    expect(state.length).toBeGreaterThan(0);

    // Verify the state is valid by applying to a fresh doc
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, state);
    expect(fresh.getMap("test").get("hello")).toBe("world");
    fresh.destroy();
  });

  it("remove destroys the doc and cleans up", () => {
    const db = createTestDb();
    const mgr = new DocManager(db);

    mgr.getOrCreate("board-1");
    mgr.remove("board-1");

    // getOrCreate should return a new doc now
    const doc2 = mgr.getOrCreate("board-1");
    expect(doc2.getMap("test").size).toBe(0);
  });

  it("persist does nothing for unknown board", () => {
    const db = createTestDb();
    const mgr = new DocManager(db);

    // Should not throw
    mgr.persist("nonexistent");
  });
});

describe("SyncServer", () => {
  let db: ReturnType<typeof createTestDb>;
  let docManager: DocManager;
  let server: SyncServer;

  beforeEach(() => {
    vi.useFakeTimers();
    db = createTestDb();
    docManager = new DocManager(db);
    server = new SyncServer(docManager);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mockClient(boardId: string): SyncClient & { messages: Uint8Array[] } {
    const messages: Uint8Array[] = [];
    return {
      boardId,
      messages,
      send(data: Uint8Array) {
        messages.push(data);
      },
    };
  }

  it("client receives full state on join", () => {
    const client = mockClient("board-1");
    server.join(client);

    expect(client.messages).toHaveLength(1);
    // Should be a valid Yjs state (even if empty)
    expect(client.messages[0]).toBeInstanceOf(Uint8Array);
  });

  it("update from one client is broadcast to others", () => {
    const client1 = mockClient("board-1");
    const client2 = mockClient("board-1");

    server.join(client1);
    server.join(client2);

    // Clear join messages
    client1.messages.length = 0;
    client2.messages.length = 0;

    // Create an update from a separate Y.Doc
    const senderDoc = new Y.Doc();
    senderDoc.getMap("data").set("x", 42);
    const update = Y.encodeStateAsUpdate(senderDoc);
    senderDoc.destroy();

    server.handleMessage(client1, update);

    // client1 should NOT receive the broadcast (it's the sender)
    expect(client1.messages).toHaveLength(0);
    // client2 SHOULD receive the broadcast
    expect(client2.messages).toHaveLength(1);
  });

  it("update is not sent to clients in different boards", () => {
    const client1 = mockClient("board-1");
    const client2 = mockClient("board-2");

    server.join(client1);
    server.join(client2);

    client1.messages.length = 0;
    client2.messages.length = 0;

    const senderDoc = new Y.Doc();
    senderDoc.getMap("data").set("x", 1);
    const update = Y.encodeStateAsUpdate(senderDoc);
    senderDoc.destroy();

    server.handleMessage(client1, update);

    expect(client2.messages).toHaveLength(0);
  });

  it("state is persisted after last client leaves", () => {
    const persistSpy = vi.spyOn(docManager, "persist");
    const removeSpy = vi.spyOn(docManager, "remove");

    const client = mockClient("board-1");
    server.join(client);

    // Apply an update so there's something to persist
    const senderDoc = new Y.Doc();
    senderDoc.getMap("data").set("key", "val");
    const update = Y.encodeStateAsUpdate(senderDoc);
    senderDoc.destroy();
    server.handleMessage(client, update);

    server.leave(client);

    expect(persistSpy).toHaveBeenCalledWith("board-1");
    expect(removeSpy).toHaveBeenCalledWith("board-1");
  });

  it("state is NOT removed when other clients remain", () => {
    const removeSpy = vi.spyOn(docManager, "remove");

    const client1 = mockClient("board-1");
    const client2 = mockClient("board-1");
    server.join(client1);
    server.join(client2);

    server.leave(client1);

    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("debounced persistence fires after 1 second", () => {
    const persistSpy = vi.spyOn(docManager, "persist");

    const client = mockClient("board-1");
    server.join(client);

    const senderDoc = new Y.Doc();
    senderDoc.getMap("data").set("a", 1);
    const update = Y.encodeStateAsUpdate(senderDoc);
    senderDoc.destroy();

    server.handleMessage(client, update);

    // Not yet persisted (debounce)
    expect(persistSpy).not.toHaveBeenCalled();

    // Advance timer by 1 second
    vi.advanceTimersByTime(1000);

    expect(persistSpy).toHaveBeenCalledWith("board-1");
  });

  it("debounce coalesces multiple updates", () => {
    const persistSpy = vi.spyOn(docManager, "persist");

    const client = mockClient("board-1");
    server.join(client);

    // Send multiple updates quickly
    for (let i = 0; i < 5; i++) {
      const senderDoc = new Y.Doc();
      senderDoc.getMap("data").set("i", i);
      const update = Y.encodeStateAsUpdate(senderDoc);
      senderDoc.destroy();
      server.handleMessage(client, update);
    }

    // Advance timer — should only persist once
    vi.advanceTimersByTime(1000);

    expect(persistSpy).toHaveBeenCalledTimes(1);
  });

  it("leave cancels pending persist timer", () => {
    const persistSpy = vi.spyOn(docManager, "persist");

    const client = mockClient("board-1");
    server.join(client);

    const senderDoc = new Y.Doc();
    senderDoc.getMap("data").set("a", 1);
    const update = Y.encodeStateAsUpdate(senderDoc);
    senderDoc.destroy();
    server.handleMessage(client, update);

    // Leave before the timer fires — leave itself will persist
    server.leave(client);
    persistSpy.mockClear();

    // Advance timer — debounced persist should NOT fire (was cancelled)
    vi.advanceTimersByTime(1000);
    expect(persistSpy).not.toHaveBeenCalled();
  });
});
