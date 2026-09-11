(function () {
  'use strict';

const { loadOrCreateState, recompute, saveToStorage } = Cubbies.state;
const { computePieces } = Cubbies.geometry;
const { createViewer } = Cubbies.viewer3d;
const { renderCutList } = Cubbies.cutlist;
const { renderPieceDiagrams } = Cubbies.piecediagrams;
const { computeSheetLayout } = Cubbies.nesting;
const { renderSheetLayout } = Cubbies.sheetlayout;
const { bindUI, syncInputs, renderMessages } = Cubbies.ui;

const state = loadOrCreateState();
const viewer = createViewer(document.getElementById('viewer'));

// Sheet layout is generated on demand (a button), not live on every input
// change like the rest of the app -- nesting is real work, and there's no
// point re-running it while the user is still deciding on a rough design.
// Kept as the last successfully computed piece list so the button can use
// it without recomputing geometry itself.
let lastPieces = [];

function update() {
  recompute(state);
  syncInputs(state);
  renderMessages(state);
  saveToStorage(state);

  const { pieces, errors } = computePieces(state);
  lastPieces = errors.length === 0 ? pieces : [];
  if (errors.length === 0) {
    viewer.render(pieces, state.colorMode);
    renderCutList(document.getElementById('cutlist'), pieces, state.precision);
    renderPieceDiagrams(document.getElementById('piecediagrams'), pieces, state.precision);
  } else {
    renderCutList(document.getElementById('cutlist'), [], state.precision);
    renderPieceDiagrams(document.getElementById('piecediagrams'), [], state.precision);
  }
}

function generateSheetLayout() {
  const container = document.getElementById('sheetlayout');
  if (lastPieces.length === 0) {
    container.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Fix the errors above before generating a sheet layout.';
    container.appendChild(p);
    return;
  }
  const result = computeSheetLayout(lastPieces, {
    sheetW: state.sheetW,
    sheetH: state.sheetH,
    kerf: state.kerf,
    allowRotation: state.allowRotation,
  });
  renderSheetLayout(container, result, {
    precision: state.precision,
    sheetW: state.sheetW,
    sheetH: state.sheetH,
  });
}

bindUI(state, update, generateSheetLayout);
update();

})();
