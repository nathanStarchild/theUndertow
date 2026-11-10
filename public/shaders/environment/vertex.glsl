uniform vec3 light;

// Light projection matrix
uniform mat4 lightProjectionMatrix;
uniform mat4 lightViewMatrix;

varying float lightIntensity;
varying vec3 lightPosition;
// World-space position/normal of this fragment, used by the fragment shader's edge blending to
// work out which *other* projectors also cover this exact point on the roof (see blendWeight()).
// Blending has to be decided in shared world space, not in one projector's screen space, because
// how many projectors overlap varies across the surface - three of them meet near the apex.
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;


void main(void){
  lightIntensity = - dot(light, normalize(normal));

  // Compute position in the light coordinates system, this will be used for
  // comparing fragment depth with the caustics texture
  vec4 lightRelativePosition = lightProjectionMatrix * lightViewMatrix * modelMatrix * vec4(position, 1.);
  lightPosition = 0.5 + lightRelativePosition.xyz / lightRelativePosition.w * 0.5;

  vec4 worldPosition = modelMatrix * vec4(position, 1.);
  vWorldPosition = worldPosition.xyz;
  // Normals are winding-derived (computeVertexNormals) and back faces are culled, so for whichever
  // projector is currently rendering this already points back towards it - which is what makes the
  // facing test in blendWeight() meaningful when applied to the *other* projectors.
  vWorldNormal = mat3(modelMatrix) * normal;

  // The position of the vertex
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}
