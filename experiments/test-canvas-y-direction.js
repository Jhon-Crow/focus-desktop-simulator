#!/usr/bin/env node

/**
 * Test canvas Y-axis direction
 *
 * HTML5 Canvas: Y=0 at top, Y increases downward
 * Three.js textures: Typically Y=0 at bottom for UV coordinates
 *
 * The question: When we map world Z to canvas Y, should we invert it?
 */

function worldToDrawingCoords_Current(worldPos, paper) {
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
  const normalizedY = (rotatedZ / depth) + 0.5;  // Current implementation

  const canvasSize = 512;
  return {
    x: Math.floor(normalizedX * canvasSize),
    y: Math.floor(normalizedY * canvasSize)
  };
}

function worldToDrawingCoords_Inverted(worldPos, paper) {
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
  const normalizedY = 1.0 - ((rotatedZ / depth) + 0.5);  // INVERTED!

  const canvasSize = 512;
  return {
    x: Math.floor(normalizedX * canvasSize),
    y: Math.floor(normalizedY * canvasSize)
  };
}

console.log("=== Test: Canvas Y-Axis Direction ===\n");

console.log("Hypothesis: The canvas Y-axis might need to be inverted");
console.log("because of the difference between:");
console.log("  - Three.js world coordinates (Y up)");
console.log("  - Canvas 2D coordinates (Y down)\n");

console.log("=".repeat(60) + "\n");

const paper90 = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { y: Math.PI / 2 }
};

console.log("Scenario: Paper rotated 90°\n");
console.log("User wants to draw a vertical line on the paper");
console.log("(from top of paper to bottom of paper, as they see it)\n");

// At 90° rotation, the paper's local coordinate system is:
// - Paper's local +X (was originally pointing right) now points backward (toward camera, -Z in world)
// - Paper's local +Z (was originally pointing away) now points right (+X in world)

// If user draws from "top of paper" to "bottom of paper" in paper-local space:
// Paper-local top: (0, -depth/2) -> after rotation in world: approximately (depth/2, 0)
// Paper-local bottom: (0, +depth/2) -> after rotation in world: approximately (-depth/2, 0)

// Let's use actual transformed coordinates
const paperLocalTop = { x: 0.2, y: 0, z: 0 };     // Paper-local top after 90° rotation
const paperLocalBottom = { x: -0.2, y: 0, z: 0 };  // Paper-local bottom after 90° rotation

console.log("Drawing from paper-local top to bottom:");
console.log(`  Top (world): (${paperLocalTop.x}, ${paperLocalTop.z})`);
console.log(`  Bottom (world): (${paperLocalBottom.x}, ${paperLocalBottom.z})\n`);

const currentTop = worldToDrawingCoords_Current(paperLocalTop, paper90);
const currentBottom = worldToDrawingCoords_Current(paperLocalBottom, paper90);

console.log("Current implementation (no inversion):");
console.log(`  Top → Canvas (${currentTop.x}, ${currentTop.y})`);
console.log(`  Bottom → Canvas (${currentBottom.x}, ${currentBottom.y})`);
console.log(`  Canvas Y delta: ${currentBottom.y - currentTop.y}`);

if (currentBottom.y > currentTop.y) {
  console.log("  Result: Line goes DOWN on canvas (Y increases) ✅\n");
} else if (currentBottom.y < currentTop.y) {
  console.log("  Result: Line goes UP on canvas (Y decreases) ❌ INVERTED!\n");
} else {
  console.log("  Result: Line is horizontal (no Y change)\n");
}

const invertedTop = worldToDrawingCoords_Inverted(paperLocalTop, paper90);
const invertedBottom = worldToDrawingCoords_Inverted(paperLocalBottom, paper90);

console.log("With Y-axis inversion:");
console.log(`  Top → Canvas (${invertedTop.x}, ${invertedTop.y})`);
console.log(`  Bottom → Canvas (${invertedBottom.x}, ${invertedBottom.y})`);
console.log(`  Canvas Y delta: ${invertedBottom.y - invertedTop.y}`);

if (invertedBottom.y > invertedTop.y) {
  console.log("  Result: Line goes DOWN on canvas (Y increases) ✅\n");
} else if (invertedBottom.y < invertedTop.y) {
  console.log("  Result: Line goes UP on canvas (Y decreases) ❌ INVERTED!\n");
} else {
  console.log("  Result: Line is horizontal (no Y change)\n");
}

console.log("=".repeat(60) + "\n");

// Actually, I think the real issue is that we need to understand what "top" and "bottom" mean
// Let me test with the paper at 0° first to establish the baseline

console.log("Test at 0° rotation (baseline):\n");

const paper0 = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { y: 0 }
};

const top0 = { x: 0, y: 0, z: -0.15 };    // Top of paper (closer to camera)
const bottom0 = { x: 0, y: 0, z: 0.15 };  // Bottom of paper (away from camera)

const canvas0Top = worldToDrawingCoords_Current(top0, paper0);
const canvas0Bottom = worldToDrawingCoords_Current(bottom0, paper0);

console.log("Paper at 0°, drawing from visual top to visual bottom:");
console.log(`  Visual top (world Z=-0.15) → Canvas (${canvas0Top.x}, ${canvas0Top.y})`);
console.log(`  Visual bottom (world Z=+0.15) → Canvas (${canvas0Bottom.x}, ${canvas0Bottom.y})`);
console.log(`  Canvas Y delta: ${canvas0Bottom.y - canvas0Top.y}\n`);

if (canvas0Bottom.y > canvas0Top.y) {
  console.log("  ✅ At 0°: Visual bottom has HIGHER canvas Y (correct for canvas Y-down system)");
  console.log("  This means: Canvas Y increases as we go 'down' the paper\n");
} else {
  console.log("  ❌ At 0°: Visual bottom has LOWER canvas Y (inverted!)");
  console.log("  This would mean canvas Y=0 is at bottom, not top\n");
}

console.log("=".repeat(60) + "\n");

console.log("Conclusion:");
console.log("  If the owner reports inversion at 90°, we need to trace");
console.log("  exactly what they mean by 'top to bottom' and check if");
console.log("  the Z-axis direction or canvas Y mapping is the issue.");
