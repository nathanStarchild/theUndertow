import * as THREE from 'three';
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { resolveProjectors } from './projection.js';

const STORAGE_KEY = 'hexayurt-projection-calibration';
const MOUNT_OPTIONS = Array.from({ length: 6 }, (_, i) => i).flatMap((i) => [`corner-${i}`, `wall-${i}`]);

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function persist(config) {
  const saved = {};
  for (const projector of config.projectors) {
    saved[projector.id] = { mount: projector.mount, adjust: projector.adjust };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

// Merges any previously-saved mount/adjust values into a freshly loaded config, in place, before
// the first resolveProjectors() call so a saved calibration applies from the start.
export function applySavedCalibration(config) {
  const saved = loadSaved();
  for (const projector of config.projectors) {
    const entry = saved[projector.id];
    if (!entry) continue;
    if (entry.mount) projector.mount = entry.mount;
    if (entry.adjust) Object.assign(projector.adjust, entry.adjust);
  }
  return config;
}

// Edges where adjacent panel normals differ (the 6 creases) plus boundary edges (the 6 eaves).
export function createRoofWireframe(roofGeometry) {
  const edges = new THREE.EdgesGeometry(roofGeometry, 1);
  return new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff }));
}

function downloadConfig(config) {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'projection.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importConfig(config, done) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imported = JSON.parse(reader.result);
      for (const projector of config.projectors) {
        const match = imported.projectors?.find((p) => p.id === projector.id);
        if (!match) continue;
        if (match.mount) projector.mount = match.mount;
        Object.assign(projector.adjust, match.adjust ?? {});
      }
      done();
    };
    reader.readAsText(file);
  };
  input.click();
}

// Mutates adjust back to identity in place (never replaces the offset/rotation/lensShift objects
// themselves, since lil-gui controllers hold direct references into them).
function resetAdjust(adjust) {
  adjust.offset.x = 0;
  adjust.offset.y = 0;
  adjust.offset.z = 0;
  adjust.rotation.yaw = 0;
  adjust.rotation.pitch = 0;
  adjust.rotation.roll = 0;
  adjust.lensShift.x = 0;
  adjust.lensShift.y = 0;
  adjust.fovScale = 1;
}

// Shared slider set for one projector, used by both the full multi-projector panel and the
// single-projector show-mode overlay so they can't drift out of sync.
function addProjectorControls(container, projector, rebuild, refreshControllers) {
  container.add(projector, 'mount', MOUNT_OPTIONS).name('mount preset').onChange(rebuild);

  const adjust = projector.adjust;
  const offset = container.addFolder('offset (m)');
  offset.add(adjust.offset, 'x', -0.5, 0.5, 0.005).onChange(rebuild);
  offset.add(adjust.offset, 'y', -0.5, 0.5, 0.005).onChange(rebuild);
  offset.add(adjust.offset, 'z', -0.5, 0.5, 0.005).onChange(rebuild);

  const rotation = container.addFolder('rotation (deg)');
  rotation.add(adjust.rotation, 'yaw', -45, 45, 0.1).onChange(rebuild);
  rotation.add(adjust.rotation, 'pitch', -45, 45, 0.1).onChange(rebuild);
  rotation.add(adjust.rotation, 'roll', -45, 45, 0.1).onChange(rebuild);

  const lensShift = container.addFolder('lens shift');
  lensShift.add(adjust.lensShift, 'x', -0.5, 0.5, 0.005).onChange(rebuild);
  lensShift.add(adjust.lensShift, 'y', -0.5, 0.5, 0.005).onChange(rebuild);

  container.add(adjust, 'fovScale', 0.8, 1.2, 0.005).onChange(rebuild);

  container.add({ fn: () => {
    resetAdjust(adjust);
    refreshControllers();
    rebuild();
  } }, 'fn').name('reset to defaults');
}

// Builds the lil-gui calibration panel for every projector at once (dev mode / monitor window).
// `onProjectorsChange` is called with a freshly resolved projector array whenever a mount preset
// or adjustment changes. Returns live state the render loop reads each frame: `active` (which
// projector's camera drives the single-camera calibration view) and `enabled` (per-id solo/mute
// for the multi-viewport output).
export function createCalibrationUI(config, wireframe, onProjectorsChange) {
  const gui = new GUI({ title: 'Projector Calibration', width: 320 });
  const state = {
    active: config.projectors[0].id,
    enabled: Object.fromEntries(config.projectors.map((p) => [p.id, true])),
  };

  function rebuild() {
    persist(config);
    onProjectorsChange(resolveProjectors(config));
  }

  function refreshControllers() {
    for (const controller of gui.controllersRecursive()) controller.updateDisplay();
  }

  gui.add(state, 'active', config.projectors.map((p) => p.id)).name('calibration view (key 7)');
  gui.add(wireframe, 'visible').name('roof wireframe');

  for (const projector of config.projectors) {
    const folder = gui.addFolder(projector.id);
    folder.add(state.enabled, projector.id).name('enabled (multi-view)');
    addProjectorControls(folder, projector, rebuild, refreshControllers);
    folder.close();
  }

  const io = gui.addFolder('calibration file');
  io.add({ fn: () => downloadConfig(config) }, 'fn').name('export JSON');
  io.add({ fn: () => importConfig(config, () => { refreshControllers(); rebuild(); }) }, 'fn').name('import JSON');

  return { gui, state };
}

// Builds a single-projector calibration overlay, hidden by default - this is what a show-mode
// window shows while a projector is being aligned, with no other projectors listed since only
// the one feeding this physical output/viewport region is relevant here. `anchor` is the page
// pixel point to center the panel on (the middle of that projector's viewport region in the
// spanning show window); defaults to the window's own center for a single-region window.
export function createShowCalibrationPanel(config, projectorId, wireframe, onProjectorsChange, anchor = { left: '50%', top: '50%' }) {
  const projector = config.projectors.find((p) => p.id === projectorId);
  if (!projector) {
    throw new Error(`createShowCalibrationPanel: unknown projector id "${projectorId}"`);
  }

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = typeof anchor.left === 'number' ? `${anchor.left}px` : anchor.left;
  container.style.top = typeof anchor.top === 'number' ? `${anchor.top}px` : anchor.top;
  container.style.transform = 'translate(-50%, -50%)';
  container.style.zIndex = '9999';
  container.style.display = 'none';
  document.body.appendChild(container);

  const gui = new GUI({ title: `Calibrate ${projector.id}`, container });

  function rebuild() {
    persist(config);
    onProjectorsChange(resolveProjectors(config));
  }

  function refreshControllers() {
    for (const controller of gui.controllersRecursive()) controller.updateDisplay();
  }

  gui.add(wireframe, 'visible').name('roof wireframe');
  addProjectorControls(gui, projector, rebuild, refreshControllers);

  return {
    toggle() {
      container.style.display = container.style.display === 'none' ? 'block' : 'none';
    },
  };
}
