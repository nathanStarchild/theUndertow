import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import Stats from 'stats.js';
import { createRoofGeometry, ROOF_RADIUS, ROOF_APEX_HEIGHT } from './roof.js';
import { createWaterGeometry } from './waterSurface.js';

const stats = new Stats();
stats.showPanel(0);

document.body.appendChild(stats.dom);

const canvas = document.getElementById('canvas');

canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;

const width = canvas.width;
const height = canvas.height;

console.log(`${width} x ${height}`)




// Colors
const black = new THREE.Color('black');
const white = new THREE.Color('white');
let underwaterColour = [0., 0.24, 0.47];
const waterVisible = false;

function loadFile(filename) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.FileLoader();

    loader.load('/' + filename, (data) => {
      resolve(data);
    });
  });
}

// Constants
// Water surface stays at its original height; the roof geometry is mirrored to sit below it, playing the floor's role.
// const waterPosition = new THREE.Vector3(0, 0, 0.8);
const waterPosition = new THREE.Vector3(0, 0, 0);
const waterSize = 2048;
const renderSize = waterSize * 2;
// const waterSize = 4096;
// sclx/scly stay tied to the roof's real radius so the water-sim domain and light frustum actually cover the whole roof.
// const sclx = ROOF_RADIUS;
// const scly = ROOF_RADIUS;
const sclx = 1.;
const scly = 1.;

// The water sim/caustics/mouse-picking domain is a hexagon whose side length (== circumradius)
// matches the roof footprint, so all of them agree on world-space scale.
const waterWidth = ROOF_RADIUS * 2;
// Real apothem of that hexagon (center-to-edge distance), used to bound the sim to the same shape.
const waterApothem = ROOF_RADIUS * Math.cos(Math.PI / 6);

// Water heightfield resolution, decoupled from renderSize (which sizes the environment map and
// caustics render targets) so tuning ripple detail doesn't affect caustics/environment quality.
const waterSimResolution = 1024;

// Neighbor sampling offset (in texels) for the simulation's Laplacian update in
// simulation/update_fragment.glsl. Widening this - rather than raising that shader's spring
// constant - is what controls wave propagation speed without destabilizing the explicit integrator.
const simStencilTexels = 4;

// Segment count for the hexagonal water/caustics meshes below. A triangular sector subdivided
// into N segments per side has N^2 triangles, and there are 6 sectors (6*N^2 total) - vs a square
// grid's 2*N^2 - so this is kept well below waterSize to avoid a ~3x triangle-count blowup.
const hexMeshSegments = 1024;

const up = new THREE.Vector3( 0, 1, 0 );
let axis = new THREE.Vector3( );

// Debug controls: space bar pauses all caustics-affecting updates so a single frame can be
// inspected; 0-3 pick what the Debug overlay shows on screen (see keydown listener below).
let paused = false;
let debugView = 0;
const debugViewNames = ['scene', 'water heightfield', 'environment map', 'caustics', 'causticsDebug'];
window.addEventListener('keydown', (event) => {
  if (event.key === ' ') {
    paused = !paused;
    console.log(paused ? 'paused' : 'resumed');
  } else if (event.key >= '0' && event.key <= '4') {
    debugView = parseInt(event.key, 10);
    console.log('debug view:', debugViewNames[debugView]);
  }
});

// Create directional light
const near = 0;
// far is widened (vs. the original 2.) to reach the mirrored roof's lowest point at z=-1.2.
// A small margin is kept beyond the floor's theoretical distance (camera.z - floor.z = 1.0)
// so the floor doesn't sit exactly on the far-clip boundary, where float rounding can clip it out entirely.
const far = ROOF_APEX_HEIGHT + 0.1;
// TODO Replace this by a THREE.DirectionalLight and use the provided matrix (check that it's an Orthographic matrix as expected)
const light = [0., 0., -1.];
// Frustum is widened (vs. the original 1.7x0.9) to cover the roof's full ROOF_RADIUS footprint.

// const lightCamera = new THREE.OrthographicCamera(-1.7, 1.7, 0.9, -0.9, near, far);
// const lightCamera = new THREE.OrthographicCamera(-1.7, 1.7, 0.5, -0.5, near, far);
const lightFrustumSize = ROOF_RADIUS + 0.1;
const lightCamera = new THREE.OrthographicCamera(-lightFrustumSize, lightFrustumSize, lightFrustumSize, -lightFrustumSize, near, far);
lightCamera.position.set(0., 0.0, waterPosition.z);
lightCamera.lookAt(0, 0, 0);

// Create Renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, width / height, 0.01, 100);
// camera.position.set(0., 0., 5.);
camera.position.set(0., 0., 1.2);
camera.up.set(0, 0, 1);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({canvas: canvas, antialias: true, alpha: true});
renderer.setSize(width, height);
renderer.autoClear = false;

// Create mouse Controls
const controls = new OrbitControls(
  camera,
  canvas
);

controls.target = waterPosition;

controls.minPolarAngle = -Math.PI - 0.1;
controls.maxPolarAngle = Math.PI - 0.1;

controls.minDistance = 0;
controls.maxDistance = 3.;

// Target for computing the water refraction
const temporaryRenderTarget = new THREE.WebGLRenderTarget(width, height);

// Clock
const clock = new THREE.Clock();

// Cached so the Debug overlay can keep showing the last computed textures while paused.
let cachedWaterTexture = null;
let cachedEnvironmentMapTexture = null;
let cachedCausticsTexture = null;
let cachedCausticsDebugTexture = null;

