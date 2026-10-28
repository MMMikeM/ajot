import { connect } from "@tursodatabase/serverless";
import { now } from "@newtab-todo/shared/iso";
import { MIN_PASSWORD_LENGTH, hashPassword } from "./password";
import { signRevocation } from "./session-revocation";

const promptHidden = (question: string) =>
  new Promise<string>((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    let input = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          stdout.write("\n");
          process.exit(130);
        }
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(input);
          return;
        }
        input = char === "\u007f" ? input.slice(0, -1) : input + char;
      }
    };
    stdin.on("data", onData);
  });

const [userId] = process.argv.slice(2);

if (!userId) {
  console.error(
    "Usage: pnpm reset-password <user-id>  (on Fly: node dist/reset-password.js <user-id>)",
  );
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error("Run this in a terminal: the new password is read from a hidden prompt.");
  process.exit(1);
}

const password = await promptHidden("New password: ");
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  process.exit(1);
}
if ((await promptHidden("Repeat password: ")) !== password) {
  console.error("Passwords do not match.");
  process.exit(1);
}

const connection = connect({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const [updated, revoked] = await connection.batch(
  [
    {
      sql: "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
      args: [await hashPassword(password), now(), userId],
    },
    { sql: "DELETE FROM sessions WHERE user_id = ?", args: [userId] },
  ],
  "immediate",
);
await connection.close();

if (updated!.rowsAffected === 0) {
  console.error(`No user found with id: ${userId}`);
  process.exit(1);
}

console.log(`Password reset for ${userId}; signed out of ${revoked!.rowsAffected} session(s).`);

// The running server caches sessions for 30 s, so it's told they're gone
const serverUrl = process.env.SERVER_URL ?? `http://localhost:${process.env.PORT || 3000}`;
try {
  const res = await fetch(new URL("/api/auth/sessions-revoked", serverUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signRevocation(process.env.TURSO_AUTH_TOKEN ?? "", userId)),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`it answered ${res.status}`);
  console.log(`The server at ${serverUrl} has stopped accepting them.`);
} catch (err) {
  console.warn(
    `Couldn't tell the server at ${serverUrl} (${err instanceof Error ? err.message : String(err)}); ` +
      "it may accept those sessions for up to 30 s more. Set SERVER_URL to reach it.",
  );
}
