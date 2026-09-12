# Cubbies Generator

A single-page, browser-based tool that turns a few grid/size parameters into
(a) a full plywood cut list with joinery callouts and (b) an interactive 3D
model of a cubby/storage enclosure. There is no backend — everything runs
client-side in the browser.

## Status

Fully implemented and working. Open `index.html` directly — no server, no
build step, no internet connection (see Tech Stack & Architecture, below,
for exactly why that works). This file is no longer just a spec to build
toward; it documents what's actually shipped, kept in sync with the code
as it changed. That includes real bugs found through use and fixed in
place, each documented in the relevant section below rather than left only
in git history, since the failure mode is exactly what's worth knowing
before touching that code again:

- End panels and internal dividers stopped flush at the old "clear height"
  boundary instead of reaching into the rabbet/dado pocket cut for them,
  leaving a visible gap at every corner and divider — see Joinery Model &
  Geometry, item 2.
- `type="module"` scripts and import maps silently fail to load over
  `file://` in every browser, which broke the entire point of vendoring
  dependencies locally — see Tech Stack & Architecture.
- `three-bvh-csg` throws on exactly-coplanar cut faces, reproducible with
  wider grids in inset backboard mode — see 3D Viewer, `CSG_EPS`.
- A single click into a dimension field doesn't select its existing text,
  so typing a replacement corrupted it into something unparseable and the
  edit silently reverted — see Units, Fractions & Precision.
- An inset backboard's back rabbet was cut to a depth of `tb` (backboard
  thickness) instead of `rd` (the same corner-rabbet depth used
  everywhere else in the case) — silently broken for `tb >= t` (no
  shoulder left at all), but wrong in general: even a *valid* `tb < t`
  left the rabbet's reach (`bw`) and depth mismatched from what the
  backboard's edge actually needed, so the back corners looked wrong for
  ordinary configurations too, not just the `tb >= t` edge case. A first
  pass added a `tb < t` validation error, which stopped the broken
  render but didn't fix the underlying model or let a user actually
  build with backboard stock as thick as the case material, which was
  the real ask. Fixed by decoupling the rabbet's depth-into-thickness
  from `tb` entirely (now `rd`) — see Joinery Model & Geometry, item 5
  (Backboard).
- That same fix introduced a follow-on bug — or so it seemed. Once the
  inset back rabbet's depth became `rd`, it started *volumetrically
  overlapping* the corner rabbets, divider dados, and shelf dados
  wherever their cut boxes shared territory near the back of the panel —
  16 overlapping cut pairs in one reported config, and a checkerboard
  z-fighting glitch in the 3D viewer at exactly that seam. Two more
  rounds of CSG-side fixes followed: first trimming each cut to stop
  exactly where a deeper one begins, then — when that exact-touch trim
  still overlapped by `2*CSG_EPS` once padding was applied, producing a
  jagged seam — adding a deliberate `JOINT_GAP` margin between them, then
  — when the user pointed out `JOINT_GAP` had traded the render glitch
  for a real, physical strip of uncut material at the joint — reworking
  `buildPieceMesh` in `viewer3d.js` to union a piece's cuts into one
  solid before a single subtraction, instead of chaining a `SUBTRACTION`
  per cut. Each of these was a genuine improvement to how the *existing*
  cuts got turned into a mesh, and each got real testing (sweeps in the
  thousands of configs, 0 render failures) — but none of them questioned
  whether the cuts themselves were modeling the joint correctly, and none
  of them fixed the checkerboard glitch as *completely* as the actual fix
  below did, using none of this CSG machinery at all.
- **The real root cause, found when the user pushed back a final time:**
  "when the back panel is inset, the side panel rabbets should go the
  full length of the side panels." An end panel's own inset back-rabbet
  cut stopped at the clear-height boundary, excluding the panel's own
  tongues — the extra `rd` at each end that fills the top/bottom panel's
  corner-rabbet pocket (see item 2). But the backboard's *own* corner
  tongue reaches into that exact same region (its own Y-extent is also
  grown by `rd` at each end, for the identical tongue-fills-pocket
  reason — see item 5) — so without this rabbet reaching into the end
  panel's tongue too, the backboard's corner tongue had nowhere to go:
  solid, unrelieved end-panel material already occupied that space at
  all four back corners of every inset case. That's not a rendering
  glitch, it's a hole in the joint — two pieces of solid material
  claiming the same physical space — and it's very plausibly what the
  checkerboard/jagged artifacts had actually been surfacing all along
  (two opaque meshes occupying overlapping volumes is a textbook
  z-fighting trigger). Confirmed by forking a test branch from *before*
  any of the CSG-side fixes above (`JOINT_GAP`, the trims, the union
  rebuild) and applying *only* this one geometry fix — extending the end
  panel's back rabbet to the panel's full length: the previously-glitchy
  corner rendered cleanly, in both color modes, from every camera
  distance tested, using the *original*, simplest possible CSG code
  (sequential per-cut `SUBTRACTION`, `CSG_EPS = 0.001`, no trims). A
  2080-config render-failure sweep found 0 exceptions and a piece-mesh
  bounding-box check found 0 pieces with stray geometry — matching or
  exceeding every guarantee the more elaborate CSG rework had provided.
  **All of the CSG-side machinery above (`JOINT_GAP`, the dado/back-
  rabbet trims, the union-based `buildPieceMesh`) was reverted in favor
  of this simpler, more correct fix.** See Joinery Model & Geometry, item
  2, and 3D Viewer, `CSG_EPS`. **Lesson for next time:** when the same
  symptom survives several rounds of CSG-robustness fixes, stop tuning
  the CSG side and re-check whether the *joinery itself* is complete —
  ask whether every piece that needs to reach a given seam actually has
  a cut relieving it there, not just whether the cuts that already exist
  can be combined more robustly.
