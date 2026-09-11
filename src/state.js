// Parameter store + bidirectional overall/inner dimension linking.
// See CLAUDE.md "Bidirectional Dimension Linking" and "Joinery Model" for
// the governing equations this module implements.

(function () {
  'use strict';

function createDefaultState() {
  const state = {
    rows: 3,
    columns: 2,

    t: 0.75, // case plywood thickness (verticals, shelves, top, bottom)
    tb: 0.25, // backboard thickness

    iw: 12, // inner width per cubby
    ih: 10, // inner height per cubby
    id: 11, // inner depth per cubby

    ow: 0, // overall width  (derived <-> editable)
    oh: 0, // overall height (derived <-> editable)
    od: 0, // overall depth  (derived <-> editable)

    dd: 0, // dado depth, auto = t/4 unless ddManual
    rd: 0, // corner rabbet depth, auto = t/2 unless rdManual
    ddManual: false,
    rdManual: false,

    bw: 0.375, // backboard rabbet width (inset mount only)
    backboardMount: 'outset', // 'outset' | 'inset'

    precision: 16, // display precision denominator (1/16" default)
    colorMode: 'realistic', // 'realistic' | 'identify'

    sheetW: 48, // sheet-goods width for nesting, default a "4x8" sheet
    sheetH: 96, // sheet-goods height for nesting
    kerf: 0.1875, // saw kerf + safety gap between nested pieces, default 3/16"
    allowRotation: true, // let nesting rotate pieces 90 deg for better yield

    // which field drives each axis: editing the other flips this
    source: { width: 'inner', height: 'inner', depth: 'inner' },

    errors: [],
    warnings: [],
  };

  recompute(state);
  return state;
}

// Resets an existing state object's fields to fresh defaults, in place --
// callers (ui.js, main.js) hold a reference to the one state object for
// the app's lifetime, so this mutates rather than replacing it.
function resetState(state) {
  const fresh = createDefaultState();
  Object.keys(fresh).forEach((key) => {
    state[key] = fresh[key];
  });
}

const STORAGE_KEY = 'cubbies-generator:settings:v1';

const NUMERIC_FIELDS = [
  'rows', 'columns', 't', 'tb', 'iw', 'ih', 'id', 'ow', 'oh', 'od', 'dd', 'rd', 'bw', 'precision',
  'sheetW', 'sheetH', 'kerf',
];
const BOOLEAN_FIELDS = ['ddManual', 'rdManual', 'allowRotation'];
const ENUM_FIELDS = { backboardMount: ['inset', 'outset'], colorMode: ['realistic', 'identify'] };
const AXES = ['width', 'height', 'depth'];

// Only the design parameters a user would want to save/share -- not the
// derived errors/warnings, which validate() recomputes from these anyway.
function serializeState(state) {
  const out = { __version: 1 };
  NUMERIC_FIELDS.forEach((key) => { out[key] = state[key]; });
  BOOLEAN_FIELDS.forEach((key) => { out[key] = state[key]; });
  Object.keys(ENUM_FIELDS).forEach((key) => { out[key] = state[key]; });
  out.source = { ...state.source };
  return out;
}

// Copies known, well-typed fields from a plain object (parsed JSON, quite
// possibly hand-edited or from an older/newer version of this tool) onto an
// existing state object. Unknown or malformed fields are silently skipped
// rather than thrown on, so a partial or slightly-off file still loads what
// it can instead of failing outright.
function applySerializedState(state, data) {
  if (!data || typeof data !== 'object') return;

  NUMERIC_FIELDS.forEach((key) => {
    if (Number.isFinite(data[key])) state[key] = data[key];
  });
  BOOLEAN_FIELDS.forEach((key) => {
    if (typeof data[key] === 'boolean') state[key] = data[key];
  });
  Object.keys(ENUM_FIELDS).forEach((key) => {
    if (ENUM_FIELDS[key].includes(data[key])) state[key] = data[key];
  });
  if (data.source && typeof data.source === 'object') {
    AXES.forEach((axis) => {
      const v = data.source[axis];
      if (v === 'inner' || v === 'overall') state.source[axis] = v;
    });
  }
}

// localStorage can throw (private browsing, disabled storage, quota) --
// none of these are worth surfacing to the user, saving/loading settings
// is a nicety, not core functionality, so fail silently.
function saveToStorage(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(state)));
  } catch (e) {
    /* ignore */
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    /* ignore */
  }
}