// Ray caster
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const targetgeometry = new THREE.PlaneGeometry(waterWidth, waterWidth);
targetgeometry.scale(sclx, scly, 1.)
// Update vertex positions using BufferGeometry attributes
const positions = targetgeometry.attributes.position;
for (let i = 0; i < positions.count; i++) {
  positions.setZ(i, waterPosition.z);
}
const targetmesh = new THREE.Mesh(targetgeometry);

// Geometries
const waterGeometry = createWaterGeometry(ROOF_RADIUS, hexMeshSegments);
const vertices = new Float32Array([
  -1, -1, -1,
  -1, -1, 1,
  -1, 1, -1,
  -1, 1, 1,
  1, -1, -1,
  1, 1, -1,
  1, -1, 1,
  1, 1, 1,
  -1, -1, -1,
  1, -1, -1,
  -1, -1, 1,
  1, -1, 1,
  -1, 1, -1,
  -1, 1, 1,
  1, 1, -1,
  1, 1, 1,
  -1, -1, -1,
  -1, 1, -1,
  1, -1, -1,
  1, 1, -1,
  -1, -1, 1,
  1, -1, 1,
  -1, 1, 1,
  1, 1, 1
]);
const indices = new Uint32Array([
  0, 1, 2,
  2, 1, 3,
  4, 5, 6,
  6, 5, 7,
  12, 13, 14,
  14, 13, 15,
  16, 17, 18,
  18, 17, 19,
  20, 21, 22,
  22, 21, 23
]);

// Environment
const floorGeometry = new THREE.PlaneGeometry(ROOF_RADIUS*2, ROOF_RADIUS*2, 1, 1);
floorGeometry.translate(0, 0, -ROOF_APEX_HEIGHT);
// floorGeometry.rotateX(-Math.PI / 3.);

// Mirrored in z so the ceiling shape sits below the water plane, playing the floor's role like the original flat floor.
// const roofGeometry = createRoofGeometry(ROOF_RADIUS, ROOF_APEX_HEIGHT);
const roofGeometry = createRoofGeometry(ROOF_RADIUS, ROOF_APEX_HEIGHT);
roofGeometry.scale(1, 1, -1);
// roofGeometry.translate(0, 0, -0.1);
roofGeometry.computeVertexNormals();

const objLoader = new OBJLoader();
let shark;
const sharkLoaded = new Promise((resolve) => {
  objLoader.load('/assets/WhiteShark.obj', (sharkGeometry) => {
    sharkGeometry = sharkGeometry.children[0].geometry;
    sharkGeometry.computeVertexNormals();
    sharkGeometry.scale(0.04, 0.04, 0.04);
    sharkGeometry.rotateX(-Math.PI / 2.);
    // sharkGeometry.rotateZ(-Math.PI / 2.);
    // Water now fills upward from the eaves (z=0) to the apex (z=1.2); keep the shark mid-water.
    sharkGeometry.translate(0, 0, -0.4);

    // const sharkPath = new THREE.CurvePath();

    const sharkPoints = [
      new THREE.Vector3(  0, 0, 0.00 ),
      new THREE.Vector3(  0.4, 1.2, 0.0 ),
      new THREE.Vector3(  0.2, 1.2, 0.0 ),
      new THREE.Vector3( -0.2, 1.2, 0.0 ),
      new THREE.Vector3( -0.4, 1, 0.0 ),
      new THREE.Vector3( -0.8, 0.4, 0.0 ),
      new THREE.Vector3( -0.8, -0.4, 0.0 ),
      new THREE.Vector3( -0.4, -0.4, 0.0 ),
      new THREE.Vector3( -0.4, -1.4, 0.0 ),
      new THREE.Vector3( -0.6, -1.4, 0.0 ),
      new THREE.Vector3( -0.8, -0.4, 0.0 ),
      new THREE.Vector3( 0.4, -0.4, 0.0 ),
      new THREE.Vector3(  0, 0, 0.00 ),
      new THREE.Vector3(  1, 1, 0.0 ),
      new THREE.Vector3(  1.5, 1.1, 0.0 ),
      new THREE.Vector3(  2, 1.2, 0.0 ),
      new THREE.Vector3(  -2, -1.2, 0.0 ),
    ]


    const curve = new THREE.CatmullRomCurve3( sharkPoints );	
    curve.closed = true;

    // sharkPath.add(sharkPoints)

    // const sharkCurve = new THREE.CatmullRomCurve3( sharkPoints );	
    // sharkCurve.closed = true;

    shark = {
      geometry: sharkGeometry,
      envMesh: 0,
      envMapMesh: 0,
      path: curve,
      newPosition: 0,
      tangent: 0,
      radians: 0,
      fraction: 0,
      increment: 0.0001,
      hasWake: false,
      wakeCounter: 0,
    }

    resolve();
  });
});


