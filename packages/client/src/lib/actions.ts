/**
 * The ONLY non-infrastructure module allowed to import `{ client }`: components and routes
 * call these functions instead of reaching for the API client. Infrastructure files
 * (collections.ts, offline.ts, push.ts) are exempt.
 */
import { client } from "~/lib/api";
import { categoriesCollection, contactsCollection, tasksCollection } from "~/lib/db/collections";

const UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";
const TIMED_OUT = "The server took too long to answer. Check your connection and try again.";

/** fetch rejects, with the browser's own wording, only when the server can't be reached. */
const reach = <T>(request: Promise<T>) =>
  request.catch(() => {
    throw new Error(UNREACHABLE);
  });

/** The server's own message, or `fallback` when the body isn't one (a proxy's error page). */
const errorFrom = async (res: Response, fallback: string) => {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? fallback);
};

export const createInvite = async (): Promise<{ token: string; expiresAt: string }> => {
  const res = await reach(client.api.invites.$post());
  if (!res.ok) throw await errorFrom(res, "Couldn't make an invite link. Try again.");
  return res.json() as Promise<{ token: string; expiresAt: string }>;
};

/** Who made an invite, or null when it's unusable or the server can't be reached. */
export const fetchInviterName = async (token: string): Promise<string | null> => {
  try {
    const res = await client.api.auth.invites[":token"].$get({ param: { token } });
    if (!res.ok) return null;
    return (await res.json()).inviterName;
  } catch {
    return null;
  }
};

export const acceptInvite = async (token: string) => {
  const res = await reach(client.api.invites[":token"].accept.$post({ param: { token } }));
  if (!res.ok) throw await errorFrom(res, "Couldn't accept the invite. Try again.");
  // Fire-and-forget — the invite is accepted regardless of whether the
  // local collection refreshes successfully. Awaiting this would surface
  // a misleading error after a successful server-side acceptance, and the
  // consumed token would then prevent any retry.
  contactsCollection.utils.refetch().catch(console.error);
};

/** Removes the contact for both people, not only this user, and the lists they shared. */
export const removeContact = async (id: string) => {
  const res = await client.api.contacts[":id"].$delete({ param: { id } });
  if (!res.ok) throw new Error("Failed to remove contact");
  await Promise.all([contactsCollection.utils.refetch(), categoriesCollection.utils.refetch()]);
};

/** Undoes removeContact: both people are contacts again, sharing the same lists. */
export const restoreContact = async (id: string) => {
  const res = await client.api.contacts[":id"].restore.$post({ param: { id } });
  if (!res.ok) throw new Error("Failed to restore contact");
  await Promise.all([
    contactsCollection.utils.refetch(),
    categoriesCollection.utils.refetch(),
    tasksCollection.utils.refetch(),
  ]);
};

export const addCollaborator = async (categoryId: string, username: string) => {
  const res = await reach(
    client.api.categories[":id"].collaborators.$post({
      param: { id: categoryId },
      json: { username },
    }),
  );
  if (!res.ok) throw await errorFrom(res, "Couldn't add them. Try again.");
  await categoriesCollection.utils.refetch();
};

/** Owner only; a collaborator removes themselves with leaveCategory. */
export const removeCollaborator = async (categoryId: string, userId: string) => {
  const res = await reach(
    client.api.categories[":id"].collaborators[":userId"].$delete({
      param: { id: categoryId, userId },
    }),
  );
  if (!res.ok) throw await errorFrom(res, "Couldn't remove them. Try again.");
  await categoriesCollection.utils.refetch();
};

export const leaveCategory = async (categoryId: string, userId: string) => {
  const res = await client.api.categories[":id"].collaborators[":userId"].$delete({
    param: { id: categoryId, userId },
  });
  if (!res.ok) throw await errorFrom(res, "Couldn't leave the list. Try again.");
  await categoriesCollection.utils.writeDelete(categoryId as never);
};

export const shareTask = async (taskId: string, username: string, permission: "view" | "edit") => {
  const res = await reach(client.api.tasks.share.$post({ json: { taskId, username, permission } }));
  if (!res.ok) throw await errorFrom(res, "Couldn't share. Try again.");
};

export const removeTaskShare = async (shareId: string) => {
  await client.api.tasks.share.$delete({ json: { id: shareId } });
};

const AUTH_FAILED = {
  login: "Couldn't sign in. Try again.",
  signup: "Couldn't create your account. Try again.",
};

export const authenticate = async (
  mode: "login" | "signup",
  fields: { username: string; password: string; name: string; invite?: string },
): Promise<{ userId: string; token: string; name: string; username: string }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(TIMED_OUT)), 15_000);
  try {
    const endpoint = mode === "login" ? client.api.auth.login : client.api.auth.signup;
    const res = await reach<Response>(
      endpoint.$post({ json: fields }, { init: { signal: controller.signal } }),
    );
    if (!res.ok) throw await errorFrom(res, AUTH_FAILED[mode]);
    return res.json() as Promise<{ userId: string; token: string; name: string; username: string }>;
  } catch (err) {
    if (controller.signal.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new Error(TIMED_OUT);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
};

export const logout = async () => {
  try {
    await client.api.auth.logout.$post();
  } catch {
    // best-effort; caller clears local state regardless
  }
};
