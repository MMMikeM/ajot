import { Suspense, lazy, useEffect } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useIsFetching } from "@tanstack/react-query";
import { useTasks } from "~/lib/db/hooks";

// Lazy-load: defers @base-ui/drawer, @tanstack/react-form (69KB)
// Prefetched on route load so the first open doesn't wait. Offline without a cached chunk the
// prefetch fails, so opening a task loads it again rather than replaying that failure.
const loadTaskDetail = () => import("~/components/task/detail");
const prefetchedTaskDetail = loadTaskDetail();
prefetchedTaskDetail.catch(() => {});
const TaskDetail = lazy(() => prefetchedTaskDetail.catch(loadTaskDetail));

/** An open task, sheeted over the page it was opened from: the list, or search. */
export function TaskSheet({ taskId, page }: { taskId: string; page: "/" | "/search" }) {
  const router = useRouter();
  const navigate = useNavigate();
  const { data: tasks, isLoading } = useTasks();
  // The saved lists can predate the task a notification links to, so wait for the fetch too
  const fetching = useIsFetching({ queryKey: ["tasks"] }) > 0;
  const missing = !isLoading && !fetching && !tasks?.some((t) => t.id === taskId);

  // Back to the page the sheet was opened over; a link opened in a new window has none
  const close = () => {
    if (router.history.canGoBack()) router.history.back();
    else void navigate({ to: page, replace: true });
  };

  // In place of the open sheet, so closing the parent lands on the page, not back on its subtask
  const openTask = (id: string) =>
    page === "/"
      ? navigate({ to: "/task/$taskId", params: { taskId: id }, replace: true })
      : navigate({ to: "/search/task/$taskId", params: { taskId: id }, replace: true });

  useEffect(() => {
    if (missing) void navigate({ to: page, replace: true });
  }, [missing, navigate, page]);

  return (
    <Suspense>
      <TaskDetail taskId={taskId} open onClose={close} onOpenTask={(id) => void openTask(id)} />
    </Suspense>
  );
}