let boat1;
const boatLoaded = new Promise((resolve) => {
  objLoader.load('/assets/15211_Wakeboard_v1_NEW.obj', (boatGeometry) => {
    boatGeometry = boatGeometry.children[0].geometry;
    boatGeometry.computeVertexNormals();
    boatGeometry.scale(0.0015, 0.0015, 0.0015);
    boatGeometry.rotateX(-Math.PI);
    boatGeometry.rotateZ(Math.PI / 2.);
    boatGeometry.translate(0, 0, -0.2);

    // const sharkPath = new THREE.CurvePath();

    const boat1Points = [
      new THREE.Vector3(  -2, 0.2, 0.00 ),
      new THREE.Vector3(  2, 0, 0.0 ),
      new THREE.Vector3(  2, 0, 0.0 ),
      new THREE.Vector3( -0.2, 1.2, 0.0 ),
      new THREE.Vector3( -0.2, 1.2, 0.0 ),
      new THREE.Vector3(  -2, 0.2, 0.00 ),
      new THREE.Vector3(  -2, 0.2, 0.00 ),
      new THREE.Vector3( -0.2, -1.2, 0.0 ),
      new THREE.Vector3( -0.2, -1.2, 0.0 ),
      new THREE.Vector3( 0.8, 1.2, 0.0 ),
      new THREE.Vector3( 0.8, 1.2, 0.0 ),
      new THREE.Vector3(  -2, 0.2, 0.00 ),
      // new THREE.Vector3( -0.4, 1, 0.0 ),
      // new THREE.Vector3( -0.8, 0.4, 0.0 ),
      // new THREE.Vector3( -0.8, -0.4, 0.0 ),
      // new THREE.Vector3( -0.4, -0.4, 0.0 ),
    ]


    const curve = new THREE.CatmullRomCurve3( boat1Points );	
    curve.closed = true;

    // sharkPath.add(sharkPoints)

    // const sharkCurve = new THREE.CatmullRomCurve3( sharkPoints );	
    // sharkCurve.closed = true;

    boat1 = {
      geometry: boatGeometry,
      envMesh: 0,
      envMapMesh: 0,
      path: curve,
      newPosition: 0,
      tangent: 0,
      radians: 0,
      fraction: 0,
      increment: 0.00003,
      hasWake: true,
      wakeCounter: 0,
    }

    resolve();
  });
});


let boat2;
const boat2Loaded = new Promise((resolve) => {
  objLoader.load('/assets/Boat3.obj', (boatGeometry) => {
    boatGeometry = boatGeometry.children[0].geometry;
    boatGeometry.computeVertexNormals();
    boatGeometry.scale(0.00075, 0.00075, 0.001);
    boatGeometry.rotateZ(Math.PI / 2.);
    boatGeometry.rotateX(-Math.PI/ 2.);
    boatGeometry.rotateY(-Math.PI/ 2.);
    boatGeometry.translate(0.0, 0, 0.15);

    // const sharkPath = new THREE.CurvePath();


    const boat1Points = [
      new THREE.Vector3(  0.5, 0.2, 0.00 ),
      new THREE.Vector3(  -1.5, 0, 0.0 ),
      new THREE.Vector3( -0.2, 1.2, 0.0 ),
      new THREE.Vector3( -0.2, 1.2, 0.0 ),
      new THREE.Vector3( -0.2, 1.2, 0.0 ),
      new THREE.Vector3( -0.2, 1.2, 0.0 ),
      new THREE.Vector3( -0.2, 1.2, 0.0 ),
      new THREE.Vector3( -0.2, 1.2, 0.0 ),
      new THREE.Vector3( -0.4, 1, 0.0 ),
      new THREE.Vector3( -0.8, 0.4, 0.0 ),
      new THREE.Vector3( -0.85, -0.4, 0.0 ),
      new THREE.Vector3( -0.8, -1.4, 0.0 ),
      new THREE.Vector3( -0.8, -1.4, 0.0 ),
      new THREE.Vector3( -0.8, -1.4, 0.0 ),
      new THREE.Vector3( -0.8, -1.4, 0.0 ),
      new THREE.Vector3( -0.8, -1.4, 0.0 ),
      new THREE.Vector3( -0.8, -1.4, 0.0 ),
      new THREE.Vector3( -0.8, -1.4, 0.0 ),
      new THREE.Vector3( -0.4, -0.4, 0.0 ),
      new THREE.Vector3( -1.4, -0.4, 0.0 ),
      new THREE.Vector3( -2.4, -0.2, 0.0 ),
      new THREE.Vector3( -2.4, -0.2, 0.0 ),
      new THREE.Vector3( -2.4, -0.2, 0.0 ),
      new THREE.Vector3( -2.4, -0.2, 0.0 ),
      new THREE.Vector3( -2.4, -0.2, 0.0 ),
      new THREE.Vector3( -2.4, -0.2, 0.0 ),
      new THREE.Vector3( -2.4, -0.2, 0.0 ),
      new THREE.Vector3( -2.4, -0.8, 0.0 ),
      new THREE.Vector3( -0.8, 0.5, 0.0 ),
      new THREE.Vector3( -0.6, 0.5, 0.0 ),
      new THREE.Vector3( -0.2, 0.5, 0.0 ),
      new THREE.Vector3( 0, 0.7, 0.0 ),
      new THREE.Vector3( 0, 0.8, 0.0 ),
      new THREE.Vector3( 1.1, 1, 0.0 ),
      new THREE.Vector3( 1.1, 1.3, 0.0 ),
      new THREE.Vector3( 1.1, 1.3, 0.0 ),
      new THREE.Vector3( 1.1, 1.3, 0.0 ),
      new THREE.Vector3( 1.1, 1.3, 0.0 ),
      new THREE.Vector3( 1.1, 1.3, 0.0 ),
      new THREE.Vector3( 1.1, 1.3, 0.0 ),
      new THREE.Vector3( 1.1, 1.3, 0.0 ),
      new THREE.Vector3( 1.1, 1.3, 0.0 ),
      new THREE.Vector3( 1.1, 1.3, 0.0 ),
      new THREE.Vector3( 1.8, 1.3, 0.0 ),
    ]


    const curve = new THREE.CatmullRomCurve3( boat1Points );	
    curve.closed = true;

    // sharkPath.add(sharkPoints)

    // const sharkCurve = new THREE.CatmullRomCurve3( sharkPoints );	
    // sharkCurve.closed = true;

    boat2 = {
      geometry: boatGeometry,
      envMesh: 0,
      envMapMesh: 0,
      path: curve,
      newPosition: 0,
      tangent: 0,
      radians: 0,
      fraction: 0,
      increment: 0.00015,
      hasWake: true,
      wakeCounter: 0,
    }

    resolve();
  });
});


