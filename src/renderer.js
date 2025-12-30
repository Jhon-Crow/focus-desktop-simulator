// Focus Desktop Simulator - Main Renderer
// Uses Three.js for 3D isometric desk simulation
// Three.js is loaded locally in index.html (available as global THREE)
// Includes pixel art post-processing effect (Signalis-style)

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  camera: {
    // First-person desk view - looking at a PC desktop from a seated position
    // Near edge (keyboard) is ~2-4 degrees off top-down
    // Far edge (monitor area) is almost parallel to viewer, ~1-2 degrees higher
    fov: 75,  // Wide FOV for realistic first-person desk view
    near: 0.1,
    far: 1000,
    // Position: seated viewer looking down at desk from slightly in front and above
    position: { x: 0, y: 4.5, z: 5.5 },  // Above and in front of desk
    lookAt: { x: 0, y: 0, z: -1.5 }  // Looking at the far edge of the desk
  },
  desk: {
    // Desk surface only (no legs), fills most of the view
    width: 10,
    depth: 7,
    height: 0.1,
    legHeight: 0,  // No legs - like a PC desktop surface
    color: 0x8b6914
  },
  physics: {
    liftHeight: 0.5,
    liftSpeed: 0.15,
    dropSpeed: 0.2,
    gravity: 0.02
  },
  colors: {
    background: 0x1a1a2e,
    ambient: 0x404060,
    directional: 0xffffff,
    ground: 0x2d3748
  },
  // Pixel art post-processing settings (Signalis-style)
  pixelation: {
    enabled: true,
    pixelSize: 4,           // Size of pixels (higher = more pixelated)
    normalEdgeStrength: 0.3, // Edge detection based on normals
    depthEdgeStrength: 0.4   // Edge detection based on depth
  }
};

// ============================================================================
// GLOBAL STATE
// ============================================================================
let scene, camera, renderer;
let desk;
let deskObjects = [];
let selectedObject = null;
let isDragging = false;
let dragPlane;
let raycaster;
let mouse;
let previousMousePosition = { x: 0, y: 0 };
let objectIdCounter = 0;

// Pixel art post-processing state
let pixelRenderTarget, normalRenderTarget;
let pixelatedMaterial, normalMaterial;
let fsQuad, fsCamera, fsGeometry;
let renderResolution = new THREE.Vector2();

// Interaction modal state
let interactionObject = null;
let timerState = {
  active: false,
  running: false,
  remainingSeconds: 0,
  intervalId: null,
  alertAudioCtx: null,
  alertOscillator: null,
  isAlerting: false
};

// Shared audio context for metronome (reuse to avoid lag)
let sharedAudioCtx = null;
function getSharedAudioContext() {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (browsers often suspend audio contexts)
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

// Drag-and-drop state for menu items
let draggedPresetType = null;
let dragPreviewElement = null;

// Drag layer offset - controlled by scroll during drag
// This adds extra height to make objects stack on top of others
let dragLayerOffset = 0;

// Examine mode state (bringing object closer to camera)
let examineState = {
  active: false,
  object: null,
  originalPosition: null,
  originalRotation: null,
  originalScale: null,
  examineDistance: 2.5  // Distance from camera to examined object
};

// Pointer lock state
let pointerLockState = {
  isLocked: false,
  showInstructions: true  // Show instructions on first load
};

// Drawing state (for pen holder interaction)
let drawingState = {
  isDrawing: false,
  selectedPen: null, // Currently held pen color
  selectedPenColor: null, // Hex color value
  currentObject: null, // Object being drawn on (notebook or paper)
  currentLine: null, // Current line being drawn
  points: [] // Points in current line
};

// Laptop control state
let laptopControlState = {
  active: false,
  laptop: null,
  originalCameraPosition: null,
  originalCameraLook: null
};

// Book reading mode state
let bookReadingState = {
  active: false,
  book: null,
  originalCameraPos: null,
  originalCameraYaw: null,
  originalCameraPitch: null,
  middleMouseDownTime: 0,
  holdTimeout: null
};

// Double-click tracking for laptop desktop
let laptopDoubleClickState = {
  lastClickTime: 0,
  lastClickPos: { x: 0, y: 0 },
  doubleClickThreshold: 300 // ms
};

// ============================================================================
// CAMERA CONTROL POINTS (Starting position and direction)
// ============================================================================
// These control points define the default camera state at startup.
// Based on the original camera.lookAt(CONFIG.camera.lookAt) behavior.
// To change the starting view, modify CONFIG.camera.position and CONFIG.camera.lookAt.
function calculateCameraAnglesFromLookAt(cameraPos, lookAtPos) {
  // Calculate direction vector from camera to lookAt point
  const dx = lookAtPos.x - cameraPos.x;
  const dy = lookAtPos.y - cameraPos.y;
  const dz = lookAtPos.z - cameraPos.z;

  // Calculate total length for pitch calculation
  const totalLen = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // yaw: horizontal angle from positive z axis (using atan2 for correct quadrant)
  const yaw = Math.atan2(dx, dz);

  // pitch: vertical angle (negative when looking down)
  const pitch = Math.asin(dy / totalLen);

  return { yaw, pitch };
}

// Calculate default angles from CONFIG control points
const DEFAULT_CAMERA_ANGLES = calculateCameraAnglesFromLookAt(
  CONFIG.camera.position,
  CONFIG.camera.lookAt
);

// First-person camera look state
let cameraLookState = {
  isLooking: true,   // Always enabled by default (FPS-style)
  sensitivity: 0.002,
  // Initial angles calculated from CONFIG.camera.lookAt control point
  yaw: DEFAULT_CAMERA_ANGLES.yaw,     // Horizontal rotation - facing the desk
  pitch: DEFAULT_CAMERA_ANGLES.pitch, // Vertical rotation - looking down at desk surface
  minPitch: -1.32,   // Looking down limit - extended by ~10 degrees more (~76 degrees total)
  maxPitch: 0.42,    // Looking up limit - extended by ~10 degrees more (~24 degrees total)
  // Yaw limits centered around the default yaw (±1.40 radians ~ ±80 degrees)
  // Extended by 10 degrees to reach all desk corners
  minYaw: DEFAULT_CAMERA_ANGLES.yaw - 1.40,  // Limit horizontal rotation to left
  maxYaw: DEFAULT_CAMERA_ANGLES.yaw + 1.40   // Limit horizontal rotation to right
};

// Physics state for objects
const physicsState = {
  enabled: true,
  velocities: new Map(),         // Store velocity for each object (x, z)
  angularVelocities: new Map(),  // Store angular velocity for each object (y-axis spin)
  tiltState: new Map(),          // Store tilt state for each object (x, z tilt angles)
  tiltVelocities: new Map(),     // Store tilt velocity for each object
  lastDragPosition: null,        // Track drag position for velocity calculation
  lastDragTime: 0,               // Track time for velocity calculation
  dragVelocity: { x: 0, z: 0 },  // Velocity of dragged object
  friction: 0.85,
  bounceFactor: 0.4,
  pushForce: 0.04,               // Reduced base push force (was 0.08)
  minPushSpeed: 0.02,            // Minimum drag speed needed to apply full push force
  tiltForce: 0.08,               // Reduced tilt force (was 0.15) - objects harder to tip
  tiltRecovery: 0.08,            // Increased recovery (was 0.05) - objects return upright faster
  maxTilt: Math.PI / 3,          // Maximum tilt before falling over (~60 degrees)
  tipOverThreshold: Math.PI / 4  // Angle at which object tips over completely (~45 degrees)
};

// Object weight/stability configurations (affects how easily they tip)
// baseOffset is the distance from the object's origin to its bottom (for Y position correction when scaling)
const OBJECT_PHYSICS = {
  'clock': { weight: 0.5, stability: 0.5, height: 0.6, baseOffset: 0.35 },      // Light, tall, somewhat tippy
  'lamp': { weight: 1.2, stability: 0.85, height: 0.9, baseOffset: 0 },         // Heavy base, very stable
  'plant': { weight: 1.4, stability: 0.9, height: 0.5, baseOffset: 0 },         // Heavy pot, very stable
  'coffee': { weight: 0.4, stability: 0.6, height: 0.3, baseOffset: 0 },        // Light mug, medium stability
  'laptop': { weight: 1.5, stability: 0.95, height: 0.3, baseOffset: 0 },       // Heavy, flat, very stable
  'notebook': { weight: 0.3, stability: 0.95, height: 0.1, baseOffset: 0 },     // Light, flat, very stable
  'pen-holder': { weight: 0.6, stability: 0.6, height: 0.4, baseOffset: 0 },    // Medium, somewhat stable
  'pen': { weight: 0.05, stability: 0.2, height: 0.35, baseOffset: 0 },         // Very light, can roll
  'books': { weight: 0.8, stability: 0.9, height: 0.15, baseOffset: 0 },        // Book, flat, stable
  'photo-frame': { weight: 0.3, stability: 0.35, height: 0.5, baseOffset: 0.25 },// Light, tall, tips easier
  'globe': { weight: 1.0, stability: 0.7, height: 0.5, baseOffset: 0.025 },     // Medium, balanced
  'trophy': { weight: 0.9, stability: 0.6, height: 0.4, baseOffset: 0 },        // Medium, somewhat stable
  'hourglass': { weight: 0.5, stability: 0.45, height: 0.35, baseOffset: 0.015 },// Light, can tip
  'metronome': { weight: 0.7, stability: 0.7, height: 0.45, baseOffset: 0 },    // Medium, stable pyramid base
  'paper': { weight: 0.05, stability: 0.98, height: 0.01, baseOffset: 0 }       // Very light, lies flat
};

// Adjust object Y position when scaling to keep bottom on desk surface
function adjustObjectYForScale(object, oldScale, newScale) {
  const type = object.userData.type;
  const physics = OBJECT_PHYSICS[type];
  if (!physics || physics.baseOffset === undefined) return;

  // The object's originalY is set for scale=1. When scaling, the bottom moves:
  // At scale 1: bottom is at originalY - baseOffset
  // At scale S: bottom would be at position.y - baseOffset * S
  // To keep bottom at desk: position.y = deskY + baseOffset * S
  const deskY = getDeskSurfaceY();
  const baseOffset = physics.baseOffset;

  // Calculate the original Y position at scale 1 (without the scale adjustment)
  const baseOriginalY = deskY + baseOffset;

  // New Y position should be: deskY + baseOffset * newScale
  const newY = deskY + baseOffset * newScale;

  object.position.y = newY;
  object.userData.originalY = newY;
  object.userData.targetY = newY;
}

// ============================================================================
// INITIALIZATION
// ============================================================================
function init() {
  // Create scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.colors.background);

  // Create camera (first-person desk view)
  // CONTROL POINTS: Position from CONFIG.camera.position, direction from CONFIG.camera.lookAt
  const aspect = window.innerWidth / window.innerHeight;
  camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, aspect, CONFIG.camera.near, CONFIG.camera.far);
  camera.position.set(CONFIG.camera.position.x, CONFIG.camera.position.y, CONFIG.camera.position.z);
  // Apply initial camera look direction based on CONFIG.camera.lookAt control point
  // The yaw/pitch are calculated from the lookAt point in DEFAULT_CAMERA_ANGLES
  updateCameraLook();

  // Create renderer - disable antialiasing for pixel art effect
  renderer = new THREE.WebGLRenderer({ antialias: !CONFIG.pixelation.enabled });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(CONFIG.pixelation.enabled ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  // Setup pixel art post-processing if enabled
  if (CONFIG.pixelation.enabled) {
    setupPixelArtPostProcessing();
  }

  // Create raycaster for mouse interaction
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Create invisible drag plane
  const planeGeometry = new THREE.PlaneGeometry(100, 100);
  const planeMaterial = new THREE.MeshBasicMaterial({ visible: false });
  dragPlane = new THREE.Mesh(planeGeometry, planeMaterial);
  dragPlane.rotation.x = -Math.PI / 2;
  dragPlane.position.y = CONFIG.desk.height;  // No legs, just surface
  scene.add(dragPlane);

  // Setup lighting
  setupLighting();

  // Create desk
  createDesk();

  // Create floor
  createFloor();

  // Setup event listeners
  setupEventListeners();

  // Initialize previousMousePosition to screen center to prevent jump on first move
  previousMousePosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  // Load saved state
  loadState();

  // Start animation loop
  animate();

  // Start clock update
  updateClock();
  setInterval(updateClock, 1000);

  // Hide loading screen
  setTimeout(() => {
    document.getElementById('loading').classList.add('hidden');
  }, 500);
}

// ============================================================================
// PIXEL ART POST-PROCESSING SETUP (Signalis-style)
// ============================================================================
function setupPixelArtPostProcessing() {
  const pixelSize = CONFIG.pixelation.pixelSize;

  // Calculate render resolution (lower resolution for pixel art effect)
  const width = Math.floor(window.innerWidth / pixelSize);
  const height = Math.floor(window.innerHeight / pixelSize);
  renderResolution.set(width, height);

  // Create render target for the main scene (low resolution)
  pixelRenderTarget = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType
  });
  pixelRenderTarget.depthTexture = new THREE.DepthTexture(width, height);

  // Create render target for normals (for edge detection)
  normalRenderTarget = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType
  });

  // Material for rendering normals
  normalMaterial = new THREE.MeshNormalMaterial();

  // Create fullscreen quad for post-processing
  fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  fsGeometry = new THREE.BufferGeometry();
  fsGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  fsGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));

  // Create the pixelated shader material
  pixelatedMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      tNormal: { value: null },
      resolution: { value: new THREE.Vector4(width, height, 1 / width, 1 / height) },
      normalEdgeStrength: { value: CONFIG.pixelation.normalEdgeStrength },
      depthEdgeStrength: { value: CONFIG.pixelation.depthEdgeStrength }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      uniform sampler2D tNormal;
      uniform vec4 resolution;
      uniform float normalEdgeStrength;
      uniform float depthEdgeStrength;
      varying vec2 vUv;

      float getDepth(int x, int y) {
        return texture2D(tDepth, vUv + vec2(x, y) * resolution.zw).r;
      }

      vec3 getNormal(int x, int y) {
        return texture2D(tNormal, vUv + vec2(x, y) * resolution.zw).rgb * 2.0 - 1.0;
      }

      float depthEdgeIndicator(float depth, vec3 normal) {
        float diff = 0.0;
        diff += clamp(getDepth(1, 0) - depth, 0.0, 1.0);
        diff += clamp(getDepth(-1, 0) - depth, 0.0, 1.0);
        diff += clamp(getDepth(0, 1) - depth, 0.0, 1.0);
        diff += clamp(getDepth(0, -1) - depth, 0.0, 1.0);
        return floor(smoothstep(0.01, 0.02, diff) * 2.0) / 2.0;
      }

      float neighborNormalEdgeIndicator(int x, int y, float depth, vec3 normal) {
        float depthDiff = getDepth(x, y) - depth;
        vec3 neighborNormal = getNormal(x, y);
        vec3 normalEdgeBias = vec3(1.0, 1.0, 1.0);
        float normalDiff = dot(normal - neighborNormal, normalEdgeBias);
        float normalIndicator = clamp(smoothstep(-0.01, 0.01, normalDiff), 0.0, 1.0);
        float depthIndicator = clamp(sign(depthDiff * 0.25 + 0.0025), 0.0, 1.0);
        return (1.0 - dot(normal, neighborNormal)) * depthIndicator * normalIndicator;
      }

      float normalEdgeIndicator(float depth, vec3 normal) {
        float indicator = 0.0;
        indicator += neighborNormalEdgeIndicator(0, -1, depth, normal);
        indicator += neighborNormalEdgeIndicator(0, 1, depth, normal);
        indicator += neighborNormalEdgeIndicator(-1, 0, depth, normal);
        indicator += neighborNormalEdgeIndicator(1, 0, depth, normal);
        return step(0.1, indicator);
      }

      void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        float depth = 0.0;
        vec3 normal = vec3(0.0);

        if (depthEdgeStrength > 0.0 || normalEdgeStrength > 0.0) {
          depth = getDepth(0, 0);
          normal = getNormal(0, 0);
        }

        float dei = 0.0;
        if (depthEdgeStrength > 0.0) {
          dei = depthEdgeIndicator(depth, normal);
        }

        float nei = 0.0;
        if (normalEdgeStrength > 0.0) {
          nei = normalEdgeIndicator(depth, normal);
        }

        // Apply edge darkening for that crisp pixel art outline look
        float edgeFactor = dei > 0.0 ? (1.0 - depthEdgeStrength * dei) : (1.0 + normalEdgeStrength * nei);

        gl_FragColor = texel * edgeFactor;
      }
    `
  });

  fsQuad = new THREE.Mesh(fsGeometry, pixelatedMaterial);
}

function updatePixelArtRenderTargets() {
  if (!CONFIG.pixelation.enabled) return;

  const pixelSize = CONFIG.pixelation.pixelSize;
  const width = Math.floor(window.innerWidth / pixelSize);
  const height = Math.floor(window.innerHeight / pixelSize);
  renderResolution.set(width, height);

  pixelRenderTarget.setSize(width, height);
  normalRenderTarget.setSize(width, height);

  pixelatedMaterial.uniforms.resolution.value.set(width, height, 1 / width, 1 / height);
}

// ============================================================================
// LIGHTING SETUP
// ============================================================================
function setupLighting() {
  // Ambient light for overall illumination
  const ambientLight = new THREE.AmbientLight(CONFIG.colors.ambient, 0.6);
  scene.add(ambientLight);

  // Main directional light (sun-like)
  const directionalLight = new THREE.DirectionalLight(CONFIG.colors.directional, 0.8);
  directionalLight.position.set(5, 10, 7);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 50;
  directionalLight.shadow.camera.left = -10;
  directionalLight.shadow.camera.right = 10;
  directionalLight.shadow.camera.top = 10;
  directionalLight.shadow.camera.bottom = -10;
  scene.add(directionalLight);

  // Secondary fill light
  const fillLight = new THREE.DirectionalLight(0x6366f1, 0.3);
  fillLight.position.set(-5, 5, -5);
  scene.add(fillLight);

  // Subtle rim light
  const rimLight = new THREE.DirectionalLight(0xf472b6, 0.2);
  rimLight.position.set(0, 3, -10);
  scene.add(rimLight);
}

// ============================================================================
// DESK CREATION
// ============================================================================
function createDesk() {
  const deskGroup = new THREE.Group();

  // Desktop surface - flat like a PC desktop view
  const topGeometry = new THREE.BoxGeometry(CONFIG.desk.width, CONFIG.desk.height, CONFIG.desk.depth);
  const topMaterial = new THREE.MeshStandardMaterial({
    color: CONFIG.desk.color,
    roughness: 0.7,
    metalness: 0.1
  });
  const deskTop = new THREE.Mesh(topGeometry, topMaterial);
  deskTop.position.y = CONFIG.desk.height / 2;
  deskTop.castShadow = true;
  deskTop.receiveShadow = true;
  deskGroup.add(deskTop);

  // No legs - this is a top-down view like a PC desktop

  desk = deskGroup;
  scene.add(desk);
}

// ============================================================================
// FLOOR CREATION
// ============================================================================
function createFloor() {
  const floorGeometry = new THREE.PlaneGeometry(20, 20);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.ground,
    roughness: 0.9,
    metalness: 0
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}

// ============================================================================
// PRESET OBJECT CREATION
// ============================================================================
const PRESET_CREATORS = {
  clock: createClock,
  lamp: createLamp,
  plant: createPlant,
  coffee: createCoffeeMug,
  laptop: createLaptop,
  notebook: createNotebook,
  'pen-holder': createPenHolder,
  pen: createPen,
  books: createBooks,
  'photo-frame': createPhotoFrame,
  globe: createGlobe,
  trophy: createTrophy,
  hourglass: createHourglass,
  paper: createPaper,
  metronome: createMetronome
};

function createClock(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'clock',
    name: 'Clock',
    interactive: true,
    mainColor: options.mainColor || '#ffffff',
    accentColor: options.accentColor || '#1e293b'
  };

  // Clock body (frame)
  const bodyGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 32);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.3,
    metalness: 0.5
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  group.add(body);

  // Clock face (white background)
  const faceGeometry = new THREE.CircleGeometry(0.35, 32);
  const faceMaterial = new THREE.MeshStandardMaterial({
    color: 0xfafafa,
    roughness: 0.5
  });
  const face = new THREE.Mesh(faceGeometry, faceMaterial);
  face.position.z = 0.051;
  group.add(face);

  // Add hour markers (12 small dots around the dial)
  const markerMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.3,
    metalness: 0.5
  });

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2; // Start at 12 o'clock
    const radius = 0.28;
    const markerSize = (i % 3 === 0) ? 0.025 : 0.015; // Larger markers at 12, 3, 6, 9

    const markerGeometry = new THREE.CircleGeometry(markerSize, 8);
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0.052
    );
    group.add(marker);
  }

  // Hand material
  const handMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.3,
    metalness: 0.7
  });

  // Hour hand - pivot group (rotates around center)
  const hourPivot = new THREE.Group();
  hourPivot.name = 'hourHand';
  hourPivot.position.z = 0.06;

  // Hour hand geometry (offset so one end is at pivot)
  const hourGeometry = new THREE.BoxGeometry(0.035, 0.15, 0.02);
  const hourHand = new THREE.Mesh(hourGeometry, handMaterial);
  hourHand.position.y = 0.075; // Half the length, so it pivots from one end
  hourPivot.add(hourHand);
  group.add(hourPivot);

  // Minute hand - pivot group
  const minutePivot = new THREE.Group();
  minutePivot.name = 'minuteHand';
  minutePivot.position.z = 0.07;

  // Minute hand geometry
  const minuteGeometry = new THREE.BoxGeometry(0.025, 0.22, 0.02);
  const minuteHand = new THREE.Mesh(minuteGeometry, handMaterial);
  minuteHand.position.y = 0.11; // Half the length
  minutePivot.add(minuteHand);
  group.add(minutePivot);

  // Second hand - pivot group
  const secondPivot = new THREE.Group();
  secondPivot.name = 'secondHand';
  secondPivot.position.z = 0.08;

  const secondMaterial = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    roughness: 0.3,
    metalness: 0.5
  });

  // Second hand geometry
  const secondGeometry = new THREE.BoxGeometry(0.012, 0.26, 0.01);
  const secondHand = new THREE.Mesh(secondGeometry, secondMaterial);
  secondHand.position.y = 0.13; // Half the length
  secondPivot.add(secondHand);
  group.add(secondPivot);

  // Center dot (covers pivot point)
  const centerGeometry = new THREE.SphereGeometry(0.035, 16, 16);
  const centerMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.2,
    metalness: 0.8
  });
  const center = new THREE.Mesh(centerGeometry, centerMaterial);
  center.position.z = 0.09;
  group.add(center);

  // Stand
  const standGeometry = new THREE.BoxGeometry(0.1, 0.3, 0.2);
  const standMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.4,
    metalness: 0.3
  });
  const stand = new THREE.Mesh(standGeometry, standMaterial);
  stand.position.y = -0.15;
  stand.castShadow = true;
  group.add(stand);

  // Rotate to stand upright on desk
  group.rotation.x = -Math.PI / 6;
  group.position.y = getDeskSurfaceY() + 0.35;

  return group;
}

function createLamp(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'lamp',
    name: 'Desk Lamp',
    interactive: true,
    isOn: true,
    mainColor: options.mainColor || '#64748b',
    accentColor: options.accentColor || '#fbbf24'
  };

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.9,   // Very rough = no glare
    metalness: 0.0    // No metalness = no reflections
  });

  // Heavy circular base for stability
  const baseGeometry = new THREE.CylinderGeometry(0.25, 0.28, 0.05, 32);
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.025;
  base.castShadow = true;
  group.add(base);

  // Vertical post from base
  const postGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.15, 16);
  const post = new THREE.Mesh(postGeometry, baseMaterial);
  post.position.y = 0.125;
  post.castShadow = true;
  group.add(post);

  // First angled arm segment (going up and forward at ~60 degrees)
  const arm1Group = new THREE.Group();
  arm1Group.position.set(0, 0.2, 0);
  arm1Group.rotation.z = -Math.PI / 6;  // Tilt forward ~30 degrees

  const arm1Geometry = new THREE.CylinderGeometry(0.015, 0.015, 0.45, 16);
  const arm1 = new THREE.Mesh(arm1Geometry, baseMaterial);
  arm1.position.y = 0.225;  // Center of arm
  arm1.castShadow = true;
  arm1Group.add(arm1);

  // Joint at top of first arm
  const joint1Geometry = new THREE.SphereGeometry(0.025, 16, 16);
  const joint1 = new THREE.Mesh(joint1Geometry, baseMaterial);
  joint1.position.y = 0.45;
  arm1Group.add(joint1);

  group.add(arm1Group);

  // Second arm segment (angled to bring lamp head forward)
  const arm2Group = new THREE.Group();
  // Position at the joint of first arm (accounting for arm1Group rotation)
  arm2Group.position.set(0.225, 0.59, 0);
  arm2Group.rotation.z = Math.PI / 4;  // Angle back ~45 degrees

  const arm2Geometry = new THREE.CylinderGeometry(0.015, 0.015, 0.35, 16);
  const arm2 = new THREE.Mesh(arm2Geometry, baseMaterial);
  arm2.position.y = 0.175;
  arm2.castShadow = true;
  arm2Group.add(arm2);

  group.add(arm2Group);

  // Lamp head (round shade pointing down at ~4-10 degree angle)
  const headGroup = new THREE.Group();
  // Position at end of second arm
  headGroup.position.set(0.35, 0.83, 0);
  // Rotate to point slightly forward and down (~7 degrees from vertical)
  headGroup.rotation.z = Math.PI / 25;  // ~7.2 degrees forward tilt

  // Outer shade (dome shape) - dome curving over top, open at bottom
  // Use the TOP hemisphere (thetaStart=0, thetaLength=π/2) - from north pole to equator
  // This creates a dome that curves from top down to the rim, with opening facing down
  const shadeGeometry = new THREE.SphereGeometry(0.15, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const shade = new THREE.Mesh(shadeGeometry, baseMaterial);
  // Position the shade so the opening (equator) is at y=0 and dome curves upward from there
  shade.position.y = 0;
  shade.castShadow = true;
  headGroup.add(shade);

  // Shade rim
  const rimGeometry = new THREE.TorusGeometry(0.15, 0.01, 8, 32);
  const rim = new THREE.Mesh(rimGeometry, baseMaterial);
  rim.rotation.x = Math.PI / 2;
  headGroup.add(rim);

  // Light bulb (round, visible from below)
  const bulbGeometry = new THREE.SphereGeometry(0.08, 16, 16);
  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    emissive: new THREE.Color(group.userData.accentColor),
    emissiveIntensity: 1.5,
    roughness: 0.2
  });
  const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
  bulb.position.y = -0.05;  // Slightly below shade rim
  bulb.name = 'bulb';
  headGroup.add(bulb);

  // SpotLight for focused beam - brighter main light
  const spotLight = new THREE.SpotLight(
    new THREE.Color(group.userData.accentColor),
    6.0,           // Increased intensity for brighter beam (was 3.5)
    8,             // Increased distance (was 6)
    Math.PI / 3.5, // Wider cone angle (~51 degrees) for broader spotlight
    0.3,           // Slightly sharper edge for more defined beam
    1.2            // Less decay for brighter far reach
  );
  spotLight.position.set(0, -0.08, 0);
  // Target point straight down to illuminate desk area
  spotLight.target.position.set(0.3, -1.0, 0);
  spotLight.castShadow = true;
  spotLight.shadow.mapSize.width = 512;
  spotLight.shadow.mapSize.height = 512;
  spotLight.name = 'lampSpotLight';
  headGroup.add(spotLight);
  headGroup.add(spotLight.target);

  // Point light for residual illumination of the entire desk
  const ambientLight = new THREE.PointLight(
    new THREE.Color(group.userData.accentColor),
    1.2,    // Increased intensity (was 0.6) for better desk coverage
    12,     // Increased range to cover entire desk (was 6)
    1.5     // Less decay for wider spread
  );
  ambientLight.position.set(0, -0.05, 0);
  ambientLight.name = 'lampLight';
  headGroup.add(ambientLight);

  // Hemisphere light for ambient glow on the entire desk and surroundings
  const hemisphereLight = new THREE.HemisphereLight(
    new THREE.Color(group.userData.accentColor),
    0x000000,
    0.4     // Increased from 0.2 for more ambient illumination
  );
  hemisphereLight.position.set(0, -0.05, 0);
  hemisphereLight.name = 'lampAmbient';
  headGroup.add(hemisphereLight);

  group.add(headGroup);

  group.position.y = getDeskSurfaceY();

  return group;
}

function createPlant(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'plant',
    name: 'Potted Plant',
    interactive: false,
    mainColor: options.mainColor || '#92400e',
    accentColor: options.accentColor || '#22c55e'
  };

  // Pot
  const potGeometry = new THREE.CylinderGeometry(0.18, 0.14, 0.25, 16);
  const potMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.8
  });
  const pot = new THREE.Mesh(potGeometry, potMaterial);
  pot.position.y = 0.125;
  pot.castShadow = true;
  group.add(pot);

  // Soil
  const soilGeometry = new THREE.CylinderGeometry(0.16, 0.16, 0.05, 16);
  const soilMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d2914,
    roughness: 1
  });
  const soil = new THREE.Mesh(soilGeometry, soilMaterial);
  soil.position.y = 0.225;
  group.add(soil);

  // Plant leaves (simple spheres)
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.6
  });

  for (let i = 0; i < 5; i++) {
    const leafGeometry = new THREE.SphereGeometry(0.12 + Math.random() * 0.05, 8, 8);
    const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
    const angle = (i / 5) * Math.PI * 2;
    const radius = 0.08;
    leaf.position.set(
      Math.cos(angle) * radius,
      0.35 + Math.random() * 0.1,
      Math.sin(angle) * radius
    );
    leaf.scale.y = 1.2;
    leaf.castShadow = true;
    group.add(leaf);
  }

  group.position.y = getDeskSurfaceY();

  return group;
}

// Drink color presets
const DRINK_COLORS = {
  coffee: { color: 0x3d2914, name: 'Coffee' },
  tea: { color: 0x8b4513, name: 'Tea' },
  water: { color: 0x87ceeb, name: 'Water' },
  milk: { color: 0xfffaf0, name: 'Milk' },
  juice: { color: 0xffa500, name: 'Orange Juice' }
};

function createCoffeeMug(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'coffee',
    name: 'Coffee Mug',
    interactive: true, // Now interactive - sipping in examine mode
    drinkType: 'coffee',
    liquidLevel: 1.0, // 0-1, how full the mug is
    maxLiquidLevel: 1.0, // Store the starting level for display
    isHot: true, // Shows steam if true
    wavePhase: 0,
    isSipping: false, // Animation state
    isCheckingEmpty: false, // Animation state for looking at empty mug
    mainColor: options.mainColor || '#ffffff',
    accentColor: options.accentColor || '#3b82f6'
  };

  // Mug body - open cylinder (no top cap) to show liquid inside
  // Using openEnded=true creates a hollow cylinder without top/bottom caps
  const mugOuterGeometry = new THREE.CylinderGeometry(0.12, 0.1, 0.2, 32, 1, true);
  const mugMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.4,
    metalness: 0.1,
    side: THREE.DoubleSide // Visible from both inside and outside
  });
  const mugOuter = new THREE.Mesh(mugOuterGeometry, mugMaterial);
  mugOuter.position.y = 0.1;
  mugOuter.castShadow = true;
  group.add(mugOuter);

  // Mug bottom (solid base)
  const mugBottomGeometry = new THREE.CircleGeometry(0.1, 32);
  const mugBottom = new THREE.Mesh(mugBottomGeometry, mugMaterial);
  mugBottom.rotation.x = -Math.PI / 2;
  mugBottom.position.y = 0.001; // Just above desk
  group.add(mugBottom);

  // Mug inner wall (slightly smaller to give wall thickness)
  const mugInnerGeometry = new THREE.CylinderGeometry(0.095, 0.08, 0.19, 32, 1, true);
  const mugInnerMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor).multiplyScalar(0.9), // Slightly darker inside
    roughness: 0.5,
    metalness: 0.05,
    side: THREE.BackSide // Only visible from inside
  });
  const mugInner = new THREE.Mesh(mugInnerGeometry, mugInnerMaterial);
  mugInner.position.y = 0.105;
  group.add(mugInner);

  // Mug rim (top edge)
  const rimGeometry = new THREE.TorusGeometry(0.11, 0.012, 8, 32);
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.3,
    metalness: 0.2
  });
  const rim = new THREE.Mesh(rimGeometry, rimMaterial);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.2;
  group.add(rim);

  // Handle - torus arc that sticks out from the mug side (vertical "D" shape)
  // TorusGeometry(radius, tube, radialSegments, tubularSegments, arc)
  // radius=0.05 makes a smaller arc, tube=0.015 is the thickness
  const handleGeometry = new THREE.TorusGeometry(0.05, 0.015, 8, 16, Math.PI);
  const handleMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.4
  });
  const handle = new THREE.Mesh(handleGeometry, handleMaterial);
  // The torus is flat in XY plane by default, arc opens upward (like a smile ∩)
  // We want a vertical "D" shape handle that sticks out horizontally from the mug:
  // - The "D" loop should be in a vertical plane (perpendicular to table)
  // - The handle should stick out to the side (along Z axis)
  // Default torus is in XY plane (vertical), which is correct for the "D" shape
  // Rotate 90° around Y to orient the arc to stick out along Z axis
  handle.rotation.y = Math.PI / 2;  // Rotate so handle sticks out along Z axis
  // Position: mug outer radius ~0.12, handle arc radius 0.05
  // Place handle center at mug edge + handle radius so both ends touch mug
  handle.position.set(0, 0.1, 0.12 + 0.05); // Center at mug side (Z), plus handle radius offset
  handle.castShadow = true;
  group.add(handle);

  // Liquid surface - flat disc that fills the mug interior
  // Using a disc geometry so it's visible from above looking into the mug
  const liquidGeometry = new THREE.CircleGeometry(0.085, 32);
  const liquidMaterial = new THREE.MeshStandardMaterial({
    color: DRINK_COLORS.coffee.color,
    roughness: 0.2,
    metalness: 0.3,
    side: THREE.DoubleSide // Visible from both sides
  });
  const liquid = new THREE.Mesh(liquidGeometry, liquidMaterial);
  liquid.name = 'liquid';
  liquid.rotation.x = -Math.PI / 2; // Lay flat
  liquid.position.y = 0.15; // Positioned inside the mug, slightly below rim
  group.add(liquid);

  // Liquid body (the depth of the liquid) - cylinder below the surface
  const liquidBodyGeometry = new THREE.CylinderGeometry(0.085, 0.075, 0.12, 32, 1, true);
  const liquidBodyMaterial = new THREE.MeshStandardMaterial({
    color: DRINK_COLORS.coffee.color,
    roughness: 0.3,
    metalness: 0.2,
    side: THREE.DoubleSide
  });
  const liquidBody = new THREE.Mesh(liquidBodyGeometry, liquidBodyMaterial);
  liquidBody.name = 'liquidBody';
  liquidBody.position.y = 0.09; // Below the surface
  group.add(liquidBody);

  // Decorative stripe
  const stripeGeometry = new THREE.CylinderGeometry(0.121, 0.121, 0.04, 32, 1, true);
  const stripeMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.4
  });
  const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial);
  stripe.position.y = 0.1;
  group.add(stripe);

  group.position.y = getDeskSurfaceY();

  return group;
}

function createLaptop(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'laptop',
    name: 'Laptop',
    interactive: true,
    isOn: false, // Power state
    isBooting: false, // Boot animation in progress
    bootProgress: 0, // 0-1 boot progress
    bootTime: options.bootTime || 4000, // Boot time in ms (default 4 seconds)
    screenState: 'off', // 'off', 'bios', 'loading', 'desktop'
    isZoomedIn: false, // Whether user is in laptop control mode
    editorContent: '', // Markdown editor content
    editorFileName: 'notes.md',
    mainColor: options.mainColor || '#1e293b',
    accentColor: options.accentColor || '#60a5fa',
    bootScreenDataUrl: null, // Custom boot screen image data URL
    powerButtonColor: options.powerButtonColor || '#555555', // Power button color
    powerLedColor: options.powerLedColor || '#00ff00' // Power LED on color
  };

  // Base/keyboard part
  const baseGeometry = new THREE.BoxGeometry(0.8, 0.03, 0.5);
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.3,
    metalness: 0.7
  });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.015;
  base.castShadow = true;
  group.add(base);

  // Screen
  const screenGroup = new THREE.Group();
  screenGroup.name = 'screenGroup';

  const screenBackGeometry = new THREE.BoxGeometry(0.78, 0.5, 0.02);
  const screenBack = new THREE.Mesh(screenBackGeometry, baseMaterial);
  screenBack.castShadow = true;
  screenGroup.add(screenBack);

  // Screen display (starts black/off)
  const displayGeometry = new THREE.PlaneGeometry(0.7, 0.42);
  const displayMaterial = new THREE.MeshStandardMaterial({
    color: 0x000000, // Black when off
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.1
  });
  const display = new THREE.Mesh(displayGeometry, displayMaterial);
  display.position.z = 0.011;
  display.name = 'screen';
  screenGroup.add(display);

  screenGroup.position.set(0, 0.28, -0.23);
  screenGroup.rotation.x = -Math.PI / 6;
  group.add(screenGroup);

  // Keyboard area
  const keyboardGeometry = new THREE.PlaneGeometry(0.6, 0.35);
  const keyboardMaterial = new THREE.MeshStandardMaterial({
    color: 0x374151,
    roughness: 0.8
  });
  const keyboard = new THREE.Mesh(keyboardGeometry, keyboardMaterial);
  keyboard.rotation.x = -Math.PI / 2;
  keyboard.position.y = 0.031;
  keyboard.position.z = 0.05;
  keyboard.name = 'keyboard';
  group.add(keyboard);

  // Power button (in top right corner of keyboard area)
  const powerBtnGeometry = new THREE.CylinderGeometry(0.015, 0.015, 0.005, 16);
  const powerBtnMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.powerButtonColor),
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.3,
    metalness: 0.5
  });
  const powerButton = new THREE.Mesh(powerBtnGeometry, powerBtnMaterial);
  powerButton.rotation.x = -Math.PI / 2;
  powerButton.position.set(0.35, 0.032, -0.18);
  powerButton.name = 'powerButton';
  group.add(powerButton);

  // Power LED indicator
  const ledGeometry = new THREE.CircleGeometry(0.005, 8);
  const ledMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    emissive: 0x000000,
    emissiveIntensity: 0
  });
  const powerLed = new THREE.Mesh(ledGeometry, ledMaterial);
  powerLed.rotation.x = -Math.PI / 2;
  powerLed.position.set(0.35, 0.033, -0.15);
  powerLed.name = 'powerLed';
  group.add(powerLed);

  group.position.y = getDeskSurfaceY();

  return group;
}

function createNotebook(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'notebook',
    name: 'Notebook',
    interactive: true, // Interactive - can draw with pen
    drawingLines: [], // Array of drawing line data
    fileName: options.fileName || 'notebook.png',
    mainColor: options.mainColor || '#3b82f6',
    accentColor: options.accentColor || '#ffffff'
  };

  // Cover
  const coverGeometry = new THREE.BoxGeometry(0.4, 0.03, 0.55);
  const coverMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.6
  });
  const cover = new THREE.Mesh(coverGeometry, coverMaterial);
  cover.position.y = 0.015;
  cover.castShadow = true;
  group.add(cover);

  // Pages
  const pagesGeometry = new THREE.BoxGeometry(0.38, 0.025, 0.53);
  const pagesMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.9
  });
  const pages = new THREE.Mesh(pagesGeometry, pagesMaterial);
  pages.position.y = 0.0375;
  group.add(pages);

  // Spine detail
  const spineGeometry = new THREE.BoxGeometry(0.03, 0.055, 0.55);
  const spine = new THREE.Mesh(spineGeometry, coverMaterial);
  spine.position.set(-0.185, 0.0275, 0);
  group.add(spine);

  group.position.y = getDeskSurfaceY();

  return group;
}

function createPenHolder(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'pen-holder',
    name: 'Pen Holder',
    interactive: false, // Just a container now
    mainColor: options.mainColor || '#64748b',
    accentColor: options.accentColor || '#f472b6'
  };

  // Holder cup (open cylinder)
  const holderGeometry = new THREE.CylinderGeometry(0.12, 0.1, 0.25, 16, 1, true);
  const holderMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.3,
    metalness: 0.6,
    side: THREE.DoubleSide
  });
  const holder = new THREE.Mesh(holderGeometry, holderMaterial);
  holder.position.y = 0.125;
  holder.castShadow = true;
  group.add(holder);

  // Bottom
  const bottomGeometry = new THREE.CircleGeometry(0.1, 16);
  const bottom = new THREE.Mesh(bottomGeometry, holderMaterial);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.001;
  group.add(bottom);

  // Inner ring at top for visual depth
  const rimGeometry = new THREE.TorusGeometry(0.11, 0.01, 8, 32);
  const rim = new THREE.Mesh(rimGeometry, holderMaterial);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.25;
  group.add(rim);

  group.position.y = getDeskSurfaceY();

  return group;
}

// Individual pen as a separate desk object
function createPen(options = {}) {
  const group = new THREE.Group();

  // Default pen colors available
  const penColors = {
    red: 0xef4444,
    blue: 0x3b82f6,
    green: 0x22c55e,
    black: 0x1a1a1a,
    purple: 0x8b5cf6,
    orange: 0xf97316
  };

  const penColor = options.penColor || 'blue';
  const colorHex = penColors[penColor] || penColors.blue;

  group.userData = {
    type: 'pen',
    name: `${penColor.charAt(0).toUpperCase() + penColor.slice(1)} Pen`,
    interactive: false,
    penColor: penColor,
    mainColor: options.mainColor || `#${colorHex.toString(16).padStart(6, '0')}`,
    accentColor: options.accentColor || '#d4d4d4',
    inkColor: options.inkColor || `#${colorHex.toString(16).padStart(6, '0')}`,
    colorHex: colorHex
  };

  // Create a sub-group for pen parts so we can pivot around the cap
  // When dragging, we rotate this subgroup, keeping the cap anchored
  const penBody = new THREE.Group();
  penBody.name = 'penBody';

  // Cap position is the anchor point (will be at Y=0)
  const capY = 0; // Cap at origin for pivot

  // Pen body - offset from cap
  const bodyGeometry = new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.4,
    metalness: 0.2
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = capY - 0.175; // Body center below cap
  body.castShadow = true;
  penBody.add(body);

  // Pen tip (silver/metallic) - furthest from cap
  const tipGeometry = new THREE.ConeGeometry(0.012, 0.04, 8);
  const tipMaterial = new THREE.MeshStandardMaterial({
    color: 0xc0c0c0,
    roughness: 0.2,
    metalness: 0.8
  });
  const tip = new THREE.Mesh(tipGeometry, tipMaterial);
  tip.position.y = capY - 0.345; // Tip at bottom
  tip.rotation.x = Math.PI; // Point down
  penBody.add(tip);

  // Pen cap - at anchor point
  const capGeometry = new THREE.CylinderGeometry(0.013, 0.013, 0.05, 8);
  const cap = new THREE.Mesh(capGeometry, bodyMaterial);
  cap.position.y = capY; // Cap at pivot
  penBody.add(cap);

  // Clip on cap
  const clipGeometry = new THREE.BoxGeometry(0.003, 0.04, 0.015);
  const clipMaterial = new THREE.MeshStandardMaterial({
    color: 0xc0c0c0,
    roughness: 0.2,
    metalness: 0.8
  });
  const clip = new THREE.Mesh(clipGeometry, clipMaterial);
  clip.position.set(0.014, capY - 0.005, 0);
  penBody.add(clip);

  group.add(penBody);

  // Rotate pen to lie flat on the desk (along X axis)
  // The pen lies with cap toward +X, tip toward -X
  group.rotation.z = -Math.PI / 2;
  // Position so the pen sits on the desk surface
  // After rotation, the pen's radius determines the height above desk
  group.position.y = getDeskSurfaceY() + 0.015; // Raise by pen radius

  return group;
}

