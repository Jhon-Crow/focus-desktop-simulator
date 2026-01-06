#!/usr/bin/env node

/**
 * Debug axis directions to find the inversion issue
 *
 * The owner reports: "when I draw from top to bottom, line appears bottom to top"
 * This suggests a possible issue with:
 * 1. The sign of the rotation
 * 2. The canvas Y axis direction
 * 3. The Z axis direction in the coordinate system
 */

function worldToDrawingCoords(worldPos, drawableObject) {
  const objPos = drawableObject.position;
  const localX = worldPos.x - objPos.x;
  const localZ = worldPos.z - objPos.z;

  const rotation = drawableObject.rotation.y;
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

console.log("=== Debug: Finding the Inversion Issue ===\n");

console.log("Key Question: When user draws 'top to bottom' visually,");
console.log("should the canvas Y coordinate increase or decrease?\n");

console.log("Canvas coordinate system:");
console.log("  - Canvas (0, 0) is at the top-left");
console.log("  - Canvas (512, 512) is at the bottom-right");
console.log("  - Drawing 'down' means Y should INCREASE\n");

console.log("=".repeat(60) + "\n");

// Test at 0° rotation - this should be correct
console.log("Test 1: No rotation (0°) - baseline\n");

const paper0 = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { y: 0 },
};

// User draws from top to bottom in Z direction
const top0 = { x: 0, y: 0, z: -0.1 };
const bottom0 = { x: 0, y: 0, z: 0.1 };

const canvas0Top = worldToDrawingCoords(top0, paper0);
const canvas0Bottom = worldToDrawingCoords(bottom0, paper0);

console.log(`  Top world (0, -0.1) -> Canvas (${canvas0Top.x}, ${canvas0Top.y})`);
console.log(`  Bottom world (0, 0.1) -> Canvas (${canvas0Bottom.x}, ${canvas0Bottom.y})`);
console.log(`  Canvas Y delta: ${canvas0Bottom.y - canvas0Top.y}`);
console.log(`  Result: ${canvas0Bottom.y > canvas0Top.y ? '✅ Correct (Y increases)' : '❌ Wrong (Y decreases)'}\n`);

console.log("=".repeat(60) + "\n");

// Test at 90° rotation
console.log("Test 2: 90° rotation - reported issue\n");

const paper90 = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { y: Math.PI / 2 },
};

// At 90° rotation, what the user sees as "top to bottom" is different
// The paper's local Z-axis (which maps to canvas Y) now points in world +X direction

// If user draws from visual "top" to "bottom", they're moving in the
// direction of the paper's local Z axis.

// Paper local Z (0 to +depth) in world space:
// At 90°: local (0, z) -> world (sin(90)*0 + cos(90)*z, ...) = (z, ...)
// Wait, let me recalculate properly

// Rotation matrix for Y-axis:
// x' = x*cos - z*sin
// z' = x*sin + z*cos

// At theta = 90°:
// x' = x*0 - z*1 = -z
// z' = x*1 + z*0 = x

// So paper-local (0, z_local) becomes world (-z_local, 0)
// Paper-local (0, -0.1) becomes world (0.1, 0) - visual "top"
// Paper-local (0, 0.1) becomes world (-0.1, 0) - visual "bottom"

const top90 = { x: 0.1, y: 0, z: 0 };    // Visual "top" after rotation
const bottom90 = { x: -0.1, y: 0, z: 0 }; // Visual "bottom" after rotation

const canvas90Top = worldToDrawingCoords(top90, paper90);
const canvas90Bottom = worldToDrawingCoords(bottom90, paper90);

console.log(`  Visual top world (0.1, 0) -> Canvas (${canvas90Top.x}, ${canvas90Top.y})`);
console.log(`  Visual bottom world (-0.1, 0) -> Canvas (${canvas90Bottom.x}, ${canvas90Bottom.y})`);
console.log(`  Canvas Y delta: ${canvas90Bottom.y - canvas90Top.y}`);
console.log(`  Result: ${canvas90Bottom.y > canvas90Top.y ? '✅ Correct (Y increases)' : '❌ INVERTED (Y decreases)'}\n`);

if (canvas90Bottom.y < canvas90Top.y) {
  console.log("  🔴 PROBLEM FOUND!");
  console.log("  When user draws 'down' visually, canvas Y DECREASES!");
  console.log("  This means the line appears to go 'up' on the canvas!\n");
}

console.log("=".repeat(60) + "\n");

// Test at 180° rotation
console.log("Test 3: 180° rotation\n");

const paper180 = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { y: Math.PI },
};

// At 180°: local (0, z) -> world (0, -z)
const top180 = { x: 0, y: 0, z: 0.1 };    // Visual "top"
const bottom180 = { x: 0, y: 0, z: -0.1 }; // Visual "bottom"

const canvas180Top = worldToDrawingCoords(top180, paper180);
const canvas180Bottom = worldToDrawingCoords(bottom180, paper180);

console.log(`  Visual top world (0, 0.1) -> Canvas (${canvas180Top.x}, ${canvas180Top.y})`);
console.log(`  Visual bottom world (0, -0.1) -> Canvas (${canvas180Bottom.x}, ${canvas180Bottom.y})`);
console.log(`  Canvas Y delta: ${canvas180Bottom.y - canvas180Top.y}`);
console.log(`  Result: ${canvas180Bottom.y > canvas180Top.y ? '✅ Correct (Y increases)' : '❌ INVERTED (Y decreases)'}\n`);

console.log("=".repeat(60) + "\n");

// Test at 270° rotation
console.log("Test 4: 270° rotation\n");

const paper270 = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { y: (3 * Math.PI) / 2 },
};

// At 270°: local (0, z) -> world (-z, 0)
const top270 = { x: -0.1, y: 0, z: 0 };    // Visual "top"
const bottom270 = { x: 0.1, y: 0, z: 0 };  // Visual "bottom"

const canvas270Top = worldToDrawingCoords(top270, paper270);
const canvas270Bottom = worldToDrawingCoords(bottom270, paper270);

console.log(`  Visual top world (-0.1, 0) -> Canvas (${canvas270Top.x}, ${canvas270Top.y})`);
console.log(`  Visual bottom world (0.1, 0) -> Canvas (${canvas270Bottom.x}, ${canvas270Bottom.y})`);
console.log(`  Canvas Y delta: ${canvas270Bottom.y - canvas270Top.y}`);
console.log(`  Result: ${canvas270Bottom.y > canvas270Top.y ? '✅ Correct (Y increases)' : '❌ INVERTED (Y decreases)'}\n`);

console.log("=".repeat(60) + "\n");

console.log("Summary:");
console.log("  0°:   " + (canvas0Bottom.y > canvas0Top.y ? "✅ OK" : "❌ INVERTED"));
console.log("  90°:  " + (canvas90Bottom.y > canvas90Top.y ? "✅ OK" : "❌ INVERTED"));
console.log("  180°: " + (canvas180Bottom.y > canvas180Top.y ? "✅ OK" : "❌ INVERTED"));
console.log("  270°: " + (canvas270Bottom.y > canvas270Top.y ? "✅ OK" : "❌ INVERTED"));