let rock1;
let rock2;
const rockLoaded = new Promise((resolve) => {
  objLoader.load('/assets/rock.obj', (rockGeometry) => {
    rockGeometry = rockGeometry.children[0].geometry;
    rockGeometry.computeVertexNormals();

    rock1 = new THREE.BufferGeometry().copy(rockGeometry);
    rock1.scale(0.05, 0.05, 0.02);
    rock1.translate(0.2, 0., 0.1);

    rock2 = new THREE.BufferGeometry().copy(rockGeometry);
    rock2.scale(0.05, 0.05, 0.05);
    rock2.translate(-0.5, 0.5, 0.2);
    rock2.rotateZ(Math.PI / 2.);

    resolve();
  });
});

let plant;
const plantLoaded = new Promise((resolve) => {
  objLoader.load('/assets/plant.obj', (plantGeometry) => {
    plantGeometry = plantGeometry.children[0].geometry;
    plantGeometry.computeVertexNormals();

    plant = plantGeometry;
    plant.rotateX(Math.PI / 6.);
    plant.scale(0.03, 0.03, 0.03);
    plant.translate(-0.5, 0.5, 0.);

    resolve();
  });
});

// Skybox
const cubetextureloader = new THREE.CubeTextureLoader();

const skybox = cubetextureloader.load([
  '/assets/TropicalSunnyDay_px.jpg', '/assets/TropicalSunnyDay_nx.jpg',
  '/assets/TropicalSunnyDay_py.jpg', '/assets/TropicalSunnyDay_ny.jpg',
  '/assets/TropicalSunnyDay_pz.jpg', '/assets/TropicalSunnyDay_nz.jpg',
]);

scene.background = skybox;

class WaterTest{
  constructor() {
    this._camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 2000);

    
    // this.geometry = waterGeometry;
    this.geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.scale = 4.;
    this.geometry.scale(this.scale, this.scale, 1.)
    // this._geometry.scale(4., 4., 1.)
    // console.log(this._geometry.parameters)

    // this._targetA = new THREE.WebGLRenderTarget(waterSize, waterSize, {type: THREE.FloatType});
    // // this._targetA.texture.wrapS = this._targetA.texture.wrapT = THREE.MirroredRepeatWrapping
    // this._targetB = new THREE.WebGLRenderTarget(waterSize, waterSize, {type: THREE.FloatType});
    // // this._targetB.texture.wrapS = this._targetB.texture.wrapT = THREE.MirroredRepeatWrapping
    // this.target = this._targetA;

    const shadersPromises = [
      loadFile('shaders/waterTest/vertex.glsl'),
      loadFile('shaders/waterTest/fragment.glsl')
    ];

    this.loaded = Promise.all(shadersPromises)
        .then(([vertexShader, fragmentShader]) => {
      this.material = new THREE.ShaderMaterial({
        uniforms: {
            scale: {value: this.scale},
            center: { value: [0, 0] },
            radius: { value: 0 },
            strength: { value: 0 },
            texture: { value: null },
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
      });

      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.mesh.position.set(waterPosition.x, waterPosition.y, waterPosition.z);
    });
  }

}

class WaterSimulation {

  constructor() {
    this._camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 2000);

    // This must stay a plain [-1,1] quad: simulation/vertex.glsl derives its sample coord
    // directly from position.xy, it isn't the visible water shape.
    this._geometry = new THREE.PlaneGeometry(2, 2);
    // console.log(this._geometry.parameters)

    this._targetA = new THREE.WebGLRenderTarget(waterSimResolution, waterSimResolution, {type: THREE.FloatType});
    // this._targetA.texture.wrapS = this._targetA.texture.wrapT = THREE.MirroredRepeatWrapping
    this._targetB = new THREE.WebGLRenderTarget(waterSimResolution, waterSimResolution, {type: THREE.FloatType});
    // this._targetB.texture.wrapS = this._targetB.texture.wrapT = THREE.MirroredRepeatWrapping
    this.target = this._targetA;

    const shadersPromises = [
      loadFile('shaders/simulation/vertex.glsl'),
      loadFile('shaders/simulation/drop_fragment.glsl'),
      loadFile('shaders/simulation/update_fragment.glsl'),
    ];

