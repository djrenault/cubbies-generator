// Parameter store + bidirectional overall/inner dimension linking.
// See CLAUDE.md "Bidirectional Dimension Linking" and "Joinery Model" for
// the governing equations this module implements.

export function createDefaultState() {
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

    // which field drives each axis: editing the other flips this
    source: { width: 'inner', height: 'inner', depth: 'inner' },

    errors: [],
    warnings: [],
  };

  recompute(state);
  return state;
}

export function recompute(state) {
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
  }

  state.errors = errors;
  state.warnings = warnings;
}
