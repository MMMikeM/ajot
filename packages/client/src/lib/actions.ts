import { apiHeaders, client } from "~/lib/api";
import { apiClient } from "~/lib/api-client";
import { getAuthToken } from "~/lib/auth/token";
import { clearSession } from "~/lib/auth/session";
import { getServerUrl } from "~/lib/server-url";
import { unregisterPushSubscription } from "~/lib/sync/push";
import { categoriesCollection, contactsCollection, tasksCollection } from "~/lib/db/collections";

const UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";
const TIMED_OUT = "The server took too long to answer. Check your connection and try again.";

/** fetch rejects, with the browser's own wording, only when the server can't be reached. */
const reach = <T>(request: Promise<T>) =>
  request.catch(() => {
    throw new Error(UNREACHABLE);
  });

const errorFrom = async (res: Response, fallback: string) => {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? fallback);
};

export const createInvite = async (): Promise<{ token: string; expiresAt: string }> => {
  const res = await reach(client.api.invites.$post());
  if (!res.ok) throw await errorFrom(res, "Couldn't make an invite link. Try again.");
  return res.json() as Promise<{ token: string; expiresAt: string }>;
};

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
  // Not awaited: the accept worked and consumed the token, so a refetch error here would offer a
  // retry that can't succeed
  contactsCollection.utils.refetch().catch(console.error);
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

/** Undoes removeCollaborator: they're back in the list, and so are the tasks it moved out. */
export const restoreCollaborator = async (categoryId: string, userId: string) => {
  const res = await reach(
    client.api.categories[":id"].collaborators[":userId"].restore.$post({
      param: { id: categoryId, userId },
    }),
  );
  const failed = "Couldn't bring them back.";
  // A 400 says why (they're no longer a contact); a 404 only names a missing record
  if (!res.ok) throw res.status === 400 ? await errorFrom(res, failed) : new Error(failed);
  await Promise.all([categoriesCollection.utils.refetch(), tasksCollection.utils.refetch()]);
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

// Not through `client`, which signs each request with whoever is signed in when it's sent
const endServerSession = async (token: string) => {
  try {
    await apiClient({ serverUrl: getServerUrl(), token }).api.auth.logout.$post(undefined, {
      init: { keepalive: true },
    });
  } catch {
    // Unreachable: the session stays valid on the server, but nothing here holds its token
  }
};

/** The push subscription goes first, since the server drops it only for a live session. */
export const signOut = () => {
  const token = getAuthToken();
  const signedOutOnServer = unregisterPushSubscription(apiHeaders()).then(() =>
    token ? endServerSession(token) : undefined,
  );
  clearSession();
  return signedOutOnServer;
};
