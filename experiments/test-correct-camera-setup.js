#!/usr/bin/env node

/**
 * Test with CORRECT camera setup
 *
 * Camera is at (0, 4.5, 5.5) looking at (0, 0, -1.5)
 * This means camera is in front of (positive Z) the desk
 * Looking toward negative Z
 *
 * Therefore:
 * - Mouse DOWN on screen = ray goes toward -Z (away from camera)
 * - Mouse UP on screen = ray goes toward +Z (toward camera)
 */

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

console.log("=== Test with Correct Camera Setup ===\n");

console.log("Camera setup:");
console.log("  Position: (0, 4.5, 5.5)");
console.log("  Looking at: (0, 0, -1.5)");
console.log("  Therefore: Camera is at positive Z, looking toward negative Z\n");

console.log("Screen-to-world mapping:");
console.log("  - Mouse DOWN on screen → Ray moves toward -Z (away from camera)");
console.log("  - Mouse UP on screen → Ray moves toward +Z (toward camera)");
console.log("  - Mouse RIGHT on screen → Ray moves toward +X");
console.log("  - Mouse LEFT on screen → Ray moves toward -X\n");

console.log("=".repeat(60) + "\n");

// Test 1: Paper at 0° rotation
console.log("Test 1: Paper at 0° rotation\n");

const paper0 = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { y: 0 }
};

console.log("User draws vertically DOWN on screen:");
console.log("  Mouse moves from top to bottom of screen");
console.log("  Ray moves from Z=+0.1 to Z=-0.1 (toward -Z, away from camera)\n");

const screenTop0 = { x: 0, y: 0, z: 0.1 };    // Top of screen = +Z (toward camera)
const screenBottom0 = { x: 0, y: 0, z: -0.1 }; // Bottom of screen = -Z (away)

const canvasTop0 = worldToDrawingCoords(screenTop0, paper0);
const canvasBottom0 = worldToDrawingCoords(screenBottom0, paper0);

console.log(`  Screen top (world Z=+0.1) → Canvas (${canvasTop0.x}, ${canvasTop0.y})`);
console.log(`  Screen bottom (world Z=-0.1) → Canvas (${canvasBottom0.x}, ${canvasBottom0.y})`);
console.log(`  Canvas Y delta: ${canvasBottom0.y - canvasTop0.y}\n`);

if (canvasBottom0.y > canvasTop0.y) {
  console.log("  ✅ CORRECT: Mouse moves DOWN, canvas Y increases (line goes down)\n");
} else if (canvasBottom0.y < canvasTop0.y) {
  console.log("  ❌ INVERTED: Mouse moves DOWN, canvas Y decreases (line goes up)\n");
} else {
  console.log("  ⚠️  Horizontal line\n");
}

console.log("=".repeat(60) + "\n");

// Test 2: Paper rotated 90° clockwise
console.log("Test 2: Paper rotated 90° clockwise (Y rotation = π/2)\n");

const paper90 = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { y: Math.PI / 2 }
};

console.log("Paper rotated 90° clockwise (viewed from above)");
console.log("User STILL draws vertically DOWN on screen:");
console.log("  Mouse moves from top to bottom of screen");
console.log("  Ray STILL moves from Z=+0.1 to Z=-0.1\n");

const screenTop90 = { x: 0, y: 0, z: 0.1 };
const screenBottom90 = { x: 0, y: 0, z: -0.1 };

const canvasTop90 = worldToDrawingCoords(screenTop90, paper90);
const canvasBottom90 = worldToDrawingCoords(screenBottom90, paper90);

console.log(`  Screen top (world Z=+0.1) → Canvas (${canvasTop90.x}, ${canvasTop90.y})`);
console.log(`  Screen bottom (world Z=-0.1) → Canvas (${canvasBottom90.x}, ${canvasBottom90.y})`);
console.log(`  Canvas Y delta: ${canvasBottom90.y - canvasTop90.y}`);
console.log(`  Canvas X delta: ${canvasBottom90.x - canvasTop90.x}\n`);

if (Math.abs(canvasBottom90.y - canvasTop90.y) > Math.abs(canvasBottom90.x - canvasTop90.x)) {
  // Y changed more than X
  if (canvasBottom90.y > canvasTop90.y) {
    console.log("  Line goes DOWN on canvas (Y increases)");
  } else {
    console.log("  ❌ INVERTED! Line goes UP on canvas (Y decreases)");
  }
} else {
  // X changed more
  console.log("  Line goes mostly horizontally (X changes more than Y)");
  console.log("  This is expected for 90° rotation");
}

console.log("\n" + "=".repeat(60) + "\n");

// Test 3: What if user draws on paper (not screen-aligned)?
console.log("Test 3: User draws on the ROTATED PAPER (paper-aligned drawing)\n");

console.log("After 90° rotation, the paper's orientation:");
console.log("  - Paper's 'top edge' now points to the right (+X in world)");
console.log("  - Paper's 'right edge' now points away from camera (-Z in world)\n");

console.log("If user draws from paper's visual top to visual bottom:");
console.log("  (Following the paper's orientation, not screen)\n");

// Paper-local coordinates at 90° rotation:
// Local (0, 0) -> World (0, 0) [center]
// Local (X=0, Z=-0.2) -> World (X=0.2, Z=0) [visual top of paper]
// Local (X=0, Z=+0.2) -> World (X=-0.2, Z=0) [visual bottom of paper]

const paperTop = { x: 0.2, y: 0, z: 0 };
const paperBottom = { x: -0.2, y: 0, z: 0 };

const canvasPaperTop = worldToDrawingCoords(paperTop, paper90);
const canvasPaperBottom = worldToDrawingCoords(paperBottom, paper90);

console.log(`  Paper visual top (world X=0.2, Z=0) → Canvas (${canvasPaperTop.x}, ${canvasPaperTop.y})`);
console.log(`  Paper visual bottom (world X=-0.2, Z=0) → Canvas (${canvasPaperBottom.x}, ${canvasPaperBottom.y})`);
console.log(`  Canvas Y delta: ${canvasPaperBottom.y - canvasPaperTop.y}\n`);

if (canvasPaperBottom.y > canvasPaperTop.y) {
  console.log("  ✅ CORRECT: Paper bottom has higher canvas Y (line goes down on canvas)");
} else if (canvasPaperBottom.y < canvasPaperTop.y) {
  console.log("  ❌ INVERTED! Paper bottom has lower canvas Y (line goes up on canvas)");
  console.log("  🔴 THIS IS THE BUG THE OWNER IS REPORTING!");
} else {
  console.log("  ⚠️  Horizontal line (no Y change)");
}

console.log("\n" + "=".repeat(60) + "\n");

console.log("CONCLUSION:");
console.log("If the owner is drawing aligned with the rotated paper");
console.log("(not screen-aligned), we need to check if there's an inversion");
console.log("in how paper-local coordinates map to canvas coordinates.");
