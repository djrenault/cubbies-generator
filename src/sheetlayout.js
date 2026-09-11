(function () {
  'use strict';

const { formatFraction } = Cubbies.units;
const { SVG_NS, MIN_FONT_SIZE, el, fitLabels } = Cubbies.svgutil;

const GOLDEN_ANGLE = 137.508; // same convention as viewer3d.js's "identify" color mode

// Sheet diagrams always render landscape (wider than tall) regardless of
// which of sheetW/sheetH the user entered as the bigger number -- that's
// the conventional way a cut diagram is drawn (long edge horizontal, as
// the sheet would sit on a table saw), independent of how the packing math
// itself is oriented internally.
function makeTransposer(sheetW, sheetH) {
  const swap = sheetH > sheetW;
  return {
    displayW: swap ? sheetH : sheetW,
    displayH: swap ? sheetW : sheetH,
    rect: (x, y, w, h) => (swap ? { x: y, y: x, w: h, h: w } : { x, y, w, h }),
  };
}

function renderSheetSvg(sheet, sheetW, sheetH, precision) {
  const t = makeTransposer(sheetW, sheetH);
  const svg = el('svg', {
    viewBox: `0 0 ${t.displayW} ${t.displayH}`,
    class: 'sheet-svg',
    role: 'img',
    'aria-label': `Sheet layout, ${sheet.placements.length} pieces`,
  });

  // defs (and every clipPath in it) goes in before anything that
  // references one, rather than wherever the loop below first happens to
  // need one -- SVG resolves clip-path url() references regardless of
  // document order in normal rendering, but this keeps things resolvable
  // even in stricter/streaming renderers (e.g. print/PDF pipelines) that
  // aren't guaranteed to forward-reference.
  const defs = el('defs', {}, svg);
  el('rect', { x: 0, y: 0, width: t.displayW, height: t.displayH, class: 'sheet-outline' }, svg);

  sheet.placements.forEach((p, i) => {
    const r = t.rect(p.x, p.y, p.w, p.h);
    const hue = (p.__colorIndex * GOLDEN_ANGLE) % 360;
    const g = el('g', {}, svg);

    const clipId = `clip-${sheet.index}-${i}-${Math.round(Math.random() * 1e6)}`;
    const clipPath = el('clipPath', { id: clipId }, defs);
    el('rect', { x: r.x, y: r.y, width: r.w, height: r.h }, clipPath);

    el(
      'rect',
      {
        x: r.x,
        y: r.y,
        width: r.w,
        height: r.h,
        fill: `hsl(${hue}, 55%, 82%)`,
        stroke: `hsl(${hue}, 45%, 45%)`,
        'stroke-width': 0.06,
        class: 'sheet-piece',
      },
      g
    );

    // A label like "Internal Divider #1" is often wider than a narrow
    // piece's short side, so horizontal text on a tall/narrow piece would
    // just overflow. Run the text along whichever axis is actually long
    // enough to hold it -- and separately, actually shrink it to fit
    // rather than relying only on the clip-path below to hide the
    // overflow (see fitLabels: clipping alone can crop text
    // mid-character, which is a worse result even when it works).
    const labelGroup = el('g', { 'clip-path': `url(#${clipId})` }, g);
    const rotateText = r.h > r.w * 1.3;
    const fontSize = Math.max(MIN_FONT_SIZE, Math.min(r.w, r.h) * 0.16);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const textAttrs = {
      x: cx,
      y: cy,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      'font-size': fontSize,
      fill: '#2a2620',
      'data-avail-width': (rotateText ? r.h : r.w) * 0.9,
      'data-base-font-size': fontSize,
    };
    if (rotateText) textAttrs.transform = `rotate(-90 ${cx} ${cy})`;
    const text = el('text', textAttrs, labelGroup);
    el('tspan', { x: cx, dy: -fontSize * 0.6 }, text).textContent = p.label;
    el('tspan', { x: cx, dy: fontSize * 1.2 }, text).textContent =
      `${formatFraction(p.w, precision)} × ${formatFraction(p.h, precision)}${p.rotated ? ' (rotated)' : ''}`;

    el('title', {}, g).textContent =
      `${p.label} — ${formatFraction(p.w, precision)} × ${formatFraction(p.h, precision)}${p.rotated ? ' (rotated)' : ''}`;
  });

  return svg;
}

// fitLabels (shrink-to-fit via getComputedTextLength(), run after SVGs are
// attached to the document) lives in svgutil.js now, shared with
// piecediagrams.js -- see that file for the rationale.

function renderSheetLayout(container, result, options) {
  const { precision, sheetW, sheetH } = options;
  container.innerHTML = '';

  if (result.errors && result.errors.length) {
    result.errors.forEach((msg) => {
      const div = document.createElement('div');
      div.className = 'msg error';
      div.textContent = msg;
      container.appendChild(div);
    });
    if (!result.groups || result.groups.length === 0) return;
  }

  if (!result.groups || result.groups.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Nothing to lay out.';
    container.appendChild(p);
    return;
  }

  const totalSheets = result.groups.reduce((sum, g) => sum + g.sheets.length, 0);
  const totalUsed = result.groups.reduce((sum, g) => sum + g.sheets.reduce((s, sh) => s + sh.usedArea, 0), 0);
  const totalArea = result.groups.reduce((sum, g) => sum + g.sheets.reduce((s, sh) => s + sh.totalArea, 0), 0);
  const overallWaste = totalArea > 0 ? ((totalArea - totalUsed) / totalArea) * 100 : 0;

  const summary = document.createElement('p');
  summary.className = 'hint sheet-summary';
  summary.textContent = `${totalSheets} sheet${totalSheets === 1 ? '' : 's'} total (${sheetW}" × ${sheetH}"), ${overallWaste.toFixed(1)}% overall waste.`;
  container.appendChild(summary);

  let colorIndex = 0;

  result.groups.forEach((group) => {
    const groupWaste =
      group.sheets.reduce((s, sh) => s + sh.totalArea, 0) > 0
        ? (group.sheets.reduce((s, sh) => s + sh.wasteArea, 0) /
            group.sheets.reduce((s, sh) => s + sh.totalArea, 0)) *
          100
        : 0;

    const heading = document.createElement('h3');
    heading.className = 'sheet-group-heading';
    heading.textContent = `${formatFraction(group.thickness, precision)} stock — ${group.pieceCount} piece${
      group.pieceCount === 1 ? '' : 's'
    }, ${group.sheets.length} sheet${group.sheets.length === 1 ? '' : 's'}, ${groupWaste.toFixed(1)}% waste`;
    container.appendChild(heading);

    group.sheets.forEach((sheet) => {
      sheet.placements.forEach((p) => {
        p.__colorIndex = colorIndex++;
      });

      const wrap = document.createElement('div');
      wrap.className = 'sheet-diagram';

      const caption = document.createElement('p');
      caption.className = 'sheet-caption';
      caption.textContent = `Sheet ${sheet.index + 1} of ${group.sheets.length} — ${(100 - sheet.wastePercent).toFixed(1)}% utilized`;
      wrap.appendChild(caption);

      wrap.appendChild(renderSheetSvg(sheet, sheetW, sheetH, precision));
      container.appendChild(wrap);
    });
  });

  fitLabels(container);
}

window.Cubbies = window.Cubbies || {};
window.Cubbies.sheetlayout = { renderSheetLayout };

})();
