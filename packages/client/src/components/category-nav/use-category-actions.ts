import { useState } from "react";
import { Toast } from "@base-ui/react/toast";
import { compareSortOrder } from "@newtab-todo/shared/sort-order";
import {
  useTasks,
  useCategories,
  addCategory,
  updateCategory,
  deleteCategory,
} from "~/lib/db/hooks";
import { useActiveCategoryId, setActiveCategoryId } from "~/lib/state/active-category";
import { useCurrentUserId, useOptimisticUserId } from "~/lib/auth/current-user";
import { categoriesById } from "~/lib/task-holders";
import { leaveCategory } from "~/lib/actions";
import { pushUndoToast } from "~/lib/undo-toast";
import { countOpenTasksByCategory } from "~/lib/effective-category";
import type { CategoryTaskAction } from "~/lib/constants";
import type { Category } from "~/lib/types";
import type { PendingCategoryDelete } from "./DeleteCategoryDialog";

export const useCategoryActions = () => {
  const { data: rawCategories } = useCategories();
  const { data: allTasks } = useTasks();
  const activeCategoryId = useActiveCategoryId();
  const authUserId = useCurrentUserId();
  const currentUserId = useOptimisticUserId();
  const toastManager = Toast.useToastManager();
  const [pendingDelete, setPendingDelete] = useState<PendingCategoryDelete | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const categories = rawCategories
    ? [...rawCategories].sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder))
    : [];

  const openCounts = countOpenTasksByCategory(
    allTasks ?? [],
    currentUserId,
    categoriesById(categories),
  );
  const inboxCount = openCounts.get(null) ?? 0;

  const handleAdd = (name: string) => {
    const cat = addCategory({
      name,
      userId: currentUserId,
      color: null,
      sortOrder: null,
      user: null,
    });
    setActiveCategoryId(cat.id);
  };

  const handleRename = (id: string, name: string) => updateCategory(id, { name });

  const handleSetColor = (id: string, color: string | null) => updateCategory(id, { color });

  const deleteAndMoveOn = (cat: Category, tasks: CategoryTaskAction, title: string) => {
    const wasActive = cat.id === activeCategoryId;
    const { transaction, undo } = deleteCategory(cat.id, tasks);
    const undoToastId = pushUndoToast(title, () => {
      undo().catch((err) => {
        console.error("[category] restore failed:", err);
        toastManager.add({ title: `Couldn't bring back “${cat.name}”. Try again.` });
      });
      if (wasActive) setActiveCategoryId(cat.id);
    });
    transaction.isPersisted.promise.catch(() => {
      toastManager.close(undoToastId);
      toastManager.add({ title: `Couldn't delete “${cat.name}”. Try again.` });
      if (wasActive) setActiveCategoryId(cat.id);
    });
    if (!wasActive) return;
    const remaining = categories.filter((c) => c.id !== cat.id);
    setActiveCategoryId(remaining.length > 0 ? remaining[0].id : null);
  };

  const handleDelete = (id: string) => {
    const cat = categories.find((c) => c.id === id);
    if (!cat) return;

    const categoryTasks = (allTasks ?? []).filter((t) => t.categoryId === id);
    if (categoryTasks.length > 0) {
      setPendingDelete({ category: cat, tasks: categoryTasks });
      setConfirmingDelete(true);
      return;
    }

    deleteAndMoveOn(cat, "uncategorise", "List deleted");
  };

  const confirmDelete = (tasks: CategoryTaskAction) => {
    setConfirmingDelete(false);
    if (!pendingDelete) return;
    deleteAndMoveOn(
      pendingDelete.category,
      tasks,
      tasks === "delete" ? "List and tasks deleted" : "List deleted, tasks moved to Inbox",
    );
  };

  const handleLeave = async (categoryId: string) => {
    if (!authUserId) return;
    try {
      await leaveCategory(categoryId, authUserId);
    } catch (err) {
      console.error("[leave] failed:", err);
      const name = categories.find((c) => c.id === categoryId)?.name;
      toastManager.add({
        title: name
          ? `Couldn't leave “${name}”. Try again.`
          : "Couldn't leave the list. Try again.",
      });
      return;
    }
    const remaining = categories.filter((c) => c.id !== categoryId);
    setActiveCategoryId(remaining.length > 0 ? remaining[0].id : null);
  };

  return {
    categories,
    activeCategoryId,
    currentUserId,
    inboxCount,
    openCounts,
    handleAdd,
    handleRename,
    handleSetColor,
    handleDelete,
    handleLeave,
    deleteDialog: {
      request: pendingDelete,
      open: confirmingDelete,
      onOpenChange: setConfirmingDelete,
      onConfirm: confirmDelete,
      currentUserId,
    },
  };
};
