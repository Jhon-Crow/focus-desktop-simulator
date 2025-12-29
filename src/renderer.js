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
  intervalId: null
};

// Drag-and-drop state for menu items
let draggedPresetType = null;
let dragPreviewElement = null;

// Examine mode state (bringing object closer to camera)
let examineState = {
  active: false,
  object: null,
  originalPosition: null,
  originalRotation: null,
  originalScale: null
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
  minPitch: -1.0,    // Looking down limit (towards desk, not past it)
  maxPitch: 0.1,     // Looking up limit (slightly above horizontal)
  // Yaw limits centered around the default yaw (±0.8 radians ~ ±45 degrees)
  minYaw: DEFAULT_CAMERA_ANGLES.yaw - 0.8,  // Limit horizontal rotation to left
  maxYaw: DEFAULT_CAMERA_ANGLES.yaw + 0.8   // Limit horizontal rotation to right
};

// Physics state for objects
const physicsState = {
  enabled: true,
  velocities: new Map(),         // Store velocity for each object (x, z)
  angularVelocities: new Map(),  // Store angular velocity for each object (y-axis spin)
  tiltState: new Map(),          // Store tilt state for each object (x, z tilt angles)
  tiltVelocities: new Map(),     // Store tilt velocity for each object
  friction: 0.85,
  bounceFactor: 0.4,
  pushForce: 0.08,
  tiltForce: 0.15,               // How easily objects tip
  tiltRecovery: 0.05,            // How quickly objects recover from tilt
  maxTilt: Math.PI / 3,          // Maximum tilt before falling over (~60 degrees)
  tipOverThreshold: Math.PI / 4  // Angle at which object tips over completely (~45 degrees)
};

