import { BASE_URL } from "./stack";

export type ApiTask = {
  id: string;
  userId: string;
  title: string;
  status: string;
  categoryId: string | null;
  shares: { id: string; sharedWithUserId: string; categoryId: string | null }[];
  [key: string]: unknown;
};
export type ApiNote = { id: string; userId: string; taskId: string | null; content: string | null };

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

type Request = {
  method?: string;
  body?: unknown;
  token?: string;
  cookie?: string;
  origin?: string;
  base?: string;
};

/** The response whatever its status, for checking what the server refuses. */
export const send = (
  path: string,
  { method = "GET", body, token, cookie, origin, base = BASE_URL }: Request = {},
) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { "Content-Type": "application/json" }),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(cookie && { Cookie: `auth=${cookie}` }),
      ...(origin && { Origin: origin }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

/** For test setup and teardown, where going through the UI would be slow. */
export const apiRequest = async <T>(
  method: string,
  path: string,
  body: unknown,
  token: string,
): Promise<T> => {
  const res = await send(path, { method, body, token });
  if (!res.ok) {
    throw new Error(`API ${method} ${path} → ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
};

// Rows as the app would send them, with an id and stamps filled in
const row = (fields: Record<string, unknown>) => ({
  id: newId(),
  userId: "",
  createdAt: now(),
  updatedAt: now(),
  ...fields,
});
export const newTask = (extra: Record<string, unknown> = {}) =>
  row({ title: "Test task", ...extra });
export const newNote = (taskId: string, content: string, extra: Record<string, unknown> = {}) =>
  row({ taskId, title: content, content, ...extra });
export const newList = (name: string, extra: Record<string, unknown> = {}) =>
  row({ name, ...extra });

export const addTask = (token: string, extra: Record<string, unknown> = {}) =>
  apiRequest<ApiTask>("POST", "/api/tasks", newTask(extra), token);
export const addNote = (token: string, taskId: string, content: string) =>
  apiRequest<ApiNote>("POST", "/api/notes", newNote(taskId, content), token);
export const addList = (token: string, name: string) =>
  apiRequest<{ id: string }>("POST", "/api/categories", newList(name), token);
export const shareTask = (
  ownerToken: string,
  taskId: string,
  username: string,
  permission: "view" | "edit" = "edit",
) =>
  apiRequest<{ id: string }>(
    "POST",
    "/api/tasks/share",
    { taskId, username, permission },
    ownerToken,
  );
export const addCollaborator = (ownerToken: string, listId: string, username: string) =>
  apiRequest("POST", `/api/categories/${listId}/collaborators`, { username }, ownerToken);

export const tasksOf = (token: string) =>
  apiRequest<ApiTask[]>("GET", "/api/tasks", undefined, token);
export const notesOf = (token: string) =>
  apiRequest<ApiNote[]>("GET", "/api/notes", undefined, token);

/** Safe to call repeatedly. */
export const ensureMutualContacts = async (token1: string, token2: string): Promise<void> => {
  let inviteToken: string;
  try {
    const invite = await apiRequest<{ token: string }>("POST", "/api/invites", undefined, token1);
    inviteToken = invite.token;
  } catch {
    // If invite creation fails for any reason, contacts may already exist — skip
    return;
  }
  try {
    await apiRequest("POST", `/api/invites/${inviteToken}/accept`, undefined, token2);
  } catch {
    // 410 = already used / expired; contacts already established
  }
};

/** Faster than the UI, and leaves nothing in the client's outbox. */
export const deleteAllTasksInCategory = async (
  token: string,
  categoryId: string,
): Promise<void> => {
  const tasks = await tasksOf(token);
  const targets = tasks.filter((t) => t.categoryId === categoryId);
  await Promise.all(targets.map((t) => apiRequest("DELETE", "/api/tasks", { id: t.id }, token)));
};