    this.loaded = Promise.all(shadersPromises)
        .then(([vertexShader, dropFragmentShader, updateFragmentShader]) => {
      const dropMaterial = new THREE.RawShaderMaterial({
        uniforms: {
            center: { value: [0, 0] },
            radius: { value: 0 },
            strength: { value: 0 },
            texture: { value: null },
        },
        vertexShader: vertexShader,
        fragmentShader: dropFragmentShader,
      });

      const updateMaterial = new THREE.RawShaderMaterial({
        uniforms: {
            delta: { value: [simStencilTexels / waterSimResolution, simStencilTexels / waterSimResolution] },
            hexApothem: { value: waterApothem },
            texture: { value: null },
        },
        vertexShader: vertexShader,
        fragmentShader: updateFragmentShader,
      });

      this._dropMesh = new THREE.Mesh(this._geometry, dropMaterial);
      this._updateMesh = new THREE.Mesh(this._geometry, updateMaterial);
    });
  }

  // Add a drop of water at the (x, y) coordinate (in the range [-1, 1])
  addDrop(renderer, x, y, radius, strength) {
    this._dropMesh.material.uniforms['center'].value = [x, y];
    this._dropMesh.material.uniforms['radius'].value = radius;
    this._dropMesh.material.uniforms['strength'].value = strength;

    this._render(renderer, this._dropMesh);
  }

  stepSimulation(renderer) {
    this._render(renderer, this._updateMesh);
  }

  _render(renderer, mesh) {
    // Swap textures
    const _oldTarget = this.target;
    const _newTarget = this.target === this._targetA ? this._targetB : this._targetA;

    const oldTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(_newTarget);

    mesh.material.uniforms['texture'].value = _oldTarget.texture;

    // TODO Camera is useless here, what should be done?
    renderer.render(mesh, this._camera);

    renderer.setRenderTarget(oldTarget);

    this.target = _newTarget;
  }

}


class Water {

  constructor() {
    this.geometry = waterGeometry;
    this.geometry.scale(sclx, scly, 1.)

    const shadersPromises = [
      loadFile('shaders/water/vertex.glsl'),
      loadFile('shaders/water/fragment.glsl')
    ];

    this.loaded = Promise.all(shadersPromises)
        .then(([vertexShader, fragmentShader]) => {
      this.material = new THREE.ShaderMaterial({
        uniforms: {
            light: { value: light },
            water: { value: null },
            envMap: { value: null },
            skybox: { value: skybox },
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
      });
      this.material.side = THREE.DoubleSide;
      this.material.extensions = {
        derivatives: true
      };

      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.mesh.position.set(waterPosition.x, waterPosition.y, waterPosition.z);
    });
  }

  setHeightTexture(waterTexture) {
    this.material.uniforms['water'].value = waterTexture;
  }

  setEnvMapTexture(envMap) {
    this.material.uniforms['envMap'].value = envMap;
  }

}


// This renders the environment map seen from the light POV.
// The resulting texture contains (posx, posy, posz, depth) in the colors channels.
class EnvironmentMap {

  constructor() {
    // Must be >= hexMeshSegments (the caustics water mesh's segment count): if the water mesh has
    // more vertices than this texture has texels, many adjacent vertices sample the same env texel,
    // making dFdx/dFdy(newPosition) collapse to 0 almost everywhere in the caustics fragment
    // shader instead of only at real caustic focal points.
    this.size = renderSize;
    // Nearest filtering is required: this target stores raw position/depth data with holes
    // cleared to (0,0,0,0). Linear filtering would blend real geometry texels with the cleared
    // sentinel at every edge/hole boundary, producing bogus in-between samples that
    // isValidEnvironmentSample() can't detect (their w is a small nonzero blend, not exactly 0).
    this.target = new THREE.WebGLRenderTarget(this.size, this.size, {
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });

    const shadersPromises = [
      loadFile('shaders/environment_mapping/vertex.glsl'),
      loadFile('shaders/environment_mapping/fragment.glsl')
    ];

    this._meshes = [];
    this._flows = [];

    this.loaded = Promise.all(shadersPromises)
        .then(([vertexShader, fragmentShader]) => {
      this._material = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
      });
    });
  }

  setGeometries(geometries) {
    this._meshes = [];

    for (let geometry of geometries) {
      this._meshes.push(new THREE.Mesh(geometry, this._material));
    }
  }

  setMovingGeometries(objs) {

    for (let obj of objs) {
      obj.envMapMesh = new THREE.Mesh(obj.geometry, this._material)
      this._meshes.push(obj.envMapMesh);
    }
  }

  // setFlows(flowObjects) {
  //   this._flows = [];

  //   for (let flowObject of flowObjects) {
  //     let mesh = new THREE.Mesh(flowObject.geomatry, this._material)
  //     let flow = new Flow(mesh)
  //     flow.updateCurve(0, flowObject.curve)

  //     this._flows.push(flow);
  //   }
  // }

  render(renderer) {
    const oldTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(this.target);
    renderer.setClearColor(black, 0);
    renderer.clear();

    for (let mesh of this._meshes) {
      // console.log(mesh.position)
      mesh.matrixWorldNeedsUpdate = true
      renderer.render(mesh, lightCamera);
    }

    renderer.setRenderTarget(oldTarget);
  }

}


class Caustics {

