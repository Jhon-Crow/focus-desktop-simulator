/**
 * Test to understand the drawing direction issue
 *
 * User reports: "When I draw from top to bottom, the line is drawn from bottom to top"
 *
 * Camera setup (from CONFIG):
 * - Camera position: { x: 0, y: 4.5, z: 5.5 }  (at positive Z, in front)
 * - Camera looks at: { x: 0, y: 0, z: -1.5 }   (negative Z, back)
 * - So camera faces in -Z direction (toward negative Z)
 *
 * This means:
 * - Positive Z = toward camera (closer to viewer) = visually HIGHER on screen
 * - Negative Z = away from camera (farther) = visually LOWER on screen
 *
 * Canvas coordinates:
 * - Canvas Y = 0 at TOP
 * - Canvas Y increases DOWNWARD
 *
 * Expected behavior:
 * - User moves cursor DOWN on screen → raycast moves toward -Z (away from camera)
 * - This should produce LARGER canvas Y values (moving down on canvas)
 */

const PAPER_WIDTH = 0.28;
const PAPER_DEPTH = 0.4;
const CANVAS_SIZE = 512;

// Current implementation in src/renderer.js
function worldToDrawingCoords_CURRENT(worldPos, drawableObject) {
  if (!drawableObject) return null;

  const objPos = drawableObject.position;
  const worldOffsetX = worldPos.x - objPos.x;
  const worldOffsetZ = worldPos.z - objPos.z;

  const rotation = drawableObject.rotation.y;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const localX = worldOffsetX * cos - worldOffsetZ * sin;
  const localZ = worldOffsetX * sin + worldOffsetZ * cos;

  const width = PAPER_WIDTH;
  const depth = PAPER_DEPTH;

  const normalizedX = (localX / width) + 0.5;
  // CURRENT: Uses 1.0 - ... (inversion)
  const normalizedY = 1.0 - ((localZ / depth) + 0.5);

  return {
    x: Math.floor(normalizedX * CANVAS_SIZE),
    y: Math.floor(normalizedY * CANVAS_SIZE)
  };
}

// Proposed fix: Remove the inversion
function worldToDrawingCoords_FIXED(worldPos, drawableObject) {
  if (!drawableObject) return null;

  const objPos = drawableObject.position;
  const worldOffsetX = worldPos.x - objPos.x;
  const worldOffsetZ = worldPos.z - objPos.z;

  const rotation = drawableObject.rotation.y;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const localX = worldOffsetX * cos - worldOffsetZ * sin;
  const localZ = worldOffsetX * sin + worldOffsetZ * cos;

  const width = PAPER_WIDTH;
  const depth = PAPER_DEPTH;

  const normalizedX = (localX / width) + 0.5;
  // FIXED: No inversion - direct mapping
  const normalizedY = (localZ / depth) + 0.5;

  return {
    x: Math.floor(normalizedX * CANVAS_SIZE),
    y: Math.floor(normalizedY * CANVAS_SIZE)
  };
}

// Test drawing from top to bottom
function testDrawingDirection() {
  console.log('=== DRAWING DIRECTION TEST ===\n');

  // Paper at center, no rotation
  const paper = {
    position: { x: 0, y: 0.01, z: 0 },
    rotation: { y: 0 }
  };

  console.log('Paper position: (0, 0, 0), rotation: 0°\n');
  console.log('Camera is at Z=5.5 looking at Z=-1.5');
  console.log('Camera faces in -Z direction (toward negative Z)\n');

  // Simulate drawing from TOP to BOTTOM of screen
  // TOP of screen = toward camera = more positive Z
  // BOTTOM of screen = away from camera = more negative Z
  const points = [
    { x: 0, z: 0.15, label: 'TOP of paper (toward camera, Z=+0.15)' },
    { x: 0, z: 0.0,  label: 'MIDDLE of paper (Z=0)' },
    { x: 0, z: -0.15, label: 'BOTTOM of paper (away from camera, Z=-0.15)' }
  ];

  console.log('Drawing stroke from TOP → BOTTOM:');
  console.log('(Moving cursor down on screen = toward negative Z)\n');

  points.forEach(point => {
    const worldPos = { x: point.x, z: point.z };
    const coordsCurrent = worldToDrawingCoords_CURRENT(worldPos, paper);
    const coordsFixed = worldToDrawingCoords_FIXED(worldPos, paper);

    console.log(`${point.label}`);
    console.log(`  World Z: ${point.z.toFixed(3)}`);
    console.log(`  CURRENT canvas Y: ${coordsCurrent.y} ${coordsCurrent.y === 0 ? '← Canvas TOP' : coordsCurrent.y === CANVAS_SIZE - 1 ? '← Canvas BOTTOM' : ''}`);
    console.log(`  FIXED canvas Y:   ${coordsFixed.y} ${coordsFixed.y === 0 ? '← Canvas TOP' : coordsFixed.y === CANVAS_SIZE - 1 ? '← Canvas BOTTOM' : ''}`);
    console.log();
  });

  console.log('=== ANALYSIS ===\n');

  const topCurrent = worldToDrawingCoords_CURRENT({ x: 0, z: 0.15 }, paper);
  const bottomCurrent = worldToDrawingCoords_CURRENT({ x: 0, z: -0.15 }, paper);
  const topFixed = worldToDrawingCoords_FIXED({ x: 0, z: 0.15 }, paper);
  const bottomFixed = worldToDrawingCoords_FIXED({ x: 0, z: -0.15 }, paper);

  console.log('CURRENT implementation:');
  console.log(`  Drawing from screen TOP → BOTTOM: canvas Y goes ${topCurrent.y} → ${bottomCurrent.y}`);
  console.log(`  Direction: ${bottomCurrent.y > topCurrent.y ? 'DOWN (correct)' : 'UP (INVERTED!)'}`);
  console.log();

  console.log('FIXED implementation:');
  console.log(`  Drawing from screen TOP → BOTTOM: canvas Y goes ${topFixed.y} → ${bottomFixed.y}`);
  console.log(`  Direction: ${bottomFixed.y > topFixed.y ? 'DOWN (correct)' : 'UP (INVERTED!)'}`);
  console.log();

  // Determine which is correct
  console.log('=== VERDICT ===\n');
  console.log('User expects: Drawing DOWN on screen → line appears going DOWN');
  console.log('              (canvas Y should INCREASE)');
  console.log();

  const currentCorrect = bottomCurrent.y > topCurrent.y;
  const fixedCorrect = bottomFixed.y > topFixed.y;

  if (!currentCorrect && fixedCorrect) {
    console.log('✓ FIXED version is correct - remove the inversion!');
    console.log('  The 1.0 - ... is causing the drawing to be upside down.');
  } else if (currentCorrect && !fixedCorrect) {
    console.log('✓ CURRENT version is correct - keep the inversion!');
    console.log('  Something else is causing the user\'s issue.');
  } else {
    console.log('? Both produce the same direction - investigate further');
  }
}

testDrawingDirection();
