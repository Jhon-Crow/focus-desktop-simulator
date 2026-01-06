// Explanation of the texture rotation approach for issue #105
// Issue: When rotating paper, drawing doesn't happen under the pen

console.log('=== Issue #105: Texture Rotation Approach ===\n');

console.log('Problem:');
console.log('When the paper/notebook is rotated in 3D space, drawing should still');
console.log('happen exactly under the pen tip, but the drawn image should appear');
console.log('rotated along with the paper.\n');

console.log('Previous Approach (coordinate transformation):');
console.log('- Transform world coordinates to object-space coordinates');
console.log('- Apply rotation matrix to coordinates before normalizing');
console.log('- Draw on unrotated canvas');
console.log('❌ This approach was complex and still had issues\n');

console.log('New Approach (texture rotation):');
console.log('- Keep coordinate transformation simple (no rotation)');
console.log('- Draw on unrotated canvas in world-space coordinates');
console.log('- Rotate the TEXTURE itself to match object rotation');
console.log('✅ This is simpler and more intuitive\n');

console.log('Implementation Details:');
console.log('1. worldToDrawingCoords() - simplified:');
console.log('   - Calculate local offset (no rotation)');
console.log('   - Convert to normalized coords (0-1)');
console.log('   - Map to canvas coords (512x512)');
console.log('');
console.log('2. updateDrawingTexture() - handles rotation:');
console.log('   - Set texture.center to (0.5, 0.5)');
console.log('   - Set texture.rotation = object.rotation.y');
console.log('   - Update rotation whenever texture updates');
console.log('');

console.log('Why this works:');
console.log('- Drawing happens at consistent world positions');
console.log('- Texture rotation makes it appear correctly oriented on rotated paper');
console.log('- User sees drawing at pen tip, rotated with the paper');
console.log('- Much simpler coordinate math\n');

// Demonstrate the difference
console.log('Example: Paper rotated 90 degrees, pen at (0.1, 0, 0)');
console.log('');
console.log('Coordinate approach:');
console.log('  - Must apply rotation matrix to (0.1, 0)');
console.log('  - Complex trigonometry with cos/sin');
console.log('  - Coordinates on canvas: rotated position');
console.log('');
console.log('Texture approach:');
console.log('  - Direct mapping: (0.1, 0) -> canvas coords');
console.log('  - Simple linear transformation');
console.log('  - Texture rotated 90 degrees on 3D surface');
console.log('  - Visual result: same, but simpler code!\n');

console.log('Benefits of texture rotation approach:');
console.log('✅ Simpler coordinate transformation');
console.log('✅ Easier to understand and maintain');
console.log('✅ Leverages THREE.js texture rotation feature');
console.log('✅ Drawing position always matches pen position');
console.log('✅ Rotation handled at rendering level, not coordinate level');