// Object weight/stability configurations (affects how easily they tip)
const OBJECT_PHYSICS = {
  'clock': { weight: 0.5, stability: 0.4, height: 0.6 },      // Light, tall, easy to tip
  'lamp': { weight: 0.8, stability: 0.6, height: 0.9 },       // Medium weight, tall
  'plant': { weight: 1.2, stability: 0.8, height: 0.5 },      // Heavy pot, stable
  'coffee': { weight: 0.4, stability: 0.5, height: 0.3 },     // Light mug
  'laptop': { weight: 1.5, stability: 0.9, height: 0.3 },     // Heavy, flat, very stable
  'notebook': { weight: 0.3, stability: 0.95, height: 0.1 },  // Light, flat, very stable
  'pen-holder': { weight: 0.6, stability: 0.5, height: 0.4 }, // Medium, can tip
  'books': { weight: 0.8, stability: 0.85, height: 0.15 },    // Book, flat, stable
  'photo-frame': { weight: 0.3, stability: 0.3, height: 0.5 },// Light, tall, tips easily
  'globe': { weight: 1.0, stability: 0.6, height: 0.5 },      // Medium, balanced
  'trophy': { weight: 0.9, stability: 0.5, height: 0.4 },     // Medium, can tip
  'hourglass': { weight: 0.5, stability: 0.4, height: 0.35 }  // Light, tips easily
};

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
  books: createBooks,
  'photo-frame': createPhotoFrame,
  globe: createGlobe,
  trophy: createTrophy,
  hourglass: createHourglass
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

  // Base - matte material (no metalness/glare)
  const baseGeometry = new THREE.CylinderGeometry(0.3, 0.35, 0.08, 32);
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.9,   // Very rough = no glare
    metalness: 0.0    // No metalness = no reflections
  });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.castShadow = true;
  group.add(base);

  // Arm - more upright (reduced tilt angle), matte material
  const armGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.8, 16);
  const armMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.9,   // Matte finish
    metalness: 0.0    // No reflections
  });
  const arm = new THREE.Mesh(armGeometry, armMaterial);
  arm.position.y = 0.4;
  arm.rotation.z = Math.PI / 24;  // Slightly tilted, mostly upright
  arm.castShadow = true;
  group.add(arm);

  // Lamp head (cone shade) - pointing downward, matte material
  const headGeometry = new THREE.ConeGeometry(0.25, 0.3, 32, 1, true);
  const headMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.9,   // Matte finish
    metalness: 0.0,   // No reflections
    side: THREE.DoubleSide
  });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.set(0.05, 0.82, 0);
  head.rotation.z = -Math.PI / 12;   // Pointing mostly downward
  head.castShadow = true;
  group.add(head);

  // Light bulb (emissive sphere)
  const bulbGeometry = new THREE.SphereGeometry(0.08, 16, 16);
  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    emissive: new THREE.Color(group.userData.accentColor),
    emissiveIntensity: 1.5,
    roughness: 0.2
  });
  const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
  bulb.position.set(0.05, 0.72, 0);
  bulb.name = 'bulb';
  group.add(bulb);

  // SpotLight for focused beam under the lamp (wider coverage)
  const spotLight = new THREE.SpotLight(
    new THREE.Color(group.userData.accentColor),
    3.0,           // High intensity for visible beam
    6,             // Distance the light reaches
    Math.PI / 4,   // Wider cone angle (~45 degrees) for broader spotlight area
    0.3,           // Soft edge (penumbra)
    1.5            // Decay
  );
  spotLight.position.set(0.05, 0.70, 0);
  spotLight.target.position.set(0.05, 0, 0);  // Point straight down at desk
  spotLight.castShadow = true;
  spotLight.shadow.mapSize.width = 512;
  spotLight.shadow.mapSize.height = 512;
  spotLight.name = 'lampSpotLight';
  group.add(spotLight);
  group.add(spotLight.target);

  // Additional ambient/hemisphere light for residual illumination of half the desk
  const hemisphereLight = new THREE.HemisphereLight(
    new THREE.Color(group.userData.accentColor),  // Sky color (warm)
    0x000000,  // Ground color (dark)
    0.3        // Low intensity for subtle ambient effect
  );
  hemisphereLight.position.set(0.05, 0.72, 0);
  hemisphereLight.name = 'lampAmbient';
  group.add(hemisphereLight);

  // Point light for softer ambient spread (illuminates area around the lamp)
  const ambientLight = new THREE.PointLight(
    new THREE.Color(group.userData.accentColor),
    0.8,    // Moderate intensity
    8,      // Larger range to cover half the desk
    2       // Decay
  );
  ambientLight.position.set(0.05, 0.72, 0);
  ambientLight.name = 'lampLight';  // Keep name for toggle compatibility
  group.add(ambientLight);

  group.position.y = getDeskSurfaceY() + 0.04;

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

function createCoffeeMug(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'coffee',
    name: 'Coffee Mug',
    interactive: false,
    mainColor: options.mainColor || '#ffffff',
    accentColor: options.accentColor || '#3b82f6'
  };

  // Mug body
  const mugGeometry = new THREE.CylinderGeometry(0.12, 0.1, 0.2, 32);
  const mugMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.4,
    metalness: 0.1
  });
  const mug = new THREE.Mesh(mugGeometry, mugMaterial);
  mug.position.y = 0.1;
  mug.castShadow = true;
  group.add(mug);

  // Handle
  const handleGeometry = new THREE.TorusGeometry(0.06, 0.015, 8, 16, Math.PI);
  const handleMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.4
  });
  const handle = new THREE.Mesh(handleGeometry, handleMaterial);
  handle.rotation.y = Math.PI / 2;
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0.16, 0.1, 0);
  handle.castShadow = true;
  group.add(handle);

  // Coffee liquid
  const coffeeGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.02, 32);
  const coffeeMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d2914,
    roughness: 0.3
  });
  const coffee = new THREE.Mesh(coffeeGeometry, coffeeMaterial);
  coffee.position.y = 0.18;
  group.add(coffee);

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
    mainColor: options.mainColor || '#1e293b',
    accentColor: options.accentColor || '#60a5fa'
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

  const screenBackGeometry = new THREE.BoxGeometry(0.78, 0.5, 0.02);
  const screenBack = new THREE.Mesh(screenBackGeometry, baseMaterial);
  screenBack.castShadow = true;
  screenGroup.add(screenBack);

  // Screen display
  const displayGeometry = new THREE.PlaneGeometry(0.7, 0.42);
  const displayMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    emissive: new THREE.Color(group.userData.accentColor),
    emissiveIntensity: 0.3,
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
  group.add(keyboard);

  group.position.y = getDeskSurfaceY();

  return group;
}

