import { HTTPException } from "hono/http-exception";

export const INVITE_GONE = "This invite link has expired or been used. Ask for a new one.";

export const ONLY_CONTACTS = "Only your contacts can be added.";

const goneMessages = {
  task: "That task no longer exists.",
  category: "That list no longer exists.",
  note: "That note no longer exists.",
  user: "That account no longer exists.",
  username: "No one here has that username.",
  contact: "They're no longer one of your contacts.",
  "removed contact": "That can no longer be undone.",
  "category collaborator": "They're no longer in this list.",
  "removed collaborator": "That can no longer be undone.",
  "task share": "That task is no longer shared with them.",
  "task shared with you": "That task is no longer shared with you.",
  invite: INVITE_GONE,
} as const;

/** An HTTPException whose ids stay in the server's log: `message` is what a person is shown. */
export class LoggedHTTPException extends HTTPException {
  readonly detail: string;

  constructor(status: 404 | 409 | 500, message: string, detail: string) {
    super(status, { message });
    this.detail = detail;
  }
}

export class NotFoundError extends LoggedHTTPException {
  constructor(entity: keyof typeof goneMessages, id?: string) {
    super(404, goneMessages[entity], id ? `${entity} not found: ${id}` : `${entity} not found`);
  }
}

export class BadRequestError extends HTTPException {
  constructor(message: string) {
    super(400, { message });
  }
}

export const onlyContacts = () => new BadRequestError(ONLY_CONTACTS);

export class ForbiddenError extends HTTPException {
  constructor(message: string) {
    super(403, { message });
  }
}

export class ConflictError extends HTTPException {
  constructor(message: string) {
    super(409, { message });
  }
}

export class GoneError extends HTTPException {
  constructor(message: string) {
    super(410, { message });
  }
}

export class IdTakenError extends LoggedHTTPException {
  constructor(entity: string, id: string) {
    super(409, "That couldn't be saved. Try adding it again.", `${entity} id taken: ${id}`);
  }
}

export class StaleUpdateError extends LoggedHTTPException {
  constructor(entity: string, id: string) {
    super(
      409,
      "This changed somewhere else or no longer exists, so the change wasn't saved.",
      `Stale or missing ${entity}: ${id}`,
    );
  }
}

export class InsertFailedError extends LoggedHTTPException {
  constructor(entity: string) {
    super(
      500,
      "Something went wrong on the server. Try again.",
      `Insert failed: no ${entity} row returned`,
    );
  }
}
