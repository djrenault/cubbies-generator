// Sheet-goods nesting: lays the cut list out onto sheetW x sheetH sheets,
// grouped by thickness (a sheet is single-thickness stock), minimizing
// sheet count. Pure: takes the piece list from geometry.js and plain
// options, returns plain data. No DOM — sheetlayout.js renders this.
//
// Algorithm: guillotine packing with best-area-fit placement. Every cut
// this produces is a straight, edge-to-edge cut (never a plunge cut or an
// L-shaped remainder), which is what makes the result something a person
// can actually execute with a track saw or table saw -- a purely
// space-optimal packer (e.g. full maximal-rectangles) can pack tighter but
// can produce shapes that aren't achievable with straight full-length
// cuts. Best-area-fit (place each piece in whichever free rectangle wastes
// the least area, tie-broken by shortest leftover side) is a standard,
// well-documented heuristic for this -- not optimal (bin packing is
// NP-hard) but reliably close and simple enough to hand-verify.
//
// Kerf: applied uniformly as padding on the right/bottom of every piece's
// packing footprint, including where a piece happens to land flush against
// the sheet's own edge (where, in reality, no extra clearance is needed --
// the sheet boundary isn't a cut line). This slightly overstates waste,
// by at most one kerf width per row/column per sheet -- a few hundredths
// of a square foot against a 32 sq ft sheet -- and is far simpler than
// tracking which free-rectangle edges are real cut lines versus the sheet
// boundary. Not worth the complexity for that precision.

