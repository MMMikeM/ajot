import { useCategories } from "~/lib/db/hooks";
import { categoriesById } from "~/lib/task-holders";

export const useCategoriesById = () => {
  const { data: categories = [] } = useCategories();
  return categoriesById(categories);
};
