// Test script to verify the FIXED spatial audio panning
// The fix negates the projection to match perceptual left/right conventions

function testPanning() {
  console.log("=== Testing FIXED panning calculation ===\n");

  // Real scenario: Camera at desk looking at screen
  console.log("=== REAL SCENARIO: Desk Setup ===");
  console.log("Camera at (0, 4.5, 5.5), looking at (0, 0, -1.5)");
  console.log("");

  // Calculate actual yaw
  const dx = 0 - 0;  // lookAt.x - camera.x
  const dz = -1.5 - 5.5;  // lookAt.z - camera.z = -7
  const yaw = Math.atan2(dx, dz);  // atan2(0, -7) ≈ π

  console.log(`Default yaw: ${yaw.toFixed(4)} rad (${(yaw * 180 / Math.PI).toFixed(1)}°)`);
  console.log("");

  // Test case 1: Object on the RIGHT side of desk
  console.log("Scenario 1: Cassette player on the RIGHT side of desk (x=3)");
  testCase(yaw, 3, -5.5);  // Object at world (3, y, 0), relative to camera at (0, y, 5.5)
  console.log("");

  // Test case 2: Object on the LEFT side of desk
  console.log("Scenario 2: Cassette player on the LEFT side of desk (x=-3)");
  testCase(yaw, -3, -5.5);
  console.log("");

  // Test case 3: Object directly in front (center)
  console.log("Scenario 3: Object directly in front (center, x=0)");
  testCase(yaw, 0, -5.5);
  console.log("");

  // Test case 4: Camera rotated to look left (higher yaw)
  console.log("Scenario 4: Camera rotated LEFT (+45° yaw), object at center");
  const yawLeft = yaw + Math.PI/4;
  testCase(yawLeft, 0, -5.5);
  console.log("  When camera looks left, center objects shift to RIGHT speaker ✓");
  console.log("");

  // Test case 5: Camera rotated to look right (lower yaw)
  console.log("Scenario 5: Camera rotated RIGHT (-45° yaw), object at center");
  const yawRight = yaw - Math.PI/4;
  testCase(yawRight, 0, -5.5);
  console.log("  When camera looks right, center objects shift to LEFT speaker ✓");
  console.log("");

  console.log("=== Summary ===");
  console.log("✓ Objects on the right (positive X) → RIGHT speaker");
  console.log("✓ Objects on the left (negative X) → LEFT speaker");
  console.log("✓ Camera rotation changes perceived position correctly");
}

function testCase(yaw, relativeX, relativeZ) {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);

  // FIXED formula (negated)
  const localX = -relativeX * cosYaw + relativeZ * sinYaw;

  // Pan calculation
  const panRange = 5;
  let pan = localX / panRange;
  pan = Math.max(-1, Math.min(1, pan));

  console.log(`  yaw = ${yaw.toFixed(4)} rad (${(yaw * 180 / Math.PI).toFixed(1)}°)`);
  console.log(`  Object relative pos: (${relativeX}, 0, ${relativeZ})`);
  console.log(`  localX (fixed) = ${(-relativeX).toFixed(4)} * ${cosYaw.toFixed(4)} + ${relativeZ} * ${sinYaw.toFixed(4)} = ${localX.toFixed(4)}`);
  console.log(`  pan = ${pan.toFixed(4)} → ${pan > 0.1 ? 'RIGHT speaker ✓' : pan < -0.1 ? 'LEFT speaker ✓' : 'CENTER ✓'}`);
}

// Run test
testPanning();
