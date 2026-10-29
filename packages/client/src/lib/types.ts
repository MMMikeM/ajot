import type { TaskWithRelations } from "@newtab-todo/server/db/task.repo";
import type { CategoryWithOwner } from "@newtab-todo/server/db/category.repo";
import type { NoteSelect } from "@newtab-todo/server/db/note.repo";
import type { ContactWithUser } from "@newtab-todo/server/db/contact.repo";
import type { Attachment as AttachmentRow } from "@newtab-todo/server/db/attachment.repo";

// Only the list reads join the owner: a row this device made, a create's reply and a live insert
// carry none, and a signed-out device has no name to give one
type OwnerIfListed<Row extends { user: unknown }> = Omit<Row, "user"> & {
  user?: Row["user"] | null;
};

export type Task = OwnerIfListed<TaskWithRelations>;
export type Category = OwnerIfListed<CategoryWithOwner>;
export type Note = NoteSelect;
export type Contact = ContactWithUser;
export type Attachment = AttachmentRow;
