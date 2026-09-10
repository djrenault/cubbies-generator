import { createDefaultState, recompute } from './state.js';
import { computePieces } from './geometry.js';
import { createViewer } from './viewer3d.js';
import { renderCutList } from './cutlist.js';
import { bindUI, syncInputs, renderMessages } from './ui.js';

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
