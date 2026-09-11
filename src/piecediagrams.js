// Per-piece-type shop drawings: one 2D diagram per distinct piece (same
// "identical pieces collapse to one row" grouping the cut list uses, since
// every physical instance within a group is interchangeable by
// construction), showing the outer dimensions and the position/size of
// every dado and rabbet cut into it.
//
// Geometry comes straight from each feature's `cut` box via
// geometry.js's featureFaceRect() -- the same boxes viewer3d.js subtracts
// with CSG -- rather than from the feature's `at`/`from` text fields the
// cut list displays. Those two are deliberately different numbers for an
// end panel or divider: `at`/`from` describes a dado's position relative
// to the *assembled case*'s reference edges (e.g. "12" from the bottom
// edge" means from the clear-height bottom of the finished cubby), but an
// end panel's or divider's own length is extended by `rd`/`dd` past that
// reference edge so its tongue fills the receiving pocket (see CLAUDE.md
// "Joinery Model & Geometry", items 2-3) -- so the piece's own physical
// bottom tip sits `rd`/`dd` below that datum. A dimension measured from
// the case's clear-height bottom isn't something you can mark with a tape
// on the raw, not-yet-installed board; a dimension measured from the
// piece's own physical edge is. This module draws (and dimensions) from
// the latter, on purpose.
//
// Live, not button-gated like the sheet layout: this is bounded by the
// number of distinct piece *types* (at most 5, regardless of grid size),
// not physical instance count, so it's cheap enough to redraw on every
// input change same as the cut list.

