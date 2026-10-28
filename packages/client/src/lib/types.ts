import type { TaskWithRelations } from "@newtab-todo/server/db/task.repo";
import type { CategoryWithOwner } from "@newtab-todo/server/db/category.repo";
import type { NoteSelect } from "@newtab-todo/server/db/note.repo";
import type { ContactWithUser } from "@newtab-todo/server/db/contact.repo";

// A task or list this device made has no owner object until the server's copy replaces it, and a
// signed-out device has no name to give it
type OwnerUntilSaved<Row extends { user: unknown }> = Omit<Row, "user"> & {
  user: Row["user"] | null;
};

export type Task = OwnerUntilSaved<TaskWithRelations>;
export type Category = OwnerUntilSaved<CategoryWithOwner>;
export type Note = NoteSelect;
export type Contact = ContactWithUser;
