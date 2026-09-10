(function () {
  'use strict';

const { formatFraction } = Cubbies.units;

const GROUP_ORDER = ['top-bottom', 'end', 'divider', 'shelf', 'backboard'];

const GROUP_LABEL = {
  'top-bottom': 'Top / Bottom Panel',
  end: 'End Panel',
  divider: 'Internal Divider',
  shelf: 'Shelf',
  backboard: 'Backboard',
};

// Maps a piece's raw {x,y,z} size onto woodworker-facing Length / Width /
// Thickness columns, per piece type.
function dimsFor(piece) {
  switch (piece.type) {
    case 'top-bottom':
    case 'shelf':
      return { length: piece.size.x, width: piece.size.z, thickness: piece.size.y };
    case 'end':
    case 'divider':
      return { length: piece.size.y, width: piece.size.z, thickness: piece.size.x };
    case 'backboard':
      return { length: piece.size.x, width: piece.size.y, thickness: piece.size.z };
    default:
      return { length: piece.size.x, width: piece.size.y, thickness: piece.size.z };
  }
}

function round4(v) {
  return Math.round((v || 0) * 10000) / 10000;
}

// Identical pieces (same type, same nominal size, same joinery) collapse
// into one cut-list row with a qty count.
function signature(piece) {
  const d = dimsFor(piece);
  const feats = (piece.features || [])
    .map((f) => `${f.kind}:${round4(f.width)}:${round4(f.depth)}`)
    .sort()
    .join('|');
  return `${piece.type}|${round4(d.length)}|${round4(d.width)}|${round4(d.thickness)}|${feats}`;
}

function describeFeature(f, precision) {
  let text = f.label || f.kind;
  const dims = [];
  if (f.width != null) dims.push(`${formatFraction(f.width, precision)} W`);
  if (f.depth != null) dims.push(`${formatFraction(f.depth, precision)} D`);
  if (dims.length) text += ` (${dims.join(' × ')})`;
  if (f.at != null) text += ` at ${formatFraction(f.at, precision)}${f.from ? ' from ' + f.from : ''}`;
  return text;
}

function renderCutList(container, pieces, precision) {
  const groups = new Map();
  pieces.forEach((p) => {
    const sig = signature(p);
    if (!groups.has(sig)) groups.set(sig, { ...p, qty: 0 });
    groups.get(sig).qty += 1;
  });

  const rows = Array.from(groups.values()).sort(
    (a, b) => GROUP_ORDER.indexOf(a.type) - GROUP_ORDER.indexOf(b.type)
  );

  container.innerHTML = '';

  if (rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Fix the errors above to generate a cut list.';
    container.appendChild(p);
    return;
  }

  const table = document.createElement('table');
  table.className = 'cutlist-table';

  const thead = document.createElement('thead');
  thead.innerHTML =
    '<tr><th>Piece</th><th>Qty</th><th>Length</th><th>Width</th><th>Thickness</th><th>Joinery / Notes</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((g) => {
    const d = dimsFor(g);
    const notes = (g.features || []).map((f) => describeFeature(f, precision)).join('; ') || '—';

    const tr = document.createElement('tr');

    const cells = [
      GROUP_LABEL[g.type] || g.type,
      String(g.qty),
      formatFraction(d.length, precision),
      formatFraction(d.width, precision),
      formatFraction(d.thickness, precision),
      notes,
    ];
    cells.forEach((text) => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  container.appendChild(table);
}

window.Cubbies = window.Cubbies || {};
window.Cubbies.cutlist = { renderCutList };

})();
