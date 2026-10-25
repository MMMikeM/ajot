import { createFileRoute, redirect } from "@tanstack/react-router";
import { setActiveCategoryId } from "~/lib/state/active-category";

// The open list is remembered on the device rather than kept in the URL, so a link to one
// switches to it and lands on the list page
export const Route = createFileRoute("/list/$listId")({
  beforeLoad: ({ params }) => {
    setActiveCategoryId(params.listId);
    throw redirect({ to: "/", replace: true });
  },
});