function createNotebook(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'notebook',
    name: 'Notebook',
    interactive: false,
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
    interactive: false,
    mainColor: options.mainColor || '#64748b',
    accentColor: options.accentColor || '#f472b6'
  };

  // Holder cup
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

  // Pens
  const penColors = [0xef4444, 0x3b82f6, 0x22c55e, 0x000000];
  penColors.forEach((color, i) => {
    const penGeometry = new THREE.CylinderGeometry(0.015, 0.015, 0.35, 8);
    const penMaterial = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.4
    });
    const pen = new THREE.Mesh(penGeometry, penMaterial);
    const angle = (i / penColors.length) * Math.PI * 2;
    pen.position.set(
      Math.cos(angle) * 0.04,
      0.3,
      Math.sin(angle) * 0.04
    );
    pen.rotation.z = (Math.random() - 0.5) * 0.2;
    pen.rotation.x = (Math.random() - 0.5) * 0.2;
    group.add(pen);
  });

  group.position.y = getDeskSurfaceY();

  return group;
}

function createBooks(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'books',
    name: 'Book',
    interactive: false,
    mainColor: options.mainColor || '#7c3aed',
    accentColor: options.accentColor || '#f59e0b'
  };

  // Single book model
  // Book cover
  const coverMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.7
  });

  const coverGeometry = new THREE.BoxGeometry(0.28, 0.04, 0.38);
  const cover = new THREE.Mesh(coverGeometry, coverMaterial);
  cover.position.y = 0.02;
  cover.castShadow = true;
  group.add(cover);

  // Pages (white interior)
  const pagesMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5f5f0,
    roughness: 0.9
  });

  const pagesGeometry = new THREE.BoxGeometry(0.26, 0.035, 0.36);
  const pages = new THREE.Mesh(pagesGeometry, pagesMaterial);
  pages.position.y = 0.02;
  group.add(pages);

  // Spine detail
  const spineMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.6
  });

  const spineGeometry = new THREE.BoxGeometry(0.02, 0.045, 0.38);
  const spine = new THREE.Mesh(spineGeometry, spineMaterial);
  spine.position.set(-0.13, 0.02, 0);
  spine.castShadow = true;
  group.add(spine);

  group.position.y = getDeskSurfaceY();

  return group;
}