function createBooks(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'books',
    name: 'Book',
    interactive: true, // Interactive - can open to view PDF
    isOpen: false, // Whether book is open
    openAngle: 0, // Animation angle
    bookTitle: options.bookTitle || 'My Book',
    titleColor: options.titleColor || '#ffffff', // Title text color
    pdfPath: null, // Path to PDF file
    currentPage: 0, // Current page index
    totalPages: 0, // Total number of pages
    mainColor: options.mainColor || '#7c3aed',
    accentColor: options.accentColor || '#f59e0b'
  };

  // Book closed group (visible when closed)
  const closedGroup = new THREE.Group();
  closedGroup.name = 'closedBook';

  // Single book model - Book cover
  const coverMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.7
  });

  const coverGeometry = new THREE.BoxGeometry(0.28, 0.04, 0.38);
  const cover = new THREE.Mesh(coverGeometry, coverMaterial);
  cover.position.y = 0.02;
  cover.castShadow = true;
  closedGroup.add(cover);

  // Pages (white interior)
  const pagesMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5f5f0,
    roughness: 0.9
  });

  const pagesGeometry = new THREE.BoxGeometry(0.26, 0.035, 0.36);
  const pages = new THREE.Mesh(pagesGeometry, pagesMaterial);
  pages.position.y = 0.02;
  closedGroup.add(pages);

  // Spine detail
  const spineMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.6
  });

  const spineGeometry = new THREE.BoxGeometry(0.02, 0.045, 0.38);
  const spine = new THREE.Mesh(spineGeometry, spineMaterial);
  spine.position.set(-0.13, 0.02, 0);
  spine.castShadow = true;
  closedGroup.add(spine);

  // Title on cover (rendered as texture with actual text)
  // Font size increased from 24 to 32 for better readability
  const createTitleTexture = (title, width, height, fontSize) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Background matches accent color
    const accentHex = group.userData.accentColor;
    ctx.fillStyle = accentHex;
    ctx.fillRect(0, 0, width, height);

    // Text styling - use configurable title color
    ctx.fillStyle = group.userData.titleColor || '#ffffff';
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw title text (centered)
    ctx.fillText(title, width / 2, height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  };

  // Cover title - doubled font size from 32 to 64 for better readability
  const coverTitleGeometry = new THREE.PlaneGeometry(0.22, 0.08);
  const coverTitleTexture = createTitleTexture(group.userData.bookTitle, 320, 116, 64);
  const coverTitleMaterial = new THREE.MeshStandardMaterial({
    map: coverTitleTexture,
    roughness: 0.5
  });
  const coverTitle = new THREE.Mesh(coverTitleGeometry, coverTitleMaterial);
  coverTitle.rotation.x = -Math.PI / 2;
  coverTitle.position.set(0.02, 0.041, 0);
  coverTitle.name = 'coverTitle';
  closedGroup.add(coverTitle);

  // Spine title removed per user feedback - spine is now plain accent color

  // Store the createTitleTexture function for later updates
  group.userData.createTitleTexture = createTitleTexture;

  group.add(closedGroup);

  // Book open group (visible when open)
  const openGroup = new THREE.Group();
  openGroup.name = 'openBook';
  openGroup.visible = false;

  // Left page (cover rotated back)
  const leftCoverGeometry = new THREE.BoxGeometry(0.28, 0.005, 0.38);
  const leftCover = new THREE.Mesh(leftCoverGeometry, coverMaterial);
  leftCover.position.set(-0.14, 0.003, 0);
  leftCover.name = 'leftCover';
  openGroup.add(leftCover);

  // Right page (cover rotated back)
  const rightCover = new THREE.Mesh(leftCoverGeometry, coverMaterial);
  rightCover.position.set(0.14, 0.003, 0);
  rightCover.name = 'rightCover';
  openGroup.add(rightCover);

  // Page block on left
  const leftPagesGeometry = new THREE.BoxGeometry(0.26, 0.02, 0.36);
  const leftPages = new THREE.Mesh(leftPagesGeometry, pagesMaterial);
  leftPages.position.set(-0.13, 0.015, 0);
  openGroup.add(leftPages);

  // Page block on right
  const rightPages = new THREE.Mesh(leftPagesGeometry, pagesMaterial);
  rightPages.position.set(0.13, 0.015, 0);
  openGroup.add(rightPages);

  // Left page surface (for displaying content)
  const pageSurfaceGeometry = new THREE.PlaneGeometry(0.24, 0.34);
  const leftPageSurfaceMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff8f0,
    roughness: 0.9,
    side: THREE.DoubleSide
  });
  const leftPageSurface = new THREE.Mesh(pageSurfaceGeometry, leftPageSurfaceMaterial);
  leftPageSurface.rotation.x = -Math.PI / 2;
  leftPageSurface.position.set(-0.13, 0.026, 0);
  leftPageSurface.name = 'leftPageSurface';
  openGroup.add(leftPageSurface);

  // Right page surface
  const rightPageSurfaceMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff8f0,
    roughness: 0.9,
    side: THREE.DoubleSide
  });
  const rightPageSurface = new THREE.Mesh(pageSurfaceGeometry, rightPageSurfaceMaterial);
  rightPageSurface.rotation.x = -Math.PI / 2;
  rightPageSurface.position.set(0.13, 0.026, 0);
  rightPageSurface.name = 'rightPageSurface';
  openGroup.add(rightPageSurface);

  // Spine when open
  const openSpineGeometry = new THREE.BoxGeometry(0.02, 0.03, 0.38);
  const openSpine = new THREE.Mesh(openSpineGeometry, spineMaterial);
  openSpine.position.set(0, 0.015, 0);
  openGroup.add(openSpine);

  group.add(openGroup);

  group.position.y = getDeskSurfaceY();

  return group;
}

function createPhotoFrame(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'photo-frame',
    name: 'Photo Frame',
    interactive: false, // Settings only in edit mode (RMB)
    photoTexture: null,
    mainColor: options.mainColor || '#92400e',
    accentColor: options.accentColor || '#60a5fa'
  };

  // Frame
  const frameGeometry = new THREE.BoxGeometry(0.35, 0.45, 0.03);
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.6
  });
  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  frame.castShadow = true;
  group.add(frame);

  // Photo area - can be updated with custom texture
  const photoGeometry = new THREE.PlaneGeometry(0.28, 0.38);
  const photoMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.5
  });
  const photo = new THREE.Mesh(photoGeometry, photoMaterial);
  photo.name = 'photoSurface';
  photo.position.z = 0.016;
  group.add(photo);

  // Stand - positioned further back to avoid clipping through frame front
  const standGeometry = new THREE.BoxGeometry(0.04, 0.25, 0.08);
  const stand = new THREE.Mesh(standGeometry, frameMaterial);
  stand.position.set(0, -0.12, -0.12);
  stand.rotation.x = Math.PI / 5; // Slightly steeper angle
  stand.castShadow = true;
  group.add(stand);

  group.rotation.x = -Math.PI / 12;
  group.position.y = getDeskSurfaceY() + 0.25;

  return group;
}

function createGlobe(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'globe',
    name: 'Globe',
    interactive: true,
    rotationSpeed: 0.002,
    mainColor: options.mainColor || '#3b82f6',
    accentColor: options.accentColor || '#22c55e'
  };

  // Base
  const baseGeometry = new THREE.CylinderGeometry(0.15, 0.18, 0.05, 32);
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.3,
    metalness: 0.7
  });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.castShadow = true;
  group.add(base);

  // Stand arm
  const armGeometry = new THREE.TorusGeometry(0.22, 0.015, 8, 32, Math.PI);
  const arm = new THREE.Mesh(armGeometry, baseMaterial);
  arm.position.y = 0.22;
  arm.rotation.x = Math.PI / 2;
  group.add(arm);

  // Globe sphere
  const globeGeometry = new THREE.SphereGeometry(0.2, 32, 32);
  const globeMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.4,
    metalness: 0.2
  });
  const globe = new THREE.Mesh(globeGeometry, globeMaterial);
  globe.position.y = 0.22;
  globe.name = 'globeSphere';
  globe.castShadow = true;
  group.add(globe);

  // Land masses (simplified)
  const landGeometry = new THREE.IcosahedronGeometry(0.205, 1);
  const landMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.6,
    wireframe: true
  });
  const land = new THREE.Mesh(landGeometry, landMaterial);
  land.position.y = 0.22;
  land.name = 'land';
  group.add(land);

  group.position.y = getDeskSurfaceY() + 0.025;

  return group;
}

function createTrophy(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'trophy',
    name: 'Trophy',
    interactive: false,
    mainColor: options.mainColor || '#fbbf24',
    accentColor: options.accentColor || '#92400e'
  };

  const trophyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.2,
    metalness: 0.9
  });

  // Base
  const baseGeometry = new THREE.BoxGeometry(0.2, 0.05, 0.2);
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.6
  });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.025;
  base.castShadow = true;
  group.add(base);

  // Stem
  const stemGeometry = new THREE.CylinderGeometry(0.03, 0.05, 0.15, 16);
  const stem = new THREE.Mesh(stemGeometry, trophyMaterial);
  stem.position.y = 0.125;
  stem.castShadow = true;
  group.add(stem);

  // Cup
  const cupGeometry = new THREE.CylinderGeometry(0.12, 0.06, 0.15, 32);
  const cup = new THREE.Mesh(cupGeometry, trophyMaterial);
  cup.position.y = 0.275;
  cup.castShadow = true;
  group.add(cup);

  // Handles
  [-1, 1].forEach(side => {
    const handleGeometry = new THREE.TorusGeometry(0.04, 0.015, 8, 16, Math.PI);
    const handle = new THREE.Mesh(handleGeometry, trophyMaterial);
    handle.position.set(side * 0.14, 0.26, 0);
    handle.rotation.y = Math.PI / 2;
    handle.rotation.x = Math.PI / 2 * side;
    group.add(handle);
  });

  group.position.y = getDeskSurfaceY();

  return group;
}

function createHourglass(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'hourglass',
    name: 'Hourglass',
    interactive: true,
    mainColor: options.mainColor || '#92400e',
    accentColor: options.accentColor || '#fbbf24'
  };

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.4,
    metalness: 0.6
  });

  // Top and bottom caps
  [0.25, 0].forEach(y => {
    const capGeometry = new THREE.CylinderGeometry(0.12, 0.12, 0.03, 16);
    const cap = new THREE.Mesh(capGeometry, frameMaterial);
    cap.position.y = y;
    cap.castShadow = true;
    group.add(cap);
  });

  // Glass bulbs
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0xadd8e6,
    transparent: true,
    opacity: 0.4,
    roughness: 0.1
  });

  // Top bulb
  const topBulbGeometry = new THREE.SphereGeometry(0.08, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const topBulb = new THREE.Mesh(topBulbGeometry, glassMaterial);
  topBulb.position.y = 0.19;
  topBulb.rotation.x = Math.PI;
  group.add(topBulb);

  // Bottom bulb
  const bottomBulb = new THREE.Mesh(topBulbGeometry, glassMaterial);
  bottomBulb.position.y = 0.06;
  group.add(bottomBulb);

  // Neck
  const neckGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.06, 16);
  const neck = new THREE.Mesh(neckGeometry, glassMaterial);
  neck.position.y = 0.125;
  group.add(neck);

  // Sand
  const sandMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.8
  });

  const sandTopGeometry = new THREE.ConeGeometry(0.05, 0.04, 16);
  const sandTop = new THREE.Mesh(sandTopGeometry, sandMaterial);
  sandTop.position.y = 0.17;
  sandTop.rotation.x = Math.PI;
  group.add(sandTop);

  const sandBottomGeometry = new THREE.ConeGeometry(0.06, 0.05, 16);
  const sandBottom = new THREE.Mesh(sandBottomGeometry, sandMaterial);
  sandBottom.position.y = 0.06;
  group.add(sandBottom);

  // Pillars
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const pillarGeometry = new THREE.CylinderGeometry(0.015, 0.015, 0.22, 8);
    const pillar = new THREE.Mesh(pillarGeometry, frameMaterial);
    pillar.position.set(
      Math.cos(angle) * 0.1,
      0.125,
      Math.sin(angle) * 0.1
    );
    group.add(pillar);
  }

  group.position.y = getDeskSurfaceY() + 0.015;

  return group;
}

function createPaper(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'paper',
    name: 'Paper Sheet',
    interactive: true, // Interactive - can draw with pen
    drawingLines: [], // Array of drawing line data
    fileName: options.fileName || 'drawing.png',
    mainColor: options.mainColor || '#fffff5',
    accentColor: options.accentColor || '#cccccc'
  };

  const paperMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide
  });

  // A4 paper proportions (210mm x 297mm ~ 0.707 ratio)
  const paperWidth = 0.28;
  const paperHeight = 0.4;
  const paperThickness = 0.002;

  // Main paper sheet
  const paperGeometry = new THREE.BoxGeometry(paperWidth, paperThickness, paperHeight);
  const paper = new THREE.Mesh(paperGeometry, paperMaterial);
  paper.position.y = paperThickness / 2;
  paper.castShadow = true;
  paper.receiveShadow = true;
  group.add(paper);

  // Add some subtle lines to represent text/content
  const lineMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.9
  });

  for (let i = 0; i < 15; i++) {
    const lineWidth = 0.18 + Math.random() * 0.06;
    const lineGeometry = new THREE.BoxGeometry(lineWidth, 0.001, 0.008);
    const line = new THREE.Mesh(lineGeometry, lineMaterial);
    line.position.set(
      (Math.random() - 0.5) * 0.02, // Slight offset
      paperThickness + 0.001,
      -0.15 + i * 0.022
    );
    group.add(line);
  }

  group.position.y = getDeskSurfaceY();

  return group;
}

function createMetronome(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'metronome',
    name: 'Metronome',
    interactive: false, // Settings only in edit mode (RMB), middle-click just toggles
    isRunning: false,
    bpm: 120,
    tickSound: true, // Tick sound ON by default (strike sound)
    tickSoundType: 'strike', // 'strike' (default) or 'beep'
    pendulumAngle: 0,
    pendulumDirection: 1,
    mainColor: options.mainColor || '#8b4513',
    accentColor: options.accentColor || '#ffd700'
  };

  const woodMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.7,
    metalness: 0.1
  });

  const metalMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.3,
    metalness: 0.8
  });

  // Base (wooden pyramid-like shape)
  const baseGeometry = new THREE.CylinderGeometry(0.08, 0.15, 0.05, 4);
  const base = new THREE.Mesh(baseGeometry, woodMaterial);
  base.rotation.y = Math.PI / 4;
  base.position.y = 0.025;
  base.castShadow = true;
  group.add(base);

  // Body (tapered wooden box)
  const bodyGeometry = new THREE.CylinderGeometry(0.06, 0.12, 0.35, 4);
  const body = new THREE.Mesh(bodyGeometry, woodMaterial);
  body.rotation.y = Math.PI / 4;
  body.position.y = 0.225;
  body.castShadow = true;
  group.add(body);

  // Front face plate
  const facePlateGeometry = new THREE.PlaneGeometry(0.1, 0.2);
  const facePlateMaterial = new THREE.MeshStandardMaterial({
    color: 0xfffff0,
    roughness: 0.8
  });
  const facePlate = new THREE.Mesh(facePlateGeometry, facePlateMaterial);
  facePlate.position.set(0, 0.25, 0.07);
  group.add(facePlate);

  // Scale markings on face plate
  const markingMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.5
  });
  for (let i = 0; i < 7; i++) {
    const markGeometry = new THREE.BoxGeometry(0.06, 0.002, 0.001);
    const mark = new THREE.Mesh(markGeometry, markingMaterial);
    mark.position.set(0, 0.17 + i * 0.025, 0.072);
    group.add(mark);
  }

  // Pendulum pivot point
  const pivotGeometry = new THREE.CylinderGeometry(0.01, 0.01, 0.02, 16);
  const pivot = new THREE.Mesh(pivotGeometry, metalMaterial);
  pivot.rotation.x = Math.PI / 2;
  pivot.position.set(0, 0.35, 0.05);
  group.add(pivot);

  // Pendulum group (this will swing)
  const pendulumGroup = new THREE.Group();
  pendulumGroup.name = 'pendulum';
  pendulumGroup.position.set(0, 0.35, 0.05);

  // Pendulum arm
  const armGeometry = new THREE.BoxGeometry(0.008, 0.25, 0.008);
  const arm = new THREE.Mesh(armGeometry, metalMaterial);
  arm.position.y = -0.125;
  pendulumGroup.add(arm);

  // Pendulum weight (adjustable)
  const weightGeometry = new THREE.BoxGeometry(0.03, 0.04, 0.015);
  const weight = new THREE.Mesh(weightGeometry, metalMaterial);
  weight.name = 'weight';
  weight.position.y = -0.15;
  pendulumGroup.add(weight);

  // Pendulum bob at bottom
  const bobGeometry = new THREE.SphereGeometry(0.02, 16, 16);
  const bob = new THREE.Mesh(bobGeometry, metalMaterial);
  bob.position.y = -0.24;
  pendulumGroup.add(bob);

  group.add(pendulumGroup);

  // Top ornament
  const topGeometry = new THREE.ConeGeometry(0.03, 0.04, 4);
  const top = new THREE.Mesh(topGeometry, metalMaterial);
  top.rotation.y = Math.PI / 4;
  top.position.y = 0.42;
  group.add(top);

  group.position.y = getDeskSurfaceY();

  return group;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function getDeskSurfaceY() {
  return CONFIG.desk.height;  // No legs, just surface height
}

