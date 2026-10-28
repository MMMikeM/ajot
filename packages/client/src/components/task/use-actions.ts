import { flushSync } from "react-dom";
import { compareSortOrder } from "@newtab-todo/shared/sort-order";
import { updateTask, deleteTask, deleteTasks } from "~/lib/db/hooks";
import { tasksCollection } from "~/lib/db/collections";
import { addTask } from "~/lib/db/add-task";
import { pushUndoToast as pushUndo } from "~/lib/undo-toast";
import type { Task } from "~/lib/types";

// Read when an action runs, not subscribed to: handlers that close over the list change on every
// edit, and every row they're passed to renders again
const currentTasks = () => [...(tasksCollection.state?.values() ?? [])];

export const useTaskActions = () => {
  const handleToggle = (task: Task) => {
    const newStatus = task.status === "done" ? "todo" : "done";
    updateTask(task.id, { status: newStatus });

    if (newStatus === "done") {
      const incomplete = currentTasks().filter(
        (t) => t.parentId === task.id && t.status !== "done",
      );
      for (const sub of incomplete) updateTask(sub.id, { status: "done" });
      pushUndo("Marked done", () => {
        updateTask(task.id, { status: "todo" });
        for (const sub of incomplete) updateTask(sub.id, { status: "todo" });
      });
    } else {
      pushUndo("Marked incomplete", () => updateTask(task.id, { status: "done" }));
    }
  };

  const handleDelete = (task: Task) => {
    const originEl = document.querySelector<HTMLElement>(`[data-task-id="${task.id}"]`);

    // document.startViewTransition not referenced at module level — SSR-safe
    if (originEl && typeof document.startViewTransition === "function") {
      originEl.style.viewTransitionName = "undo-morph";
      const vt = document.startViewTransition(() => {
        flushSync(() => {
          pushUndo("Task deleted", deleteTask(task.id));
        });
        const toastEl = document.querySelector<HTMLElement>("[data-toast-undo]");
        if (toastEl) toastEl.style.viewTransitionName = "undo-morph";
      });
      void vt.finished.then(() => {
        const toastEl = document.querySelector<HTMLElement>("[data-toast-undo]");
        if (toastEl) toastEl.style.viewTransitionName = "";
      });
    } else {
      pushUndo("Task deleted", deleteTask(task.id));
    }
  };

  const handleSetDueDate = (task: Task, date: string | null) =>
    updateTask(task.id, { dueDate: date });

  const handleAddSubtask = (task: Task, title: string) => addTask(title, null, task.id);

  const getSubtasks = (taskId: string): Task[] =>
    currentTasks()
      .filter((t) => t.parentId === taskId)
      .sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder));

  const handleClearDone = (tasks: Task[]) => {
    const undo = deleteTasks(tasks.map((t) => t.id));
    pushUndo(`Cleared ${tasks.length} done ${tasks.length === 1 ? "task" : "tasks"}`, undo);
  };

  return {
    handleToggle,
    handleDelete,
    handleSetDueDate,
    handleAddSubtask,
    getSubtasks,
    handleClearDone,
  };
};
