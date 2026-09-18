/* Quilt Handout Designer
 * A small, local-only (no server) SVG diagram tool for building quilt-block
 * piecing diagrams that snap cleanly, then export as PNG/SVG to drop into Word.
 *
 * Everything lives in this one file on purpose: no build step, open index.html
 * directly (or serve the folder statically) and it just works.
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------
  const SVG_NS = "http://www.w3.org/2000/svg";
  const PX_PER_INCH = 60;       // 1 drawing inch = 60 canvas px
  const SNAP_TOL = 7;           // px tolerance for edge/point snapping
  const MIN_SIZE_IN = 0.125;    // smallest shape dimension we'll keep
  const HISTORY_LIMIT = 100;
  const AUTOSAVE_KEY = "qhd_autosave_v1";
  const AUTOSAVE_BACKUP_KEY = "qhd_autosave_backup_v1"; // one step behind AUTOSAVE_KEY, as a second line of defense

  // Does this browser support reading/writing real files by handle (Save
  // that overwrites in place, not just "download a new copy")? Chrome/Edge:
  // yes. Firefox/Safari: no — those fall back to the old download-a-copy
  // behavior everywhere below.
  const hasFSAccess = "showSaveFilePicker" in window && "showOpenFilePicker" in window;
  let currentFileHandle = null; // FileSystemFileHandle for the project file currently open, if any
  let currentFileName = null;   // its name, shown in the topbar even when we don't have a handle for it
  // True once something has changed that isn't yet written to currentFileHandle
  // (or, with no handle, hasn't been through Save/Save As at all). This is
  // deliberately a *different* notion of "saved" than the autosave system
  // below: autosave keeps a copy in this browser's local storage on every
  // edit regardless, which is what protects against an accidental refresh;
  // fileDirty tracks whether that state has also been written out to an
  // actual portable file the user chose, which is what the Save button and
  // the leave-this-page warning care about.
  let fileDirty = false;

  // Bumped by hand whenever app.js changes. Shown in the topbar so it's easy
  // to tell, at a glance, whether a browser tab is running the file that's
  // currently on disk or an older copy it loaded before the last update —
  // a page that's been open across several edits keeps running whatever
  // JS was loaded when it was opened, so a tab left open through an update
  // can show stale behavior until it's reloaded. If a fix doesn't seem to
  // be taking effect, check this number against the one you expect and do
  // a hard refresh (Ctrl+Shift+R) if it's behind.
  const APP_BUILD = "2026-09-18.4";

  const PALETTE = [
    "#e07a5f", "#3d8bd4", "#81b29a", "#f2cc8f", "#9b5de5",
    "#f4845f", "#4ea699", "#c9a227", "#7f5539", "#5390d9",
    "#e56b6f", "#6a994e"
  ];

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  let project = {
    gridUnit: 0.25,   // inches
    labelColors: {},  // letter -> hex color
    showBorders: true,
    shapes: []
  };

  let selection = new Set();   // shape ids
  let currentTool = "select";
  let nextId = 1;
  let undoStack = [];
  let redoStack = [];
  let drag = null;              // active pointer interaction, or null
  let propsSnapshotTaken = false;
  // Guards against the page's very first render (on load) silently
  // overwriting a real autosave with an empty in-memory project — that
  // used to happen whenever the "restore your session?" prompt was missed,
  // declined, or suppressed by the browser, and it was unrecoverable.
  // Autosave only actually writes once something genuinely changes.
  let autosaveArmed = false;

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------
  const svg = document.getElementById("canvas");
  const gridLayer = document.getElementById("gridLayer");
  const shapeLayer = document.getElementById("shapeLayer");
  const selectionLayer = document.getElementById("selectionLayer");
  const marqueeLayer = document.getElementById("marqueeLayer");
  const canvasWrap = document.getElementById("canvasWrap");

  const gridUnitSelect = document.getElementById("gridUnitSelect");
  const dpiSelect = document.getElementById("dpiSelect");
  const chkBorders = document.getElementById("chkBorders");
  const labelColorsList = document.getElementById("labelColorsList");
  const labelColorsEmpty = document.getElementById("labelColorsEmpty");

  const propsEmpty = document.getElementById("propsEmpty");
  const propsForm = document.getElementById("propsForm");
  const propW = document.getElementById("propW");
  const propH = document.getElementById("propH");
  const propLabelRow = document.getElementById("propLabelRow");
  const propLabel = document.getElementById("propLabel");
  const propColorSwatch = document.getElementById("propColorSwatch");
  const propLabelPos = document.getElementById("propLabelPos");
  const propLabelSize = document.getElementById("propLabelSize");
  const propHstRow = document.getElementById("propHstRow");
  const propHstRow2 = document.getElementById("propHstRow2");
  const propHstRow3 = document.getElementById("propHstRow3");
  const propHstRow4 = document.getElementById("propHstRow4");
  const propPressLine = document.getElementById("propPressLine");
  const propPressArrow = document.getElementById("propPressArrow");
  const propLabelA = document.getElementById("propLabelA");
  const propColorSwatchA = document.getElementById("propColorSwatchA");
  const propLabelPosA = document.getElementById("propLabelPosA");
  const propLabelSizeA = document.getElementById("propLabelSizeA");
  const propLabelB = document.getElementById("propLabelB");
  const propColorSwatchB = document.getElementById("propColorSwatchB");
  const propLabelPosB = document.getElementById("propLabelPosB");
  const propLabelSizeB = document.getElementById("propLabelSizeB");
  const btnFlipDiagonal = document.getElementById("btnFlipDiagonal");
  const propSewRow = document.getElementById("propSewRow");
  const propSewCorner = document.getElementById("propSewCorner");
  const propCornerSize = document.getElementById("propCornerSize");
  const propDashRow = document.getElementById("propDashRow");
  const propDashFrom = document.getElementById("propDashFrom");
  const propDashTo = document.getElementById("propDashTo");
  const propTextRow = document.getElementById("propTextRow");
  const propText = document.getElementById("propText");
  const propFill = document.getElementById("propFill");
  const propBorderRow = document.getElementById("propBorderRow");
  const propHideBorder = document.getElementById("propHideBorder");
  const propRotation = document.getElementById("propRotation");

  // ---------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------
  function uid() { return "s" + (nextId++); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function inchesToPx(v) { return v * PX_PER_INCH; }
  function pxToInches(v) { return v / PX_PER_INCH; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round2(v) { return Math.round(v * 100) / 100; }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const k in attrs) el.setAttribute(k, attrs[k]);
    }
    return el;
  }

  // Adds an inline stroke:none to a shape-fill element's attrs when that
  // specific shape has its border hidden — inline style beats both the
  // element's own class rules and the global #canvas.no-borders rule, so
  // this works as a true per-shape override in either direction.
  function fillAttrs(shape, attrs) {
    if (shape.hideBorder) attrs.style = "stroke:none";
    return attrs;
  }

  function isTypingTarget(el) {
    return el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA");
  }

  // ---------------------------------------------------------------------
  // History (undo/redo) — full-state snapshots, simplest thing that's correct
  // ---------------------------------------------------------------------
  function snapshotState() {
    return JSON.stringify({ shapes: project.shapes, labelColors: project.labelColors });
  }

  function pushHistory() {
    autosaveArmed = true; // a real edit is about to happen — safe to persist from here on
    fileDirty = true; // ...and it hasn't been written to a file yet
    undoStack.push(snapshotState());
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    updateUndoRedoButtons();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshotState());
    const state = JSON.parse(undoStack.pop());
    project.shapes = state.shapes;
    project.labelColors = state.labelColors;
    selection.clear();
    fileDirty = true; // moved away from whatever was last written to a file
    renderAll();
    updateUndoRedoButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshotState());
    const state = JSON.parse(redoStack.pop());
    project.shapes = state.shapes;
    project.labelColors = state.labelColors;
    selection.clear();
    fileDirty = true;
    renderAll();
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    document.getElementById("btnUndo").disabled = undoStack.length === 0;
    document.getElementById("btnRedo").disabled = redoStack.length === 0;
  }

  // ---------------------------------------------------------------------
  // Label colors
  // ---------------------------------------------------------------------
  function getColorForLabel(label) {
    if (!label) return null;
    if (project.labelColors[label]) return project.labelColors[label];
    const used = Object.values(project.labelColors);
    let color = PALETTE.find((c) => !used.includes(c));
    if (!color) color = PALETTE[Object.keys(project.labelColors).length % PALETTE.length];
    project.labelColors[label] = color;
    return color;
  }

  // Every letter currently in use on the canvas, plus any registered in
  // project.labelColors even if nothing on the canvas uses it right now
  // (e.g. right after deleting the last piece with that label) — this is
  // the set of rows the Label Colors panel shows.
  function allUsedLabels() {
    const labels = new Set(Object.keys(project.labelColors));
    project.shapes.forEach((s) => {
      if (s.type === "rect" || s.type === "sewflip") {
        if (s.label) labels.add(s.label);
      } else if (s.type === "hst") {
        if (s.labelA) labels.add(s.labelA);
        if (s.labelB) labels.add(s.labelB);
      }
    });
    return Array.from(labels).sort();
  }

  // True if some shape on the canvas right now actually carries this label.
  // A label can exist in project.labelColors (and so still show up in the
  // panel) with nothing on canvas using it, e.g. after deleting the last
  // piece with that label, or renaming a piece's label to something else.
  function isLabelUsed(label) {
    return project.shapes.some((s) => {
      if (s.type === "rect" || s.type === "sewflip") return s.label === label;
      if (s.type === "hst") return s.labelA === label || s.labelB === label;
      return false;
    });
  }

  // Drops a label from project.labelColors so it stops showing up in the
  // panel. Only meaningful for a label nothing on canvas currently uses —
  // the panel only offers this for unused labels (see renderLabelColorsPanel).
  function removeLabelColor(label) {
    if (!(label in project.labelColors)) return;
    pushHistory();
    delete project.labelColors[label];
    renderAll();
  }

  // Removes every currently-unused label from project.labelColors in one go.
  function clearUnusedLabelColors() {
    const unused = Object.keys(project.labelColors).filter((label) => !isLabelUsed(label));
    if (!unused.length) return;
    pushHistory();
    unused.forEach((label) => delete project.labelColors[label]);
    renderAll();
  }

  // The global, authoritative recolor: changes what a letter means, so it
  // updates project.labelColors (what future shapes with this label will
  // pick up) AND every existing shape currently carrying that label. This
  // is the one place that changes a label's color everywhere at once —
  // editing a single shape's Fill in the Properties panel only ever
  // changes that one shape and does not touch this mapping.
  function setLabelColor(label, color) {
    if (!label) return;
    pushHistory();
    project.labelColors[label] = color;
    project.shapes.forEach((s) => {
      if ((s.type === "rect" || s.type === "sewflip") && s.label === label) s.fill = color;
      else if (s.type === "hst") {
        if (s.labelA === label) s.fillA = color;
        if (s.labelB === label) s.fillB = color;
      }
    });
    renderAll();
  }

  function renderLabelColorsPanel() {
    const labels = allUsedLabels();
    labelColorsEmpty.hidden = labels.length > 0;
    labelColorsList.innerHTML = "";
    let unusedCount = 0;
    labels.forEach((label) => {
      const used = isLabelUsed(label);
      if (!used) unusedCount++;
      const row = document.createElement("div");
      row.className = "label-color-row" + (used ? "" : " label-color-row-unused");
      const name = document.createElement("span");
      name.className = "label-color-name";
      name.textContent = label;
      name.title = used ? "" : "Not used on any piece right now";
      const input = document.createElement("input");
      input.type = "color";
      input.value = getColorForLabel(label);
      input.title = `Recolor every "${label}" piece, now and going forward`;
      input.addEventListener("change", () => setLabelColor(label, input.value));
      row.appendChild(name);
      row.appendChild(input);
      if (!used) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "label-color-remove";
        removeBtn.textContent = "×";
        removeBtn.title = `Remove unused label "${label}"`;
        // mousedown, not click: if another field (e.g. the Label text input
        // in Properties) is focused when this is clicked, its blur/"change"
        // handler fires and re-renders this panel *before* the browser
        // would dispatch "click" on this button, so the button node is
        // already replaced and the click event never fires at all. Acting
        // on mousedown runs before that focus-change side effect.
        removeBtn.addEventListener("mousedown", () => removeLabelColor(label));
        row.appendChild(removeBtn);
      }
      labelColorsList.appendChild(row);
    });

    if (unusedCount > 1) {
      const cleanupBtn = document.createElement("button");
      cleanupBtn.type = "button";
      cleanupBtn.id = "btnClearUnusedLabels";
      cleanupBtn.className = "label-colors-cleanup";
      cleanupBtn.textContent = `Remove all unused (${unusedCount})`;
      cleanupBtn.addEventListener("mousedown", clearUnusedLabelColors);
      labelColorsList.appendChild(cleanupBtn);
    }
  }

  // ---------------------------------------------------------------------
  // Shape factories
  // ---------------------------------------------------------------------
  function baseShape(type, x, y, w, h) {
    return {
      id: uid(),
      type: type,
      x: x, y: y, w: w, h: h,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
      fill: "#f3ede3",
      label: "",
      labelPos: "center",   // 'center'|'tl'|'tr'|'bl'|'br'
      labelSize: null,      // inches, or null for automatic sizing
      groupId: null,        // shapes sharing a groupId move/rotate/duplicate/delete as one composite piece
      hideBorder: false     // per-shape override: hide this piece's outline even when the global "Piece borders" setting is on
    };
  }

  const BORDERED_TYPES = ["rect", "hst", "sewflip"]; // shape types that draw a .shape-fill outline at all

  function groupUid() { return "g" + (nextId++); }

  function makeRect(x, y, w, h) {
    const s = baseShape("rect", x, y, w, h);
    s.dashFrom = "none";  // optional dashed line across the shape: an anchor name...
    s.dashTo = "none";    // ...or 'none' to omit it
    return s;
  }

  function makeSewFlip(x, y, w, h) {
    const s = baseShape("sewflip", x, y, w, h);
    s.sewCorner = "br";
    s.cornerSize = Math.min(w, h) * 0.5;
    s.flipFill = "#c9a9a6";
    return s;
  }

  // Half-square triangle: a square (or rectangle) split by one diagonal into
  // two triangles, each with its own fill and its own letter label.
  function makeHST(x, y, w, h) {
    const s = baseShape("hst", x, y, w, h);
    s.diagonal = "tlbr";        // 'tlbr' = \ from top-left to bottom-right, 'trbl' = / from top-right to bottom-left
    s.labelA = "";
    s.labelB = "";
    s.fillA = "#f3ede3";
    s.fillB = "#9fb8c9";
    s.labelPosA = "center";
    s.labelSizeA = null;
    s.labelPosB = "center";
    s.labelSizeB = null;
    s.pressLine = "none";    // 'none' | 'dashed' | 'solid' — an optional seam/press line along the diagonal
    s.pressArrow = "none";   // 'none' | 'towardA' | 'towardB' | 'both' — perpendicular fold-direction arrow(s) crossing the seam
    return s;
  }

  function makeArrow(x, y, w, h) {
    const s = baseShape("arrow", x, y, Math.max(w, 20), 20);
    s.fill = "none";
    return s;
  }

  function makeText(x, y) {
    const s = baseShape("text", x, y, 90, 22);
    s.text = "Make 4";
    s.fill = "#1c1f24";
    return s;
  }

  // ---------------------------------------------------------------------
  // Geometry: local <-> world, snapping
  // ---------------------------------------------------------------------
  function shapeTransform(shape) {
    const cx = shape.w / 2, cy = shape.h / 2;
    const mx = shape.mirrorX ? -1 : 1;
    const my = shape.mirrorY ? -1 : 1;
    return `translate(${shape.x} ${shape.y}) translate(${cx} ${cy}) ` +
      `rotate(${shape.rotation}) scale(${mx} ${my}) translate(${-cx} ${-cy})`;
  }

  function localToWorld(shape, lx, ly) {
    const cx = shape.w / 2, cy = shape.h / 2;
    const mx = shape.mirrorX ? -1 : 1, my = shape.mirrorY ? -1 : 1;
    let px = (lx - cx) * mx;
    let py = (ly - cy) * my;
    const rad = (shape.rotation * Math.PI) / 180;
    const rx = px * Math.cos(rad) - py * Math.sin(rad);
    const ry = px * Math.sin(rad) + py * Math.cos(rad);
    return { x: rx + cx + shape.x, y: ry + cy + shape.y };
  }

  function shapeWorldBBox(shape) {
    const corners = [
      localToWorld(shape, 0, 0),
      localToWorld(shape, shape.w, 0),
      localToWorld(shape, shape.w, shape.h),
      localToWorld(shape, 0, shape.h)
    ];
    const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
    return {
      x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
      x2: Math.max.apply(null, xs), y2: Math.max.apply(null, ys)
    };
  }

  function gridPx() { return inchesToPx(project.gridUnit); }

  function snapFree(value, candidates) {
    const g = gridPx();
    let best = null, bestD = SNAP_TOL;
    for (const c of candidates) {
      const d = Math.abs(value - c);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best !== null) return best;
    return Math.round(value / g) * g;
  }

  function snapShapeMove(shape, proposedX, proposedY) {
    const g = gridPx();
    const others = project.shapes.filter((s) => s.id !== shape.id && !selection.has(s.id));
    const candX = [], candY = [];
    for (const o of others) { candX.push(o.x, o.x + o.w); candY.push(o.y, o.y + o.h); }

    function pick(value, size, cands) {
      let best = null, bestD = SNAP_TOL;
      for (const c of cands) {
        const d1 = Math.abs(value - c);
        if (d1 < bestD) { bestD = d1; best = c; }
        const d2 = Math.abs((value + size) - c);
        if (d2 < bestD) { bestD = d2; best = c - size; }
      }
      if (best !== null) return best;
      return Math.round(value / g) * g;
    }
    return { x: pick(proposedX, shape.w, candX), y: pick(proposedY, shape.h, candY) };
  }

  function drawCandidates(excludeId) {
    // excludeId leaves out the shape currently being drawn/resized itself —
    // without this, a shape started or resized flush against an existing
    // edge keeps re-snapping to its OWN growing edge every mousemove (it's
    // in project.shapes from the moment mousedown pushes it), which can
    // pin it at a tiny size instead of letting it grow with the cursor.
    // snapShapeMove() already excludes the shape being moved the same way.
    const xs = [], ys = [];
    for (const s of project.shapes) {
      if (excludeId && s.id === excludeId) continue;
      xs.push(s.x, s.x + s.w); ys.push(s.y, s.y + s.h);
    }
    return { xs, ys };
  }

  // ---------------------------------------------------------------------
  // Canvas point helpers
  // ---------------------------------------------------------------------
  function getCanvasPoint(evt) {
    const rect = svg.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function renderAll() {
    renderGrid();
    renderShapes();
    renderSelection();
    updatePropsPanel();
    renderLabelColorsPanel();
    autosave();
    updateSaveStatus();
  }

  function renderGrid() {
    gridLayer.innerHTML = "";
    const g = gridPx();
    if (g < 3) return;
    const w = Number(svg.getAttribute("width"));
    const h = Number(svg.getAttribute("height"));
    const majorEvery = Math.max(1, Math.round(1 / project.gridUnit)); // lines per whole inch
    let i = 0;
    for (let x = 0; x <= w; x += g, i++) {
      const major = i % majorEvery === 0;
      gridLayer.appendChild(svgEl("line", {
        x1: x, y1: 0, x2: x, y2: h,
        class: major ? "grid-line-major" : "grid-line"
      }));
    }
    i = 0;
    for (let y = 0; y <= h; y += g, i++) {
      const major = i % majorEvery === 0;
      gridLayer.appendChild(svgEl("line", {
        x1: 0, y1: y, x2: w, y2: y,
        class: major ? "grid-line-major" : "grid-line"
      }));
    }
  }

  function renderShapes() {
    shapeLayer.innerHTML = "";
    for (const shape of project.shapes) {
      shapeLayer.appendChild(renderShapeNode(shape));
    }
  }

  function renderShapeNode(shape) {
    const g = svgEl("g", { class: "shape-group", "data-id": shape.id, transform: shapeTransform(shape) });

    if (shape.type === "rect") {
      g.appendChild(svgEl("rect", fillAttrs(shape, { x: 0, y: 0, width: shape.w, height: shape.h, fill: shape.fill, class: "shape-fill" })));
      if (shape.dashFrom && shape.dashTo && shape.dashFrom !== "none" && shape.dashTo !== "none" && shape.dashFrom !== shape.dashTo) {
        const p1 = anchorPoint(shape.dashFrom, shape.w, shape.h);
        const p2 = anchorPoint(shape.dashTo, shape.w, shape.h);
        g.appendChild(svgEl("line", { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: "sew-line" }));
      }
      appendLabel(g, shape);

    } else if (shape.type === "sewflip") {
      g.appendChild(svgEl("rect", fillAttrs(shape, { x: 0, y: 0, width: shape.w, height: shape.h, fill: shape.fill, class: "shape-fill" })));
      const c = clamp(shape.cornerSize, 0.05 * PX_PER_INCH, Math.min(shape.w, shape.h));
      const corner = sewCornerGeometry(shape.sewCorner, shape.w, shape.h, c);
      if (corner) {
        g.appendChild(svgEl("path", fillAttrs(shape, {
          d: `M ${corner.tri.map((p) => p.x + "," + p.y).join(" L ")} Z`,
          fill: shape.flipFill, class: "shape-fill"
        })));
        g.appendChild(svgEl("line", {
          x1: corner.diag[0].x, y1: corner.diag[0].y,
          x2: corner.diag[1].x, y2: corner.diag[1].y,
          class: "sew-line"
        }));
        g.appendChild(svgEl("line", {
          x1: corner.foldFrom.x, y1: corner.foldFrom.y,
          x2: corner.foldTo.x, y2: corner.foldTo.y,
          class: "press-arrow"
        }));
      }
      appendLabel(g, shape);

    } else if (shape.type === "hst") {
      const tri = hstTriangles(shape.diagonal, shape.w, shape.h);
      g.appendChild(svgEl("path", fillAttrs(shape, { d: pathFromPoints(tri.a), fill: shape.fillA, class: "shape-fill" })));
      g.appendChild(svgEl("path", fillAttrs(shape, { d: pathFromPoints(tri.b), fill: shape.fillB, class: "shape-fill" })));
      if (shape.pressLine && shape.pressLine !== "none") {
        const corners = hstDiagonalEndpoints(shape.diagonal, shape.w, shape.h);
        const inset = clamp(Math.min(shape.w, shape.h) * 0.14, 6, 20);
        const [p1, p2] = insetLine(corners[0], corners[1], inset);
        g.appendChild(svgEl("line", {
          x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
          class: shape.pressLine === "dashed" ? "sew-line" : "press-line-solid"
        }));
      }
      // Press-direction arrow: a short tick CROSSING the seam, perpendicular
      // to it, pointing into whichever triangle the fabric folds toward —
      // this shows fold direction, not the seam's own direction, so it's
      // drawn independently of (and doesn't reuse) the seam line above.
      hstPressArrowArms(shape).forEach((arm) => {
        const attrs = { x1: arm.x1, y1: arm.y1, x2: arm.x2, y2: arm.y2, class: "press-arrow" };
        if (arm.arrowStart) attrs["marker-start"] = "url(#arrowHead)"; // 'both' gets arrowheads at each end
        g.appendChild(svgEl("line", attrs));
      });
      if (shape.labelA) appendTriLabel(g, shape.labelA, shape.w, shape.h, tri.centroidA, shape.labelPosA, shape.labelSizeA);
      if (shape.labelB) appendTriLabel(g, shape.labelB, shape.w, shape.h, tri.centroidB, shape.labelPosB, shape.labelSizeB);

    } else if (shape.type === "arrow") {
      g.appendChild(svgEl("line", {
        x1: 2, y1: shape.h / 2, x2: shape.w - 2, y2: shape.h / 2,
        class: "press-arrow"
      }));

    } else if (shape.type === "text") {
      const t = svgEl("text", { x: 0, y: shape.h * 0.75, class: "free-text", fill: shape.fill });
      t.textContent = shape.text || "";
      g.appendChild(t);
    }

    g.addEventListener("mousedown", (evt) => onShapeMouseDown(evt, shape));
    return g;
  }

  // Where a label can sit on a shape: dead center, or tucked into a corner
  // (with a margin scaled to the shape so it stays clear of the edges).
  // centerPt overrides where "center" lands — used for an HST triangle's
  // own centroid, which isn't the middle of the whole square.
  function labelPoint(pos, w, h, centerPt) {
    const m = clamp(Math.min(w, h) * 0.16, 4, 22);
    switch (pos) {
      case "tl": return { x: m, y: m };
      case "tr": return { x: w - m, y: m };
      case "bl": return { x: m, y: h - m };
      case "br": return { x: w - m, y: h - m };
      default: return centerPt || { x: w / 2, y: h / 2 };
    }
  }

  function appendLabel(g, shape) {
    if (!shape.label) return;
    const pos = shape.labelPos || "center";
    const pt = labelPoint(pos, shape.w, shape.h);
    const autoSize = clamp(Math.min(shape.w, shape.h) * 0.42, 10, 34);
    const fontSize = shape.labelSize
      ? inchesToPx(shape.labelSize)
      : (pos === "center" ? autoSize : clamp(autoSize * 0.55, 9, 22));
    const t = svgEl("text", { x: pt.x, y: pt.y, class: "shape-label-text", "font-size": fontSize });
    t.textContent = shape.label;
    g.appendChild(t);
  }

  function pathFromPoints(pts) {
    return `M ${pts.map((p) => p.x + "," + p.y).join(" L ")} Z`;
  }

  function centroid(pts) {
    const n = pts.length;
    return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
  }

  // diagonal 'tlbr' = \ (top-left to bottom-right), 'trbl' = / (top-right to bottom-left)
  function hstTriangles(diagonal, w, h) {
    let a, b;
    if (diagonal === "trbl") {
      a = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }];   // top-left triangle
      b = [{ x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];   // bottom-right triangle
    } else {
      a = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }];   // top-right triangle
      b = [{ x: 0, y: 0 }, { x: w, y: h }, { x: 0, y: h }];   // bottom-left triangle
    }
    return { a, b, centroidA: centroid(a), centroidB: centroid(b) };
  }

  // The two true corners the HST's diagonal split runs between.
  function hstDiagonalEndpoints(diagonal, w, h) {
    return diagonal === "trbl"
      ? [{ x: w, y: 0 }, { x: 0, y: h }]
      : [{ x: 0, y: 0 }, { x: w, y: h }];
  }

  // The OTHER two corners — each triangle's own unique corner, not shared
  // with the diagonal split. In a square these sit on the anti-diagonal,
  // which is exactly perpendicular to the seam — so the fold arrow runs
  // corner-to-corner along this line, the same way the seam line runs
  // corner-to-corner along its own diagonal.
  function hstOffDiagonalCorners(diagonal, w, h) {
    return diagonal === "trbl"
      ? { apexA: { x: 0, y: 0 }, apexB: { x: w, y: h } }
      : { apexA: { x: w, y: 0 }, apexB: { x: 0, y: h } };
  }

  // Shortens a line by `inset` px at each end (keeping its midpoint fixed),
  // so a seam/press line can be drawn offset from the true corners rather
  // than touching them.
  function insetLine(p1, p2, inset) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const m = Math.min(inset, len / 2 - 1);
    return [
      { x: p1.x + ux * m, y: p1.y + uy * m },
      { x: p2.x - ux * m, y: p2.y - uy * m }
    ];
  }

  // Old saved projects (and the old UI) used 'start'/'end' to mean an arrow
  // at one end of the seam line itself (parallel to it). The arrow is now
  // perpendicular to the seam instead, so those map onto "points toward
  // triangle A" / "points toward triangle B".
  function normalizePressArrow(v) {
    if (v === "start") return "towardA";
    if (v === "end") return "towardB";
    if (v === "towardA" || v === "towardB" || v === "both") return v;
    return "none";
  }

  // The "press this way" fold arrow, crossing the HST's diagonal
  // perpendicular to it, pointing into triangle A's side, triangle B's
  // side, or both. It runs from one true corner to the other (inset from
  // both, same convention as the seam line) rather than a short tick out
  // from the seam's midpoint. Independent of whether the seam line itself
  // is drawn.
  function hstPressArrowArms(shape) {
    const mode = normalizePressArrow(shape.pressArrow);
    if (mode === "none") return [];
    const { apexA, apexB } = hstOffDiagonalCorners(shape.diagonal, shape.w, shape.h);
    const inset = clamp(Math.min(shape.w, shape.h) * 0.14, 6, 20);
    const [pB, pA] = insetLine(apexB, apexA, inset);

    const arms = [];
    if (mode === "towardA") arms.push({ x1: pB.x, y1: pB.y, x2: pA.x, y2: pA.y, arrowStart: false });
    if (mode === "towardB") arms.push({ x1: pA.x, y1: pA.y, x2: pB.x, y2: pB.y, arrowStart: false });
    if (mode === "both") arms.push({ x1: pB.x, y1: pB.y, x2: pA.x, y2: pA.y, arrowStart: true });
    return arms;
  }

  function appendTriLabel(g, label, w, h, centroidPt, pos, sizeIn) {
    pos = pos || "center";
    const pt = labelPoint(pos, w, h, centroidPt);
    const autoSize = clamp(Math.min(w, h) * 0.3, 9, 26);
    const fontSize = sizeIn
      ? inchesToPx(sizeIn)
      : (pos === "center" ? autoSize : clamp(autoSize * 0.6, 8, 18));
    const t = svgEl("text", { x: pt.x, y: pt.y, class: "shape-label-text", "font-size": fontSize });
    t.textContent = label;
    g.appendChild(t);
  }

  // Fixed anchor points on a shape's bounding box, used for the rect tool's
  // optional dashed line (corner-to-corner, mid-to-mid, or any combination).
  function anchorPoint(name, w, h) {
    switch (name) {
      case "tl": return { x: 0, y: 0 };
      case "tr": return { x: w, y: 0 };
      case "bl": return { x: 0, y: h };
      case "br": return { x: w, y: h };
      case "topMid": return { x: w / 2, y: 0 };
      case "bottomMid": return { x: w / 2, y: h };
      case "leftMid": return { x: 0, y: h / 2 };
      case "rightMid": return { x: w, y: h / 2 };
      default: return { x: w / 2, y: h / 2 };
    }
  }

  // corner: 'tl'|'tr'|'bl'|'br'; returns triangle points, the diagonal endpoints,
  // and a short fold-direction line from the shape center toward the corner.
  function sewCornerGeometry(corner, w, h, c) {
    let tri, diag, apex;
    if (corner === "tl") {
      tri = [{ x: 0, y: 0 }, { x: c, y: 0 }, { x: 0, y: c }];
      diag = [{ x: c, y: 0 }, { x: 0, y: c }];
      apex = { x: 0, y: 0 };
    } else if (corner === "tr") {
      tri = [{ x: w, y: 0 }, { x: w - c, y: 0 }, { x: w, y: c }];
      diag = [{ x: w - c, y: 0 }, { x: w, y: c }];
      apex = { x: w, y: 0 };
    } else if (corner === "bl") {
      tri = [{ x: 0, y: h }, { x: c, y: h }, { x: 0, y: h - c }];
      diag = [{ x: c, y: h }, { x: 0, y: h - c }];
      apex = { x: 0, y: h };
    } else if (corner === "br") {
      tri = [{ x: w, y: h }, { x: w - c, y: h }, { x: w, y: h - c }];
      diag = [{ x: w - c, y: h }, { x: w, y: h - c }];
      apex = { x: w, y: h };
    } else {
      return null;
    }
    // Fold/press arrow: a short tick along the seam edge itself (the same
    // edge the accent triangle is cut on), inset from its two true-corner
    // endpoints — the same convention used for the HST press-line, so it
    // reads as "press this seam this way" near the corner, not a line
    // spanning out to the shape's center.
    const inset = clamp(c * 0.22, 3, 16);
    const [foldFrom, foldTo] = insetLine(diag[0], diag[1], inset);
    return { tri, diag, foldFrom, foldTo, apex };
  }

  function renderSelection() {
    selectionLayer.innerHTML = "";
    const ids = Array.from(selection);
    const shapes = ids.map((id) => project.shapes.find((s) => s.id === id)).filter(Boolean);
    if (!shapes.length) return;

    // If the selection is exactly one complete composite group, draw a
    // single unified box around it instead of a box per piece — that's the
    // visual cue that these pieces are grouped, not just multi-selected.
    const gid = shapes[0].groupId;
    const isWholeGroup = shapes.length > 1 && gid &&
      shapes.every((s) => s.groupId === gid) &&
      project.shapes.filter((s) => s.groupId === gid).length === shapes.length;

    if (isWholeGroup) {
      const bbox = computeBBox(shapes);
      selectionLayer.appendChild(svgEl("rect", {
        x: bbox.x, y: bbox.y, width: bbox.w, height: bbox.h, class: "selection-box group-box"
      }));
      return;
    }

    for (const shape of shapes) {
      const g = svgEl("g", { transform: shapeTransform(shape) });
      g.appendChild(svgEl("rect", {
        x: -3, y: -3, width: shape.w + 6, height: shape.h + 6, class: "selection-box"
      }));
      const showHandles = shapes.length === 1 && (shape.rotation % 180 === 0) && shape.type !== "text";
      if (showHandles) {
        const pts = [[0, 0], [shape.w, 0], [shape.w, shape.h], [0, shape.h]];
        const names = ["tl", "tr", "br", "bl"];
        pts.forEach((p, i) => {
          const h = svgEl("rect", {
            x: p[0] - 5, y: p[1] - 5, width: 10, height: 10,
            class: "selection-handle", "data-handle": names[i]
          });
          h.addEventListener("mousedown", (evt) => onHandleMouseDown(evt, shape, names[i]));
          g.appendChild(h);
        });
      }
      selectionLayer.appendChild(g);
    }
  }

  // ---------------------------------------------------------------------
  // Properties panel
  // ---------------------------------------------------------------------
  function selectedShapes() {
    return project.shapes.filter((s) => selection.has(s.id));
  }

  function updatePropsPanel() {
    const sel = selectedShapes();
    if (sel.length === 0) {
      propsEmpty.hidden = false;
      propsForm.hidden = true;
      return;
    }
    propsEmpty.hidden = true;
    propsForm.hidden = false;

    const single = sel.length === 1 ? sel[0] : null;
    const multi = sel.length > 1;

    document.getElementById("propSize").hidden = multi || single.type === "text";
    propLabelRow.hidden = multi || !(single.type === "rect" || single.type === "sewflip");
    propHstRow.hidden = multi || single.type !== "hst";
    propHstRow2.hidden = multi || single.type !== "hst";
    propHstRow3.hidden = multi || single.type !== "hst";
    propHstRow4.hidden = multi || single.type !== "hst";
    propSewRow.hidden = multi || single.type !== "sewflip";
    propDashRow.hidden = multi || single.type !== "rect";
    propTextRow.hidden = multi || single.type !== "text";
    document.getElementById("propFillRow").hidden = !multi && single.type === "hst"; // hst uses fillA/fillB instead

    const borderedSel = sel.filter((s) => BORDERED_TYPES.includes(s.type));
    propBorderRow.hidden = borderedSel.length === 0;
    if (borderedSel.length) {
      // for a multi-selection this reflects whether ALL selected bordered
      // pieces currently have their border hidden, not just the first one
      propHideBorder.checked = borderedSel.every((s) => s.hideBorder);
    }

    if (single) {
      propW.value = round2(pxToInches(single.w));
      propH.value = round2(pxToInches(single.h));
      propLabel.value = single.label || "";
      propColorSwatch.style.background = single.label ? getColorForLabel(single.label) : "transparent";
      propLabelPos.value = single.labelPos || "center";
      propLabelSize.value = single.labelSize ? round2(single.labelSize) : "";
      if (single.type === "sewflip") {
        propSewCorner.value = single.sewCorner;
        propCornerSize.value = round2(pxToInches(single.cornerSize));
      }
      if (single.type === "rect") {
        propDashFrom.value = single.dashFrom || "none";
        propDashTo.value = single.dashTo || "none";
      }
      if (single.type === "hst") {
        propLabelA.value = single.labelA || "";
        propLabelB.value = single.labelB || "";
        propColorSwatchA.style.background = single.fillA;
        propColorSwatchB.style.background = single.fillB;
        propLabelPosA.value = single.labelPosA || "center";
        propLabelSizeA.value = single.labelSizeA ? round2(single.labelSizeA) : "";
        propLabelPosB.value = single.labelPosB || "center";
        propLabelSizeB.value = single.labelSizeB ? round2(single.labelSizeB) : "";
        propPressLine.value = single.pressLine || "none";
        propPressArrow.value = normalizePressArrow(single.pressArrow);
      }
      if (single.type === "text") {
        propText.value = single.text || "";
      }
      propFill.value = single.fill && single.fill.startsWith("#") ? single.fill : "#f3ede3";
      propRotation.value = single.rotation;
    }
  }

  function withPropsSnapshot(fn) {
    if (!propsSnapshotTaken) { pushHistory(); propsSnapshotTaken = true; }
    fn();
    renderAll();
  }

  [propW, propH, propLabel, propLabelPos, propLabelSize, propLabelA, propLabelPosA, propLabelSizeA,
    propLabelB, propLabelPosB, propLabelSizeB, propPressLine, propPressArrow, propSewCorner, propCornerSize,
    propDashFrom, propDashTo, propText, propFill, propHideBorder, propRotation].forEach((el) => {
    el.addEventListener("focus", () => { propsSnapshotTaken = false; });
    el.addEventListener("blur", () => { propsSnapshotTaken = false; });
  });

  propW.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s) return;
    const v = Math.max(MIN_SIZE_IN, parseFloat(propW.value) || MIN_SIZE_IN);
    withPropsSnapshot(() => { s.w = inchesToPx(v); });
  });
  propH.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s) return;
    const v = Math.max(MIN_SIZE_IN, parseFloat(propH.value) || MIN_SIZE_IN);
    withPropsSnapshot(() => { s.h = inchesToPx(v); });
  });
  propLabel.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s) return;
    const v = (propLabel.value || "").toUpperCase().slice(0, 2);
    withPropsSnapshot(() => {
      s.label = v;
      if (v) s.fill = getColorForLabel(v);
    });
  });
  propLabelPos.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s) return;
    withPropsSnapshot(() => { s.labelPos = propLabelPos.value; });
  });
  propLabelSize.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s) return;
    const raw = propLabelSize.value;
    withPropsSnapshot(() => { s.labelSize = raw === "" ? null : Math.max(0.05, parseFloat(raw) || 0.05); });
  });
  propLabelA.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s || s.type !== "hst") return;
    const v = (propLabelA.value || "").toUpperCase().slice(0, 2);
    withPropsSnapshot(() => {
      s.labelA = v;
      if (v) s.fillA = getColorForLabel(v);
    });
  });
  propLabelPosA.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s || s.type !== "hst") return;
    withPropsSnapshot(() => { s.labelPosA = propLabelPosA.value; });
  });
  propLabelSizeA.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s || s.type !== "hst") return;
    const raw = propLabelSizeA.value;
    withPropsSnapshot(() => { s.labelSizeA = raw === "" ? null : Math.max(0.05, parseFloat(raw) || 0.05); });
  });
  propLabelB.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s || s.type !== "hst") return;
    const v = (propLabelB.value || "").toUpperCase().slice(0, 2);
    withPropsSnapshot(() => {
      s.labelB = v;
      if (v) s.fillB = getColorForLabel(v);
    });
  });
  propLabelPosB.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s || s.type !== "hst") return;
    withPropsSnapshot(() => { s.labelPosB = propLabelPosB.value; });
  });
  propLabelSizeB.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s || s.type !== "hst") return;
    const raw = propLabelSizeB.value;
    withPropsSnapshot(() => { s.labelSizeB = raw === "" ? null : Math.max(0.05, parseFloat(raw) || 0.05); });
  });
  propPressLine.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s || s.type !== "hst") return;
    withPropsSnapshot(() => { s.pressLine = propPressLine.value; });
  });
  propPressArrow.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s || s.type !== "hst") return;
    withPropsSnapshot(() => { s.pressArrow = propPressArrow.value; });
  });
  btnFlipDiagonal.addEventListener("click", () => {
    const s = selectedShapes()[0]; if (!s || s.type !== "hst") return;
    pushHistory();
    s.diagonal = s.diagonal === "tlbr" ? "trbl" : "tlbr";
    renderAll();
  });
  propSewCorner.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s) return;
    withPropsSnapshot(() => { s.sewCorner = propSewCorner.value; });
  });
  propCornerSize.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s) return;
    const v = Math.max(0.05, parseFloat(propCornerSize.value) || 0.5);
    withPropsSnapshot(() => { s.cornerSize = inchesToPx(v); });
  });
  propDashFrom.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s || s.type !== "rect") return;
    withPropsSnapshot(() => { s.dashFrom = propDashFrom.value; });
  });
  propDashTo.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s || s.type !== "rect") return;
    withPropsSnapshot(() => { s.dashTo = propDashTo.value; });
  });
  propText.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s) return;
    withPropsSnapshot(() => { s.text = propText.value; });
  });
  propFill.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s) return;
    withPropsSnapshot(() => { s.fill = propFill.value; });
  });
  propHideBorder.addEventListener("change", () => {
    // applies to every bordered piece in the current selection, not just
    // the first one — this is meant as a bulk action (like rotate/mirror),
    // since you'll often select several pieces you want to strip at once
    const sel = selectedShapes().filter((s) => BORDERED_TYPES.includes(s.type));
    if (!sel.length) return;
    const val = propHideBorder.checked;
    withPropsSnapshot(() => { sel.forEach((s) => { s.hideBorder = val; }); });
  });
  propRotation.addEventListener("change", () => {
    const s = selectedShapes()[0]; if (!s) return;
    let v = parseFloat(propRotation.value) || 0;
    v = ((v % 360) + 360) % 360;
    withPropsSnapshot(() => { s.rotation = v; });
  });

  // ---------------------------------------------------------------------
  // Tool switching
  // ---------------------------------------------------------------------
  function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll(".tool").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-tool") === tool);
    });
  }

  document.querySelectorAll(".tool").forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.getAttribute("data-tool")));
  });

  // ---------------------------------------------------------------------
  // Mouse interaction: draw / move / resize / select
  // ---------------------------------------------------------------------
  function selectOnly(id) { selection.clear(); if (id) selection.add(id); }

  function groupMateIds(shape) {
    if (!shape.groupId) return [shape.id];
    return project.shapes.filter((s) => s.groupId === shape.groupId).map((s) => s.id);
  }

  function onShapeMouseDown(evt, shape) {
    if (currentTool !== "select") return; // drawing tools ignore existing shapes
    evt.stopPropagation();
    // A double-click drills into one member of a group, for fine edits on
    // just that piece; a single click on a grouped shape selects the whole
    // composite so it moves/rotates/duplicates as one unit.
    const drillIn = evt.detail >= 2;
    const targetIds = drillIn ? [shape.id] : groupMateIds(shape);

    if (evt.shiftKey) {
      if (selection.has(shape.id)) targetIds.forEach((id) => selection.delete(id));
      else targetIds.forEach((id) => selection.add(id));
    } else if (drillIn || !selection.has(shape.id)) {
      selection = new Set(targetIds);
    }
    renderSelection();
    updatePropsPanel();

    if (!selection.has(shape.id)) return;
    pushHistory();
    const pt = getCanvasPoint(evt);
    const starts = {};
    selectedShapes().forEach((s) => { starts[s.id] = { x: s.x, y: s.y }; });
    drag = { mode: "move", startPt: pt, primary: shape, starts };
  }

  function onHandleMouseDown(evt, shape, handle) {
    evt.stopPropagation();
    pushHistory();
    drag = {
      mode: "resize", handle, shape,
      orig: { x: shape.x, y: shape.y, w: shape.w, h: shape.h }
    };
  }

  svg.addEventListener("mousedown", (evt) => {
    if (drag) return;
    const pt = getCanvasPoint(evt);

    if (currentTool === "select") {
      if (evt.target === svg || evt.target === gridLayer) {
        const additive = evt.shiftKey;
        const base = additive ? new Set(selection) : new Set();
        if (!additive) { selectOnly(null); renderSelection(); updatePropsPanel(); }
        drag = { mode: "marquee", startPt: pt, base, additive };
      }
      return;
    }

    if (currentTool === "text") {
      pushHistory();
      const cands = drawCandidates();
      const sx = snapFree(pt.x, cands.xs), sy = snapFree(pt.y, cands.ys);
      const shape = makeText(sx, sy);
      project.shapes.push(shape);
      selectOnly(shape.id);
      setTool("select");
      renderAll();
      return;
    }

    pushHistory();
    const cands = drawCandidates();
    const sx = snapFree(pt.x, cands.xs), sy = snapFree(pt.y, cands.ys);
    let shape;
    if (currentTool === "rect") shape = makeRect(sx, sy, 1, 1);
    else if (currentTool === "hst") shape = makeHST(sx, sy, 1, 1);
    else if (currentTool === "sewflip") shape = makeSewFlip(sx, sy, 1, 1);
    else if (currentTool === "arrow") shape = makeArrow(sx, sy, 1, 1);
    else return;

    project.shapes.push(shape);
    drag = { mode: "draw", tool: currentTool, startPt: { x: sx, y: sy }, shape };
    renderAll();
  });

  document.addEventListener("mousemove", (evt) => {
    if (!drag) return;
    const pt = getCanvasPoint(evt);

    if (drag.mode === "move") {
      const dx = pt.x - drag.startPt.x, dy = pt.y - drag.startPt.y;
      const s = drag.primary;
      const startPos = drag.starts[s.id];
      const snapped = snapShapeMove(s, startPos.x + dx, startPos.y + dy);
      const usedDx = snapped.x - startPos.x, usedDy = snapped.y - startPos.y;
      selectedShapes().forEach((sh) => {
        const start = drag.starts[sh.id];
        sh.x = start.x + usedDx;
        sh.y = start.y + usedDy;
      });
      renderAll();

    } else if (drag.mode === "draw") {
      const cands = drawCandidates(drag.shape.id);
      const ex = snapFree(pt.x, cands.xs), ey = snapFree(pt.y, cands.ys);
      const s = drag.shape;
      const x0 = drag.startPt.x, y0 = drag.startPt.y;
      s.x = Math.min(x0, ex);
      s.y = Math.min(y0, ey);
      s.w = Math.max(4, Math.abs(ex - x0));
      s.h = Math.max(4, Math.abs(ey - y0));
      // Keep the accent corner proportional to the shape as it's drawn —
      // cornerSize starts tiny (the shape is 1x1px when the drag begins),
      // so it must scale up with w/h, not just clamp down.
      if (s.type === "sewflip") s.cornerSize = Math.min(s.w, s.h) * 0.5;
      if (s.type === "arrow") s.h = 20;
      renderAll();

    } else if (drag.mode === "resize") {
      const s = drag.shape, o = drag.orig;
      const cands = drawCandidates(s.id).xs.concat(); // reuse point-snap for corner
      const cx = snapFree(pt.x, drawCandidates(s.id).xs);
      const cy = snapFree(pt.y, drawCandidates(s.id).ys);
      let x = o.x, y = o.y, w = o.w, h = o.h;
      if (drag.handle === "tl") { w = (o.x + o.w) - cx; h = (o.y + o.h) - cy; x = cx; y = cy; }
      else if (drag.handle === "tr") { w = cx - o.x; h = (o.y + o.h) - cy; y = cy; }
      else if (drag.handle === "bl") { w = (o.x + o.w) - cx; x = cx; h = cy - o.y; }
      else if (drag.handle === "br") { w = cx - o.x; h = cy - o.y; }
      const minPx = inchesToPx(MIN_SIZE_IN);
      s.w = Math.max(minPx, w);
      s.h = Math.max(minPx, h);
      s.x = x; s.y = y;
      if (s.type === "sewflip") s.cornerSize = Math.min(s.cornerSize, Math.min(s.w, s.h));
      renderAll();

    } else if (drag.mode === "marquee") {
      const x1 = Math.min(drag.startPt.x, pt.x), x2 = Math.max(drag.startPt.x, pt.x);
      const y1 = Math.min(drag.startPt.y, pt.y), y2 = Math.max(drag.startPt.y, pt.y);
      marqueeLayer.innerHTML = "";
      marqueeLayer.appendChild(svgEl("rect", {
        x: x1, y: y1, width: x2 - x1, height: y2 - y1, class: "marquee-box"
      }));
      const overlapping = new Set(project.shapes
        .filter((s) => {
          const b = shapeWorldBBox(s);
          return !(b.x2 < x1 || b.x > x2 || b.y2 < y1 || b.y > y2);
        })
        .map((s) => s.id));
      // pull in the rest of any group that the marquee only partly touched,
      // so a composite piece is always selected (and dragged) as a whole
      project.shapes.forEach((s) => {
        if (s.groupId && overlapping.has(s.id)) {
          groupMateIds(s).forEach((id) => overlapping.add(id));
        }
      });
      selection = new Set([...drag.base, ...overlapping]);
      renderSelection();
      updatePropsPanel();
    }
  });

  document.addEventListener("mouseup", () => {
    if (!drag) return;
    if (drag.mode === "draw") {
      const s = drag.shape;
      if (pxToInches(s.w) < MIN_SIZE_IN || pxToInches(s.h) < MIN_SIZE_IN) {
        project.shapes = project.shapes.filter((sh) => sh.id !== s.id);
      } else {
        selectOnly(s.id);
        setTool("select");
      }
      renderAll();
    } else if (drag.mode === "marquee") {
      marqueeLayer.innerHTML = "";
    }
    drag = null;
    updateAutosaveStatus(); // catch up the label now that it's safe to let the topbar reflow
  });

  // ---------------------------------------------------------------------
  // Toolbar actions: undo/redo/duplicate/rotate/mirror/delete
  // ---------------------------------------------------------------------
  document.getElementById("btnUndo").addEventListener("click", undo);
  document.getElementById("btnRedo").addEventListener("click", redo);

  document.getElementById("btnDuplicate").addEventListener("click", duplicateSelection);
  document.getElementById("btnRotateCCW").addEventListener("click", () => rotateSelection(-45));
  document.getElementById("btnRotateCW").addEventListener("click", () => rotateSelection(45));
  document.getElementById("btnMirrorH").addEventListener("click", () => mirrorSelection("x"));
  document.getElementById("btnMirrorV").addEventListener("click", () => mirrorSelection("y"));
  document.getElementById("btnDelete").addEventListener("click", deleteSelection);
  document.getElementById("btnGroup").addEventListener("click", groupSelection);
  document.getElementById("btnUngroup").addEventListener("click", ungroupSelection);

  function groupSelection() {
    const sel = selectedShapes();
    if (sel.length < 2) return;
    pushHistory();
    const gid = groupUid();
    sel.forEach((s) => { s.groupId = gid; });
    renderAll();
  }

  function ungroupSelection() {
    const sel = selectedShapes();
    if (!sel.some((s) => s.groupId)) return;
    pushHistory();
    sel.forEach((s) => { s.groupId = null; });
    renderAll();
  }

  function duplicateSelection() {
    const sel = selectedShapes();
    if (!sel.length) return;
    pushHistory();
    const offset = gridPx();
    const newIds = [];
    const groupMap = {}; // old groupId -> new groupId, so duplicates form their own composite piece
    sel.forEach((s) => {
      const copy = clone(s);
      copy.id = uid();
      copy.x += offset;
      copy.y += offset;
      if (copy.groupId) {
        if (!groupMap[copy.groupId]) groupMap[copy.groupId] = groupUid();
        copy.groupId = groupMap[copy.groupId];
      }
      project.shapes.push(copy);
      newIds.push(copy.id);
    });
    selection = new Set(newIds);
    renderAll();
  }

  // A shape's own center point in world space is always (x + w/2, y + h/2),
  // regardless of its rotation — translate(x,y) happens before the
  // rotate-around-center dance in shapeTransform, so that point never moves
  // under rotation. That makes "rotate/mirror the whole selection as one
  // rigid body" straightforward: revolve/reflect each shape's center point
  // around the selection's shared pivot, then re-derive x/y from it.
  function rotatePointAround(pivot, pt, deg) {
    const rad = (deg * Math.PI) / 180;
    const dx = pt.x - pivot.x, dy = pt.y - pivot.y;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
  }

  function rotateSelection(delta) {
    const sel = selectedShapes();
    if (!sel.length) return;
    pushHistory();
    // computeBBox's center is the same point whether it's one shape (its own
    // center) or several (the group's shared center) — so a lone shape still
    // just spins in place, and a multi-shape selection wheels around as one.
    const bbox = computeBBox(sel);
    const pivot = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };
    sel.forEach((s) => {
      const center = rotatePointAround(pivot, { x: s.x + s.w / 2, y: s.y + s.h / 2 }, delta);
      s.x = center.x - s.w / 2;
      s.y = center.y - s.h / 2;
      s.rotation = ((s.rotation + delta) % 360 + 360) % 360;
    });
    renderAll();
  }

  function mirrorSelection(axis) {
    const sel = selectedShapes();
    if (!sel.length) return;
    pushHistory();
    const bbox = computeBBox(sel);
    const pivot = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };
    sel.forEach((s) => {
      const center = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
      if (axis === "x") { s.mirrorX = !s.mirrorX; center.x = 2 * pivot.x - center.x; }
      else { s.mirrorY = !s.mirrorY; center.y = 2 * pivot.y - center.y; }
      // A reflection reverses which way "clockwise" looks, so a shape's own
      // rotation has to flip sign too — otherwise a rotated piece comes out
      // mirrored on the wrong diagonal. (This was subtly wrong even for a
      // single rotated shape before, not just for groups.)
      s.rotation = ((-s.rotation) % 360 + 360) % 360;
      s.x = center.x - s.w / 2;
      s.y = center.y - s.h / 2;
    });
    renderAll();
  }

  function deleteSelection() {
    if (!selection.size) return;
    pushHistory();
    project.shapes = project.shapes.filter((s) => !selection.has(s.id));
    selection.clear();
    renderAll();
  }

  // ---------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------
  document.addEventListener("keydown", (evt) => {
    if (isTypingTarget(evt.target)) return;
    const key = evt.key.toLowerCase();
    if ((evt.ctrlKey || evt.metaKey) && key === "z" && evt.shiftKey) { evt.preventDefault(); redo(); return; }
    if ((evt.ctrlKey || evt.metaKey) && key === "z") { evt.preventDefault(); undo(); return; }
    if ((evt.ctrlKey || evt.metaKey) && key === "d") { evt.preventDefault(); duplicateSelection(); return; }
    if ((evt.ctrlKey || evt.metaKey) && key === "g" && evt.shiftKey) { evt.preventDefault(); ungroupSelection(); return; }
    if ((evt.ctrlKey || evt.metaKey) && key === "g") { evt.preventDefault(); groupSelection(); return; }
    if (key === "delete" || key === "backspace") { evt.preventDefault(); deleteSelection(); return; }
    if (key === "v") setTool("select");
    if (key === "r") setTool("rect");
    if (key === "h") setTool("hst");
    if (key === "f") setTool("sewflip");
    if (key === "a") setTool("arrow");
    if (key === "t") setTool("text");
  });

  // ---------------------------------------------------------------------
  // Grid unit selector
  // ---------------------------------------------------------------------
  gridUnitSelect.addEventListener("change", () => {
    project.gridUnit = parseFloat(gridUnitSelect.value);
    renderAll();
  });

  function applyBorderSetting() {
    svg.classList.toggle("no-borders", !project.showBorders);
    chkBorders.checked = project.showBorders;
  }
  chkBorders.addEventListener("change", () => {
    project.showBorders = chkBorders.checked;
    applyBorderSetting();
    fileDirty = true;
    autosave();
    updateSaveStatus();
  });

  // ---------------------------------------------------------------------
  // Save / Load (local only, no server — like Excalidraw)
  //
  // Where the browser supports it (Chrome/Edge), Save/Save As/Load Project
  // use the File System Access API to work with a real file on disk: Load
  // Project keeps a handle to whatever file you opened, and Save then
  // writes straight back into it — a true overwrite, no dialog, no
  // "(1)" copies piling up in Downloads. Save As always prompts for a
  // location and remembers that as the new target for future Saves.
  // Firefox/Safari don't support that API, so there we fall back to the
  // old behavior: Save/Save As both just trigger a normal browser download.
  // ---------------------------------------------------------------------
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadText(text, filename, mime) {
    downloadBlob(new Blob([text], { type: mime }), filename);
  }

  function projectDataObject() {
    return {
      version: 1,
      gridUnit: project.gridUnit,
      labelColors: project.labelColors,
      showBorders: project.showBorders,
      shapes: project.shapes
    };
  }

  function serializeProject() {
    return JSON.stringify(projectDataObject(), null, 2);
  }

  const FILE_PICKER_TYPES = [{
    description: "Quilt Handout Project",
    accept: { "application/json": [".qhd.json"] }
  }];

  function updateSaveStatus() {
    const el = document.getElementById("fileStatus");
    if (!el) return;
    if (!currentFileName) {
      el.textContent = "";
      el.title = "";
      return;
    }
    el.textContent = (fileDirty ? "● " : "") + currentFileName;
    el.title = fileDirty
      ? `Unsaved changes to ${currentFileName} — click Save to write them to the file.`
      : hasFSAccess && currentFileHandle
        ? `Saved to ${currentFileName}.`
        : `Loaded from ${currentFileName} (this browser can't overwrite it directly — Save will download a new copy).`;
  }

  async function writeToHandle(handle, text) {
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async function saveProject() {
    const text = serializeProject();
    if (hasFSAccess && currentFileHandle) {
      try {
        await writeToHandle(currentFileHandle, text);
        fileDirty = false;
        updateSaveStatus();
      } catch (e) {
        console.error(e);
        alert(`Couldn't save to ${currentFileName || "the file"} — try Save As to pick the file again.`);
      }
      return;
    }
    if (hasFSAccess) { await saveProjectAs(); return; }
    // No File System Access support in this browser — same download-a-copy
    // behavior it's always had. We can't confirm the download actually
    // landed anywhere or overwrote the right file, but from here that's as
    // "saved" as this browser can tell us, so treat it that way: clear the
    // dirty flag so Save doesn't keep nagging right after you just used it.
    currentFileName = currentFileName || "quilt-handout-project.qhd.json";
    downloadText(text, currentFileName, "application/json");
    fileDirty = false;
    updateSaveStatus();
  }

  async function saveProjectAs() {
    const text = serializeProject();
    if (hasFSAccess) {
      let handle;
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: currentFileName || "quilt-handout-project.qhd.json",
          types: FILE_PICKER_TYPES
        });
      } catch (e) {
        if (e && e.name === "AbortError") return; // user cancelled the dialog
        console.error(e);
        alert("Couldn't open a save dialog.");
        return;
      }
      try {
        await writeToHandle(handle, text);
        currentFileHandle = handle;
        currentFileName = handle.name;
        fileDirty = false;
        updateSaveStatus();
      } catch (e) {
        console.error(e);
        alert("Couldn't save to that file.");
      }
      return;
    }
    // Fallback: this browser can't show a real save dialog, so at least let
    // Save As mean something different from plain Save — ask for a name.
    let name = prompt("Save as filename:", currentFileName || "quilt-handout-project.qhd.json");
    if (name === null) return; // cancelled
    name = name.trim();
    if (!name) return;
    if (!/\.qhd\.json$/i.test(name)) name += ".qhd.json";
    currentFileName = name;
    downloadText(text, currentFileName, "application/json");
    fileDirty = false;
    updateSaveStatus();
  }

  document.getElementById("btnSave").addEventListener("click", () => { saveProject(); });
  document.getElementById("btnSaveAs").addEventListener("click", () => { saveProjectAs(); });

  document.getElementById("btnNew").addEventListener("click", () => {
    if (project.shapes.length && !confirm("Start a new project? Unsaved changes will be lost.")) return;
    pushHistory();
    project.shapes = [];
    project.labelColors = {};
    selection.clear();
    // A blank project has nothing to do with whatever file was open before —
    // don't let a later Save silently overwrite it with this empty state.
    currentFileHandle = null;
    currentFileName = null;
    fileDirty = false;
    renderAll();
  });

  async function openProjectWithPicker() {
    let handle;
    try {
      [handle] = await window.showOpenFilePicker({ types: FILE_PICKER_TYPES, excludeAcceptAllOption: false });
    } catch (e) {
      if (e && e.name === "AbortError") return; // user cancelled the dialog
      console.error(e);
      alert("Couldn't open a file picker.");
      return;
    }
    try {
      const file = await handle.getFile();
      const data = JSON.parse(await file.text());
      loadProjectData(data);
      currentFileHandle = handle;
      currentFileName = handle.name;
      fileDirty = false;
      updateSaveStatus();
    } catch (e) {
      alert("That file doesn't look like a valid project file.");
      console.error(e);
    }
  }

  const fileLoadInput = document.getElementById("fileLoadInput");
  document.getElementById("btnLoad").addEventListener("click", () => {
    if (hasFSAccess) { openProjectWithPicker(); return; }
    fileLoadInput.click();
  });
  // Fallback path for browsers without the File System Access API (Firefox,
  // Safari): a plain file input can't hand us a writable handle, so a
  // project loaded this way can't be overwritten in place — Save falls back
  // to downloading a new copy for it too (see saveProject above).
  fileLoadInput.addEventListener("change", () => {
    const file = fileLoadInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        loadProjectData(data);
        currentFileHandle = null;
        currentFileName = file.name;
        fileDirty = false;
        updateSaveStatus();
      } catch (e) {
        alert("That file doesn't look like a valid project file.");
        console.error(e);
      }
    };
    reader.readAsText(file);
    fileLoadInput.value = "";
  });

  function loadProjectData(data) {
    project.gridUnit = data.gridUnit || 0.25;
    project.labelColors = data.labelColors || {};
    project.showBorders = data.showBorders !== undefined ? data.showBorders : true;
    project.shapes = data.shapes || [];
    // keep future shape/group ids from colliding with loaded ones
    let maxN = 0;
    project.shapes.forEach((s) => {
      const m1 = /^[sg](\d+)$/.exec(s.id || "");
      if (m1) maxN = Math.max(maxN, parseInt(m1[1], 10));
      const m2 = /^[sg](\d+)$/.exec(s.groupId || "");
      if (m2) maxN = Math.max(maxN, parseInt(m2[1], 10));
    });
    nextId = maxN + 1;
    selection.clear();
    undoStack = []; redoStack = [];
    gridUnitSelect.value = String(project.gridUnit);
    applyBorderSetting();
    autosaveArmed = true; // an explicit Load Project, or a confirmed autosave restore — safe to persist from here on
    renderAll();
    updateUndoRedoButtons();
  }

  // ---------------------------------------------------------------------
  // Share link — the whole project packed into a URL, as an alternative to
  // passing the .qhd.json file around. Lives in the URL's hash (#share=...),
  // never the query string, so it's never sent to a server and never shows
  // up in server logs — it only ever exists in the two browsers involved.
  //
  // Payload shape is "<format-tag>.<base64url data>":
  //   gz1 = gzip-compressed, via the browser's built-in CompressionStream —
  //         quilt project JSON is extremely repetitive (the same field names
  //         and values over and over, one per piece) so this typically
  //         shrinks it by 80-90%, which is what keeps even a big, multi-block
  //         design down to a shareable link instead of a monstrous one.
  //   raw1 = plain UTF-8 JSON, no compression — the fallback for a browser
  //          without CompressionStream/DecompressionStream (older Firefox/
  //          Safari). Still works, just a longer link.
  // The tag is written by whichever browser CREATES the link and read by
  // whichever browser OPENS it, so those can be two different browsers
  // without any coordination — decoding just does what the tag says.
  // ---------------------------------------------------------------------
  const SHARE_FORMAT_GZIP = "gz1";
  const SHARE_FORMAT_RAW = "raw1";
  const SHARE_LENGTH_WARN_AT = 6000; // rough point past which some apps (texting, some email clients) start mangling long links

  function bytesToBase64Url(bytes) {
    let binary = "";
    const chunkSize = 0x8000; // avoid a call-stack blowup from String.fromCharCode.apply on a huge array
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function base64UrlToBytes(b64url) {
    let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function gzipCompress(bytes) {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }
  async function gzipDecompress(bytes) {
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }

  async function buildShareUrl() {
    // Compact (no pretty-printing) — the raw1 fallback benefits directly
    // from dropping the indentation, and gzip does slightly less work too.
    const text = JSON.stringify(projectDataObject());
    const rawBytes = new TextEncoder().encode(text);
    let payloadBytes = rawBytes;
    let tag = SHARE_FORMAT_RAW;
    if ("CompressionStream" in window) {
      try {
        payloadBytes = await gzipCompress(rawBytes);
        tag = SHARE_FORMAT_GZIP;
      } catch (e) {
        console.error(e);
        payloadBytes = rawBytes;
        tag = SHARE_FORMAT_RAW;
      }
    }
    const payload = tag + "." + bytesToBase64Url(payloadBytes);
    const url = location.origin + location.pathname + "#share=" + payload;
    return { url, rawSize: rawBytes.length, wireSize: payloadBytes.length };
  }

  async function decodeSharePayload(payload) {
    const dotIdx = payload.indexOf(".");
    if (dotIdx === -1) throw new Error("malformed share payload");
    const tag = payload.slice(0, dotIdx);
    const bytes = base64UrlToBytes(payload.slice(dotIdx + 1));
    let textBytes = bytes;
    if (tag === SHARE_FORMAT_GZIP) {
      if (!("DecompressionStream" in window)) {
        throw new Error("This browser can't decompress this link — try a recent Chrome, Edge, Firefox, or Safari.");
      }
      textBytes = await gzipDecompress(bytes);
    } else if (tag !== SHARE_FORMAT_RAW) {
      throw new Error("Unrecognized share link format (" + tag + ") — it may be from a newer version of this app.");
    }
    return JSON.parse(new TextDecoder().decode(textBytes));
  }

  async function shareProject() {
    let built;
    try {
      built = await buildShareUrl();
    } catch (e) {
      console.error(e);
      alert("Couldn't build a share link.");
      return;
    }
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(built.url);
        copied = true;
      }
    } catch (e) { /* clipboard blocked (common on file://, or without a permission grant) — the prompt below still lets you copy it by hand */ }
    const sizeNote = built.url.length > SHARE_LENGTH_WARN_AT
      ? `\n\nHeads up: this link is ${built.url.length.toLocaleString()} characters long (this project has a lot of pieces) — some apps (texting, some email clients) may mangle or refuse a link this long. If that happens, share the .qhd.json file instead.`
      : "";
    prompt(
      (copied
        ? "Copied to your clipboard! Here it is again in case you need to grab it manually:"
        : "Your browser didn't allow copying automatically here — copy this link manually (it's already selected):") + sizeNote,
      built.url
    );
  }

  // Returns true if a shared project was found in the URL and the user
  // chose to load it (whether or not they then confirmed replacing the
  // current project — either way there's nothing left for the normal
  // autosave-restore prompt to do on top of this).
  async function tryLoadShareLink() {
    const hashMatch = /(?:^#|[&#])share=([^&]+)/.exec(location.hash || "");
    const searchMatch = !hashMatch && /(?:^\?|[&?])share=([^&]+)/.exec(location.search || "");
    const payload = hashMatch ? hashMatch[1] : (searchMatch ? searchMatch[1] : null);
    if (!payload) return false;
    // Consume it from the address bar immediately, whatever happens next —
    // so refreshing doesn't re-prompt forever, and this (possibly very long)
    // payload doesn't linger in the URL bar or browser history.
    history.replaceState(null, "", location.pathname + location.search.replace(/[?&]share=[^&]+/, ""));
    let data;
    try {
      data = await decodeSharePayload(payload);
    } catch (e) {
      console.error(e);
      alert("That share link doesn't look valid: " + (e && e.message ? e.message : e));
      return false;
    }
    const n = (data.shapes || []).length;
    if (!confirm(`Load the shared project (${n} piece${n === 1 ? "" : "s"})? This replaces whatever's currently open here.`)) {
      return false;
    }
    loadProjectData(data);
    // A shared project isn't tied to any file on this machine yet.
    currentFileHandle = null;
    currentFileName = null;
    fileDirty = true;
    updateSaveStatus();
    return true;
  }

  document.getElementById("btnShare").addEventListener("click", () => { shareProject(); });

  const BACKUP_MIN_INTERVAL_MS = 4000; // don't rotate the backup more than this often
  let lastBackupRotationAt = 0;

  function autosave() {
    if (!autosaveArmed) return; // never write on the page's initial render — see autosaveArmed above
    try {
      // Before overwriting the live autosave, roll whatever was there into a
      // second, one-step-behind slot — as long as it looks like a real save
      // (not empty), so a single bad write can never wipe out both copies.
      // Throttled: autosave() fires on every mousemove step of a drag, not
      // just once per action, so rotating unconditionally would make the
      // backup converge to be identical to the live save within seconds —
      // defeating the point of having a second, genuinely-earlier copy.
      const now = Date.now();
      if (now - lastBackupRotationAt > BACKUP_MIN_INTERVAL_MS) {
        const current = localStorage.getItem(AUTOSAVE_KEY);
        if (current) {
          try {
            const parsed = JSON.parse(current);
            if (parsed.shapes && parsed.shapes.length) {
              localStorage.setItem(AUTOSAVE_BACKUP_KEY, current);
              lastBackupRotationAt = now;
            }
          } catch (e) { /* corrupt existing entry — don't propagate it into the backup slot */ }
        }
      }
      localStorage.setItem(AUTOSAVE_KEY, serializeProject());
      lastAutosaveAt = now;
      // Skip the visible status-text update while a drag is in progress: it's
      // the first thing to give the topbar new content ("Autosaved just now"),
      // and if that's enough to make the topbar wrap to a second line, the
      // canvas shifts down mid-gesture — right under an in-progress
      // draw/move/resize, throwing off every remaining coordinate in that
      // drag. The actual save above still happens every step either way; the
      // label just catches up on the next mouseup or the 5s interval tick.
      if (!drag) updateAutosaveStatus();
    } catch (e) { /* ignore quota errors */ }
  }

  function readAutosaveSlot(key) {
    let raw;
    try { raw = localStorage.getItem(key); } catch (e) { return null; }
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return data.shapes && data.shapes.length ? data : null;
    } catch (e) { return null; }
  }

  function tryRestoreAutosave() {
    const primary = readAutosaveSlot(AUTOSAVE_KEY);
    if (primary) {
      if (confirm("Restore your last unsaved session?")) loadProjectData(primary);
      return;
    }
    // The current autosave is missing or empty — fall back to the one-step-
    // behind backup, in case something just wiped the primary slot.
    const backup = readAutosaveSlot(AUTOSAVE_BACKUP_KEY);
    if (backup && confirm("Your most recent autosave looks empty, but a backup from just before it still has work in it. Restore that instead?")) {
      loadProjectData(backup);
    }
  }

  let lastAutosaveAt = null;
  function updateAutosaveStatus() {
    const el = document.getElementById("autosaveStatus");
    if (!el) return;
    if (!lastAutosaveAt) { el.textContent = ""; return; }
    const secs = Math.round((Date.now() - lastAutosaveAt) / 1000);
    if (secs < 5) el.textContent = "Autosaved just now";
    else if (secs < 60) el.textContent = `Autosaved ${secs}s ago`;
    else el.textContent = `Autosaved ${Math.round(secs / 60)}m ago`;
  }
  setInterval(updateAutosaveStatus, 5000);

  // Don't let a refresh or tab close happen silently while there's real
  // unsaved work. This is keyed off fileDirty rather than "there are shapes
  // on the canvas" — every edit is autosaved to this browser continuously
  // (see autosave() above), so a plain refresh has never actually been able
  // to lose anything since that autosave-armed fix; warning here every time
  // regardless of whether you'd just clicked Save was just noise on top of
  // that. This only fires when there's something not yet written out to a
  // file you'd actually notice missing.
  window.addEventListener("beforeunload", (e) => {
    if (fileDirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // ---------------------------------------------------------------------
  // Export (PNG / SVG) — exports the selection, or everything if nothing
  // is selected, at true physical size.
  // ---------------------------------------------------------------------
  function getExportShapes() {
    return selection.size ? selectedShapes() : project.shapes;
  }

  function computeBBox(shapes) {
    if (!shapes.length) return { x: 0, y: 0, w: inchesToPx(4), h: inchesToPx(4) };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    shapes.forEach((s) => {
      const b = shapeWorldBBox(s);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x2); maxY = Math.max(maxY, b.y2);
    });
    const pad = 8;
    return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
  }

  function buildStandaloneSvgString(shapes, bbox) {
    const svgOut = svgEl("svg", {
      xmlns: SVG_NS,
      width: round2(pxToInches(bbox.w)) + "in",
      height: round2(pxToInches(bbox.h)) + "in",
      viewBox: `0 0 ${bbox.w} ${bbox.h}`
    });
    const defs = svg.querySelector("defs").cloneNode(true);
    svgOut.appendChild(defs);
    const g = svgEl("g", { transform: `translate(${-bbox.x} ${-bbox.y})` });
    const ids = new Set(shapes.map((s) => s.id));
    shapeLayer.querySelectorAll(":scope > g").forEach((node) => {
      if (ids.has(node.getAttribute("data-id"))) g.appendChild(node.cloneNode(true));
    });
    svgOut.appendChild(g);

    // inline the stylesheet rules the exported shapes rely on, so the file
    // looks right even when opened outside this app.
    const style = document.createElementNS(SVG_NS, "style");
    const borderRule = project.showBorders
      ? ".shape-fill { stroke:#33383f; stroke-width:1.5; }"
      : ".shape-fill { stroke:none; }";
    style.textContent = `
      ${borderRule}
      .sew-line { stroke:#33383f; stroke-width:1.5; stroke-dasharray:5 4; fill:none; }
      .press-line-solid { stroke:#33383f; stroke-width:2; fill:none; }
      .press-arrow { stroke:#33383f; stroke-width:2.5; fill:none; marker-end:url(#arrowHead); }
      .shape-label-text { font-family: Georgia, 'Times New Roman', serif; font-weight:700; fill:#1c1f24; text-anchor:middle; dominant-baseline:central; }
      .free-text { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size:14px; fill:#1c1f24; }
    `;
    svgOut.insertBefore(style, svgOut.firstChild);

    return new XMLSerializer().serializeToString(svgOut);
  }

  document.getElementById("btnExportSvg").addEventListener("click", () => {
    const shapes = getExportShapes();
    if (!shapes.length) { alert("Nothing to export yet — draw something first."); return; }
    const bbox = computeBBox(shapes);
    const svgStr = buildStandaloneSvgString(shapes, bbox);
    downloadText(svgStr, "quilt-diagram.svg", "image/svg+xml");
  });

  document.getElementById("btnExportPng").addEventListener("click", () => {
    const shapes = getExportShapes();
    if (!shapes.length) { alert("Nothing to export yet — draw something first."); return; }
    const bbox = computeBBox(shapes);
    const svgStr = buildStandaloneSvgString(shapes, bbox);
    const dpi = parseInt(dpiSelect.value, 10);
    const scale = dpi / PX_PER_INCH;

    const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bbox.w * scale));
      c.height = Math.max(1, Math.round(bbox.h * scale));
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => downloadBlob(blob, "quilt-diagram.png"), "image/png");
    };
    img.onerror = (e) => {
      console.error("PNG export failed to rasterize the diagram", e);
      alert("Export failed — see the browser console for details.");
    };
    img.src = url;
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  async function init() {
    const buildEl = document.getElementById("appBuild");
    if (buildEl) {
      buildEl.textContent = "build " + APP_BUILD;
      buildEl.title = "If something you just got a fix for still looks broken, this is probably an old browser tab — do a hard refresh (Ctrl+Shift+R) to pick up the latest version.";
    }
    gridUnitSelect.value = String(project.gridUnit);
    applyBorderSetting();
    setTool("select");
    // A share link in the URL takes priority over the usual "restore your
    // last session?" prompt — if you followed a link, loading what it
    // points to is clearly the point, not whatever was autosaved here
    // before. If there's no share link (the common case), this is a no-op
    // and falls straight through to the normal autosave-restore check.
    const loadedFromShareLink = await tryLoadShareLink();
    if (!loadedFromShareLink) tryRestoreAutosave();
    renderAll();
    updateUndoRedoButtons();
  }

  init();
})();
