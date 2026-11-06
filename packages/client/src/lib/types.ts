import type { TaskWithRelations } from "@newtab-todo/server/db/task.repo";
import type { CategoryWithCollaborators } from "@newtab-todo/server/db/category.repo";
import type { NoteSelect } from "@newtab-todo/server/db/note.repo";
import type { ContactWithUser } from "@newtab-todo/server/db/contact.repo";
import type { Attachment as AttachmentRow } from "@newtab-todo/server/db/attachment.repo";

export type Task = TaskWithRelations;
export type Category = CategoryWithCollaborators;
export type Note = NoteSelect;
export type Contact = ContactWithUser;
export type Attachment = AttachmentRow;