- **Debugging notes from this same investigation, still worth knowing:**
  (1) a debug camera placed extremely close to, or literally inside,
  solid mesh geometry can produce artifacts (near-clip-plane effects,
  visible backfaces) that don't occur through normal orbit/pan/zoom use.
  (2) a debug camera a few inches from a corner, close to *edge-on* to a
  thin (sub-1") exposed rabbet-step face, can produce a flickering,
  jagged-looking dithering artifact from ordinary antialiasing at a
  grazing viewing angle — confirmed by scaling the same viewing direction
  outward (the artifact fades well before a realistic distance) and by
  checking the identical seam head-on instead of edge-on (clean at any
  distance, including closer than the grazing shot that showed it).
  Neither artifact reflects the mesh; both are properties of where the
  debug camera was put. Check a normal-distance, non-grazing view (or the
  app's own default camera framing) before concluding a close-up
  screenshot shows a real defect.

Treat every formula and structural decision below as the source of truth
for how the app actually behaves; if you change the code, update the
matching section here in the same commit.

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
| Backboard thickness | `tb` | independent field, can differ from `t` — including equal to or greater than it, even in inset mount mode (see Joinery Model, item 5) |
| Inner width per cubby | `iw` | uniform across the whole grid |
| Inner height per cubby | `ih` | uniform across the whole grid |
| Inner depth per cubby | `id` | uniform across the whole grid |
| Overall width | `OW` | derived ⇄ editable, see below |
| Overall height | `OH` | derived ⇄ editable, see below |
| Overall depth | `OD` | derived ⇄ editable, see below |
| Dado depth | `dd` | default `t / 4`; constrained so `2*dd < t` (see Joinery Model) |
| Rabbet depth (corners) | `rd` | default `t / 2`; inset mount also uses this as the back rabbet's depth (see Joinery Model, item 5) |
| Backboard mount mode | — | `inset` \| `outset` toggle, default **outset** |
| Backboard rabbet width | `bw` | inset mount only — how far the back rabbet reaches toward the front; default `3/8"`; constrained to `bw ≥ tb` (see Joinery Model, item 5) |

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
     `width = t`, `depth = dd`, at each divider's x-position (see below),
     running the full `panelDepth` in z regardless of mount mode.
   - **Inset mount only:** rabbet along the back edge for the backboard:
     `width = bw`, `depth = rd`, running the *full* width `OW` (not
     trimmed to exclude the corners). Depth is `rd`, not `tb` — see item
     5 for why. This does volumetrically overlap the corner/end rabbets
     in the corner zones (`x < t` and `x > OW - t`, where both cuts share
     the same `rd` depth), but that overlap is harmless to leave in: see
     3D Viewer, `CSG_EPS`, and the Status entry above for why trimming it
     out (tried, and reverted) wasn't actually what fixed the real bug in
     this area, and item 2 for what was.

2. **End panels** (left, right) — qty 2. `length = (OH - 2*t) + 2*rd`,
   `width = panelDepth`, `thickness = t`. The `+ 2*rd` matters: the panel's
   own material has to actually reach up into the rabbet pocket cut into
   the top/bottom panel (see item 1) and fill it — stopping flush at the
   old `OH - 2*t` shoulder leaves that pocket empty, a visible gap where
   the corner should be solid. Positioned starting `rd` below the old
   "clear height" origin (`pos.y = t - rd`), so its tongues land exactly
   in the pockets rather than poking past them.
   - Dado on the inner face at each internal row boundary (`R - 1` of
     them) for shelves: `width = t`, `depth = dd`, running the full
     `panelDepth` in z regardless of mount mode.
   - **Inset mount only:** rabbet along the back edge for the backboard:
     `width = bw`, `depth = rd`, running the panel's **full length** —
     `y = 0` to `y = (OH - 2*t) + 2*rd` (i.e. local `0` to the panel's
     own `size.y`), including through *both* of the panel's own tongues
     (the `+ rd` at each end described just above), not just the
     `endHeight` clear-height span between them. This matters more than
     it looks: the tongues aren't inert filler, they're captured inside
     the top/bottom panel's corner-rabbet pocket, and the backboard's
     *own* corner tongue reaches into that exact same region (see item 5
     — its Y-extent is also grown by `rd` at each end, for the identical
     tongue-fills-pocket reason). Without this rabbet reaching into the
     end panel's own tongue too, the backboard's corner tongue would have
     nowhere to go: solid, unrelieved end-panel material would already
     occupy that space, at all four back corners of every inset case.
     An earlier version stopped this cut at the clear-height boundary
     (`y = rd` to `y = rd + endHeight`) — it still rendered without an
     obvious seam artifact for a while, which is what let it stand
     through several rounds of unrelated CSG-side fixes before a user
     caught the actual defect and it was traced back here. See the
     Status entry above for the full story.

3. **Internal vertical dividers** — qty `C - 1`. `length = (OH - 2*t) + 2*dd`
   (same idea as the end panel's `+ 2*rd`, but filling a *dado* pocket
   instead of a rabbet, so it's sized by `dd` — end panels and dividers are
   different lengths whenever `rd != dd`, which is the default), `width = id`
   always, regardless of mount mode (see Backboard, below, for why this
   doesn't need a special case), `thickness = t`. Positioned starting `dd`
   below the old origin (`pos.y = t - dd`), same reasoning as the end panel.
   - Dado on **both** faces at each row boundary (`R - 1` positions) for
     shelves, depth `dd` each (see the dado depth constraint above).
   - Dado on the top and bottom edges, received into matching dados cut
     into the top/bottom panels at this divider's x-position (`width = t`,
     `depth = dd`) — this is how a continuous internal divider attaches to
     the top/bottom, since only the two *end* pieces get the corner rabbet
     treatment described in the prompt. This is the dado whose pocket the
     divider's own `+ 2*dd` length is reaching into.

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
     `width = (OW - 2*t) + 2*rd`, `height = (OH - 2*t) + 2*rd`,
     `thickness = tb`. Extended by `rd` at each edge — same
     tongue-fills-pocket pattern as the end panels/dividers above (items
     2-3) — to reach into the back rabbet pocket, which is now also `rd`
     deep (see below). `bw` still matters in this mode too, just for a
     different axis (see below).
   - Either way, `OD = id + tb` (see Bidirectional Dimension Linking)
     still gives the correct total front-to-back depth of the finished
     piece: in inset mode the backboard sits flush within `panelDepth`;
     in outset mode `panelDepth` is just `id` and the backboard adds `tb`
     behind it. Same total, different split.
   - **The back rabbet's depth is `rd`, not `tb` — deliberately
     decoupled from backboard thickness.** A rabbet has two independent
     dimensions: `bw` is how far forward (in depth, Z) it reaches from
     the back edge; the *depth* is how far it cuts *into the panel's own
     cross-sectional thickness* (Y for top/bottom, X for end panels) —
     the same role `rd` already plays for the corner rabbet between end
     panels and top/bottom. An earlier version used `depth = tb` here
     instead, reasoning that the pocket just needs to be as deep as the
     board is thick — but that conflates "how deep the pocket needs to
     reach" with "how thick the board is," which aren't the same
     question. The un-rabbeted material left in front of the cut
     (`t - rd`) is the shoulder that holds the backboard captured; using
     `tb` for that depth meant the shoulder's existence depended on
     backboard thickness at all, which breaks outright for `tb >= t`
     (zero or negative shoulder) and, more subtly, was *also* wrong for
     smaller, individually-valid values of `tb`, `bw`, and `rd` — the
     backboard's own tongue extension (now fixed above) and the rabbet's
     depth need to agree with each other, and tying one of them to `tb`
     while the other used a different value (`bw`) meant they generally
     didn't. Found via a user report of a `t = tb = 3/4"` inset design
     with visibly broken back corners; a first fix just added a
     `tb < t` validation error, which stopped the broken render but
     didn't address the mismatch for valid configs either, and blocked
     exactly the case the user actually wanted (a backboard as thick as
     the case material). Reusing `rd` fixes both: the shoulder (`t - rd`)
     no longer depends on `tb` at all, so `tb` can be any positive value,
     including equal to or greater than `t`.
   - **This does mean `bw` needs its own relationship to `tb`.** The
     rabbet's Z-range is `[panelDepth - bw, panelDepth]`; the backboard
     (flush with the back, per above) occupies
     `[panelDepth - tb, panelDepth]`. For the backboard's full thickness
     to land inside the rabbeted region — not collide with solid,
     un-rabbeted panel material in front of it — the rabbet has to reach
     forward *at least* as far as the board is thick: **`bw >= tb`**.
     `state.js`'s `validate()` errors (blocking the render, same as the
     dado-depth check below) when `backboardMount === 'inset' && bw < tb`,
     naming both values in the message. The default `bw = 3/8"` already
     exceeds the default `tb = 1/4"`, so this doesn't affect the
     out-of-the-box config — it only comes up when a user increases `tb`
     without also increasing `bw` to match (e.g. a 3/4" backboard needs
     `bw >= 3/4"` too, not just `t >= tb`). Verified with a fuzz sweep of
     `rows × columns × t × tb × bw` (768 combinations, `tb` up to `1.25"`
     against `t` up to `1"`, including `tb > t`) rendering every
     validation-passing combination through the actual CSG pipeline —
     480 rendered, zero CSG failures, and a separate shoulder/reach check
     confirmed positive on all of them.
   - **Making the back rabbet share `rd` with the other cuts (above) also
     made it volumetrically overlap the corner rabbets and divider/shelf
     dados wherever their cut boxes share territory near the back of a
     panel.** Reported as a checkerboard z-fighting glitch in the 3D
     viewer on a real, otherwise-valid config, and confirmed with 16
     overlapping cut-box pairs in a programmatic pairwise check. Several
     rounds of CSG-side fixes followed this report — trimming cuts to
     stop exactly where a deeper one begins, a deliberate `JOINT_GAP`
     margin between them, and a rework of `viewer3d.js` to union a
     piece's cuts into one solid before a single subtraction — each a
     real improvement in isolation, but **none of them were actually
     the fix**, and all were eventually reverted. The 16 overlapping
     pairs were a real, if mostly harmless, side effect of sharing `rd`;
     the checkerboard glitch itself came from something else entirely —
     see item 2's end-panel back rabbet and the Status entry above for
     the actual root cause (an unrelated piece, the end panel, not being
     rabbeted far enough to give the backboard's own corner tongue
     anywhere to go) and why fixing that alone, with none of this CSG
     machinery, cleared it completely. `viewer3d.js`'s `buildPieceMesh`
     is back to the simplest form: one `SUBTRACTION` per cut, `CSG_EPS`
     padding only for the narrow coplanarity case it was originally
     built for — see `CSG_EPS`.

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
Clear height (OH - 2*t)    = 33 - 1.5 = 31.5"
End panel length           = 31.5 + 2*0.375 = 32.25"  (32 1/4")
Divider length              = 31.5 + 2*0.1875 = 31.875"  (31 7/8")
Shelf length               = 12 + 2*0.1875 = 12.375"  (12 3/8")
Shelf count                = 2 * 2 = 4
Vertical count              = 3  (2 end + 1 internal divider)
Divider dado web check     = t - 2*dd = 0.75 - 0.375 = 0.375"  (3/8" remaining, safe)

