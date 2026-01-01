// Test script to verify the spatial audio panning math
// This simulates different camera orientations and object positions

function testPanning() {
  // Test case 1: Camera at origin looking down +Z axis (yaw = 0)
  // Object on the right side (positive X in world space)
  console.log("=== Test Case 1: Camera yaw=0, Object on right (x=5, z=0) ===");
  testCase(0, 5, 0);

  // Expected: Sound should be on the RIGHT (positive pan)
  // localX = 5 * cos(0) - 0 * sin(0) = 5 * 1 - 0 = 5 -> pan = 1 (right) ✓

  // Test case 2: Camera at origin looking down +Z axis (yaw = 0)
  // Object on the left side (negative X in world space)
  console.log("\n=== Test Case 2: Camera yaw=0, Object on left (x=-5, z=0) ===");
  testCase(0, -5, 0);

  // Expected: Sound should be on the LEFT (negative pan)
  // localX = -5 * cos(0) - 0 * sin(0) = -5 -> pan = -1 (left) ✓

  // Test case 3: Camera looking +X direction (yaw = PI/2)
  // Object at positive Z (now on camera's LEFT)
  console.log("\n=== Test Case 3: Camera yaw=π/2, Object at (0, 0, 5) ===");
  testCase(Math.PI/2, 0, 5);

  // When camera looks +X (yaw = π/2):
  // Camera forward: (sin(π/2), 0, cos(π/2)) = (1, 0, 0)
  // Camera right: (cos(π/2), 0, -sin(π/2)) = (0, 0, -1)
  // Object at z=5 relative to camera
  // localX = 0 * 0 - 5 * 1 = -5 -> pan = -1 (left)
  // But wait - if camera looks +X and object is at +Z, that's on the camera's LEFT
  // So pan should be negative (left) ✓

  // Test case 4: Camera looking -X direction (yaw = -PI/2)
  // Object at positive Z (now on camera's RIGHT)
  console.log("\n=== Test Case 4: Camera yaw=-π/2, Object at (0, 0, 5) ===");
  testCase(-Math.PI/2, 0, 5);

  // When camera looks -X (yaw = -π/2):
  // Camera forward: (sin(-π/2), 0, cos(-π/2)) = (-1, 0, 0)
  // Camera right: (cos(-π/2), 0, -sin(-π/2)) = (0, 0, 1)
  // Object at z=5 relative to camera
  // localX = 0 * 0 - 5 * (-1) = 5 -> pan = 1 (right)
  // If camera looks -X and object is at +Z, that's on the camera's RIGHT
  // So pan should be positive (right) ✓

  // Test case 5: Camera looking +X (yaw = PI/2)
  // Object in front of camera at x=5
  console.log("\n=== Test Case 5: Camera yaw=π/2, Object in front at (5, 0, 0) ===");
  testCase(Math.PI/2, 5, 0);

  // When camera looks +X (yaw = π/2):
  // Camera right: (0, 0, -1)
  // Object at x=5 relative to camera (directly in front)
  // localX = 5 * 0 - 0 * 1 = 0 -> pan = 0 (center)
  // Object directly in front should be centered ✓

  console.log("\n=== Analysis ===");
  console.log("The current formula seems mathematically correct.");
  console.log("Let me check the coordinate system conventions...");

  // Check default yaw value
  console.log("\n=== Default Camera State ===");
  // From the code: DEFAULT_CAMERA_ANGLES.yaw is calculated from looking at the desk
  // Camera forward in world space goes from camera to lookAt point

  // Let's verify with actual game coordinates:
  // Camera position: (0, 3.5, 5.5)
  // LookAt point: (0, 1.5, 0)
  // Direction: (0-0, 1.5-3.5, 0-5.5) = (0, -2, -5.5)
  // Normalized horizontal: (0, 0, -5.5) -> looking down -Z axis
  // yaw for -Z direction: yaw where sin(yaw)=0, cos(yaw)=-1 doesn't exist
  // Actually: forward = (sin(yaw), 0, cos(yaw))
  // For forward = (0, 0, -1): sin(yaw)=0, cos(yaw)=-1 -> yaw = π

  // But wait, that's not how THREE.js usually works...
  // Let me check the actual updateCameraLook logic more carefully

  console.log("When looking down -Z axis (at the desk from front):");
  console.log("Forward should be (0, 0, -1)");
  console.log("For forward = (sin(yaw), 0, cos(yaw)) = (0, 0, -1):");
  console.log("  sin(yaw) = 0, cos(yaw) = -1 -> yaw = π (or -π)");
  console.log("");
  console.log("At yaw = π:");
  console.log("  Camera right = (cos(π), 0, -sin(π)) = (-1, 0, 0)");
  console.log("");
  console.log("So if an object is at world x=5 (to the world's right):");
  console.log("  But camera's right is (-1, 0, 0)");
  console.log("  localX = 5 * (-1) - 0 * 0 = -5 -> left speaker");
  console.log("  This means world-right appears as camera-left when facing -Z");
  console.log("  BUT when the camera faces -Z, world-right IS camera-left!");
  console.log("");
  console.log("Wait, that's WRONG. If I'm facing -Z and an object is at positive X,");
  console.log("that object is on MY RIGHT, not my left!");
  console.log("");
  console.log("The issue is: Camera right at yaw=π is (-1, 0, 0)");
  console.log("But intuitively, when facing -Z, right should be NEGATIVE X direction");
  console.log("Wait no... when facing -Z, right IS -X in world space");
  console.log("");
  console.log("Let me think again:");
  console.log("- I'm standing, facing -Z direction (into the screen)");
  console.log("- My right hand points to my right");
  console.log("- In world coordinates, that's the NEGATIVE X direction");
  console.log("- So camera_right = (-1, 0, 0) at yaw=π is correct!");
  console.log("");
  console.log("Now if object is at world position x=5:");
  console.log("  relativeX = 5 (object is to the right in world coords)");
  console.log("  localX = 5 * cos(π) - 0 * sin(π) = 5 * (-1) = -5");
  console.log("  This gives negative pan -> LEFT speaker");
  console.log("");
  console.log("But if I'm facing -Z (into screen), an object at world x=5");
  console.log("is on my LEFT (to the left of the screen), not my right!");
  console.log("");
  console.log("AH! That's the confusion. In 3D graphics:");
  console.log("  - +X is typically RIGHT when looking down +Z");
  console.log("  - So +X is LEFT when looking down -Z");
  console.log("");
  console.log("The current math IS CORRECT! Let me verify once more...");
}

