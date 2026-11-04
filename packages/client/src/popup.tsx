import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QuickAdd } from "~/components/quick-add";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QuickAdd />
  </StrictMode>,
);