(function () {
  'use strict';

// Best-area-fit guillotine packing for one thickness group's pieces onto
// as many sheetW x sheetH sheets as needed. `items`: [{ id, label, w, h }]
// nominal (un-padded) sizes. Returns { sheets: [...], errors: [...] }.
function packGroup(items, sheetW, sheetH, kerf, allowRotation) {
  const errors = [];

  const packable = items.filter((it) => {
    const fitsAsIs = it.w + kerf <= sheetW && it.h + kerf <= sheetH;
    const fitsRotated = allowRotation && it.h + kerf <= sheetW && it.w + kerf <= sheetH;
    if (!fitsAsIs && !fitsRotated) {
      errors.push(
        `${it.label} (${it.w.toFixed(3)}" x ${it.h.toFixed(3)}") doesn't fit on a ${sheetW}" x ${sheetH}" sheet in either orientation.`
      );
      return false;
    }
    return true;
  });

  // Largest area first: a standard, simple offline-packing heuristic --
  // place big pieces while the most contiguous free space still exists.
  const queue = packable.slice().sort((a, b) => b.w * b.h - a.w * a.h);

  const sheets = [];

  function contains(a, b) {
    return (
      b.x >= a.x - 1e-9 &&
      b.y >= a.y - 1e-9 &&
      b.x + b.w <= a.x + a.w + 1e-9 &&
      b.y + b.h <= a.y + a.h + 1e-9
    );
  }

  function newSheet() {
    const sheet = { freeRects: [{ x: 0, y: 0, w: sheetW, h: sheetH }], placements: [] };
    sheets.push(sheet);
    return sheet;
  }

  // Finds the best-area-fit free rectangle + orientation for `item` on
  // `sheet`, places it, and guillotine-splits the used free rectangle.
  // Returns true if placed, false if it doesn't fit anywhere on this sheet.
  function tryPlace(sheet, item) {
    let best = null;

    sheet.freeRects.forEach((rect, rectIndex) => {
      [false, true].forEach((rotated) => {
        if (rotated && !allowRotation) return;
        const w = rotated ? item.h : item.w;
        const h = rotated ? item.w : item.h;
        const pw = w + kerf;
        const ph = h + kerf;
        if (pw > rect.w + 1e-9 || ph > rect.h + 1e-9) return;

        const leftoverArea = rect.w * rect.h - pw * ph;
        const shortSide = Math.min(rect.w - pw, rect.h - ph);
        if (!best || leftoverArea < best.leftoverArea - 1e-9 ||
            (Math.abs(leftoverArea - best.leftoverArea) <= 1e-9 && shortSide < best.shortSide)) {
          best = { rectIndex, rect, w, h, pw, ph, rotated, leftoverArea, shortSide };
        }
      });
    });

    if (!best) return false;

    const { rectIndex, rect, w, h, pw, ph, rotated } = best;
    sheet.placements.push({ id: item.id, label: item.label, x: rect.x, y: rect.y, w, h, rotated });
    sheet.freeRects.splice(rectIndex, 1);

    const rightW = rect.w - pw;
    const bottomH = rect.h - ph;

    // Guillotine split: the used rectangle becomes two new free rectangles.
    // Two ways to slice it (full-height right strip + partial-width bottom
    // strip, or full-width bottom strip + partial-height right strip) --
    // keep whichever leaves the larger single contiguous free rectangle,
    // since that's more useful for placing the next (possibly large) piece.
    const optionA = [
      { x: rect.x + pw, y: rect.y, w: rightW, h: rect.h },
      { x: rect.x, y: rect.y + ph, w: pw, h: bottomH },
    ];
    const optionB = [
      { x: rect.x, y: rect.y + ph, w: rect.w, h: bottomH },
      { x: rect.x + pw, y: rect.y, w: rightW, h: ph },
    ];
    const maxArea = (opt) => Math.max(...opt.map((r) => Math.max(r.w, 0) * Math.max(r.h, 0)));
    const chosen = maxArea(optionA) >= maxArea(optionB) ? optionA : optionB;

    chosen.forEach((r) => {
      if (r.w > 1e-6 && r.h > 1e-6) sheet.freeRects.push(r);
    });

    // Drop any free rectangle now fully contained in another -- it can
    // never be the best choice over the one containing it, just extra
    // bookkeeping.
    sheet.freeRects = sheet.freeRects.filter(
      (r, i) => !sheet.freeRects.some((other, j) => i !== j && contains(other, r))
    );

    return true;
  }

  queue.forEach((item) => {
    const placed = sheets.some((sheet) => tryPlace(sheet, item));
    if (!placed) tryPlace(newSheet(), item);
  });

  const sheetResults = sheets.map((sheet, index) => {
    const totalArea = sheetW * sheetH;
    const usedArea = sheet.placements.reduce((sum, p) => sum + p.w * p.h, 0);
    return {
      index,
      placements: sheet.placements,
      totalArea,
      usedArea,
      wasteArea: totalArea - usedArea,
      wastePercent: totalArea > 0 ? ((totalArea - usedArea) / totalArea) * 100 : 0,
    };
  });

  return { sheets: sheetResults, errors };
}

// pieces: geometry.js's computePieces() output (individual piece
// instances, not the cut-list's qty-collapsed rows -- nesting needs a
// physical slot for every physical piece).
function computeSheetLayout(pieces, options) {
  const { sheetW, sheetH, kerf, allowRotation } = options;
  const errors = [];

  if (!(sheetW > 0) || !(sheetH > 0)) {
    return { groups: [], errors: ['Sheet width and height must both be positive.'] };
  }
  if (!(kerf >= 0)) {
    return { groups: [], errors: ['Kerf/gap must be zero or positive.'] };
  }

  // Diagram labels use the short, cut-list-style type name plus an
  // instance number ("Shelf #1", "Shelf #2", ...) rather than geometry.js's
  // fuller per-instance label ("Shelf — Row 2, Column 1") -- pieces within
  // a type are interchangeable (identical size and joinery, same as the
  // cut list's own grouping), and the long form doesn't fit in a piece's
  // drawn rectangle nearly as often.
  const typeCounts = {};
  const byThickness = new Map();
  pieces.forEach((piece) => {
    const { length, width, thickness } = Cubbies.geometry.pieceFootprint(piece);
    const key = Math.round(thickness * 100000) / 100000;
    if (!byThickness.has(key)) byThickness.set(key, []);
    typeCounts[piece.type] = (typeCounts[piece.type] || 0) + 1;
    const shortName = Cubbies.geometry.PIECE_LABELS[piece.type] || piece.type;
    const label = `${shortName} #${typeCounts[piece.type]}`;
    byThickness.get(key).push({ id: piece.id, label, w: length, h: width });
  });

  const groups = Array.from(byThickness.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([thickness, items]) => {
      const { sheets, errors: groupErrors } = packGroup(items, sheetW, sheetH, kerf, !!allowRotation);
      errors.push(...groupErrors);
      return { thickness, pieceCount: items.length, sheets };
    });

  return { groups, errors };
}

window.Cubbies = window.Cubbies || {};
window.Cubbies.nesting = { computeSheetLayout };

})();
