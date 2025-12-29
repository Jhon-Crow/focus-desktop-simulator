// Focus Desktop Simulator - Main Renderer
// Uses Three.js for 3D isometric desk simulation

const THREE = require('three');

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  camera: {
    fov: 45,
    near: 0.1,
    far: 1000,
    position: { x: 8, y: 10, z: 8 },
    lookAt: { x: 0, y: 0, z: 0 }
  },
  desk: {
    width: 6,
    depth: 4,
    height: 0.15,
    legHeight: 2,
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

// ============================================================================
// INITIALIZATION
// ============================================================================
function init() {
  // Create scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.colors.background);

  // Create camera (isometric-like perspective)
  const aspect = window.innerWidth / window.innerHeight;
  camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, aspect, CONFIG.camera.near, CONFIG.camera.far);
  camera.position.set(CONFIG.camera.position.x, CONFIG.camera.position.y, CONFIG.camera.position.z);
  camera.lookAt(CONFIG.camera.lookAt.x, CONFIG.camera.lookAt.y, CONFIG.camera.lookAt.z);

  // Create renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  // Create raycaster for mouse interaction
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Create invisible drag plane
  const planeGeometry = new THREE.PlaneGeometry(100, 100);
  const planeMaterial = new THREE.MeshBasicMaterial({ visible: false });
  dragPlane = new THREE.Mesh(planeGeometry, planeMaterial);
  dragPlane.rotation.x = -Math.PI / 2;
  dragPlane.position.y = CONFIG.desk.height + CONFIG.desk.legHeight;
  scene.add(dragPlane);

  // Setup lighting
  setupLighting();

  // Create desk
  createDesk();

  // Create floor
  createFloor();

  // Setup event listeners
  setupEventListeners();

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

  // Desktop surface
  const topGeometry = new THREE.BoxGeometry(CONFIG.desk.width, CONFIG.desk.height, CONFIG.desk.depth);
  const topMaterial = new THREE.MeshStandardMaterial({
    color: CONFIG.desk.color,
    roughness: 0.7,
    metalness: 0.1
  });
  const deskTop = new THREE.Mesh(topGeometry, topMaterial);
  deskTop.position.y = CONFIG.desk.legHeight + CONFIG.desk.height / 2;
  deskTop.castShadow = true;
  deskTop.receiveShadow = true;
  deskGroup.add(deskTop);

  // Desk legs
  const legGeometry = new THREE.BoxGeometry(0.15, CONFIG.desk.legHeight, 0.15);
  const legMaterial = new THREE.MeshStandardMaterial({
    color: 0x5c4a1f,
    roughness: 0.8,
    metalness: 0.1
  });

  const legPositions = [
    { x: -CONFIG.desk.width / 2 + 0.2, z: -CONFIG.desk.depth / 2 + 0.2 },
    { x: CONFIG.desk.width / 2 - 0.2, z: -CONFIG.desk.depth / 2 + 0.2 },
    { x: -CONFIG.desk.width / 2 + 0.2, z: CONFIG.desk.depth / 2 - 0.2 },
    { x: CONFIG.desk.width / 2 - 0.2, z: CONFIG.desk.depth / 2 - 0.2 }
  ];

  legPositions.forEach(pos => {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(pos.x, CONFIG.desk.legHeight / 2, pos.z);
    leg.castShadow = true;
    leg.receiveShadow = true;
    deskGroup.add(leg);
  });

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

  // Clock body
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

  // Clock face
  const faceGeometry = new THREE.CircleGeometry(0.35, 32);
  const faceMaterial = new THREE.MeshStandardMaterial({
    color: 0xfafafa,
    roughness: 0.5
  });
  const face = new THREE.Mesh(faceGeometry, faceMaterial);
  face.position.z = 0.051;
  group.add(face);

  // Hour hand
  const hourGeometry = new THREE.BoxGeometry(0.03, 0.18, 0.02);
  const handMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.3,
    metalness: 0.7
  });
  const hourHand = new THREE.Mesh(hourGeometry, handMaterial);
  hourHand.position.set(0, 0.09, 0.06);
  hourHand.name = 'hourHand';
  group.add(hourHand);

  // Minute hand
  const minuteGeometry = new THREE.BoxGeometry(0.02, 0.25, 0.02);
  const minuteHand = new THREE.Mesh(minuteGeometry, handMaterial);
  minuteHand.position.set(0, 0.125, 0.07);
  minuteHand.name = 'minuteHand';
  group.add(minuteHand);

  // Second hand
  const secondGeometry = new THREE.BoxGeometry(0.01, 0.28, 0.01);
  const secondMaterial = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    roughness: 0.3,
    metalness: 0.5
  });
  const secondHand = new THREE.Mesh(secondGeometry, secondMaterial);
  secondHand.position.set(0, 0.14, 0.08);
  secondHand.name = 'secondHand';
  group.add(secondHand);

  // Center dot
  const centerGeometry = new THREE.SphereGeometry(0.03, 16, 16);
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

  // Base
  const baseGeometry = new THREE.CylinderGeometry(0.3, 0.35, 0.08, 32);
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.3,
    metalness: 0.7
  });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.castShadow = true;
  group.add(base);

  // Arm
  const armGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.8, 16);
  const armMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.3,
    metalness: 0.7
  });
  const arm = new THREE.Mesh(armGeometry, armMaterial);
  arm.position.y = 0.4;
  arm.rotation.z = Math.PI / 8;
  arm.castShadow = true;
  group.add(arm);

  // Lamp head (cone shade)
  const headGeometry = new THREE.ConeGeometry(0.25, 0.3, 32, 1, true);
  const headMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.4,
    metalness: 0.5,
    side: THREE.DoubleSide
  });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.set(0.15, 0.75, 0);
  head.rotation.z = -Math.PI / 4;
  head.castShadow = true;
  group.add(head);

  // Light bulb (emissive sphere)
  const bulbGeometry = new THREE.SphereGeometry(0.08, 16, 16);
  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    emissive: new THREE.Color(group.userData.accentColor),
    emissiveIntensity: 0.8,
    roughness: 0.2
  });
  const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
  bulb.position.set(0.15, 0.65, 0);
  bulb.name = 'bulb';
  group.add(bulb);

  // Add point light
  const light = new THREE.PointLight(new THREE.Color(group.userData.accentColor), 0.5, 3);
  light.position.set(0.15, 0.65, 0);
  light.name = 'lampLight';
  group.add(light);

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
    name: 'Books',
    interactive: false,
    mainColor: options.mainColor || '#7c3aed',
    accentColor: options.accentColor || '#f59e0b'
  };

  const bookColors = [
    new THREE.Color(group.userData.mainColor),
    new THREE.Color(group.userData.accentColor),
    new THREE.Color('#ef4444')
  ];

  bookColors.forEach((color, i) => {
    const bookGeometry = new THREE.BoxGeometry(0.25, 0.35 - i * 0.03, 0.05 + Math.random() * 0.02);
    const bookMaterial = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.7
    });
    const book = new THREE.Mesh(bookGeometry, bookMaterial);
    book.position.y = 0.175 - i * 0.015;
    book.rotation.z = Math.PI / 2;
    book.position.z = i * 0.06;
    book.castShadow = true;
    group.add(book);
  });

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
  return CONFIG.desk.legHeight + CONFIG.desk.height;
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
    saveState();
  }
}

