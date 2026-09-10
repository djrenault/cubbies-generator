(function () {
  'use strict';

const { createDefaultState, recompute } = Cubbies.state;
const { computePieces } = Cubbies.geometry;
const { createViewer } = Cubbies.viewer3d;
const { renderCutList } = Cubbies.cutlist;
const { bindUI, syncInputs, renderMessages } = Cubbies.ui;

const state = createDefaultState();
const viewer = createViewer(document.getElementById('viewer'));

function update() {
  recompute(state);
  syncInputs(state);
  renderMessages(state);

  const { pieces, errors } = computePieces(state);
  if (errors.length === 0) {
    viewer.render(pieces, state.colorMode);
    renderCutList(document.getElementById('cutlist'), pieces, state.precision);
  } else {
    renderCutList(document.getElementById('cutlist'), [], state.precision);
  }
}

bindUI(state, update);
update();

})();
