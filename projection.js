import * as THREE from 'three';
import { ROOF_RADIUS, ROOF_APEX_HEIGHT } from './roof.js';

// Config is authored in metres in the real-world (apex-up) frame, with the eave plane at z = 0.
// Everything here converts into sim units so the poses drop straight into the existing scene.

// The sim models the roof mirrored (apex down). A 180-degree rotation about x maps the real
// apex-up roof exactly onto it, because the hexagon's corner set is symmetric about y. Unlike a
// z-mirror this is orientation-preserving, so the rendered image needs no flip and the sim
// geometry/shaders are reused untouched.
const SIM_FRAME = new THREE.Matrix4().makeRotationX(Math.PI);

export async function loadProjectionConfig(url = '/config/projection.json') {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load projection config from ${url}: ${response.status}`);
  }
  return response.json();
}

// 'corner-N' is hexagon vertex N (angle 60*N, matching roof.js); 'wall-N' is the midpoint of the
// eave edge leaving that vertex, which sits half a sector round and one apothem out.
function mountPlacement(mount) {
  const match = /^(corner|wall)-([0-5])$/.exec(mount);
  if (!match) {
    throw new Error(`Unknown projector mount "${mount}" (expected corner-0..5 or wall-0..5)`);
  }
  const isWall = match[1] === 'wall';
  return {
    angle: (Math.PI / 3) * (Number(match[2]) + (isWall ? 0.5 : 0)),
    radiusScale: isWall ? Math.cos(Math.PI / 6) : 1,
  };
}

// Three.js wants a vertical FOV; projector datasheets quote a horizontal throw ratio.
function verticalFovFromThrowRatio(throwRatio, aspect) {
  return THREE.MathUtils.radToDeg(2 * Math.atan(1 / (2 * throwRatio * aspect)));
}

// Off-axis lens shift, expressed as a fraction of image width/height, applied as the clip-space
// skew terms of the projection matrix. A symmetric PerspectiveCamera can't represent this.
function applyLensShift(camera, lensShift) {
  if (!lensShift || (!lensShift.x && !lensShift.y)) return;
  camera.projectionMatrix.elements[8] += 2 * lensShift.x;
  camera.projectionMatrix.elements[9] += 2 * lensShift.y;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

export function resolveProjectors(config) {
  const { venue, defaults, projectors } = config;
  const metersPerUnit = venue.roofRadius / ROOF_RADIUS;
  const toUnits = (meters) => meters / metersPerUnit;

  return projectors.map((projector) => {
    const throwRatio = projector.throwRatio ?? defaults.throwRatio;
    const resolution = projector.resolution ?? defaults.resolution;
    const mountRadius = projector.mountRadius ?? defaults.mountRadius;
    const mountHeight = projector.mountHeight ?? defaults.mountHeight;
    const adjust = projector.adjust ?? {};
    const offset = adjust.offset ?? { x: 0, y: 0, z: 0 };
    const rotation = adjust.rotation ?? { yaw: 0, pitch: 0, roll: 0 };

    const { angle, radiusScale } = mountPlacement(projector.mount);
    const radius = toUnits(mountRadius * radiusScale);

    const position = new THREE.Vector3(
      radius * Math.cos(angle) + toUnits(offset.x),
      radius * Math.sin(angle) + toUnits(offset.y),
      toUnits(mountHeight - venue.wallHeight + offset.z),
    ).applyMatrix4(SIM_FRAME);

    // Default aim is halfway up the far side: the midpoint between the apex and the opposite eave.
    const target = new THREE.Vector3(
      ROOF_RADIUS * Math.cos(angle + Math.PI) * 0.5,
      ROOF_RADIUS * Math.sin(angle + Math.PI) * 0.5,
      ROOF_APEX_HEIGHT * 0.5,
    ).applyMatrix4(SIM_FRAME);

    const aspect = resolution[0] / resolution[1];
    const fov = verticalFovFromThrowRatio(throwRatio, aspect) * (adjust.fovScale ?? 1);
    const camera = new THREE.PerspectiveCamera(fov, aspect, 0.01, 100);
    camera.up.set(0, 0, 1).applyMatrix4(SIM_FRAME);
    camera.position.copy(position);
    camera.lookAt(target);
    camera.rotateZ(THREE.MathUtils.degToRad(rotation.yaw));
    camera.rotateX(THREE.MathUtils.degToRad(rotation.pitch));
    camera.rotateY(THREE.MathUtils.degToRad(rotation.roll));
    camera.updateProjectionMatrix();
    applyLensShift(camera, adjust.lensShift);

    return { id: projector.id, mount: projector.mount, throwRatio, resolution, target, camera };
  });
}

// Horizontal/vertical coverage in degrees, for sanity-checking a mount against the roof.
export function projectorFovDegrees({ throwRatio, resolution }) {
  const aspect = resolution[0] / resolution[1];
  return {
    horizontal: THREE.MathUtils.radToDeg(2 * Math.atan(1 / (2 * throwRatio))),
    vertical: verticalFovFromThrowRatio(throwRatio, aspect),
  };
}
