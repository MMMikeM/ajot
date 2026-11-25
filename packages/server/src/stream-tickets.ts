import { randomBytes } from "node:crypto";
import { isOneOf, type StreamOwner, type StreamsOf } from "./broadcast";

// Long enough for the stream to open after the ticket's request woke a suspended machine
const TICKET_TTL_MS = 60_000;
// A page takes one per connect; an account holding more is a client stuck in a loop
const MAX_TICKETS_PER_USER = 20;

const tickets = new Map<string, StreamOwner & { expiresAt: number }>();

const dropExpired = (now: number) => {
  for (const [ticket, { expiresAt }] of tickets) if (expiresAt <= now) tickets.delete(ticket);
};

const dropOldestOf = (userId: string) => {
  const held = [...tickets].filter(([, t]) => t.userId === userId).map(([ticket]) => ticket);
  for (const ticket of held.slice(0, held.length - MAX_TICKETS_PER_USER + 1))
    tickets.delete(ticket);
};

/** A ticket that opens one event stream as `owner`, in place of a token in its URL. */
export const issueTicket = ({ userId, sessionId }: StreamOwner) => {
  const now = Date.now();
  dropExpired(now);
  dropOldestOf(userId);
  const ticket = randomBytes(32).toString("base64url");
  tickets.set(ticket, { userId, sessionId, expiresAt: now + TICKET_TTL_MS });
  return ticket;
};

/** Who a ticket was issued to, once: its first use spends it, expired or not. */
export const redeemTicket = (ticket: string): StreamOwner | null => {
  const held = tickets.get(ticket);
  tickets.delete(ticket);
  return held && held.expiresAt > Date.now()
    ? { userId: held.userId, sessionId: held.sessionId }
    : null;
};

export const dropTicketsOf = (streams: StreamsOf) => {
  for (const [ticket, held] of tickets) if (isOneOf(held, streams)) tickets.delete(ticket);
};
