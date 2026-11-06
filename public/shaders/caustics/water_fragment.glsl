// TODO Make it a uniform
const float causticsFactor = 0.35;
// const float causticsFactor = 0.05;

varying vec3 oldPosition;
varying vec3 newPosition;
varying float waterDepth;
varying float depth;
varying float causticsValid;


void main() {
  //if (causticsValid < 0.5) discard;

  float causticsIntensity = 0.;
  float div_zero = 0.;

  if (depth >= waterDepth) {
    float oldArea = length(dFdx(oldPosition)) * length(dFdy(oldPosition));
    float newArea = length(dFdx(newPosition)) * length(dFdy(newPosition));

    float ratio;

    // Prevent dividing by zero (debug NVidia drivers). A merely large finite ratio still
    // blows out the PCF blur downstream (it averages this texel with its neighbors), so cap
    // it at a value that's bright but not absurd rather than the largest finite float.
    if (newArea == 0.) {
      ratio = 8.;
      div_zero = 1.;
    } else {
      ratio = oldArea / newArea;
    }

    causticsIntensity = causticsFactor * ratio;
  }

  gl_FragColor = vec4(causticsIntensity, div_zero, 0., depth);
  //gl_FragColor = vec4(causticsIntensity, 0., 0., depth);
}
