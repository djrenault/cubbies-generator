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

function bindUI(state, update) {
  document.getElementById('rows').addEventListener('change', (e) => {
    const v = Math.round(parseFraction(e.target.value));
    state.rows = Number.isFinite(v) && v >= 1 ? v : state.rows;
    update();
  });
  document.getElementById('columns').addEventListener('change', (e) => {
    const v = Math.round(parseFraction(e.target.value));
    state.columns = Number.isFinite(v) && v >= 1 ? v : state.columns;
    update();
  });

  Object.keys(NUMERIC_FIELDS).forEach((field) => {
    const el = document.getElementById(field);
    if (!el) return;
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
  if (document.activeElement !== rowsEl) rowsEl.value = state.rows;
  if (document.activeElement !== colsEl) colsEl.value = state.columns;

  Object.keys(NUMERIC_FIELDS).forEach((field) => {
    const el = document.getElementById(field);
    if (!el || document.activeElement === el) return;
    el.value = formatFraction(state[field], state.precision);
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