function addObjectToDesk(type, options = {}) {
  const creator = PRESET_CREATORS[type];
  if (!creator) return null;

  const object = creator(options);
  object.userData.id = objectIdCounter++;
  object.userData.originalY = object.position.y;
  object.userData.targetY = object.position.y;
  object.userData.isLifted = false;

  // Random position on desk
  const deskHalfWidth = CONFIG.desk.width / 2 - 0.3;
  const deskHalfDepth = CONFIG.desk.depth / 2 - 0.3;
  object.position.x = options.x !== undefined ? options.x : (Math.random() - 0.5) * deskHalfWidth * 2;
  object.position.z = options.z !== undefined ? options.z : (Math.random() - 0.5) * deskHalfDepth * 2;

  // Apply rotation if specified
  if (options.rotationY !== undefined) {
    object.rotation.y = options.rotationY;
    object.userData.rotationY = options.rotationY;
  }

  // Apply scale if specified and adjust Y position to keep object on desk
  if (options.scale !== undefined && options.scale > 0) {
    object.scale.set(options.scale, options.scale, options.scale);
    object.userData.scale = options.scale;
    // Adjust Y position to account for scale change
    adjustObjectYForScale(object, 1.0, options.scale);
  }

  deskObjects.push(object);
  scene.add(object);

  saveState();

  return object;
}

function removeObject(object) {
  const index = deskObjects.indexOf(object);
  if (index > -1) {
    deskObjects.splice(index, 1);
    scene.remove(object);
    // Clean up physics data
    physicsState.velocities.delete(object.userData.id);
    physicsState.angularVelocities.delete(object.userData.id);
    physicsState.tiltState.delete(object.userData.id);
    physicsState.tiltVelocities.delete(object.userData.id);
    saveState();
  }
}

// Reset an object that has fallen over back to upright position
function resetFallenObject(object) {
  if (!object.userData.isFallen) return;

  object.userData.isFallen = false;

  // Reset rotation to upright (preserve Y rotation)
  const yRotation = object.rotation.y;
  const physics = getObjectPhysics(object);

  // Get the original base rotation for this object type
  const creator = PRESET_CREATORS[object.userData.type];
  if (creator) {
    // Create a temporary object to get default rotation
    const temp = creator({});
    object.rotation.x = temp.rotation.x;
    object.rotation.z = temp.rotation.z;
    object.rotation.y = yRotation;
    object.position.y = temp.position.y;
    scene.remove(temp);
  } else {
    object.rotation.x = 0;
    object.rotation.z = 0;
    object.rotation.y = yRotation;
    object.position.y = object.userData.originalY;
  }

  // Reset tilt state
  physicsState.tiltState.set(object.userData.id, { x: 0, z: 0 });
  physicsState.tiltVelocities.set(object.userData.id, { x: 0, z: 0 });
  object.userData.baseTiltX = undefined;
}

function updateObjectColor(object, colorType, colorValue) {
  if (!object) return;

  const oldMainColor = object.userData.mainColor;
  const oldAccentColor = object.userData.accentColor;

  object.userData[colorType] = colorValue;

  // Recreate the object with new colors to ensure proper color application
  const type = object.userData.type;
  const creator = PRESET_CREATORS[type];
  if (!creator) return;

  // Store position and state
  const position = { x: object.position.x, y: object.position.y, z: object.position.z };
  const rotation = { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z };
  const scale = { x: object.scale.x, y: object.scale.y, z: object.scale.z };
  const id = object.userData.id;
  const originalY = object.userData.originalY;
  const savedRotationY = object.userData.rotationY;
  const savedScale = object.userData.scale;

  // Store type-specific properties that should be preserved
  const typeSpecificData = {};
  switch (type) {
    case 'books':
      typeSpecificData.bookTitle = object.userData.bookTitle;
      typeSpecificData.titleColor = object.userData.titleColor;
      typeSpecificData.pdfPath = object.userData.pdfPath;
      typeSpecificData.totalPages = object.userData.totalPages;
      typeSpecificData.currentPage = object.userData.currentPage;
      typeSpecificData.isOpen = object.userData.isOpen;
      break;
    case 'coffee':
      typeSpecificData.drinkType = object.userData.drinkType;
      typeSpecificData.liquidLevel = object.userData.liquidLevel;
      typeSpecificData.isHot = object.userData.isHot;
      break;
    case 'metronome':
      typeSpecificData.bpm = object.userData.bpm;
      typeSpecificData.tickSound = object.userData.tickSound;
      typeSpecificData.tickSoundType = object.userData.tickSoundType;
      typeSpecificData.isRunning = object.userData.isRunning;
      break;
    case 'photo-frame':
      typeSpecificData.photoDataUrl = object.userData.photoDataUrl;
      typeSpecificData.photoTexture = object.userData.photoTexture;
      break;
    case 'laptop':
      typeSpecificData.bootTime = object.userData.bootTime;
      typeSpecificData.bootScreenDataUrl = object.userData.bootScreenDataUrl;
      typeSpecificData.bootScreenTexture = object.userData.bootScreenTexture;
      typeSpecificData.powerLedColor = object.userData.powerLedColor;
      typeSpecificData.powerButtonColor = object.userData.powerButtonColor;
      typeSpecificData.editorContent = object.userData.editorContent;
      typeSpecificData.editorFileName = object.userData.editorFileName;
      break;
    case 'pen':
      typeSpecificData.penColor = object.userData.penColor;
      typeSpecificData.inkColor = object.userData.inkColor;
      typeSpecificData.colorHex = object.userData.colorHex;
      break;
  }

  // Create new object with updated colors
  const newObject = creator({
    mainColor: object.userData.mainColor,
    accentColor: object.userData.accentColor
  });

  // Restore position, rotation, scale and other properties
  newObject.position.set(position.x, position.y, position.z);
  newObject.rotation.set(rotation.x, rotation.y, rotation.z);
  newObject.scale.set(scale.x, scale.y, scale.z);
  newObject.userData.id = id;
  newObject.userData.originalY = originalY;
  newObject.userData.targetY = position.y;
  newObject.userData.isLifted = false;
  newObject.userData.rotationY = savedRotationY;
  newObject.userData.scale = savedScale;

  // Restore type-specific properties
  Object.assign(newObject.userData, typeSpecificData);

  // For books, update the title texture with the restored title
  if (type === 'books' && typeSpecificData.bookTitle && newObject.userData.createTitleTexture) {
    const closedGroup = newObject.getObjectByName('closedBook');
    if (closedGroup) {
      const coverTitle = closedGroup.getObjectByName('coverTitle');
      if (coverTitle) {
        const newCoverTexture = newObject.userData.createTitleTexture(typeSpecificData.bookTitle, 320, 116, 64);
        coverTitle.material.map = newCoverTexture;
        coverTitle.material.needsUpdate = true;
      }
    }
  }

  // For coffee mug, update liquid color and level
  if (type === 'coffee') {
    const liquid = newObject.getObjectByName('liquid');
    const liquidBody = newObject.getObjectByName('liquidBody');
    if (typeSpecificData.drinkType && DRINK_COLORS[typeSpecificData.drinkType]) {
      if (liquid) liquid.material.color.set(DRINK_COLORS[typeSpecificData.drinkType].color);
      if (liquidBody) liquidBody.material.color.set(DRINK_COLORS[typeSpecificData.drinkType].color);
    }
    const level = typeSpecificData.liquidLevel !== undefined ? typeSpecificData.liquidLevel : 0.8;
    if (liquid) {
      liquid.visible = level > 0.05;
      liquid.position.y = 0.03 + level * 0.14;
    }
    if (liquidBody) {
      liquidBody.visible = level > 0.05;
      liquidBody.scale.y = Math.max(0.1, level);
      liquidBody.position.y = 0.015 + level * 0.07;
    }
  }

  // For photo frame, restore the photo texture
  if (type === 'photo-frame' && typeSpecificData.photoDataUrl) {
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(typeSpecificData.photoDataUrl, (texture) => {
      const photoSurface = newObject.getObjectByName('photoSurface');
      if (photoSurface) {
        photoSurface.material.map = texture;
        photoSurface.material.color.set(0xffffff);
        photoSurface.material.needsUpdate = true;
        newObject.userData.photoTexture = texture;
      }
    });
  }

  // Replace in scene and array
  const index = deskObjects.indexOf(object);
  if (index > -1) {
    deskObjects[index] = newObject;
    scene.remove(object);
    scene.add(newObject);
    selectedObject = newObject;
  }

  saveState();
}

// ============================================================================
// PHYSICS SYSTEM
// ============================================================================

// Custom collision radii for objects where the bounding box is inaccurate
// (e.g., laptop screen extends the bbox but shouldn't collide at that distance)
const OBJECT_COLLISION_RADII = {
  'laptop': 0.45,  // Base is 0.8 x 0.5, radius should be ~half diagonal but tight
  'lamp': 0.35     // Base is small, don't use tall shade for collision
};

function getObjectBounds(object) {
  // Use custom collision radius if defined for this object type
  const type = object.userData.type;
  if (OBJECT_COLLISION_RADII[type] !== undefined) {
    return OBJECT_COLLISION_RADII[type] * (object.scale?.x || 1);
  }

  // Calculate approximate bounding radius for collision detection
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  // Use the largest horizontal dimension as the collision radius
  return Math.max(size.x, size.z) / 2;
}

function initPhysicsForObject(object) {
  if (!physicsState.velocities.has(object.userData.id)) {
    physicsState.velocities.set(object.userData.id, { x: 0, z: 0 });
    physicsState.angularVelocities.set(object.userData.id, 0);
    physicsState.tiltState.set(object.userData.id, { x: 0, z: 0 });
    physicsState.tiltVelocities.set(object.userData.id, { x: 0, z: 0 });
  }
}

function getObjectPhysics(object) {
  const type = object.userData.type;
  return OBJECT_PHYSICS[type] || { weight: 1.0, stability: 0.5, height: 0.3 };
}

function updatePhysics() {
  if (!physicsState.enabled) return;

  const deskHalfWidth = CONFIG.desk.width / 2 - 0.2;
  const deskHalfDepth = CONFIG.desk.depth / 2 - 0.2;

  // Update velocities, positions, and tilting for all non-dragged objects
  deskObjects.forEach(obj => {
    // Skip if object is being dragged, examined, or is in examine mode
    if (obj === selectedObject && isDragging) return;
    if (obj.userData.isExamining || obj.userData.isReturning) return;
    if (examineState.active && examineState.object === obj) return;
    if (obj.userData.isFallen) return;  // Skip physics for fallen objects

    initPhysicsForObject(obj);

    const vel = physicsState.velocities.get(obj.userData.id);
    const angVel = physicsState.angularVelocities.get(obj.userData.id);
    const tilt = physicsState.tiltState.get(obj.userData.id);
    const tiltVel = physicsState.tiltVelocities.get(obj.userData.id);
    const physics = getObjectPhysics(obj);

    // Apply velocity
    if (Math.abs(vel.x) > 0.001 || Math.abs(vel.z) > 0.001) {
      obj.position.x += vel.x;
      obj.position.z += vel.z;

      // Apply friction
      vel.x *= physicsState.friction;
      vel.z *= physicsState.friction;

      // Clamp to desk bounds with bounce
      if (obj.position.x > deskHalfWidth) {
        obj.position.x = deskHalfWidth;
        vel.x = -vel.x * physicsState.bounceFactor;
      } else if (obj.position.x < -deskHalfWidth) {
        obj.position.x = -deskHalfWidth;
        vel.x = -vel.x * physicsState.bounceFactor;
      }

      if (obj.position.z > deskHalfDepth) {
        obj.position.z = deskHalfDepth;
        vel.z = -vel.z * physicsState.bounceFactor;
      } else if (obj.position.z < -deskHalfDepth) {
        obj.position.z = -deskHalfDepth;
        vel.z = -vel.z * physicsState.bounceFactor;
      }
    }

    // Apply angular velocity (rotation around Y axis)
    if (Math.abs(angVel) > 0.001) {
      obj.rotation.y += angVel;
      physicsState.angularVelocities.set(obj.userData.id, angVel * physicsState.friction);
    }

    // Apply tilt velocity and update tilt
    if (tilt && tiltVel) {
      // Apply tilt velocity
      tilt.x += tiltVel.x;
      tilt.z += tiltVel.z;

      // Apply friction to tilt velocity
      tiltVel.x *= 0.9;
      tiltVel.z *= 0.9;

      // Recovery force - objects try to return to upright based on stability
      const recoveryForce = physicsState.tiltRecovery * physics.stability;
      tiltVel.x -= tilt.x * recoveryForce;
      tiltVel.z -= tilt.z * recoveryForce;

      // Check if object has tipped over
      const totalTilt = Math.sqrt(tilt.x * tilt.x + tilt.z * tilt.z);
      if (totalTilt > physicsState.tipOverThreshold) {
        // Object tips over! Complete the fall
        obj.userData.isFallen = true;

        // Animate falling to the side
        const fallDirection = { x: tilt.x / totalTilt, z: tilt.z / totalTilt };
        obj.rotation.x = fallDirection.z * Math.PI / 2;
        obj.rotation.z = -fallDirection.x * Math.PI / 2;

        // Adjust position to rest on the side
        const heightOffset = physics.height * 0.3;
        obj.position.y = getDeskSurfaceY() + heightOffset;

        // Clear physics state for this object
        physicsState.tiltState.set(obj.userData.id, { x: 0, z: 0 });
        physicsState.tiltVelocities.set(obj.userData.id, { x: 0, z: 0 });
      } else {
        // Clamp tilt to max
        if (Math.abs(tilt.x) > physicsState.maxTilt) {
          tilt.x = Math.sign(tilt.x) * physicsState.maxTilt;
        }
        if (Math.abs(tilt.z) > physicsState.maxTilt) {
          tilt.z = Math.sign(tilt.z) * physicsState.maxTilt;
        }

        // Apply tilt to object rotation (add to existing rotation for objects like clock)
        // Store original rotation if not stored
        if (obj.userData.baseTiltX === undefined) {
          obj.userData.baseTiltX = obj.rotation.x;
        }
        obj.rotation.x = obj.userData.baseTiltX + tilt.z;
        obj.rotation.z = -tilt.x;
      }
    }
  });

  // Check collisions between dragged object and other objects
  if (isDragging && selectedObject) {
    const draggedRadius = getObjectBounds(selectedObject);
    const draggedPhysics = getObjectPhysics(selectedObject);

    deskObjects.forEach(obj => {
      if (obj === selectedObject) return;
      if (obj.userData.isExamining || obj.userData.isReturning) return;
      if (obj.userData.isFallen) return;

      initPhysicsForObject(obj);

      const otherRadius = getObjectBounds(obj);
      const otherPhysics = getObjectPhysics(obj);
      const minDist = (draggedRadius + otherRadius) * 0.7;

      const dx = obj.position.x - selectedObject.position.x;
      const dz = obj.position.z - selectedObject.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < minDist && dist > 0.01) {
        // Collision detected! Push and tilt the other object
        const normalX = dx / dist;
        const normalZ = dz / dist;

        // Calculate drag speed for force scaling
        const dragSpeed = Math.sqrt(
          physicsState.dragVelocity.x * physicsState.dragVelocity.x +
          physicsState.dragVelocity.z * physicsState.dragVelocity.z
        );

        // Scale force by drag speed (slow = less force, fast = more force)
        // Minimum threshold to prevent tiny movements from causing big reactions
        const speedMultiplier = Math.max(0, Math.min(1, (dragSpeed - physicsState.minPushSpeed) / 0.1));

        // Calculate push force based on weight difference and speed
        const weightRatio = draggedPhysics.weight / otherPhysics.weight;
        const pushMultiplier = Math.min(weightRatio * 1.5, 3.0) * speedMultiplier;

        const pushX = normalX * physicsState.pushForce * pushMultiplier;
        const pushZ = normalZ * physicsState.pushForce * pushMultiplier;

        const vel = physicsState.velocities.get(obj.userData.id);
        vel.x += pushX;
        vel.z += pushZ;

        // Add tilt based on collision (only if moving fast enough)
        // Higher stability means harder to tip
        const tiltVel = physicsState.tiltVelocities.get(obj.userData.id);
        const tiltAmount = physicsState.tiltForce * (1 - otherPhysics.stability) * pushMultiplier * speedMultiplier;
        tiltVel.x += normalX * tiltAmount;
        tiltVel.z += normalZ * tiltAmount;

        // Add some spin based on collision angle (also scaled by speed)
        const crossProduct = dx * pushZ - dz * pushX;
        const angVel = physicsState.angularVelocities.get(obj.userData.id);
        physicsState.angularVelocities.set(obj.userData.id, angVel + crossProduct * 0.3 * speedMultiplier);

        // Separate objects to prevent overlap
        const overlap = minDist - dist;
        obj.position.x += normalX * overlap * 0.5;
        obj.position.z += normalZ * overlap * 0.5;
      }
    });
  }

  // Check collisions from rotating objects (when an object is being scrolled to rotate)
  deskObjects.forEach(rotatingObj => {
    if (rotatingObj.userData.isExamining || rotatingObj.userData.isReturning) return;
    if (rotatingObj.userData.isFallen) return;

    const rotAngVel = physicsState.angularVelocities.get(rotatingObj.userData.id);
    if (!rotAngVel || Math.abs(rotAngVel) < 0.01) return;

    const rotRadius = getObjectBounds(rotatingObj);
    const rotPhysics = getObjectPhysics(rotatingObj);

    deskObjects.forEach(obj => {
      if (obj === rotatingObj) return;
      if (obj === selectedObject && isDragging) return;
      if (obj.userData.isExamining || obj.userData.isReturning) return;
      if (obj.userData.isFallen) return;

      initPhysicsForObject(obj);

      const otherRadius = getObjectBounds(obj);
      const otherPhysics = getObjectPhysics(obj);
      const minDist = (rotRadius + otherRadius) * 0.8;

      const dx = obj.position.x - rotatingObj.position.x;
      const dz = obj.position.z - rotatingObj.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < minDist && dist > 0.01) {
        // Rotating object hitting another object
        const normalX = dx / dist;
        const normalZ = dz / dist;

        // Calculate tangent force from rotation
        const tangentX = -normalZ * Math.sign(rotAngVel);
        const tangentZ = normalX * Math.sign(rotAngVel);

        const rotSpeed = Math.abs(rotAngVel) * rotRadius;
        const forceMultiplier = rotPhysics.weight / otherPhysics.weight;

        const vel = physicsState.velocities.get(obj.userData.id);
        vel.x += (normalX * 0.5 + tangentX * 0.5) * rotSpeed * forceMultiplier * 0.5;
        vel.z += (normalZ * 0.5 + tangentZ * 0.5) * rotSpeed * forceMultiplier * 0.5;

        // Add tilt from rotating collision
        const tiltVel = physicsState.tiltVelocities.get(obj.userData.id);
        const tiltAmount = physicsState.tiltForce * (1 - otherPhysics.stability) * rotSpeed * forceMultiplier;
        tiltVel.x += normalX * tiltAmount * 0.5;
        tiltVel.z += normalZ * tiltAmount * 0.5;
      }
    });
  });

  // Check collisions between all pairs of non-dragged moving objects
  for (let i = 0; i < deskObjects.length; i++) {
    const objA = deskObjects[i];
    if (objA === selectedObject && isDragging) continue;
    if (objA.userData.isExamining || objA.userData.isReturning) continue;
    if (objA.userData.isFallen) continue;

    const radiusA = getObjectBounds(objA);
    const physicsA = getObjectPhysics(objA);
    const velA = physicsState.velocities.get(objA.userData.id);
    if (!velA) continue;

    for (let j = i + 1; j < deskObjects.length; j++) {
      const objB = deskObjects[j];
      if (objB === selectedObject && isDragging) continue;
      if (objB.userData.isExamining || objB.userData.isReturning) continue;
      if (objB.userData.isFallen) continue;

      const radiusB = getObjectBounds(objB);
      const physicsB = getObjectPhysics(objB);
      const velB = physicsState.velocities.get(objB.userData.id);
      if (!velB) continue;

      const minDist = (radiusA + radiusB) * 0.7;

      const dx = objB.position.x - objA.position.x;
      const dz = objB.position.z - objA.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < minDist && dist > 0.01) {
        // Elastic collision between two objects
        const nx = dx / dist;
        const nz = dz / dist;

        // Relative velocity
        const dvx = velA.x - velB.x;
        const dvz = velA.z - velB.z;

        // Relative velocity along collision normal
        const dvn = dvx * nx + dvz * nz;

        // Only resolve if objects are moving towards each other
        if (dvn > 0) {
          // Weighted elastic collision based on object weights
          const totalWeight = physicsA.weight + physicsB.weight;
          const weightA = physicsA.weight / totalWeight;
          const weightB = physicsB.weight / totalWeight;

          velA.x -= dvn * nx * weightB;
          velA.z -= dvn * nz * weightB;
          velB.x += dvn * nx * weightA;
          velB.z += dvn * nz * weightA;

          // Add tilt from collision
          const impactSpeed = Math.sqrt(dvx * dvx + dvz * dvz);
          const tiltVelA = physicsState.tiltVelocities.get(objA.userData.id);
          const tiltVelB = physicsState.tiltVelocities.get(objB.userData.id);

          if (tiltVelA) {
            const tiltAmountA = impactSpeed * physicsState.tiltForce * (1 - physicsA.stability) * weightB;
            tiltVelA.x -= nx * tiltAmountA;
            tiltVelA.z -= nz * tiltAmountA;
          }
          if (tiltVelB) {
            const tiltAmountB = impactSpeed * physicsState.tiltForce * (1 - physicsB.stability) * weightA;
            tiltVelB.x += nx * tiltAmountB;
            tiltVelB.z += nz * tiltAmountB;
          }
        }

        // Separate objects
        const overlap = minDist - dist;
        objA.position.x -= (nx * overlap * 0.25);
        objA.position.z -= (nz * overlap * 0.25);
        objB.position.x += (nx * overlap * 0.25);
        objB.position.z += (nz * overlap * 0.25);
      }
    }
  }
}

// ============================================================================
// CLOCK UPDATE
// ============================================================================
function updateClock() {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');

  document.getElementById('clock-display').textContent = `${hours}:${minutes}:${seconds}`;

  // Update 3D clock objects
  deskObjects.forEach(obj => {
    if (obj.userData.type === 'clock') {
      const hourHand = obj.getObjectByName('hourHand');
      const minuteHand = obj.getObjectByName('minuteHand');
      const secondHand = obj.getObjectByName('secondHand');

      // Calculate angles for real time display
      // Hands rotate clockwise, so we use negative angles
      // 12 o'clock is at the top (positive Y), which is 0 radians for our setup

      if (hourHand) {
        // Hour hand: full rotation every 12 hours, plus gradual movement based on minutes
        const hourAngle = -((now.getHours() % 12) / 12) * Math.PI * 2 - (now.getMinutes() / 60) * (Math.PI / 6);
        hourHand.rotation.z = hourAngle;
      }

      if (minuteHand) {
        // Minute hand: full rotation every 60 minutes, plus gradual movement based on seconds
        const minuteAngle = -(now.getMinutes() / 60) * Math.PI * 2 - (now.getSeconds() / 60) * (Math.PI / 30);
        minuteHand.rotation.z = minuteAngle;
      }

      if (secondHand) {
        // Second hand: full rotation every 60 seconds
        const secondAngle = -(now.getSeconds() / 60) * Math.PI * 2;
        secondHand.rotation.z = secondAngle;
      }
    }
  });
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================
function setupEventListeners() {
  const container = document.getElementById('canvas-container');

  // Mouse events
  container.addEventListener('mousedown', onMouseDown, false);
  container.addEventListener('mousemove', onMouseMove, false);
  container.addEventListener('mouseup', onMouseUp, false);
  container.addEventListener('contextmenu', onRightClick, false);
  // Double-click examine removed - use drag+scroll instead
  container.addEventListener('wheel', onMouseWheel, { passive: false });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    // Alt+I toggles the left sidebar (menu)
    if (e.altKey && (e.key === 'i' || e.key === 'I' || e.key === 'ш' || e.key === 'Ш')) {
      e.preventDefault();
      const menu = document.getElementById('menu');
      menu.classList.toggle('open');
      // Exit pointer lock when opening menu so cursor is visible
      if (menu.classList.contains('open') && document.pointerLockElement) {
        document.exitPointerLock();
      }
    }

    // Arrow keys for book page navigation
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.ctrlKey) {
      // Check if we're examining a book or have a book modal open
      let bookObject = null;
      if (examineState.active && examineState.object && examineState.object.userData.type === 'books') {
        bookObject = examineState.object;
      } else if (interactionObject && interactionObject.userData.type === 'books') {
        bookObject = interactionObject;
      } else {
        // Also check if crosshair is aimed at a book (raycast from center of screen)
        const centerMouse = new THREE.Vector2(0, 0);
        raycaster.setFromCamera(centerMouse, camera);
        const intersects = raycaster.intersectObjects(deskObjects, true);
        for (const hit of intersects) {
          const obj = getParentDeskObject(hit.object);
          if (obj && obj.userData.type === 'books' && obj.userData.isOpen) {
            bookObject = obj;
            break;
          }
        }
      }

      if (bookObject && bookObject.userData.isOpen) {
        e.preventDefault();
        // If no PDF is loaded, use a default number of pages for the animation
        const totalPages = bookObject.userData.totalPages || 10;
        if (e.key === 'ArrowLeft' && bookObject.userData.currentPage > 0) {
          // Previous page with animation
          animatePageTurn(bookObject, -1);
        } else if (e.key === 'ArrowRight' && bookObject.userData.currentPage < totalPages - 1) {
          // Next page with animation
          // Ensure totalPages is set for the animation
          if (!bookObject.userData.totalPages) bookObject.userData.totalPages = 10;
          animatePageTurn(bookObject, 1);
        }
      }
    }
  });

  // Window resize
  window.addEventListener('resize', onWindowResize, false);

  // Menu toggle
  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('menu').classList.toggle('open');
  });

  // Preset items - click and drag-and-drop support
  document.querySelectorAll('.preset-item').forEach(item => {
    // Click to add
    item.addEventListener('click', () => {
      const preset = item.dataset.preset;
      addObjectToDesk(preset);
      document.getElementById('menu').classList.remove('open');
    });

    // Drag start
    item.setAttribute('draggable', 'true');
    item.addEventListener('dragstart', (e) => {
      draggedPresetType = item.dataset.preset;

      // Create custom drag preview
      const icon = item.querySelector('.icon').textContent;
      const name = item.querySelector('.name').textContent;

      dragPreviewElement = document.createElement('div');
      dragPreviewElement.className = 'drag-preview';
      dragPreviewElement.innerHTML = `<span class="icon">${icon}</span><span class="name">${name}</span>`;
      document.body.appendChild(dragPreviewElement);

      // Position off-screen initially (will be updated in dragover)
      dragPreviewElement.style.left = '-1000px';
      dragPreviewElement.style.top = '-1000px';

      // Set transparent drag image
      const emptyImg = new Image();
      emptyImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(emptyImg, 0, 0);
      e.dataTransfer.effectAllowed = 'copy';

      // Close the menu during drag
      document.getElementById('menu').classList.remove('open');
    });

    item.addEventListener('dragend', () => {
      // Clean up drag preview
      if (dragPreviewElement) {
        dragPreviewElement.remove();
        dragPreviewElement = null;
      }
      draggedPresetType = null;
    });
  });

  // Drop zone (canvas container)
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    // Update drag preview position
    if (dragPreviewElement) {
      dragPreviewElement.style.left = (e.clientX + 15) + 'px';
      dragPreviewElement.style.top = (e.clientY + 15) + 'px';
    }
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();

    if (draggedPresetType) {
      // Calculate drop position on desk
      const rect = renderer.domElement.getBoundingClientRect();
      const dropMouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      raycaster.setFromCamera(dropMouse, camera);
      const intersects = raycaster.intersectObject(dragPlane);

      if (intersects.length > 0) {
        const point = intersects[0].point;

        // Clamp to desk bounds
        const halfWidth = CONFIG.desk.width / 2 - 0.3;
        const halfDepth = CONFIG.desk.depth / 2 - 0.3;

        const x = Math.max(-halfWidth, Math.min(halfWidth, point.x));
        const z = Math.max(-halfDepth, Math.min(halfDepth, point.z));

        addObjectToDesk(draggedPresetType, { x, z });
      } else {
        // If no intersection with desk, add at random position
        addObjectToDesk(draggedPresetType);
      }

      // Clean up
      if (dragPreviewElement) {
        dragPreviewElement.remove();
        dragPreviewElement = null;
      }
      draggedPresetType = null;
    }
  });

  // Delete button
  document.getElementById('delete-object').addEventListener('click', () => {
    if (selectedObject) {
      removeObject(selectedObject);
      selectedObject = null;
      document.getElementById('customization-panel').classList.remove('open');
    }
  });

  // Color swatches
  document.querySelectorAll('#main-colors .color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      if (selectedObject) {
        updateObjectColor(selectedObject, 'mainColor', swatch.dataset.color);
        document.querySelectorAll('#main-colors .color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
      }
    });
  });

  document.querySelectorAll('#accent-colors .color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      if (selectedObject) {
        // Block accent color change for Photo Frame if a photo is loaded
        if (selectedObject.userData.type === 'photo-frame' && selectedObject.userData.photoDataUrl) {
          // Photo is loaded - show hint that photo must be removed first
          const dynamicOptions = document.getElementById('object-specific-options');
          if (dynamicOptions) {
            // Flash a warning message
            const existingWarning = dynamicOptions.querySelector('.accent-warning');
            if (existingWarning) existingWarning.remove();
            const warning = document.createElement('div');
            warning.className = 'accent-warning';
            warning.style.cssText = 'color: #fbbf24; font-size: 12px; margin-top: 10px; padding: 8px; background: rgba(251, 191, 36, 0.1); border-radius: 6px; text-align: center;';
            warning.textContent = 'Remove photo first to change accent color';
            dynamicOptions.insertBefore(warning, dynamicOptions.firstChild);
            setTimeout(() => warning.remove(), 3000);
          }
          return; // Don't update color
        }
        updateObjectColor(selectedObject, 'accentColor', swatch.dataset.color);
        document.querySelectorAll('#accent-colors .color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
      }
    });
  });

  // Close panels when clicking outside
  container.addEventListener('click', (e) => {
    if (!e.target.closest('#menu') && !e.target.closest('#menu-toggle')) {
      document.getElementById('menu').classList.remove('open');
    }
  });

  // Modal close button
  document.getElementById('close-modal').addEventListener('click', closeInteractionModal);
  document.getElementById('modal-overlay').addEventListener('click', closeInteractionModal);

  // Pointer lock setup
  setupPointerLock(container);
}

