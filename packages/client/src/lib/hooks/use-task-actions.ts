import { ComponentProps } from "react";
import { Toast } from "@base-ui/react/toast";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortableOperation } from "@dnd-kit/react/sortable";
import { generateKeyBetween } from "fractional-indexing";
import { updateTask, updateCategory, fileShare } from "~/lib/db/hooks";
import { useOptimisticUserId } from "~/lib/auth/current-user";
import { filingMode } from "~/lib/task-permissions";
import { CATEGORY_DROP_PREFIX } from "~/lib/constants";
import type { Task, Category } from "~/lib/types";

type DragEndEvent = Parameters<
  NonNullable<ComponentProps<typeof DragDropProvider>["onDragEnd"]>
>[0];

interface Params {
  categories: Category[];
  activeCategoryId: string | null;
  activeTasks: Task[];
  getSubtasks: (parentId: string) => Task[];
}

export const useTaskActions = ({
  categories,
  activeCategoryId,
  activeTasks,
  getSubtasks,
}: Params) => {
  const userId = useOptimisticUserId();
  const toastManager = Toast.useToastManager();

  const handleReorder = (taskId: string, newIndex: number, groupTasks: Task[]) => {
    const filtered = groupTasks.filter((t) => t.id !== taskId);
    const prevOrder = newIndex > 0 ? (filtered[newIndex - 1]?.sortOrder ?? null) : null;
    const nextOrder = filtered[newIndex]?.sortOrder ?? null;
    updateTask(taskId, { sortOrder: generateKeyBetween(prevOrder, nextOrder) });
  };

  const handleReorderCategory = (catId: string, newIndex: number, cats: Category[]) => {
    const filtered = cats.filter((c) => c.id !== catId);
    const prevOrder = newIndex > 0 ? (filtered[newIndex - 1]?.sortOrder ?? null) : null;
    const nextOrder = filtered[newIndex]?.sortOrder ?? null;
    updateCategory(catId, { sortOrder: generateKeyBetween(prevOrder, nextOrder) });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.canceled) return;

    const { target } = event.operation;

    if (target && typeof target.id === "string" && target.id.startsWith(CATEGORY_DROP_PREFIX)) {
      const targetCategoryId = target.id.slice(CATEGORY_DROP_PREFIX.length);
      const taskId = String(event.operation.source?.id);
      if (targetCategoryId === activeCategoryId) return;
      const task = activeTasks.find((t) => t.id === taskId);
      if (!task) return;
      const mode = filingMode(userId, task);
      if (mode === "owner") updateTask(taskId, { categoryId: targetCategoryId });
      else if (mode === "share") fileShare(taskId, targetCategoryId);
      else toastManager.add({ title: "Only its owner can move this task." });
      return;
    }

    if (isSortableOperation(event.operation)) {
      const { source } = event.operation;
      if (!source) return;
      const targetId = String(event.operation.target?.id ?? "");
      if (source.type === "category") {
        const newIndex = categories.findIndex((c) => c.id === targetId);
        if (newIndex !== -1 && String(source.id) !== targetId) {
          handleReorderCategory(String(source.id), newIndex, categories);
        }
      } else if (source.type === "subtask") {
        // Done subtasks aren't in the list, so the drop index counts only the open ones
        const siblings = getSubtasks(String(source.group)).filter((t) => t.status !== "done");
        const newIndex = siblings.findIndex((t) => t.id === targetId);
        if (newIndex !== -1 && String(source.id) !== targetId) {
          handleReorder(String(source.id), newIndex, siblings);
        }
      } else {
        const newIndex = activeTasks.findIndex((t) => t.id === targetId);
        if (newIndex !== -1 && String(source.id) !== targetId) {
          handleReorder(String(source.id), newIndex, activeTasks);
        }
      }
    }
  };

  return { handleDragEnd };
};
