import { randomBytes } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { createId } from "@paralleldrive/cuid2";
import { now } from "@newtab-todo/shared/iso";
import userRepo from "./db/user.repo";
import sessionRepo from "./db/session.repo";
import categoryRepo from "./db/category.repo";
import inviteTokenRepo from "./db/invite-token.repo";
import { ConflictError, ForbiddenError, INVITE_GONE } from "./db/errors";
import { hashPassword, verifyPassword } from "./password";

/** A server's first account signs up freely; everyone after needs an invite from someone on it. */
const admit = async (inviteToken: string | undefined) => {
  if (inviteToken) {
    const invite = await inviteTokenRepo.claim(inviteToken);
    if (!invite) throw new ForbiddenError(INVITE_GONE);
    return invite;
  }
  if ((await userRepo.count()) > 0) {
    throw new ForbiddenError(
      "Signing up needs an invite link. Ask someone on this server for one.",
    );
  }
  return null;
};

const createAccount = async (username: string, password: string, name: string) => {
  const passwordHash = await hashPassword(password);
  const ts = now();
  const user = await userRepo.insert({
    id: createId(),
    name,
    username,
    passwordHash,
    createdAt: ts,
    updatedAt: ts,
  });

  await categoryRepo.insert({
    id: createId(),
    userId: user.id,
    name: "Personal",
    color: "oklch(0.60 0.18 118)",
    createdAt: ts,
    updatedAt: ts,
  });
  return user;
};

// Without an invite that works, a signup learns nothing about who's here: the invite is checked
// before the username, so only someone already invited finds out whether a name is taken
export const signup = async (
  username: string,
  password: string,
  name: string,
  inviteToken?: string,
) => {
  const normalizedUsername = username.toLowerCase();
  const invite = await admit(inviteToken);
  let user;
  try {
    if (await userRepo.exists(normalizedUsername))
      throw new ConflictError("That username is taken. Try another.");
    user = await createAccount(normalizedUsername, password, name);
  } catch (e) {
    if (invite) await inviteTokenRepo.release(invite.id);
    throw e;
  }
  const contacts = invite ? await inviteTokenRepo.consume(invite, user.id) : [];

  const token = await sessionRepo.insert(user.id);
  return {
    session: { userId: user.id, token, name: user.name, username: user.username },
    invitedBy: invite?.createdByUserId ?? null,
    contacts,
  };
};

const wrongPassword = () => new HTTPException(401, { message: "Wrong username or password." });

// Checked against when there's no such user, so a wrong username takes as long as a wrong password.
// Worked out at startup, as a first login working it out would take two hashes' time.
let unknownUserHash: Promise<string> | undefined;

const hashForUnknownUsers = () =>
  (unknownUserHash ??= hashPassword(randomBytes(32).toString("hex")).catch((err: unknown) => {
    unknownUserHash = undefined;
    throw err;
  }));

hashForUnknownUsers().catch((err: unknown) =>
  console.error("[login] couldn't hash for unknown usernames; trying again at the next:", err),
);

export const login = async (username: string, password: string) => {
  const user = await userRepo.findWithPassword(username.toLowerCase());
  if (!user) {
    await verifyPassword(await hashForUnknownUsers(), password);
    throw wrongPassword();
  }
  if (!(await verifyPassword(user.passwordHash, password))) throw wrongPassword();

  const token = await sessionRepo.insert(user.id);
  return { userId: user.id, token, name: user.name, username: user.username };
};
