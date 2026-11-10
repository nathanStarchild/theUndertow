uniform vec3 light;

// Light projection matrix
uniform mat4 lightProjectionMatrix;
uniform mat4 lightViewMatrix;

varying float lightIntensity;
varying vec3 lightPosition;
// Clip-space x (pre-perspective-divide) of this fragment from the *current* camera, used by the
// fragment shader to feather this projector's own left/right edges for blending (see blendLeft/
// blendRight there). Only meaningful when rendering projectionScene from a projector camera.
varying float vClipX;
varying float vClipW;


void main(void){
  lightIntensity = - dot(light, normalize(normal));

  // Compute position in the light coordinates system, this will be used for
  // comparing fragment depth with the caustics texture
  vec4 lightRelativePosition = lightProjectionMatrix * lightViewMatrix * modelMatrix * vec4(position, 1.);
  lightPosition = 0.5 + lightRelativePosition.xyz / lightRelativePosition.w * 0.5;

  // The position of the vertex
  vec4 clipPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  vClipX = clipPosition.x;
  vClipW = clipPosition.w;
  gl_Position = clipPosition;
}
