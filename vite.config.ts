import { defineConfig } from "vite-plus";

// Lint and fmt apply to every package from here: package configs can't override them.

const manualMemoHooks = {
  name: "react",
  importNames: ["useMemo", "useCallback"],
  message: "React Compiler memoizes values inside components. Remove manual useMemo/useCallback.",
};

const directApi = {
  name: "~/lib/api",
  message:
    "Import from ~/lib/actions or ~/lib/db/hooks instead. Direct API calls belong in ~/lib/actions.ts.",
};

const rawInputs = [
  {
    name: "~/components/ui/input",
    message:
      "Use Input from ~/components/ui/field (underline style). ui/input is the raw shadcn primitive — only ui/field.tsx should import it directly.",
  },
  {
    name: "~/components/ui/textarea",
    message:
      "Use Textarea from ~/components/ui/field (underline style). ui/textarea is the raw shadcn primitive — only ui/field.tsx should import it directly.",
  },
];

const playwrightTest = {
  name: "@playwright/test",
  importNames: ["test"],
  message:
    "Import test from ./fixtures: its pages fail the test on a Content Security Policy violation, which a report-only policy only logs.",
};

const rawFetch = {
  name: "fetch",
  message:
    "Call the server through apiClient (~/lib/api-client), or a page's client (~/lib/api): their routes are typed from the server, so a wrong path or body fails to compile. The bucket's presigned URLs go through ~/lib/files/bucket.ts, and a page's image through ~/lib/files/remote-image.ts.",
};

// A class ending in a bracket is an arbitrary value or property; variants end in a colon. Values
// with a function or a list in them (calc, env, max, transition lists) and viewport units have no
// scale equivalent, so they stay allowed
const arbitraryValues = {
  pattern: "\\[(?![^\\[\\]]*[(,])(?![\\d.]+d?v[hw]\\])[^\\[\\]]*\\]!?$",
  message: "Arbitrary value: use a theme token or a scale value instead.",
};

// An override's options for a rule replace the ones before it rather than adding to them, so each
// override below lists every ban that applies to its files
export default defineConfig({
  lint: {
    options: { typeAware: true, typeCheck: true },
    plugins: ["eslint", "typescript", "unicorn", "oxc", "react", "import", "jsx-a11y"],
    jsPlugins: ["eslint-plugin-better-tailwindcss"],
    settings: {
      "better-tailwindcss": { cwd: "packages/client", entryPoint: "src/app.css" },
    },
    categories: { correctness: "error" },
    // .claude/skills/impeccable is vendored (managed by `npx impeccable update`)
    ignorePatterns: ["src/routeTree.gen.ts", ".worktrees/**", ".claude/skills/impeccable/**"],
    rules: {
      // React Compiler manages dependency tracking — this rule is redundant and produces false positives
      "react-hooks/exhaustive-deps": ["off"],
      "@typescript-eslint/no-explicit-any": ["error"],
      "no-unused-vars": ["error"],
      "no-unsafe-optional-chaining": ["error"],
      // Collections are exported with `!` but are null in the SSR build target, where
      // useLiveQuery returns `data: undefined`. The `data = []` defaults are load-bearing.
      "typescript/no-useless-default-assignment": ["off"],
      "typescript/no-restricted-imports": ["error", { paths: [manualMemoHooks] }],
      "better-tailwindcss/no-unknown-classes": ["error"],
      "better-tailwindcss/no-conflicting-classes": ["error"],
      "better-tailwindcss/no-duplicate-classes": ["error"],
      "better-tailwindcss/no-deprecated-classes": ["error"],
      "better-tailwindcss/no-restricted-classes": ["error", { restrict: [arbitraryValues] }],
    },
    overrides: [
      {
        files: ["packages/client/src/**"],
        rules: {
          "no-restricted-globals": ["error", rawFetch],
          "no-restricted-properties": [
            "error",
            ...["globalThis", "self", "window"].map((object) => ({
              object,
              property: "fetch",
              message: rawFetch.message,
            })),
          ],
        },
      },
      // The typed clients' own requests, and the bucket's, which isn't one of the server's routes
      {
        files: [
          "packages/client/src/lib/api-client.ts",
          "packages/client/src/lib/api.ts",
          "packages/client/src/lib/files/bucket.ts",
          "packages/client/src/lib/files/remote-image.ts",
        ],
        rules: { "no-restricted-globals": ["off"], "no-restricted-properties": ["off"] },
      },
      // shadcn writes arbitrary values into the primitives, and a regenerate brings them back
      {
        files: ["packages/client/src/components/ui/**"],
        rules: { "better-tailwindcss/no-restricted-classes": ["off"] },
      },
      {
        files: ["packages/client/src/routes/**", "packages/client/src/components/**"],
        rules: {
          "typescript/no-restricted-imports": ["error", { paths: [manualMemoHooks, directApi] }],
        },
      },
      {
        files: ["packages/server/src/routes/**", "packages/server/src/*.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["../db/client", "./db/client"],
                  message:
                    "Do not import the db instance directly. Use a repo from packages/server/src/db/ instead.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["packages/e2e/*.spec.ts"],
        rules: {
          "typescript/no-restricted-imports": [
            "error",
            { paths: [manualMemoHooks, playwrightTest] },
          ],
        },
      },
      // `[!u]*` leaves out components/ui, where field.tsx wraps the raw primitives
      {
        files: [
          "packages/client/src/routes/**",
          "packages/client/src/components/[!u]*/**",
          "packages/client/src/components/[!u]*.tsx",
        ],
        rules: {
          "typescript/no-restricted-imports": [
            "error",
            { paths: [manualMemoHooks, directApi, ...rawInputs] },
          ],
        },
      },
    ],
  },
  fmt: {
    // Vendored Impeccable skill + subagents (managed by `npx impeccable update`)
    ignorePatterns: [
      "src/routeTree.gen.ts",
      ".claude/skills/impeccable/**",
      ".claude/agents/impeccable-*.md",
      // drizzle-kit writes these, and reads the latest back on the next generate
      "packages/server/drizzle/**/snapshot.json",
    ],
    sortTailwindcss: {
      stylesheet: "./packages/client/src/app.css",
      functions: ["cn", "cx", "tv"],
    },
  },
});