Outset backboard (default): panelDepth = id = 11"; backboard = OW x OH
                             = 26.25" x 33"  (26 1/4" x 33")
Inset backboard:            panelDepth = id + tb = 11.25"; backboard
                             = (OW-2t+2*rd) x (OH-2t+2*rd) = 25.5" x 32.25"
                             (25 1/2" x 32 1/4") -- rd (3/8"), not tb
                             (1/4"), sizes this extension; they just
                             happen to coincide with bw here since all
                             three default to a value derived from the
                             same t = 3/4"
Back rabbet depth check:    bw (3/8") >= tb (1/4"): OK, default is valid

Thick inset backboard (tb = t, the case not previously documented as
working -- see Joinery Model, item 5): R=3, C=4, t=tb=3/4", bw=3/4"
(bumped to match tb -- the default 3/8" would fail the bw >= tb check)
                             Back rabbet shoulder = t - rd = 0.75-0.375
                             = 0.375" (still safe -- rd is untouched by
                             raising tb)
                             Back rabbet reach = bw = 0.75" >= tb = 0.75": OK
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
- `parseFraction` strips a trailing `"` before parsing, since that's
  exactly what a half-edited field contains: a single click into a field
  positions the cursor but doesn't select its existing formatted text
  (`26 1/4"`), so typing a replacement without first selecting-all inserts
  into it rather than replacing it. `ui.js` fixes the interaction itself
  (`selectAllOnFocus` selects the whole field's text on focus, deferred a
  frame so a mouse-driven focus's own default cursor placement doesn't
  immediately collapse the selection; `blurOnEnter` makes Enter commit and
  reformat immediately instead of leaving raw typed text on screen until
  something else happens to blur the field) — the trailing-quote-stripping
  is defense in depth on top of that, not a substitute for it. Without the
  focus fix, a field that fails to parse silently keeps showing the
  garbled text until literally any other field's edit triggers a
  `syncInputs()` re-sync, at which point it reformats back to the last
  valid value with no visible connection to the edit that "did nothing" —
  confirmed exactly that failure mode before fixing it. Invalid input gets
  live feedback via a `field-error` CSS class toggled on the `input` event
  (while the field is still focused, so `syncInputs()` won't touch it) —
  `change` (on blur) is still what actually commits a valid value to state
  or leaves it unchanged if invalid.

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
  alongside its text description; `viewer3d.js`'s `buildPieceMesh` chains
  a `SUBTRACTION` per cut against the piece's base box with
  `three-bvh-csg`. Pieces with no cuts (shelves, the backboard) skip CSG
  and render as plain boxes.
- **Every cut is padded ~0.001" larger than nominal before it's
  subtracted** (`CSG_EPS` in `viewer3d.js`, applied only to the mesh
  geometry — the cut list still reports the exact nominal
  width/depth/at values from `geometry.js`, untouched). This isn't
  cosmetic: several cuts on the same piece often share a boundary
  exactly by design (e.g. inset mode's back rabbet and a divider dado
  both start flush at the panel's inside face), and three-bvh-csg's
  mesh-based CSG can hit exactly-coplanar faces during a chain of
  subtractions and throw (`Cannot read properties of null (reading
  'dot')`) — reproduced concretely with `columns=4`+ in inset mode at
  specific `rd`/`dd` values (small `rd` in particular), verified fixed
  by the padding across a fuzz sweep of ~1700 grid/joinery combinations
  with zero failures. If a similar crash resurfaces at some future
  combination of parameters, first suspect this same class of issue
  (another exact-coplanarity case) before assuming a logic bug in
  `geometry.js`'s cut positions — check whether bumping `CSG_EPS` up
  resolves it before re-deriving the joinery math.
  - **This value, and this whole sequential-per-cut-`SUBTRACTION`
    approach, briefly got a lot more elaborate** (per-cut trims to avoid
    "redundant" overlapping cuts, a deliberate `JOINT_GAP` between
    touching cuts, a full rework to union all of a piece's cuts before a
    single subtraction, `CSG_EPS` bumped to `0.01`) while chasing a
    checkerboard/jagged rendering glitch that turned out to have nothing
    to do with any of this: the actual cause was an end panel not being
    rabbeted far enough to give the backboard's own corner tongue
    somewhere to go (see Joinery Model & Geometry, item 2, and the
    Status entry above). Once that was fixed, this original, simplest
    version of `buildPieceMesh` handled every config in a 2080-config
    render-failure sweep (0 failures) with no trims, no union, and
    `CSG_EPS` back at its original `0.001` — so all of that extra
    machinery was reverted. **Lesson for next time**, worth repeating
    here since it's specifically about this function: if a rendering
    glitch survives a round of CSG-robustness tuning, check whether the
    *joinery itself* is complete (does every piece that should reach a
    given seam actually have a cut relieving it there?) before adding
    more CSG workarounds on top of what's already there.
  - **Testing-methodology pitfalls, found while chasing the above (two
    distinct failure modes, both properties of the debug camera, not the
    mesh):** (1) a debug camera positioned extremely close to, or
    literally inside, solid mesh geometry can produce artifacts —
    near-clip-plane effects, visible backfaces — that never occur through
    normal orbit/pan/zoom use from outside the model. (2) a debug camera
    a few inches from a corner, close to *edge-on* to a thin (sub-1")
    exposed rabbet-step face, can produce a flickering, jagged-looking
    dithering artifact from ordinary antialiasing at a grazing viewing
    angle — confirmed by scaling the same viewing direction outward
    (the artifact fades well before a realistic distance) and by checking
    the identical seam head-on instead of edge-on (clean at any distance,
    including closer than the grazing shot that showed it). Rule both
    out — check a normal-distance, non-grazing view, or the app's own
    default camera framing — before treating a close-up debug screenshot
    as proof of a real geometry defect.
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
- Lives in its own full-width section below the sidebar/viewer row (not
  inside the sidebar), since a large grid's table is easier to read at full
  width than squeezed into a ~380px column. Collapsible via a header
  button (`#cutlistToggle`); the collapsed/expanded state persists across
  reloads via a small dedicated `localStorage` key
  (`cubbies-generator:cutlistVisible`) separate from the saved-settings key
  below — it's a view preference, not a design parameter, so it's
  deliberately excluded from Import/Export. The print stylesheet always
  forces the cut list fully visible and unscrolled regardless of the
  on-screen toggle state (`#cutlist[hidden] { display: block !important; }`)
  — what gets printed shouldn't depend on whether the panel happened to be
  collapsed when the user hit print.

## Piece Diagrams

- One 2D shop drawing per distinct piece — grouped the same way the cut
  list collapses identical pieces into one row with a qty count (e.g. Top
  and Bottom panels share one "Top / Bottom Panel" diagram, all `R*(C-1)`
  shelves share one "Shelf" diagram) — showing the outer Length × Width
  dimensioned on the outside, and the position/size of every dado and
  rabbet dimensioned on the inside. Lives in its own full-width section
  (`#piecediagrams-section`) between Cut List and Sheet Layout, collapsible
  the same way via a header button (`#piecediagramsToggle`) and its own
  `localStorage` view-preference key (`cubbies-generator:piecediagramsVisible`,
  excluded from Import/Export same as the cut list's), and forced fully
  visible under print.
- **Live, not button-gated** — unlike Sheet-Goods Nesting below. What's
  expensive there is per-*instance* bin-packing; here the diagram count is
  bounded by the number of distinct piece *types* (at most 5, regardless of
  grid size), so a full rebuild on every input change is cheap the same way
  the cut list's is, and there's no reason to make the user click a button
  for it.
- **Geometry comes from each feature's `cut` box, not its `at`/`from` text.**
  `geometry.js` exports a `featureFaceRect(piece, feature)` helper
  (alongside `pieceFootprint`/`PIECE_LABELS`, for the same reason — a single
  source of truth so this can't drift from what `viewer3d.js` actually
  carves) that projects a feature's local `cut` box onto the same 2D face
  `pieceFootprint`'s length/width describe. This is a deliberately
  different number from the cut list's "at 12\" from bottom edge" text for
  an end panel or divider: that text measures from the *assembled case's*
  reference edge (e.g. the clear-height bottom), but an end panel's or
  divider's own length is extended by `rd`/`dd` past that edge so its
  tongue fills the receiving pocket (see Joinery Model & Geometry, items
  2-3), so the piece's own physical tip sits `rd`/`dd` below that datum. A
  distance from the case's clear-height bottom isn't something you can mark
  with a tape on the raw, not-yet-installed board; a distance from the
  piece's own physical edge is — so the diagram dimensions from the latter,
  on purpose, and will not numerically match the cut list's "at ... from
  ..." text for those two piece types. This isn't a bug to reconcile if
  it's noticed later.
- **Each band is checked against both axes independently** — does it
  reach both edges of the length axis, and does it reach both edges of
  the width axis — rather than being classified as a single "vertical"
  or "horizontal" band with one axis checked. A band can need a position
  dimension on neither axis, either one, or (in principle) both; those
  are unrelated questions, and a single per-band axis choice can't
  represent "flush on one axis, not on the other." A shelf dado on an
  end panel is a clean example: on the width axis (the panel's depth,
  Z) it spans the panel's full `panelDepth`, flush at both front and
  back, needing no callout there — but on the length axis (the panel's
  own long dimension) it sits at an internal row position, needing a
  dimension there. A size-based heuristic for picking one axis per band
  (e.g. whichever it covers *relatively more of*) gets exactly this
  case wrong, since the dado covers nearly all of the (short) width axis
  and very little of the (long) length axis — the heuristic would pick
  width as "the" axis to check and miss the position dimension the
  length axis actually needs. Checking both axes independently for
  every band handles this correctly regardless of which axis a band
  happens to cover more of. (An earlier version of this note used the
  inset back rabbet on an end panel as its motivating example, back when
  that rabbet stopped `rd` short of both ends instead of running the
  panel's full length — see Joinery Model & Geometry, item 2. It's since
  been fixed to run the full length, so that specific rabbet is now
  flush on both axes and no longer needs any position callout; the
  underlying per-axis-independent design this note describes remains
  correct and is still exercised by shelf/divider dados.)
- A band flush with an edge on a given axis (touching *either* the near
  or the far edge — `rect.y <= EPS || rect.y + rect.h >= width - EPS`,
  and the length-axis equivalent) skips that axis's position dimension
  line — obvious from the overall dimension already, so a redundant
  callout would just be clutter — but still gets shaded and labeled. A
  band not flush on the length axis gets a stacked line in the bottom
  margin: divider dados on top/bottom panels, and shelf dados on end
  panels/dividers (their cut always touches the panel's own depth-axis
  edge at `z = 0`, so they're flush and callout-free on the *width*
  axis — it's their position along the panel's length that needs
  dimensioning). Not flush on the width axis would get a stacked line in
  the right margin instead — not currently exercised by any feature in
  this design, since every cut here starts flush at a piece's front face
  (`z = 0`) or reaches its back edge (the inset back rabbet), but the
  capability exists for a future joinery feature that doesn't. Multiple
  stacked lines on one piece stack outward, one lane per band, so they
  don't overlap.
- Features with no `cut` (text-only joinery notes — a divider's end-grain
  top/bottom edge dados, a shelf's "seats into a dado" note, a backboard's
  assembly note) have no on-piece position to dimension, so they're listed
  as plain text below the diagram instead of drawn.
- `src/svgutil.js` holds `el()` and `fitLabels()` (the shrink-to-fit
  text-metrics logic from Sheet-Goods Nesting below), extracted out of
  `sheetlayout.js` so `piecediagrams.js`'s on-band labels reuse the same
  already-verified fitting behavior instead of re-deriving it — the two
  renderers share this, not the rest of each other's drawing logic.
  Re-verified the existing sheet-layout label-overflow sweep against zero
  regressions after the extraction.
- Print stylesheet: same pattern as Sheet-Goods Nesting — one piece
  diagram per printed page (`break-before: page` on `.piece-diagram`),
  forced fully visible and unscrolled regardless of the on-screen toggle.
- **Each diagram renders at a fixed `PX_PER_IN` (16px/inch), via explicit
  `width`/`height` pixel attributes on the `<svg>` — not a shared CSS
  `max-width` like sheet diagrams use.** Sheet diagrams all share one
  physical size (the user's `sheetW`/`sheetH`), so squeezing every sheet
  into the same on-screen box is fine there. Piece diagrams don't share a
  size — pieces range from an ~11" shelf to a 90"+ panel on a wide grid —
  so an earlier version that also used a shared `max-width: 700px` made
  the browser scale down a large piece's *entire* SVG (text, stroke
  widths, everything) to fit, while a small piece's SVG barely scaled at
  all: reported as "on large pieces, the dimension text is extremely
  small," and confirmed by measuring rendered `dim-text` height, which
  varied from ~2px on a 55"+ top panel down to ~8px on a 12" shelf at the
  old shared width. Every layout constant in `piecediagrams.js` (font
  sizes, margins, arrow size, lane spacing) is now defined as a target
  pixel size divided by `PX_PER_IN`, so they resolve to the same rendered
  pixel size on every diagram regardless of the piece's physical size —
  verified by measuring `dim-text` height across a 90"+ panel and an
  11" shelf and getting the same value. A diagram wider than its column
  now scrolls horizontally within `#piecediagrams` (already
  `overflow: auto`) instead of shrinking; the print stylesheet's own
  `max-width: 100%` (plus a matching `height: auto`, since this SVG's
  size comes from attributes rather than sheet-svg's CSS width/height)
  still scales a diagram down to fit a printed page, which is the one
  place shrinking to fit *is* correct, since the page size is genuinely
  fixed.

## Sheet-Goods Nesting

- Lays the cut list out onto `sheetW x sheetH` sheets (default 48" x 96",
  a "4x8" sheet), grouped by thickness first — a sheet is single-thickness
  stock, so `t`-thickness pieces (top/bottom/ends/dividers/shelves) and
  `tb`-thickness backboard pieces always pack onto separate sheets, even
  though they might otherwise fit together.
- **On-demand, not live**: a "Generate Layout" button (`#generateLayoutBtn`),
  not recomputed on every input change the way the rest of the app is —
  nesting is real computational work, and there's no reason to spend it on
  a design the user is still iterating on. `main.js` keeps the last
  successfully computed piece list (`lastPieces`); the button reuses it
  rather than the app running nesting on a cadence.
- **Algorithm: guillotine packing with best-area-fit placement**
  (`nesting.js`, `computeSheetLayout` / `packGroup`). Every cut this
  produces is a straight, edge-to-edge cut — never a plunge cut or an
  L-shaped remainder — which is what makes the result something a person
  can actually execute with a track saw or table saw. A general-purpose
  rectangle packer (e.g. full maximal-rectangles) can pack tighter but can
  produce shapes that aren't achievable with straight full-length cuts, so
  it was deliberately not used even though it would look better on a
  waste-percentage metric alone. Best-area-fit (place each piece into
  whichever free rectangle wastes the least area, tie-broken by shortest
  leftover side) is a standard heuristic for this — not optimal (bin
  packing is NP-hard) but reliably close and simple enough to hand-verify.
  Pieces are placed largest-area-first.
- **Kerf** (`kerf`, default `3/16"`) is applied as uniform padding on the
  right/bottom of every piece's packing footprint, including where a piece
  lands flush against the sheet's own edge (where, in reality, no
  clearance is needed — the sheet boundary isn't a cut line). This
  slightly overstates waste, by at most one kerf width per row/column per
  sheet, and is far simpler than tracking which free-rectangle edges are
  real cut lines versus the sheet boundary — not worth the complexity for
  that precision.
- **Rotation** (`allowRotation`, default on) lets the packer place a piece
  on its side for a better fit. This tool doesn't track grain direction,
  so there's nothing to respect by turning it off today; the setting
  exists for a user who wants to preserve a face-grain orientation by
  convention regardless.
- Diagram labels use short, cut-list-style names plus an instance number
  (`Shelf #1`, `Shelf #2`, ...) via `Cubbies.geometry.PIECE_LABELS` — the
  same per-type mapping the cut list groups rows by, and for the same
  reason: pieces within a type are interchangeable (identical size and
  joinery), so there's no need for `geometry.js`'s fuller per-instance
  `label` ("Shelf — Row 2, Column 1", built for 3D-viewer tooltips) on the
  diagram — and the long form fits in a piece's drawn rectangle far less
  often.
- **Text fitting is a verified concern, not a nice-to-have.** A label
  rotates 90° to run along a piece's long axis when the piece is notably
  taller than wide in its drawn orientation (`r.h > r.w * 1.3`), since a
  piece like an end panel packs far narrower than its label is long.
  Beyond that, `fitLabels()` (in `src/svgutil.js`, shared with
  `piecediagrams.js` — see Piece Diagrams, above) measures each label with
  the browser's own `getComputedTextLength()` — after the SVGs are
  attached to the document, since accurate measurement needs a connected
  element — and shrinks the font to fit, down to a floor of
  `MIN_FONT_SIZE`. A `clip-path` per piece is still there as a hard
  backstop, but it is deliberately not relied on alone: that was the
  original approach, and it let text visibly bleed outside a piece's box
  under specific conditions — print/PDF rendering did not reliably resolve
  a `clip-path url()` reference to a `<clipPath>` appended to `<defs>`
  *after* the element referencing it, even though normal on-screen
  rendering tolerated that document order. Fixed by building `<defs>`
  before anything that references a clipPath inside it, *and* by no longer
  depending on clipping to do the actual fitting work. Verified with a
  sweep checking every rendered label's bounding box against its piece's
  box (accounting for the rotated case) across ten grid/sheet-size/kerf/
  rotation combinations, including deliberately small sheet goods — zero
  overflows.
- Sheet diagrams are always drawn landscape (wider than tall) regardless
  of which of `sheetW`/`sheetH` is larger — the conventional way a cut
  diagram is drawn, independent of which axis the packing math itself uses
  internally (`makeTransposer` in `sheetlayout.js` swaps for display only
  when `sheetH > sheetW`).
- A piece that doesn't fit the sheet in either orientation (even
  accounting for kerf) is reported as an error in the Sheet Layout panel
  rather than silently dropped — `computeSheetLayout`'s own `errors`
  array, distinct from the live design-validation `state.errors`.
- Print stylesheet: each sheet's diagram gets its own printed page
  (`break-before: page` on `.sheet-diagram`), and — same pattern as the
  cut list — the panel prints fully expanded and unscrolled regardless of
  the on-screen collapse toggle.

## Settings Persistence & Import/Export

- **Auto-save to `localStorage`** under the key `cubbies-generator:settings:v1`,
  written on every `update()` in `main.js` (i.e. after every input change)
  and read back once on page load (`Cubbies.state.loadOrCreateState()`,
  which layers whatever was saved over `createDefaultState()`'s fields).
  Wrapped in `try/catch` everywhere it touches `localStorage` — private
  browsing, disabled storage, or a full quota should degrade to "nothing
  persists," never crash the app.
- **Export** (`Export JSON` button) downloads the current design as a JSON
  file via a `Blob` + temporary `<a download>` (no server, no library
  needed for this). **Import** (`Import JSON` button, backed by a hidden
  `<input type="file">`) reads a file back and applies it on top of the
  current state. Both use the same serialization as auto-save
  (`Cubbies.state.serializeState` / `applySerializedState`), so an
  exported file and what's in `localStorage` are the same shape — just
  JSON, no YAML/other format, since this tool has no dependency-free way
  to parse YAML in the browser and JSON needs none.
- **What's persisted/exported:** every design parameter a user sets —
  grid, thicknesses, inner/overall dimensions, the axis-linking `source`,
  joinery depths and whether they're manually overridden, backboard mount
  and rabbet width, display precision, color mode, and the sheet-goods
  nesting settings (`sheetW`, `sheetH`, `kerf`, `allowRotation`). *Not*
  included: `errors`/`warnings` (derived — `recompute()` regenerates them
  from the fields above), the cut-list, piece-diagrams, or sheet-layout
  collapse states (view preferences, not design parameters — see Cut List
  & Export, Piece Diagrams, and Sheet-Goods Nesting, above), or the sheet
  layout result itself (also derived — regenerated on demand from the
  pieces + those same settings, see Sheet-Goods Nesting).
- **Import is deliberately forgiving, not strict.** `applySerializedState`
  copies over only known keys whose value passes a basic type/enum check
  (finite number, boolean, or one of the expected enum strings) and
  silently ignores anything else — an unrecognized key, a wrong type, a
  future field this version doesn't know about, or a hand-edited typo just
  doesn't get applied, rather than failing the whole import. A genuinely
  unparseable file (bad JSON) is caught and reported via a small status
  line (`#settingsStatus`), not thrown.
- **Reset to Defaults** button calls `Cubbies.state.resetState(state)`,
  which overwrites the existing state object's fields in place (rather
  than creating a new object) since `main.js`, `ui.js`, and the viewer all
  close over that one object for the app's lifetime — replacing the
  reference instead of mutating it would silently break every closure that
  still pointed at the old one. Also clears the `localStorage` key, and
  confirms first (`window.confirm`) since there's no undo.

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
  nesting.js    pure functions: pieces -> sheet-packing layout
                (guillotine/best-area-fit), grouped by thickness
  svgutil.js    tiny shared SVG helpers (el(), fitLabels()) used by
                sheetlayout.js and piecediagrams.js
  sheetlayout.js  renders nesting.js's layout as SVG cut diagrams
  piecediagrams.js  renders one dimensioned SVG shop drawing per distinct
                piece, from geometry.js's featureFaceRect() output
  ui.js         input panel wiring, validation messages, settings
                export/import/reset, cut-list/piece-diagrams/sheet-layout
                toggles
styles/
  main.css
  print.css
```

Keep `geometry.js` free of any DOM/Three.js dependency — it should be a pure
function from state to a plain-data piece list that both `viewer3d.js` and
`cutlist.js` consume. This is what makes the cut list and the 3D model
guaranteed to match. `nesting.js` follows the same principle: it's a pure
function from a piece list to a plain-data sheet layout, with all rendering
left to `sheetlayout.js` — so the packing logic can be tested and reasoned
about independent of the DOM. `geometry.js`'s `featureFaceRect()` is the
same idea applied to `piecediagrams.js`: it stays a pure box-projection
function, with all SVG construction left to `piecediagrams.js`.

## Settled Design Decisions

These were reasonable defaults flagged for confirmation before or during
implementation, back when this file was still just a spec. They've since
held up through real use — several rounds of testing and bug-fixing never
touched any of them — so treat them as settled, not provisional. Revisit
only if the user explicitly asks for a change here, not as a side effect
of unrelated work:

- Uniform cell size across the whole grid (no per-row/per-column sizing).
- Internal dividers attach to top/bottom via dados cut into the top/bottom
  panels (the original prompt only specified rabbets for the *end*
  pieces).
- No face frame / no inset reveal — frameless construction, openings flush
  with the front.
- Sheet-goods yield/nesting (how pieces lay out on 4×8 sheets) is out of
  scope — hasn't come up as a need.
