// TODO Make it a uniform
const float causticsFactor = 0.15;

varying vec3 oldPosition;
varying vec3 newPosition;
varying float waterDepth;
varying float depth;
varying float causticsValid;
varying float max_it;
varying float env_hit;
varying float env_invalid;



void main() {
  //if (causticsValid < 0.5) discard;

  float causticsIntensity = 0.;

  if (depth >= waterDepth) {
    float oldArea = length(dFdx(oldPosition)) * length(dFdy(oldPosition));
    float newArea = length(dFdx(newPosition)) * length(dFdy(newPosition));

    float ratio;

    // Prevent dividing by zero (debug NVidia drivers)
    if (newArea == 0.) {
      // Arbitrary large value
      ratio = 2.0e+20;
    } else {
      ratio = oldArea / newArea;
    }

    causticsIntensity = causticsFactor * ratio;
  }

  if (env_hit > 0.5) {
    gl_FragColor = vec4(causticsIntensity, 0., 0., depth);
  } else if (max_it > 0.5) {
    gl_FragColor = vec4(0., causticsIntensity, 0., depth);
  } else if (env_invalid > 0.5) {
    gl_FragColor = vec4(0., 0., causticsIntensity, depth);
  } else {
    gl_FragColor = vec4(causticsIntensity, 0., 0., depth);
  }
  //gl_FragColor = vec4(causticsIntensity, 0., 0., depth);
}
