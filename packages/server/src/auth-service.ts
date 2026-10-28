import { HTTPException } from "hono/http-exception";
import { createId } from "@paralleldrive/cuid2";
import { now } from "@newtab-todo/shared/iso";
import userRepo from "./db/user.repo";
import sessionRepo from "./db/session.repo";
import categoryRepo from "./db/category.repo";
import inviteTokenRepo from "./db/invite-token.repo";
import { ConflictError, ForbiddenError, NotFoundError } from "./db/errors";
import { hashPassword, verifyPassword } from "./password";

/** A server's first account signs up freely; everyone after needs an invite from someone on it. */
const admit = async (inviteToken: string | undefined) => {
  if (inviteToken) {
    const invite = await inviteTokenRepo.claim(inviteToken);
    if (!invite)
      throw new ForbiddenError("This invite link has expired or been used. Ask for a new one.");
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

export const signup = async (
  username: string,
  password: string,
  name: string,
  inviteToken?: string,
) => {
  const normalizedUsername = username.toLowerCase();
  let existing = false;
  try {
    await userRepo.findByUsername(normalizedUsername);
    existing = true;
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }
  if (existing) throw new ConflictError("That username is taken. Try another.");

  const invite = await admit(inviteToken);
  let user;
  try {
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

export const login = async (username: string, password: string) => {
  const normalized = username.toLowerCase();
  let user;
  try {
    user = await userRepo.findByUsernameWithPassword(normalized);
    console.log(`[login] found user id=${user.id} username=${user.username}`);
  } catch (e) {
    console.log(
      `[login] user not found username=${normalized} error=${e instanceof Error ? e.message : String(e)}`,
    );
    throw new HTTPException(401, { message: "Wrong username or password." });
  }

  const valid = await verifyPassword(user.passwordHash, password);
  console.log(`[login] password valid=${valid} userId=${user.id}`);
  if (!valid) throw new HTTPException(401, { message: "Wrong username or password." });

  const token = await sessionRepo.insert(user.id);
  return { userId: user.id, token, name: user.name, username: user.username };
};
