/**
 * Ticking or deleting a task unmounts its row, which drops keyboard focus to <body>. Before that
 * happens, hand focus to the next row's checkbox, else the previous row's, else the capture input.
 * Keyboard focus only: a tap focuses the checkbox on Android, and moving that focus to the capture
 * input would raise the on-screen keyboard.
 */
export const handOffRowFocus = (list: HTMLElement | null, taskId: string) => {
  const row = list?.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`);
  const focused = document.activeElement;
  if (!list || !row || !focused || !row.contains(focused) || !focused.matches(":focus-visible"))
    return;

  const otherCheckboxes = [...list.querySelectorAll<HTMLElement>('[data-slot="checkbox"]')].filter(
    (checkbox) => !row.contains(checkbox),
  );
  const next = otherCheckboxes.find(
    (checkbox) => row.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const target = next ?? otherCheckboxes.at(-1) ?? document.getElementById("add-task-input");
  target?.focus();
};
