import { createFileRoute, redirect } from "@tanstack/react-router";
import { addTask } from "~/lib/db/add-task";
import { taskFromShare } from "~/lib/shared-page";

// The router parses search values as JSON, so a number-only title arrives as a number
const asText = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : undefined;

// The manifest's share target: adds what was shared to the Inbox, then opens its sheet, where it
// can go to a list or a person. Replaced in history, so Back can't add it twice.
export const Route = createFileRoute("/share")({
  validateSearch: (search: Record<string, unknown>) => ({
    title: asText(search.title),
    text: asText(search.text),
    url: asText(search.url),
  }),
  beforeLoad: async ({ search }) => {
    const task = taskFromShare(search);
    if (!task) throw redirect({ to: "/", replace: true });
    const taskId = await addTask(task.title, null, null, task.description);
    throw redirect({ to: "/task/$taskId", params: { taskId }, replace: true });
  },
});