// Entry point for main.js: defaults, with whatever was saved last session
// layered on top, if anything.
function loadOrCreateState() {
  const state = createDefaultState();
  const stored = loadFromStorage();
  if (stored) {
    applySerializedState(state, stored);
    recompute(state);
  }
  return state;
}

function recompute(state) {
  if (!state.ddManual) state.dd = state.t / 4;
  if (!state.rdManual) state.rd = state.t / 2;

  if (state.source.width === 'overall') {
    state.iw = (state.ow - (state.columns + 1) * state.t) / state.columns;
  } else {
    state.ow = (state.columns + 1) * state.t + state.columns * state.iw;
  }

  if (state.source.height === 'overall') {
    state.ih = (state.oh - (state.rows + 1) * state.t) / state.rows;
  } else {
    state.oh = (state.rows + 1) * state.t + state.rows * state.ih;
  }

  if (state.source.depth === 'overall') {
    state.id = state.od - state.tb;
  } else {
    state.od = state.id + state.tb;
  }

  validate(state);
  return state;
}

function validate(state) {
  const errors = [];
  const warnings = [];

  if (!(state.rows >= 1) || !Number.isFinite(state.rows)) errors.push('Rows must be at least 1.');
  if (!(state.columns >= 1) || !Number.isFinite(state.columns)) errors.push('Columns must be at least 1.');
  if (!(state.t > 0)) errors.push('Plywood thickness must be positive.');
  if (!(state.tb > 0)) errors.push('Backboard thickness must be positive.');

  if (Number.isFinite(state.iw) && state.iw <= 0) {
    errors.push('Inner width is zero or negative — overall width is too small for this column count and thickness.');
  }
  if (Number.isFinite(state.ih) && state.ih <= 0) {
    errors.push('Inner height is zero or negative — overall height is too small for this row count and thickness.');
  }
  if (Number.isFinite(state.id) && state.id <= 0) {
    errors.push('Inner depth is zero or negative — overall depth is too small for the backboard thickness.');
  }

  if (errors.length === 0) {
    if (2 * state.dd >= state.t) {
      errors.push(
        'Dado depth is too large: cutting from both faces of an internal divider at that depth would cut through it. Reduce dado depth to less than half the plywood thickness.'
      );
    } else {
      const web = state.t - 2 * state.dd;
      const threshold = Math.max(0.1875, 0.2 * state.t);
      if (web < threshold) {
        warnings.push(
          `Only ${web.toFixed(3)}" of material remains between the two dados in an internal divider — consider reducing dado depth.`
        );
      }
    }

    if (state.rd >= state.t) {
      warnings.push('Rabbet depth is at least the full plywood thickness — this would cut through the panel.');
    }

    if (state.backboardMount === 'inset' && state.tb >= state.t) {
      errors.push(
        'Backboard thickness must be less than the case plywood thickness for an inset backboard — the back rabbet is cut to a depth of the backboard thickness, so at this size it would remove the top/bottom/end panels\' full thickness along the entire back edge, leaving no shoulder to hold the backboard. Reduce backboard thickness, increase case thickness, or switch to outset mount.'
      );
    }
  }

  state.errors = errors;
  state.warnings = warnings;
}

window.Cubbies = window.Cubbies || {};
window.Cubbies.state = {
  createDefaultState,
  recompute,
  resetState,
  loadOrCreateState,
  serializeState,
  applySerializedState,
  saveToStorage,
  loadFromStorage,
  clearStorage,
};

})();
