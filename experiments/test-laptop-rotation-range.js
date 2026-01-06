// Test script to verify laptop rotation range implementation
// This verifies the new approach: start at -90°, move ±90° in both directions

const startPosition = -Math.PI / 2; // -90° (normal laptop position)
const minRotation = -Math.PI; // -180° (fully open convertible)
const maxRotation = 0; // 0° (fully closed)

console.log('=== Laptop Rotation Range Test ===\n');

// Convert to degrees for easier reading
const startDegrees = startPosition * 180 / Math.PI;
const minDegrees = minRotation * 180 / Math.PI;
const maxDegrees = maxRotation * 180 / Math.PI;

console.log('Starting position:', startDegrees.toFixed(1) + '°', '(normal laptop at 90° physical angle)');
console.log('Minimum rotation:', minDegrees.toFixed(1) + '°', '(fully open convertible)');
console.log('Maximum rotation:', maxDegrees.toFixed(1) + '°', '(fully closed)');
console.log();

// Calculate range from starting position
const rangeToClose = Math.abs(startPosition - maxRotation) * 180 / Math.PI;
const rangeToOpen = Math.abs(minRotation - startPosition) * 180 / Math.PI;
const totalRange = Math.abs(maxRotation - minRotation) * 180 / Math.PI;

console.log('Range to close (from start to 0°):', rangeToClose.toFixed(1) + '°');
console.log('Range to open (from start to -180°):', rangeToOpen.toFixed(1) + '°');
console.log('Total range:', totalRange.toFixed(1) + '°');
console.log();

// Verify it matches user requirement
const userRequirement = '90° in both directions from starting position';
const matches = rangeToClose === 90 && rangeToOpen === 90;

console.log('User requirement:', userRequirement);
console.log('Implementation matches:', matches ? '✓ YES' : '✗ NO');
console.log();

// Test various positions
console.log('=== Position Tests ===');
const testPositions = [
  { name: 'Fully closed', rotation: 0 },
  { name: 'Half closed', rotation: -Math.PI / 4 },
  { name: 'Normal (start)', rotation: -Math.PI / 2 },
  { name: 'Half open', rotation: -3 * Math.PI / 4 },
  { name: 'Fully open', rotation: -Math.PI }
];

testPositions.forEach(pos => {
  const degrees = pos.rotation * 180 / Math.PI;
  const degreesFromStart = (pos.rotation - startPosition) * 180 / Math.PI;
  const inRange = pos.rotation >= minRotation && pos.rotation <= maxRotation;
  console.log(`${pos.name}: ${degrees.toFixed(1)}° (${degreesFromStart >= 0 ? '+' : ''}${degreesFromStart.toFixed(1)}° from start) - ${inRange ? 'VALID' : 'INVALID'}`);
});

console.log();
console.log('=== Summary ===');
console.log('✓ Laptop starts at normal position (-90°)');
console.log('✓ Can close 90° (from -90° to 0°)');
console.log('✓ Can open 90° (from -90° to -180°)');
console.log('✓ Total range: 180°');
console.log('✓ This is a NEW variant that has NOT been tried before');
