import { useEffect, useRef, useState } from "react";
import { createLazyFileRoute, useRouter } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { z } from "zod/mini";
import { signIn } from "~/lib/auth/session";
import { authenticate } from "~/lib/actions";
import { Button } from "~/components/ui/button";
import { FormField } from "~/components/ui/field";
import { Input } from "~/components/ui/field";
import {
  MAX_NAME,
  MAX_NEW_USERNAME,
  MAX_PASSWORD,
  MAX_USERNAME,
} from "@newtab-todo/shared/field-limits";
import { getBuildTarget } from "~/lib/build-target";
import { useInviterName } from "~/lib/hooks/use-inviter-name";
import { requestSyncDataConsent } from "~/lib/ext";
import { getServerUrl, setServerUrl } from "~/lib/server-url";
import { fetchServerConfig, normalizeServerUrl, type ServerConfig } from "~/lib/server-config";

const loginSchema = z.object({
  username: z.string().check(z.minLength(1, "Enter your username")),
  password: z.string().check(z.minLength(1, "Enter your password")),
});

const signupSchema = z.object({
  username: z.string().check(z.minLength(3, "Use at least 3 characters")),
  password: z.string().check(z.minLength(8, "Use at least 8 characters")),
  name: z.string().check(z.minLength(1, "Enter your name")),
});

const serverSchema = z.string().check(z.minLength(1, "Enter your sync server's address"));

const readPendingInvite = () => {
  try {
    return sessionStorage.getItem("pending-invite");
  } catch {
    // sessionStorage unavailable in some contexts; proceed without the invite
    return null;
  }
};

// The PWA belongs to its server; the extension has to be told which server to use
const choosesServer = getBuildTarget() === "extension";

const connectToServer = async (input: string) => {
  const serverUrl = normalizeServerUrl(input);
  let config: ServerConfig;
  try {
    config = await fetchServerConfig(serverUrl);
  } catch {
    throw new Error(`Couldn't reach a sync server at ${serverUrl}`);
  }
  await setServerUrl(serverUrl);
  return config;
};

