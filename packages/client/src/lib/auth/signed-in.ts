import { TOKEN_KEY, USER_ID_KEY } from "@newtab-todo/shared/constants";
import { createExternalStore } from "~/lib/external-store";

export interface CurrentUser {
  id: string;
  name: string;
  username: string;
}

/** The token and the account it belongs to, which only ever change together. */
export type SignedIn = { token: string | null; user: CurrentUser | null };

const USER_INFO_KEY = "newtab-todo-user-info";
// Another tab hears of each key's write on its own, so between two of them it would hold one
// account's token with another's user. This key's single event carries both; it's removed as
// soon as it's written, and the keys above stay what a page loads from.
const CHANGE_KEY = "newtab-todo-signed-in";

const loadUser = (): CurrentUser | null => {
  const raw = localStorage.getItem(USER_INFO_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through */
    }
  }
  const id = localStorage.getItem(USER_ID_KEY);
  return id ? { id, name: "", username: "" } : null;
};

const load = (): SignedIn =>
  typeof localStorage === "undefined"
    ? { token: null, user: null }
    : { token: localStorage.getItem(TOKEN_KEY), user: loadUser() };

const store = createExternalStore<SignedIn>(load());

export const getSignedIn = store.get;
export const subscribeSignedIn = store.subscribe;

const persist = ({ token, user }: SignedIn) => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  if (user) {
    localStorage.setItem(USER_ID_KEY, user.id);
    localStorage.setItem(USER_INFO_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(USER_INFO_KEY);
  }
};

export const setSignedIn = (next: SignedIn) => {
  persist(next);
  localStorage.setItem(CHANGE_KEY, JSON.stringify(next));
  localStorage.removeItem(CHANGE_KEY);
  store.set(next);
};

// Browser only: window is undefined during SSR prerender
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.storageArea !== localStorage) return;
    if (e.key === CHANGE_KEY && e.newValue) store.set(JSON.parse(e.newValue) as SignedIn);
    // localStorage.clear()
    else if (e.key === null) store.set(load());
  });
}