// ============================================================================
// POINTER LOCK (FPS-style mouse capture)
// ============================================================================
function setupPointerLock(container) {
  const crosshair = document.getElementById('crosshair');
  const instructions = document.getElementById('pointer-lock-instructions');

  // Show initial instructions
  if (pointerLockState.showInstructions) {
    instructions.classList.add('visible');
  }

  // Click to request pointer lock
  container.addEventListener('click', (e) => {
    // Don't lock if clicking on UI elements or in examine mode
    if (e.target.closest('#menu') || e.target.closest('#customization-panel') ||
        e.target.closest('#interaction-modal') || isDragging) {
      return;
    }

    // Request pointer lock
    if (!pointerLockState.isLocked) {
      container.requestPointerLock = container.requestPointerLock ||
                                     container.mozRequestPointerLock ||
                                     container.webkitRequestPointerLock;
      if (container.requestPointerLock) {
        container.requestPointerLock();
      }
    }
  });

  // Pointer lock change handler
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('mozpointerlockchange', onPointerLockChange);
  document.addEventListener('webkitpointerlockchange', onPointerLockChange);

  function onPointerLockChange() {
    const lockElement = document.pointerLockElement ||
                        document.mozPointerLockElement ||
                        document.webkitPointerLockElement;

    if (lockElement === container) {
      // Pointer is locked
      pointerLockState.isLocked = true;
      pointerLockState.showInstructions = false;
      crosshair.classList.add('visible');
      instructions.classList.remove('visible');
    } else {
      // Pointer is unlocked
      pointerLockState.isLocked = false;
      crosshair.classList.remove('visible');
    }
  }

  // Pointer lock error handler
  document.addEventListener('pointerlockerror', onPointerLockError);
  document.addEventListener('mozpointerlockerror', onPointerLockError);
  document.addEventListener('webkitpointerlockerror', onPointerLockError);

  function onPointerLockError() {
    console.warn('Pointer lock failed');
  }
}

function onMouseDown(event) {
  // Middle mouse button - quick interaction or hold for book reading mode
  if (event.button === 1) {
    event.preventDefault();
    updateMousePosition(event);

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(deskObjects, true);

    if (intersects.length > 0) {
      const clickedMesh = intersects[0].object;
      let object = clickedMesh;
      while (object.parent && !deskObjects.includes(object)) {
        object = object.parent;
      }

      if (deskObjects.includes(object)) {
        // For books, check if user is holding for reading mode
        if (object.userData.type === 'books') {
          bookReadingState.middleMouseDownTime = Date.now();
          bookReadingState.book = object;
          bookReadingState.holdTimeout = setTimeout(() => {
            // If book is open, enter reading mode after holding for 300ms
            // If book is closed, a hold does nothing extra (will just toggle on quick release)
            if (object.userData.isOpen) {
              enterBookReadingMode(object);
              bookReadingState.holdTimeout = null; // Mark as already handled
            }
          }, 300);
        } else {
          // Perform quick toggle interaction based on object type
          // Pass the clicked mesh so we can detect sub-component clicks (like power button)
          performQuickInteraction(object, clickedMesh);
        }
      }
    }
    return;
  }

  // Right mouse button - edit mode (customization panel)
  // Handle here because contextmenu doesn't fire properly when pointer is locked
  if (event.button === 2) {
    event.preventDefault();
    handleRightClick(event);
    return;
  }

  if (event.button !== 0) return; // Left click only

  // If in book reading mode, LMB click exits reading mode
  if (bookReadingState.active) {
    exitBookReadingMode();
    return;
  }

  // If in examine mode with LMB click:
  // - If clicked on the examined object, start dragging it
  // - Otherwise, don't exit (use LMB + scroll up to exit)
  if (examineState.active && examineState.object) {
    // Check if clicking on the examined object to start drag
    updateMousePosition(event);
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects([examineState.object], true);

    if (intersects.length > 0) {
      // Start dragging from examine mode
      const object = examineState.object;
      const originalPosition = examineState.originalPosition.clone();

      // Exit examine mode but don't animate back - start dragging instead
      object.userData.isExamining = false;
      object.userData.isReturning = false;
      object.userData.examineTarget = null;
      object.userData.examineScaleTarget = undefined;
      closeInteractionModal();

      // Move object back to desk level for dragging
      object.position.copy(originalPosition);
      if (examineState.originalScale) {
        object.scale.copy(examineState.originalScale);
      }

      // Clear examine state
      examineState.active = false;
      examineState.object = null;
      examineState.originalPosition = null;
      examineState.originalRotation = null;
      examineState.originalScale = null;

      // Start dragging
      selectedObject = object;
      isDragging = true;
      dragLayerOffset = 0;

      // Lift the object
      object.userData.isLifted = true;
      object.userData.targetY = object.userData.originalY + CONFIG.physics.liftHeight;

      document.getElementById('customization-panel').classList.remove('open');
      return;
    }
    // If not clicking on the object, don't do anything
    return;
  }

  updateMousePosition(event);

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(deskObjects, true);

  if (intersects.length > 0) {
    // Find the root object
    let object = intersects[0].object;
    while (object.parent && !deskObjects.includes(object)) {
      object = object.parent;
    }

    if (deskObjects.includes(object)) {
      // Check for double-click on laptop screen when zoomed in
      if (object.userData.type === 'laptop' && object.userData.isZoomedIn && object.userData.isOn && !object.userData.isBooting) {
        const clickedMesh = intersects[0].object;
        if (clickedMesh.name === 'screen') {
          const now = Date.now();
          const timeDiff = now - laptopDoubleClickState.lastClickTime;

          if (timeDiff < laptopDoubleClickState.doubleClickThreshold) {
            // Double-click detected - check if clicking on Obsidian icon area
            // Get UV coordinates of click on screen
            const uv = intersects[0].uv;
            if (uv) {
              // Obsidian icon is at top-left (approximately x: 0.1-0.25, y: 0.75-0.95)
              const iconX = 60 / 512; // Icon center X
              const iconY = 1 - (60 / 384); // Icon center Y (flipped)
              const iconRadius = 40 / 512; // Icon clickable radius

              const clickX = uv.x;
              const clickY = uv.y;

              // Check if click is near the icon
              const dx = clickX - iconX;
              const dy = clickY - iconY;
              const dist = Math.sqrt(dx * dx + dy * dy);

              if (dist < iconRadius * 2) {
                // Clicked on Obsidian icon - open markdown editor
                openMarkdownEditor(object);
                laptopDoubleClickState.lastClickTime = 0;
                return;
              }
            }
          }
          laptopDoubleClickState.lastClickTime = now;
          return; // Don't start dragging when in laptop zoom mode
        }
      }

      // Don't allow dragging if object is still animating from examine mode
      if (object.userData.isExamining || object.userData.isReturning) {
        return;
      }

      selectedObject = object;
      isDragging = true;
      dragLayerOffset = 0; // Reset layer offset when starting drag

      // Clear any examine mode state that might be interfering
      object.userData.examineTarget = null;
      object.userData.examineScaleTarget = undefined;
      object.userData.isExamining = false;
      object.userData.isReturning = false;

      // Reset fallen object when picked up
      if (object.userData.isFallen) {
        resetFallenObject(object);
      }

      // Lift the object
      object.userData.isLifted = true;
      object.userData.targetY = object.userData.originalY + CONFIG.physics.liftHeight;

      // Close customization panel when starting drag
      document.getElementById('customization-panel').classList.remove('open');
    }
  }
}

function onMouseMove(event) {
  // Use pointer lock movement data if locked, otherwise use delta from previous position
  let deltaX, deltaY;
  if (pointerLockState.isLocked) {
    // Use movementX/Y for pointer lock (raw mouse movement)
    deltaX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
    deltaY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;
  } else {
    // Fallback to calculating delta from previous position
    deltaX = event.clientX - previousMousePosition.x;
    deltaY = event.clientY - previousMousePosition.y;
  }

  // FPS-style camera look - active when pointer is locked
  // Camera continues to move even while dragging - object stays under crosshair
  const modal = document.getElementById('interaction-modal');
  const isModalOpen = modal && modal.classList.contains('open');

  // Check if any laptop is in zoom mode (allow camera rotation in laptop zoom mode)
  let inLaptopZoomMode = false;
  for (const obj of deskObjects) {
    if (obj.userData.type === 'laptop' && obj.userData.isZoomedIn) {
      inLaptopZoomMode = true;
      break;
    }
  }

  // Allow camera look normally, or in laptop zoom mode even with modal open
  if (pointerLockState.isLocked && cameraLookState.isLooking && (!isModalOpen || inLaptopZoomMode)) {
    // Update yaw and pitch
    cameraLookState.yaw -= deltaX * cameraLookState.sensitivity;
    cameraLookState.pitch -= deltaY * cameraLookState.sensitivity;

    // Clamp pitch to prevent flipping (looking too far up or down)
    cameraLookState.pitch = Math.max(cameraLookState.minPitch, Math.min(cameraLookState.maxPitch, cameraLookState.pitch));

    // Clamp yaw to prevent rotating too far left/right (seated person perspective)
    cameraLookState.yaw = Math.max(cameraLookState.minYaw, Math.min(cameraLookState.maxYaw, cameraLookState.yaw));

    // Update camera direction
    updateCameraLook();
  }

  previousMousePosition = { x: event.clientX, y: event.clientY };

  updateMousePosition(event);

  if (isDragging && selectedObject) {
    // Clamp to desk bounds
    const halfWidth = CONFIG.desk.width / 2 - 0.2;
    const halfDepth = CONFIG.desk.depth / 2 - 0.2;

    let newX, newZ;

    if (pointerLockState.isLocked) {
      // When pointer is locked, the object stays under the crosshair (screen center)
      // Camera moves, and we raycast from screen center to find where object should be
      const centerMouse = new THREE.Vector2(0, 0); // Screen center
      raycaster.setFromCamera(centerMouse, camera);
      const intersects = raycaster.intersectObject(dragPlane);

      if (intersects.length > 0) {
        const point = intersects[0].point;
        newX = Math.max(-halfWidth, Math.min(halfWidth, point.x));
        newZ = Math.max(-halfDepth, Math.min(halfDepth, point.z));
      } else {
        return; // No valid position
      }
    } else {
      // When pointer is not locked, use raycasting for absolute positioning
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(dragPlane);

      if (intersects.length > 0) {
        const point = intersects[0].point;
        newX = Math.max(-halfWidth, Math.min(halfWidth, point.x));
        newZ = Math.max(-halfDepth, Math.min(halfDepth, point.z));
      } else {
        return; // No valid position
      }
    }

    // Track drag velocity for physics collision force scaling
    const now = Date.now();
    if (physicsState.lastDragPosition && physicsState.lastDragTime > 0) {
      const dt = (now - physicsState.lastDragTime) / 1000; // Convert to seconds
      if (dt > 0 && dt < 0.1) { // Ignore stale data
        physicsState.dragVelocity.x = (newX - physicsState.lastDragPosition.x) / dt;
        physicsState.dragVelocity.z = (newZ - physicsState.lastDragPosition.z) / dt;
      }
    }
    physicsState.lastDragPosition = { x: newX, z: newZ };
    physicsState.lastDragTime = now;

    // Apply resistance when pulling object from under other objects
    const resistance = calculatePullResistance(selectedObject, selectedObject.position.x, selectedObject.position.z, newX, newZ);

    // If there's resistance, lerp toward target position instead of snapping
    if (resistance > 0) {
      const resistanceFactor = Math.max(0.1, 1 - resistance * 0.6);
      newX = selectedObject.position.x + (newX - selectedObject.position.x) * resistanceFactor;
      newZ = selectedObject.position.z + (newZ - selectedObject.position.z) * resistanceFactor;
    }

    selectedObject.position.x = newX;
    selectedObject.position.z = newZ;

    // Dynamically adjust Y position to stay above objects while dragging
    // This allows the dragged object to "ride" on top of static objects
    const dragStackY = calculateDragStackingY(selectedObject, newX, newZ);
    const liftedY = dragStackY + CONFIG.physics.liftHeight;
    selectedObject.userData.targetY = liftedY;
  }

  // Update tooltip
  if (!isDragging) {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(deskObjects, true);

    const tooltip = document.getElementById('tooltip');

    if (intersects.length > 0) {
      let object = intersects[0].object;
      while (object.parent && !deskObjects.includes(object)) {
        object = object.parent;
      }

      if (object.userData.name) {
        tooltip.textContent = object.userData.name;
        tooltip.style.left = event.clientX + 15 + 'px';
        tooltip.style.top = event.clientY + 15 + 'px';
        tooltip.classList.add('visible');
        document.body.style.cursor = 'grab';
      }
    } else {
      tooltip.classList.remove('visible');
      document.body.style.cursor = 'default';
    }
  } else {
    document.body.style.cursor = 'grabbing';
  }

  previousMousePosition = { x: event.clientX, y: event.clientY };
}

function onMouseUp(event) {
  // Middle mouse button - handle book quick click or cancel hold timeout
  if (event.button === 1) {
    // If in reading mode, don't exit on release - stay in mode until user clicks elsewhere
    if (bookReadingState.active) {
      return;
    }

    // If user releases before the hold timeout fired, it's a quick click - toggle book
    if (bookReadingState.holdTimeout) {
      clearTimeout(bookReadingState.holdTimeout);
      bookReadingState.holdTimeout = null;

      // Quick click on book - toggle open/close
      if (bookReadingState.book) {
        toggleBookOpen(bookReadingState.book);
        bookReadingState.book = null;
      }
    }
    return;
  }

  if (isDragging && selectedObject) {
    // Check for pen holder insertion
    const insertionResult = checkPenHolderInsertion(selectedObject);

    if (insertionResult.inserted) {
      // Pen was inserted into a holder - animate to position inside holder
      selectedObject.userData.isLifted = false;
      selectedObject.userData.inHolder = insertionResult.holder;
      selectedObject.userData.holderSlot = insertionResult.slot;
      selectedObject.userData.originalY = insertionResult.y;
      selectedObject.userData.targetY = insertionResult.y;
      selectedObject.position.x = insertionResult.x;
      selectedObject.position.z = insertionResult.z;
      // Rotate pen to stand upright in holder (reset from lying flat position)
      selectedObject.rotation.x = 0;
      selectedObject.rotation.y = 0;
      selectedObject.rotation.z = Math.random() * 0.2 - 0.1; // Slight random lean
      // Also reset the penBody sub-group rotation
      const penBody = selectedObject.getObjectByName('penBody');
      if (penBody) {
        penBody.rotation.x = 0;
        penBody.rotation.z = 0;
      }
    } else {
      // Check if dropping on top of another object (stacking)
      const dropY = calculateStackingY(selectedObject);

      // Update the original Y to the new stacking position
      selectedObject.userData.originalY = dropY;

      // Drop the object
      selectedObject.userData.isLifted = false;
      selectedObject.userData.targetY = dropY;

      // Clear holder reference if pen was removed from holder
      if (selectedObject.userData.inHolder) {
        selectedObject.userData.inHolder = null;
        selectedObject.userData.holderSlot = null;
      }
    }

    isDragging = false;
    dragLayerOffset = 0; // Reset layer offset when dropping

    // Reset drag velocity tracking
    physicsState.lastDragPosition = null;
    physicsState.lastDragTime = 0;
    physicsState.dragVelocity = { x: 0, z: 0 };

    saveState();
  }
}

// Check if a pen is being dropped on/into a pen holder (or empty mug)
// Returns { inserted: false } if not, or { inserted: true, holder, x, y, z, slot } if yes
function checkPenHolderInsertion(droppedObject) {
  // Only check for pens
  if (droppedObject.userData.type !== 'pen') {
    return { inserted: false };
  }

  const penX = droppedObject.position.x;
  const penZ = droppedObject.position.z;

  // Check all pen holders and empty mugs
  for (const obj of deskObjects) {
    const isHolder = obj.userData.type === 'pen-holder';
    const isEmptyMug = obj.userData.type === 'coffee' && obj.userData.liquidLevel < 0.1;

    if (!isHolder && !isEmptyMug) continue;
    if (obj === droppedObject) continue;

    const holderX = obj.position.x;
    const holderZ = obj.position.z;

    // Calculate distance from pen to holder center
    const dx = penX - holderX;
    const dz = penZ - holderZ;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Holder opening radius - very generous for easier insertion
    // Pen holder cylinder outer radius is 0.12, expand to 0.3 for easy drop detection
    // This creates a large target area around the holder
    const openingRadius = isHolder ? 0.3 : 0.2;

    // If pen is within the holder opening (generous detection area)
    if (dist < openingRadius) {
      // Find an available slot position
      const slot = findAvailableHolderSlot(obj, droppedObject);

      // Calculate Y position inside holder
      const holderScale = obj.userData.scale || obj.scale.x || 1.0;
      const baseY = obj.position.y;
      const penY = baseY + 0.15 * holderScale; // Pen tip rests inside, cap sticks up

      return {
        inserted: true,
        holder: obj,
        x: holderX + slot.offsetX,
        y: penY,
        z: holderZ + slot.offsetZ,
        slot: slot.index
      };
    }
  }

  return { inserted: false };
}

// Find an available slot position for a pen in a holder
function findAvailableHolderSlot(holder, excludePen) {
  // Get all pens currently in this holder
  const pensInHolder = deskObjects.filter(obj =>
    obj.userData.type === 'pen' &&
    obj.userData.inHolder === holder &&
    obj !== excludePen
  );

  // Slot positions (circular arrangement)
  const maxSlots = 6;
  const slotRadius = 0.04;
  const slots = [];

  for (let i = 0; i < maxSlots; i++) {
    const angle = (i / maxSlots) * Math.PI * 2;
    slots.push({
      index: i,
      offsetX: Math.cos(angle) * slotRadius,
      offsetZ: Math.sin(angle) * slotRadius,
      occupied: false
    });
  }

  // Mark occupied slots
  pensInHolder.forEach(pen => {
    if (pen.userData.holderSlot !== undefined && pen.userData.holderSlot < maxSlots) {
      slots[pen.userData.holderSlot].occupied = true;
    }
  });

  // Find first unoccupied slot
  const availableSlot = slots.find(s => !s.occupied);
  if (availableSlot) {
    return availableSlot;
  }

  // If all slots are full, use center with random offset
  return {
    index: -1,
    offsetX: (Math.random() - 0.5) * 0.02,
    offsetZ: (Math.random() - 0.5) * 0.02
  };
}

// Calculate Y position for dragging - allows object to ride on top of ANY object (no weight check)
// Uses dragLayerOffset to allow user-controlled stacking via scroll
function calculateDragStackingY(draggedObject, posX, posZ) {
  const draggedRadius = getObjectBounds(draggedObject);
  const baseY = getDeskSurfaceY();
  const draggedBaseOffset = OBJECT_PHYSICS[draggedObject.userData.type]?.baseOffset || 0;
  // Account for scale when calculating base offset
  const objectScale = draggedObject.userData.scale || draggedObject.scale.x || 1.0;

  // Default Y position (on desk surface) - apply scale to baseOffset
  let stackY = baseY + draggedBaseOffset * objectScale;

  // Collect all objects we're overlapping with and their heights
  const overlappingObjects = [];

  // Check all other objects to see if we're above any of them
  deskObjects.forEach(obj => {
    if (obj === draggedObject) return;
    if (obj.userData.isFallen) return;

    const otherRadius = getObjectBounds(obj);
    const otherPhysics = getObjectPhysics(obj);

    // Calculate horizontal distance
    const dx = posX - obj.position.x;
    const dz = posZ - obj.position.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);

    // Check if objects overlap horizontally (use smaller threshold for thin objects like paper)
    const collisionHeight = otherPhysics.height || 0.1;
    const overlapFactor = collisionHeight < 0.05 ? 0.9 : 0.7;  // More lenient for thin objects
    const overlapThreshold = (draggedRadius + otherRadius) * overlapFactor;

    if (horizontalDist < overlapThreshold) {
      // Calculate the top surface of the object below
      const objTopY = obj.position.y + otherPhysics.height;
      overlappingObjects.push({ obj, topY: objTopY });
    }
  });

  // If there are overlapping objects
  if (overlappingObjects.length > 0) {
    // Find the highest object
    const highestTop = overlappingObjects.reduce((max, o) => Math.max(max, o.topY), 0);

    if (dragLayerOffset > 0) {
      // User scrolled up - definitely stack on top with extra height
      stackY = Math.max(stackY, highestTop + draggedBaseOffset + dragLayerOffset * 0.02);
    } else {
      // Default behavior: stack on top of overlapping objects (more intuitive)
      // Objects will naturally rest on top of whatever they're dragged over
      stackY = Math.max(stackY, highestTop + draggedBaseOffset * objectScale);
    }
  }

  return stackY;
}

// Calculate Y position for stacking - checks if the object is above another and returns appropriate Y
// Now stacks automatically when dropped on top of another object, or manually with scroll up
function calculateStackingY(droppedObject) {
  const droppedRadius = getObjectBounds(droppedObject);
  const droppedPhysics = getObjectPhysics(droppedObject);
  const baseY = getDeskSurfaceY();
  const droppedBaseOffset = OBJECT_PHYSICS[droppedObject.userData.type]?.baseOffset || 0;
  // Account for scale when calculating base offset
  const objectScale = droppedObject.userData.scale || droppedObject.scale.x || 1.0;

  // Default Y position (on desk surface) - apply scale to baseOffset
  let stackY = baseY + droppedBaseOffset * objectScale;

  // If dragLayerOffset was used, the user explicitly wants to stack on top
  const wantsToStackOnTop = dragLayerOffset > 0;

  // Collect all overlapping objects
  const overlappingObjects = [];

  // Check all other objects to see if we're above any of them
  deskObjects.forEach(obj => {
    if (obj === droppedObject) return;
    if (obj.userData.isFallen) return;

    const otherRadius = getObjectBounds(obj);
    const otherPhysics = getObjectPhysics(obj);

    // Calculate horizontal distance
    const dx = droppedObject.position.x - obj.position.x;
    const dz = droppedObject.position.z - obj.position.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);

    // Check if objects overlap horizontally (with some tolerance for stacking)
    const overlapThreshold = (droppedRadius + otherRadius) * 0.6;

    if (horizontalDist < overlapThreshold) {
      // Calculate the top surface of the object below
      const objTopY = obj.position.y + otherPhysics.height;
      overlappingObjects.push({ obj, topY: objTopY });
    }
  });

  // If there are overlapping objects, stack on top automatically
  // Stacking happens either when user scrolled up (dragLayerOffset > 0) OR when object is being lifted
  if (overlappingObjects.length > 0) {
    // Find the highest overlapping object
    const highestTop = overlappingObjects.reduce((max, o) => Math.max(max, o.topY), 0);

    // Check if the dropped object was above desk level (lifted/stacking)
    const wasLifted = droppedObject.position.y > baseY + droppedBaseOffset * objectScale + 0.05;

    if (wantsToStackOnTop || wasLifted) {
      // Stack on top of all overlapping objects
      stackY = Math.max(stackY, highestTop + droppedBaseOffset * objectScale);
    }
    // If not lifted and not scrolled, use desk level (slide under)
  }

  return stackY;
}

// Calculate resistance when pulling an object from under other objects
// Returns a value from 0 (no resistance) to 1 (maximum resistance)
function calculatePullResistance(draggedObject, currentX, currentZ, targetX, targetZ) {
  const draggedRadius = getObjectBounds(draggedObject);
  const draggedPhysics = getObjectPhysics(draggedObject);
  let totalResistance = 0;

  // Check all other objects to see if dragged object is under any of them
  deskObjects.forEach(obj => {
    if (obj === draggedObject) return;
    if (obj.userData.isFallen) return;
    if (obj.userData.isLifted) return; // Don't apply resistance from lifted objects

    const otherRadius = getObjectBounds(obj);
    const otherPhysics = getObjectPhysics(obj);

    // Calculate horizontal distance at current position
    const dx = currentX - obj.position.x;
    const dz = currentZ - obj.position.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);

    // Check if objects overlap horizontally
    const overlapThreshold = (draggedRadius + otherRadius) * 0.8;

    if (horizontalDist < overlapThreshold) {
      // Check if dragged object is UNDER this object (based on Y positions)
      const draggedTop = draggedObject.position.y + draggedPhysics.height;
      const objBottom = obj.position.y;

      // If the object above us has its bottom at or above our top, we're under it
      if (objBottom >= draggedTop - 0.1 && objBottom < draggedTop + 0.3) {
        // Calculate how much we're trying to pull out from under
        const pullDist = Math.sqrt((targetX - currentX) ** 2 + (targetZ - currentZ) ** 2);
        // Resistance based on overlap and weight of object on top
        const overlap = 1 - (horizontalDist / overlapThreshold);
        const weightFactor = Math.min(1, (otherPhysics.weight || 0.5) * 0.5);
        totalResistance += overlap * weightFactor;
      }
    }
  });

  return Math.min(1, totalResistance);
}

function onMouseWheel(event) {
  updateMousePosition(event);

  // If in examine mode: scroll rotates object, LMB held + scroll UP exits, Shift+scroll scales
  if (examineState.active && examineState.object) {
    event.preventDefault();

    const object = examineState.object;

    // Scroll UP (deltaY < 0) with LMB held exits examine mode
    // This prevents accidental exits
    if (event.deltaY < 0 && !event.shiftKey && event.buttons === 1) {
      exitExamineMode();
      return;
    }

    if (event.shiftKey) {
      // Scale object (preserving proportions) with Shift+scroll
      const scaleDelta = event.deltaY > 0 ? 0.95 : 1.05;
      const minScale = 0.3;
      const maxScale = 3.0;

      const oldScale = object.scale.x;
      const newScale = oldScale * scaleDelta;
      if (newScale >= minScale && newScale <= maxScale) {
        object.scale.set(newScale, newScale, newScale);
        object.userData.scale = newScale;
        // Update the examine scale target to match the new scale
        // so the animation doesn't fight with the manual scale
        object.userData.examineScaleTarget = newScale;
        // Also update original scale so it persists when exiting examine mode
        if (examineState.originalScale) {
          examineState.originalScale.set(newScale, newScale, newScale);
        }
        // Adjust original Y position for when object returns to desk
        adjustObjectYForScale(object, oldScale, newScale);
        saveState();
      }
    } else {
      // Scroll (both UP and DOWN) rotates object around Y axis
      // Scroll DOWN (deltaY > 0) rotates clockwise, scroll UP (deltaY < 0) rotates counter-clockwise
      const rotationDelta = event.deltaY > 0 ? 0.15 : -0.15;
      object.rotation.y += rotationDelta;
      object.userData.rotationY = object.rotation.y;
      saveState();
    }
    return;
  }

  // If dragging an object
  if (isDragging && selectedObject) {
    event.preventDefault();

    if (event.deltaY > 0) {
      // Scroll down - enter examine mode (brings object closer)
      isDragging = false;
      selectedObject.userData.isLifted = false;
      selectedObject.userData.targetY = selectedObject.userData.originalY;
      dragLayerOffset = 0; // Reset layer offset
      enterExamineMode(selectedObject);
    } else if (event.deltaY < 0) {
      // Scroll up during drag - increase layer offset to stack on top
      dragLayerOffset += 5;
    }
    return;
  }

  // Check if hovering over an object
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(deskObjects, true);

  if (intersects.length > 0) {
    // Find the root object
    let object = intersects[0].object;
    while (object.parent && !deskObjects.includes(object)) {
      object = object.parent;
    }

    if (deskObjects.includes(object)) {
      event.preventDefault();

      // Check if Shift key is held for scaling, otherwise rotate
      if (event.shiftKey) {
        // Scale object (preserving proportions)
        const scaleDelta = event.deltaY > 0 ? 0.95 : 1.05;
        const minScale = 0.3;
        const maxScale = 3.0;

        const oldScale = object.scale.x;
        const newScale = oldScale * scaleDelta;
        if (newScale >= minScale && newScale <= maxScale) {
          object.scale.set(newScale, newScale, newScale);
          object.userData.scale = newScale;
          // Adjust Y position to keep object on desk surface
          adjustObjectYForScale(object, oldScale, newScale);
          saveState();
        }
      } else {
        // Rotate object around Y axis (perpendicular to desk)
        const rotationDelta = event.deltaY > 0 ? 0.15 : -0.15;
        object.rotation.y += rotationDelta;
        object.userData.rotationY = object.rotation.y;
        saveState();
      }
    }
  } else {
    // If not hovering over an object, adjust camera distance ONLY if Alt is held
    if (event.altKey) {
      event.preventDefault();
      const zoomDelta = event.deltaY > 0 ? 0.3 : -0.3;

      // Calculate new camera position (move along the view direction)
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);

      const newX = camera.position.x - direction.x * zoomDelta;
      const newY = camera.position.y - direction.y * zoomDelta;
      const newZ = camera.position.z - direction.z * zoomDelta;

      // Limit camera distance
      const minDistance = 3;
      const maxDistance = 15;
      const lookAt = new THREE.Vector3(CONFIG.camera.lookAt.x, CONFIG.camera.lookAt.y, CONFIG.camera.lookAt.z);
      const newPos = new THREE.Vector3(newX, newY, newZ);
      const distance = newPos.distanceTo(lookAt);

      if (distance >= minDistance && distance <= maxDistance) {
        camera.position.set(newX, newY, newZ);
        saveState();
      }
    }
  }
}

