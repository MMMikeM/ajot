import { useEffect, useState } from "react";
import { createLazyFileRoute, useRouter } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { z } from "zod/mini";
import { setAuthToken } from "~/lib/auth/token";
import { setCurrentUser } from "~/lib/auth/current-user";
import { authenticate } from "~/lib/actions";
import { Button } from "~/components/ui/button";
import { FormField } from "~/components/ui/field";
import { Input } from "~/components/ui/field";
import { getBuildTarget } from "~/lib/build-target";
import { ext } from "~/lib/ext";
import { TOKEN_KEY, MSG_TOKEN_CHANGED } from "~/lib/constants";
import { getServerUrl, setServerUrl } from "~/lib/server-url";
import { fetchServerConfig, normalizeServerUrl, type ServerConfig } from "~/lib/server-config";

const loginSchema = z.object({
  username: z.string().check(z.minLength(1, "Username is required")),
  password: z.string().check(z.minLength(1, "Password is required")),
});

const signupSchema = z.object({
  username: z.string().check(z.minLength(3, "Username must be at least 3 characters")),
  password: z.string().check(z.minLength(8, "Password must be at least 8 characters")),
  name: z.string().check(z.minLength(1, "Name is required")),
});

const persistToken = (token: string) => {
  setAuthToken(token);
  if (getBuildTarget() === "extension") {
    ext.storage.local
      .set({ [TOKEN_KEY]: token })
      .then(() => ext.runtime.sendMessage({ type: MSG_TOKEN_CHANGED }).catch(() => {}))
      .catch(console.error);
  }
};

const serverSchema = z.string().check(z.minLength(1, "Server address is required"));

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

/** Points the extension at the server typed in, once it has answered as one of these servers. */
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
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [serverError, setServerError] = useState<string | null>(null);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [pendingInvite] = useState(readPendingInvite);

  useEffect(() => {
    if (choosesServer && !getServerUrl()) return;
    fetchServerConfig(getServerUrl()).then(setConfig).catch(console.error);
  }, []);

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
        if (choosesServer) setConfig(await connectToServer(value.server));
        result = await authenticate(mode, {
          username: value.username.trim(),
          password: value.password,
          name: value.name.trim(),
          ...(mode === "signup" && pendingInvite && { invite: pendingInvite }),
        });
      } catch (err) {
        setServerError(err instanceof Error ? err.message : "Authentication failed");
        return;
      }
      persistToken(result.token);
      setCurrentUser({ id: result.userId, name: result.name, username: result.username });
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

  return (
    <div className="flex flex-col items-center justify-start pt-[20vh] pb-16 touch:flex-1 touch:overflow-y-auto touch:pt-[12vh] touch:pb-10">
      <div className="w-full max-w-xs">
        <h2 className="mb-8 font-display text-[1.75rem] leading-tight text-balance text-foreground">
          {mode === "login"
            ? "Sign in to sync across devices"
            : config?.awaitingFirstUser
              ? "Create the server's first account"
              : "Create your account"}
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
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
                    autoComplete="name"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
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
                  // eslint-disable-next-line jsx-a11y/no-autofocus
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
            <Button
              type="submit"
              variant="ghost"
              className="w-full bg-primary-subtle text-primary hover:bg-primary-selected hover:text-primary touch:h-11"
              disabled={form.state.isSubmitting}
            >
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
                  className="touch:h-10 touch:text-sm"
                  onClick={() => {
                    setMode(mode === "login" ? "signup" : "login");
                    form.reset();
                    setServerError(null);
                  }}
                >
                  {mode === "login" ? "Create an account" : "Already have an account?"}
                </Button>
              )}
              <Button
                type="button"
                variant="subtle"
                size="xs"
                className="touch:h-10 touch:text-sm"
                onClick={() => router.navigate({ to: "/" })}
              >
                Skip
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export const Route = createLazyFileRoute("/auth")({
  component: AuthView,
});
