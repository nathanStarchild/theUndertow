precision highp float;
precision highp int;

uniform sampler2D texture;
uniform vec2 delta;
// Real-world apothem of the water geometry (radius * cos(30deg)), matching roof.js/waterSurface.js.
uniform float hexApothem;
varying vec2 coord;

// COS30/SIN30 recover the matching world-space point from coord given just the apothem (radius
// == hexApothem / COS30), so the shape test stays correct if the geometry's size ever changes.
const float COS30 = 0.8660254037844387; // cos(30 deg)
const float SIN30 = 0.5;

bool insideHex(vec2 p) {
  if (abs(p.y) > hexApothem) return false;
  if (abs(p.x * COS30 + p.y * SIN30) > hexApothem) return false;
  if (abs(p.x * COS30 - p.y * SIN30) > hexApothem) return false;
  return true;
}

bool insideHexUV(vec2 uv) {
  vec2 p = (uv * 2.0 - 1.0) * (hexApothem / COS30);
  return insideHex(p);
}

void main() {
  // Outside the hexagon there's no water, matching the visible hex water mesh's footprint.
  if (!insideHexUV(coord)) {
    gl_FragColor = vec4(0.0);
    return;
  }

  /* get vertex info */
  vec4 info = texture2D(texture, coord);

  /* calculate average neighbor height */
  vec2 dx = vec2(delta.x, 0.0);
  vec2 dy = vec2(0.0, delta.y);
  vec2 coordL = coord - dx;
  vec2 coordR = coord + dx;
  vec2 coordD = coord - dy;
  vec2 coordU = coord + dy;

  // A neighbor outside the hexagon is replaced with this texel's own height, the same
  // zero-gradient trick clamp-to-edge sampling gives for free at the square texture's border -
  // it turns the hex boundary into a reflecting wall instead of leaking waves past it.
  float hL = insideHexUV(coordL) ? texture2D(texture, coordL).r : info.r;
  float hR = insideHexUV(coordR) ? texture2D(texture, coordR).r : info.r;
  float hD = insideHexUV(coordD) ? texture2D(texture, coordD).r : info.r;
  float hU = insideHexUV(coordU) ? texture2D(texture, coordU).r : info.r;

  float average = (hL + hR + hD + hU) * 0.25;

  /* change the velocity to move toward the average */
  info.g += (average - info.r) * 2.0;

  /* attenuate the velocity a little so waves do not last forever */
  info.g *= 0.9975;

  /* move the vertex along the velocity */
  info.r += info.g;

  /* update the normal */
  vec3 ddx = vec3(delta.x, hR - info.r, 0.0);
  vec3 ddy = vec3(0.0, hU - info.r, delta.y);
  info.ba = normalize(cross(ddy, ddx)).xz;

  gl_FragColor = info;
}
