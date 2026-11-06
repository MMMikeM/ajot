import { useCurrentUser } from "~/lib/auth/current-user";
import { useCategories, useContacts } from "~/lib/db/hooks";
import { peopleFrom } from "~/lib/people";

export const usePeople = () => {
  const me = useCurrentUser();
  const { data: contacts = [] } = useContacts();
  const { data: lists = [] } = useCategories();
  return peopleFrom(me, contacts, lists);
};
