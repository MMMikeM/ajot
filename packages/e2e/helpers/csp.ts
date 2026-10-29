import { expect, type BrowserContext } from "@playwright/test";

declare global {
  interface Window {
    __cspViolation: (violation: string) => void;
  }
}

/**
 * Collects the context's CSP violations, which a report-only policy only logs, and returns the
 * check that fails the test on any.
 */
export const watchCsp = async (context: BrowserContext) => {
  const violations: string[] = [];
  await context.exposeBinding("__cspViolation", (_, violation: string) => {
    violations.push(violation);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__cspViolation(
        `${e.violatedDirective} blocked ${e.blockedURI || "inline"} at ${e.sourceFile}:${e.lineNumber}`,
      ),
    );
  });
  return () => expect(violations, "Content Security Policy violations").toEqual([]);
};
