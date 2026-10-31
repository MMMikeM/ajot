import { createFileRoute, redirect } from "@tanstack/react-router";
import { addShare } from "~/lib/add-share";
import { addTask } from "~/lib/db/add-task";
import { taskFromShare } from "~/lib/shared-page";
import { toastManager } from "~/lib/undo-toast";

// The router parses search values as JSON, so a number-only title arrives as a number
const asText = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : undefined;

const addFromAddress = async (search: { title?: string; text?: string; url?: string }) => {
  const task = taskFromShare(search);
  return task && addTask(task.title, null, null, task.description);
};

const addKept = async (id: string) => {
  const added = await addShare(id);
  if (added?.waitingForSignIn)
    toastManager.add({ title: "Sign in to Ajot and the shared files will be attached." });
  return added?.taskId;
};

// The manifest's share target: adds what was shared to the Inbox, then opens its sheet, where it
// can go to a list or a person. A share the worker kept comes as `id`; text alone comes in the
// address, from an install made before files could be shared or when the worker couldn't keep it.
// Replaced in history, so Back can't add it twice.
export const Route = createFileRoute("/share")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: asText(search.id),
    title: asText(search.title),
    text: asText(search.text),
    url: asText(search.url),
  }),
  beforeLoad: async ({ search }) => {
    const taskId = await (search.id ? addKept(search.id) : addFromAddress(search));
    if (!taskId) throw redirect({ to: "/", replace: true });
    throw redirect({ to: "/task/$taskId", params: { taskId }, replace: true });
  },
});
