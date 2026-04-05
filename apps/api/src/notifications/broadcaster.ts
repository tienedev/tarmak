import { EventEmitter } from "node:events";

export interface NotificationEvent {
  userId: string;
  type: string;
  title: string;
  body?: string;
  boardId: string;
  taskId?: string;
}

export class NotificationBroadcaster extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
  }

  send(event: NotificationEvent): void {
    this.emit(`user:${event.userId}`, event);
  }

  subscribe(userId: string, callback: (event: NotificationEvent) => void): () => void {
    const channel = `user:${userId}`;
    this.on(channel, callback);
    return () => this.off(channel, callback);
  }
}
