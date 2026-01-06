/**
 * Analysis: Why the current compensation approach doesn't work
 *
 * The goal: When paper rotates, drawing should happen under the pen tip,
 * and the drawing should rotate WITH the paper (not stay fixed in world space).
 *
 * Current approach problems:
 * 1. We rotate canvas content to compensate rotation (-delta)
 * 2. We rotate drawing coordinates (-rotation)
 * 3. This creates a conflict!
 *
 * Let's think through what should actually happen:
 */

console.log('=== Analyzing Issue #105: Rotation Drawing ===\n');

console.log('GOAL:');
console.log('When user rotates paper and draws, the pen should draw under its tip,');
console.log('and the drawing should rotate with the paper.\n');

console.log('SCENARIO 1: No rotation');
console.log('- Paper at 0°');
console.log('- Pen at world position (0.1, 0.1)');
console.log('- Expected: Draw at canvas position corresponding to (0.1, 0.1)');
console.log('- Drawing appears stationary\n');

console.log('SCENARIO 2: Paper rotated 45°');
console.log('- Paper rotated to 45°');
console.log('- Pen at world position (0.1, 0.1) - SAME world position');
console.log('- What should happen?');
console.log('  a) Pen draws at the SAME canvas pixel position (because pen is at same world pos)');
console.log('  b) Drawing SHOULD rotate WITH the paper (not stay fixed)');
console.log('  c) But we want old drawing to stay in place relative to paper!\n');

console.log('THE INSIGHT:');
console.log('There are TWO different things happening:');
console.log('1. OLD drawing must rotate WITH the paper (canvas content rotation)');
console.log('2. NEW drawing coordinates must be transformed to account for rotation\n');

console.log('Current implementation issue:');
console.log('❌ We rotate canvas content: -rotationDelta');
console.log('❌ We rotate coordinates: -rotation');
console.log('   This creates confusion!\n');

console.log('What should actually happen:');
console.log('Option A: NO canvas rotation, YES coordinate rotation');
console.log('  - Don\'t rotate canvas content');
console.log('  - Rotate drawing coordinates to match paper rotation');
console.log('  - Drawing stays fixed in paper-space, rotates in world-space');
console.log('  - This is CORRECT if we want drawing to stay with paper\n');

console.log('Option B: YES canvas rotation, NO coordinate rotation');
console.log('  - Rotate canvas content to compensate');
console.log('  - Don\'t rotate coordinates');
console.log('  - Drawing stays fixed in world-space, NOT paper-space');
console.log('  - This is WRONG for our use case!\n');

console.log('CORRECT APPROACH for Issue #105:');
console.log('✅ When paper rotates, the DRAWING should rotate WITH it');
console.log('✅ Pen should draw under its tip in world space');
console.log('✅ This means: NO canvas content rotation, YES coordinate rotation\n');

console.log('The fix should be:');
console.log('1. REMOVE rotateCanvasContent() call - don\'t rotate old content');
console.log('2. KEEP coordinate rotation in worldToDrawingCoords()');
console.log('3. This way, drawing is in "paper space" not "world space"\n');

console.log('Wait... let me reconsider...\n');

console.log('Actually, what does "drawing doesn\'t happen under pen" mean?');
console.log('It means: when paper is rotated and you draw, the line appears');
console.log('in the wrong place, not where the pen tip is touching.\n');

console.log('Let\'s think about coordinate spaces:');
console.log('- World space: Fixed 3D coordinate system');
console.log('- Paper space: Coordinate system that rotates with paper');
console.log('- Canvas space: 2D pixel coordinates on texture\n');

console.log('Transformation pipeline:');
console.log('World position → Paper-local position → Normalized coords → Canvas coords\n');

console.log('For "drawing under pen tip" to work:');
console.log('1. Get pen world position');
console.log('2. Transform to paper-local position (accounting for paper rotation)');
console.log('3. Map to canvas coordinates');
console.log('4. Draw at those canvas coordinates\n');

console.log('The key question: Should the canvas texture itself rotate?');
console.log('Answer: NO! The canvas should be fixed to the paper.');
console.log('The paper (3D object) rotates, and the texture is on it.');
console.log('So the texture rotates automatically with the paper in 3D space.\n');

console.log('FINAL ANSWER:');
console.log('✅ worldToDrawingCoords() should transform world → paper-local coords');
console.log('✅ This requires rotating coordinates by -paper.rotation');
console.log('✅ NO canvas content rotation needed');
console.log('✅ NO texture rotation needed');
console.log('✅ The 3D mesh rotation handles visual rotation automatically\n');

console.log('Current bug:');
console.log('❌ We\'re rotating canvas content, which is WRONG');
console.log('❌ This causes old drawing to rotate in unexpected ways');
console.log('✅ The coordinate rotation is CORRECT\n');

console.log('Simple fix:');
console.log('REMOVE: rotateCanvasContent() call');
console.log('REMOVE: canvas rotation compensation logic');
console.log('KEEP: Coordinate rotation in worldToDrawingCoords()');
