import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

const GOLDEN_ANGLE = 137.508;

// Flattens a piece's features into a plain list of cut boxes (each
// feature's `cut` is either one box or an array of boxes — see
// geometry.js). Features with no `cut` (text-only notes) are skipped.
function collectCuts(piece) {
  const cuts = [];
  (piece.features || []).forEach((f) => {
    if (!f.cut) return;
    (Array.isArray(f.cut) ? f.cut : [f.cut]).forEach((c) => cuts.push(c));
  });
  return cuts;
}

// Builds the actual grooved mesh for a piece: a solid box with each dado
// and rabbet subtracted out via CSG. Pieces with no joinery cuts (shelves,
// backboard, or an end panel with nothing to dado) skip CSG entirely and
// just return a plain box — cheaper, and there's nothing to subtract.
function buildPieceMesh(piece, material, evaluator) {
  const size = piece.size;
  const baseGeometry = new THREE.BoxGeometry(
    Math.max(size.x, 0.001),
    Math.max(size.y, 0.001),
    Math.max(size.z, 0.001)
  );
  const base = new Brush(baseGeometry, material);
  base.position.set(piece.pos.x + size.x / 2, piece.pos.y + size.y / 2, piece.pos.z + size.z / 2);
  base.updateMatrixWorld();

  const cuts = collectCuts(piece);
  if (cuts.length === 0) return base;

  let result = base;
  cuts.forEach((cut) => {
    const cutGeometry = new THREE.BoxGeometry(
      Math.max(cut.size.x, 0.001),
      Math.max(cut.size.y, 0.001),
      Math.max(cut.size.z, 0.001)
    );
    const cutBrush = new Brush(cutGeometry, material);
    cutBrush.position.set(
      piece.pos.x + cut.pos.x + cut.size.x / 2,
      piece.pos.y + cut.pos.y + cut.size.y / 2,
      piece.pos.z + cut.pos.z + cut.size.z / 2
    );
    cutBrush.updateMatrixWorld();
    result = evaluator.evaluate(result, cutBrush, SUBTRACTION);
  });

  return result;
}

function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
    }
  });
}

function makeWoodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#d9b98a';
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 40; i++) {
    const y = Math.random() * 256;
    ctx.strokeStyle = `rgba(110, 74, 38, ${0.05 + Math.random() * 0.15})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) {
      ctx.lineTo(x, y + Math.sin(x / 20 + i) * 4);
    }
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}

export function createViewer(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe7e2d8);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.1,
    2000
  );
  // Placeholder until the first render() call frames it against the real
  // model — negative Z so we start out in front of the case (the open
  // side), not staring at the back/backboard.
  camera.position.set(40, 35, -55);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x555045, 1.2));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(60, 90, 40);
  scene.add(dirLight);

  const woodTexture = makeWoodTexture();
  const evaluator = new Evaluator();

  let group = new THREE.Group();
  scene.add(group);

  let grid = null;
  let hasFramed = false;

  function handleResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', handleResize);
  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(container);

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  function materialFor(piece, index, colorMode) {
    if (colorMode === 'identify') {
      const hue = (index * GOLDEN_ANGLE) % 360;
      return new THREE.MeshStandardMaterial({ color: new THREE.Color(`hsl(${hue}, 65%, 55%)`), roughness: 0.7 });
    }
    const tint = piece.type === 'backboard' ? 0xd6c39a : 0xffffff;
    return new THREE.MeshStandardMaterial({ map: woodTexture, color: tint, roughness: 0.85, metalness: 0 });
  }

  function render(pieces, colorMode) {
    scene.remove(group);
    disposeGroup(group);
    group = new THREE.Group();

    const bbox = new THREE.Box3();

    pieces.forEach((piece, index) => {
      const material = materialFor(piece, index, colorMode);
      const mesh = buildPieceMesh(piece, material, evaluator);
      mesh.userData.pieceId = piece.id;
      group.add(mesh);
      bbox.expandByObject(mesh);
    });

    scene.add(group);

    if (!bbox.isEmpty()) {
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      bbox.getCenter(center);
      bbox.getSize(size);

      controls.target.copy(center);

      if (!hasFramed) {
        // Frame a 3/4 view from the front (negative Z), where the cubby
        // openings are, rather than the default staring at the back.
        const maxDim = Math.max(size.x, size.y, size.z);
        camera.position.set(center.x + maxDim * 0.9, center.y + maxDim * 0.65, center.z - maxDim * 1.4);
        hasFramed = true;
      }

      if (grid) scene.remove(grid);
      const gridSize = Math.max(size.x, size.z) * 2;
      grid = new THREE.GridHelper(gridSize, 20, 0xb8ad98, 0xcfc6b4);
      grid.position.set(center.x, bbox.min.y - 0.01, center.z);
      scene.add(grid);
    }

    controls.update();
  }

  return {
    render,
    dispose() {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      renderer.dispose();
    },
  };
}
