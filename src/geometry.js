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
      cut: { pos: { x: at, y: cutY(dd), z: 0 }, size: { x: t, y: dd, z: panelDepth } },
    });
  });

  if (backboardMount === 'inset') {
    features.push({
      kind: 'rabbet',
      label: 'back rabbet (receives backboard)',
      width: bw,
      depth: tb,
      cut: { pos: { x: 0, y: cutY(tb), z: panelDepth - bw }, size: { x: OW, y: tb, z: bw } },
    });
  }

  return features;
}

// End panel features + cuts. `insideAtMaxX` is true for the left end panel
// (its inside face, toward the case interior, is at local x=size.x=t) and
// false for the right end panel (inside face at local x=0).
function endFeatures({ t, dd, tb, bw, panelDepth, endHeight, rowGaps, insideAtMaxX, backboardMount }) {
  const cutX = (depth) => (insideAtMaxX ? t - depth : 0);
  const features = [];

  rowGaps.forEach((g, i) => {
    features.push({
      kind: 'dado',
      label: `shelf ${i + 1} dado`,
      width: t,
      depth: dd,
      at: g.start,
      from: 'bottom edge',
      cut: { pos: { x: cutX(dd), y: g.start, z: 0 }, size: { x: dd, y: t, z: panelDepth } },
    });
  });

  if (backboardMount === 'inset') {
    features.push({
      kind: 'rabbet',
      label: 'back rabbet (receives backboard)',
      width: bw,
      depth: tb,
      cut: { pos: { x: cutX(tb), y: 0, z: panelDepth - bw }, size: { x: tb, y: endHeight, z: bw } },
    });
  }

  return features;
}

// Internal divider features + cuts: dados on both faces at each shelf row
// boundary. The top/bottom-edge "received into a dado" notes are text-only
// — that groove is modeled on the top/bottom panel, not the divider itself.
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
        { pos: { x: 0, y: g.start, z: 0 }, size: { x: dd, y: t, z: id } },
        { pos: { x: t - dd, y: g.start, z: 0 }, size: { x: dd, y: t, z: id } },
      ],
    });
  });

  features.push({ kind: 'dado', label: 'top edge, received into top panel dado', width: t, depth: dd });
  features.push({ kind: 'dado', label: 'bottom edge, received into bottom panel dado', width: t, depth: dd });

  return features;
}

export function computePieces(state) {
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

  // End panels
  const endArgs = { t, dd, tb, bw, panelDepth, endHeight, rowGaps: rowLayout.gaps, backboardMount };
  add({
    type: 'end',
    label: 'End Panel — Left',
    size: { x: t, y: endHeight, z: panelDepth },
    pos: { x: 0, y: t, z: 0 },
    features: endFeatures({ ...endArgs, insideAtMaxX: true }),
  });
  add({
    type: 'end',
    label: 'End Panel — Right',
    size: { x: t, y: endHeight, z: panelDepth },
    pos: { x: OW - t, y: t, z: 0 },
    features: endFeatures({ ...endArgs, insideAtMaxX: false }),
  });

  // Internal vertical dividers
  colLayout.gaps.forEach((g, i) => {
    add({
      type: 'divider',
      label: `Internal Divider ${i + 1}`,
      size: { x: t, y: endHeight, z: id },
      pos: { x: t + g.start, y: t, z: 0 },
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
    add({
      type: 'backboard',
      label: 'Backboard',
      size: { x: OW - 2 * t + 2 * bw, y: OH - 2 * t + 2 * bw, z: tb },
      pos: { x: t - bw, y: t - bw, z: panelDepth - tb },
      features: [{ kind: 'note', label: 'sits in perimeter rabbet, flush with back face' }],
    });
  }

  return { pieces, errors: [] };
}