(function () {
  'use strict';

const { formatFraction } = Cubbies.units;
const { pieceFootprint, PIECE_LABELS, featureFaceRect } = Cubbies.geometry;
const { el, fitLabels } = Cubbies.svgutil;

const EPS = 1e-6;
const PAD = 0.3; // inches of blank margin around the whole diagram
const TOP_MARGIN = 0.55; // room for the overall-length dimension line
const LEFT_MARGIN = 0.65; // room for the overall-width dimension line
const LANE = 0.42; // height/width of one stacked internal-dimension lane
const ARROW = 0.08;
const DIM_FONT_SIZE = 0.16;

const GROUP_ORDER = ['top-bottom', 'end', 'divider', 'shelf', 'backboard'];

function round4(v) {
  return Math.round((v || 0) * 10000) / 10000;
}

// Same signature scheme as cutlist.js's row-collapsing: type + footprint +
// per-feature kind/width/depth. Kept as a local copy rather than an import
// from cutlist.js since it's five lines of pure grouping logic, not a
// piece of shared structural truth the way pieceFootprint/PIECE_LABELS are
// (nesting.js's own independent instance-numbering follows the same
// precedent).
function groupPieces(pieces) {
  const groups = new Map();
  pieces.forEach((p) => {
    const d = pieceFootprint(p);
    const feats = (p.features || [])
      .map((f) => `${f.kind}:${round4(f.width)}:${round4(f.depth)}`)
      .sort()
      .join('|');
    const sig = `${p.type}|${round4(d.length)}|${round4(d.width)}|${round4(d.thickness)}|${feats}`;
    if (!groups.has(sig)) groups.set(sig, { piece: p, qty: 0 });
    groups.get(sig).qty += 1;
  });
  return Array.from(groups.values()).sort(
    (a, b) => GROUP_ORDER.indexOf(a.piece.type) - GROUP_ORDER.indexOf(b.piece.type)
  );
}

function bandLabel(f, precision) {
  const kind = f.kind === 'rabbet' ? 'Rabbet' : f.kind === 'dado' ? 'Dado' : f.kind;
  const dims = [];
  if (f.width != null) dims.push(`${formatFraction(f.width, precision)} W`);
  if (f.depth != null) dims.push(`${formatFraction(f.depth, precision)} D`);
  return dims.length ? `${kind} ${dims.join(' × ')}` : kind;
}

// Text for a feature with no drawable rect -- no `cut` means no on-piece
// position to dimension (a divider's end-grain top/bottom dados, a
// shelf's "seats into a dado" note, a backboard's assembly note) -- so
// it's listed instead of drawn. Deliberately omits `at`/`from`: those
// notes already exist purely as text (there's no cut-box datum mismatch
// to resolve for them the way there is for drawn bands, since there's
// nothing here measured from the piece's own physical edge in the first
// place).
function noteText(f, precision) {
  let text = f.label || f.kind;
  const dims = [];
  if (f.width != null) dims.push(`${formatFraction(f.width, precision)} W`);
  if (f.depth != null) dims.push(`${formatFraction(f.depth, precision)} D`);
  if (dims.length) text += ` (${dims.join(' × ')})`;
  return text;
}

function hDim(parent, x1, x2, y, label) {
  const g = el('g', { class: 'dim' }, parent);
  el('line', { x1, y1: y, x2, y2: y, class: 'dim-line' }, g);
  el('path', { d: `M${x1},${y} L${x1 + ARROW},${y - ARROW / 2} L${x1 + ARROW},${y + ARROW / 2} Z`, class: 'dim-arrow' }, g);
  el('path', { d: `M${x2},${y} L${x2 - ARROW},${y - ARROW / 2} L${x2 - ARROW},${y + ARROW / 2} Z`, class: 'dim-arrow' }, g);
  const text = el(
    'text',
    { x: (x1 + x2) / 2, y: y - 0.07, 'text-anchor': 'middle', 'font-size': DIM_FONT_SIZE, class: 'dim-text' },
    g
  );
  text.textContent = label;
}

function vDim(parent, y1, y2, x, label) {
  const g = el('g', { class: 'dim' }, parent);
  el('line', { x1: x, y1, x2: x, y2, class: 'dim-line' }, g);
  el('path', { d: `M${x},${y1} L${x - ARROW / 2},${y1 + ARROW} L${x + ARROW / 2},${y1 + ARROW} Z`, class: 'dim-arrow' }, g);
  el('path', { d: `M${x},${y2} L${x - ARROW / 2},${y2 - ARROW} L${x + ARROW / 2},${y2 - ARROW} Z`, class: 'dim-arrow' }, g);
  const cy = (y1 + y2) / 2;
  const text = el(
    'text',
    {
      x,
      y: cy - 0.07,
      'text-anchor': 'middle',
      'font-size': DIM_FONT_SIZE,
      class: 'dim-text',
      transform: `rotate(-90 ${x} ${cy})`,
    },
    g
  );
  text.textContent = label;
}

function extLine(parent, x1, y1, x2, y2) {
  el('line', { x1, y1, x2, y2, class: 'dim-ext' }, parent);
}

function renderPieceSvg(piece, precision) {
  const { length, width } = pieceFootprint(piece);

  const bands = (piece.features || [])
    .map((f) => ({ feature: f, rect: featureFaceRect(piece, f) }))
    .filter((b) => b.rect && b.rect.w > EPS && b.rect.h > EPS);

  // A band that spans (relatively) more of the width axis than the length
  // axis is a "vertical" band -- its position varies along length (x) --
  // and vice versa. A ratio comparison (rather than an exact "== full
  // width" check) is what's needed here, not just a nicety: the inset
  // backboard's rabbet on an end panel spans nearly the full length but
  // stops `rd` short at each end (it shares the corner with the rabbet
  // joint there), so it never exactly equals the piece's full length.
  bands.forEach((b) => {
    const { rect } = b;
    b.vertical = rect.h / width >= rect.w / length;
    b.edgeFlush = b.vertical
      ? rect.x <= EPS || rect.x + rect.w >= length - EPS
      : rect.y <= EPS || rect.y + rect.h >= width - EPS;
  });

  // Only bands that aren't obviously flush with an edge get their own
  // stacked position-dimension line -- an edge rabbet's position is
  // already implied by the overall dimension, so a redundant callout
  // would just be clutter.
  const vLaneBands = bands.filter((b) => b.vertical && !b.edgeFlush);
  const hLaneBands = bands.filter((b) => !b.vertical && !b.edgeFlush);

  const bottomMargin = PAD + (vLaneBands.length ? vLaneBands.length * LANE + 0.15 : 0);
  const rightMargin = PAD + (hLaneBands.length ? hLaneBands.length * LANE + 0.15 : 0);

  const originX = LEFT_MARGIN;
  const originY = TOP_MARGIN;
  const viewW = LEFT_MARGIN + length + rightMargin;
  const viewH = TOP_MARGIN + width + bottomMargin;

  const svg = el('svg', {
    viewBox: `0 0 ${viewW} ${viewH}`,
    class: 'piece-svg',
    role: 'img',
    'aria-label': `${PIECE_LABELS[piece.type] || piece.type} diagram`,
  });

  const px = (x) => originX + x;
  const py = (y) => originY + y;

  el('rect', { x: originX, y: originY, width: length, height: width, class: 'piece-outline' }, svg);

  bands.forEach((b) => {
    const { rect, feature } = b;
    const g = el('g', {}, svg);
    el(
      'rect',
      {
        x: px(rect.x),
        y: py(rect.y),
        width: rect.w,
        height: rect.h,
        class: feature.kind === 'rabbet' ? 'piece-cut-rabbet' : 'piece-cut-dado',
      },
      g
    );
    const label = bandLabel(feature, precision);
    el('title', {}, g).textContent = feature.label ? `${feature.label} — ${label}` : label;

    const rotate = rect.h > rect.w * 1.3;
    const fontSize = Math.max(0.28, Math.min(rect.w, rect.h) * 0.22);
    const cx = px(rect.x + rect.w / 2);
    const cy = py(rect.y + rect.h / 2);
    const textAttrs = {
      x: cx,
      y: cy,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      'font-size': fontSize,
      class: 'piece-cut-label',
      'data-avail-width': (rotate ? rect.h : rect.w) * 0.9,
      'data-base-font-size': fontSize,
    };
    if (rotate) textAttrs.transform = `rotate(-90 ${cx} ${cy})`;
    el('text', textAttrs, g).textContent = label;
  });

  // Overall length (top) and width (left) dimensions.
  const lenY = originY - 0.25;
  extLine(svg, originX, originY, originX, lenY - 0.08);
  extLine(svg, originX + length, originY, originX + length, lenY - 0.08);
  hDim(svg, originX, originX + length, lenY, formatFraction(length, precision));

  const widX = originX - 0.25;
  extLine(svg, originX, originY, widX - 0.08, originY);
  extLine(svg, originX, originY + width, widX - 0.08, originY + width);
  vDim(svg, originY, originY + width, widX, formatFraction(width, precision));

  // Internal band position dimensions, stacked outward one lane per band
  // so multiple dados (e.g. several shelf dados on one end panel) don't
  // overlap each other.
  if (vLaneBands.length) {
    const laneBaseY = originY + width;
    extLine(svg, originX, laneBaseY, originX, laneBaseY + vLaneBands.length * LANE);
    vLaneBands.forEach((b, i) => {
      const laneY = laneBaseY + i * LANE + LANE / 2;
      const bx = originX + b.rect.x;
      extLine(svg, bx, laneBaseY, bx, laneY + 0.08);
      hDim(svg, originX, bx, laneY, formatFraction(b.rect.x, precision));
    });
  }

  if (hLaneBands.length) {
    const laneBaseX = originX + length;
    extLine(svg, laneBaseX, originY, laneBaseX + hLaneBands.length * LANE, originY);
    hLaneBands.forEach((b, i) => {
      const laneX = laneBaseX + i * LANE + LANE / 2;
      const by = originY + b.rect.y;
      extLine(svg, laneBaseX, by, laneX + 0.08, by);
      vDim(svg, originY, by, laneX, formatFraction(b.rect.y, precision));
    });
  }

  return svg;
}

function renderPieceDiagrams(container, pieces, precision) {
  container.innerHTML = '';

  if (pieces.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Fix the errors above to generate piece diagrams.';
    container.appendChild(p);
    return;
  }

  groupPieces(pieces).forEach(({ piece, qty }) => {
    const wrap = document.createElement('div');
    wrap.className = 'piece-diagram';

    const caption = document.createElement('p');
    caption.className = 'piece-caption';
    caption.textContent = `${PIECE_LABELS[piece.type] || piece.type} — qty ${qty}`;
    wrap.appendChild(caption);

    wrap.appendChild(renderPieceSvg(piece, precision));

    const notes = (piece.features || []).filter((f) => !featureFaceRect(piece, f));
    if (notes.length) {
      const ul = document.createElement('ul');
      ul.className = 'piece-notes';
      notes.forEach((f) => {
        const li = document.createElement('li');
        li.textContent = noteText(f, precision);
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
    }

    container.appendChild(wrap);
  });

  fitLabels(container);
}

window.Cubbies = window.Cubbies || {};
window.Cubbies.piecediagrams = { renderPieceDiagrams };

})();
