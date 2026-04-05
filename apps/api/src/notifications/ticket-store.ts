const TICKET_TTL_MS = 60_000; // 60 seconds
const PRUNE_THRESHOLD = 1_000;

interface Ticket {
  userId: string;
  expiresAt: number;
}

export class TicketStore {
  private tickets = new Map<string, Ticket>();

  create(userId: string): string {
    this.pruneIfNeeded();
    const id = crypto.randomUUID();
    this.tickets.set(id, {
      userId,
      expiresAt: Date.now() + TICKET_TTL_MS,
    });
    return id;
  }

  /** Consume a ticket (single-use). Returns userId or null if invalid/expired. */
  consume(ticketId: string): string | null {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return null;

    this.tickets.delete(ticketId);

    if (Date.now() > ticket.expiresAt) return null;

    return ticket.userId;
  }

  private pruneIfNeeded(): void {
    if (this.tickets.size < PRUNE_THRESHOLD) return;
    const now = Date.now();
    for (const [id, ticket] of this.tickets) {
      if (now > ticket.expiresAt) {
        this.tickets.delete(id);
      }
    }
  }
}
