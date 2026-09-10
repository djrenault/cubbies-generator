# Cubbies Generator

A single-page, browser-based tool that turns a few grid/size parameters into
(a) a full plywood cut list with joinery callouts and (b) an interactive 3D
model of a cubby/storage enclosure. There is no backend — everything runs
client-side in the browser.

## Status

Nothing is implemented yet. This file is the design spec and build guide.
Treat every formula and structural decision below as the source of truth
when scaffolding the app; flag anything you need to deviate from.

## Concept

The tool designs a rectangular grid of open storage cubbies (rows × columns)
built from plywood, using continuous-side, dado-and-rabbet cabinet
construction (the classic "bookcase with dividers" method):

- **Top & bottom panels** — full-width/full-depth horizontal panels.
- **Vertical dividers** — one continuous piece per column boundary
  (`columns + 1` total: left end, right end, and `columns - 1` internal
  dividers), running the full clear height between the top and bottom.
- **Shelves** — one piece per internal row boundary per column bay
  (`columns × (rows - 1)` total), let into dados cut in the verticals on
  either side.
- **Backboard** — a single sheet of (possibly thinner) plywood, captured in
  a rabbet run around the inside back edge of the top, bottom, and two end
  panels.

No face frame, no inset/reveal — this is frameless (Euro-style) construction.
Cubby openings are flush with the front edges of the case.

## Core Inputs

| Input | Symbol | Notes |
|---|---|---|
| Rows | `R` | integer ≥ 1 |
| Columns | `C` | integer ≥ 1 |
| Plywood thickness (case material) | `t` | verticals, shelves, top, bottom |
| Backboard thickness | `tb` | independent field, can differ from `t` |
| Inner width per cubby | `iw` | uniform across the whole grid |
| Inner height per cubby | `ih` | uniform across the whole grid |
| Inner depth per cubby | `id` | uniform across the whole grid |
| Overall width | `OW` | derived ⇄ editable, see below |
| Overall height | `OH` | derived ⇄ editable, see below |
| Overall depth | `OD` | derived ⇄ editable, see below |
| Dado depth | `dd` | default `t / 4`; constrained so `2*dd < t` (see Joinery Model) |
| Rabbet depth (corners) | `rd` | default `t / 2` |
| Backboard mount mode | — | `inset` \| `outset` toggle, default **outset** |
| Backboard rabbet width | `bw` | inset mount only — how far the back rabbet reaches toward the front; default `3/8"` |

