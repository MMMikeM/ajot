import { defineConfig } from "vite-plus";

// Lint and fmt apply to every package from here: package configs can't override them.
// The app build config is packages/client/vite.config.ts.

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

// An override's options for a rule replace the ones before it rather than adding to them, so each
// override below lists every ban that applies to its files
export default defineConfig({
  lint: {
    options: { typeAware: true, typeCheck: true },
    plugins: ["eslint", "typescript", "unicorn", "oxc", "react", "import", "jsx-a11y"],
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
    },
    overrides: [
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
    ],
    sortTailwindcss: {
      stylesheet: "./packages/client/src/app.css",
      functions: ["cn", "cx", "tv"],
    },
  },
});
