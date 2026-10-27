import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { createLazyFileRoute, useRouter } from "@tanstack/react-router";
import { acceptInvite } from "~/lib/actions";
import { useAuthToken } from "~/lib/auth/token";
import { useInviterName } from "~/lib/hooks/use-inviter-name";
import { Button } from "~/components/ui/button";

export const Route = createLazyFileRoute("/invite/$token")({
  component: InviteAcceptPage,
});

export function InviteAcceptPage() {
  const { token } = Route.useParams();
  const router = useRouter();
  const authToken = useAuthToken();
  const inviterName = useInviterName(authToken ? token : null);
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!authToken) {
      sessionStorage.setItem("pending-invite", token);
      void router.navigate({ to: "/auth" });
    }
  }, [authToken, token, router]);

  const accept = async () => {
    setIsPending(true);
    setErrorMsg(null);
    try {
      await acceptInvite(token);
      setIsSuccess(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Couldn't accept the invite. Try again.");
    } finally {
      setIsPending(false);
    }
  };

  if (!authToken) return null;

  return (
    <div className="flex flex-col items-center justify-start pt-[20vh] pb-16 touch:flex-1 touch:overflow-y-auto touch:pt-[12vh] touch:pb-10">
      <div className="flex w-full max-w-xs flex-col gap-8 touch:max-w-none">
        <h2 className="font-display text-3xl text-balance text-foreground">
          {isSuccess
            ? inviterName
              ? `You're connected with ${inviterName}.`
              : "You're connected."
            : inviterName
              ? `${inviterName} invited you to share tasks and lists.`
              : "You're invited to share tasks and lists."}
        </h2>
        {isSuccess ? (
          <Button className="w-full" onClick={() => router.navigate({ to: "/people" })}>
            Go to People
            <ArrowRight data-icon="inline-end" />
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            {errorMsg && (
              <div
                role="alert"
                className="mb-1 rounded-md border border-destructive bg-destructive-subtle px-3 py-2 text-sm text-destructive"
              >
                {errorMsg}
              </div>
            )}
            <Button className="w-full" onClick={accept} disabled={isPending}>
              {isPending ? "Accepting…" : "Accept invite"}
            </Button>
            <Button
              variant="subtle"
              size="xs"
              className="self-center touch:text-sm"
              onClick={() => router.navigate({ to: "/" })}
            >
              Not now
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
