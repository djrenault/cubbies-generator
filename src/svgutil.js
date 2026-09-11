// Tiny shared SVG helpers used by both sheetlayout.js (sheet-packing
// diagrams) and piecediagrams.js (per-piece dado/rabbet diagrams) -- kept
// here instead of duplicated in each so the text-fitting behavior can't
// quietly drift between the two renderers.

(function () {
  'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_FONT_SIZE = 0.35;

function el(name, attrs, parent) {
  const e = document.createElementNS(SVG_NS, name);
  Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}

// Shrinks each label's font size to fit within the space set aside for it
// (data-avail-width, set by the caller alongside data-base-font-size),
// using the browser's own text metrics -- run after the SVGs are attached
// to the document, since getComputedTextLength() needs a connected element
// to measure accurately. See CLAUDE.md "Sheet-Goods Nesting" / "Text
// fitting is a verified concern" for why a clip-path alone isn't relied on
// as the primary defense against overflow -- this is what actually does
// the fitting; clipping (where the caller adds one) is the backstop.
function fitLabels(root) {
  root.querySelectorAll('text[data-avail-width]').forEach((text) => {
    const availWidth = parseFloat(text.getAttribute('data-avail-width'));
    const baseFontSize = parseFloat(text.getAttribute('data-base-font-size'));
    const tspans = Array.from(text.querySelectorAll('tspan'));
    const widest = tspans.length
      ? Math.max(0, ...tspans.map((ts) => ts.getComputedTextLength()))
      : text.getComputedTextLength();
    if (widest <= availWidth) return;

    const scale = Math.max(MIN_FONT_SIZE / baseFontSize, availWidth / widest);
    const newFontSize = baseFontSize * scale;
    text.setAttribute('font-size', newFontSize);
    tspans.forEach((ts, idx) => {
      ts.setAttribute('dy', idx === 0 ? -newFontSize * 0.6 : newFontSize * 1.2);
    });
  });
}

window.Cubbies = window.Cubbies || {};
window.Cubbies.svgutil = { SVG_NS, MIN_FONT_SIZE, el, fitLabels };

})();