function onRightClick(event) {
  event.preventDefault();
  // Don't re-process if customization panel is already open
  // This prevents contextmenu from closing the panel opened by mousedown
  const panel = document.getElementById('customization-panel');
  if (panel && panel.classList.contains('open')) {
    return;
  }
  handleRightClick(event);
}

// Handle right-click for edit mode - works both when pointer is locked and unlocked
function handleRightClick(event) {
  // When pointer is locked, use screen center for raycasting
  // When unlocked, use mouse position
  let raycastMouse;
  if (pointerLockState.isLocked) {
    raycastMouse = new THREE.Vector2(0, 0); // Screen center
  } else {
    updateMousePosition(event);
    raycastMouse = mouse;
  }

  raycaster.setFromCamera(raycastMouse, camera);
  const intersects = raycaster.intersectObjects(deskObjects, true);

  if (intersects.length > 0) {
    let object = intersects[0].object;
    while (object.parent && !deskObjects.includes(object)) {
      object = object.parent;
    }

    if (deskObjects.includes(object)) {
      selectedObject = object;

      // Exit pointer lock to show cursor for panel interaction
      if (pointerLockState.isLocked) {
        document.exitPointerLock();
      }

      // Update customization panel
      document.getElementById('customization-title').textContent = `Customize: ${object.userData.name}`;
      document.getElementById('customization-panel').classList.add('open');

      // Highlight current colors
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));

      if (object.userData.mainColor) {
        const mainSwatch = document.querySelector(`#main-colors .color-swatch[data-color="${object.userData.mainColor}"]`);
        if (mainSwatch) mainSwatch.classList.add('selected');
      }

      if (object.userData.accentColor) {
        const accentSwatch = document.querySelector(`#accent-colors .color-swatch[data-color="${object.userData.accentColor}"]`);
        if (accentSwatch) accentSwatch.classList.add('selected');
      }

      // Add object-specific customization options
      updateCustomizationPanel(object);
    }
  } else {
    document.getElementById('customization-panel').classList.remove('open');
    selectedObject = null;
    // Clear dynamic options
    const dynamicOptions = document.getElementById('object-specific-options');
    if (dynamicOptions) dynamicOptions.innerHTML = '';
  }
}

// Update customization panel with object-specific options
function updateCustomizationPanel(object) {
  // Get or create the dynamic options container
  let dynamicOptions = document.getElementById('object-specific-options');
  if (!dynamicOptions) {
    // Create container after accent colors but before delete button
    dynamicOptions = document.createElement('div');
    dynamicOptions.id = 'object-specific-options';
    const deleteBtn = document.getElementById('delete-object');
    deleteBtn.parentNode.insertBefore(dynamicOptions, deleteBtn);
  }

  // Clear existing content
  dynamicOptions.innerHTML = '';

  // Add object-specific options based on type
  switch (object.userData.type) {
    case 'coffee':
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Drink Type</label>
          <div class="color-picker-container" id="drink-types" style="flex-direction: column; gap: 8px;">
            ${Object.entries(DRINK_COLORS).map(([key, drink]) => `
              <button class="drink-option ${object.userData.drinkType === key ? 'selected' : ''}"
                      data-drink="${key}"
                      style="width: 100%; padding: 8px 12px; background: ${object.userData.drinkType === key ? 'rgba(79, 70, 229, 0.3)' : 'rgba(255,255,255,0.1)'}; border: 1px solid ${object.userData.drinkType === key ? 'rgba(79, 70, 229, 0.6)' : 'rgba(255,255,255,0.2)'}; border-radius: 8px; color: #fff; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 10px;">
                <span style="width: 20px; height: 20px; border-radius: 4px; background: #${drink.color.toString(16).padStart(6, '0')};"></span>
                ${drink.name}
              </button>
            `).join('')}
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Fill Level: <span id="fill-level-display">${Math.round(object.userData.liquidLevel * 100)}%</span></label>
          <input type="range" id="fill-level" min="0" max="100" value="${object.userData.liquidLevel * 100}"
                 style="width: 100%; margin-top: 8px; accent-color: #4f46e5;">
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
            <input type="checkbox" id="hot-drink" ${object.userData.isHot ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #4f46e5;">
            Hot drink (shows steam)
          </label>
        </div>
      `;
      setupMugCustomizationHandlers(object);
      break;

    case 'metronome':
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>BPM: <span id="bpm-display">${object.userData.bpm}</span></label>
          <input type="range" id="metronome-bpm-edit" min="10" max="220" value="${object.userData.bpm}"
                 style="width: 100%; margin-top: 8px; accent-color: #4f46e5;">
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
            <input type="checkbox" id="tick-sound" ${object.userData.tickSound ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #4f46e5;">
            Enable tick sound
          </label>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Sound Type</label>
          <div style="display: flex; gap: 10px; margin-top: 8px;">
            <button id="sound-type-strike" class="timer-btn ${object.userData.tickSoundType !== 'beep' ? 'pause' : 'start'}" style="flex: 1;">
              Strike
            </button>
            <button id="sound-type-beep" class="timer-btn ${object.userData.tickSoundType === 'beep' ? 'pause' : 'start'}" style="flex: 1;">
              Beep
            </button>
          </div>
        </div>
      `;
      setupMetronomeCustomizationHandlers(object);
      break;

    case 'photo-frame':
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Photo</label>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
            <label style="display: inline-block; padding: 10px 15px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 8px; color: #fff; cursor: pointer; text-align: center;">
              Choose Photo
              <input type="file" id="photo-upload-edit" accept="image/*" style="display: none;">
            </label>
            <button id="photo-clear-edit" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #ef4444; cursor: pointer;">
              Clear Photo
            </button>
          </div>
        </div>
      `;
      setupPhotoFrameCustomizationHandlers(object);
      break;

    case 'books':
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Book Title</label>
          <input type="text" id="book-title-edit" value="${object.userData.bookTitle || ''}"
                 placeholder="Enter book title"
                 style="width: 100%; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #fff; margin-top: 8px;">
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Title Color</label>
          <div id="book-title-colors" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;">
            <div class="color-swatch${(object.userData.titleColor || '#ffffff') === '#ffffff' ? ' selected' : ''}" style="background: #ffffff; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${(object.userData.titleColor || '#ffffff') === '#ffffff' ? '#fff' : 'transparent'};" data-color="#ffffff"></div>
            <div class="color-swatch${object.userData.titleColor === '#000000' ? ' selected' : ''}" style="background: #000000; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#000000' ? '#fff' : 'rgba(255,255,255,0.3)'};" data-color="#000000"></div>
            <div class="color-swatch${object.userData.titleColor === '#fbbf24' ? ' selected' : ''}" style="background: #fbbf24; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#fbbf24' ? '#fff' : 'transparent'};" data-color="#fbbf24"></div>
            <div class="color-swatch${object.userData.titleColor === '#ef4444' ? ' selected' : ''}" style="background: #ef4444; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#ef4444' ? '#fff' : 'transparent'};" data-color="#ef4444"></div>
            <div class="color-swatch${object.userData.titleColor === '#22c55e' ? ' selected' : ''}" style="background: #22c55e; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#22c55e' ? '#fff' : 'transparent'};" data-color="#22c55e"></div>
            <div class="color-swatch${object.userData.titleColor === '#3b82f6' ? ' selected' : ''}" style="background: #3b82f6; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#3b82f6' ? '#fff' : 'transparent'};" data-color="#3b82f6"></div>
            <div class="color-swatch${object.userData.titleColor === '#8b5cf6' ? ' selected' : ''}" style="background: #8b5cf6; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#8b5cf6' ? '#fff' : 'transparent'};" data-color="#8b5cf6"></div>
            <div class="color-swatch${object.userData.titleColor === '#ec4899' ? ' selected' : ''}" style="background: #ec4899; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#ec4899' ? '#fff' : 'transparent'};" data-color="#ec4899"></div>
            <div class="color-swatch${object.userData.titleColor === '#c084fc' ? ' selected' : ''}" style="background: #c084fc; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#c084fc' ? '#fff' : 'transparent'};" data-color="#c084fc"></div>
            <div class="color-swatch${object.userData.titleColor === '#64748b' ? ' selected' : ''}" style="background: #64748b; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#64748b' ? '#fff' : 'transparent'};" data-color="#64748b"></div>
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>PDF File</label>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
            <label style="display: inline-block; padding: 10px 15px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 8px; color: #fff; cursor: pointer; text-align: center;">
              ${object.userData.pdfPath ? 'Change PDF' : 'Choose PDF'}
              <input type="file" id="book-pdf-edit" accept=".pdf" style="display: none;">
            </label>
            ${object.userData.pdfPath ? `
              <div style="color: rgba(255,255,255,0.5); font-size: 12px;">
                Current: ${object.userData.pdfPath.split('/').pop() || object.userData.pdfPath.split('\\\\').pop()}
              </div>
              <button id="book-pdf-clear-edit" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #ef4444; cursor: pointer;">
                Clear PDF
              </button>
            ` : ''}
          </div>
        </div>
      `;
      setupBookCustomizationHandlers(object);
      break;

    case 'pen':
      const penBodyColor = object.userData.mainColor || '#3b82f6';
      const penInkColor = object.userData.inkColor || object.userData.mainColor || '#3b82f6';
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Body Color</label>
          <div id="pen-body-colors" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;">
            <div class="color-swatch${penBodyColor === '#3b82f6' ? ' selected' : ''}" style="background: #3b82f6; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#3b82f6' ? '#fff' : 'transparent'};" data-color="#3b82f6"></div>
            <div class="color-swatch${penBodyColor === '#ef4444' ? ' selected' : ''}" style="background: #ef4444; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#ef4444' ? '#fff' : 'transparent'};" data-color="#ef4444"></div>
            <div class="color-swatch${penBodyColor === '#22c55e' ? ' selected' : ''}" style="background: #22c55e; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#22c55e' ? '#fff' : 'transparent'};" data-color="#22c55e"></div>
            <div class="color-swatch${penBodyColor === '#1a1a1a' ? ' selected' : ''}" style="background: #1a1a1a; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#1a1a1a' ? '#fff' : 'rgba(255,255,255,0.3)'};" data-color="#1a1a1a"></div>
            <div class="color-swatch${penBodyColor === '#8b5cf6' ? ' selected' : ''}" style="background: #8b5cf6; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#8b5cf6' ? '#fff' : 'transparent'};" data-color="#8b5cf6"></div>
            <div class="color-swatch${penBodyColor === '#f97316' ? ' selected' : ''}" style="background: #f97316; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#f97316' ? '#fff' : 'transparent'};" data-color="#f97316"></div>
            <div class="color-swatch${penBodyColor === '#ec4899' ? ' selected' : ''}" style="background: #ec4899; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#ec4899' ? '#fff' : 'transparent'};" data-color="#ec4899"></div>
            <div class="color-swatch${penBodyColor === '#06b6d4' ? ' selected' : ''}" style="background: #06b6d4; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#06b6d4' ? '#fff' : 'transparent'};" data-color="#06b6d4"></div>
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Ink Color (for writing)</label>
          <div id="pen-ink-colors" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;">
            <div class="color-swatch${penInkColor === '#3b82f6' ? ' selected' : ''}" style="background: #3b82f6; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#3b82f6' ? '#fff' : 'transparent'};" data-color="#3b82f6"></div>
            <div class="color-swatch${penInkColor === '#ef4444' ? ' selected' : ''}" style="background: #ef4444; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#ef4444' ? '#fff' : 'transparent'};" data-color="#ef4444"></div>
            <div class="color-swatch${penInkColor === '#22c55e' ? ' selected' : ''}" style="background: #22c55e; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#22c55e' ? '#fff' : 'transparent'};" data-color="#22c55e"></div>
            <div class="color-swatch${penInkColor === '#000000' ? ' selected' : ''}" style="background: #000000; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#000000' ? '#fff' : 'rgba(255,255,255,0.3)'};" data-color="#000000"></div>
            <div class="color-swatch${penInkColor === '#8b5cf6' ? ' selected' : ''}" style="background: #8b5cf6; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#8b5cf6' ? '#fff' : 'transparent'};" data-color="#8b5cf6"></div>
            <div class="color-swatch${penInkColor === '#f97316' ? ' selected' : ''}" style="background: #f97316; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#f97316' ? '#fff' : 'transparent'};" data-color="#f97316"></div>
            <div class="color-swatch${penInkColor === '#ec4899' ? ' selected' : ''}" style="background: #ec4899; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#ec4899' ? '#fff' : 'transparent'};" data-color="#ec4899"></div>
            <div class="color-swatch${penInkColor === '#06b6d4' ? ' selected' : ''}" style="background: #06b6d4; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#06b6d4' ? '#fff' : 'transparent'};" data-color="#06b6d4"></div>
          </div>
        </div>
      `;
      setupPenCustomizationHandlers(object);
      break;

    case 'laptop':
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Power LED Color</label>
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px;">
            <input type="color" id="laptop-led-color-edit" value="${object.userData.powerLedColor || '#00ff00'}"
                   style="width: 40px; height: 30px; border: none; cursor: pointer; border-radius: 4px;">
            <span id="laptop-led-color-display" style="color: rgba(255,255,255,0.7);">${object.userData.powerLedColor || '#00ff00'}</span>
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Boot Screen Image</label>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
            <label style="display: inline-block; padding: 10px 15px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 8px; color: #fff; cursor: pointer; text-align: center;">
              ${object.userData.bootScreenDataUrl ? 'Change Boot Screen' : 'Upload Boot Screen'}
              <input type="file" id="laptop-boot-screen-edit" accept="image/*" style="display: none;">
            </label>
            ${object.userData.bootScreenDataUrl ? `
              <button id="laptop-boot-screen-clear" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #ef4444; cursor: pointer;">
                Clear Boot Screen
              </button>
            ` : ''}
          </div>
        </div>
      `;
      setupLaptopCustomizationHandlers(object);
      break;
  }
}

// Helper function to add scroll-based slider adjustment
function addScrollToSlider(slider, onChange) {
  if (!slider) return;
  slider.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const step = parseFloat(slider.step) || 1;
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    let newValue = parseFloat(slider.value);

    // Scroll up = increase, scroll down = decrease
    if (e.deltaY < 0) {
      newValue = Math.min(max, newValue + step);
    } else {
      newValue = Math.max(min, newValue - step);
    }

    slider.value = newValue;
    // Trigger the input event so existing handlers work
    slider.dispatchEvent(new Event('input'));
    if (onChange) onChange(newValue);
  }, { passive: false });
}

function setupMugCustomizationHandlers(object) {
  // Drink type buttons
  setTimeout(() => {
    const drinkButtons = document.querySelectorAll('#drink-types button');
    drinkButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const drinkType = btn.dataset.drink;
        object.userData.drinkType = drinkType;

        // Update liquid color
        const liquid = object.getObjectByName('liquid');
        const liquidBody = object.getObjectByName('liquidBody');
        if (DRINK_COLORS[drinkType]) {
          if (liquid) {
            liquid.material.color.set(DRINK_COLORS[drinkType].color);
            liquid.material.needsUpdate = true;
          }
          if (liquidBody) {
            liquidBody.material.color.set(DRINK_COLORS[drinkType].color);
            liquidBody.material.needsUpdate = true;
          }
        }

        // Update button styles
        drinkButtons.forEach(b => {
          b.style.background = b.dataset.drink === drinkType ? 'rgba(79, 70, 229, 0.3)' : 'rgba(255,255,255,0.1)';
          b.style.borderColor = b.dataset.drink === drinkType ? 'rgba(79, 70, 229, 0.6)' : 'rgba(255,255,255,0.2)';
        });

        saveState();
      });
    });

    // Fill level slider
    const fillSlider = document.getElementById('fill-level');
    const fillDisplay = document.getElementById('fill-level-display');
    if (fillSlider) {
      fillSlider.addEventListener('input', (e) => {
        const level = parseInt(e.target.value) / 100;
        object.userData.liquidLevel = level;
        fillDisplay.textContent = `${Math.round(level * 100)}%`;

        // Update liquid visibility and position
        const liquid = object.getObjectByName('liquid');
        const liquidBody = object.getObjectByName('liquidBody');
        if (liquid) {
          liquid.visible = level > 0.05;
          // The liquid surface (disc) position based on fill level
          // Base position is 0.03 (bottom of mug), max is 0.17 (near rim)
          liquid.position.y = 0.03 + level * 0.14;
        }
        if (liquidBody) {
          liquidBody.visible = level > 0.05;
          // Scale and position the liquid body cylinder
          liquidBody.scale.y = Math.max(0.1, level);
          liquidBody.position.y = 0.015 + level * 0.07;
        }

        saveState();
      });

      // Add scroll-based adjustment for fill slider
      addScrollToSlider(fillSlider);
    }

    // Hot drink checkbox
    const hotCheckbox = document.getElementById('hot-drink');
    if (hotCheckbox) {
      hotCheckbox.addEventListener('change', (e) => {
        object.userData.isHot = e.target.checked;
        updateSteamVisibility(object);
        saveState();
      });
    }
  }, 0);
}

function setupMetronomeCustomizationHandlers(object) {
  setTimeout(() => {
    const bpmSlider = document.getElementById('metronome-bpm-edit');
    const bpmDisplay = document.getElementById('bpm-display');
    if (bpmSlider) {
      bpmSlider.addEventListener('input', (e) => {
        object.userData.bpm = parseInt(e.target.value);
        bpmDisplay.textContent = e.target.value;
        saveState();
      });

      // Add scroll-based adjustment for BPM slider
      addScrollToSlider(bpmSlider);
    }

    const tickCheckbox = document.getElementById('tick-sound');
    if (tickCheckbox) {
      tickCheckbox.addEventListener('change', (e) => {
        object.userData.tickSound = e.target.checked;
        saveState();
      });
    }

    // Sound type buttons
    const strikeBtn = document.getElementById('sound-type-strike');
    const beepBtn = document.getElementById('sound-type-beep');

    const updateSoundTypeButtons = () => {
      if (strikeBtn && beepBtn) {
        if (object.userData.tickSoundType === 'beep') {
          beepBtn.classList.remove('start');
          beepBtn.classList.add('pause');
          strikeBtn.classList.remove('pause');
          strikeBtn.classList.add('start');
        } else {
          strikeBtn.classList.remove('start');
          strikeBtn.classList.add('pause');
          beepBtn.classList.remove('pause');
          beepBtn.classList.add('start');
        }
      }
    };

    updateSoundTypeButtons();

    if (strikeBtn) {
      strikeBtn.addEventListener('click', () => {
        object.userData.tickSoundType = 'strike';
        updateSoundTypeButtons();
        saveState();
      });
    }

    if (beepBtn) {
      beepBtn.addEventListener('click', () => {
        object.userData.tickSoundType = 'beep';
        updateSoundTypeButtons();
        saveState();
      });
    }
  }, 0);
}

function setupLaptopCustomizationHandlers(object) {
  setTimeout(() => {
    const ledColorInput = document.getElementById('laptop-led-color-edit');
    const ledColorDisplay = document.getElementById('laptop-led-color-display');
    const bootScreenInput = document.getElementById('laptop-boot-screen-edit');
    const bootScreenClear = document.getElementById('laptop-boot-screen-clear');

    if (ledColorInput) {
      ledColorInput.addEventListener('input', (e) => {
        const color = e.target.value;
        object.userData.powerLedColor = color;
        if (ledColorDisplay) ledColorDisplay.textContent = color;

        // Update LED color if laptop is on
        if (object.userData.isOn) {
          const powerLed = object.getObjectByName('powerLed');
          if (powerLed) {
            const ledColor = new THREE.Color(color);
            powerLed.material.color.copy(ledColor);
            powerLed.material.emissive.copy(ledColor);
          }
        }
        saveState();
      });
    }

    if (bootScreenInput) {
      bootScreenInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const imageUrl = event.target.result;
            object.userData.bootScreenDataUrl = imageUrl;
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(imageUrl, (texture) => {
              object.userData.bootScreenTexture = texture;
              saveState();
            });
          };
          reader.readAsDataURL(file);
        }
      });
    }

    if (bootScreenClear) {
      bootScreenClear.addEventListener('click', () => {
        if (object.userData.bootScreenTexture) {
          object.userData.bootScreenTexture.dispose();
          object.userData.bootScreenTexture = null;
        }
        object.userData.bootScreenDataUrl = null;
        saveState();
        // Refresh the panel to update button text
        showCustomizationPanel(object);
      });
    }
  }, 0);
}

function setupPenCustomizationHandlers(object) {
  setTimeout(() => {
    const bodyColorsContainer = document.getElementById('pen-body-colors');
    const inkColorsContainer = document.getElementById('pen-ink-colors');

    // Body color swatches
    if (bodyColorsContainer) {
      const swatches = bodyColorsContainer.querySelectorAll('.color-swatch');
      swatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
          const color = swatch.dataset.color;
          object.userData.mainColor = color;

          // Update the pen body and cap color
          object.children.forEach(child => {
            if (child.isMesh && child.material) {
              // Body and cap share the same material by reference, update body
              if (child.geometry.type === 'CylinderGeometry' && child.position.y > 0.1) {
                child.material.color.set(color);
                child.material.needsUpdate = true;
              }
            }
          });

          // Update swatch selection visuals
          swatches.forEach(s => {
            s.style.borderColor = s.dataset.color === color ? '#fff' : (s.dataset.color === '#1a1a1a' ? 'rgba(255,255,255,0.3)' : 'transparent');
          });

          saveState();
        });
      });
    }

    // Ink color swatches
    if (inkColorsContainer) {
      const swatches = inkColorsContainer.querySelectorAll('.color-swatch');
      swatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
          const color = swatch.dataset.color;
          object.userData.inkColor = color;

          // Update swatch selection visuals
          swatches.forEach(s => {
            s.style.borderColor = s.dataset.color === color ? '#fff' : (s.dataset.color === '#000000' ? 'rgba(255,255,255,0.3)' : 'transparent');
          });

          saveState();
        });
      });
    }
  }, 0);
}

function setupPhotoFrameCustomizationHandlers(object) {
  setTimeout(() => {
    const uploadInput = document.getElementById('photo-upload-edit');
    const clearBtn = document.getElementById('photo-clear-edit');

    if (uploadInput) {
      uploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const imageUrl = event.target.result;
            // Store data URL for persistence
            object.userData.photoDataUrl = imageUrl;
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(imageUrl, (texture) => {
              const photoSurface = object.getObjectByName('photoSurface');
              if (photoSurface) {
                photoSurface.material.map = texture;
                photoSurface.material.color.set(0xffffff);
                photoSurface.material.needsUpdate = true;
                object.userData.photoTexture = texture;
              }
              saveState(); // Save after photo is loaded
            });
          };
          reader.readAsDataURL(file);
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const photoSurface = object.getObjectByName('photoSurface');
        if (photoSurface) {
          if (object.userData.photoTexture) {
            object.userData.photoTexture.dispose();
            object.userData.photoTexture = null;
          }
          object.userData.photoDataUrl = null;
          photoSurface.material.map = null;
          photoSurface.material.color.set(new THREE.Color(object.userData.accentColor));
          photoSurface.material.needsUpdate = true;
          saveState();
        }
      });
    }
  }, 0);
}

function setupBookCustomizationHandlers(object) {
  setTimeout(() => {
    const titleInput = document.getElementById('book-title-edit');
    const titleColorsContainer = document.getElementById('book-title-colors');
    const pdfInput = document.getElementById('book-pdf-edit');
    const clearBtn = document.getElementById('book-pdf-clear-edit');

    // Helper to update book title textures
    const updateBookTitleTextures = () => {
      if (object.userData.createTitleTexture) {
        const closedGroup = object.getObjectByName('closedBook');
        if (closedGroup) {
          const coverTitle = closedGroup.getObjectByName('coverTitle');
          if (coverTitle) {
            // Use larger font size (64) for cover title
            const newCoverTexture = object.userData.createTitleTexture(object.userData.bookTitle, 320, 116, 64);
            coverTitle.material.map = newCoverTexture;
            coverTitle.material.needsUpdate = true;
          }
          // Spine title removed - no longer updated
        }
      }
    };

    if (titleInput) {
      titleInput.addEventListener('change', (e) => {
        object.userData.bookTitle = e.target.value;
        updateBookTitleTextures();
        saveState();
      });
      titleInput.addEventListener('blur', (e) => {
        object.userData.bookTitle = e.target.value;
        updateBookTitleTextures();
        saveState();
      });
    }

    // Title color preset swatches
    if (titleColorsContainer) {
      const swatches = titleColorsContainer.querySelectorAll('.color-swatch');
      swatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
          const color = swatch.dataset.color;
          object.userData.titleColor = color;
          updateBookTitleTextures();
          saveState();
          // Update swatch selection visuals
          swatches.forEach(s => {
            s.style.borderColor = s.dataset.color === color ? '#fff' : (s.dataset.color === '#000000' ? 'rgba(255,255,255,0.3)' : 'transparent');
          });
        });
      });
    }

    if (pdfInput) {
      pdfInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          object.userData.pdfPath = file.path || file.name;
          saveState();
          // Update the customization panel to show the new file
          updateCustomizationPanel(object);
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        object.userData.pdfPath = null;
        object.userData.totalPages = 0;
        object.userData.currentPage = 0;
        saveState();
        // Update the customization panel
        updateCustomizationPanel(object);
      });
    }
  }, 0);
}

// Update steam visibility for mug
function updateSteamVisibility(object) {
  let steam = object.getObjectByName('steam');

  if (object.userData.isHot && object.userData.liquidLevel > 0.1) {
    if (!steam) {
      // Create steam particles
      steam = createSteamEffect();
      steam.name = 'steam';
      object.add(steam);
    }
    steam.visible = true;
  } else if (steam) {
    steam.visible = false;
  }
}

// Create simple steam effect
function createSteamEffect() {
  const steamGroup = new THREE.Group();

  // Create multiple steam wisps
  for (let i = 0; i < 3; i++) {
    const wispGeometry = new THREE.SphereGeometry(0.02, 8, 8);
    const wispMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      roughness: 1
    });
    const wisp = new THREE.Mesh(wispGeometry, wispMaterial);
    wisp.position.set(
      (Math.random() - 0.5) * 0.05,
      0.22 + i * 0.03,
      (Math.random() - 0.5) * 0.05
    );
    wisp.scale.set(1 + i * 0.2, 1.5 + i * 0.3, 1 + i * 0.2);
    steamGroup.add(wisp);
  }

  return steamGroup;
}

// Create liquid pour effect (droplets falling from tilted mug)
function createPourEffect(drinkType = 'coffee') {
  const pourGroup = new THREE.Group();
  const drinkColor = DRINK_COLORS[drinkType] ? DRINK_COLORS[drinkType].color : 0x3d2914;

  // Create multiple droplets
  for (let i = 0; i < 5; i++) {
    const dropGeometry = new THREE.SphereGeometry(0.015, 6, 6);
    const dropMaterial = new THREE.MeshStandardMaterial({
      color: drinkColor,
      transparent: true,
      opacity: 0.8,
      roughness: 0.3
    });
    const drop = new THREE.Mesh(dropGeometry, dropMaterial);
    drop.position.set(
      0.08 + (Math.random() - 0.5) * 0.02, // Offset to the side (where mug edge would be)
      0.15 - i * 0.08, // Staggered heights
      (Math.random() - 0.5) * 0.02
    );
    pourGroup.add(drop);
  }

  return pourGroup;
}

// Double-click examine removed - use drag+scroll down to enter, scroll up to exit

function enterExamineMode(object) {
  // Store original state
  examineState.active = true;
  examineState.object = object;
  examineState.originalPosition = object.position.clone();
  examineState.originalRotation = object.rotation.clone();
  examineState.originalScale = object.scale.clone();

  // Use shorter examine distance for small objects like pens
  // This brings them closer to the camera for better visibility
  let examineDistance = 2.0; // Default distance
  let yOffset = -0.1; // Position slightly below center of view

  // Adjust distance based on object type
  if (object.userData.type === 'pen') {
    examineDistance = 1.2; // Bring pen much closer
    yOffset = -0.2; // Lower position so cursor can reach
  } else if (object.userData.type === 'books') {
    examineDistance = 1.5;
  }

  examineState.examineDistance = examineDistance;

  // Calculate position close to camera
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  // Target position in front of the camera (slightly below center)
  const targetPosition = new THREE.Vector3(
    camera.position.x + direction.x * examineDistance,
    camera.position.y + direction.y * examineDistance + yOffset,
    camera.position.z + direction.z * examineDistance
  );

  // Animate object to examine position
  object.userData.examineTarget = targetPosition;
  object.userData.isExamining = true;

  // Scale up slightly for better view
  const examineScale = Math.max(object.scale.x * 1.5, 1.2);
  object.userData.examineScaleTarget = examineScale;

  // Add visual hint that object is being examined
  document.body.style.cursor = 'zoom-out';
}

