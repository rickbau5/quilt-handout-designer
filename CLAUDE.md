# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local-only, no-build, no-server SVG diagram tool for drawing quilt-block
piecing diagrams (the labeled unit drawings that go in quilting-class
handouts), then exporting them as PNG/SVG to drop into Word. Everything runs
in the browser; nothing is uploaded anywhere. See README.md for the full
user-facing feature rundown (tools, grouping, save/load, share links,
export) — it's kept up to date and worth reading before making UI changes.

## Commands

There is no build step and no `package.json`. To run the app, open
`index.html` directly in a browser (double-click it, or serve the folder
statically — any static host works since it's just `index.html`, `style.css`,
`app.js`).

There is no automated test suite. Verify changes by opening the app in a
browser and exercising the affected tool/panel by hand.

Linting/formatting is configured via Trunk (`.trunk/trunk.yaml`:
markdownlint, prettier, trufflehog, git-diff-check). Run `trunk check` /
`trunk fmt` if the Trunk CLI is available; there's no npm wrapper for it here.

Quick syntax check for `app.js` after edits: `node --check app.js`.

## Architecture

The entire app lives in one file, `app.js`, wrapped in a single IIFE — no
modules, no framework, no build step. `index.html` is just the DOM shell
(toolbar, properties panel, the `<svg id="canvas">`) and `style.css` styles
both the UI chrome and the SVG shape/selection classes. Keep it this way;
the single-file-no-build-step property is a deliberate design goal (see
README's "If you want to deploy it somewhere later").

**State and data model.** All app state lives in one `project` object
(`gridUnit`, `labelColors`, `showBorders`, `groupBorders`, `shapes[]`), plus
a separate `selection` Set of shape ids. A shape is a plain object built by
one of the factory functions (`makeRect`, `makeHST`, `makeSewFlip`,
`makeArrow`, `makeText`), sharing common fields from `baseShape()` (id, x/y/
w/h, rotation, mirrorX/Y, fill, label, groupId, hideBorder) plus
type-specific fields. `renderShapeNode()` and `updatePropsPanel()` both
switch on `shape.type`, so adding a new shape type means touching both
(plus the factory and any Properties-panel rows it needs in `index.html`).

**Grouping is not a first-class entity.** A composite "group" is just two or
more shapes sharing a `shape.groupId` string (from `groupUid()`, prefixed
`"g"`) — there's no separate group object. `groupsById()` reconstitutes
membership by scanning `project.shapes` on demand. `project.groupBorders` is
keyed either by a groupId, or — for a standalone single shape's own outline
toggle — by the shape's own id (from `uid()`, prefixed `"s"`); the two id
spaces never collide, which is why they can share one map. See
`borderTargetKey()` / `borderMembers()` in `app.js` for the resolution logic.

**Rendering is a full re-render, not incremental.** `renderAll()` (grid,
shapes, selection, props panel, label-colors panel, autosave, save-status)
is the single entrypoint called after essentially every state mutation,
including on every `mousemove` while dragging/drawing/resizing. There's no
partial-update path — if you mutate `project` or `selection`, call
`renderAll()` (or at least `renderShapes()`/`renderSelection()` as
appropriate) rather than patching the DOM directly.

**Undo/redo** (`pushHistory`/`undo`/`redo`) takes whole-state JSON snapshots
(`{shapes, labelColors, groupBorders}`) rather than diffs — simplest thing
that's correct, given project sizes are small. `pushHistory()` must be
called *before* a mutation, not after.

**Persistence has three parallel paths that must be kept in sync** whenever
the project schema changes (e.g. adding a new top-level `project` field):
`projectDataObject()`/`loadProjectData()` (used by Save/Save As/Load
Project, autosave, *and* Share Link — they all funnel through these two),
`snapshotState()` (undo/redo), and the initial `project = {...}` literal's
defaults. Save/Save As/Load Project branch on `hasFSAccess` (File System
Access API — Chrome/Edge get true overwrite-in-place; Firefox/Safari fall
back to download-a-copy) — both code paths need updating together for any
save/load behavior change. Share Link gzip-compresses the same JSON into
the URL hash (`#share=...`), never the query string.

**Export builds a standalone SVG string** (`buildStandaloneSvgString`) by
cloning shape `<g>` nodes (and group-border `<rect>`s) out of the live
`#canvas` DOM and manually re-declaring the CSS rules those classes need in
an inline `<style>` block, since the exported file has no access to
`style.css`. **Any new visual CSS class used on the canvas needs a matching
rule added to that inline `<style>` block too**, or it'll render correctly
on-screen but wrong (or missing) in exported PNG/SVG files. PNG export
rasterizes that SVG string via an offscreen `<canvas>`, scaled by
`dpi / PX_PER_INCH`.

**Units:** `PX_PER_INCH = 60` is the one fixed conversion between drawing
inches and on-screen/SVG pixels, used throughout (`inchesToPx`/`pxToInches`).
DPI (150/300/600) only enters at PNG export time as a raster scale factor —
the underlying SVG geometry is always in the same 60px/inch space.

**Build stamp:** `APP_BUILD` near the top of `app.js` is bumped by hand on
every change and shown in the topbar, so a stale browser tab (still running
JS from before a reload) can be identified. Bump it when you change `app.js`.

## Session logs

`sessions/` holds one short markdown write-up per working session (what
changed, why, and which commit(s) it produced). See `sessions/CLAUDE.md` for
the format.
