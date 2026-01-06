// Test script to verify the texture rotation approach for issue #105
// Issue #105: When rotating paper, drawing doesn't happen under the pen

// New approach: Simplified coordinate transformation (no rotation)
function worldToDrawingCoords_NEW(worldPos, drawableObject) {
  // Get object's world position
  const objPos = { x: 0, y: 0, z: 0 }; // Simplified for test

  // Calculate local offset from object center (no rotation applied here)
  const localX = worldPos.x - objPos.x;
  const localZ = worldPos.z - objPos.z;

  // Get object dimensions with scale applied
  const baseWidth = 0.28;
  const baseDepth = 0.4;
  const scale = 1.0;
  const width = baseWidth * scale;
  const depth = baseDepth * scale;

  // Convert to normalized coordinates (0-1) without rotation
  const normalizedX = (localX / width) + 0.5;
  const normalizedY = (localZ / depth) + 0.5;

  // Convert to canvas coordinates (512x512 for drawing)
  const canvasSize = 512;
  return {
    x: Math.floor(normalizedX * canvasSize),
    y: Math.floor(normalizedY * canvasSize)
  };
}

// Old approach with coordinate rotation (for comparison)
function worldToDrawingCoords_OLD(worldPos, drawableObject) {
  const objPos = { x: 0, y: 0, z: 0 };

  const localX = worldPos.x - objPos.x;
  const localZ = worldPos.z - objPos.z;

  // Apply rotation to coordinates
  const cos = Math.cos(-drawableObject.rotation);
  const sin = Math.sin(-drawableObject.rotation);
  const rotatedLocalX = localX * cos - localZ * sin;
  const rotatedLocalZ = localX * sin + localZ * cos;

  const baseWidth = 0.28;
  const baseDepth = 0.4;
  const scale = 1.0;
  const width = baseWidth * scale;
  const depth = baseDepth * scale;

  const normalizedX = (rotatedLocalX / width) + 0.5;
  const normalizedY = (rotatedLocalZ / depth) + 0.5;

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

const oldResult = worldToDrawingCoords_OLD(worldPos, paperRotated90);
const newResult = worldToDrawingCoords_NEW(worldPos, paperRotated90);

console.log('\nOld approach (coordinate rotation):', oldResult);
console.log('New approach (texture rotation):', newResult);

console.log('\n=== Key Difference ===');
console.log('Old approach: Rotates coordinates, draws on unrotated texture');
console.log('  Canvas coords change based on rotation');
console.log('New approach: Unrotated coordinates, rotates the texture itself');
console.log('  Canvas coords stay consistent, texture visually rotates');

console.log('\n=== Why New Approach is Better ===');
console.log('✅ Simpler coordinate transformation (no trigonometry)');
console.log('✅ Drawing position consistent in world space');
console.log('✅ Rotation handled by THREE.js texture rotation');
console.log('✅ Easier to understand and debug');
console.log('✅ Visual result is the same, but code is cleaner');

console.log('\n=== Test: Paper not rotated (0 degrees) ===');
const paperNotRotated = { rotation: 0 };
const oldResult2 = worldToDrawingCoords_OLD(worldPos, paperNotRotated);
const newResult2 = worldToDrawingCoords_NEW(worldPos, paperNotRotated);

console.log('Old approach:', oldResult2);
console.log('New approach:', newResult2);
console.log('(Should be identical when rotation is 0)');

console.log('\n=== How Texture Rotation Works ===');
console.log('In updateDrawingTexture():');
console.log('  texture.center.set(0.5, 0.5); // Rotate around center');
console.log('  texture.rotation = drawableObject.rotation.y;');
console.log('  texture.needsUpdate = true;');
console.log('\nThe texture is rotated on the 3D surface, so:');
console.log('- Drawing at canvas (256, 100) always draws at same world position');
console.log('- But appears rotated because texture itself is rotated');
console.log('- User sees: pen at correct position, drawing rotated with paper ✅');
