/**
 * Test to understand texture mapping orientation
 *
 * In THREE.js, CanvasTexture by default has flipY = true
 * This means the texture is FLIPPED vertically when applied to geometry!
 *
 * Canvas coordinates:
 * - (0, 0) is at TOP-LEFT
 * - Y increases DOWNWARD
 *
 * With flipY = true:
 * - Canvas Y=0 (top) maps to texture V=1 (top of geometry)
 * - Canvas Y=512 (bottom) maps to texture V=0 (bottom of geometry)
 *
 * So if we draw at canvas Y=100 (near top), it appears at texture V=0.8 (near top)
 * And if we draw at canvas Y=400 (near bottom), it appears at texture V=0.2 (near bottom)
 *
 * This is CORRECT for most cases, BUT...
 *
 * The issue might be in how the geometry UVs are mapped!
 * For BoxGeometry, the top face might have UVs oriented differently.
 */

console.log('=== TEXTURE MAPPING ANALYSIS ===\n');

console.log('THREE.CanvasTexture default behavior:');
console.log('  flipY = true (default)');
console.log('  This vertically flips the canvas when applying to geometry\n');

console.log('Canvas coordinate system:');
console.log('  Origin: TOP-LEFT (0, 0)');
console.log('  X axis: LEFT → RIGHT (increases rightward)');
console.log('  Y axis: TOP → BOTTOM (increases downward)\n');

console.log('Texture coordinate system (with flipY = true):');
console.log('  Canvas Y=0 (top) → Texture V=1 (top)');
console.log('  Canvas Y=512 (bottom) → Texture V=0 (bottom)');
console.log('  Result: Texture is FLIPPED vertically\n');

console.log('For BoxGeometry top face:');
console.log('  The top face (+Y face) has specific UV mapping');
console.log('  By default, THREE.BoxGeometry orients UVs so:');
console.log('    - Looking at top face from above (camera looking down)');
console.log('    - Texture U increases from left to right');
console.log('    - Texture V increases from back to front (in +Z direction)\n');

console.log('Combining these:');
console.log('  1. Canvas Y increases downward (0 = top, 512 = bottom)');
console.log('  2. Texture flips it (Y=0 → V=1, Y=512 → V=0)');
console.log('  3. Geometry UV maps V to Z-axis\n');

console.log('The problem might be:');
console.log('  - If texture V maps to Z axis in a way that conflicts with our coordinate transform');
console.log('  - We need to check if Z+ in world space corresponds to V+ or V- in texture space\n');

console.log('=== HYPOTHESIS ===\n');
console.log('The user reports drawing is inverted.');
console.log('This suggests that when they draw DOWN on screen:');
console.log('  1. Raycast moves toward -Z (correct based on camera)');
console.log('  2. worldToDrawingCoords() calculates canvas Y (currently WITH inversion)');
console.log('  3. Canvas is drawn at that Y position');
console.log('  4. Texture is applied to geometry WITH flipY=true');
console.log('  5. Geometry UV mapping determines final position\n');

console.log('The double-flip issue:');
console.log('  - worldToDrawingCoords() inverts Z → Y: normalizedY = 1.0 - ((localZ / depth) + 0.5)');
console.log('  - CanvasTexture ALSO flips: flipY = true');
console.log('  - Result: TWO inversions = NO inversion overall?');
console.log('  - Or maybe the inversions don\'t cancel out due to UV mapping?\n');

console.log('=== SOLUTION ===\n');
console.log('Try REMOVING the inversion in worldToDrawingCoords():');
console.log('  Change: const normalizedY = 1.0 - ((localZ / depth) + 0.5);');
console.log('  To:     const normalizedY = (localZ / depth) + 0.5;');
console.log('');
console.log('This would make canvas Y directly proportional to localZ.');
console.log('Then the texture flipY will provide the correct orientation.\n');

console.log('OR, if that doesn\'t work:');
console.log('  Keep the inversion in worldToDrawingCoords()');
console.log('  But set texture.flipY = false in updateDrawingTexture()\n');