function exitExamineMode() {
  if (!examineState.active || !examineState.object) return;

  const object = examineState.object;

  // Store original position locally before clearing state
  const originalPosition = examineState.originalPosition.clone();
  const originalScale = examineState.originalScale.clone();

  // Animate back to original position
  object.userData.examineTarget = originalPosition;
  object.userData.examineScaleTarget = originalScale.x;
  object.userData.isExamining = false;
  object.userData.isReturning = true;

  // Close interaction modal if open
  closeInteractionModal();

  // Reset cursor
  document.body.style.cursor = 'default';

  // Clear examine state immediately (animation still uses local copies)
  examineState.active = false;
  examineState.object = null;
  examineState.originalPosition = null;
  examineState.originalRotation = null;
  examineState.originalScale = null;

  // Clear animation flags after animation completes
  setTimeout(() => {
    if (object.userData.isReturning) {
      object.position.copy(originalPosition);
      object.scale.copy(originalScale);
    }
    // Clean up all examine-related flags
    object.userData.isReturning = false;
    object.userData.examineTarget = null;
    object.userData.examineScaleTarget = undefined;
  }, 500);
}

// ============================================================================
// OBJECT INTERACTION MODAL
// ============================================================================
function openInteractionModal(object) {
  interactionObject = object;
  const modal = document.getElementById('interaction-modal');
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('interaction-content');
  const title = document.getElementById('modal-title');
  const icon = document.getElementById('modal-icon');

  // Set title and icon based on object type
  const objectIcons = {
    'clock': '🕐',
    'lamp': '💡',
    'laptop': '💻',
    'globe': '🌍',
    'hourglass': '⏳',
    'metronome': '🎵',
    'photo-frame': '🖼️',
    'coffee': '☕',
    'pen-holder': '🖊️',
    'books': '📕',
    'notebook': '📓',
    'paper': '📄'
  };

  title.textContent = object.userData.name;
  icon.textContent = objectIcons[object.userData.type] || '⚙️';

  // Generate content based on object type
  content.innerHTML = getInteractionContent(object);

  // Setup interaction handlers
  setupInteractionHandlers(object);

  // Exit pointer lock to show cursor for panel interaction
  if (pointerLockState.isLocked) {
    document.exitPointerLock();
  }

  // Show modal
  modal.classList.add('open');
  overlay.classList.add('open');
}

function closeInteractionModal() {
  const modal = document.getElementById('interaction-modal');
  const overlay = document.getElementById('modal-overlay');

  modal.classList.remove('open');
  overlay.classList.remove('open');
  interactionObject = null;
}

function getInteractionContent(object) {
  switch (object.userData.type) {
    case 'clock':
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" id="timer-display">00:00:00</div>
          </div>
          <div class="timer-input-group">
            <input type="number" id="timer-hours" min="0" max="23" value="0" placeholder="HH">
            <span>:</span>
            <input type="number" id="timer-minutes" min="0" max="59" value="5" placeholder="MM">
            <span>:</span>
            <input type="number" id="timer-seconds" min="0" max="59" value="0" placeholder="SS">
          </div>
          <div class="timer-buttons">
            <button class="timer-btn start" id="timer-start">Start</button>
            <button class="timer-btn pause" id="timer-pause" style="display:none">Pause</button>
            <button class="timer-btn reset" id="timer-reset">Reset</button>
          </div>
        </div>
      `;

    case 'lamp':
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" id="lamp-status">${object.userData.isOn ? 'ON' : 'OFF'}</div>
          </div>
          <div class="timer-buttons">
            <button class="timer-btn ${object.userData.isOn ? 'pause' : 'start'}" id="lamp-toggle">
              ${object.userData.isOn ? 'Turn Off' : 'Turn On'}
            </button>
          </div>
        </div>
      `;

    case 'laptop':
      const screenStatus = object.userData.isOn
        ? (object.userData.isBooting ? 'Booting...' : 'On')
        : 'Off';
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">Laptop</div>
            <div style="color: rgba(255,255,255,0.6); margin-top: 10px;">Status: ${screenStatus}</div>
          </div>
          <div class="timer-buttons" style="flex-direction: column; gap: 10px;">
            <button class="timer-btn ${object.userData.isOn ? 'pause' : 'start'}" id="laptop-power"
                    ${object.userData.isBooting ? 'disabled' : ''}>
              ${object.userData.isOn ? 'Shutdown' : 'Power On'}
            </button>
            ${object.userData.isOn && !object.userData.isBooting ? `
              <button class="timer-btn start" id="laptop-editor">Open Markdown Editor</button>
            ` : ''}
          </div>
          <div style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 15px;">
            <div style="color: rgba(255,255,255,0.7); font-size: 12px; margin-bottom: 8px;">Boot Screen Image</div>
            <div style="display: flex; gap: 8px;">
              <label class="timer-btn start" style="flex: 1; text-align: center; cursor: pointer;">
                ${object.userData.bootScreenDataUrl ? 'Change' : 'Upload'}
                <input type="file" id="laptop-boot-screen" accept="image/*" style="display: none;">
              </label>
              ${object.userData.bootScreenDataUrl ? `
                <button class="timer-btn reset" id="laptop-boot-clear">Clear</button>
              ` : ''}
            </div>
          </div>
          <div style="margin-top: 10px;">
            <div style="color: rgba(255,255,255,0.7); font-size: 12px; margin-bottom: 8px;">Power LED Color</div>
            <input type="color" id="laptop-led-color" value="${object.userData.powerLedColor || '#00ff00'}"
                   style="width: 40px; height: 30px; border: none; cursor: pointer;">
          </div>
          ${object.userData.isOn && !object.userData.isBooting ? `
            <div style="margin-top: 15px; color: rgba(255,255,255,0.5); font-size: 12px;">
              Middle-click laptop to toggle power
            </div>
          ` : ''}
        </div>
      `;

    case 'globe':
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">Rotation: ${object.userData.rotationSpeed > 0 ? 'ON' : 'OFF'}</div>
          </div>
          <div class="timer-buttons">
            <button class="timer-btn ${object.userData.rotationSpeed > 0 ? 'pause' : 'start'}" id="globe-toggle">
              ${object.userData.rotationSpeed > 0 ? 'Stop Rotation' : 'Start Rotation'}
            </button>
          </div>
        </div>
      `;

    case 'hourglass':
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">Hourglass</div>
          </div>
          <div class="timer-buttons">
            <button class="timer-btn start" id="hourglass-flip">Flip Hourglass</button>
          </div>
        </div>
      `;

    case 'metronome':
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" id="metronome-status" style="font-size: 28px;">${object.userData.isRunning ? 'RUNNING' : 'STOPPED'}</div>
            <div style="color: rgba(255,255,255,0.6); margin-top: 10px;">${object.userData.bpm} BPM</div>
          </div>
          <div class="timer-input-group">
            <input type="range" id="metronome-bpm" min="10" max="220" value="${object.userData.bpm}"
                   style="width: 100%; accent-color: #4f46e5;">
          </div>
          <div class="timer-buttons">
            <button class="timer-btn ${object.userData.isRunning ? 'pause' : 'start'}" id="metronome-toggle">
              ${object.userData.isRunning ? 'Stop' : 'Start'}
            </button>
            <button class="timer-btn ${object.userData.tickSound ? 'pause' : 'reset'}" id="metronome-sound">
              Sound: ${object.userData.tickSound ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      `;

    case 'photo-frame':
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">Photo Frame</div>
            <div style="color: rgba(255,255,255,0.6); margin-top: 10px;">Upload an image to display</div>
          </div>
          <div class="timer-buttons" style="flex-direction: column; gap: 15px;">
            <label class="timer-btn start" style="cursor: pointer; display: inline-block;">
              Choose Photo
              <input type="file" id="photo-upload" accept="image/*" style="display: none;">
            </label>
            <button class="timer-btn reset" id="photo-clear">Clear Photo</button>
          </div>
        </div>
      `;

    case 'coffee':
      const currentDrink = DRINK_COLORS[object.userData.drinkType] || DRINK_COLORS.coffee;
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">${currentDrink.name}</div>
            <div style="color: rgba(255,255,255,0.6); margin-top: 10px;">Middle-click to sip drink</div>
            <div style="color: rgba(255,255,255,0.5); margin-top: 5px;">Fill: ${Math.round(object.userData.liquidLevel * 100)}%</div>
          </div>
        </div>
      `;

    case 'pen-holder':
      const pensGroup = object.getObjectByName('pens');
      const availablePens = pensGroup ? pensGroup.children.filter(p => p.visible).map(p => p.userData.penColor) : [];
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">Pen Holder</div>
            <div style="color: rgba(255,255,255,0.6); margin-top: 10px;">
              ${drawingState.selectedPen ? `Holding: ${drawingState.selectedPen} pen` : 'Select a pen to draw'}
            </div>
          </div>
          <div class="timer-buttons" style="flex-wrap: wrap; gap: 10px;">
            ${[
              { name: 'red', color: '#ef4444' },
              { name: 'blue', color: '#3b82f6' },
              { name: 'green', color: '#22c55e' },
              { name: 'black', color: '#000000' }
            ].map(pen => {
              const isAvailable = availablePens.includes(pen.name);
              const isSelected = drawingState.selectedPen === pen.name;
              return `
                <button class="timer-btn ${isSelected ? 'pause' : 'start'}"
                        id="pen-${pen.name}"
                        style="min-width: 70px; background: ${isAvailable ? pen.color : '#444'}; opacity: ${isAvailable ? 1 : 0.3};"
                        ${!isAvailable ? 'disabled' : ''}>
                  ${pen.name.charAt(0).toUpperCase() + pen.name.slice(1)}
                </button>
              `;
            }).join('')}
          </div>
          ${drawingState.selectedPen ? `
            <div class="timer-buttons" style="margin-top: 15px;">
              <button class="timer-btn reset" id="pen-return">Return Pen</button>
            </div>
          ` : ''}
          <div style="color: rgba(255,255,255,0.5); margin-top: 15px; font-size: 12px;">
            With pen selected: hover over Notebook/Paper and draw with middle mouse button
          </div>
        </div>
      `;

    case 'books':
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">Book</div>
            <div style="color: rgba(255,255,255,0.6); margin-top: 10px;">
              ${object.userData.isOpen ? 'Book is open' : 'Middle-click to open'}
            </div>
          </div>
          <div style="margin-top: 15px;">
            <label style="color: rgba(255,255,255,0.7); display: block; margin-bottom: 8px;">Book Title</label>
            <input type="text" id="book-title" value="${object.userData.bookTitle || ''}"
                   placeholder="Enter book title"
                   style="width: 100%; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #fff;">
          </div>
          <div style="margin-top: 15px;">
            <label style="color: rgba(255,255,255,0.7); display: block; margin-bottom: 8px;">PDF File</label>
            <label class="timer-btn start" style="cursor: pointer; display: inline-block; width: 100%; text-align: center;">
              ${object.userData.pdfPath ? 'Change PDF' : 'Choose PDF'}
              <input type="file" id="book-pdf" accept=".pdf" style="display: none;">
            </label>
            ${object.userData.pdfPath ? `
              <div style="color: rgba(255,255,255,0.5); margin-top: 8px; font-size: 12px;">
                Current: ${object.userData.pdfPath.split('/').pop() || object.userData.pdfPath.split('\\\\').pop()}
              </div>
            ` : ''}
          </div>
          <div class="timer-buttons" style="margin-top: 15px;">
            <button class="timer-btn ${object.userData.isOpen ? 'pause' : 'start'}" id="book-toggle">
              ${object.userData.isOpen ? 'Close Book' : 'Open Book'}
            </button>
          </div>
          ${object.userData.isOpen && object.userData.totalPages > 0 ? `
            <div class="timer-buttons" style="margin-top: 10px;">
              <button class="timer-btn reset" id="book-prev" ${object.userData.currentPage <= 0 ? 'disabled' : ''}>← Prev</button>
              <span style="color: rgba(255,255,255,0.7); padding: 0 15px;">
                Page ${object.userData.currentPage + 1} / ${object.userData.totalPages}
              </span>
              <button class="timer-btn start" id="book-next" ${object.userData.currentPage >= object.userData.totalPages - 1 ? 'disabled' : ''}>Next →</button>
            </div>
          ` : ''}
        </div>
      `;

    default:
      return `<p style="color: rgba(255,255,255,0.7);">No interactions available for this object.</p>`;
  }
}

function setupInteractionHandlers(object) {
  switch (object.userData.type) {
    case 'clock':
      setupTimerHandlers();
      break;
    case 'lamp':
      setupLampHandlers(object);
      break;
    case 'laptop':
      setupLaptopHandlers(object);
      break;
    case 'globe':
      setupGlobeHandlers(object);
      break;
    case 'hourglass':
      setupHourglassHandlers(object);
      break;
    case 'metronome':
      setupMetronomeHandlers(object);
      break;
    case 'photo-frame':
      setupPhotoFrameHandlers(object);
      break;
    case 'coffee':
      setupMugHandlers(object);
      break;
    case 'pen-holder':
      setupPenHolderHandlers(object);
      break;
    case 'books':
      setupBookHandlers(object);
      break;
  }
}

function setupTimerHandlers() {
  const startBtn = document.getElementById('timer-start');
  const pauseBtn = document.getElementById('timer-pause');
  const resetBtn = document.getElementById('timer-reset');
  const display = document.getElementById('timer-display');

  // Initialize display with current timer state
  if (timerState.active) {
    updateTimerDisplay();
    if (timerState.running) {
      startBtn.style.display = 'none';
      pauseBtn.style.display = 'inline-block';
      display.classList.add('running');
    }
  }

  startBtn.addEventListener('click', () => {
    const hours = parseInt(document.getElementById('timer-hours').value) || 0;
    const minutes = parseInt(document.getElementById('timer-minutes').value) || 0;
    const seconds = parseInt(document.getElementById('timer-seconds').value) || 0;

    timerState.remainingSeconds = hours * 3600 + minutes * 60 + seconds;

    if (timerState.remainingSeconds > 0) {
      timerState.active = true;
      timerState.running = true;
      startBtn.style.display = 'none';
      pauseBtn.style.display = 'inline-block';
      display.classList.add('running');
      display.classList.remove('paused');

      timerState.intervalId = setInterval(() => {
        if (timerState.remainingSeconds > 0) {
          timerState.remainingSeconds--;
          updateTimerDisplay();
        } else {
          // Timer finished - alert user
          clearInterval(timerState.intervalId);
          timerState.running = false;
          timerState.active = false;
          display.classList.remove('running');

          // Play a notification sound or visual alert
          playTimerAlert();
        }
      }, 1000);
    }
  });

  pauseBtn.addEventListener('click', () => {
    if (timerState.running) {
      clearInterval(timerState.intervalId);
      timerState.running = false;
      startBtn.textContent = 'Resume';
      startBtn.style.display = 'inline-block';
      pauseBtn.style.display = 'none';
      display.classList.remove('running');
      display.classList.add('paused');
    }
  });

  resetBtn.addEventListener('click', () => {
    clearInterval(timerState.intervalId);
    timerState.active = false;
    timerState.running = false;
    timerState.remainingSeconds = 0;
    startBtn.textContent = 'Start';
    startBtn.style.display = 'inline-block';
    pauseBtn.style.display = 'none';
    display.textContent = '00:00:00';
    display.classList.remove('running', 'paused');
  });
}

function updateTimerDisplay() {
  const display = document.getElementById('timer-display');
  if (display) {
    const hours = Math.floor(timerState.remainingSeconds / 3600);
    const minutes = Math.floor((timerState.remainingSeconds % 3600) / 60);
    const seconds = timerState.remainingSeconds % 60;
    display.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}

function playTimerAlert() {
  // Visual alert - flash the background
  const modal = document.getElementById('interaction-modal');
  modal.style.animation = 'timerAlert 0.5s ease 3';
  setTimeout(() => {
    modal.style.animation = '';
  }, 1500);

  // Play a continuous beeping sound using Web Audio API
  // The sound will continue until stopped by middle-click on clock
  try {
    timerState.alertAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    timerState.alertOscillator = timerState.alertAudioCtx.createOscillator();
    const gainNode = timerState.alertAudioCtx.createGain();

    timerState.alertOscillator.connect(gainNode);
    gainNode.connect(timerState.alertAudioCtx.destination);

    timerState.alertOscillator.frequency.value = 800;
    timerState.alertOscillator.type = 'sine';
    gainNode.gain.value = 0.3;

    // Create a pulsing effect by modulating the gain
    const now = timerState.alertAudioCtx.currentTime;
    gainNode.gain.setValueAtTime(0.3, now);

    // Pulse the sound on/off
    let time = now;
    for (let i = 0; i < 60; i++) { // Up to 30 seconds of pulsing (60 * 0.5s)
      gainNode.gain.setValueAtTime(0.3, time);
      gainNode.gain.setValueAtTime(0, time + 0.3);
      time += 0.5;
    }

    timerState.alertOscillator.start();
    timerState.isAlerting = true;

    // Auto-stop after 30 seconds if not manually stopped
    setTimeout(() => {
      stopTimerAlert();
    }, 30000);
  } catch (e) {
    console.log('Audio not available');
  }
}

function stopTimerAlert() {
  if (timerState.isAlerting && timerState.alertOscillator) {
    try {
      timerState.alertOscillator.stop();
      timerState.alertAudioCtx.close();
    } catch (e) {
      // Ignore if already stopped
    }
    timerState.alertOscillator = null;
    timerState.alertAudioCtx = null;
    timerState.isAlerting = false;
  }
}

function setupLampHandlers(object) {
  const toggleBtn = document.getElementById('lamp-toggle');
  const status = document.getElementById('lamp-status');

  toggleBtn.addEventListener('click', () => {
    object.userData.isOn = !object.userData.isOn;

    const bulb = object.getObjectByName('bulb');
    const light = object.getObjectByName('lampLight');
    const spotLight = object.getObjectByName('lampSpotLight');
    const ambientLight = object.getObjectByName('lampAmbient');

    if (object.userData.isOn) {
      if (bulb) {
        bulb.material.emissiveIntensity = 1.5;
      }
      if (light) {
        light.intensity = 0.8;
      }
      if (spotLight) {
        spotLight.intensity = 3.0;
      }
      if (ambientLight) {
        ambientLight.intensity = 0.3;
      }
      status.textContent = 'ON';
      toggleBtn.textContent = 'Turn Off';
      toggleBtn.className = 'timer-btn pause';
    } else {
      if (bulb) {
        bulb.material.emissiveIntensity = 0;
      }
      if (light) {
        light.intensity = 0;
      }
      if (spotLight) {
        spotLight.intensity = 0;
      }
      if (ambientLight) {
        ambientLight.intensity = 0;
      }
      status.textContent = 'OFF';
      toggleBtn.textContent = 'Turn On';
      toggleBtn.className = 'timer-btn start';
    }
  });
}

function setupLaptopHandlers(object) {
  const powerBtn = document.getElementById('laptop-power');
  const editorBtn = document.getElementById('laptop-editor');
  const bootScreenInput = document.getElementById('laptop-boot-screen');
  const bootClearBtn = document.getElementById('laptop-boot-clear');
  const ledColorInput = document.getElementById('laptop-led-color');

  if (powerBtn) {
    powerBtn.addEventListener('click', () => {
      toggleLaptopPower(object);
      // Refresh modal after state change
      setTimeout(() => {
        if (interactionObject === object) {
          const content = document.getElementById('interaction-content');
          content.innerHTML = getInteractionContent(object);
          setupInteractionHandlers(object);
        }
      }, 100);
    });
  }

  if (editorBtn) {
    editorBtn.addEventListener('click', () => {
      openMarkdownEditor(object);
    });
  }

  if (bootScreenInput) {
    bootScreenInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const imageUrl = event.target.result;
          object.userData.bootScreenDataUrl = imageUrl;

          // Create texture for boot screen
          const textureLoader = new THREE.TextureLoader();
          textureLoader.load(imageUrl, (texture) => {
            object.userData.bootScreenTexture = texture;
            saveState();
            // Refresh modal to show updated button
            if (interactionObject === object) {
              const content = document.getElementById('interaction-content');
              content.innerHTML = getInteractionContent(object);
              setupInteractionHandlers(object);
            }
          });
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (bootClearBtn) {
    bootClearBtn.addEventListener('click', () => {
      if (object.userData.bootScreenTexture) {
        object.userData.bootScreenTexture.dispose();
        object.userData.bootScreenTexture = null;
      }
      object.userData.bootScreenDataUrl = null;
      saveState();
      // Refresh modal
      if (interactionObject === object) {
        const content = document.getElementById('interaction-content');
        content.innerHTML = getInteractionContent(object);
        setupInteractionHandlers(object);
      }
    });
  }

  if (ledColorInput) {
    ledColorInput.addEventListener('change', (e) => {
      object.userData.powerLedColor = e.target.value;
      // Update LED color if laptop is on
      if (object.userData.isOn) {
        const powerLed = object.getObjectByName('powerLed');
        if (powerLed) {
          const ledColor = new THREE.Color(e.target.value);
          powerLed.material.color.copy(ledColor);
          powerLed.material.emissive.copy(ledColor);
        }
      }
      saveState();
    });
  }
}

// Markdown Editor Functions
function openMarkdownEditor(laptop) {
  // Close the interaction modal
  closeInteractionModal();
  exitExamineMode();

  // Create markdown editor overlay
  const editorOverlay = document.createElement('div');
  editorOverlay.id = 'markdown-editor-overlay';
  editorOverlay.innerHTML = `
    <div class="md-editor-container">
      <div class="md-editor-header">
        <div class="md-editor-title">
          <span class="md-editor-icon">📝</span>
          <input type="text" id="md-filename" value="${laptop.userData.editorFileName}" class="md-filename-input">
        </div>
        <div class="md-editor-actions">
          <button id="md-save" class="md-btn md-btn-save">Save</button>
          <button id="md-close" class="md-btn md-btn-close">×</button>
        </div>
      </div>
      <div class="md-editor-body">
        <div class="md-editor-pane md-editor-source">
          <div class="md-pane-header">Source</div>
          <textarea id="md-source" placeholder="Write your markdown here...">${laptop.userData.editorContent}</textarea>
        </div>
        <div class="md-editor-pane md-editor-preview">
          <div class="md-pane-header">Preview</div>
          <div id="md-preview" class="md-preview-content"></div>
        </div>
      </div>
      <div class="md-editor-footer">
        <span class="md-status">Obsidian-style Markdown Editor</span>
        <span class="md-word-count" id="md-word-count">0 words</span>
      </div>
    </div>
  `;
  document.body.appendChild(editorOverlay);

  // Add editor styles
  if (!document.getElementById('md-editor-styles')) {
    const styles = document.createElement('style');
    styles.id = 'md-editor-styles';
    styles.textContent = `
      #markdown-editor-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.9);
        z-index: 300;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.3s ease;
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .md-editor-container {
        width: 90%;
        height: 85%;
        max-width: 1400px;
        background: #1e1e2e;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      .md-editor-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 15px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.2);
        border-radius: 12px 12px 0 0;
      }
      .md-editor-title {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .md-editor-icon { font-size: 20px; }
      .md-filename-input {
        background: transparent;
        border: 1px solid transparent;
        color: #fff;
        font-size: 16px;
        padding: 5px 10px;
        border-radius: 6px;
      }
      .md-filename-input:focus {
        border-color: rgba(139, 92, 246, 0.5);
        outline: none;
        background: rgba(255, 255, 255, 0.05);
      }
      .md-editor-actions { display: flex; gap: 10px; }
      .md-btn {
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
      }
      .md-btn-save {
        background: rgba(139, 92, 246, 0.8);
        color: #fff;
      }
      .md-btn-save:hover { background: rgba(139, 92, 246, 1); }
      .md-btn-close {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
        font-size: 18px;
        padding: 8px 12px;
      }
      .md-btn-close:hover { background: rgba(255, 255, 255, 0.2); }
      .md-editor-body {
        flex: 1;
        display: flex;
        overflow: hidden;
      }
      .md-editor-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .md-editor-source { border-right: 1px solid rgba(255, 255, 255, 0.1); }
      .md-pane-header {
        padding: 8px 15px;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: rgba(255, 255, 255, 0.5);
        background: rgba(0, 0, 0, 0.2);
      }
      #md-source {
        flex: 1;
        background: transparent;
        border: none;
        color: #cdd6f4;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 14px;
        line-height: 1.6;
        padding: 15px;
        resize: none;
        outline: none;
      }
      #md-source::placeholder { color: rgba(255, 255, 255, 0.3); }
      .md-preview-content {
        flex: 1;
        padding: 15px;
        overflow-y: auto;
        color: #cdd6f4;
        font-size: 14px;
        line-height: 1.8;
      }
      .md-preview-content h1 { font-size: 2em; color: #cba6f7; margin: 0.5em 0; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.3em; }
      .md-preview-content h2 { font-size: 1.5em; color: #89b4fa; margin: 0.5em 0; }
      .md-preview-content h3 { font-size: 1.25em; color: #94e2d5; margin: 0.5em 0; }
      .md-preview-content p { margin: 0.8em 0; }
      .md-preview-content code { background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-family: monospace; }
      .md-preview-content pre { background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; overflow-x: auto; }
      .md-preview-content pre code { background: none; padding: 0; }
      .md-preview-content blockquote { border-left: 3px solid #cba6f7; padding-left: 15px; margin: 1em 0; color: rgba(255,255,255,0.7); }
      .md-preview-content ul, .md-preview-content ol { padding-left: 25px; margin: 0.5em 0; }
      .md-preview-content li { margin: 0.3em 0; }
      .md-preview-content li.checkbox { list-style: none; margin-left: -20px; }
      .md-preview-content li.checkbox input[type="checkbox"] { margin-right: 8px; transform: scale(1.2); accent-color: #a6e3a1; }
      .md-preview-content li.checkbox.checked { text-decoration: line-through; color: rgba(255,255,255,0.5); }
      .md-preview-content a { color: #89b4fa; }
      .md-preview-content strong { color: #f9e2af; }
      .md-preview-content em { color: #a6e3a1; }
      .md-preview-content hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 1.5em 0; }
      .md-editor-footer {
        display: flex;
        justify-content: space-between;
        padding: 10px 20px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.5);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.2);
        border-radius: 0 0 12px 12px;
      }
    `;
    document.head.appendChild(styles);
  }

  // Setup editor functionality
  const sourceTextarea = document.getElementById('md-source');
  const preview = document.getElementById('md-preview');
  const wordCount = document.getElementById('md-word-count');
  const saveBtn = document.getElementById('md-save');
  const closeBtn = document.getElementById('md-close');
  const filenameInput = document.getElementById('md-filename');

  function updatePreview() {
    const md = sourceTextarea.value;
    preview.innerHTML = parseMarkdown(md);
    const words = md.trim().split(/\s+/).filter(w => w.length > 0).length;
    wordCount.textContent = `${words} word${words !== 1 ? 's' : ''}`;
  }

  function parseMarkdown(text) {
    // Simple markdown parser
    let html = text
      // Escape HTML
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Headers
      .replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*)$/gm, '<h1>$1</h1>')
      // Bold and Italic
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Code blocks
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      // Blockquotes
      .replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
      // Checkbox lists - checked (must come before regular lists)
      .replace(/^- \[x\] (.*)$/gm, '<li class="checkbox checked"><input type="checkbox" checked disabled> $1</li>')
      .replace(/^- \[X\] (.*)$/gm, '<li class="checkbox checked"><input type="checkbox" checked disabled> $1</li>')
      // Checkbox lists - unchecked
      .replace(/^- \[ \] (.*)$/gm, '<li class="checkbox"><input type="checkbox" disabled> $1</li>')
      // Unordered lists (plain)
      .replace(/^- (.*)$/gm, '<li>$1</li>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Horizontal rule
      .replace(/^---$/gm, '<hr>')
      // Line breaks
      .replace(/\n/g, '<br>');

    // Wrap consecutive li elements in ul
    html = html.replace(/(<li[^>]*>.*?<\/li>(<br>)?)+/g, (match) => {
      return '<ul>' + match.replace(/<br>/g, '') + '</ul>';
    });

    return html;
  }

  sourceTextarea.addEventListener('input', updatePreview);
  updatePreview();

  saveBtn.addEventListener('click', () => {
    laptop.userData.editorContent = sourceTextarea.value;
    laptop.userData.editorFileName = filenameInput.value || 'notes.md';
    saveState();
  });

  // Function to save and close the editor (exitLaptopMode: also exit laptop zoom mode)
  function saveAndClose(exitLaptopMode = false) {
    laptop.userData.editorContent = sourceTextarea.value;
    laptop.userData.editorFileName = filenameInput.value || 'notes.md';
    editorOverlay.remove();
    // Update laptop desktop to show note preview if content exists
    if (laptop.userData.screenState === 'desktop') {
      updateLaptopDesktop(laptop);
    }
    saveState();
    document.removeEventListener('keydown', handleEditorKeys);
    document.removeEventListener('mousedown', handleEditorMiddleClick);

    // Exit laptop zoom mode if requested
    if (exitLaptopMode) {
      closeInteractionModal();
      exitLaptopZoomMode(laptop);
    }
  }

  closeBtn.addEventListener('click', () => saveAndClose(false));

  // Handle keyboard shortcuts
  const handleEditorKeys = (e) => {
    if (e.key === 'Escape') {
      saveAndClose(false);
    }
  };
  document.addEventListener('keydown', handleEditorKeys);

  // Handle middle-click to save and exit laptop mode entirely
  const handleEditorMiddleClick = (e) => {
    if (e.button === 1) { // Middle mouse button
      e.preventDefault();
      saveAndClose(true); // Exit laptop mode too
    }
  };
  document.addEventListener('mousedown', handleEditorMiddleClick);
}

function setupGlobeHandlers(object) {
  const toggleBtn = document.getElementById('globe-toggle');

  toggleBtn.addEventListener('click', () => {
    if (object.userData.rotationSpeed > 0) {
      object.userData.rotationSpeed = 0;
      toggleBtn.textContent = 'Start Rotation';
      toggleBtn.className = 'timer-btn start';
    } else {
      object.userData.rotationSpeed = 0.002;
      toggleBtn.textContent = 'Stop Rotation';
      toggleBtn.className = 'timer-btn pause';
    }
  });
}

function setupHourglassHandlers(object) {
  const flipBtn = document.getElementById('hourglass-flip');

  flipBtn.addEventListener('click', () => {
    // Animate flip around X axis (upside down flip)
    const startRotationX = object.rotation.x;
    const endRotationX = startRotationX + Math.PI;
    const startY = object.position.y;
    // The hourglass model is 0.25 units tall, centered at ~0.125
    // When flipped, we need to lift it to prevent clipping
    const liftHeight = 0.3; // Extra height during flip
    const duration = 600;
    const startTime = Date.now();

    function animateFlip() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease in-out
      const easeProgress = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      object.rotation.x = startRotationX + (endRotationX - startRotationX) * easeProgress;

      // Lift up during middle of animation, then settle back
      const liftProgress = Math.sin(progress * Math.PI); // Peaks at 0.5
      object.position.y = startY + liftProgress * liftHeight;

      if (progress < 1) {
        requestAnimationFrame(animateFlip);
      } else {
        // Ensure final position is correct
        object.position.y = startY;
      }
    }

    animateFlip();
  });
}

