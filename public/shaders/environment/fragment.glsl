uniform sampler2D caustics;
uniform vec3 underwaterColor;

// Edge blending. Overlap on this roof is not a simple left/right band: the 6 panels all meet at
// the apex, so coverage there is 3-deep while a crease near the eave is only 2-deep, and the
// middle of a panel is 1-deep. Rather than assume a pattern, each projector is tested against
// this fragment's actual world position and the result normalised (partition of unity), so the
// weights across every projector that can see a point always sum to exactly 1 - whatever the
// local overlap count happens to be. blendCount == 0 disables all of this.
#define MAX_BLEND_PROJECTORS 6
uniform int blendCount;
uniform int blendSelf;
// Falloff width, in NDC units, measured inwards from a projector's frustum edge.
uniform float blendFeather;
// Exponent on each projector's incidence cosine. 0 weights every covering projector equally;
// higher values hand more of an overlap to whichever projector faces the surface most directly
// (sharper, since a grazing projector smears its pixels over far more area), approaching
// winner-take-all. Because incidence flips across a crease, this also pulls the crossfade onto
// the creases, which is where seams are least visible.
uniform float blendQuality;
uniform mat4 blendViewProjection[MAX_BLEND_PROJECTORS];
uniform vec3 blendPosition[MAX_BLEND_PROJECTORS];

varying float lightIntensity;
varying vec3 lightPosition;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

// Sloped roof panels need a much looser tolerance than the original flat floor: the caustics
// ray-march samples the receiving surface's depth at a slightly shifted xy each step, which on
// a slope reads a different (usually shallower) depth than the receiving fragment's own depth.
// const float bias = 0.5;
// const float bias = 0.001;
const float bias = 0.005;

// Clamp how bright a single caustic sample can push a fragment, so an outlier texel (e.g. the
// div-by-zero fallback in the caustics shader) can't blow it out to solid white.
const float maxCausticsIntensity = 4.0;

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

// Fraction of this fragment's light that the currently-rendering projector should contribute.
// Where it is the only projector covering the point this returns 1 (no dimming at all, even
// right at the frustum edge); where N projectors overlap, each one's share falls out of the
// normalisation so the sum stays 1 and the surface brightness matches the non-overlapped areas.
float blendWeight() {
  if (blendSelf < 0 || blendCount <= 1 || blendFeather <= 0.0) return 1.0;

  vec3 n = normalize(vWorldNormal);
  float selfWeight = 0.0;
  float total = 0.0;

  for (int j = 0; j < MAX_BLEND_PROJECTORS; j++) {
    if (j >= blendCount) break;

    float w = 0.0;
    vec4 clip = blendViewProjection[j] * vec4(vWorldPosition, 1.0);
    if (clip.w > 0.0) {
      vec3 ndc = clip.xyz / clip.w;
      vec3 toProjector = blendPosition[j] - vWorldPosition;
      float dist = length(toProjector);
      float cosIncidence = dist > 0.0 ? dot(n, toProjector) / dist : 0.0;
      // Inside the frustum and on the side of the panel this projector can actually light - a
      // panel facing away from projector j is still inside its frustum, and counting it would
      // wrongly dim the projectors that genuinely do cover the point.
      if (all(lessThanEqual(abs(ndc), vec3(1.0))) && cosIncidence > 0.0) {
        vec2 edgeDistance = vec2(1.0) - abs(ndc.xy);
        w = smoothstep(0.0, blendFeather, edgeDistance.x)
          * smoothstep(0.0, blendFeather, edgeDistance.y)
          * pow(cosIncidence, blendQuality);
      }
    }

    total += w;
    if (j == blendSelf) selfWeight = w;
  }

  return total > 0.0 ? selfWeight / total : 0.0;
}

void main() {
  // Set the frag color
  float computedLightIntensity = 0.5;

  // Clamp to 0 so back-facing surfaces get no direct-light contribution at all.
  computedLightIntensity += 0.2 * max(lightIntensity, 0.);

  // Retrieve caustics depth information
  float causticsDepth = texture2D(caustics, lightPosition.xy).w;

  if (causticsDepth > lightPosition.z - bias) {
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
  }

  // Multiplying linear-space color here (before Three.js's output sRGB transfer, which is applied
  // after this shader runs) is what keeps the blend additive-correct; doing it post-encode would
  // show as a visible bright/dark band at the seam instead of a seamless ramp.
  gl_FragColor = vec4(underwaterColor * computedLightIntensity * blendWeight(), 1.);
}
