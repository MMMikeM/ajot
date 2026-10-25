---
name: before-after
description: Show before and after evidence for a UI change in this app. Serves the base ref and the branch side by side, captures the same scenes on phone then desktop against the mocked API, pairs every still into one labelled Before | After image, and turns short captioned clips of interactions into side-by-side videos. Use when the user asks for before/afters, evidence, screenshots or a demo of design changes, or to show a PR's visual impact.
---

# Before and after

Adapted from the work `e2e-demo-video` skill. No API server or database: `/api` is mocked by `packages/e2e/helpers/mock-api.ts`, and the live-sync stream is held open by `helpers/event-stream.ts`, so the header reads as connected unless a scene takes it offline.

## Workflow

1. **Serve both versions** in the background, on ports nothing else uses:
   - before: `.claude/skills/before-after/scripts/serve-ref.sh <base-ref> 5301` exports the ref to `.evidence/refs/<sha>` (gitignored) and borrows this checkout's `node_modules`. No worktree, no git write.
   - after: `npx vp dev --port 5302 --strictPort` from `packages/client` on the branch.
2. **Write the scenes** in `packages/e2e/evidence/<feature>.ts`, copying `evidence/critique-pass.ts`. One script runs against both versions, so match on what both share: role names as regexes where copy changed (`/^(List|Category) options$/`), task titles from the mock data. Phone first (iPhone 14 settings on Chromium), then desktop (1440×900, cropped to the notepad). A still per state; name files `phone-NN-<what>` / `desktop-NN-<what>`, since the name becomes the image title.
3. **Clips** for what a still can't show (a swipe, a settle-in, a toast): use `helpers/demo.ts` (`enableDemoClicks` for a drawn pointer and a 500ms outlined pause before each `Locator.click`, `showCaption`, `createTimeline`). Wait for content before `timeline.show()`; `hide()` before a reload. Record at the viewport size.
4. **Capture**, from `packages/e2e`:
   ```
   node_modules/.bin/tsx evidence/<feature>.ts --url http://localhost:5301 --out .evidence/<feature>/before
   node_modules/.bin/tsx evidence/<feature>.ts --url http://localhost:5302 --out .evidence/<feature>/after
   ```
5. **Pair**: `node ../../.claude/skills/before-after/scripts/pair.mjs .evidence/<feature>/before .evidence/<feature>/after .evidence/<feature>/pairs`. Stills become `pairs/<name>.png`; clips are trimmed by `cut-demo.mjs` and joined into `pairs/<clip>.mp4`, the shorter side holding its last frame.
6. **Check** every pair by reading it, and each clip's `*.contact.png` (one frame per 500ms): no blank or loading frames, captions not covering what changed, the same state on both sides. A difference that comes from the mock rather than the change (a 204 stream, timing) is noise: fix the scene, not the caption.
7. **Hand over**: stop both servers (kill by port), then `open .evidence/<feature>/pairs` so the user can drag images and mp4s into the PR. `gh` can't upload media.

## Done when

- [ ] Every state the change touches has a pair, phone first, then desktop
- [ ] Clips are a few seconds, captioned on every frame, with no dead time
- [ ] Nothing in a pair differs for a reason other than the change
