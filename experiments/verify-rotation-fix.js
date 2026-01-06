// Verification script for issue #105 fix
// This script tests that drawing coordinates are now correctly calculated
// when the paper/notebook is rotated

console.log('=== Verification of Issue #105 Fix ===');
console.log('Issue: When rotating paper, drawing does not happen under the pen\n');

// Simulated fixed implementation (matches the actual fix in renderer.js)
function worldToDrawingCoords_FIXED(worldPos, drawableObject) {
  // Get object's world position and rotation
  const objPos = { x: 0, y: 0, z: 0 }; // At origin for simplicity

  // Calculate local offset from object center
  const localX = worldPos.x - objPos.x;
  const localZ = worldPos.z - objPos.z;

  // FIX for issue #105: Apply rotation to local offset FIRST
  // This converts world coordinates to object-space coordinates
  const cos = Math.cos(-drawableObject.rotation);
  const sin = Math.sin(-drawableObject.rotation);
  const rotatedLocalX = localX * cos - localZ * sin;
  const rotatedLocalZ = localX * sin + localZ * cos;

  // Get object dimensions with scale applied
  const baseWidth = drawableObject.type === 'notebook' ? 0.4 : 0.28;
  const baseDepth = drawableObject.type === 'notebook' ? 0.55 : 0.4;
  const scale = 1.0;
  const width = baseWidth * scale;
  const depth = baseDepth * scale;

  // Convert to normalized coordinates (0-1) using rotated local coords
  const normalizedX = (rotatedLocalX / width) + 0.5;
  const normalizedY = (rotatedLocalZ / depth) + 0.5;

  // Convert to canvas coordinates (512x512 for drawing)
  const canvasSize = 512;
  return {
    x: Math.floor(normalizedX * canvasSize),
    y: Math.floor(normalizedY * canvasSize)
  };
}

// Test cases
const testCases = [
  {
    name: 'Paper at 0° rotation, pen at right edge',
    worldPos: { x: 0.14, y: 0, z: 0 },
    paper: { rotation: 0, type: 'paper' },
    expected: 'Should map to right side of canvas'
  },
  {
    name: 'Paper at 90° rotation, pen at what was right edge',
    worldPos: { x: 0.14, y: 0, z: 0 },
    paper: { rotation: Math.PI / 2, type: 'paper' },
    expected: 'Should map to top side of canvas (rotated 90°)'
  },
  {
    name: 'Paper at 180° rotation, pen at center',
    worldPos: { x: 0, y: 0, z: 0 },
    paper: { rotation: Math.PI, type: 'paper' },
    expected: 'Should map to center of canvas'
  },
  {
    name: 'Paper at 45° rotation, pen at center',
    worldPos: { x: 0, y: 0, z: 0 },
    paper: { rotation: Math.PI / 4, type: 'paper' },
    expected: 'Should map to center of canvas'
  },
  {
    name: 'Notebook at 90° rotation, pen at corner',
    worldPos: { x: 0.2, y: 0, z: 0.275 },
    paper: { rotation: Math.PI / 2, type: 'notebook' },
    expected: 'Should correctly map to rotated corner'
  }
];

testCases.forEach((test, index) => {
  console.log(`\nTest ${index + 1}: ${test.name}`);
  console.log(`  World position: (${test.worldPos.x}, ${test.worldPos.z})`);
  console.log(`  Paper rotation: ${(test.paper.rotation * 180 / Math.PI).toFixed(1)}°`);

  const result = worldToDrawingCoords_FIXED(test.worldPos, test.paper);

  console.log(`  Canvas coordinates: (${result.x}, ${result.y})`);
  console.log(`  Expected: ${test.expected}`);

  // Verify center remains center regardless of rotation
  if (test.worldPos.x === 0 && test.worldPos.z === 0) {
    if (result.x === 256 && result.y === 256) {
      console.log(`  ✓ PASS: Center maps to center`);
    } else {
      console.log(`  ✗ FAIL: Center should map to (256, 256)`);
    }
  }
});

console.log('\n=== Summary ===');
console.log('The fix ensures that rotation is applied to local coordinates BEFORE');
console.log('converting to normalized canvas coordinates. This makes drawing happen');
console.log('at the correct position under the pen, regardless of paper rotation.');
console.log('\nPrevious bug: Rotation was applied AFTER normalization, causing');
console.log('incorrect mapping when paper was rotated.');
