// A task's content is what someone wrote or planned; ticking it is state, not an edit
const CONTENT_FIELDS = ["title", "description", "dueDate"] as const;

type TaskChange = { status?: string } & Partial<Record<(typeof CONTENT_FIELDS)[number], unknown>>;

/**
 * The completedAt and editedAt a change to a task implies, stamped with the change's time.
 * updatedAt stays the sync clock that every change bumps, so it can't say either of these.
 */
export const taskChangeStamps = (change: TaskChange, at: string) => ({
  ...(change.status !== undefined && { completedAt: change.status === "done" ? at : null }),
  ...(CONTENT_FIELDS.some((field) => field in change) && { editedAt: at }),
});
