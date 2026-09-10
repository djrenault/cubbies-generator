(function () {
  'use strict';

const { parseFraction, formatFraction } = Cubbies.units;

// field id -> how it feeds back into state
const NUMERIC_FIELDS = {
  t: {},
  tb: {},
  iw: { axis: 'width' },
  ih: { axis: 'height' },
  id: { axis: 'depth' },
  ow: { axis: 'width', overall: true },
  oh: { axis: 'height', overall: true },
  od: { axis: 'depth', overall: true },
  dd: { manual: 'ddManual' },
  rd: { manual: 'rdManual' },
  bw: {},
};

const CUTLIST_VISIBLE_KEY = 'cubbies-generator:cutlistVisible';

function getCutlistVisible() {
  try {
    const v = localStorage.getItem(CUTLIST_VISIBLE_KEY);
    return v === null ? true : v === '1';
  } catch (e) {
    return true;
  }
}

function setCutlistVisible(visible) {
  try {
    localStorage.setItem(CUTLIST_VISIBLE_KEY, visible ? '1' : '0');
  } catch (e) {
    /* ignore */
  }
}

function applyCutlistVisible(visible) {
  document.getElementById('cutlist').hidden = !visible;
  document.getElementById('cutlistToggle').textContent = visible ? 'Hide' : 'Show';
}

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

let settingsStatusTimer = null;
function showSettingsStatus(message, isError) {
  const el = document.getElementById('settingsStatus');
  el.textContent = message;
  el.classList.toggle('error-text', !!isError);
  clearTimeout(settingsStatusTimer);
  settingsStatusTimer = setTimeout(() => {
    el.textContent = '';
  }, 4000);
}

// A single click into one of these fields positions the cursor but doesn't
// select the existing text, so typing a replacement value *inserts* into
// it instead (e.g. clicking "26 1/4"" and typing "30" produces
// "3026 1/4""), which fails to parse -- the edit silently does nothing,
// and the field appears to "revert" whenever anything else next triggers a
// re-sync. Selecting-all on focus makes the common case (click, type a new
// value) replace rather than insert. Deferred a frame because a
// mouse-driven focus's default cursor-placement would otherwise collapse
// a selection made synchronously in the focus handler itself.
function selectAllOnFocus(el) {
  el.addEventListener('focus', () => {
    requestAnimationFrame(() => el.select());
  });
}

// Pressing Enter fires 'change' (committing the value) but doesn't blur a
// plain text input, so the field would be left showing the raw typed text
// instead of the nicely-formatted fraction until something else happens to
// blur it later. Blurring on Enter makes it reformat immediately, matching
// the common expectation that Enter "confirms" an entry.
function blurOnEnter(el) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.blur();
  });
}

