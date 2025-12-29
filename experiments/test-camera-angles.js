// Test script to verify camera angle calculations
// This validates that the camera control points work correctly

const CONFIG = {
  camera: {
    position: { x: 0, y: 4.5, z: 5.5 },  // Above and in front of desk
    lookAt: { x: 0, y: 0, z: -1.5 }  // Looking at the far edge of the desk
  }
};

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

console.log('=== Camera Control Points Test ===');
console.log('');
console.log('CONFIG.camera.position:', CONFIG.camera.position);
console.log('CONFIG.camera.lookAt:', CONFIG.camera.lookAt);
console.log('');
console.log('Calculated angles:');
console.log('  yaw:', DEFAULT_CAMERA_ANGLES.yaw.toFixed(6), 'radians');
console.log('  yaw:', (DEFAULT_CAMERA_ANGLES.yaw * 180 / Math.PI).toFixed(2), 'degrees');
console.log('  pitch:', DEFAULT_CAMERA_ANGLES.pitch.toFixed(6), 'radians');
console.log('  pitch:', (DEFAULT_CAMERA_ANGLES.pitch * 180 / Math.PI).toFixed(2), 'degrees');
console.log('');

// Verify: compute lookAt direction from yaw/pitch
// The updateCameraLook function uses this formula:
// lookAt.x = camera.position.x + Math.sin(yaw) * Math.cos(pitch);
// lookAt.y = camera.position.y + Math.sin(pitch);
// lookAt.z = camera.position.z + Math.cos(yaw) * Math.cos(pitch);

const camPos = CONFIG.camera.position;
const yaw = DEFAULT_CAMERA_ANGLES.yaw;
const pitch = DEFAULT_CAMERA_ANGLES.pitch;

const computedLookAt = {
  x: camPos.x + Math.sin(yaw) * Math.cos(pitch),
  y: camPos.y + Math.sin(pitch),
  z: camPos.z + Math.cos(yaw) * Math.cos(pitch)
};

console.log('Verification - computed lookAt direction:');
console.log('  x:', computedLookAt.x.toFixed(6));
console.log('  y:', computedLookAt.y.toFixed(6));
console.log('  z:', computedLookAt.z.toFixed(6));
console.log('');

// The direction should point from camera toward the desk
const dir = {
  x: computedLookAt.x - camPos.x,
  y: computedLookAt.y - camPos.y,
  z: computedLookAt.z - camPos.z
};
console.log('Look direction vector (unit):');
console.log('  x:', dir.x.toFixed(6));
console.log('  y:', dir.y.toFixed(6), '(negative = looking down)');
console.log('  z:', dir.z.toFixed(6), '(negative = looking toward desk)');
console.log('');

// Expected direction (normalized)
const expDir = {
  x: CONFIG.camera.lookAt.x - camPos.x,
  y: CONFIG.camera.lookAt.y - camPos.y,
  z: CONFIG.camera.lookAt.z - camPos.z
};
const expLen = Math.sqrt(expDir.x**2 + expDir.y**2 + expDir.z**2);
const expNorm = {
  x: expDir.x / expLen,
  y: expDir.y / expLen,
  z: expDir.z / expLen
};
console.log('Expected direction vector (normalized):');
console.log('  x:', expNorm.x.toFixed(6));
console.log('  y:', expNorm.y.toFixed(6));
console.log('  z:', expNorm.z.toFixed(6));
console.log('');

// Check if they match
const tolerance = 0.001;
const match = Math.abs(dir.x - expNorm.x) < tolerance &&
              Math.abs(dir.y - expNorm.y) < tolerance &&
              Math.abs(dir.z - expNorm.z) < tolerance;

console.log('✓ Direction matches:', match ? 'YES' : 'NO');
console.log('');

// Check specific expectations
console.log('Expected behaviors:');
console.log('  - Camera looks down at desk (y < 0):', dir.y < 0 ? '✓ YES' : '✗ NO');
console.log('  - Camera faces negative z (toward desk):', dir.z < 0 ? '✓ YES' : '✗ NO');
console.log('  - Camera centered on x-axis:', Math.abs(dir.x) < 0.01 ? '✓ YES' : '✗ NO');
