// Pure state -> piece-list geometry. No DOM, no Three.js — both viewer3d.js
// and cutlist.js consume this module's output so the 3D model and the cut
// list can never drift apart. See CLAUDE.md "Joinery Model & Geometry".
//
// Coordinate system: X = width (left->right), Y = height (bottom->top),
// Z = depth (front->back), origin at the front-bottom-left corner of the
// case panels, units = inches. Each piece has `size` (extents) and `pos`
// (its min corner), so its world box runs pos..pos+size on every axis.

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

  const backboardRabbetFeature = () =>
    backboardMount === 'inset'
      ? [{ kind: 'rabbet', label: 'back rabbet (receives backboard)', width: bw, depth: tb }]
      : [];

  // Top / Bottom panels
  const dividerDadoFeatures = colLayout.gaps.map((g, i) => ({
    kind: 'dado',
    label: `divider ${i + 1} dado`,
    width: t,
    depth: dd,
    at: t + g.start,
    from: 'left edge',
  }));
  const endRabbetFeatures = [
    { kind: 'rabbet', label: 'left end rabbet (receives left end panel)', width: t, depth: rd },
    { kind: 'rabbet', label: 'right end rabbet (receives right end panel)', width: t, depth: rd },
  ];
  const topBottomFeatures = [...endRabbetFeatures, ...dividerDadoFeatures, ...backboardRabbetFeature()];

  add({
    type: 'top-bottom',
    label: 'Top Panel',
    size: { x: OW, y: t, z: panelDepth },
    pos: { x: 0, y: OH - t, z: 0 },
    features: topBottomFeatures,
  });
  add({
    type: 'top-bottom',
    label: 'Bottom Panel',
    size: { x: OW, y: t, z: panelDepth },
    pos: { x: 0, y: 0, z: 0 },
    features: topBottomFeatures,
  });

  // End panels
  const shelfDadoFeatures = rowLayout.gaps.map((g, i) => ({
    kind: 'dado',
    label: `shelf ${i + 1} dado`,
    width: t,
    depth: dd,
    at: g.start,
    from: 'bottom edge',
  }));
  const endFeatures = [...shelfDadoFeatures, ...backboardRabbetFeature()];

  add({
    type: 'end',
    label: 'End Panel — Left',
    size: { x: t, y: OH - 2 * t, z: panelDepth },
    pos: { x: 0, y: t, z: 0 },
    features: endFeatures,
  });
  add({
    type: 'end',
    label: 'End Panel — Right',
    size: { x: t, y: OH - 2 * t, z: panelDepth },
    pos: { x: OW - t, y: t, z: 0 },
    features: endFeatures,
  });

  // Internal vertical dividers
  const dividerFeatures = [
    ...rowLayout.gaps.map((g, i) => ({
      kind: 'dado',
      label: `shelf ${i + 1} dado (both faces)`,
      width: t,
      depth: dd,
      at: g.start,
      from: 'bottom edge',
    })),
    { kind: 'dado', label: 'top edge, received into top panel dado', width: t, depth: dd },
    { kind: 'dado', label: 'bottom edge, received into bottom panel dado', width: t, depth: dd },
  ];
  colLayout.gaps.forEach((g, i) => {
    add({
      type: 'divider',
      label: `Internal Divider ${i + 1}`,
      size: { x: t, y: OH - 2 * t, z: id },
      pos: { x: t + g.start, y: t, z: 0 },
      features: dividerFeatures,
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