function setupMetronomeHandlers(object) {
  const toggleBtn = document.getElementById('metronome-toggle');
  const soundBtn = document.getElementById('metronome-sound');
  const bpmSlider = document.getElementById('metronome-bpm');
  const status = document.getElementById('metronome-status');

  toggleBtn.addEventListener('click', () => {
    object.userData.isRunning = !object.userData.isRunning;
    if (object.userData.isRunning) {
      status.textContent = 'RUNNING';
      status.classList.add('running');
      toggleBtn.textContent = 'Stop';
      toggleBtn.className = 'timer-btn pause';
    } else {
      status.textContent = 'STOPPED';
      status.classList.remove('running');
      toggleBtn.textContent = 'Start';
      toggleBtn.className = 'timer-btn start';
      // Reset pendulum to center when stopped
      object.userData.pendulumAngle = 0;
      const pendulum = object.getObjectByName('pendulum');
      if (pendulum) pendulum.rotation.z = 0;
    }
  });

  soundBtn.addEventListener('click', () => {
    object.userData.tickSound = !object.userData.tickSound;
    soundBtn.textContent = `Sound: ${object.userData.tickSound ? 'ON' : 'OFF'}`;
    soundBtn.className = `timer-btn ${object.userData.tickSound ? 'pause' : 'reset'}`;
  });

  bpmSlider.addEventListener('input', (e) => {
    object.userData.bpm = parseInt(e.target.value);
    // Update the BPM display
    const bpmDisplay = bpmSlider.parentElement.previousElementSibling.querySelector('div:last-child');
    if (bpmDisplay) {
      bpmDisplay.textContent = `${object.userData.bpm} BPM`;
    }
  });

  // Add scroll-based adjustment for BPM slider
  addScrollToSlider(bpmSlider);
}

function setupPhotoFrameHandlers(object) {
  const uploadInput = document.getElementById('photo-upload');
  const clearBtn = document.getElementById('photo-clear');

  uploadInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const imageUrl = event.target.result;
        // Store data URL for persistence
        object.userData.photoDataUrl = imageUrl;

        // Create texture from uploaded image
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(imageUrl, (texture) => {
          // Find the photo surface mesh
          const photoSurface = object.getObjectByName('photoSurface');
          if (photoSurface) {
            // Update the material with the new texture
            photoSurface.material.map = texture;
            photoSurface.material.color.set(0xffffff); // White to show texture properly
            photoSurface.material.needsUpdate = true;

            // Store texture reference for cleanup
            object.userData.photoTexture = texture;
          }
          saveState(); // Save after photo is loaded
        });
      };
      reader.readAsDataURL(file);
    }
  });

  clearBtn.addEventListener('click', () => {
    const photoSurface = object.getObjectByName('photoSurface');
    if (photoSurface) {
      // Dispose of the old texture
      if (object.userData.photoTexture) {
        object.userData.photoTexture.dispose();
        object.userData.photoTexture = null;
      }
      // Clear the data URL for persistence
      object.userData.photoDataUrl = null;

      // Reset to default color
      photoSurface.material.map = null;
      photoSurface.material.color.set(new THREE.Color(object.userData.accentColor));
      photoSurface.material.needsUpdate = true;
      saveState();
    }
  });
}

function setupMugHandlers(object) {
  const drinkButtons = document.querySelectorAll('[data-drink]');
  const levelSlider = document.getElementById('mug-level');

  drinkButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const drinkType = btn.dataset.drink;
      object.userData.drinkType = drinkType;

      // Update liquid color
      const liquid = object.getObjectByName('liquid');
      const liquidBody = object.getObjectByName('liquidBody');
      if (DRINK_COLORS[drinkType]) {
        if (liquid) {
          liquid.material.color.set(DRINK_COLORS[drinkType].color);
          liquid.material.needsUpdate = true;
        }
        if (liquidBody) {
          liquidBody.material.color.set(DRINK_COLORS[drinkType].color);
          liquidBody.material.needsUpdate = true;
        }
      }

      // Update button styles
      drinkButtons.forEach(b => {
        b.className = `timer-btn ${b.dataset.drink === drinkType ? 'pause' : 'start'}`;
      });

      // Update title display
      const titleDisplay = document.querySelector('.timer-display .time');
      if (titleDisplay && DRINK_COLORS[drinkType]) {
        titleDisplay.textContent = DRINK_COLORS[drinkType].name;
      }
    });
  });

  if (levelSlider) {
    levelSlider.addEventListener('input', (e) => {
      const level = parseInt(e.target.value) / 100;
      object.userData.liquidLevel = level;

      // Update liquid height and position
      const liquid = object.getObjectByName('liquid');
      const liquidBody = object.getObjectByName('liquidBody');
      if (liquid) {
        liquid.visible = level > 0.05;
        liquid.position.y = 0.03 + level * 0.14;
      }
      if (liquidBody) {
        liquidBody.visible = level > 0.05;
        liquidBody.scale.y = Math.max(0.1, level);
        liquidBody.position.y = 0.015 + level * 0.07;
      }

      // Update label
      const label = levelSlider.previousElementSibling;
      if (label) {
        label.textContent = `Fill Level: ${Math.round(level * 100)}%`;
      }
    });
  }
}

// ============================================================================
// PEN HOLDER HANDLERS
// ============================================================================
function setupPenHolderHandlers(object) {
  const penButtons = ['red', 'blue', 'green', 'black'].map(color =>
    document.getElementById(`pen-${color}`)
  );
  const returnBtn = document.getElementById('pen-return');

  penButtons.forEach(btn => {
    if (btn && !btn.disabled) {
      btn.addEventListener('click', () => {
        const penColor = btn.id.replace('pen-', '');
        selectPen(object, penColor);

        // Refresh modal
        const content = document.getElementById('interaction-content');
        content.innerHTML = getInteractionContent(object);
        setupPenHolderHandlers(object);
      });
    }
  });

  if (returnBtn) {
    returnBtn.addEventListener('click', () => {
      returnPen(object);

      // Refresh modal
      const content = document.getElementById('interaction-content');
      content.innerHTML = getInteractionContent(object);
      setupPenHolderHandlers(object);
    });
  }
}

function selectPen(penHolder, penColor) {
  // If already holding a pen, return it first
  if (drawingState.selectedPen) {
    returnPen(penHolder);
  }

  // Select the new pen
  drawingState.selectedPen = penColor;
  const pensGroup = penHolder.getObjectByName('pens');
  if (pensGroup) {
    pensGroup.children.forEach(pen => {
      if (pen.userData.penColor === penColor) {
        pen.visible = false; // Hide pen from holder
        drawingState.selectedPenColor = pen.userData.colorHex;
      }
    });
  }
}

function returnPen(penHolder) {
  if (!drawingState.selectedPen) return;

  const pensGroup = penHolder.getObjectByName('pens');
  if (pensGroup) {
    pensGroup.children.forEach(pen => {
      if (pen.userData.penColor === drawingState.selectedPen) {
        pen.visible = true; // Show pen in holder again
      }
    });
  }

  drawingState.selectedPen = null;
  drawingState.selectedPenColor = null;
}

// ============================================================================
// BOOK HANDLERS
// ============================================================================
function setupBookHandlers(object) {
  const toggleBtn = document.getElementById('book-toggle');
  const titleInput = document.getElementById('book-title');
  const pdfInput = document.getElementById('book-pdf');
  const prevBtn = document.getElementById('book-prev');
  const nextBtn = document.getElementById('book-next');

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      toggleBookOpen(object);

      // Refresh modal
      const content = document.getElementById('interaction-content');
      content.innerHTML = getInteractionContent(object);
      setupBookHandlers(object);
    });
  }

  if (titleInput) {
    titleInput.addEventListener('change', (e) => {
      object.userData.bookTitle = e.target.value;
      // Update title texture on cover (spine no longer has title)
      if (object.userData.createTitleTexture) {
        const closedGroup = object.getObjectByName('closedBook');
        if (closedGroup) {
          const coverTitle = closedGroup.getObjectByName('coverTitle');
          if (coverTitle) {
            // Use larger font size (64) for cover title
            const newCoverTexture = object.userData.createTitleTexture(e.target.value, 320, 116, 64);
            coverTitle.material.map = newCoverTexture;
            coverTitle.material.needsUpdate = true;
          }
        }
      }
      saveState();
    });
  }

  if (pdfInput) {
    pdfInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.type === 'application/pdf') {
        // Store the PDF file path
        object.userData.pdfPath = file.name;
        object.userData.pdfFile = file;

        // Load PDF (simplified - in real implementation would use pdf.js)
        loadPDFToBook(object, file);
      }
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (object.userData.currentPage > 0) {
        object.userData.currentPage--;
        updateBookPages(object);

        // Refresh modal
        const content = document.getElementById('interaction-content');
        content.innerHTML = getInteractionContent(object);
        setupBookHandlers(object);
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (object.userData.currentPage < object.userData.totalPages - 1) {
        object.userData.currentPage++;
        updateBookPages(object);

        // Refresh modal
        const content = document.getElementById('interaction-content');
        content.innerHTML = getInteractionContent(object);
        setupBookHandlers(object);
      }
    });
  }
}

function loadPDFToBook(book, file) {
  // Create a simple text representation since we can't load actual PDF
  // In a full implementation, you'd use pdf.js library
  const reader = new FileReader();
  reader.onload = () => {
    // For now, just indicate PDF is loaded
    book.userData.totalPages = 10; // Placeholder
    book.userData.currentPage = 0;

    // Automatically open the book to show the PDF content
    if (!book.userData.isOpen) {
      toggleBookOpen(book);
    }

    // Update the page surfaces with a "PDF loaded" texture
    updateBookPages(book);

    // Refresh the modal to show the PDF content immediately
    const content = document.getElementById('interaction-content');
    if (content && interactionObject === book) {
      content.innerHTML = getInteractionContent(book);
      setupBookHandlers(book);
    }

    saveState();
  };
  reader.readAsArrayBuffer(file);
}

function updateBookPages(book) {
  const openGroup = book.getObjectByName('openBook');
  if (!openGroup) return;

  const leftPage = openGroup.getObjectByName('leftPageSurface');
  const rightPage = openGroup.getObjectByName('rightPageSurface');

  // High resolution canvas for crisp, readable text
  // Using 1024x1448 for sharper rendering (2x the previous resolution)
  const canvasWidth = 1024;
  const canvasHeight = 1448;
  const margin = 80;
  const lineHeight = 56;

  // Create page texture for left page
  if (leftPage && book.userData.totalPages > 0) {
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff8f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Page border
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 2;
    ctx.strokeRect(margin / 2, margin / 2, canvas.width - margin, canvas.height - margin);

    ctx.fillStyle = '#333';
    const pageNum = book.userData.currentPage * 2;

    // Page number header - doubled font size for 2x resolution
    ctx.font = 'bold 56px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Page ${pageNum + 1}`, canvas.width / 2, 120);

    // Divider line
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(margin, 160);
    ctx.lineTo(canvas.width - margin, 160);
    ctx.stroke();

    // Content area - larger, clearer font
    ctx.font = '48px Georgia, serif';
    ctx.textAlign = 'left';

    const pdfFileName = book.userData.pdfPath
      ? book.userData.pdfPath.split('/').pop() || book.userData.pdfPath.split('\\').pop()
      : null;

    const contentLines = pdfFileName ? [
      `📄 ${pdfFileName}`,
      '',
      'PDF content placeholder.',
      '',
      'PDF.js library required',
      'for actual content.',
      '',
      `Pages ${pageNum + 1}-${pageNum + 2}`,
      '',
      '← / → to turn pages'
    ] : [
      'No PDF loaded',
      '',
      'Right-click to open',
      'customization panel,',
      'then select PDF file.',
      '',
      'Content will appear',
      'once a PDF is selected.'
    ];

    contentLines.forEach((line, i) => {
      ctx.fillText(line, margin, 240 + i * lineHeight);
    });

    // Page footer
    ctx.font = '36px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#888';
    ctx.fillText(book.userData.bookTitle || 'Untitled', canvas.width / 2, canvas.height - 60);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 16; // Better quality at angles
    leftPage.material.map = texture;
    leftPage.material.needsUpdate = true;
  }

  // Create page texture for right page
  if (rightPage && book.userData.totalPages > 0) {
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff8f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Page border
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 2;
    ctx.strokeRect(margin / 2, margin / 2, canvas.width - margin, canvas.height - margin);

    ctx.fillStyle = '#333';
    const pageNum = book.userData.currentPage * 2 + 1;

    // Page number header - doubled font size for 2x resolution
    ctx.font = 'bold 56px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Page ${pageNum + 1}`, canvas.width / 2, 120);

    // Divider line
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(margin, 160);
    ctx.lineTo(canvas.width - margin, 160);
    ctx.stroke();

    // Content area - larger, clearer font
    ctx.font = '48px Georgia, serif';
    ctx.textAlign = 'left';

    const totalPages = book.userData.totalPages || 10;
    const contentLines = [
      'Lorem ipsum dolor',
      'sit amet, consectetur',
      'adipiscing elit.',
      '',
      'Sed do eiusmod',
      'tempor incididunt ut',
      'labore et dolore.',
      '',
      'Ut enim ad minim,',
      'quis nostrud ullamco.',
      '',
      `Page ${pageNum + 1} of ${totalPages * 2}`
    ];

    contentLines.forEach((line, i) => {
      ctx.fillText(line, margin, 240 + i * lineHeight);
    });

    // Page footer
    ctx.font = '36px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#888';
    ctx.fillText(`${pageNum + 1} / ${totalPages * 2}`, canvas.width / 2, canvas.height - 60);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 16; // Better quality at angles
    rightPage.material.map = texture;
    rightPage.material.needsUpdate = true;
  }
}

// Helper function to update steam visibility
function updateSteamVisibility(object) {
  const steam = object.getObjectByName('steam');
  if (steam) {
    steam.visible = object.userData.isHot && object.userData.liquidLevel > 0.1;
  }
}

// Quick interaction function for middle-click toggle actions
// This allows simple interactions without picking up or opening modal
// clickedMesh is the actual mesh that was clicked (for detecting sub-component clicks)
function performQuickInteraction(object, clickedMesh = null) {
  const type = object.userData.type;

  switch (type) {
    case 'lamp':
      // Toggle lamp on/off
      object.userData.isOn = !object.userData.isOn;

      const bulb = object.getObjectByName('bulb');
      const light = object.getObjectByName('lampLight');
      const spotLight = object.getObjectByName('lampSpotLight');
      const ambientLight = object.getObjectByName('lampAmbient');

      if (object.userData.isOn) {
        if (bulb) bulb.material.emissiveIntensity = 1.5;
        if (light) light.intensity = 0.8;
        if (spotLight) spotLight.intensity = 3.0;
        if (ambientLight) ambientLight.intensity = 0.3;
      } else {
        if (bulb) bulb.material.emissiveIntensity = 0;
        if (light) light.intensity = 0;
        if (spotLight) spotLight.intensity = 0;
        if (ambientLight) ambientLight.intensity = 0;
      }
      break;

    case 'hourglass':
      // Flip hourglass animation around X axis (upside down flip)
      const startRotationX = object.rotation.x;
      const endRotationX = startRotationX + Math.PI;
      const startY = object.position.y;
      const liftHeight = 0.3; // Lift during flip to prevent table clipping
      const duration = 600;
      const startTime = Date.now();

      function animateFlip() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease in-out
        const easeProgress = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        object.rotation.x = startRotationX + (endRotationX - startRotationX) * easeProgress;

        // Lift during middle of animation
        const liftProgress = Math.sin(progress * Math.PI);
        object.position.y = startY + liftProgress * liftHeight;

        if (progress < 1) {
          requestAnimationFrame(animateFlip);
        } else {
          object.position.y = startY;
        }
      }

      animateFlip();
      break;

    case 'globe':
      // Toggle globe rotation
      if (object.userData.rotationSpeed > 0) {
        object.userData.rotationSpeed = 0;
      } else {
        object.userData.rotationSpeed = 0.01;
      }
      break;

    case 'clock':
      // Middle-click on clock stops the timer alert sound (without picking up)
      if (timerState.isAlerting) {
        stopTimerAlert();
      } else if (object.userData.interactive) {
        // If no alert, open the timer modal
        enterExamineMode(object);
        openInteractionModal(object);
      }
      break;

    case 'metronome':
      // Toggle metronome on/off with middle-click
      object.userData.isRunning = !object.userData.isRunning;
      if (!object.userData.isRunning) {
        // Reset pendulum when stopped
        object.userData.pendulumAngle = 0;
        const pendulum = object.getObjectByName('pendulum');
        if (pendulum) pendulum.rotation.z = 0;
      }
      break;

    case 'coffee':
      // In examine mode, sip the drink
      if (examineState.active && examineState.object === object) {
        performMugSip(object);
      } else {
        // Enter examine mode first
        enterExamineMode(object);
      }
      break;

    case 'books':
      // Toggle book open/closed
      toggleBookOpen(object);
      break;

    case 'laptop':
      // Check if the power button was clicked
      if (clickedMesh && clickedMesh.name === 'powerButton') {
        // Toggle power only when clicking on power button
        toggleLaptopPower(object);
      } else {
        // Enter laptop zoom mode for other areas
        enterLaptopZoomMode(object);
      }
      break;

    case 'pen-holder':
      // Pen holder is now just a container, no interaction
      break;

    default:
      // For non-toggle objects, open the interaction modal instead
      if (object.userData.interactive) {
        enterExamineMode(object);
        openInteractionModal(object);
      }
      break;
  }
}

// ============================================================================
// MUG SIPPING ANIMATION
// ============================================================================
function performMugSip(object) {
  if (object.userData.isSipping || object.userData.isCheckingEmpty) return;

  if (object.userData.liquidLevel > 0.05) {
    // Sip animation - tilt mug toward camera
    object.userData.isSipping = true;
    const sipAmount = 0.15; // Each sip takes 15% of the drink

    // Calculate direction from mug to camera to determine tilt axis
    const mugWorldPos = new THREE.Vector3();
    object.getWorldPosition(mugWorldPos);
    const dirToCamera = new THREE.Vector3();
    dirToCamera.subVectors(camera.position, mugWorldPos).normalize();

    // Calculate the tilt angle based on camera direction
    // We need to tilt the mug towards the camera (as if drinking)
    const tiltAngle = 0.7; // More pronounced tilt for sipping

    // Store starting rotations
    const startRotationX = object.rotation.x;
    const startRotationZ = object.rotation.z;

    // Calculate target rotation to tilt toward camera
    // The mug should tilt on the axis perpendicular to the camera direction
    const tiltX = startRotationX + dirToCamera.z * tiltAngle;
    const tiltZ = startRotationZ - dirToCamera.x * tiltAngle;

    const duration = 800;
    const startTime = Date.now();

    function animateSip() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      if (progress < 0.3) {
        // Tilt up toward camera
        const tiltProgress = progress / 0.3;
        object.rotation.x = startRotationX + (tiltX - startRotationX) * tiltProgress;
        object.rotation.z = startRotationZ + (tiltZ - startRotationZ) * tiltProgress;
      } else if (progress < 0.7) {
        // Hold position (drinking)
        object.rotation.x = tiltX;
        object.rotation.z = tiltZ;
      } else {
        // Tilt back down
        const returnProgress = (progress - 0.7) / 0.3;
        object.rotation.x = tiltX + (startRotationX - tiltX) * returnProgress;
        object.rotation.z = tiltZ + (startRotationZ - tiltZ) * returnProgress;
      }

      if (progress < 1) {
        requestAnimationFrame(animateSip);
      } else {
        object.rotation.x = startRotationX;
        object.rotation.z = startRotationZ;
        object.userData.isSipping = false;

        // Reduce liquid level
        object.userData.liquidLevel = Math.max(0, object.userData.liquidLevel - sipAmount);

        // Update liquid visual
        const liquid = object.getObjectByName('liquid');
        const liquidBody = object.getObjectByName('liquidBody');
        const level = object.userData.liquidLevel;
        if (liquid) {
          if (level < 0.05) {
            liquid.visible = false;
          } else {
            liquid.visible = true;
            liquid.position.y = 0.03 + level * 0.14;
          }
        }
        if (liquidBody) {
          if (level < 0.05) {
            liquidBody.visible = false;
          } else {
            liquidBody.visible = true;
            liquidBody.scale.y = Math.max(0.1, level);
            liquidBody.position.y = 0.015 + level * 0.07;
          }
        }

        // Update steam visibility
        updateSteamVisibility(object);
        saveState();
      }
    }

    animateSip();
  } else {
    // Empty mug - check if there's anything left (tilt toward camera to look inside)
    object.userData.isCheckingEmpty = true;

    // Calculate direction from mug to camera
    const mugWorldPos = new THREE.Vector3();
    object.getWorldPosition(mugWorldPos);
    const dirToCamera = new THREE.Vector3();
    dirToCamera.subVectors(camera.position, mugWorldPos).normalize();

    const checkAngle = 1.4; // Almost upside down

    const startRotationX = object.rotation.x;
    const startRotationZ = object.rotation.z;

    // Tilt toward camera
    const checkRotationX = startRotationX + dirToCamera.z * checkAngle;
    const checkRotationZ = startRotationZ - dirToCamera.x * checkAngle;

    const duration = 1200;
    const startTime = Date.now();

    function animateCheck() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      if (progress < 0.4) {
        // Tilt up to look inside
        const tiltProgress = progress / 0.4;
        object.rotation.x = startRotationX + (checkRotationX - startRotationX) * tiltProgress;
        object.rotation.z = startRotationZ + (checkRotationZ - startRotationZ) * tiltProgress;
      } else if (progress < 0.6) {
        // Rotate slightly to look around
        const lookProgress = (progress - 0.4) / 0.2;
        object.rotation.x = checkRotationX + Math.sin(lookProgress * Math.PI * 2) * 0.1;
        object.rotation.z = checkRotationZ + Math.cos(lookProgress * Math.PI * 2) * 0.1;
      } else {
        // Return to original position
        const returnProgress = (progress - 0.6) / 0.4;
        object.rotation.x = checkRotationX + (startRotationX - checkRotationX) * returnProgress;
        object.rotation.z = checkRotationZ + (startRotationZ - checkRotationZ) * returnProgress;
      }

      if (progress < 1) {
        requestAnimationFrame(animateCheck);
      } else {
        object.rotation.x = startRotationX;
        object.rotation.z = startRotationZ;
        object.userData.isCheckingEmpty = false;
      }
    }

    animateCheck();
  }
}

// ============================================================================
// BOOK OPEN/CLOSE ANIMATION
// ============================================================================
function toggleBookOpen(object) {
  const closedGroup = object.getObjectByName('closedBook');
  const openGroup = object.getObjectByName('openBook');

  if (object.userData.isOpen) {
    // Close book animation
    object.userData.isOpen = false;
    if (openGroup) openGroup.visible = false;
    if (closedGroup) closedGroup.visible = true;
  } else {
    // Open book animation
    object.userData.isOpen = true;
    if (closedGroup) closedGroup.visible = false;
    if (openGroup) openGroup.visible = true;
  }
}

// Page turning animation for book
function animatePageTurn(book, direction) {
  if (book.userData.isTurningPage) return; // Don't interrupt ongoing animation
  book.userData.isTurningPage = true;

  const openGroup = book.getObjectByName('openBook');
  if (!openGroup) {
    book.userData.isTurningPage = false;
    return;
  }

  // Create a temporary page for animation
  // The page should flip from one side to the other, rotating around the spine
  const pageGeometry = new THREE.PlaneGeometry(0.24, 0.34);
  const pageMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff8f0,
    side: THREE.DoubleSide,
    roughness: 0.9
  });
  const turningPage = new THREE.Mesh(pageGeometry, pageMaterial);

  // Create a pivot group positioned at the spine edge of the page
  // The pivot is at the spine (X=0), and the page extends outward
  const pivotGroup = new THREE.Group();
  pivotGroup.position.set(0, 0.028, 0); // At spine, at page surface height

  // Position page so its inner edge is at the pivot (spine)
  // The page center is offset by half the page width from the spine
  turningPage.position.set(direction > 0 ? 0.12 : -0.12, 0, 0);
  turningPage.rotation.x = -Math.PI / 2; // Lie flat, facing up
  pivotGroup.add(turningPage);
  openGroup.add(pivotGroup);

  const startAngle = 0;
  // Rotate around Z axis (spine direction) to flip the page from one side to the other
  // This is the correct axis for a flat book lying on a desk
  const endAngle = direction > 0 ? -Math.PI : Math.PI; // Flip 180° to opposite side
  const duration = 400;
  const startTime = Date.now();

  function animate() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Ease in-out curve for smooth animation
    const easeProgress = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    // Rotate the pivot group around Z axis (spine runs along Z)
    // This flips the page from right-to-left or left-to-right
    pivotGroup.rotation.z = startAngle + (endAngle - startAngle) * easeProgress;

    // Page arcs up slightly at midpoint of animation
    const liftFactor = Math.sin(progress * Math.PI) * 0.06;
    pivotGroup.position.y = 0.028 + liftFactor;

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // Animation complete - update page and cleanup
      book.userData.currentPage += direction;
      updateBookPages(book);
      openGroup.remove(pivotGroup);
      book.userData.isTurningPage = false;

      // Update modal if open
      if (interactionObject === book) {
        const content = document.getElementById('interaction-content');
        if (content) {
          content.innerHTML = getInteractionContent(book);
          setupBookHandlers(book);
        }
      }
    }
  }

  animate();
}

// ============================================================================
// LAPTOP POWER TOGGLE AND BOOT ANIMATION
// ============================================================================

// Enter laptop zoom mode (focus on screen)
function enterLaptopZoomMode(object) {
  if (object.userData.isZoomedIn) {
    // Already zoomed in, exit zoom mode
    exitLaptopZoomMode(object);
    return;
  }

  object.userData.isZoomedIn = true;

  // Get screen position in world coordinates
  const screenGroup = object.getObjectByName('screenGroup');
  if (!screenGroup) return;

  const screenWorldPos = new THREE.Vector3();
  screenGroup.getWorldPosition(screenWorldPos);

  // Store original camera state for returning
  object.userData.originalCameraPos = camera.position.clone();
  object.userData.originalCameraYaw = cameraLookState.yaw;
  object.userData.originalCameraPitch = cameraLookState.pitch;

  // Calculate target position in front of the screen
  const direction = new THREE.Vector3();
  object.getWorldDirection(direction);

  // Position camera to look at screen from front
  const targetCameraPos = new THREE.Vector3(
    screenWorldPos.x,
    screenWorldPos.y + 0.2,
    screenWorldPos.z + 0.8
  );

  // Animate camera to target position
  const startPos = camera.position.clone();
  const startTime = Date.now();
  const duration = 500;

  function animateZoom() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // Ease out cubic

    camera.position.lerpVectors(startPos, targetCameraPos, eased);

    if (progress < 1) {
      requestAnimationFrame(animateZoom);
    }
  }

  animateZoom();

  // Open interaction modal or editor after zoom
  setTimeout(() => {
    // If laptop has saved content and is on desktop, go directly to editor
    if (object.userData.isOn && object.userData.screenState === 'desktop' &&
        object.userData.editorContent && object.userData.editorContent.trim().length > 0) {
      openMarkdownEditor(object);
    } else {
      openInteractionModal(object);
    }
  }, 550);
}

function exitLaptopZoomMode(object) {
  if (!object.userData.isZoomedIn) return;

  object.userData.isZoomedIn = false;

  // Animate camera back to original position
  if (object.userData.originalCameraPos) {
    const startPos = camera.position.clone();
    const targetPos = object.userData.originalCameraPos;
    const startTime = Date.now();
    const duration = 400;

    function animateZoomOut() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      camera.position.lerpVectors(startPos, targetPos, eased);

      if (progress < 1) {
        requestAnimationFrame(animateZoomOut);
      } else {
        // Restore camera look direction
        if (object.userData.originalCameraYaw !== undefined) {
          cameraLookState.yaw = object.userData.originalCameraYaw;
        }
        if (object.userData.originalCameraPitch !== undefined) {
          cameraLookState.pitch = object.userData.originalCameraPitch;
        }
        updateCameraLook();
      }
    }

    animateZoomOut();
  }
}

// ============================================================================
// BOOK READING MODE
// ============================================================================

function enterBookReadingMode(book) {
  if (bookReadingState.active) return;

  bookReadingState.active = true;
  bookReadingState.book = book;

  // Store original camera state
  bookReadingState.originalCameraPos = camera.position.clone();
  bookReadingState.originalCameraYaw = cameraLookState.yaw;
  bookReadingState.originalCameraPitch = cameraLookState.pitch;

  // Get book position in world coordinates
  const bookWorldPos = new THREE.Vector3();
  book.getWorldPosition(bookWorldPos);

  // Calculate target camera position - at comfortable reading height above the book
  // Not too high, just enough to see the pages clearly
  const targetCameraPos = new THREE.Vector3(
    bookWorldPos.x,
    bookWorldPos.y + 0.35, // Comfortable reading height (not too high)
    bookWorldPos.z + 0.35  // Closer to the book for reading
  );

  // Animate camera to reading position
  const startPos = camera.position.clone();
  const startTime = Date.now();
  const duration = 400;

  function animateToReading() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // Ease out cubic

    camera.position.lerpVectors(startPos, targetCameraPos, eased);

    // Point camera down at book
    const lookAtY = bookWorldPos.y + 0.03;
    const targetPitch = Math.atan2(camera.position.y - lookAtY, camera.position.z - bookWorldPos.z);
    cameraLookState.pitch = bookReadingState.originalCameraPitch + (targetPitch - bookReadingState.originalCameraPitch) * eased;
    updateCameraLook();

    if (progress < 1) {
      requestAnimationFrame(animateToReading);
    }
  }

  animateToReading();
}

