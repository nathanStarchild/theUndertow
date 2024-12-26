//attribute vec3 position;
varying vec2 coord;
varying vec2 vUV;


void main() {
  coord = vec2(position.x, position.y);
  vUV = uv;


  mat4 proj = projectionMatrix * modelViewMatrix;

  gl_Position = proj * vec4(position, 1.0);
}