  constructor() {
    this.target = new THREE.WebGLRenderTarget(renderSize, renderSize, {type: THREE.FloatType});
    // this.target = new THREE.WebGLRenderTarget(waterSize*3, waterSize*3, {type: THREE.FloatType});

    this._waterGeometry = createWaterGeometry(ROOF_RADIUS, hexMeshSegments);
    // this._waterGeometry.texture.wrapS = THREE.MirroredRepeatWrapping

    const shadersPromises = [
      loadFile('shaders/caustics/water_vertex.glsl'),
      loadFile('shaders/caustics/water_fragment.glsl'),
    ];

    this.loaded = Promise.all(shadersPromises)
        .then(([waterVertexShader, waterFragmentShader]) => {
      this._waterMaterial = new THREE.ShaderMaterial({
        uniforms: {
          light: { value: light },
          env: { value: null },
          water: { value: null },
          deltaEnvTexture: { value: null },
          waterHeight: { value: waterPosition.z }
        },
        vertexShader: waterVertexShader,
        fragmentShader: waterFragmentShader,
        transparent: true,
      });

      this._waterMaterial.blending = THREE.CustomBlending;

      // Set the blending so that:
      // Caustics intensity uses an additive function
      this._waterMaterial.blendEquation = THREE.AddEquation;
      this._waterMaterial.blendSrc = THREE.OneFactor;
      this._waterMaterial.blendDst = THREE.OneFactor;

      // Caustics depth does not use blending, we just set the value
      this._waterMaterial.blendEquationAlpha = THREE.AddEquation;
      this._waterMaterial.blendSrcAlpha = THREE.OneFactor;
      this._waterMaterial.blendDstAlpha = THREE.ZeroFactor;


      this._waterMaterial.side = THREE.DoubleSide;
      this._waterMaterial.extensions = {
        derivatives: true
      };

      this._waterMesh = new THREE.Mesh(this._waterGeometry, this._waterMaterial);
    });
  }

  setDeltaEnvTexture(deltaEnvTexture) {
    this._waterMaterial.uniforms['deltaEnvTexture'].value = deltaEnvTexture;
  }

  setTextures(waterTexture, envTexture) {
    this._waterMaterial.uniforms['env'].value = envTexture;
    // waterTexture.wrapS = THREE.MirroredRepeatWrapping
    this._waterMaterial.uniforms['water'].value = waterTexture;
  }

  render(renderer) {
    const oldTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(this.target);
    renderer.setClearColor(black, 0);
    renderer.clear();

    renderer.render(this._waterMesh, lightCamera);

    renderer.setRenderTarget(oldTarget);
  }

}

class CausticsDebug {

  constructor() {
    this.target = new THREE.WebGLRenderTarget(waterSize, waterSize, {type: THREE.FloatType});

    this._waterGeometry = createWaterGeometry(ROOF_RADIUS, hexMeshSegments);
    // this._waterGeometry.texture.wrapS = THREE.MirroredRepeatWrapping

    const shadersPromises = [
      loadFile('shaders/causticsDebug/water_vertex.glsl'),
      loadFile('shaders/causticsDebug/water_fragment.glsl'),
    ];

    this.loaded = Promise.all(shadersPromises)
        .then(([waterVertexShader, waterFragmentShader]) => {
      this._waterMaterial = new THREE.ShaderMaterial({
        uniforms: {
          light: { value: light },
          env: { value: null },
          water: { value: null },
          deltaEnvTexture: { value: null },
          waterHeight: { value: waterPosition.z }
        },
        vertexShader: waterVertexShader,
        fragmentShader: waterFragmentShader,
        transparent: true,
      });

      this._waterMaterial.blending = THREE.CustomBlending;

      // Set the blending so that:
      // Caustics intensity uses an additive function
      this._waterMaterial.blendEquation = THREE.AddEquation;
      this._waterMaterial.blendSrc = THREE.OneFactor;
      this._waterMaterial.blendDst = THREE.OneFactor;

      // Caustics depth does not use blending, we just set the value
      this._waterMaterial.blendEquationAlpha = THREE.AddEquation;
      this._waterMaterial.blendSrcAlpha = THREE.OneFactor;
      this._waterMaterial.blendDstAlpha = THREE.ZeroFactor;


      this._waterMaterial.side = THREE.DoubleSide;
      this._waterMaterial.extensions = {
        derivatives: true
      };

      this._waterMesh = new THREE.Mesh(this._waterGeometry, this._waterMaterial);
    });
  }

  setDeltaEnvTexture(deltaEnvTexture) {
    this._waterMaterial.uniforms['deltaEnvTexture'].value = deltaEnvTexture;
  }

  setTextures(waterTexture, envTexture) {
    this._waterMaterial.uniforms['env'].value = envTexture;
    // waterTexture.wrapS = THREE.MirroredRepeatWrapping
    this._waterMaterial.uniforms['water'].value = waterTexture;
  }

  render(renderer) {
    const oldTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(this.target);
    renderer.setClearColor(black, 0);
    renderer.clear();

    renderer.render(this._waterMesh, lightCamera);

    renderer.setRenderTarget(oldTarget);
  }

}


class Environment {

