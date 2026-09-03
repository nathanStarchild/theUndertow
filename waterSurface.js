import * as THREE from 'three';

// Builds a filled, subdivided hexagonal disk for the visible water surface.
// Each of the 6 triangular sectors (center -> two adjacent corners) is subdivided into a
// barycentric grid so the heightfield ripples still have enough resolution to read, and UV is
// mapped from the XY footprint so the heightfield texture samples correctly across the shape.
export function createWaterGeometry(radius, segments = 512) {
  const positions = [];
  const uvs = [];

  const corner = (i) => {
    const angle = (Math.PI / 3) * i;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  };

  const pointAt = (row, col, cornerA, cornerB) => {
    const u = row / segments;
    const v = col / segments;
    return [u * cornerA[0] + v * cornerB[0], u * cornerA[1] + v * cornerB[1]];
  };

  const pushVertex = (row, col, cornerA, cornerB) => {
    const [x, y] = pointAt(row, col, cornerA, cornerB);
    positions.push(x, y, 0);
    uvs.push(0.5 + 0.5 * (x / radius), 0.5 + 0.5 * (y / radius));
  };

  const addSector = (cornerA, cornerB) => {
    for (let row = 0; row < segments; row++) {
      for (let col = 0; col <= segments - row - 1; col++) {
        pushVertex(row, col, cornerA, cornerB);
        pushVertex(row + 1, col, cornerA, cornerB);
        pushVertex(row, col + 1, cornerA, cornerB);

        if (col < segments - row - 1) {
          pushVertex(row + 1, col, cornerA, cornerB);
          pushVertex(row + 1, col + 1, cornerA, cornerB);
          pushVertex(row, col + 1, cornerA, cornerB);
        }
      }
    }
  };

  for (let i = 0; i < 6; i++) {
    addSector(corner(i), corner((i + 1) % 6));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