function exitBookReadingMode() {
  if (!bookReadingState.active) return;

  bookReadingState.active = false;

  // Animate camera back to original position
  if (bookReadingState.originalCameraPos) {
    const startPos = camera.position.clone();
    const targetPos = bookReadingState.originalCameraPos;
    const startPitch = cameraLookState.pitch;
    const targetPitch = bookReadingState.originalCameraPitch;
    const startYaw = cameraLookState.yaw;
    const targetYaw = bookReadingState.originalCameraYaw;
    const startTime = Date.now();
    const duration = 300;

    function animateFromReading() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      camera.position.lerpVectors(startPos, targetPos, eased);

      // Restore camera look direction
      cameraLookState.pitch = startPitch + (targetPitch - startPitch) * eased;
      cameraLookState.yaw = startYaw + (targetYaw - startYaw) * eased;
      updateCameraLook();

      if (progress < 1) {
        requestAnimationFrame(animateFromReading);
      }
    }

    animateFromReading();
  }

  bookReadingState.book = null;
}

// Create laptop desktop texture with Obsidian icon
function createLaptopDesktopTexture(laptop, hasNote = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');

  // Dark teal gradient background (Windows-style)
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#005a5a');
  gradient.addColorStop(1, '#003838');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw Obsidian icon (purple/violet gemstone shape)
  const iconX = 60;
  const iconY = 60;
  const iconSize = 48;

  // Icon background (darker circle)
  ctx.beginPath();
  ctx.arc(iconX, iconY, iconSize / 2 + 4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fill();

  // Obsidian gem shape (simplified diamond/gem)
  ctx.beginPath();
  ctx.moveTo(iconX, iconY - iconSize / 2); // Top
  ctx.lineTo(iconX + iconSize / 2, iconY); // Right
  ctx.lineTo(iconX, iconY + iconSize / 2); // Bottom
  ctx.lineTo(iconX - iconSize / 2, iconY); // Left
  ctx.closePath();

  // Gradient fill for gem
  const gemGradient = ctx.createLinearGradient(iconX - iconSize / 2, iconY - iconSize / 2, iconX + iconSize / 2, iconY + iconSize / 2);
  gemGradient.addColorStop(0, '#9b59b6');
  gemGradient.addColorStop(0.5, '#8b5cf6');
  gemGradient.addColorStop(1, '#6366f1');
  ctx.fillStyle = gemGradient;
  ctx.fill();

  // Gem highlight
  ctx.beginPath();
  ctx.moveTo(iconX, iconY - iconSize / 2);
  ctx.lineTo(iconX + iconSize / 4, iconY - iconSize / 8);
  ctx.lineTo(iconX, iconY);
  ctx.lineTo(iconX - iconSize / 4, iconY - iconSize / 8);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.fill();

  // Icon label
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Obsidian', iconX, iconY + iconSize / 2 + 16);

  // If there's a saved note, show a small preview in bottom right
  if (hasNote && laptop.userData.editorContent) {
    const noteWidth = 160;
    const noteHeight = 100;
    const noteX = canvas.width - noteWidth - 20;
    const noteY = canvas.height - noteHeight - 40;

    // Note background
    ctx.fillStyle = 'rgba(30, 30, 46, 0.95)';
    ctx.fillRect(noteX, noteY, noteWidth, noteHeight);

    // Note border
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(noteX, noteY, noteWidth, noteHeight);

    // Note title bar
    ctx.fillStyle = 'rgba(139, 92, 246, 0.3)';
    ctx.fillRect(noteX, noteY, noteWidth, 20);

    // Note icon and filename
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(laptop.userData.editorFileName || 'notes.md', noteX + 8, noteY + 14);

    // Preview of note content (first few lines)
    ctx.font = '9px Arial';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    const lines = laptop.userData.editorContent.split('\n').slice(0, 5);
    lines.forEach((line, i) => {
      const truncated = line.length > 22 ? line.substring(0, 22) + '...' : line;
      ctx.fillText(truncated, noteX + 6, noteY + 34 + i * 12);
    });
  }

  // Taskbar at bottom
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, canvas.height - 28, canvas.width, 28);

  // Clock in taskbar
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  ctx.fillStyle = '#ffffff';
  ctx.font = '11px Arial';
  ctx.textAlign = 'right';
  ctx.fillText(timeStr, canvas.width - 10, canvas.height - 10);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Update laptop desktop display
function updateLaptopDesktop(laptop) {
  const screen = laptop.getObjectByName('screen');
  if (!screen) return;

  const hasNote = laptop.userData.editorContent && laptop.userData.editorContent.trim().length > 0;
  const texture = createLaptopDesktopTexture(laptop, hasNote);

  screen.material.map = texture;
  screen.material.color.set(0xffffff);
  screen.material.emissive.set(0xffffff);
  screen.material.emissiveIntensity = 0.3;
  screen.material.needsUpdate = true;

  // Store reference for icon click detection
  laptop.userData.desktopTexture = texture;
}

function toggleLaptopPower(object) {
  if (object.userData.isBooting) return; // Don't toggle while booting

  const screen = object.getObjectByName('screen');
  const powerLed = object.getObjectByName('powerLed');

  if (object.userData.isOn) {
    // Turn off
    object.userData.isOn = false;
    object.userData.screenState = 'off';
    if (screen) {
      screen.material.color.set(0x000000);
      screen.material.emissive.set(0x000000);
      screen.material.emissiveIntensity = 0;
    }
    if (powerLed) {
      powerLed.material.color.set(0x222222);
      powerLed.material.emissive.set(0x000000);
      powerLed.material.emissiveIntensity = 0;
    }
  } else {
    // Boot sequence
    object.userData.isOn = true;
    object.userData.isBooting = true;
    object.userData.bootProgress = 0;

    // Power LED on
    if (powerLed) {
      const ledColor = new THREE.Color(object.userData.powerLedColor || '#00ff00');
      powerLed.material.color.copy(ledColor);
      powerLed.material.emissive.copy(ledColor);
      powerLed.material.emissiveIntensity = 0.5;
    }

    const bootTime = object.userData.bootTime;
    const startTime = Date.now();

    function animateBoot() {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / bootTime;

      if (progress < 0.3) {
        // BIOS screen (dark with text-like color)
        if (object.userData.screenState !== 'bios') {
          object.userData.screenState = 'bios';
          if (screen) {
            screen.material.color.set(0x000033);
            screen.material.emissive.set(0x000066);
            screen.material.emissiveIntensity = 0.3;
          }
        }
      } else if (progress < 0.8) {
        // Loading screen - use custom boot screen if available
        if (object.userData.screenState !== 'loading') {
          object.userData.screenState = 'loading';
          if (screen) {
            if (object.userData.bootScreenDataUrl && object.userData.bootScreenTexture) {
              // Use custom boot screen image
              screen.material.map = object.userData.bootScreenTexture;
              screen.material.color.set(0xffffff);
              screen.material.emissive.set(0xffffff);
              screen.material.emissiveIntensity = 0.2;
              screen.material.needsUpdate = true;
            } else {
              // Default Windows XP-like blue
              screen.material.map = null;
              screen.material.color.set(0x0052cc);
              screen.material.emissive.set(0x0052cc);
              screen.material.emissiveIntensity = 0.4;
              screen.material.needsUpdate = true;
            }
          }
        }
      } else if (progress < 1) {
        // Desktop loading
        if (object.userData.screenState !== 'desktop') {
          object.userData.screenState = 'desktop';
          // Use desktop texture with Obsidian icon
          updateLaptopDesktop(object);
        }
      }

      if (progress < 1) {
        requestAnimationFrame(animateBoot);
      } else {
        object.userData.isBooting = false;
        object.userData.screenState = 'desktop';
        // Final desktop update to ensure texture is applied
        updateLaptopDesktop(object);
      }
    }

    animateBoot();
  }
}

function updateMousePosition(event) {
  if (pointerLockState.isLocked) {
    // When pointer is locked, the cursor is effectively at the center of the screen
    mouse.x = 0;
    mouse.y = 0;
  } else {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }
}

function updateCameraLook() {
  // Calculate new camera direction based on yaw and pitch
  const lookAt = new THREE.Vector3();

  // Convert spherical to Cartesian coordinates
  lookAt.x = camera.position.x + Math.sin(cameraLookState.yaw) * Math.cos(cameraLookState.pitch);
  lookAt.y = camera.position.y + Math.sin(cameraLookState.pitch);
  lookAt.z = camera.position.z + Math.cos(cameraLookState.yaw) * Math.cos(cameraLookState.pitch);

  camera.lookAt(lookAt);

  // Keep examined object centered in front of camera when rotating
  if (examineState.active && examineState.object) {
    const examineDistance = examineState.examineDistance || 2.5;
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    // Update target position to stay in front of camera
    const newTargetPosition = new THREE.Vector3(
      camera.position.x + direction.x * examineDistance,
      camera.position.y + direction.y * examineDistance + 0.3,
      camera.position.z + direction.z * examineDistance
    );

    examineState.object.userData.examineTarget = newTargetPosition;
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Update pixel art render targets if enabled
  if (CONFIG.pixelation.enabled) {
    updatePixelArtRenderTargets();
  }
}

// ============================================================================
// STATE PERSISTENCE
// ============================================================================
async function saveState() {
  const state = {
    objects: deskObjects.map(obj => {
      const data = {
        type: obj.userData.type,
        x: obj.position.x,
        z: obj.position.z,
        rotationY: obj.userData.rotationY || obj.rotation.y,
        scale: obj.userData.scale || obj.scale.x,
        mainColor: obj.userData.mainColor,
        accentColor: obj.userData.accentColor
      };

      // Save type-specific data
      switch (obj.userData.type) {
        case 'photo-frame':
          // Save photo data URL if a photo is loaded
          if (obj.userData.photoDataUrl) {
            data.photoDataUrl = obj.userData.photoDataUrl;
          }
          break;
        case 'books':
          data.bookTitle = obj.userData.bookTitle;
          data.titleColor = obj.userData.titleColor;
          data.pdfPath = obj.userData.pdfPath;
          break;
        case 'coffee':
          data.drinkType = obj.userData.drinkType;
          data.liquidLevel = obj.userData.liquidLevel;
          data.isHot = obj.userData.isHot;
          break;
        case 'metronome':
          data.bpm = obj.userData.bpm;
          data.tickSound = obj.userData.tickSound;
          data.tickSoundType = obj.userData.tickSoundType;
          break;
        case 'laptop':
          data.bootTime = obj.userData.bootTime;
          if (obj.userData.bootScreenDataUrl) {
            data.bootScreenDataUrl = obj.userData.bootScreenDataUrl;
          }
          if (obj.userData.powerLedColor) {
            data.powerLedColor = obj.userData.powerLedColor;
          }
          if (obj.userData.powerButtonColor) {
            data.powerButtonColor = obj.userData.powerButtonColor;
          }
          // Save markdown editor content
          if (obj.userData.editorContent) {
            data.editorContent = obj.userData.editorContent;
          }
          if (obj.userData.editorFileName) {
            data.editorFileName = obj.userData.editorFileName;
          }
          break;
        case 'pen':
          data.penColor = obj.userData.penColor;
          data.inkColor = obj.userData.inkColor;
          // Save holder info if pen is in a holder
          if (obj.userData.inHolder) {
            const holderIndex = deskObjects.indexOf(obj.userData.inHolder);
            if (holderIndex >= 0) {
              data.inHolderIndex = holderIndex;
              data.holderSlot = obj.userData.holderSlot;
            }
          }
          break;
      }

      return data;
    }),
    camera: {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      yaw: cameraLookState.yaw,
      pitch: cameraLookState.pitch
    }
  };

  try {
    await window.electronAPI.saveState(state);
  } catch (error) {
    console.error('Failed to save state:', error);
  }
}

async function loadState() {
  try {
    const result = await window.electronAPI.loadState();

    if (result.success && result.state) {
      // Load camera position and look direction if saved
      if (result.state.camera) {
        camera.position.set(
          result.state.camera.x,
          result.state.camera.y,
          result.state.camera.z
        );
        // Load camera look direction
        if (result.state.camera.yaw !== undefined) {
          cameraLookState.yaw = result.state.camera.yaw;
        }
        if (result.state.camera.pitch !== undefined) {
          cameraLookState.pitch = result.state.camera.pitch;
        }
        updateCameraLook();
      }

      // Load objects
      if (result.state.objects) {
        result.state.objects.forEach(objData => {
          const obj = addObjectToDesk(objData.type, {
            x: objData.x,
            z: objData.z,
            rotationY: objData.rotationY,
            scale: objData.scale,
            mainColor: objData.mainColor,
            accentColor: objData.accentColor
          });

          // Restore type-specific data
          if (obj) {
            switch (objData.type) {
              case 'photo-frame':
                if (objData.photoDataUrl) {
                  obj.userData.photoDataUrl = objData.photoDataUrl;
                  // Load texture from data URL
                  const textureLoader = new THREE.TextureLoader();
                  textureLoader.load(objData.photoDataUrl, (texture) => {
                    const photoSurface = obj.getObjectByName('photoSurface');
                    if (photoSurface) {
                      photoSurface.material.map = texture;
                      photoSurface.material.color.set(0xffffff);
                      photoSurface.material.needsUpdate = true;
                      obj.userData.photoTexture = texture;
                    }
                  });
                }
                break;
              case 'books':
                if (objData.bookTitle) obj.userData.bookTitle = objData.bookTitle;
                if (objData.titleColor) obj.userData.titleColor = objData.titleColor;
                if (objData.pdfPath) obj.userData.pdfPath = objData.pdfPath;
                break;
              case 'coffee':
                if (objData.drinkType) {
                  obj.userData.drinkType = objData.drinkType;
                  const liquid = obj.getObjectByName('liquid');
                  const liquidBody = obj.getObjectByName('liquidBody');
                  if (DRINK_COLORS[objData.drinkType]) {
                    if (liquid) {
                      liquid.material.color.set(DRINK_COLORS[objData.drinkType].color);
                    }
                    if (liquidBody) {
                      liquidBody.material.color.set(DRINK_COLORS[objData.drinkType].color);
                    }
                  }
                }
                if (objData.liquidLevel !== undefined) {
                  obj.userData.liquidLevel = objData.liquidLevel;
                  const liquid = obj.getObjectByName('liquid');
                  const liquidBody = obj.getObjectByName('liquidBody');
                  const level = objData.liquidLevel;
                  if (liquid) {
                    liquid.visible = level > 0.05;
                    liquid.position.y = 0.03 + level * 0.14;
                  }
                  if (liquidBody) {
                    liquidBody.visible = level > 0.05;
                    liquidBody.scale.y = Math.max(0.1, level);
                    liquidBody.position.y = 0.015 + level * 0.07;
                  }
                }
                if (objData.isHot !== undefined) obj.userData.isHot = objData.isHot;
                break;
              case 'metronome':
                if (objData.bpm) obj.userData.bpm = objData.bpm;
                if (objData.tickSound !== undefined) obj.userData.tickSound = objData.tickSound;
                if (objData.tickSoundType) obj.userData.tickSoundType = objData.tickSoundType;
                break;
              case 'laptop':
                if (objData.bootTime) obj.userData.bootTime = objData.bootTime;
                if (objData.powerLedColor) obj.userData.powerLedColor = objData.powerLedColor;
                if (objData.powerButtonColor) obj.userData.powerButtonColor = objData.powerButtonColor;
                if (objData.bootScreenDataUrl) {
                  obj.userData.bootScreenDataUrl = objData.bootScreenDataUrl;
                  // Load boot screen texture from data URL
                  const textureLoader = new THREE.TextureLoader();
                  textureLoader.load(objData.bootScreenDataUrl, (texture) => {
                    obj.userData.bootScreenTexture = texture;
                  });
                }
                // Restore markdown editor content
                if (objData.editorContent) obj.userData.editorContent = objData.editorContent;
                if (objData.editorFileName) obj.userData.editorFileName = objData.editorFileName;
                break;
              case 'pen':
                if (objData.penColor) obj.userData.penColor = objData.penColor;
                if (objData.inkColor) {
                  obj.userData.inkColor = objData.inkColor;
                }
                // Update pen body color from mainColor
                if (objData.mainColor) {
                  obj.children.forEach(child => {
                    if (child.isMesh && child.geometry.type === 'CylinderGeometry' && child.position.y > 0.1) {
                      child.material.color.set(objData.mainColor);
                      child.material.needsUpdate = true;
                    }
                  });
                }
                break;
            }
          }
        });

        // Second pass: restore pen holder references
        result.state.objects.forEach((objData, index) => {
          if (objData.type === 'pen' && objData.inHolderIndex !== undefined) {
            const pen = deskObjects[index];
            const holder = deskObjects[objData.inHolderIndex];
            if (pen && holder) {
              pen.userData.inHolder = holder;
              pen.userData.holderSlot = objData.holderSlot;
            }
          }
        });
      } else {
        // Add default objects if no saved objects
        addObjectToDesk('clock', { x: -2, z: -1 });
        addObjectToDesk('lamp', { x: 2, z: -1.2 });
        addObjectToDesk('plant', { x: 2.3, z: 1 });
        addObjectToDesk('coffee', { x: -1.5, z: 0.8 });
      }
    } else {
      // Add default objects if no saved state
      addObjectToDesk('clock', { x: -2, z: -1 });
      addObjectToDesk('lamp', { x: 2, z: -1.2 });
      addObjectToDesk('plant', { x: 2.3, z: 1 });
      addObjectToDesk('coffee', { x: -1.5, z: 0.8 });
    }
  } catch (error) {
    console.error('Failed to load state:', error);
    // Add default objects on error
    addObjectToDesk('clock', { x: -2, z: -1 });
    addObjectToDesk('lamp', { x: 2, z: -1.2 });
  }
}

// ============================================================================
// ANIMATION LOOP
// ============================================================================
function animate() {
  requestAnimationFrame(animate);

  // Update physics
  updatePhysics();

  // Update object positions (lift/drop animation)
  deskObjects.forEach(obj => {
    // Handle examine mode animation
    if (obj.userData.examineTarget) {
      const targetPos = obj.userData.examineTarget;
      const speed = 0.12;

      obj.position.x += (targetPos.x - obj.position.x) * speed;
      obj.position.y += (targetPos.y - obj.position.y) * speed;
      obj.position.z += (targetPos.z - obj.position.z) * speed;

      // Scale animation for examine mode
      if (obj.userData.examineScaleTarget !== undefined) {
        const scaleDiff = obj.userData.examineScaleTarget - obj.scale.x;
        if (Math.abs(scaleDiff) > 0.001) {
          const newScale = obj.scale.x + scaleDiff * speed;
          obj.scale.set(newScale, newScale, newScale);
        }
      }

      // Check if animation is complete
      const dist = new THREE.Vector3(
        targetPos.x - obj.position.x,
        targetPos.y - obj.position.y,
        targetPos.z - obj.position.z
      ).length();

      if (dist < 0.01 && !obj.userData.isExamining && obj.userData.isReturning) {
        obj.userData.examineTarget = null;
        obj.userData.examineScaleTarget = undefined;
        obj.userData.isReturning = false;
      }
    }
    // Normal lift/drop animation (only when not examining)
    else if (obj.userData.targetY !== undefined && !obj.userData.isExamining) {
      const diff = obj.userData.targetY - obj.position.y;
      if (Math.abs(diff) > 0.001) {
        const speed = obj.userData.isLifted ? CONFIG.physics.liftSpeed : CONFIG.physics.dropSpeed;
        obj.position.y += diff * speed;
      }
    }

    // Pen sway animation when being dragged
    // The penBody sub-group rotates to create sway, keeping the cap anchored
    if (obj.userData.type === 'pen') {
      const penBody = obj.getObjectByName('penBody');
      if (isDragging && selectedObject === obj && penBody) {
        // Initialize sway state if not exists
        if (obj.userData.swayPhase === undefined) {
          obj.userData.swayPhase = 0;
          obj.userData.swayVelocityX = 0;
          obj.userData.swayVelocityZ = 0;
        }

        // Calculate sway based on movement velocity
        const now = Date.now();
        if (obj.userData.lastSwayUpdate) {
          const dt = (now - obj.userData.lastSwayUpdate) / 1000;
          // Add some natural oscillation
          obj.userData.swayPhase += dt * 8;

          // Apply pendulum-like sway motion to the pen body
          // This rotates around the cap position, making the tip swing
          const swayAmount = Math.sin(obj.userData.swayPhase) * 0.2;
          const secondarySwayAmount = Math.cos(obj.userData.swayPhase * 0.7) * 0.1;

          // Target rotation for the pen body (relative to the group)
          const targetRotX = swayAmount;
          const targetRotZ = secondarySwayAmount;

          // Smoothly interpolate to target
          penBody.rotation.x += (targetRotX - penBody.rotation.x) * 0.15;
          penBody.rotation.z += (targetRotZ - penBody.rotation.z) * 0.15;
        }
        obj.userData.lastSwayUpdate = now;
      } else if (penBody) {
        // When not dragging, gradually return pen body to neutral position
        if (Math.abs(penBody.rotation.x) > 0.001 || Math.abs(penBody.rotation.z) > 0.001) {
          penBody.rotation.x *= 0.9;
          penBody.rotation.z *= 0.9;
        } else {
          penBody.rotation.x = 0;
          penBody.rotation.z = 0;
        }
        // Reset sway state
        obj.userData.swayPhase = undefined;
        obj.userData.lastSwayUpdate = undefined;
      }
    }

    // Rotate globe
    if (obj.userData.type === 'globe') {
      const globe = obj.getObjectByName('globeSphere');
      const land = obj.getObjectByName('land');
      if (globe) globe.rotation.y += obj.userData.rotationSpeed;
      if (land) land.rotation.y += obj.userData.rotationSpeed;
    }

    // Animate metronome pendulum
    if (obj.userData.type === 'metronome' && obj.userData.isRunning) {
      const pendulum = obj.getObjectByName('pendulum');
      if (pendulum) {
        // Calculate swing timing based on BPM
        // One beat = one swing to the left + one swing to the right, so 2 direction changes per beat
        const bpm = obj.userData.bpm || 120;
        const msPerBeat = 60000 / bpm; // Milliseconds per beat
        const msPerSwing = msPerBeat / 2; // Each half-swing (tick) takes half a beat
        const now = Date.now();

        // Initialize last tick time if needed
        if (!obj.userData.lastTickTime) {
          obj.userData.lastTickTime = now;
        }

        const timeSinceLastTick = now - obj.userData.lastTickTime;
        const maxAngle = Math.PI / 6; // ~30 degrees max swing

        // Animate smoothly based on time
        const swingProgress = (timeSinceLastTick % msPerSwing) / msPerSwing;
        const swingAngle = Math.sin(swingProgress * Math.PI) * maxAngle * obj.userData.pendulumDirection;

        // Check if we've completed a half-swing (tick)
        if (timeSinceLastTick >= msPerSwing) {
          obj.userData.lastTickTime = now;
          obj.userData.pendulumDirection *= -1;

          // Play sound at each swing endpoint
          if (obj.userData.tickSound) {
            try {
              const audioCtx = getSharedAudioContext();
              const currentTime = audioCtx.currentTime;

              if (obj.userData.tickSoundType === 'beep') {
                // Simple beep sound
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.frequency.value = 880; // A5 note
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.1, currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, currentTime + 0.08);
                osc.start(currentTime);
                osc.stop(currentTime + 0.1);
              } else {
                // Default: Strike/click sound (more percussive/mechanical)
                const osc = audioCtx.createOscillator();
                const osc2 = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                const filter = audioCtx.createBiquadFilter();

                // Connect oscillators through filter
                osc.connect(filter);
                osc2.connect(filter);
                filter.connect(gain);
                gain.connect(audioCtx.destination);

                // Mechanical metronome click sound
                // Use lower frequencies for a wooden "click" sound
                osc.frequency.value = 1200; // Main click frequency
                osc.type = 'sine';
                osc2.frequency.value = 300; // Low body resonance
                osc2.type = 'sine';

                // Bandpass filter for natural wood resonance
                filter.type = 'bandpass';
                filter.frequency.value = 800;
                filter.Q.value = 2;

                // Very sharp attack, quick exponential decay for percussive "tick"
                gain.gain.setValueAtTime(0.25, currentTime);
                gain.gain.exponentialRampToValueAtTime(0.08, currentTime + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.01, currentTime + 0.04);

                osc.start(currentTime);
                osc2.start(currentTime);
                osc.stop(currentTime + 0.05);
                osc2.stop(currentTime + 0.05);
              }
            } catch (e) {}
          }
        }

        pendulum.rotation.z = swingAngle;
        obj.userData.pendulumAngle = swingAngle;
      }
    }

    // Animate mug: steam and liquid pouring when tilted
    if (obj.userData.type === 'coffee') {
      // Check if mug is tilted enough to pour liquid
      const tiltAngle = Math.sqrt(obj.rotation.x * obj.rotation.x + obj.rotation.z * obj.rotation.z);
      const pourThreshold = 0.4; // About 23 degrees

      if (tiltAngle > pourThreshold && obj.userData.liquidLevel > 0.05 && !obj.userData.isSipping) {
        // Calculate pour rate based on tilt angle
        const pourRate = Math.min(0.005, (tiltAngle - pourThreshold) * 0.02);
        obj.userData.liquidLevel = Math.max(0, obj.userData.liquidLevel - pourRate);

        // Update liquid visual
        const liquid = obj.getObjectByName('liquid');
        const liquidBody = obj.getObjectByName('liquidBody');
        const level = obj.userData.liquidLevel;
        if (liquid) {
          if (level < 0.05) {
            liquid.visible = false;
          } else {
            liquid.visible = true;
            liquid.position.y = 0.03 + level * 0.14;
          }
        }
        if (liquidBody) {
          if (level < 0.05) {
            liquidBody.visible = false;
          } else {
            liquidBody.visible = true;
            liquidBody.scale.y = Math.max(0.1, level);
            liquidBody.position.y = 0.015 + level * 0.07;
          }
        }

        // Create or update pour effect
        let pourEffect = obj.getObjectByName('pourEffect');
        if (!pourEffect && obj.userData.liquidLevel > 0.05) {
          pourEffect = createPourEffect(obj.userData.drinkType || 'coffee');
          pourEffect.name = 'pourEffect';
          obj.add(pourEffect);
        }
        if (pourEffect) {
          pourEffect.visible = true;
          // Animate pour droplets
          pourEffect.children.forEach((drop, i) => {
            drop.position.y -= 0.03;
            drop.material.opacity -= 0.02;
            if (drop.position.y < -0.5 || drop.material.opacity <= 0) {
              drop.position.y = 0.15;
              drop.material.opacity = 0.8;
            }
          });
        }
      } else {
        // Hide pour effect when not tilted
        const pourEffect = obj.getObjectByName('pourEffect');
        if (pourEffect) pourEffect.visible = false;

        // Add subtle liquid wobble animation when examining or dragging
        if (obj.userData.liquidLevel > 0.05) {
          const liquid = obj.getObjectByName('liquid');
          if (liquid) {
            // Subtle wave effect based on time
            const time = Date.now() * 0.002;
            const wobbleX = Math.sin(time) * 0.02;
            const wobbleZ = Math.cos(time * 0.7) * 0.02;
            // Apply subtle tilt that follows any existing rotation
            liquid.rotation.x = -Math.PI / 2 + wobbleX;
            liquid.rotation.z = wobbleZ;
          }
        }
      }

      // Steam effect for hot mug
      if (obj.userData.isHot && obj.userData.liquidLevel > 0.1 && tiltAngle < pourThreshold) {
        let steam = obj.getObjectByName('steam');
        if (!steam) {
          steam = createSteamEffect();
          steam.name = 'steam';
          obj.add(steam);
        }
        steam.visible = true;

        // Animate steam wisps floating up
        steam.children.forEach((wisp, i) => {
          wisp.position.y += 0.002;
          wisp.material.opacity -= 0.002;

          // Reset when wisp floats too high or fades out
          if (wisp.position.y > 0.4 || wisp.material.opacity <= 0) {
            wisp.position.set(
              (Math.random() - 0.5) * 0.05,
              0.22,
              (Math.random() - 0.5) * 0.05
            );
            wisp.material.opacity = 0.3;
          }
        });
      } else {
        const steam = obj.getObjectByName('steam');
        if (steam) steam.visible = false;
      }
    }
  });

  // Render with pixel art post-processing if enabled
  if (CONFIG.pixelation.enabled) {
    renderPixelArt();
  } else {
    renderer.render(scene, camera);
  }
}

// ============================================================================
// PIXEL ART RENDER PASS
// ============================================================================
function renderPixelArt() {
  const uniforms = pixelatedMaterial.uniforms;

  // Pass 1: Render scene to low-resolution texture
  renderer.setRenderTarget(pixelRenderTarget);
  renderer.clear();
  renderer.render(scene, camera);

  // Pass 2: Render normals for edge detection
  const overrideMaterial = scene.overrideMaterial;
  renderer.setRenderTarget(normalRenderTarget);
  scene.overrideMaterial = normalMaterial;
  renderer.clear();
  renderer.render(scene, camera);
  scene.overrideMaterial = overrideMaterial;

  // Pass 3: Apply pixelated shader to screen
  uniforms.tDiffuse.value = pixelRenderTarget.texture;
  uniforms.tDepth.value = pixelRenderTarget.depthTexture;
  uniforms.tNormal.value = normalRenderTarget.texture;

  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(fsQuad, fsCamera);
}

// ============================================================================
// START APPLICATION
// ============================================================================
init();
