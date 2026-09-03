import * as THREE from 'three';

// Real-world hexayurt roof dimensions derived from 2400mm panels (see conversation notes).
export const ROOF_RADIUS = 2.4;
export const ROOF_APEX_HEIGHT = 1.2;

// Builds a hexagonal-pyramid roof (6 flat triangular panels) as a non-indexed
// BufferGeometry so each panel keeps its own flat face normal for caustics lighting.
// Winding is chosen so normals face up, matching the original floor-lit-from-above convention.
export function createRoofGeometry(radius = ROOF_RADIUS, apexHeight = ROOF_APEX_HEIGHT) {
  const apex = new THREE.Vector3(0, 0, apexHeight);
  const baseVertices = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    baseVertices.push(new THREE.Vector3(radius * Math.cos(angle), radius * Math.sin(angle), 0));
  }

  const positions = [];
  for (let i = 0; i < 6; i++) {
    const a = baseVertices[i];
    const b = baseVertices[(i + 1) % 6];
    positions.push(
      a.x, a.y, a.z,
      b.x, b.y, b.z,
      apex.x, apex.y, apex.z,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

