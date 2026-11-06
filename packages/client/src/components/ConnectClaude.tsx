import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { MCP_TOKEN_DAYS } from "@newtab-todo/shared/constants";
import { fetchMcpTokens, makeMcpToken, revokeMcpToken, type McpToken } from "~/lib/actions";
import { getServerUrl } from "~/lib/server-url";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { CheckRow } from "~/components/CheckRow";
import { Input } from "~/components/ui/field";
import { ListRow } from "~/components/ui/list-row";
import { RevealButton, RevealGroup } from "~/components/ui/reveal-button";
import { SectionLabel } from "~/components/ui/section-label";
import { TextStack } from "~/components/ui/text-stack";
import { TogglePill } from "~/components/ui/toggle-pill";

const TOKENS_KEY = ["mcp-tokens"] as const;

type Days = (typeof MCP_TOKEN_DAYS)[number];
const DAYS_LABEL: Record<Days, string> = { 30: "30 days", 90: "90 days", 365: "1 year" };

const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

type Token = McpToken;

const describe = (token: Token) =>
  [
    token.canWrite ? "Reads and adds" : "Read only",
    `…${token.hint}`,
    token.lastUsedAt ? `used ${day.format(new Date(token.lastUsedAt))}` : "never used",
    `until ${day.format(new Date(token.expiresAt))}`,
  ].join(" · ");

/** Personal access tokens for Ajot's MCP server, one per computer Claude Code runs on. */
export function ConnectClaude() {
  const queryClient = useQueryClient();
  const tokens = useQuery({ queryKey: TOKENS_KEY, queryFn: fetchMcpTokens });
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<{ name: string; token: string } | null>(null);
  const [revoking, setRevoking] = useState<Token | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const revoke = async (token: Token) => {
    try {
      await revokeMcpToken(token.id);
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : "Couldn't revoke it. Try again.");
      return;
    }
    setRevoking(null);
    setRevokeError(null);
    await queryClient.invalidateQueries({ queryKey: TOKENS_KEY });
  };

  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>Connect Claude</SectionLabel>
      <p className="text-sm text-pretty text-hint">
        Claude Code can read your lists and add to them. Make a token for each computer it runs on.
      </p>

      {made && <NewToken {...made} onDone={() => setMade(null)} />}

      {tokens.isError && <p className="text-sm text-hint">{tokens.error.message}</p>}
      <div className="-mx-2 flex flex-col gap-1 empty:hidden">
        {(tokens.data ?? []).map((token) => (
          <ListRow key={token.id}>
            <TextStack title={token.name} subtitle={describe(token)} />
            <RevealGroup>
              <RevealButton onClick={() => setRevoking(token)}>Revoke</RevealButton>
            </RevealGroup>
          </ListRow>
        ))}
      </div>

      {making ? (
        <MakeToken
          onCancel={() => setMaking(false)}
          onMade={async (name, token) => {
            setMaking(false);
            setMade({ name, token });
            await queryClient.invalidateQueries({ queryKey: TOKENS_KEY });
          }}
        />
      ) : (
        !made && (
          <Button
            variant="subtle"
            size="xs"
            bleed="start"
            className="self-start"
            onClick={() => setMaking(true)}
          >
            Make a token
          </Button>
        )
      )}

      <AlertDialog
        open={!!revoking}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revoke <span dir="auto">“{revoking?.name}”</span>?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Claude Code on that computer stops reaching your lists. This can't be undone; make a
              new token to connect it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {revokeError && <p className="text-sm text-destructive">{revokeError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="ghost"
              intent="destructive"
              onClick={() => revoking && void revoke(revoking)}
            >
              Revoke
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

const MakeToken = ({
  onMade,
  onCancel,
}: {
  onMade: (name: string, token: string) => void;
  onCancel: () => void;
}) => {
  const [name, setName] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [days, setDays] = useState<Days>(365);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const made = await makeMcpToken({ name, canWrite: !readOnly, days });
      onMade(made.name, made.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make it. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      <Input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the form opens from the button the user just pressed
        autoFocus
        aria-label="Token name"
        placeholder="Name, such as Work laptop"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="-mx-2">
        <CheckRow
          label="Read only"
          detail="Claude can read your lists but not add to them or tick anything."
          checked={readOnly}
          disabled={false}
          onCheckedChange={setReadOnly}
        />
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-xs text-hint">Lasts</legend>
        <div className="flex gap-1">
          {MCP_TOKEN_DAYS.map((d) => (
            <TogglePill
              key={d}
              selected={days === d}
              aria-pressed={days === d}
              onClick={() => setDays(d)}
            >
              {DAYS_LABEL[d]}
            </TogglePill>
          ))}
        </div>
      </fieldset>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={sending || !name.trim()}>
          Make token
        </Button>
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

const NewToken = ({ name, token, onDone }: { name: string; token: string; onDone: () => void }) => {
  const serverUrl = getServerUrl() || location.origin;
  const exportLine = `export AJOT_TOKEN=${token}`;
  const addCommand = `claude mcp add -s user --transport http ajot ${serverUrl}/mcp --header 'Authorization: Bearer \${AJOT_TOKEN}'`;
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted p-3">
      <p className="text-sm text-foreground">
        <span dir="auto">“{name}”</span> is ready. Copy it now: Ajot won't show it again.
      </p>
      <Step label="Put this in your shell profile, such as ~/.zshrc:" text={exportLine} />
      <Step label="Then run this once:" text={addCommand} />
      <Button size="sm" className="self-start" onClick={onDone}>
        Done
      </Button>
    </div>
  );
};

const Step = ({ label, text }: { label: string; text: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-hint">{label}</p>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 rounded-md bg-background px-2 py-1.5 font-mono text-xs wrap-anywhere text-foreground select-all">
          {text}
        </code>
        <Button
          variant="subtle"
          size="xs"
          icon
          aria-label={copied ? "Copied" : "Copy"}
          title={copied ? "Copied" : "Copy"}
          onClick={() => void copy()}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
};
