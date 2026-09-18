# Quilt Handout Designer

A small local tool for building the piecing diagrams that go in Riley's quilting
class handouts — the labeled block/unit drawings, not the whole handout. Build
the diagrams here, export them as images, and drop them into Word alongside the
titles, cutting tables, and instructions the way you already do.

No install, no account, no server. Everything runs in the browser and nothing
leaves your computer.

## Opening it

Double-click `index.html`. That's it — it opens in your default browser and
works offline. (If double-clicking doesn't work on your setup, right-click →
Open With → your browser.)

## How it works

- **Toolbar (left):** pick a tool, then click-drag on the canvas to place a
  shape. `Select` (V) to move/resize/select things afterward.
  - **Square/Rect** (R) — a plain pieced square or rectangle. Optionally add
    a dashed line across it (corner-to-corner or side-to-side) from the
    Properties panel — handy for showing a seam or fold on a plain piece.
  - **HST** (H) — a half-square triangle: a square split diagonally into two
    triangles, each with its own color and its own letter label. Use
    Flip Diagonal in the Properties panel to switch which way it splits. You
    can also turn on a **Press line** (dashed or solid) along that diagonal,
    with an **Arrow** at one end, both ends, or none — the line sits inset
    from the true corners rather than touching them. This is the easiest way
    to show a "press toward this corner" seam.
  - **Sew-Flip** (F) — the "sew a square to a corner, then trim" unit. Pick
    which corner and how big it is in the Properties panel on the right. For
    most diagrams the HST tool above (two colors + a press line) reads more
    clearly and is the one worth reaching for first; Sew-Flip is here for the
    cases where you specifically want the trimmed-corner look with a single
    small accent triangle.
  - **Arrow** (A) — a press/sew direction arrow. Rotate it from the toolbar
    or the Properties panel.
  - **Text** (T) — a free note like "Make 4".
- **Piece borders:** the "Piece borders" checkbox in the top bar toggles the
  thin black outline on every shape on or off at once. To hide the border on
  just one or a few pieces while leaving the rest as-is, select them and use
  "Hide this piece's border" in the Properties panel instead — it works on
  the whole current selection at once, so you can select several pieces and
  strip their borders in one click.
- **Label position:** each label can sit dead-center or tuck into a corner
  (top-right, etc.) at a smaller size, from the Position dropdown in the
  Properties panel — useful when a label would otherwise sit on top of a
  seam line or another shape.
- **Grouping / composite blocks:** select two or more shapes (shift-click, or
  drag a selection box around them) and hit **Group** (Ctrl/Cmd+G) to make
  them move, duplicate, and select together as one composite piece — for
  example an HST sewn onto the end of a long rectangle, which is one finished
  unit in your diagram even though it's built from two shapes here.
  **Ungroup** (Ctrl/Cmd+Shift+G) splits them back apart. Double-click a
  grouped shape to select and edit just that one piece without ungrouping.
- **Drag-to-select:** with the Select tool, drag a box anywhere on the canvas
  to select everything it overlaps — no need to shift-click each piece.
  Hold Shift while dragging to add to the current selection.
- **Snapping:** everything snaps to the grid, and to the edges of nearby
  shapes, so pieces line up exactly without nudging by eye. Set the grid size
  (1/8", 1/4", 1/2", 1") in the top bar.
- **Labels & color:** give a shape a letter (A, B, C…) in the Properties
  panel. Each letter gets its own color automatically, and that color is
  reused everywhere the same letter appears.
- **Undo/redo, duplicate, rotate, mirror:** in the left toolbar, or
  Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+D. Rotate moves in 45° steps; type an
  exact angle into the Properties panel if you need something else.
- **Multiple diagrams at once:** the canvas isn't limited to one diagram —
  build several units and the full block side by side, then select just the
  pieces for one diagram before exporting so you only export that group. If
  nothing is selected, Export grabs everything on the canvas.

## Saving your work

Save/Load is entirely local, the same way Excalidraw works — there's no
account and nothing is uploaded anywhere.

- **Save Project** downloads a `.qhd.json` file with everything in it. Keep it
  next to your handout files.
- **Load Project** opens one back up.
- The app also autosaves to this browser as a backup and will offer to
  restore it next time you open the page — but a saved project file is the
  safe copy if you switch computers or clear your browser.

## Exporting for Word

- **Export PNG** — a transparent-background image sized at your chosen DPI
  (300 is a good default for print). Select the pieces for one diagram first
  so you only export that group; export the whole canvas if nothing's
  selected.
- **Export SVG** — same idea, as a standalone SVG sized in real inches, useful
  if you want to resize it yourself later without losing quality.

Either way, the exported image is sized to its true physical dimensions, so
when you drop it into Word it should come in close to the right size already.

## Known limitations (first pass)

- Resize handles only show up for shapes at 0°/180° rotation — a rotated
  shape can still be moved, duplicated, and rotated further, just not resized
  by dragging its corners. Use the Properties panel's width/height fields
  instead if you need to.
- There's no zoom yet; the canvas is a large fixed size you scroll around.
- No block-pattern library or cutting-list auto-generation yet — those are
  "beyond MVP" items in the plan doc.

## If you want to deploy it somewhere later

It's a fully static site (just `index.html`, `style.css`, `app.js`) — no
build step, no server code. Any static host (GitHub Pages, Netlify, a plain
web server) can serve the folder as-is.