function updateObjectColor(object, colorType, colorValue) {
  if (!object) return;

  object.userData[colorType] = colorValue;

  // Update materials based on object type
  object.traverse((child) => {
    if (child.isMesh && child.material) {
      // This is a simplified color update - specific objects may need custom logic
      if (colorType === 'mainColor') {
        // Update main body parts
        if (!child.name.includes('screen') && !child.name.includes('bulb')) {
          if (child.material.color) {
            // Check if this looks like a main part
            const currentHex = child.material.color.getHexString();
            if (currentHex !== 'ffffff' && currentHex !== '000000') {
              child.material.color.set(colorValue);
            }
          }
        }
      }
    }
  });

  saveState();
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

      if (hourHand) {
        const hourAngle = -((now.getHours() % 12) / 12) * Math.PI * 2 - (now.getMinutes() / 60) * (Math.PI / 6);
        hourHand.rotation.z = hourAngle;
        hourHand.position.y = Math.cos(hourAngle) * 0.09;
        hourHand.position.x = Math.sin(hourAngle) * 0.09;
      }

      if (minuteHand) {
        const minuteAngle = -(now.getMinutes() / 60) * Math.PI * 2;
        minuteHand.rotation.z = minuteAngle;
        minuteHand.position.y = Math.cos(minuteAngle) * 0.125;
        minuteHand.position.x = Math.sin(minuteAngle) * 0.125;
      }

      if (secondHand) {
        const secondAngle = -(now.getSeconds() / 60) * Math.PI * 2;
        secondHand.rotation.z = secondAngle;
        secondHand.position.y = Math.cos(secondAngle) * 0.14;
        secondHand.position.x = Math.sin(secondAngle) * 0.14;
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

  // Window resize
  window.addEventListener('resize', onWindowResize, false);

  // Menu toggle
  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('menu').classList.toggle('open');
  });

  // Preset items
  document.querySelectorAll('.preset-item').forEach(item => {
    item.addEventListener('click', () => {
      const preset = item.dataset.preset;
      addObjectToDesk(preset);
      document.getElementById('menu').classList.remove('open');
    });
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
}

function onMouseDown(event) {
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

      // Lift the object
      object.userData.isLifted = true;
      object.userData.targetY = object.userData.originalY + CONFIG.physics.liftHeight;

      // Close customization panel when starting drag
      document.getElementById('customization-panel').classList.remove('open');
    }
  }
}

function onMouseMove(event) {
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
  if (isDragging && selectedObject) {
    // Drop the object
    selectedObject.userData.isLifted = false;
    selectedObject.userData.targetY = selectedObject.userData.originalY;
    isDragging = false;
    saveState();
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

function updateMousePosition(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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
      mainColor: obj.userData.mainColor,
      accentColor: obj.userData.accentColor
    }))
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

    if (result.success && result.state && result.state.objects) {
      result.state.objects.forEach(objData => {
        addObjectToDesk(objData.type, {
          x: objData.x,
          z: objData.z,
          mainColor: objData.mainColor,
          accentColor: objData.accentColor
        });
      });
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

  // Update object positions (lift/drop animation)
  deskObjects.forEach(obj => {
    if (obj.userData.targetY !== undefined) {
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

  renderer.render(scene, camera);
}

// ============================================================================
// START APPLICATION
// ============================================================================
init();