**Assumption:** cell size is uniform for the whole grid (one `iw`/`ih`/`id`,
not per-row or per-column). This matches "the inner dimensions of each
space" read as a single shared spec, and matches how cubby units are
normally built. Per-row/per-column sizing is a plausible future extension —
don't build it now, but don't design the state shape in a way that makes it
painful to add later (e.g. don't hard-code assumptions about uniformity deep
inside the geometry/viewer code where it can't be swapped for a lookup).

## Bidirectional Dimension Linking

For each axis independently (width, height, depth), the tool tracks which
of the two fields — overall or inner — was **last edited by the user**.
That field is the "driver"; the other is always recomputed from it. There is
no override toggle; simply editing a field makes it the driver for its axis.

State per axis: `source: 'overall' | 'inner'`.

- User edits `OW` → `source.width = 'overall'`, recompute `iw` from `OW`.
- User edits `iw` → `source.width = 'inner'`, recompute `OW` from `iw`.
- User edits `R`, `C`, or `t` → do **not** change `source`; just recompute
  the *non-driver* field for the affected axis(es) from the driver.
- Same pattern for height (`OH` ⇄ `ih`, driven by `R`/`t`) and depth
  (`OD` ⇄ `id`, driven by `tb`).

Governing equations (see Joinery Model below for why these hold regardless
of rabbet/dado depth):

```
OW = (C + 1) * t + C * iw        ⇄        iw = (OW - (C + 1) * t) / C
OH = (R + 1) * t + R * ih        ⇄        ih = (OH - (R + 1) * t) / R
OD = id + tb                     ⇄        id = OD - tb
```

Clamp/validate: reject or flag configurations that drive a derived inner
dimension to ≤ 0 (e.g. overall width too small for the given column count
and thickness). Surface this as inline validation, not a crash.

## Joinery Model & Geometry

**Convention:** dados and rabbets are relief cuts made *into* a piece's face
or edge — they do not change that piece's own nominal (cut) length/width.
Corner rabbets between mating panels are modeled as a symmetric half-lap
(each piece loses `rd` from the corner, by default `t / 2` each), so the
stack-up formulas above are exact regardless of `rd`. This is the same
convention commercial cut-list tools use for rabbeted casework.

**Dado depth constraint:** an internal vertical divider carries a shelf on
*both* sides at the same row-boundary height, so it gets two dados cut into
it there — one from the left face, one from the right — facing each other
across the same cross-section. Whatever isn't removed by either dado is the
solid web left between them, so `2 * dd` must stay comfortably under `t`,
not just under `t / 2` as it would for a single-sided dado. And because the
*same* `dd` is also used for the single-sided dados in the end panels — so
a shelf seats the same distance into its support on both ends, not deeper
on one side than the other — `dd` can't be tuned differently per side.
Default `dd = t / 4`, which leaves a `t / 2` web in internal dividers.
Validate `2 * dd < t` (reject/flag otherwise), and warn if the remaining
web (`t - 2 * dd`) drops below roughly `3/16"` or 20% of `t`, whichever is
larger — thin webs split out.

Piece-by-piece. `panelDepth` is the depth (front-to-back) used for the top,
bottom, and end panels, and depends on the backboard mount mode (see
Backboard, below): `panelDepth = mount === 'inset' ? id + tb : id`.

1. **Top / Bottom panel** — qty 1 each. `length = OW`, `width = panelDepth`,
   `thickness = t`.
   - Rabbet at each end (inside face) to receive the end panels:
     `width = t`, `depth = rd`, running the full `panelDepth`.
   - Dado on the inside face for each internal vertical divider:
     `width = t`, `depth = dd`, at each divider's x-position (see below).
   - **Inset mount only:** rabbet along the back edge for the backboard:
     `width = bw`, `depth = tb`, running the full width `OW`.

2. **End panels** (left, right) — qty 2. `length = OH - 2*t`,
   `width = panelDepth`, `thickness = t`.
   - Dado on the inner face at each internal row boundary (`R - 1` of
     them) for shelves: `width = t`, `depth = dd`.
   - **Inset mount only:** rabbet along the back edge for the backboard:
     `width = bw`, `depth = tb`.

3. **Internal vertical dividers** — qty `C - 1`. Same length as end panels
   (`OH - 2*t`), `width = id` always, regardless of mount mode (see
   Backboard, below, for why this doesn't need a special case),
   `thickness = t`.
   - Dado on **both** faces at each row boundary (`R - 1` positions) for
     shelves, depth `dd` each (see the dado depth constraint above).
   - Dado on the top and bottom edges, received into matching dados cut
     into the top/bottom panels at this divider's x-position (`width = t`,
     `depth = dd`) — this is how a continuous internal divider attaches to
     the top/bottom, since only the two *end* pieces get the corner rabbet
     treatment described in the prompt.

4. **Shelves** — qty `C * (R - 1)`. `length = iw + 2*dd` (reaches fully
   into the dado on each side), `width = id`, `thickness = t`.

5. **Backboard** — qty 1, mount mode set by a toggle (`inset` | `outset`,
   default **outset**):
   - **Outset** (default): a single sheet screwed to the back edges of the
     top, bottom, end panels, and internal dividers — all flush at depth
     `id` from the front, so nothing needs rabbeting. Sized to the full
     outer envelope: `width = OW`, `height = OH`, `thickness = tb`. No
     backboard rabbet feature anywhere in this mode.
   - **Inset:** captured in a rabbet run around the inside back edge of
     the top, bottom, and end panels (see `panelDepth` and the rabbet
     features on those pieces above), flush with their back face.
     `width = (OW - 2*t) + 2*bw`, `height = (OH - 2*t) + 2*bw`,
     `thickness = tb`. `bw` only matters in this mode.
   - Either way, `OD = id + tb` (see Bidirectional Dimension Linking)
     still gives the correct total front-to-back depth of the finished
     piece: in inset mode the backboard sits flush within `panelDepth`;
     in outset mode `panelDepth` is just `id` and the backboard adds `tb`
     behind it. Same total, different split.

**Divider x-positions** (left inner face = 0, +x toward the right end):
divider `k` (1-indexed, `k = 1..C-1`) sits with its left face at
`k * (iw + t)`. Bay `k` (1-indexed, `k = 1..C`) spans from
`(k-1) * (iw + t)` to `(k-1) * (iw + t) + iw`.

**Shelf y-positions** are analogous, using `ih` and `R` measured from the
inside face of the bottom panel.

### Worked example (for sanity-checking an implementation)

`R=3, C=2, t=3/4", iw=12", ih=10", id=11", tb=1/4", dd=t/4=3/16", rd=t/2=3/8", bw=3/8"`

```
OW = 3*0.75 + 2*12       = 26.25"   (26 1/4")
OH = 4*0.75 + 3*10       = 33"
OD = 11 + 0.25           = 11.25"  (11 1/4")
End/divider length        = 33 - 1.5 = 31.5"  (31 1/2")
Shelf length               = 12 + 2*0.1875 = 12.375"  (12 3/8")
Shelf count                = 2 * 2 = 4
Vertical count              = 3  (2 end + 1 internal divider)
Divider dado web check     = t - 2*dd = 0.75 - 0.375 = 0.375"  (3/8" remaining, safe)

Outset backboard (default): panelDepth = id = 11"; backboard = OW x OH
                             = 26.25" x 33"  (26 1/4" x 33")
Inset backboard:            panelDepth = id + tb = 11.25"; backboard
                             = 25.5" x 32.25"  (25 1/2" x 32 1/4")
```

## Units, Fractions & Precision

- Default unit: inches, displayed as fractions (mixed numbers, e.g.
  `14 11/16"`), reduced to lowest terms.
- Default display precision: nearest `1/16"`. Make precision a setting
  (`1/32`, `1/16`, `1/8`), not hard-coded, since it's described as a
  "default" — but ship with `1/16` selected.
- Do all internal math in plain decimal (JS `number`) — there's no need for
  exact rational arithmetic here, the values are simple sums/quotients of a
  handful of terms. Round **only at display time**, via a `formatFraction(value, precisionDenominator)` helper.
- Input fields should accept typed fractions (`23 1/2`, `3/4`, `0.75`) and
  normalize them, since users will be entering actual (not just nominal)
  plywood thickness — real 3/4" plywood is often 23/32" or ~0.703" actual.
  A few quick-pick buttons for common actual thicknesses (3/4, 23/32, 1/2,
  1/4) next to the thickness field is a reasonable nicety, not a requirement.

## 3D Viewer

Requirements:

- Orbit/pan/zoom camera over the generated model (Three.js `OrbitControls`
  or equivalent).
- Two color modes, toggleable at any time without regenerating geometry:
  - **Realistic** — a wood-grain material (procedural or a tiled texture)
    on all pieces, plus a distinct tone for the backboard if its thickness
    differs.
  - **Identify** — every individual piece *instance* (not just type) gets a
    visually distinct solid color, so two shelves at different heights are
    clearly different colors. Step hue around the color wheel by the golden
    angle (~137.5°) per piece index for good separation at any piece count.
- Model is rebuilt (or incrementally updated) whenever any input changes —
  keep this fast; a plywood box has few enough parts that a full rebuild
  per change is fine, no need for incremental diffing.
- Dados and rabbets are carved into the actual mesh (not just noted in the
  cut list) via CSG box subtraction — every joinery cut in this design is
  an axis-aligned rectangular notch, which is the easy case for CSG, so
  this doesn't need general-purpose boolean geometry. `geometry.js` emits
  each cut as a `{ pos, size }` box (or array of boxes) local to the piece
  alongside its text description; `viewer3d.js` subtracts them from the
  piece's box with `three-bvh-csg`. Pieces with no cuts (shelves, the
  backboard) skip CSG and render as plain boxes.