function createPhotoFrame(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'photo-frame',
    name: 'Photo Frame',
    interactive: false,
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

  // Photo area
  const photoGeometry = new THREE.PlaneGeometry(0.28, 0.38);
  const photoMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.5
  });
  const photo = new THREE.Mesh(photoGeometry, photoMaterial);
  photo.position.z = 0.016;
  group.add(photo);

  // Stand
  const standGeometry = new THREE.BoxGeometry(0.04, 0.3, 0.15);
  const stand = new THREE.Mesh(standGeometry, frameMaterial);
  stand.position.set(0, -0.1, -0.08);
  stand.rotation.x = Math.PI / 6;
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

  // Apply scale if specified
  if (options.scale !== undefined && options.scale > 0) {
    object.scale.set(options.scale, options.scale, options.scale);
    object.userData.scale = options.scale;
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
function getObjectBounds(object) {
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

        // Calculate push force based on weight difference
        const weightRatio = draggedPhysics.weight / otherPhysics.weight;
        const pushMultiplier = Math.min(weightRatio * 1.5, 3.0);

        const pushX = normalX * physicsState.pushForce * pushMultiplier;
        const pushZ = normalZ * physicsState.pushForce * pushMultiplier;

        const vel = physicsState.velocities.get(obj.userData.id);
        vel.x += pushX;
        vel.z += pushZ;

        // Add tilt based on collision (objects tip away from collision point)
        const tiltVel = physicsState.tiltVelocities.get(obj.userData.id);
        const tiltAmount = physicsState.tiltForce * (1 - otherPhysics.stability) * pushMultiplier;
        tiltVel.x += normalX * tiltAmount;
        tiltVel.z += normalZ * tiltAmount;

        // Add some spin based on collision angle
        const crossProduct = dx * pushZ - dz * pushX;
        const angVel = physicsState.angularVelocities.get(obj.userData.id);
        physicsState.angularVelocities.set(obj.userData.id, angVel + crossProduct * 0.3);

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
  container.addEventListener('dblclick', onDoubleClick, false);
  container.addEventListener('wheel', onMouseWheel, { passive: false });

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
}

function onMouseDown(event) {
  // Middle mouse button - no longer needed for camera look (now always active)
  if (event.button === 1) {
    event.preventDefault();
    return;
  }

  if (event.button !== 0) return; // Left click only

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
      selectedObject = object;
      isDragging = true;

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
  // Always update previous position first
  const deltaX = event.clientX - previousMousePosition.x;
  const deltaY = event.clientY - previousMousePosition.y;

  // FPS-style camera look - always active unless dragging an object or in modal
  const modal = document.getElementById('interaction-modal');
  const isModalOpen = modal && modal.classList.contains('open');

  if (cameraLookState.isLooking && !isDragging && !isModalOpen) {
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
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(dragPlane);

    if (intersects.length > 0) {
      const point = intersects[0].point;

      // Clamp to desk bounds
      const halfWidth = CONFIG.desk.width / 2 - 0.2;
      const halfDepth = CONFIG.desk.depth / 2 - 0.2;

      selectedObject.position.x = Math.max(-halfWidth, Math.min(halfWidth, point.x));
      selectedObject.position.z = Math.max(-halfDepth, Math.min(halfDepth, point.z));
    }
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
  // Middle mouse button no longer used for camera look
  if (event.button === 1) {
    return;
  }

  if (isDragging && selectedObject) {
    // Drop the object
    selectedObject.userData.isLifted = false;
    selectedObject.userData.targetY = selectedObject.userData.originalY;
    isDragging = false;
    saveState();
  }
}

function onMouseWheel(event) {
  updateMousePosition(event);

  // If in examine mode, allow rotation and scaling the examined object with scroll
  // Uses same controls as normal mode: scroll = rotate, shift+scroll = resize
  if (examineState.active && examineState.object) {
    event.preventDefault();

    const object = examineState.object;

    if (event.shiftKey) {
      // Scale object (preserving proportions) with Shift+scroll
      const scaleDelta = event.deltaY > 0 ? 0.95 : 1.05;
      const minScale = 0.3;
      const maxScale = 3.0;

      const newScale = object.scale.x * scaleDelta;
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
        saveState();
      }
    } else {
      // Rotate object around Y axis (perpendicular to desk) with scroll
      const rotationDelta = event.deltaY > 0 ? 0.15 : -0.15;
      object.rotation.y += rotationDelta;
      object.userData.rotationY = object.rotation.y;
      saveState();
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

        const newScale = object.scale.x * scaleDelta;
        if (newScale >= minScale && newScale <= maxScale) {
          object.scale.set(newScale, newScale, newScale);
          object.userData.scale = newScale;
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
    // If not hovering over an object, adjust camera distance
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

function onRightClick(event) {
  event.preventDefault();

  updateMousePosition(event);

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(deskObjects, true);

  if (intersects.length > 0) {
    let object = intersects[0].object;
    while (object.parent && !deskObjects.includes(object)) {
      object = object.parent;
    }

    if (deskObjects.includes(object)) {
      selectedObject = object;

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
    }
  } else {
    document.getElementById('customization-panel').classList.remove('open');
    selectedObject = null;
  }
}

function onDoubleClick(event) {
  updateMousePosition(event);

  // If already in examine mode, exit it
  if (examineState.active) {
    exitExamineMode();
    return;
  }

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(deskObjects, true);

  if (intersects.length > 0) {
    let object = intersects[0].object;
    while (object.parent && !deskObjects.includes(object)) {
      object = object.parent;
    }

    if (deskObjects.includes(object)) {
      // Enter examine mode - bring object closer to camera
      enterExamineMode(object);

      // Also open interaction modal if object is interactive
      if (object.userData.interactive) {
        openInteractionModal(object);
      }
    }
  }
}

function enterExamineMode(object) {
  // Store original state
  examineState.active = true;
  examineState.object = object;
  examineState.originalPosition = object.position.clone();
  examineState.originalRotation = object.rotation.clone();
  examineState.originalScale = object.scale.clone();

  // Calculate position close to camera
  const examineDistance = 2.5;
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  // Target position in front of the camera
  const targetPosition = new THREE.Vector3(
    camera.position.x + direction.x * examineDistance,
    camera.position.y + direction.y * examineDistance + 0.3, // Slight offset up
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
    'hourglass': '⏳'
  };

  title.textContent = object.userData.name;
  icon.textContent = objectIcons[object.userData.type] || '⚙️';

  // Generate content based on object type
  content.innerHTML = getInteractionContent(object);

  // Setup interaction handlers
  setupInteractionHandlers(object);

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
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">Laptop Screen</div>
          </div>
          <div class="timer-buttons">
            <button class="timer-btn start" id="laptop-color">Change Screen Color</button>
          </div>
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

  // Try to play a beep using Web Audio API
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.3;

    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
    }, 200);
  } catch (e) {
    console.log('Audio not available');
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
  const colorBtn = document.getElementById('laptop-color');
  const screenColors = ['#60a5fa', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444'];
  let colorIndex = 0;

  colorBtn.addEventListener('click', () => {
    colorIndex = (colorIndex + 1) % screenColors.length;
    const screen = object.getObjectByName('screen');
    if (screen) {
      screen.material.color.set(screenColors[colorIndex]);
      screen.material.emissive.set(screenColors[colorIndex]);
    }
  });
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
    // Animate flip
    const startRotation = object.rotation.z;
    const endRotation = startRotation + Math.PI;
    const duration = 500;
    const startTime = Date.now();

    function animateFlip() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease in-out
      const easeProgress = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      object.rotation.z = startRotation + (endRotation - startRotation) * easeProgress;

      if (progress < 1) {
        requestAnimationFrame(animateFlip);
      }
    }

    animateFlip();
  });
}

function updateMousePosition(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function updateCameraLook() {
  // Calculate new camera direction based on yaw and pitch
  const lookAt = new THREE.Vector3();

  // Convert spherical to Cartesian coordinates
  lookAt.x = camera.position.x + Math.sin(cameraLookState.yaw) * Math.cos(cameraLookState.pitch);
  lookAt.y = camera.position.y + Math.sin(cameraLookState.pitch);
  lookAt.z = camera.position.z + Math.cos(cameraLookState.yaw) * Math.cos(cameraLookState.pitch);

  camera.lookAt(lookAt);
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
    objects: deskObjects.map(obj => ({
      type: obj.userData.type,
      x: obj.position.x,
      z: obj.position.z,
      rotationY: obj.userData.rotationY || obj.rotation.y,
      scale: obj.userData.scale || obj.scale.x,
      mainColor: obj.userData.mainColor,
      accentColor: obj.userData.accentColor
    })),
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
          addObjectToDesk(objData.type, {
            x: objData.x,
            z: objData.z,
            rotationY: objData.rotationY,
            scale: objData.scale,
            mainColor: objData.mainColor,
            accentColor: objData.accentColor
          });
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

    // Rotate globe
    if (obj.userData.type === 'globe') {
      const globe = obj.getObjectByName('globeSphere');
      const land = obj.getObjectByName('land');
      if (globe) globe.rotation.y += obj.userData.rotationSpeed;
      if (land) land.rotation.y += obj.userData.rotationSpeed;
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
