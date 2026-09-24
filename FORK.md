# excalidraw-animate fork

Fork of [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) that adds per-element animations for arrows and lines, exported as pure SVG (SMIL, no JavaScript), so the result animates in an `<img>` tag.

## Feature

The **Animate** button (top right, in place of the Excalidraw+ banner) opens the Animations sidebar (always docked, so it stays open while selecting on the canvas; same initial width as upstream sidebars; drag its left edge to resize (remembered per browser), double-click to reset), which lists every arrow and line. Per element:

| Animation | Effect | Settings |
| --- | --- | --- |
| Flow | marching dashes along the line | direction, duration, dash, gap |
| Draw | line draws itself, arrowheads fade in at the end | direction, duration |
| Pulse | line opacity pulses | duration |
| Moving dots | one or more real canvas elements (default: small filled circles, style them freely) travel along the line; sequence numbers put lines on a shared timeline (same number: in sync, ascending: one after another) | direction, duration, dots, sequence |

Direction is relative to the element's points: `forward` = start → end.

"Preview & export" shows the animated SVG and downloads/copies it. The regular export dialog (SVG) and "Copy as SVG" produce the same animations, PNG exports stay static.

**Hover reveal** (in "Preview & export"): hide all text, or only the labels of animated lines, until the pointer is over the image. CSS `:hover`, so it only works for interactive SVGs (inline, `<object>`, `<iframe>`), not in `<img>` or on touch screens. "Optimize size" in the same dialog shrinks the file (rounding, compact paths, unused masks) without touching animations.

The config is stored in `element.customData.animation`, so it is saved in `.excalidraw` files, embedded scenes, undo history, and collaboration without any schema change.

## Keeping upstream merges cheap

All feature code lives in new files under `packages/excalidraw/animation/` (new files never conflict). Upstream files only get one-line hooks, each marked with `[excalidraw-animate]`:

| File | Hook |
| --- | --- |
| `packages/excalidraw/renderer/staticSvgScene.ts` | `applyElementAnimation` and the curved label gap (lines/arrows), `applyAnimationDotMotion` (shapes), `markTextNode` and `renderCurvedLabelSvg` (text) |
| `excalidraw-app/App.tsx` | `<AnimationSidebarTrigger />` replaces the Excalidraw+ banner, `<AnimationSidebar />` next to `<AppSidebar />`, `onDuplicate={remapAnimationReferences}` |
| `excalidraw-app/App.tsx` | URL resets keep the path (`window.location.pathname` instead of `.origin`) so the app works under a sub path; `#url=` scenes scroll to content |
| `packages/element/src/linearElementEditor.ts` | `applyLabelOffset(...)` in `getBoundTextElementPosition`: label offset above/below the line (`packages/element/src/labelOffset.ts`, stored in the label's `customData.labelOffset`) |
| `packages/element/src/renderElement.ts` | `drawCurvedLabel(...)` at the start of `drawElement`, `traceCurvedLabelHole(...)` in both label-gap clips (logic in `packages/element/src/curvedLabel.ts`, opt-in via the label's `customData.labelFollowsPath`) |
| `excalidraw-app/collab/Collab.tsx` | same path-preserving URL reset when leaving a session |
| `excalidraw-app/index.html` | `VITE_APP_DISABLE_ANALYTICS=true` skips excalidraw.com's analytics script |

Rules:

- Don't edit upstream files beyond a marked hook; extend through `packages/excalidraw/animation/` instead.
- UI strings live in `animation/strings.ts`, not in the upstream locale files.
- Use only public/stable internals (`customData`, `updateScene`, `Sidebar`, `exportToSvg`).
- Library consumers render `<AnimationSidebar />` and `<AnimationSidebarTrigger />` inside `<Excalidraw>` and pass `onDuplicate={remapAnimationReferences}` (from `animation/dot.ts`) themselves.

List all hooks and the full diff to upstream:

```bash
git grep -n "\[excalidraw-animate\]"
git fetch upstream
git diff upstream/master --stat -- . ':!packages/excalidraw/animation' ':!FORK.md'
```

Syncing:

```bash
git fetch upstream
git merge upstream/master   # conflicts, if any, are limited to the hooks above
yarn test:typecheck && yarn vitest run packages/excalidraw/animation
```

The tests in `packages/excalidraw/animation/` pin the upstream assumptions the feature relies on (curve is the first rough.js shape of a linear element, one SVG node per shape, `customData` survives restore). If upstream changes those, the tests fail rather than the export silently losing animations.

## Demo on GitHub Pages

`.github/workflows/pages.yml` builds the app on every push to `master` with `--base=/<repo>/`, analytics and Sentry disabled, and deploys it to GitHub Pages. Examples and the demo page live in `public/examples/` (served at `/examples/`); `public/examples/readme/` holds copies without Hover reveal for the README, since GitHub shows README images as `<img>`.

Build it locally the same way:

```bash
cd excalidraw-app
VITE_APP_DISABLE_SENTRY=true VITE_APP_DISABLE_ANALYTICS=true yarn vite build --base=/excalidraw-animate/
yarn vite preview --base=/excalidraw-animate/
```

Delete `excalidraw-app/build/` afterwards if the dev server (`yarn start`) is running: its lint checker scans that folder and crashes when a rebuild replaces the files.
