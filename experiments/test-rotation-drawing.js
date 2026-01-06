// Test script to understand and verify the rotation drawing bug
// Issue #105: When rotating paper, drawing doesn't happen under the pen

// Current buggy implementation (from renderer.js lines 8614-8650)
function worldToDrawingCoords_BUGGY(worldPos, drawableObject) {
  // Get object's world position and rotation
  const objPos = { x: 0, y: 0, z: 0 }; // Simplified for test

  // Calculate local offset
  const localX = worldPos.x - objPos.x;
  const localZ = worldPos.z - objPos.z;

  // Get object dimensions with scale applied
  const baseWidth = 0.28;
  const baseDepth = 0.4;
  const scale = 1.0;
  const width = baseWidth * scale;
  const depth = baseDepth * scale;

  // Convert to normalized coordinates (0-1)
  const normalizedX = (localX / width) + 0.5;
  const normalizedY = (localZ / depth) + 0.5;

  // Apply object rotation (BUG: This is applied AFTER local offset calculation)
  const rotation = drawableObject.rotation;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const centeredX = normalizedX - 0.5;
  const centeredY = normalizedY - 0.5;
  const rotatedX = centeredX * cos - centeredY * sin + 0.5;
  const rotatedY = centeredX * sin + centeredY * cos + 0.5;

  // Convert to canvas coordinates (512x512 for drawing)
  const canvasSize = 512;
  return {
    x: Math.floor(rotatedX * canvasSize),
    y: Math.floor(rotatedY * canvasSize)
  };
}

// Fixed implementation
function worldToDrawingCoords_FIXED(worldPos, drawableObject) {
  // Get object's world position and rotation
  const objPos = { x: 0, y: 0, z: 0 }; // Simplified for test

  // Calculate local offset from object center
  const localX = worldPos.x - objPos.x;
  const localZ = worldPos.z - objPos.z;

  // FIX: Apply rotation to local offset FIRST (to get object-space coordinates)
  const rotation = drawableObject.rotation;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const rotatedLocalX = localX * cos - localZ * sin;
  const rotatedLocalZ = localX * sin + localZ * cos;

  // Get object dimensions with scale applied
  const baseWidth = 0.28;
  const baseDepth = 0.4;
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

// Test case: Paper rotated 90 degrees, pen at position (0.1, 0)
console.log('=== Test: Paper rotated 90 degrees (PI/2 radians) ===');
const worldPos = { x: 0.1, y: 0, z: 0 };
const paperRotated90 = { rotation: Math.PI / 2 };

console.log('World position:', worldPos);
console.log('Paper rotation:', paperRotated90.rotation, 'radians (90 degrees)');

const buggyResult = worldToDrawingCoords_BUGGY(worldPos, paperRotated90);
const fixedResult = worldToDrawingCoords_FIXED(worldPos, paperRotated90);

console.log('\nBuggy result:', buggyResult);
console.log('Fixed result:', fixedResult);

console.log('\n=== Explanation ===');
console.log('The buggy version applies rotation AFTER converting to normalized coordinates.');
console.log('This causes the drawing to appear at wrong location when paper is rotated.');
console.log('The fixed version applies rotation to local offset FIRST, converting world');
console.log('coordinates to object-space coordinates before normalizing.');

console.log('\n=== Test: Paper not rotated (0 degrees) ===');
const paperNotRotated = { rotation: 0 };
const buggyResult2 = worldToDrawingCoords_BUGGY(worldPos, paperNotRotated);
const fixedResult2 = worldToDrawingCoords_FIXED(worldPos, paperNotRotated);

console.log('Buggy result:', buggyResult2);
console.log('Fixed result:', fixedResult2);
console.log('(Should be identical when rotation is 0)');
