---
session_id: bc4f3c82-596a-47ce-9254-c60c6c30c140
date: 2026-09-22
type: feature
---

# Black borders around groups and standalone blocks

## Summary
Piece borders already outline every seam inside a block, but a group of
white-filled shapes had no way to visually separate itself from the white
page it's printed on. Added an opt-in outline drawn flush around the outer
edge of a selected group — or a single standalone piece — independent of
the existing per-piece border toggle.

## Changes
- New `project.groupBorders` map (keyed by groupId, or by a standalone
  shape's own id) tracks which blocks have the outline turned on.
- Properties panel gains a "Draw border around this group/piece" checkbox,
  shown when the selection is exactly one whole group or one ungrouped
  shape; label text adapts to which case applies.
- Border renders as a flush (no-padding), 3px solid black rect behind/around
  the block's world-space bounding box — stays visible even when the global
  "Piece borders" toggle is off.
- Wired through undo/redo, autosave, Save/Load, Share Link, Duplicate
  (carries the flag to the new copy), Group/Ungroup/Delete (prunes stale
  entries), and PNG/SVG export (only included when every covered piece is
  part of the export).
- Fixed two follow-up defects found during review before commit: the border
  was initially offset from the shape edge (was reusing the export bbox's
  8px margin — switched to a zero-padding bbox so the stroke sits directly
  on the edge), and a standalone (ungrouped) single shape couldn't get the
  border at all (generalized `borderTargetKey()` to cover both a whole group
  and a lone shape, keyed by group id or shape id respectively).

## Files touched
`app.js`, `index.html`, `style.css`

## Commits
- `4719464` — Add black borders around groups and standalone blocks
