precision highp float;
precision highp int;

uniform sampler2D texture;
uniform float mode;
varying vec2 coord;


void main() {
  vec4 color = texture2D(texture, coord);

  if (mode > 0.5) {
    // Depth is raw clip-space z (roughly -1 near .. 1 far for an orthographic camera).
    float d = 0.5 + 0.5 * color.w;
    gl_FragColor = vec4(vec3(d), 1.);
  } else {
    gl_FragColor = vec4(color.x, color.y, color.z, 1.);
  }
}
