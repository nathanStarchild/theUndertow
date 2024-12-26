precision highp float;
precision highp int;

const float PI = 3.141592653589793;
uniform sampler2D texture;
uniform vec2 center;
uniform float radius;
uniform float strength;
varying vec2 coord;


void main() {

  gl_FragColor = vec4(coord.x, coord.y, 0., 0.);
}
