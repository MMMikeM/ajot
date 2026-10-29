// A task's content is what someone wrote or planned; ticking it is state, not an edit
const CONTENT_FIELDS = ["title", "description", "dueDate"] as const;

type TaskChange = { status?: string } & Partial<Record<(typeof CONTENT_FIELDS)[number], unknown>>;

/** updatedAt is the sync clock that every change bumps, so it can't say completedAt or editedAt. */
export const taskChangeStamps = (change: TaskChange, at: string) => ({
  ...(change.status !== undefined && { completedAt: change.status === "done" ? at : null }),
  ...(CONTENT_FIELDS.some((field) => field in change) && { editedAt: at }),
});
