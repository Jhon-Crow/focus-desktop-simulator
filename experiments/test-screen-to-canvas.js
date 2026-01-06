#!/usr/bin/env node

/**
 * Test screen-space mouse movement to canvas drawing
 *
 * This simulates what happens when a user moves their mouse "down" on the screen
 * and checks if the line drawn on the canvas also goes "down" (Y increases).
 */

// Simulate the coordinate transformation
function worldToDrawingCoords(worldPos, paper) {
  const objPos = paper.position;
  const localX = worldPos.x - objPos.x;
  const localZ = worldPos.z - objPos.z;

  const rotation = paper.rotation.y;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const rotatedX = localX * cos - localZ * sin;
  const rotatedZ = localX * sin + localZ * cos;

  const baseWidth = 0.28;
  const baseDepth = 0.4;
  const width = baseWidth;
  const depth = baseDepth;

  const normalizedX = (rotatedX / width) + 0.5;
  const normalizedY = (rotatedZ / depth) + 0.5;

  const canvasSize = 512;
  return {
    x: Math.floor(normalizedX * canvasSize),
    y: Math.floor(normalizedY * canvasSize)
  };
}

console.log("=== Test: Screen Movement to Canvas Drawing ===\n");

console.log("Setup:");
console.log("  - User is looking at the desk from above");
console.log("  - Camera looks down the -Z axis (standard Three.js setup)");
console.log("  - When user moves mouse DOWN on screen, ray moves in +Z world direction");
console.log("  - When user moves mouse RIGHT on screen, ray moves in +X world direction\n");

console.log("=".repeat(60) + "\n");

// Test 1: Paper at 0° rotation
console.log("Test 1: Paper at 0° rotation\n");

const paper0 = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { y: 0 }
};

console.log("User draws a vertical line DOWNWARD on screen:");
console.log("  Mouse moves from screen top to screen bottom");
console.log("  This translates to world Z going from negative to positive\n");

const screenTop0 = { x: 0, y: 0, z: -0.1 };  // Top of screen = -Z
const screenBottom0 = { x: 0, y: 0, z: 0.1 }; // Bottom of screen = +Z

const canvasTop0 = worldToDrawingCoords(screenTop0, paper0);
const canvasBottom0 = worldToDrawingCoords(screenBottom0, paper0);

console.log(`  Screen top (world 0, -0.1) → Canvas (${canvasTop0.x}, ${canvasTop0.y})`);
console.log(`  Screen bottom (world 0, 0.1) → Canvas (${canvasBottom0.x}, ${canvasBottom0.y})`);
console.log(`  Canvas Y delta: ${canvasBottom0.y - canvasTop0.y}\n`);

if (canvasBottom0.y > canvasTop0.y) {
  console.log("  ✅ CORRECT: User moves mouse DOWN, line goes DOWN on canvas (Y increases)\n");
} else {
  console.log("  ❌ INVERTED: User moves mouse DOWN, line goes UP on canvas (Y decreases)\n");
}

console.log("=".repeat(60) + "\n");

// Test 2: Paper rotated 90° clockwise (Y rotation = π/2)
console.log("Test 2: Paper rotated 90° clockwise\n");

const paper90 = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { y: Math.PI / 2 }
};

console.log("Paper is now rotated 90° clockwise (viewed from above).");
console.log("What was the paper's 'top' now points to the right (+X direction).");
console.log("What was the paper's 'right' now points toward camera (-Z direction).\n");

console.log("User STILL draws a vertical line DOWNWARD on screen:");
console.log("  Mouse moves from screen top to screen bottom");
console.log("  This STILL translates to world Z going from negative to positive\n");

const screenTop90 = { x: 0, y: 0, z: -0.1 };  // Top of screen = -Z
const screenBottom90 = { x: 0, y: 0, z: 0.1 }; // Bottom of screen = +Z

const canvasTop90 = worldToDrawingCoords(screenTop90, paper90);
const canvasBottom90 = worldToDrawingCoords(screenBottom90, paper90);

console.log(`  Screen top (world 0, -0.1) → Canvas (${canvasTop90.x}, ${canvasTop90.y})`);
console.log(`  Screen bottom (world 0, 0.1) → Canvas (${canvasBottom90.x}, ${canvasBottom90.y})`);
console.log(`  Canvas Y delta: ${canvasBottom90.y - canvasTop90.y}\n`);

if (canvasBottom90.y > canvasTop90.y) {
  console.log("  ✅ CORRECT: User moves mouse DOWN, line goes DOWN on canvas (Y increases)");
} else if (canvasBottom90.y < canvasTop90.y) {
  console.log("  ❌ INVERTED: User moves mouse DOWN, line goes UP on canvas (Y decreases)");
  console.log("  🔴 THIS IS THE BUG!");
} else {
  console.log("  ⚠️  HORIZONTAL: No Y movement (line goes sideways)");
}

console.log("\n" + "=".repeat(60) + "\n");

// Test 3: Understanding the visual result
console.log("Test 3: What does the user SEE?\n");

console.log("At 90° rotation:");
console.log("  - User sees the paper rotated 90° on screen");
console.log("  - User moves mouse DOWN on screen");
console.log("  - In 3D world, this is moving in +Z direction");
console.log("  - But paper's local Y axis (canvas Y) now points in +X direction!");
console.log("  - So moving in +Z doesn't change the paper's local Y\n");

console.log("The question is:");
console.log("  Should the line follow the SCREEN direction (down)?");
console.log("  Or should it follow the PAPER's VISUAL orientation?\n");

console.log("Expected behavior:");
console.log("  - User draws 'down' on screen");
console.log("  - Line should go 'down' relative to CURRENT paper orientation");
console.log("  - At 90° rotation, 'down on screen' corresponds to 'right on paper'");
console.log("  - Canvas X should change, not canvas Y!\n");

const canvasXDelta = canvasBottom90.x - canvasTop90.x;
console.log(`Checking Canvas X delta: ${canvasXDelta}`);

if (Math.abs(canvasXDelta) > Math.abs(canvasBottom90.y - canvasTop90.y)) {
  console.log("  ✅ Line mostly moves horizontally on canvas (X changes more than Y)");
  console.log("  This is CORRECT for 90° rotation!");
} else {
  console.log("  ❌ Line moves vertically on canvas more than horizontally");
}

console.log("\n" + "=".repeat(60) + "\n");

console.log("DIAGNOSIS:\n");
console.log("The current implementation is geometrically correct:");
console.log("  - It properly transforms world coordinates to paper-local coordinates");
console.log("  - Drawing happens at the correct position on the paper\n");

console.log("However, the OWNER's complaint might be about:");
console.log("  - The visual perception of the line direction");
console.log("  - When paper is rotated, the user expects the line to follow");
console.log("    the screen direction, not the paper's local coordinate system\n");

console.log("Possible issue:");
console.log("  - Z-axis inversion in Three.js coordinate system");
console.log("  - Canvas Y-axis direction might be inverted");
console.log("  - Need to check if canvas Y should increase downward or upward");