function bindUI(state, update) {
  const rowsEl = document.getElementById('rows');
  const colsEl = document.getElementById('columns');
  selectAllOnFocus(rowsEl);
  selectAllOnFocus(colsEl);
  blurOnEnter(rowsEl);
  blurOnEnter(colsEl);

  // Live-validate on every keystroke (while still focused, so syncInputs
  // won't touch it) so an invalid in-progress edit turns red immediately,
  // rather than only discovering it was invalid after blur reverts it.
  rowsEl.addEventListener('input', (e) => {
    const v = Math.round(parseFraction(e.target.value));
    rowsEl.classList.toggle('field-error', !(Number.isFinite(v) && v >= 1));
  });
  rowsEl.addEventListener('change', (e) => {
    const v = Math.round(parseFraction(e.target.value));
    if (Number.isFinite(v) && v >= 1) state.rows = v;
    update();
  });
  colsEl.addEventListener('input', (e) => {
    const v = Math.round(parseFraction(e.target.value));
    colsEl.classList.toggle('field-error', !(Number.isFinite(v) && v >= 1));
  });
  colsEl.addEventListener('change', (e) => {
    const v = Math.round(parseFraction(e.target.value));
    if (Number.isFinite(v) && v >= 1) state.columns = v;
    update();
  });

  Object.keys(NUMERIC_FIELDS).forEach((field) => {
    const el = document.getElementById(field);
    if (!el) return;
    selectAllOnFocus(el);
    blurOnEnter(el);
    el.addEventListener('input', (e) => {
      el.classList.toggle('field-error', !Number.isFinite(parseFraction(e.target.value)));
    });
    el.addEventListener('change', (e) => {
      const val = parseFraction(e.target.value);
      const cfg = NUMERIC_FIELDS[field];
      if (Number.isFinite(val)) {
        state[field] = val;
        if (cfg.axis) state.source[cfg.axis] = cfg.overall ? 'overall' : 'inner';
        if (cfg.manual) state[cfg.manual] = true;
      }
      update();
    });
  });

  document.getElementById('backboardMount').addEventListener('change', (e) => {
    state.backboardMount = e.target.value;
    update();
  });

  document.getElementById('precision').addEventListener('change', (e) => {
    state.precision = parseInt(e.target.value, 10);
    update();
  });

  document.querySelectorAll('input[name="colorMode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.colorMode = e.target.value;
        update();
      }
    });
  });

  document.getElementById('printBtn').addEventListener('click', () => window.print());

  document.getElementById('exportBtn').addEventListener('click', () => {
    const data = Cubbies.state.serializeState(state);
    downloadJSON(`cubbies-${state.rows}x${state.columns}.json`, data);
    showSettingsStatus('Settings exported.');
  });

  const importFile = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-importing the same file later
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      Cubbies.state.applySerializedState(state, data);
      update();
      showSettingsStatus('Settings imported.');
    } catch (err) {
      showSettingsStatus('Could not read that file — is it valid JSON exported from this tool?', true);
    }
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    if (!confirm('Reset all settings to defaults? This clears your current design.')) return;
    Cubbies.state.resetState(state);
    Cubbies.state.clearStorage();
    update();
    showSettingsStatus('Settings reset to defaults.');
  });

  document.getElementById('cutlistToggle').addEventListener('click', () => {
    const visible = document.getElementById('cutlist').hidden;
    setCutlistVisible(visible);
    applyCutlistVisible(visible);
  });
  applyCutlistVisible(getCutlistVisible());

  syncInputs(state);
}

function syncInputs(state) {
  const rowsEl = document.getElementById('rows');
  const colsEl = document.getElementById('columns');
  if (document.activeElement !== rowsEl) {
    rowsEl.value = state.rows;
    rowsEl.classList.remove('field-error');
  }
  if (document.activeElement !== colsEl) {
    colsEl.value = state.columns;
    colsEl.classList.remove('field-error');
  }

  Object.keys(NUMERIC_FIELDS).forEach((field) => {
    const el = document.getElementById(field);
    if (!el || document.activeElement === el) return;
    el.value = formatFraction(state[field], state.precision);
    el.classList.remove('field-error');
  });

  document.getElementById('backboardMount').value = state.backboardMount;
  document.getElementById('precision').value = String(state.precision);

  const bwField = document.getElementById('bwField');
  const bwInput = document.getElementById('bw');
  const insetOnly = state.backboardMount !== 'inset';
  bwField.classList.toggle('disabled-field', insetOnly);
  bwInput.disabled = insetOnly;

  document.querySelectorAll('input[name="colorMode"]').forEach((radio) => {
    radio.checked = radio.value === state.colorMode;
  });
}

function renderMessages(state) {
  const el = document.getElementById('messages');
  el.innerHTML = '';
  state.errors.forEach((msg) => {
    const div = document.createElement('div');
    div.className = 'msg error';
    div.textContent = msg;
    el.appendChild(div);
  });
  state.warnings.forEach((msg) => {
    const div = document.createElement('div');
    div.className = 'msg warning';
    div.textContent = msg;
    el.appendChild(div);
  });
}

window.Cubbies = window.Cubbies || {};
window.Cubbies.ui = { bindUI, syncInputs, renderMessages };

})();