function testCase(yaw, relativeX, relativeZ) {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);

  // Current formula
  const localX = relativeX * cosYaw - relativeZ * sinYaw;

  // Pan calculation
  const panRange = 5;
  let pan = localX / panRange;
  pan = Math.max(-1, Math.min(1, pan));

  console.log(`  yaw = ${yaw.toFixed(4)} rad (${(yaw * 180 / Math.PI).toFixed(1)}°)`);
  console.log(`  cos(yaw) = ${cosYaw.toFixed(4)}, sin(yaw) = ${sinYaw.toFixed(4)}`);
  console.log(`  Camera forward: (${sinYaw.toFixed(4)}, 0, ${cosYaw.toFixed(4)})`);
  console.log(`  Camera right:   (${cosYaw.toFixed(4)}, 0, ${(-sinYaw).toFixed(4)})`);
  console.log(`  Object relative pos: (${relativeX}, 0, ${relativeZ})`);
  console.log(`  localX = ${relativeX} * ${cosYaw.toFixed(4)} - ${relativeZ} * ${sinYaw.toFixed(4)} = ${localX.toFixed(4)}`);
  console.log(`  pan = ${pan.toFixed(4)} (${pan > 0 ? 'RIGHT' : pan < 0 ? 'LEFT' : 'CENTER'})`);
}

// Run test
testPanning();

// Additional real-world scenario
console.log("\n\n=== REAL SCENARIO: Desk Setup ===");
console.log("Camera at (0, 3.5, 5.5), looking at desk center (0, 1.5, 0)");
console.log("");

// Calculate actual yaw from camera setup
const camX = 0, camZ = 5.5;
const lookX = 0, lookZ = 0;
const dx = lookX - camX;  // 0
const dz = lookZ - camZ;  // -5.5

// From updateCameraLook: forward = (sin(yaw), pitch_comp, cos(yaw))
// We need: sin(yaw) = dx/||d||, cos(yaw) = dz/||d||
// ||d_horizontal|| = sqrt(dx² + dz²) = 5.5
const len = Math.sqrt(dx*dx + dz*dz);
const forwardX = dx / len;  // 0
const forwardZ = dz / len;  // -1

console.log(`Forward direction (normalized): (${forwardX}, 0, ${forwardZ})`);
console.log("This means forward = (0, 0, -1)");
console.log("");

// Find yaw where sin(yaw) = 0, cos(yaw) = -1
// That's yaw = π
const expectedYaw = Math.PI;
console.log(`Expected yaw: π ≈ ${expectedYaw.toFixed(4)} rad`);
console.log("");

// Now test: cassette player on the right side of desk
console.log("Scenario: Cassette player on the RIGHT side of the desk");
console.log("  Cassette position: (3, 1.5, 0)");
console.log("  Camera position: (0, 3.5, 5.5)");
console.log("  Relative position: (3, -2, -5.5)");
console.log("");

const cassetteRelX = 3;
const cassetteRelZ = -5.5;

testCase(expectedYaw, cassetteRelX, cassetteRelZ);

console.log("");
console.log("INTERPRETATION:");
console.log("  If the camera is at z=5.5 looking at z=0 (facing -Z direction)");
console.log("  And a cassette player is at x=3 (to the right of center in world space)");
console.log("  Then from the camera's perspective, it should be on the RIGHT side");
console.log("");
console.log("  With yaw=π, the calculation gives:");
const yaw = Math.PI;
const testLocalX = cassetteRelX * Math.cos(yaw) - cassetteRelZ * Math.sin(yaw);
console.log(`  localX = ${cassetteRelX} * ${Math.cos(yaw).toFixed(4)} - ${cassetteRelZ} * ${Math.sin(yaw).toFixed(4)}`);
console.log(`  localX = ${(cassetteRelX * Math.cos(yaw)).toFixed(4)} - ${(cassetteRelZ * Math.sin(yaw)).toFixed(4)}`);
console.log(`  localX = ${testLocalX.toFixed(4)}`);
console.log("");

if (testLocalX > 0) {
  console.log("  RESULT: Positive pan -> RIGHT speaker ✓ (CORRECT)");
} else if (testLocalX < 0) {
  console.log("  RESULT: Negative pan -> LEFT speaker ✗ (INVERTED!)");
  console.log("");
  console.log("  THE PANNING IS INVERTED!");
  console.log("  Fix: Negate the localX or the final pan value");
} else {
  console.log("  RESULT: Zero pan -> CENTER");
}
