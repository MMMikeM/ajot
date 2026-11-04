import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { SquareArrowOutUpRight } from "lucide-react";
import { MAX_TEXT, MAX_TITLE } from "@newtab-todo/shared/field-limits";
import { Button } from "~/components/ui/button";
import { ColorDot } from "~/components/ui/color-dot";
import { Textarea } from "~/components/ui/field";
import { InitialsAvatar } from "~/components/ui/initials-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger } from "~/components/ui/select";
import { autoGrow } from "~/lib/auto-grow";
import { INBOX_COLOR } from "~/lib/constants";
import { ext, getStoredSession } from "~/lib/ext";
import { MSG_POPUP_ADD, type PopupAdd, type PopupReply } from "~/lib/popup-message";
import { titleWithoutSite } from "~/lib/page-title";
import type { ShareDestination } from "~/lib/share-store";
import { OWNER_KEY, openSnapshotDb, readSnapshot } from "~/lib/snapshot-store";
import type { Category, Contact } from "~/lib/types";

type Choice = {
  value: string;
  to: ShareDestination;
  label: string;
  /** What the page's toast says once it's in. */
  done: string;
  group?: "share" | "send";
  dot?: string;
  person?: { id: string; name: string };
};

const INBOX: Choice = {
  value: "inbox",
  to: { kind: "inbox" },
  label: "Inbox",
  done: "Added to Inbox",
  dot: INBOX_COLOR,
};

const LAST_CHOICE_KEY = "ajot-popup-destination";

const readLastChoice = () => {
  try {
    return localStorage.getItem(LAST_CHOICE_KEY);
  } catch {
    return null;
  }
};

const keepLastChoice = (value: string) => {
  try {
    localStorage.setItem(LAST_CHOICE_KEY, value);
  } catch {
    // Remembering it is a convenience; the add goes ahead without it
  }
};

/** Where a page can go: the lists and people the background last saved for this account. */
const loadChoices = async (userId: string | null): Promise<Choice[]> => {
  const db = await openSnapshotDb();
  try {
    const saved = await readSnapshot(db, [OWNER_KEY, "categories", "contacts"]);
    if (!userId || saved.get(OWNER_KEY) !== userId) return [INBOX];
    const lists = (saved.get("categories") as Category[] | undefined) ?? [];
    const people = ((saved.get("contacts") as Contact[] | undefined) ?? []).map(
      (contact) => contact.contactUser,
    );
    return [
      INBOX,
      ...lists.map((list) => ({
        value: `list:${list.id}`,
        to: { kind: "list", categoryId: list.id } as const,
        label: list.name,
        done: `Added to ${list.name}`,
        dot: list.color ?? undefined,
      })),
      ...people.map((person) => ({
        value: `share:${person.username}`,
        to: { kind: "share", username: person.username } as const,
        label: person.name,
        done: `Added and shared with ${person.name}`,
        group: "share" as const,
        person,
      })),
      ...people.map((person) => ({
        value: `send:${person.id}`,
        to: { kind: "send", recipientId: person.id } as const,
        label: person.name,
        done: `Sent to ${person.name}`,
        group: "send" as const,
        person,
      })),
    ];
  } finally {
    db.close();
  }
};

type ActiveTab = { id: number | undefined; title: string; url: string };

const activeTab = async (): Promise<ActiveTab> => {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return { id: tab?.id, title: tab?.title ?? "", url: tab?.url ?? "" };
};

const GROUP_LABELS = { share: "Share with", send: "Send to" } as const;

const ChoiceFace = ({ choice }: { choice: Choice }) =>
  choice.person ? (
    <InitialsAvatar name={choice.person.name} userId={choice.person.id} />
  ) : (
    <ColorDot color={choice.dot} />
  );

const triggerLabel = (choice: Choice) =>
  choice.group ? `${GROUP_LABELS[choice.group]} ${choice.label}` : choice.label;

const submitLabel = (choice: Choice) => {
  if (choice.to.kind === "share") return "Add and share";
  if (choice.to.kind === "send") return "Send";
  return "Add";
};

const WherePicker = ({
  choices,
  choice,
  onChoose,
}: {
  choices: Choice[];
  choice: Choice;
  onChoose: (choice: Choice) => void;
}) => (
  <Select
    value={choice.value}
    onValueChange={(value) => {
      const chosen = choices.find((c) => c.value === value);
      if (chosen) onChoose(chosen);
    }}
    items={choices.map((c) => ({ value: c.value, label: triggerLabel(c) }))}
  >
    <SelectTrigger
      variant="underline"
      aria-label="Where it goes"
      className="h-9 min-w-0 gap-2 rounded-md border-0 py-0 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:text-foreground"
    >
      <ChoiceFace choice={choice} />
      <span dir="auto" className="truncate">
        {triggerLabel(choice)}
      </span>
    </SelectTrigger>
    <SelectContent className="max-h-[min(var(--available-height),18rem)]">
      {choices.map((c, i) => (
        <div key={c.value}>
          {c.group && choices[i - 1]?.group !== c.group && (
            <p className="px-3 pt-3 pb-1 text-xs font-medium tracking-wide text-hint uppercase">
              {GROUP_LABELS[c.group]}
            </p>
          )}
          <SelectItem value={c.value}>
            <span className="flex min-w-0 items-center gap-2.5">
              <ChoiceFace choice={c} />
              <span dir="auto" className="truncate">
                {c.label}
              </span>
            </span>
          </SelectItem>
        </div>
      ))}
    </SelectContent>
  </Select>
);

