uniform sampler2D caustics;
uniform vec3 underwaterColor;

varying float lightIntensity;
varying vec3 lightPosition;

// Sloped roof panels need a much looser tolerance than the original flat floor: the caustics
// ray-march samples the receiving surface's depth at a slightly shifted xy each step, which on
// a slope reads a different (usually shallower) depth than the receiving fragment's own depth.
// const float bias = 0.5;
// const float bias = 0.001;
const float bias = 0.005;

// Clamp how bright a single caustic sample can push a fragment, so an outlier texel (e.g. the
// div-by-zero fallback in the caustics shader) can't blow it out to solid white.
const float maxCausticsIntensity = 2.0;

// Size (in texels) of the caustics texture being sampled below, so the PCF blur offsets always
// match the actual render target instead of drifting out of sync with it.
uniform vec2 causticsResolution;

float blur(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
  float intensity = 0.;
  vec2 off1 = vec2(1.3846153846) * direction;
  vec2 off2 = vec2(3.2307692308) * direction;
  intensity += texture2D(image, uv).x * 0.2270270270;
  intensity += texture2D(image, uv + (off1 / resolution)).x * 0.3162162162;
  intensity += texture2D(image, uv - (off1 / resolution)).x * 0.3162162162;
  intensity += texture2D(image, uv + (off2 / resolution)).x * 0.0702702703;
  intensity += texture2D(image, uv - (off2 / resolution)).x * 0.0702702703;
  return intensity;
}

void main() {
  // Set the frag color
  float computedLightIntensity = 0.5;

  // Clamp to 0 so back-facing surfaces get no direct-light contribution at all.
  computedLightIntensity += 0.2 * max(lightIntensity, 0.);

  // Retrieve caustics depth information
  float causticsDepth = texture2D(caustics, lightPosition.xy).w;

  // if (causticsDepth > lightPosition.z - bias) {
    // Percentage Close Filtering
    // PCF blur approximated as 4 directional passes (horizontal/vertical/both diagonals)
    // averaged together instead of just horizontal+vertical, for a more isotropic kernel
    // (a true separable 2-pass blur would need an extra render target/pass).
    float causticsIntensity = 0.25 * (
      blur(caustics, lightPosition.xy, causticsResolution, vec2(0., 0.5)) +
      blur(caustics, lightPosition.xy, causticsResolution, vec2(0.5, 0.)) +
      blur(caustics, lightPosition.xy, causticsResolution, vec2(0.3536, 0.3536)) +
      blur(caustics, lightPosition.xy, causticsResolution, vec2(0.3536, -0.3536))
    );
    // float causticsIntensity = texture2D(caustics, lightPosition.xy).x;

    causticsIntensity = min(causticsIntensity, maxCausticsIntensity);

    computedLightIntensity += causticsIntensity * smoothstep(0., 1., lightIntensity);;
  // }

  gl_FragColor = vec4(underwaterColor * computedLightIntensity, 1.);
}
