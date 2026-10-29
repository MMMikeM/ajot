import { flushSync } from "react-dom";
import { compareSortOrder } from "@newtab-todo/shared/sort-order";
import { updateTask, deleteTask } from "~/lib/db/hooks";
import { tasksCollection } from "~/lib/db/collections";
import { addTask } from "~/lib/db/add-task";
import { pushUndoToast as pushUndo, quoted } from "~/lib/undo-toast";
import type { Task } from "~/lib/types";

// Read when an action runs, not subscribed to: handlers that close over the list change on every
// edit, and every row they're passed to renders again
const currentTasks = () => [...(tasksCollection.state?.values() ?? [])];

const supportsViewTransitions = () => typeof document.startViewTransition === "function";

export const useTaskActions = () => {
  const handleToggle = (task: Task) => {
    const newStatus = task.status === "done" ? "todo" : "done";
    updateTask(task.id, { status: newStatus });

    if (newStatus === "done") {
      const incomplete = currentTasks().filter(
        (t) => t.parentId === task.id && t.status !== "done",
      );
      for (const sub of incomplete) updateTask(sub.id, { status: "done" });
      pushUndo(quoted(task.title, " done"), () => {
        updateTask(task.id, { status: "todo" });
        for (const sub of incomplete) updateTask(sub.id, { status: "todo" });
      });
    } else {
      pushUndo(quoted(task.title, " not done"), () => updateTask(task.id, { status: "done" }));
    }
  };

  const handleDelete = (task: Task) => {
    const originEl = document.querySelector<HTMLElement>(`[data-task-id="${task.id}"]`);

    if (originEl && supportsViewTransitions()) {
      originEl.style.viewTransitionName = "undo-morph";
      const vt = document.startViewTransition(() => {
        flushSync(() => {
          pushUndo(quoted(task.title, " deleted"), deleteTask(task.id));
        });
        const toastEl = document.querySelector<HTMLElement>("[data-toast-undo]");
        if (toastEl) toastEl.style.viewTransitionName = "undo-morph";
      });
      void vt.finished.then(() => {
        const toastEl = document.querySelector<HTMLElement>("[data-toast-undo]");
        if (toastEl) toastEl.style.viewTransitionName = "";
      });
    } else {
      pushUndo(quoted(task.title, " deleted"), deleteTask(task.id));
    }
  };

  const handleSetDueDate = (task: Task, date: string | null) =>
    updateTask(task.id, { dueDate: date });

  const handleAddSubtask = (task: Task, title: string) => addTask(title, null, task.id);

  const getSubtasks = (taskId: string): Task[] =>
    currentTasks()
      .filter((t) => t.parentId === taskId)
      .sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder));

  return {
    handleToggle,
    handleDelete,
    handleSetDueDate,
    handleAddSubtask,
    getSubtasks,
  };
};