  constructor() {
    const shadersPromises = [
      loadFile('shaders/environment/vertex.glsl'),
      loadFile('shaders/environment/fragment.glsl')
    ];

    this._meshes = [];
    this._flows = [];

    this.loaded = Promise.all(shadersPromises).then(([vertexShader, fragmentShader]) => {
      this._material = new THREE.ShaderMaterial({
        uniforms: {
          light: { value: light },
          caustics: { value: null },
          lightProjectionMatrix: { value: lightCamera.projectionMatrix },
          lightViewMatrix: { value: lightCamera.matrixWorldInverse  },
          underwaterColor: {value: underwaterColour},
          // Caustics render target is always waterSize x waterSize; keep the PCF blur in sync with it.
          causticsResolution: { value: new THREE.Vector2(renderSize, renderSize) }
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
      });
    });
  }

  setGeometries(geometries) {
    this._meshes = [];

    for (let geometry of geometries) {
      this._meshes.push(new THREE.Mesh(geometry, this._material));
    }
  }

  setMovingGeometries(objs) {

    for (let obj of objs) {
      obj.envMesh = new THREE.Mesh(obj.geometry, this._material)
      this._meshes.push(obj.envMesh);
      // console.log(obj.envMesh)
      // var helper = new THREE.BoxHelper(obj.envMesh, 0xff0000);
      // helper.update();
      // // If you want a visible bounding box
      // // scene.add(helper);
      // // If you just want the numbers
      // console.log(helper);
    }
  }

  // setFlows(flowObjects) {
  //   this._flows = [];

  //   for (let flowObject of flowObjects) {
  //     let mesh = new THREE.Mesh(flowObject.geomatry, this._material)
  //     let flow = new THREE.Flow(mesh)
  //     flow.updateCurve(0, flowObject.curve)

  //     this._flows.push(flow);
  //   }
  // }

  updateCaustics(causticsTexture) {
    this._material.uniforms['caustics'].value = causticsTexture;
  }

  updateUnderwaterColour(underwaterColor) {
    this._material.uniforms['underwaterColor'].value = underwaterColor
  }

  addTo(scene) {
    for (let mesh of this._meshes) {
      scene.add(mesh);
    }

    // for (let flow of this._flows) {
    //   scene.add(flow.object3D);
    // }
  }

}


class Debug {

  constructor() {
    this._camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 1);
    this._geometry = new THREE.PlaneGeometry();

    const shadersPromises = [
      loadFile('shaders/debug/vertex.glsl'),
      loadFile('shaders/debug/fragment.glsl')
    ];

    this.loaded = Promise.all(shadersPromises)
        .then(([vertexShader, fragmentShader]) => {
      this._material = new THREE.RawShaderMaterial({
        uniforms: {
            texture: { value: null },
            mode: { value: 0 },
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
      });

      this._mesh = new THREE.Mesh(this._geometry, this._material);
      this._material.transparent = true;
    });
  }