- Nice-to-have, not required for v1: click a piece to highlight it and
  scroll/highlight the matching cut-list row; an exploded-view slider.

## Cut List & Export

- A table: Piece name, Qty, Length, Width, Thickness, and a Joinery/Notes
  column describing dado/rabbet locations, widths, and depths in the same
  fractional format as dimensions (e.g. "dado 3/4\" W × 3/8\" D at 12\" and
  22.75\" from left face").
- Group rows by piece type (Top, Bottom, End Panels, Dividers, Shelves,
  Backboard), matching the numbered list above.
- Export path: a dedicated print stylesheet (`@media print`) plus a
  "Print / Export PDF" button that calls `window.print()`. This needs no
  extra dependency and produces a clean vector PDF via the browser's native
  print-to-PDF — prefer this over pulling in a PDF-generation library.

## Tech Stack & Architecture

Plain HTML/CSS/JS, no build step, no framework — this is explicitly an
"html-based" tool and the scope doesn't justify a bundler.

**No ES modules, no import maps — classic `<script>` tags only.** This
matters more than it looks: `type="module"` scripts (and import maps) are
CORS-restricted by spec and simply fail to load over `file://` in *every*
browser (Chrome included, not just Firefox/Safari — verified directly), so
a module-based build breaks the entire point of vendoring dependencies
locally, which is that a user can download the repo and double-click
`index.html` with no server and no internet. So: every vendored library is
its plain-global (UMD or classic-script) build, and our own `src/*.js`
files are classic scripts too, each wrapped in an IIFE and sharing a
`window.Cubbies` namespace instead of `import`/`export` — e.g. `units.js`
ends with `window.Cubbies.units = { parseFraction, formatFraction, ... };`,
and a dependent file reads `const { parseFraction } = Cubbies.units;`
inside its own IIFE. The IIFE wrapper isn't optional: classic scripts on a
page share one global lexical scope, so without it two files destructuring
the same name (`formatFraction`, say) collide as a duplicate-declaration
error. Load order in `index.html` matters and follows the dependency chain
below.

