import { randomBytes } from "node:crypto";

// Long enough for the stream to open after the ticket's request woke a suspended machine
const TICKET_TTL_MS = 60_000;
// A page takes one per connect; an account holding more is a client stuck in a loop
const MAX_TICKETS_PER_USER = 20;

const tickets = new Map<string, { userId: string; expiresAt: number }>();

const dropExpired = (now: number) => {
  for (const [ticket, { expiresAt }] of tickets) if (expiresAt <= now) tickets.delete(ticket);
};

const dropOldestOf = (userId: string) => {
  const held = [...tickets].filter(([, t]) => t.userId === userId).map(([ticket]) => ticket);
  for (const ticket of held.slice(0, held.length - MAX_TICKETS_PER_USER + 1))
    tickets.delete(ticket);
};

/** A ticket that opens one event stream as `userId`, in place of a token in its URL. */
export const issueTicket = (userId: string) => {
  const now = Date.now();
  dropExpired(now);
  dropOldestOf(userId);
  const ticket = randomBytes(32).toString("base64url");
  tickets.set(ticket, { userId, expiresAt: now + TICKET_TTL_MS });
  return ticket;
};

/** The user a ticket was issued to, once: its first use spends it, expired or not. */
export const redeemTicket = (ticket: string) => {
  const held = tickets.get(ticket);
  tickets.delete(ticket);
  return held && held.expiresAt > Date.now() ? held.userId : null;
};
