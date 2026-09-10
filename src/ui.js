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