Vendored libraries, all under `vendor/`, fetched from npm packages and not
hand-edited except where noted:

- **`three/build/three.min.js`** — Three.js's plain-global build (sets
  `window.THREE`). It carries a console warning about being deprecated
  since r150 "with removal at r160" — that's a maintainer's future-tense
  threat about *new* fetches of the package, not something that affects an
  already-vendored, never-auto-upgraded copy; the file works fine and the
  warning is safe to ignore. Pin a specific version; re-vendor by refetching
  the same file from a newer `three` npm package if ever upgrading.
- **`three-mesh-bvh/index.umd.js`** and **`three-bvh-csg/index.umd.js`** —
  each package's own UMD build (`build/index.umd.cjs` in the npm package;
  rename to `.js` when vendoring, content untouched). UMD builds already
  fall back to attaching a global when neither CommonJS nor AMD is present,
  so these work as plain `<script src>` tags with no edits. Sets
  `window.MeshBVHLib` and `window.ThreBvhCsg` (note: no second "e" in
  "Thre" — that's the actual global name the library ships, a typo in the
  library itself) respectively. `three-mesh-bvh` is pinned to `0.6.8`
  specifically (not latest) because `three-bvh-csg` 0.0.17 was built
  against that range and a newer `three-mesh-bvh` prints an option-name
  deprecation warning on every CSG call — cosmetic, but pinning avoids it.
- **`three/examples/js/controls/OrbitControls.classic.js`** — Three.js
  dropped the classic-script build of OrbitControls somewhere around r148,
  shipping only the ES module version now (`examples/jsm/...`). This is a
  **mechanical, minimal hand-conversion** of that module to a classic
  script: the `import { A, B, ... } from 'three';` line becomes
  `const { A, B, ... } = THREE;` (identical name list, so every reference
  in the ~1400 lines below it is untouched), and the trailing
  `export { OrbitControls };` becomes `window.OrbitControls = OrbitControls;`.
  Nothing else in the file changes. To update: re-run that same two-line
  transform against a newer `examples/jsm/controls/OrbitControls.js` from
  the `three` npm package — don't hand-edit the converted file directly, so
  the diff against upstream stays auditable.

```
index.html
vendor/
  three/
    build/three.min.js
    examples/js/controls/OrbitControls.classic.js
    LICENSE
  three-bvh-csg/
    index.umd.js
    LICENSE
  three-mesh-bvh/
    index.umd.js
    LICENSE
src/
  main.js       entry point, wires state + ui + viewer3d + cutlist together
  state.js      parameter store, bidirectional axis-linking logic
  units.js      fraction parsing/formatting, precision rounding
  geometry.js   pure functions: state -> list of pieces (with joinery features)
  viewer3d.js   Three.js scene setup, mesh generation from geometry.js output,
                color modes, controls
  cutlist.js    renders the cut list table from geometry.js output
  ui.js         input panel wiring, validation messages
styles/
  main.css
  print.css
```

Keep `geometry.js` free of any DOM/Three.js dependency — it should be a pure
function from state to a plain-data piece list that both `viewer3d.js` and
`cutlist.js` consume. This is what makes the cut list and the 3D model
guaranteed to match.

## Open Assumptions to Confirm With the User

These were reasonable defaults chosen to keep the spec concrete, but are
worth a quick confirmation before or during implementation if anything
looks off:

- Uniform cell size across the whole grid (no per-row/per-column sizing).
- Internal dividers attach to top/bottom via dados cut into the top/bottom
  panels (the prompt only specified rabbets for the *end* pieces).
- No face frame / no inset reveal — frameless construction, openings flush
  with the front.
- Sheet-goods yield/nesting (how pieces lay out on 4×8 sheets) is out of
  scope for v1.
