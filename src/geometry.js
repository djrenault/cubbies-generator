// Pure state -> piece-list geometry. No DOM, no Three.js — both viewer3d.js
// and cutlist.js consume this module's output so the 3D model and the cut
// list can never drift apart. See CLAUDE.md "Joinery Model & Geometry".
//
// Coordinate system: X = width (left->right), Y = height (bottom->top),
// Z = depth (front->back), origin at the front-bottom-left corner of the
// case panels, units = inches. Each piece has `size` (extents) and `pos`
// (its min corner), so its world box runs pos..pos+size on every axis.
//
// A feature may carry a `cut` — one box, or an array of boxes, each given
// as `{ pos, size }` in coordinates *local to the piece* (pos is the box's
// min corner as an offset from the piece's own pos) — describing material
// to remove for that dado/rabbet. viewer3d.js subtracts these to render
// actual grooves; cutlist.js ignores them and just reads the text fields
// (kind/label/width/depth/at/from). Features with no `cut` (e.g. a shelf's
// "fits into a dado" note) are text-only.

// Lays out `count` bays of `innerSize` separated by `count - 1` gaps of
// width `t`, starting at local 0. Used for both the column axis (bays =
// cubby columns, gaps = internal dividers) and the row axis (bays = cubby
// rows, gaps = internal shelves).
(function () {
  'use strict';

function layoutAxis(count, innerSize, t) {
  const bays = [];
  const gaps = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    bays.push({ index: i, start: cursor, end: cursor + innerSize });
    cursor += innerSize;
    if (i < count - 1) {
      gaps.push({ index: i, start: cursor, end: cursor + t });
      cursor += t;
    }
  }
  return { bays, gaps, total: cursor };
}

// Top/bottom panel features + cuts. `insideAtY0` is true for the top panel
// (its inside/underside face is at local y=0) and false for the bottom
// panel (inside/topside face is at local y=size.y=t) — the two panels
// share the same X/Z joinery layout but cut into opposite Y faces.
function topBottomFeatures({ OW, t, rd, dd, tb, bw, panelDepth, colGaps, insideAtY0, backboardMount }) {
  const cutY = (depth) => (insideAtY0 ? 0 : t - depth);
  const features = [];

  // In inset mode, a divider dado's own Z-reach is trimmed to stop exactly
  // at panelDepth-bw instead of running the full panelDepth: past that
  // point, the back rabbet (below) already cuts the *same or greater*
  // cross-section -- it's deeper (rd vs. the dado's own dd) and, at this
  // dado's X-position, always at least as wide -- so every point back
  // there that the dado would remove is a point the back rabbet already
  // removes. This trim is provably lossless, not an approximation: it's
  // not "these two cuts are close enough that the difference doesn't
  // matter," it's "this region contributes zero additional material
  // removal," verified by checking the dado's trimmed-off cross-section
  // is a full subset of the back rabbet's at every point back there.
  //
  // Three approaches were tried here before landing on this one. Running
  // the dado the full panelDepth (no trim) seems simplest, but a
  // redundant, *volumetrically overlapping* subtraction like that is
  // exactly what breaks three-bvh-csg's mesh-based CSG -- reported as a
  // checkerboard z-fighting glitch, and confirmed independent of how it's
  // built (chained per-cut SUBTRACTION or a single SUBTRACTION of a
  // pre-unioned unioned volume both hit it: a box that's fully contained,
  // sharing whole faces, with another box in the same union is a
  // structurally degenerate case for this library, not a numerical-
  // precision one -- padding it harder (tested up to 50x this file's
  // CSG_EPS) doesn't help, because padding both boxes by the same amount
  // shifts a shared boundary, it doesn't un-share it). Trimming to
  // exactly panelDepth-bw (zero nominal gap) was the next attempt --
  // correct in principle, but back when every cut was subtracted one at a
  // time, two cuts trimmed to touch *exactly* still ended up overlapping
  // by 2*CSG_EPS once CSG_EPS's padding (see viewer3d.js) was applied,
  // and that produced a jagged, badly-triangulated seam. Adding a
  // deliberate JOINT_GAP margin on top of the exact trim "fixed" that,
  // but by opening a real, physical gap where the dado and the back
  // rabbet no longer actually met -- a genuine defect, visible as a
  // mis-colored sliver of uncut material in a user report, and not what
  // the joint should look like: nothing should be left un-rabbeted there.
  // The combination that's actually both lossless and CSG-safe is this
  // exact trim (no JOINT_GAP) *together with* viewer3d.js's union-first
  // build: unioning the dado and the back rabbet into one solid before
  // ever subtracting from the base piece handles the touching boundary
  // (and CSG_EPS's tiny padding-reintroduced overlap there) robustly,
  // the same way ADDITION-then-merge routinely handles two boxes that
  // touch or slightly overlap -- it's specifically the *chained-
  // SUBTRACTION-of-a-redundant-subset* case above that this library
  // can't handle, not touching per se.
  const dadoZ = backboardMount === 'inset' ? panelDepth - bw : panelDepth;

  features.push({
    kind: 'rabbet',
    label: 'left end rabbet (receives left end panel)',
    width: t,
    depth: rd,
    cut: { pos: { x: 0, y: cutY(rd), z: 0 }, size: { x: t, y: rd, z: panelDepth } },
  });
  features.push({
    kind: 'rabbet',
    label: 'right end rabbet (receives right end panel)',
    width: t,
    depth: rd,
    cut: { pos: { x: OW - t, y: cutY(rd), z: 0 }, size: { x: t, y: rd, z: panelDepth } },
  });

  colGaps.forEach((g, i) => {
    const at = t + g.start;
    features.push({
      kind: 'dado',
      label: `divider ${i + 1} dado`,
      width: t,
      depth: dd,
      at,
      from: 'left edge',
      cut: { pos: { x: at, y: cutY(dd), z: 0 }, size: { x: t, y: dd, z: dadoZ } },
    });
  });

  if (backboardMount === 'inset') {
    // Depth is `rd`, not `tb` -- the un-rabbeted material left in front of
    // this cut (`t - rd`) is the rabbet's shoulder, same role `rd` already
    // plays for the corner rabbet above. Using `tb` here used to mean the
    // shoulder depended on backboard thickness at all, which breaks for
    // `tb >= t` (see CLAUDE.md "Joinery Model & Geometry", item 5) and,
    // even for a valid `tb`, doesn't match how far the backboard's edge
    // actually needs to reach into this pocket (fixed together with that
    // extension below, in computePieces).
    //
    // X-range trimmed to [t, OW - t] -- not the full OW -- for the mirror
    // -image reason `dadoZ` above is trimmed: the corner zones (X: 0..t
    // and OW-t..OW) are already fully covered by the end rabbets, at the
    // *same* rd depth and the *same* Y-range this cut would use, over
    // this cut's *entire* Z-range there -- not just overlapping, but an
    // exact subset on two full axes, the specific degenerate shape that
    // breaks three-bvh-csg regardless of padding (see `dadoZ`'s comment).
    // Trimming here is exactly as lossless as trimming the dado is: zero
    // material in the corner goes un-removed, since the end rabbet was
    // already removing all of it.
    features.push({
      kind: 'rabbet',
      label: 'back rabbet (receives backboard)',
      width: bw,
      depth: rd,
      cut: { pos: { x: t, y: cutY(rd), z: panelDepth - bw }, size: { x: OW - 2 * t, y: rd, z: bw } },
    });
  }

  return features;
}

// End panel features + cuts. `insideAtMaxX` is true for the left end panel
// (its inside face, toward the case interior, is at local x=size.x=t) and
// false for the right end panel (inside face at local x=0).
//
// The panel's own length is extended by `rd` at each end (see
// computePieces) so its tongues actually fill the rabbet pockets cut into
// the top/bottom panels — its local y=0 is therefore `rd` *below* the old
// "clear height" origin, so every y-coordinate here is shifted by +rd to
// land in the same global position as before.
function endFeatures({ t, rd, dd, tb, bw, panelDepth, endHeight, rowGaps, insideAtMaxX, backboardMount }) {
  const cutX = (depth) => (insideAtMaxX ? t - depth : 0);
  const features = [];

  // Same reasoning (and the same provably-lossless trim) as `dadoZ` in
  // topBottomFeatures: in inset mode, a shelf dado's Z-reach stops exactly
  // at panelDepth-bw, since the end panel's own back rabbet below already
  // covers its full cross-section for any Z past that point.
  const dadoZ = backboardMount === 'inset' ? panelDepth - bw : panelDepth;

  rowGaps.forEach((g, i) => {
    features.push({
      kind: 'dado',
      label: `shelf ${i + 1} dado`,
      width: t,
      depth: dd,
      at: g.start,
      from: 'bottom edge',
      cut: { pos: { x: cutX(dd), y: g.start + rd, z: 0 }, size: { x: dd, y: t, z: dadoZ } },
    });
  });

  if (backboardMount === 'inset') {
    // See the matching comment in topBottomFeatures: depth is `rd`, not
    // `tb`. (The `y: rd` position offset here is the panel's own
    // clear-height-origin shift, unrelated to the depth-into-thickness
    // value -- both simply happen to use the same `rd` parameter.)
    features.push({
      kind: 'rabbet',
      label: 'back rabbet (receives backboard)',
      width: bw,
      depth: rd,
      cut: { pos: { x: cutX(rd), y: rd, z: panelDepth - bw }, size: { x: rd, y: endHeight, z: bw } },
    });
  }

  return features;
}

// Internal divider features + cuts: dados on both faces at each shelf row
// boundary. The top/bottom-edge "received into a dado" notes are text-only
// — that groove is modeled on the top/bottom panel, not the divider itself.
//
// Like the end panel, the divider's own length is extended by `dd` at each
// end so its tongues fill the top/bottom panel's divider dados, so every
// y-coordinate here is shifted by +dd (see computePieces).
function dividerFeatures({ t, dd, id, rowGaps }) {
  const features = [];

  rowGaps.forEach((g, i) => {
    features.push({
      kind: 'dado',
      label: `shelf ${i + 1} dado (both faces)`,
      width: t,
      depth: dd,
      at: g.start,
      from: 'bottom edge',
      cut: [
        { pos: { x: 0, y: g.start + dd, z: 0 }, size: { x: dd, y: t, z: id } },
        { pos: { x: t - dd, y: g.start + dd, z: 0 }, size: { x: dd, y: t, z: id } },
      ],
    });
  });

  features.push({ kind: 'dado', label: 'top edge, received into top panel dado', width: t, depth: dd });
  features.push({ kind: 'dado', label: 'bottom edge, received into bottom panel dado', width: t, depth: dd });

  return features;
}

// Short, cut-list-style names per piece type, shared by cutlist.js's
// grouped rows and sheetlayout.js's diagram labels. Individual pieces
// within a type are interchangeable (identical dimensions and joinery --
// e.g. any "Shelf" can go in any shelf slot), which is exactly why the cut
// list collapses them into one row with a qty count; the diagram labels
// pieces the same way (short type name + an instance number) rather than
// geometry.js's fuller per-instance `label` (built for 3D-viewer
// tooltips/identification, where distinguishing "left" from "right" or one
// divider from another actually matters).
const PIECE_LABELS = {
  'top-bottom': 'Top / Bottom Panel',
  end: 'End Panel',
  divider: 'Internal Divider',
  shelf: 'Shelf',
  backboard: 'Backboard',
};

// Maps a piece's raw {x,y,z} size onto woodworker-facing Length / Width /
// Thickness — used by both cutlist.js (the table columns) and nesting.js
// (length x width is exactly the sheet-goods footprint; thickness is which
// sheet-stock group it belongs to). Single source of truth for that
// mapping so the two can't drift apart.
function pieceFootprint(piece) {
  switch (piece.type) {
    case 'top-bottom':
    case 'shelf':
      return { length: piece.size.x, width: piece.size.z, thickness: piece.size.y };
    case 'end':
    case 'divider':
      return { length: piece.size.y, width: piece.size.z, thickness: piece.size.x };
    case 'backboard':
      return { length: piece.size.x, width: piece.size.y, thickness: piece.size.z };
    default:
      return { length: piece.size.x, width: piece.size.y, thickness: piece.size.z };
  }
}

// Projects a feature's local `cut` box(es) onto the 2D face piecediagrams.js
// draws for this piece type -- the same face pieceFootprint's length/width
// describe -- so the diagram is built from exactly what geometry.js modeled
// (and what viewer3d.js actually carves) instead of re-deriving axis
// mappings independently in a second place where they could drift out of
// sync. Returns null for a feature with no `cut` (a text-only joinery note
// -- e.g. a divider's end-grain top/bottom dados, or a shelf's "seats into
// a dado" note) -- piecediagrams.js lists those as plain text instead of
// drawing them. A divider's shelf dado carries *two* cuts (one per face,
// see dividerFeatures) that project to the identical face rect by
// construction, so taking the first is enough; nothing else in this model
// emits more than one cut per feature.
function featureFaceRect(piece, feature) {
  if (!feature.cut) return null;
  const c = Array.isArray(feature.cut) ? feature.cut[0] : feature.cut;
  switch (piece.type) {
    case 'top-bottom':
      return { x: c.pos.x, y: c.pos.z, w: c.size.x, h: c.size.z };
    case 'end':
    case 'divider':
      return { x: c.pos.y, y: c.pos.z, w: c.size.y, h: c.size.z };
    default:
      return null;
  }
}

function computePieces(state) {
  if (state.errors.length) return { pieces: [], errors: state.errors };

  const { rows: R, columns: C, t, tb, iw, ih, id, ow: OW, oh: OH, dd, rd, bw, backboardMount } = state;

  const panelDepth = backboardMount === 'inset' ? id + tb : id;

  // colLayout gaps/bays are in "inner" coordinates: local 0 = left inner
  // face of the case (global X = t + local). rowLayout is analogous for Y.
  const colLayout = layoutAxis(C, iw, t);
  const rowLayout = layoutAxis(R, ih, t);

  const pieces = [];
  let counter = 0;
  const add = (piece) => {
    pieces.push({ id: `${piece.type}-${++counter}`, ...piece });
  };

  const endHeight = OH - 2 * t;
  const featureArgs = { OW, t, rd, dd, tb, bw, panelDepth, colGaps: colLayout.gaps, backboardMount };

  // Top / Bottom panels
  add({
    type: 'top-bottom',
    label: 'Top Panel',
    size: { x: OW, y: t, z: panelDepth },
    pos: { x: 0, y: OH - t, z: 0 },
    features: topBottomFeatures({ ...featureArgs, insideAtY0: true }),
  });
  add({
    type: 'top-bottom',
    label: 'Bottom Panel',
    size: { x: OW, y: t, z: panelDepth },
    pos: { x: 0, y: 0, z: 0 },
    features: topBottomFeatures({ ...featureArgs, insideAtY0: false }),
  });

  // End panels — length extended by rd at each end so the panel's own
  // material actually fills the rabbet pocket cut into the top/bottom
  // panels, instead of stopping flush at the old shoulder and leaving that
  // pocket empty.
  const endLength = endHeight + 2 * rd;
  const endArgs = { t, rd, dd, tb, bw, panelDepth, endHeight, rowGaps: rowLayout.gaps, backboardMount };
  add({
    type: 'end',
    label: 'End Panel — Left',
    size: { x: t, y: endLength, z: panelDepth },
    pos: { x: 0, y: t - rd, z: 0 },
    features: endFeatures({ ...endArgs, insideAtMaxX: true }),
  });
  add({
    type: 'end',
    label: 'End Panel — Right',
    size: { x: t, y: endLength, z: panelDepth },
    pos: { x: OW - t, y: t - rd, z: 0 },
    features: endFeatures({ ...endArgs, insideAtMaxX: false }),
  });

  // Internal vertical dividers — same idea, extended by dd at each end to
  // fill the top/bottom panel's divider dado instead of stopping short of it.
  const dividerLength = endHeight + 2 * dd;
  colLayout.gaps.forEach((g, i) => {
    add({
      type: 'divider',
      label: `Internal Divider ${i + 1}`,
      size: { x: t, y: dividerLength, z: id },
      pos: { x: t + g.start, y: t - dd, z: 0 },
      features: dividerFeatures({ t, dd, id, rowGaps: rowLayout.gaps }),
    });
  });

  // Shelves
  colLayout.bays.forEach((bay, colIdx) => {
    rowLayout.gaps.forEach((rg, rowIdx) => {
      add({
        type: 'shelf',
        label: `Shelf — Row ${rowIdx + 1}, Column ${colIdx + 1}`,
        size: { x: iw + 2 * dd, y: t, z: id },
        pos: { x: t + bay.start - dd, y: t + rg.start, z: 0 },
        features: [{ kind: 'fit', label: 'seats into dado on each end', width: dd }],
      });
    });
  });

  // Backboard
  if (backboardMount === 'outset') {
    add({
      type: 'backboard',
      label: 'Backboard',
      size: { x: OW, y: OH, z: tb },
      pos: { x: 0, y: 0, z: panelDepth },
      features: [
        { kind: 'assembly', label: 'screwed to back edges of top, bottom, end panels, and dividers' },
      ],
    });
  } else {
    // Extended by rd (not bw) at each edge, same tongue-fills-pocket
    // pattern as the end panels/dividers above -- rd is now also the
    // depth of the back rabbet pocket this reaches into (see
    // topBottomFeatures/endFeatures), so the two have to move together.
    add({
      type: 'backboard',
      label: 'Backboard',
      size: { x: OW - 2 * t + 2 * rd, y: OH - 2 * t + 2 * rd, z: tb },
      pos: { x: t - rd, y: t - rd, z: panelDepth - tb },
      features: [{ kind: 'note', label: 'sits in perimeter rabbet, flush with back face' }],
    });
  }

  return { pieces, errors: [] };
}

window.Cubbies = window.Cubbies || {};
window.Cubbies.geometry = { computePieces, pieceFootprint, PIECE_LABELS, featureFaceRect };

})();
