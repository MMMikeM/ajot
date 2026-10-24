import { useRef } from "react";
import { flushSync } from "react-dom";
import { useTasks, useNotes, updateTask, deleteTask } from "~/lib/db/hooks";
import { addTask } from "~/lib/db/add-task";
import { useUndoToast } from "~/lib/hooks/use-undo-toast";
import type { Task } from "~/lib/types";

export const useTaskActions = () => {
  const { data: allTasks } = useTasks();
  // Keeps notes loaded: deleting a task unlinks its notes, and Undo links them back
  useNotes();
  const pushUndoToast = useUndoToast();
  const undoIdRef = useRef<string | undefined>(undefined);

  const pushUndo = (message: string, onUndo: () => void) => {
    undoIdRef.current = pushUndoToast(message, onUndo);
  };

  const handleToggle = (task: Task) => {
    const newStatus = task.status === "done" ? "todo" : "done";
    updateTask(task.id, { status: newStatus });

    if (newStatus === "done") {
      const incomplete = (allTasks ?? []).filter(
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
    (allTasks ?? [])
      .filter((t) => t.parentId === taskId)
      .sort((a, b) => (a.sortOrder ?? "").localeCompare(b.sortOrder ?? ""));

  const handleClearDone = (tasks: Task[]) => {
    const undos = tasks.map((t) => deleteTask(t.id));
    pushUndo(`Cleared ${tasks.length} done ${tasks.length === 1 ? "task" : "tasks"}`, () => {
      for (const undo of undos) undo();
    });
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
