#!/usr/bin/env node

/**
 * Test to understand the actual drawing behavior
 *
 * Key insight: The user is NOT moving in world-space coordinates.
 * The user is drawing on the paper surface as they see it.
 *
 * When paper is rotated 90°:
 * - User sees the paper rotated
 * - User draws on what they SEE as "top to bottom"
 * - This corresponds to drawing along the paper's LOCAL Y axis
 * - The pen's 3D position follows the paper's surface
 */

// Current implementation (from renderer.js)
function worldToDrawingCoords_Current(worldPos, drawableObject) {
  if (!drawableObject) return null;

  const objPos = drawableObject.position;
  const localX = worldPos.x - objPos.x;
  const localZ = worldPos.z - objPos.z;

  // Transform world coordinates to paper-local coordinates
  const rotation = drawableObject.rotation.y;
  const cos = Math.cos(-rotation); // Negative for inverse rotation
  const sin = Math.sin(-rotation);
  const rotatedX = localX * cos - localZ * sin;
  const rotatedZ = localX * sin + localZ * cos;

  const baseWidth = 0.28;
  const baseDepth = 0.4;
  const scale = 1.0;
  const width = baseWidth * scale;
  const depth = baseDepth * scale;

  const normalizedX = (rotatedX / width) + 0.5;
  const normalizedY = (rotatedZ / depth) + 0.5;

  const canvasSize = 512;
  return {
    x: Math.floor(normalizedX * canvasSize),
    y: Math.floor(normalizedY * canvasSize)
  };
}

console.log("=== Understanding Visual Drawing Behavior ===\n");

// Scenario: User rotates paper 90° clockwise
const paper = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { y: Math.PI / 2 }, // 90 degrees clockwise
  scale: 1.0
};

console.log("Paper rotated 90° clockwise (Y rotation = π/2)\n");

console.log("Coordinate system understanding:");
console.log("  - World space: Fixed coordinate system");
console.log("  - Paper-local space: Rotates with paper");
console.log("  - Canvas space: 2D texture on paper\n");

console.log("At 0° rotation:");
console.log("  - Paper's local +X points to world +X (right)");
console.log("  - Paper's local +Z points to world +Z (away from camera)");
console.log("  - Canvas X maps to paper local X");
console.log("  - Canvas Y maps to paper local Z\n");

console.log("At 90° rotation:");
console.log("  - Paper's local +X points to world -Z (toward camera)");
console.log("  - Paper's local +Z points to world +X (right)");
console.log("  - Canvas X should still map to paper local X");
console.log("  - Canvas Y should still map to paper local Z\n");

console.log("=".repeat(60) + "\n");

// Test: Drawing on the paper from the user's perspective
console.log("Test: User draws a line 'downward' on the rotated paper\n");

// At 90° rotation, if the user draws downward on the paper (what they see),
// they're moving along the paper's local Z axis.
// In world space, the paper's local Z axis now points in the +X direction.

// So "top of paper" in paper-local space (Z = -0.1 in local)
// translates to world coordinates differently at 90°

// Let's think in paper-local coordinates first
console.log("Paper-local coordinates (what the user sees on paper):");
console.log("  Top of paper: local (0, 0) -> should be canvas (256, ~100)");
console.log("  Bottom of paper: local (0, depth) -> should be canvas (256, ~400)\n");

// Now convert paper-local to world coordinates at 90° rotation
// Paper-local X,Z to World X,Z with rotation matrix:
// worldX = localX * cos(90°) - localZ * sin(90°) = localX * 0 - localZ * 1 = -localZ
// worldZ = localX * sin(90°) + localZ * cos(90°) = localX * 1 + localZ * 0 = localX

function paperLocalToWorld(localX, localZ, rotation) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: localX * cos - localZ * sin,
    z: localX * sin + localZ * cos
  };
}

// Test points in paper-local space
const paperLocalTop = { x: 0, z: -0.1 };    // Top of paper
const paperLocalBottom = { x: 0, z: 0.1 };  // Bottom of paper

// Convert to world space
const worldTop = paperLocalToWorld(paperLocalTop.x, paperLocalTop.z, Math.PI / 2);
const worldBottom = paperLocalToWorld(paperLocalBottom.x, paperLocalBottom.z, Math.PI / 2);

console.log("Converting paper-local coordinates to world coordinates:");
console.log(`  Paper-local top (0, -0.1) -> World (${worldTop.x.toFixed(2)}, ${worldTop.z.toFixed(2)})`);
console.log(`  Paper-local bottom (0, 0.1) -> World (${worldBottom.x.toFixed(2)}, ${worldBottom.z.toFixed(2)})\n`);

// Now convert back through our coordinate transformation
const canvasTop = worldToDrawingCoords_Current(
  { x: worldTop.x, y: 0, z: worldTop.z },
  paper
);
const canvasBottom = worldToDrawingCoords_Current(
  { x: worldBottom.x, y: 0, z: worldBottom.z },
  paper
);

console.log("Converting back to canvas coordinates:");
console.log(`  World (${worldTop.x.toFixed(2)}, ${worldTop.z.toFixed(2)}) -> Canvas (${canvasTop.x}, ${canvasTop.y})`);
console.log(`  World (${worldBottom.x.toFixed(2)}, ${worldBottom.z.toFixed(2)}) -> Canvas (${canvasBottom.x}, ${canvasBottom.y})\n`);

console.log("Canvas Y direction analysis:");
console.log(`  From ${canvasTop.y} to ${canvasBottom.y}`);
console.log(`  Delta Y: ${canvasBottom.y - canvasTop.y}`);

if (canvasBottom.y > canvasTop.y) {
  console.log("  ✅ Correct! Line goes from top to bottom on canvas");
} else if (canvasBottom.y < canvasTop.y) {
  console.log("  ❌ INVERTED! Line goes from bottom to top on canvas");
} else {
  console.log("  ⚠️  Horizontal line (no Y movement)");
}

console.log("\n" + "=".repeat(60) + "\n");

// Let's trace through the actual user experience
console.log("Tracing the user experience:\n");

console.log("1. User sees paper rotated 90° on screen");
console.log("2. User clicks at the 'top' of the paper (as they see it)");
console.log("3. Pen touches paper at world position:", `(${worldTop.x.toFixed(2)}, ${worldTop.z.toFixed(2)})`);
console.log("4. This maps to canvas position:", `(${canvasTop.x}, ${canvasTop.y})`);
console.log("5. User drags pen 'down' on the paper (as they see it)");
console.log("6. Pen moves to world position:", `(${worldBottom.x.toFixed(2)}, ${worldBottom.z.toFixed(2)})`);
console.log("7. This maps to canvas position:", `(${canvasBottom.x}, ${canvasBottom.y})`);
console.log("8. Line is drawn from", `(${canvasTop.x}, ${canvasTop.y})`, "to", `(${canvasBottom.x}, ${canvasBottom.y})`);

const visuallyCorrect = canvasBottom.y > canvasTop.y;
console.log("\n9. Result:", visuallyCorrect ? "✅ CORRECT" : "❌ INVERTED");

if (!visuallyCorrect) {
  console.log("\n❌ PROBLEM CONFIRMED!");
  console.log("   When user draws 'down', the line appears to go 'up' on the canvas!");
}
