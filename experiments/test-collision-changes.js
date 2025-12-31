/**
 * Test script to verify the collision changes work correctly
 * Run with: node experiments/test-collision-changes.js
 */

// Mock THREE.js objects
const THREE = {
  Group: class {
    constructor() { this.userData = {}; this.position = { x: 0, y: 0, z: 0, copy: function(p) { this.x = p.x; this.y = p.y; this.z = p.z; } }; this.scale = { x: 1, y: 1, z: 1 }; }
  }
};

// Extract relevant code from renderer.js for testing
const OBJECT_PHYSICS = {
  'clock': { weight: 0.5, stability: 0.5, height: 0.6, baseOffset: 0.35, friction: 0.4, noStackingOnTop: true },
  'lamp': { weight: 1.2, stability: 0.85, height: 0.9, baseOffset: 0, friction: 0.5 },
  'laptop': { weight: 1.5, stability: 0.95, height: 0.3, baseOffset: 0, friction: 0.6 },
  'notebook': { weight: 0.3, stability: 0.95, height: 0.1, baseOffset: 0, friction: 0.7 },
  'photo-frame': { weight: 0.3, stability: 0.35, height: 0.5, baseOffset: 0.25, friction: 0.4, noStackingOnTop: true }
};

function getObjectPhysics(object) {
  const type = object.userData.type;
  return OBJECT_PHYSICS[type] || { weight: 0.5, stability: 0.5, height: 0.3, baseOffset: 0, friction: 0.5 };
}

function getExtraCollisionPoints(object) {
  const type = object.userData.type;
  const scale = object.scale?.x || 1;

  if (type === 'laptop') {
    const points = [];
    const screenTilt = Math.PI / 6;
    const screenHeight = 0.5;
    const screenWidth = 0.78;
    const screenCenterY = 0.28;
    const screenCenterZ = -0.23;

    const topEdgeY = screenCenterY + (screenHeight / 2) * Math.cos(screenTilt);
    const topEdgeZ = screenCenterZ - (screenHeight / 2) * Math.sin(screenTilt);

    const numPoints = 5;
    const collisionRadius = 0.04;
    const collisionHeight = 0.25;

    for (let i = 0; i < numPoints; i++) {
      const t = (i / (numPoints - 1)) - 0.5;
      const xOffset = t * (screenWidth - 0.1);

      points.push({
        x: xOffset * scale,
        z: topEdgeZ * scale,
        radius: collisionRadius * scale,
        height: collisionHeight * scale,
        baseY: topEdgeY * scale
      });
    }

    return points;
  }

  return [];
}

// Tests
console.log('Testing collision changes...\n');

// Test 1: noStackingOnTop property
console.log('Test 1: noStackingOnTop property');
const clockPhysics = OBJECT_PHYSICS['clock'];
const photoFramePhysics = OBJECT_PHYSICS['photo-frame'];
const laptopPhysics = OBJECT_PHYSICS['laptop'];
const lampPhysics = OBJECT_PHYSICS['lamp'];

console.log(`  Clock noStackingOnTop: ${clockPhysics.noStackingOnTop === true ? 'PASS' : 'FAIL'}`);
console.log(`  Photo-frame noStackingOnTop: ${photoFramePhysics.noStackingOnTop === true ? 'PASS' : 'FAIL'}`);
console.log(`  Laptop noStackingOnTop: ${laptopPhysics.noStackingOnTop === undefined ? 'PASS (undefined = allows stacking)' : 'FAIL'}`);
console.log(`  Lamp noStackingOnTop: ${lampPhysics.noStackingOnTop === undefined ? 'PASS (undefined = allows stacking)' : 'FAIL'}`);

// Test 2: Extra collision points for laptop
console.log('\nTest 2: Extra collision points for laptop');
const mockLaptop = new THREE.Group();
mockLaptop.userData.type = 'laptop';

const laptopPoints = getExtraCollisionPoints(mockLaptop);
console.log(`  Laptop has ${laptopPoints.length} collision points: ${laptopPoints.length === 5 ? 'PASS' : 'FAIL'}`);

if (laptopPoints.length > 0) {
  console.log(`  First point x: ${laptopPoints[0].x.toFixed(3)}`);
  console.log(`  First point z: ${laptopPoints[0].z.toFixed(3)}`);
  console.log(`  First point baseY: ${laptopPoints[0].baseY.toFixed(3)}`);
  console.log(`  Points spread across X axis: ${laptopPoints[0].x < 0 && laptopPoints[4].x > 0 ? 'PASS' : 'FAIL'}`);
}

// Test 3: No extra collision points for other objects
console.log('\nTest 3: No extra collision points for non-laptop objects');
const mockClock = new THREE.Group();
mockClock.userData.type = 'clock';
const clockPoints = getExtraCollisionPoints(mockClock);
console.log(`  Clock has ${clockPoints.length} extra points: ${clockPoints.length === 0 ? 'PASS' : 'FAIL'}`);

const mockNotebook = new THREE.Group();
mockNotebook.userData.type = 'notebook';
const notebookPoints = getExtraCollisionPoints(mockNotebook);
console.log(`  Notebook has ${notebookPoints.length} extra points: ${notebookPoints.length === 0 ? 'PASS' : 'FAIL'}`);

// Test 4: Scale affects collision points
console.log('\nTest 4: Scale affects collision points');
const mockLaptopScaled = new THREE.Group();
mockLaptopScaled.userData.type = 'laptop';
mockLaptopScaled.scale = { x: 2, y: 2, z: 2 };

const scaledPoints = getExtraCollisionPoints(mockLaptopScaled);
const normalPoint = laptopPoints[0];
const scaledPoint = scaledPoints[0];

console.log(`  Scaled radius is 2x normal: ${Math.abs(scaledPoint.radius / normalPoint.radius - 2) < 0.001 ? 'PASS' : 'FAIL'}`);
console.log(`  Scaled height is 2x normal: ${Math.abs(scaledPoint.height / normalPoint.height - 2) < 0.001 ? 'PASS' : 'FAIL'}`);

console.log('\n=== All tests completed ===');