const openAjot = () =>
  void ext.tabs.create({ url: ext.runtime.getURL("index.html") }).then(() => window.close());

/** The toolbar popup: the page open in this tab, as a task, to the Inbox, a list or a person. */
export function QuickAdd() {
  const [signedIn, setSignedIn] = useState<boolean>();
  const [tab, setTab] = useState<ActiveTab>();
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [choices, setChoices] = useState<Choice[]>([INBOX]);
  const [choice, setChoice] = useState<Choice>(INBOX);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    void (async () => {
      const [session, current] = await Promise.all([getStoredSession(), activeTab()]);
      setSignedIn(!!session);
      setTab(current);
      setTitle(titleWithoutSite(current.title, current.url) || current.url);
      setDetails(current.url);
      // After the title renders: the caret at its end, ready to add to it or press Enter
      requestAnimationFrame(() => {
        const field = titleRef.current;
        field?.focus();
        field?.setSelectionRange(field.value.length, field.value.length);
      });
      if (!session) return;
      const loaded = await loadChoices(session.userId).catch((err: unknown) => {
        console.error("[popup] couldn't read the saved lists:", err);
        return [INBOX];
      });
      setChoices(loaded);
      const last = readLastChoice();
      setChoice(loaded.find((c) => c.value === last) ?? INBOX);
    })();
  }, []);

  const send = async (open: boolean) => {
    const trimmed = title.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setFailed(false);
    keepLastChoice(choice.value);
    const message: PopupAdd = {
      type: MSG_POPUP_ADD,
      tabId: tab?.id,
      title: trimmed,
      description: details.trim() || null,
      to: choice.to,
      done: choice.done,
      open,
    };
    try {
      const reply = (await ext.runtime.sendMessage(message)) as PopupReply | undefined;
      if (reply?.kept) return window.close();
    } catch (err) {
      console.error("[popup] couldn't hand it to the background:", err);
    }
    setFailed(true);
    setSending(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(false);
  };

  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>, needsModifier: boolean) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (needsModifier && !event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  if (signedIn === undefined) return <main className="min-h-76 w-90" aria-busy="true" />;

  if (!signedIn)
    return (
      <main className="flex w-90 flex-col items-start gap-3 p-5">
        <p className="text-base text-foreground">Sign in to Ajot to add pages from here.</p>
        <Button onClick={openAjot}>Open Ajot</Button>
      </main>
    );

  return (
    // Tall enough for the picker: a toolbar popup is only as tall as its page, and clips what floats
    <main className="flex min-h-76 w-90 flex-col px-5 pt-3 pb-4">
      <form onSubmit={submit} className="flex flex-1 flex-col">
        <div className="-ml-0.5 flex items-center justify-between gap-3">
          <WherePicker choices={choices} choice={choice} onChoose={setChoice} />
          <span className="font-display text-xs tracking-wordmark text-hint uppercase">Ajot</span>
        </div>

        <Textarea
          ref={(field) => {
            titleRef.current = field;
            autoGrow(field);
          }}
          aria-label="Title"
          rows={1}
          maxLength={MAX_TITLE}
          enterKeyHint="done"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value.replace(/\n/g, " "));
            autoGrow(e.target);
          }}
          onKeyDown={(e) => submitOnEnter(e, false)}
          className="mt-1 max-h-30 py-2 text-lg leading-snug font-semibold md:text-lg"
        />
        <Textarea
          ref={autoGrow}
          aria-label="Details"
          rows={1}
          maxLength={MAX_TEXT}
          placeholder="Add details"
          value={details}
          onChange={(e) => {
            setDetails(e.target.value);
            autoGrow(e.target);
          }}
          onKeyDown={(e) => submitOnEnter(e, true)}
          className="max-h-36 border-transparent py-1.5 text-sm wrap-anywhere text-muted-foreground md:text-sm"
        />

        {failed && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            Ajot couldn't save it on this device. Try again.
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <Button
            type="button"
            variant="subtle"
            bleed="start"
            disabled={!title.trim() || sending}
            onClick={() => void send(true)}
          >
            <SquareArrowOutUpRight data-icon="inline-start" />
            Edit in Ajot
          </Button>
          <Button type="submit" disabled={!title.trim() || sending}>
            {submitLabel(choice)}
          </Button>
        </div>
      </form>
    </main>
  );
}
