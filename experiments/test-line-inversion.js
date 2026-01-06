#!/usr/bin/env node

/**
 * Test to reproduce the line inversion issue at 90° rotation
 *
 * Problem: When paper is rotated 90°, drawing a line from top to bottom
 * should still produce a line from top to bottom on the paper,
 * but currently it produces a line from bottom to top (inverted).
 */

// Simulate the worldToDrawingCoords function
function worldToDrawingCoords(worldPos, drawableObject) {
  if (!drawableObject) return null;

  // Get object's world position
  const objPos = drawableObject.position;

  // Calculate local offset from object center
  const localX = worldPos.x - objPos.x;
  const localZ = worldPos.z - objPos.z;

  // Transform world coordinates to paper-local coordinates
  const rotation = drawableObject.rotation.y;
  const cos = Math.cos(-rotation); // Negative for inverse rotation
  const sin = Math.sin(-rotation);
  const rotatedX = localX * cos - localZ * sin;
  const rotatedZ = localX * sin + localZ * cos;

  // Get object dimensions with scale applied
  const baseWidth = 0.28;
  const baseDepth = 0.4;
  const scale = drawableObject.scale || 1.0;
  const width = baseWidth * scale;
  const depth = baseDepth * scale;

  // Convert to normalized coordinates (0-1)
  const normalizedX = (rotatedX / width) + 0.5;
  const normalizedY = (rotatedZ / depth) + 0.5;

  // Convert to canvas coordinates (512x512 for drawing)
  const canvasSize = 512;
  return {
    x: Math.floor(normalizedX * canvasSize),
    y: Math.floor(normalizedY * canvasSize)
  };
}

console.log("=== Testing Line Inversion Issue at 90° Rotation ===\n");

// Test scenario: Paper rotated 90° (π/2 radians)
const paper = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { y: Math.PI / 2 }, // 90 degrees
  scale: 1.0
};

console.log("Paper configuration:");
console.log(`  Position: (${paper.position.x}, ${paper.position.y}, ${paper.position.z})`);
console.log(`  Rotation: ${(paper.rotation.y * 180 / Math.PI).toFixed(0)}°`);
console.log(`  Scale: ${paper.scale}\n`);

// Simulate drawing a vertical line from top to bottom in world space
// When looking at the paper after 90° rotation:
// - What was "top" (negative Z) is now "right" (positive X)
// - What was "bottom" (positive Z) is now "left" (negative X)

console.log("Test 1: Drawing a vertical line from top to bottom (in world view)");
console.log("After 90° rotation, user sees paper sideways.");
console.log("User draws from what appears to be 'top' to 'bottom' in their view.\n");

// User starts at world position (0, 0, -0.1) - this appears as "top" visually
const lineStart = { x: 0, y: 0, z: -0.1 };
const lineStartCoords = worldToDrawingCoords(lineStart, paper);

console.log(`  Line start (world): (${lineStart.x}, ${lineStart.y}, ${lineStart.z})`);
console.log(`  Line start (canvas): (${lineStartCoords.x}, ${lineStartCoords.y})`);

// User moves to world position (0, 0, 0.1) - this appears as "bottom" visually
const lineEnd = { x: 0, y: 0, z: 0.1 };
const lineEndCoords = worldToDrawingCoords(lineEnd, paper);

console.log(`  Line end (world): (${lineEnd.x}, ${lineEnd.y}, ${lineEnd.z})`);
console.log(`  Line end (canvas): (${lineEndCoords.x}, ${lineEndCoords.y})\n`);

// Check if the line is inverted
const expectedDirection = lineEndCoords.y > lineStartCoords.y ? "top-to-bottom" : "bottom-to-top";
console.log(`  Canvas Y direction: ${lineStartCoords.y} → ${lineEndCoords.y}`);
console.log(`  Result: Line drawn ${expectedDirection} on canvas`);

if (lineEndCoords.y < lineStartCoords.y) {
  console.log("  ❌ INVERTED! User drew down, but line appears to go up!");
} else {
  console.log("  ✅ Correct! User drew down, and line goes down on canvas.");
}

console.log("\n" + "=".repeat(60) + "\n");

// Test at different rotation angles
console.log("Test 2: Line drawing at various rotation angles\n");

const testAngles = [0, 45, 90, 135, 180, 225, 270, 315];

for (const degrees of testAngles) {
  const radians = (degrees * Math.PI) / 180;
  paper.rotation.y = radians;

  // Always draw "downward" in Z direction (positive Z)
  const start = { x: 0, y: 0, z: -0.05 };
  const end = { x: 0, y: 0, z: 0.05 };

  const startCoords = worldToDrawingCoords(start, paper);
  const endCoords = worldToDrawingCoords(end, paper);

  const canvasYDelta = endCoords.y - startCoords.y;
  const direction = canvasYDelta > 0 ? "⬇" : canvasYDelta < 0 ? "⬆" : "→";

  console.log(`  ${degrees.toString().padStart(3)}°: canvas Y ${startCoords.y} → ${endCoords.y} (Δ=${canvasYDelta.toString().padStart(4)}) ${direction}`);
}

console.log("\n" + "=".repeat(60) + "\n");

console.log("Analysis:");
console.log("  - At 0°: Line should go from top to bottom (Y increasing)");
console.log("  - At 90°: Paper rotated, but line direction should be consistent");
console.log("  - At 180°: Line should be inverted (Y decreasing)");
console.log("  - At 270°: Paper rotated again, direction should match visual expectation");
console.log("\nThe issue is: how do we ensure the visual direction matches user intent");
console.log("regardless of paper rotation?");
