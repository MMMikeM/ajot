import { lazy, Suspense, useEffect, useState } from "react";
import { useIsDesk } from "~/lib/hooks/use-is-desk";
import { useNavContext } from "~/lib/state/nav-context";
import { CategorySidebar } from "./CategorySidebar";

// Only needed where the sidebar doesn't fit, so desktop never loads it
const loadMobileSheet = () => import("./CategoryMobileSheet");
const CategoryMobileSheet = lazy(loadMobileSheet);

export function CategoryNav() {
  const isDesk = useIsDesk();
  const { navOpen, setNavOpen } = useNavContext();
  // Mounted from the first open on, so later closes still animate. Mounted any earlier, a load that
  // failed offline would replace the whole list with an error; lazy() renders the failure.
  const [sheetMounted, setSheetMounted] = useState(false);
  if (navOpen && !sheetMounted) setSheetMounted(true);

  // Otherwise a sheet left open while widening reopens on narrowing
  useEffect(() => {
    if (isDesk) setNavOpen(false);
  }, [isDesk, setNavOpen]);

  // Fetched ahead so the first open doesn't wait; if this fails offline, the open loads it again
  useEffect(() => {
    if (!isDesk) loadMobileSheet().catch(() => {});
  }, [isDesk]);

  if (!isDesk)
    return (
      sheetMounted && (
        <Suspense>
          <CategoryMobileSheet />
        </Suspense>
      )
    );
  return <CategorySidebar />;
}
