# UI Primitives

Shadcn/Base UI component primitives. Two-tier architecture:

## Tier 1 — Raw shadcn primitives (regenerate freely with CLI)

These are unmodified shadcn output. Do not add app opinions here.

| File               | Component                              | Notes                                                                                                                                                                              |
| ------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input.tsx`        | `Input`                                | Box-style, Base UI InputPrimitive                                                                                                                                                  |
| `textarea.tsx`     | `Textarea`                             | Box-style, raw `<textarea>`                                                                                                                                                        |
| `button.tsx`       | `Button`                               | —                                                                                                                                                                                  |
| `checkbox.tsx`     | `Checkbox`                             | `group-has-disabled/field` swapped for `field-disabled` after each regenerate: see the rule on `group-has-*` below                                                                 |
| `select.tsx`       | `Select`, `SelectTrigger`, …           | The popup scrolls within `--available-height`: inside a sheet its scroll box clips the popup, which cut a long list of lists off at the top. Keep it after a regenerate            |
| `drawer.tsx`       | `Drawer`, `DrawerContent`, …           | Opens a frame after mounting, so a sheet that mounts open still slides in; on touch it blurs above the sheet from half covered, on desktop at rest. Keep it all after a regenerate |
| `alert-dialog.tsx` | `AlertDialog`, `AlertDialogContent`, … | Added by hand: `shadcn add` would overwrite `button.tsx`. Only the parts in use are exported (knip); backdrop uses `bg-backdrop` like the drawer                                   |

Regenerate any of these with: `npx shadcn@latest add <name> --overwrite`

`select.tsx`'s Positioner also uses `positionMethod="fixed"`: positioned absolutely, a sheet's scroll box clipped the popup to the two rows between the trigger and the sheet's edge. Its items take `touch:min-h-11 touch:text-base`. Keep both after a regenerate.

`drawer.tsx` also ends every sheet with a Close that shows only on keyboard focus, for screen readers on a phone, which can't swipe a sheet away. Keep it after a regenerate.

## Tier 2 — App-level compositions (app opinions live here)

`field.tsx` is the single import for all text-input work in this app:

```ts
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  Input,
  Textarea,
  FormField,
} from "~/components/ui/field";
```

- **`Input`** / **`Textarea`** — app-styled underline variants, composed on top of the raw shadcn primitives. Use these everywhere.
- **`Field`** / **`FieldLabel`** / **`FieldError`** / **`FieldDescription`** — Base UI field wrappers for accessible label association.
- **`FormField`** — TanStack Form integration: wraps Field + FieldLabel + FieldError, wired to a `field` from `useForm`.

## Rules

### Never import raw `Input` or `Textarea` from their primitive files

```ts
// ❌ Wrong — box style, no app language
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";

// ✅ Correct — underline style, app-styled
import { Input, Textarea } from "~/components/ui/field";
```

A lint rule enforces this. The only file that may import from `ui/input` or `ui/textarea` directly is `ui/field.tsx` itself.

### When to use Field vs bare Input

| Pattern                                     | When                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `FormField` + `Input`                       | TanStack Form field — has label, validation, error display                                                           |
| `Field` + `FieldLabel` + `Input`/`Textarea` | Static labeled field — no TanStack, but needs accessible label                                                       |
| Bare `Input` with `aria-label`              | Inline editing only — label is implicit from surrounding UI (e.g. task title). Suppress lint warning with a comment. |

### No `group-has-*` variants

Tailwind writes `group-has-[…]/name:` as `:is(:where(.group\/name):has(…) *)`, which Chrome can't narrow: every focus move or disabled change restyled the whole page, 7,000+ elements on a long list. Use a variant from `app.css` instead (`task-focus-visible`, `row-focus-visible`, `field-disabled`, `pill-popup-open`, …), or add one there in the same shape. `shadcn add` brings them back, so swap any it adds. A plain `has-[…]:`, with `:has()` on the element itself, is fine.

### Abstractions stay out of the `ui/` folder

`ui/` contains only primitives and the field composition. App-level abstractions (e.g. a `TaskTitleInput` or `SearchField`) go in the parent `components/` folder, not here.
