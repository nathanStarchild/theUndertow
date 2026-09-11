uniform vec3 light;

uniform sampler2D water;
uniform sampler2D env;
uniform float deltaEnvTexture;
uniform float waterHeight;

varying vec3 oldPosition;
varying vec3 newPosition;
varying float waterDepth;
varying float depth;
varying float causticsValid;

// Air refractive index / Water refractive index
const float eta = 0.7504;

// TODO Make this a uniform
// This is the maximum iterations when looking for the ray intersection with the environment,
// if after this number of attempts we did not find the intersection, the result will be wrong.
// Raised from 50: the hexayurt roof is much deeper (apex ~2m below the water) than the original test floor.
const int MAX_ITERATIONS = 1500;

// The environment map is cleared to (0,0,0,0) wherever it holds no geometry: outside the light
// camera's frustum, and outside the roof silhouette within that frustum (e.g. where the frustum
// crops through a panel). Treat both cases as "nothing to hit" instead of a false hit at the
// cleared position, which causes streaks radiating from the world origin.
bool isValidEnvironmentSample(vec2 sampleCoords, vec4 sampleValue) {
  bool inBounds = sampleCoords.x >= 0.0 && sampleCoords.x <= 1.0 &&
                  sampleCoords.y >= 0.0 && sampleCoords.y <= 1.0;
  return inBounds && sampleValue.w != 0.0;
}

void main() {
  vec4 waterInfo = texture2D(water, uv);

  // The water position is the vertex position on which we apply the height-map
  vec3 waterPosition = vec3(position.xy, position.z + waterInfo.r + waterHeight);
  // vec3 waterPosition = vec3(position.xy, position.z + waterInfo.r + 0.8);
  vec3 waterNormal = normalize(vec3(waterInfo.b, sqrt(1.0 - dot(waterInfo.ba, waterInfo.ba)), waterInfo.a)).xzy;

  // This is the initial position: the ray starting point
  oldPosition = waterPosition;

  // Compute water coordinates in the screen space
  vec4 projectedWaterPosition = projectionMatrix * viewMatrix * vec4(waterPosition, 1.);

  vec2 currentPosition = projectedWaterPosition.xy;
  vec2 coords = 0.5 + 0.5 * currentPosition;

  vec3 refracted = refract(light, waterNormal, eta);
  vec4 projectedRefractionVector = projectionMatrix * viewMatrix * vec4(refracted, 1.);

  vec3 refractedDirection = projectedRefractionVector.xyz;

  waterDepth = 0.5 + 0.5 * projectedWaterPosition.z / projectedWaterPosition.w;
  float currentDepth = projectedWaterPosition.z;
  vec4 environment = texture2D(env, coords);
  bool environmentValid = isValidEnvironmentSample(coords, environment);

  // This factor will scale the delta parameters so that we move from one pixel to the other in the env map
  float factor = deltaEnvTexture / length(refractedDirection.xy);

  vec2 deltaDirection = refractedDirection.xy * factor;
  float deltaDepth = refractedDirection.z * factor;

  bool hit = false;

  for (int i = 0; i < MAX_ITERATIONS; i++) {
        // Move the coords in the direction of the refraction

    currentPosition += deltaDirection;
    currentDepth += deltaDepth;

    // End of loop condition: The ray has hit the environment
    if (environmentValid && environment.w <= currentDepth) {
    //if (environment.w <= currentDepth) {

      hit = true;
      break;
    }

    // The ray has left valid environment data (off-frustum or off-roof): stop marching.
    if (!environmentValid) {
      break;
    }

    vec2 nextCoords = 0.5 + 0.5 * currentPosition;
    environment = texture2D(env, nextCoords);
    environmentValid = isValidEnvironmentSample(nextCoords, environment);

    //environment = texture2D(env, 0.5 + 0.5 * currentPosition);
  }

  causticsValid = hit ? 1. : 0.;

   newPosition = hit ? environment.xyz : waterPosition;
   vec4 projectedEnvPosition = hit
       ? projectionMatrix * viewMatrix * vec4(newPosition, 1.0)
       : projectedWaterPosition;

  // newPosition = environment.xyz;
  // vec4 projectedEnvPosition = projectionMatrix * viewMatrix * vec4(newPosition, 1.0);

  depth = 0.5 + 0.5 * projectedEnvPosition.z / projectedEnvPosition.w;


  gl_Position = projectedEnvPosition;
}