  // mode: 0 = raw xyz, 1 = normalized depth grayscale.
  draw(renderer, texture, mode = 0) {
    this._material.uniforms['texture'].value = texture;
    this._material.uniforms['mode'].value = mode;

    const oldTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(null);
    renderer.render(this._mesh, this._camera);

    renderer.setRenderTarget(oldTarget);
  }

}

const waterTest = new WaterTest();
const waterSimulation = new WaterSimulation();

const water = new Water();

const environmentMap = new EnvironmentMap();
const environment = new Environment();
const caustics = new Caustics();
const causticsDebug = new CausticsDebug();

const debug = new Debug();

let movingGeometries;


function lerp(a, b, n) {
  return (1 - n) * a + n * b;
}

function lerpColour(c1, c2, n) {
  return [
    Math.round(lerp(c1[0], c2[0], n)),
    Math.round(lerp(c1[1], c2[1], n)),
    Math.round(lerp(c1[2], c2[2], n)),
  ]
}

let waterColourG = {
  fraction: 0,
  increment: 0.0007,
  min: 0.24,
  max: 0.4,
}

let waterColourB = {
  fraction: 0,
  increment: 0.0005,
  min: 0.47,
  max: 0.94,
}

function shiftWaterColour(col){
  col.fraction += col.increment;
  let theta = Math.PI * col.fraction / 10;
  let fraction = 0.5 * Math.cos(theta) + 0.5;
  return lerp(col.min, col.max, fraction);
}


// Main rendering loop
function animate() {
  stats.begin();

  if (!paused) {
    // shark.translate(0.001, 0, 0);
    movingGeometries.forEach(function(obj){
      obj.fraction += obj.increment
      if (obj.fraction > 1) {
        obj.fraction = 0
      }

      obj.newPosition = obj.path.getPoint( obj.fraction );
      obj.tangent = obj.path.getTangent( obj.fraction );
      obj.envMesh.position.copy( obj.newPosition );	
      obj.envMapMesh.position.copy( obj.newPosition );	
      // console.log(environmentMap._meshes[3].position)
      axis.crossVectors( up, obj.tangent ).normalize( );	
      obj.radians = Math.acos( up.dot( obj.tangent ) );
      obj.envMesh.quaternion.setFromAxisAngle( axis, obj.radians );
      obj.envMapMesh.quaternion.setFromAxisAngle( axis, obj.radians );
      obj.envMapMesh.updateMatrixWorld();


      obj.wakeCounter += 1
      if (obj.wakeCounter > 10000) {
        obj.wakeCounter = 0
      }
      if (obj.hasWake & (obj.wakeCounter % 15  == 0)) {
        // console.log("drop")
        const direction = new THREE.Vector3( 0, -1, 0 ).applyQuaternion( obj.envMesh.quaternion ); 
        const rad = obj.envMesh.geometry.boundingSphere.radius
        // console.log("")
        // console.log(obj.newPosition)
        obj.newPosition.add( direction.multiplyScalar( rad ) );
        // console.log(obj.newPosition)
        waterSimulation.addDrop(
          renderer,
          obj.newPosition.x/sclx,
          obj.newPosition.y/sclx,
          0.01,
          -0.02
        )
      }
    })

    environment.updateUnderwaterColour([
      0., 
      shiftWaterColour(waterColourG),
      shiftWaterColour(waterColourB),
    ]);
    // console.log(underwaterColour)

    // Update the water
    if (clock.getElapsedTime() > 0.032) {
    // if (false) {
      waterSimulation.stepSimulation(renderer);

      cachedWaterTexture = waterSimulation.target.texture;

      water.setHeightTexture(cachedWaterTexture);

      environmentMap.render(renderer);
      cachedEnvironmentMapTexture = environmentMap.target.texture;

      caustics.setTextures(cachedWaterTexture, cachedEnvironmentMapTexture);
      caustics.render(renderer);
      cachedCausticsTexture = caustics.target.texture;

      causticsDebug.setTextures(cachedWaterTexture, cachedEnvironmentMapTexture);
      causticsDebug.render(renderer);
      cachedCausticsDebugTexture = causticsDebug.target.texture;

      environment.updateCaustics(cachedCausticsTexture);

      clock.start();
    }
  }

  // Render everything but the refractive water
  renderer.setRenderTarget(temporaryRenderTarget);
  renderer.setClearColor(white, 1);
  renderer.clear();

  water.mesh.visible = false;
  renderer.render(scene, camera);

  water.setEnvMapTexture(temporaryRenderTarget.texture);

  // Then render the final scene with the refractive water
  renderer.setRenderTarget(null);
  renderer.setClearColor(white, 1);
  renderer.clear();

  // waterTest.mesh.visible = true;
  water.mesh.visible = waterVisible;
  renderer.render(scene, camera);

  if (debugView !== 0) {
    const debugTexture = [null, cachedWaterTexture, cachedEnvironmentMapTexture, cachedCausticsTexture, cachedCausticsDebugTexture][debugView];
    // Environment map's xyz isn't informative on its own; show its depth channel instead.
    const debugMode = debugView === 2 ? 1 : 0;
    if (debugTexture) debug.draw(renderer, debugTexture, debugMode);
  }

  controls.update();

  stats.end();



  window.requestAnimationFrame(animate);
}

function onMouseMove(event) {
  const rect = canvas.getBoundingClientRect();

  mouse.x = (event.clientX - rect.left) * 2 / width - 1;
  mouse.y = - (event.clientY - rect.top) * 2 / height + 1;

  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObject(targetmesh);

  if (paused) return;
  for (let intersect of intersects) {
    waterSimulation.addDrop(renderer, intersect.point.x, intersect.point.y, 0.03, 0.01);
  }
}

function vary(val, variance){
  return val + Math.random() * val * variance
}

function waveGen(x, y, radius, strength, interval, variance) {
  var wave = function() {
    // console.log(x, y, radius, strength, interval, variance)
    if (!paused) {
      waterSimulation.addDrop(
        renderer,
        vary(x, variance),
        vary(y, variance),
        vary(radius, variance),
        vary(strength, variance),
      )
    }
    // console.log(Math.floor(vary(interval, variance)))
    setTimeout(wave, Math.floor(vary(interval, variance))) 
  }
  wave()
}

const loaded = [
  waterTest.loaded,
  waterSimulation.loaded,
  water.loaded,
  environmentMap.loaded,
  environment.loaded,
  caustics.loaded,
  causticsDebug.loaded,
  debug.loaded,
  sharkLoaded,
  rockLoaded,
  plantLoaded,
  boatLoaded,
  boat2Loaded,
];

Promise.all(loaded).then(() => {
  // const envGeometries = [roofGeometry, rock1, rock2];
  // const envGeometries = [floorGeometry];
  const envGeometries = [roofGeometry];

  // movingGeometries = [shark, boat1, boat2]
  movingGeometries = [shark]

  environmentMap.setGeometries(envGeometries);
  environment.setGeometries(envGeometries);

  environmentMap.setMovingGeometries(movingGeometries);
  environment.setMovingGeometries(movingGeometries);

  // console.log(environmentMap._meshes)

  // console.log(shark)

  environment.addTo(scene);
  scene.add(water.mesh);
  // scene.add(waterTest.mesh)



  // const material2 = new THREE.LineBasicMaterial({	color: 0x9132a8});
  // const points = shark.path.curves.reduce( ( p, d ) => [...p, ...d.getPoints( 20 )], [] );
  
  // const geometry2 = new THREE.BufferGeometry( ).setFromPoints( points );
  // const liner = new THREE.Line( geometry2, material2 );
  // scene.add(liner);



  caustics.setDeltaEnvTexture(1. / environmentMap.size);
  causticsDebug.setDeltaEnvTexture(1. / environmentMap.size);

  canvas.addEventListener('mousemove', { handleEvent: onMouseMove });

  // for (var i = 0; i < 5; i++) {
  //   waterSimulation.addDrop(
  //     renderer,
  //     Math.random() * 2 - 1, Math.random() * 2 - 1,
  //     0.02, (i & 1) ? 0.1 : -0.1
  //   );
  // }

  // waveGen(-0.7, -0.3, 0.05, 0.5, 30000, 0.1)
  // waveGen(-0.7, 0.3, 0.01, 0.05, 12000, 0.1)
  // waveGen(0.1, 0.6, 0.01, 0.1, 10000, 0.2)
  // waveGen(-0.2, -0.6, 0.01, 0.5, 220000, 0.3)


  // let waveTimer2 = setInterval(function(){
  //   console.log("drop")
  //   waterSimulation.addDrop(
  //     renderer, 
  //     0.8, 
  //     0.2,
  //     0.01, 
  //     0.3)
  // }, 4100)

  animate();
});
