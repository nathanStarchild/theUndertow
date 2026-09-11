precision highp float;
precision highp int;

uniform sampler2D texture;
uniform vec2 delta;
varying vec2 coord;


void main() {
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
  float hL = texture2D(texture, coordL).r;
  float hR = texture2D(texture, coordR).r;
  float hD = texture2D(texture, coordD).r;
  float hU = texture2D(texture, coordU).r;

  float average = (hL + hR + hD + hU) * 0.25;

  /* change the velocity to move toward the average */
  info.g += (average - info.r) * 2.0;

  /* attenuate the velocity a little so waves do not last forever */
  info.g *= 0.9975;

  /* move the vertex along the velocity */
  info.r += info.g;

  /* update the normal */
  // vec3 ddx = vec3(delta.x, texture2D(texture, vec2(coord.x + delta.x, coord.y)).r - info.r, 0.0);
  // vec3 ddy = vec3(0.0, texture2D(texture, vec2(coord.x, coord.y + delta.y)).r - info.r, delta.y);

  vec3 ddx = vec3(delta.x, hR - info.r, 0.0);
  vec3 ddy = vec3(0.0, hU - info.r, delta.y);
  info.ba = normalize(cross(ddy, ddx)).xz;

  gl_FragColor = info;
}