const AuthView = () => {
  const router = useRouter();
  const [pendingInvite] = useState(readPendingInvite);
  const inviterName = useInviterName(pendingInvite);
  // Someone following an invite link is most likely new here
  const [mode, setMode] = useState<"login" | "signup">(pendingInvite ? "signup" : "login");
  const [serverError, setServerError] = useState<string | null>(null);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const syncConsent = useRef<Promise<boolean>>(Promise.resolve(true));

  // Past its first account, a server only takes signups through an invite. Until the config
  // arrives, offer it anyway: the server's refusal explains itself.
  const canSignUp = !config || config.awaitingFirstUser || !!pendingInvite;

  const schema = mode === "login" ? loginSchema : signupSchema;
  const form = useForm({
    defaultValues: { server: getServerUrl(), username: "", password: "", name: "" },
    onSubmit: async ({ value }) => {
      setServerError(null);
      let result: { userId: string; token: string; name: string; username: string };
      try {
        if (!(await syncConsent.current)) {
          setServerError("Allow Firefox to send your account to the server, then try again.");
          return;
        }
        if (choosesServer) setConfig(await connectToServer(value.server));
        result = await authenticate(mode, {
          username: value.username.trim(),
          password: value.password,
          name: value.name.trim(),
          ...(mode === "signup" && pendingInvite && { invite: pendingInvite }),
        });
      } catch (err) {
        setServerError(err instanceof Error ? err.message : "Couldn't sign in. Try again.");
        return;
      }
      signIn(result.token, { id: result.userId, name: result.name, username: result.username });
      try {
        sessionStorage.removeItem("pending-invite");
      } catch {
        // see readPendingInvite
      }
      // Signing up with the invite already accepted it
      if (pendingInvite && mode === "login") {
        void router.navigate({ to: "/invite/$token", params: { token: pendingInvite } });
      } else {
        void router.navigate({ to: "/" });
      }
    },
  });

  useEffect(() => {
    if (choosesServer && !getServerUrl()) return;
    fetchServerConfig(getServerUrl())
      .then((fetched) => {
        setConfig(fetched);
        // A new server has no one to sign in as, so open on its first account
        if (fetched.awaitingFirstUser && !form.state.isDirty) setMode("signup");
      })
      .catch(console.error);
  }, []);

  const signupClosed = mode === "login" && !canSignUp;
  const subline = pendingInvite
    ? mode === "signup"
      ? inviterName
        ? "Create your account to accept."
        : "Signing up accepts your invite."
      : `You'll accept ${inviterName ? `${inviterName}'s` : "the"} invite next.`
    : mode === "signup" && config?.awaitingFirstUser
      ? "Everyone after you joins with an invite from someone here."
      : null;

  return (
    <div className="flex flex-col items-center justify-start pt-[20vh] pb-16 touch:flex-1 touch:overflow-y-auto touch:pt-[12vh] touch:pb-10">
      <div className="w-full max-w-xs touch:max-w-none">
        <div className="mb-8 flex flex-col gap-2">
          <h2 className="font-display text-3xl text-balance text-foreground">
            {mode === "login"
              ? "Sign in to sync across devices"
              : inviterName
                ? `${inviterName} invited you to Ajot`
                : config?.awaitingFirstUser
                  ? "Create the server's first account"
                  : "Create your account"}
          </h2>
          {subline && <p className="text-sm text-pretty text-hint">{subline}</p>}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // Firefox only prompts from within the submit itself, before anything is awaited
            if (choosesServer) syncConsent.current = requestSyncDataConsent();
            void form.handleSubmit();
          }}
          className="flex flex-col gap-3"
        >
          {choosesServer && (
            <form.Field name="server" validators={{ onChange: serverSchema }}>
              {(field) => (
                <FormField
                  field={field}
                  label="Server"
                  description="The sync server you or someone you know runs. Without one, tasks stay on this device."
                >
                  <Input
                    type="url"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="https://todo.example.com"
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="url"
                    inputMode="url"
                  />
                </FormField>
              )}
            </form.Field>
          )}
          {mode === "signup" && (
            <form.Field name="name" validators={{ onChange: signupSchema.shape.name }}>
              {(field) => (
                <FormField field={field} label="Name">
                  <Input
                    type="text"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    maxLength={MAX_NAME}
                    autoComplete="name"
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- first field of the page's only form
                    autoFocus
                  />
                </FormField>
              )}
            </form.Field>
          )}
          <form.Field name="username" validators={{ onChange: schema.shape.username }}>
            {(field) => (
              <FormField field={field} label="Username">
                <Input
                  type="text"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  maxLength={mode === "login" ? MAX_USERNAME : MAX_NEW_USERNAME}
                  // eslint-disable-next-line jsx-a11y/no-autofocus -- first field of the page's only form
                  autoFocus={mode === "login"}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="username"
                  inputMode="text"
                />
              </FormField>
            )}
          </form.Field>
          <form.Field name="password" validators={{ onChange: schema.shape.password }}>
            {(field) => (
              <FormField field={field} label="Password">
                <Input
                  type="password"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  maxLength={MAX_PASSWORD}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </FormField>
            )}
          </form.Field>
          {serverError && (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive-subtle px-3 py-2 text-sm text-destructive"
            >
              {serverError}
            </div>
          )}
          <div className="mt-1 flex flex-col gap-2">
            {/* Not the solid primary fill: its text falls under 4.5:1 */}
            <Button type="submit" className="w-full" disabled={form.state.isSubmitting}>
              {form.state.isSubmitting
                ? mode === "login"
                  ? "Signing in…"
                  : "Creating account…"
                : mode === "login"
                  ? "Sign in"
                  : "Create account"}
            </Button>
            <div className="flex items-center justify-center gap-6">
              {(canSignUp || mode === "signup") && (
                <Button
                  type="button"
                  variant="subtle"
                  size="xs"
                  className="touch:text-sm"
                  onClick={() => {
                    setMode(mode === "login" ? "signup" : "login");
                    form.reset();
                    setServerError(null);
                  }}
                >
                  {mode === "login" ? "Create an account" : "I already have an account"}
                </Button>
              )}
              <Button
                type="button"
                variant="subtle"
                size="xs"
                className="touch:text-sm"
                onClick={() => router.navigate({ to: "/" })}
              >
                Skip
              </Button>
            </div>
            {signupClosed && (
              <p className="mt-2 text-center text-sm text-pretty text-hint">
                New here? Ask someone on this server for an invite link, or skip to keep tasks on
                this device.
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export const Route = createLazyFileRoute("/auth")({
  component: AuthView,
});
