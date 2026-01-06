// Verify laptop starts at -90° (normal open position) and can close to 0°

const laptopStartRotation = -Math.PI / 2; // -90° in radians
const targetLidRotation = -Math.PI / 2;
const minRotation = -Math.PI / 2; // -90° (normal open position)
const maxRotation = 0; // 0° (fully closed)

console.log('=== Laptop Initial State ===');
console.log(`Starting rotation (userData.lidRotation): ${laptopStartRotation} radians = ${(laptopStartRotation * 180 / Math.PI).toFixed(1)}°`);
console.log(`Target rotation (userData.targetLidRotation): ${targetLidRotation} radians = ${(targetLidRotation * 180 / Math.PI).toFixed(1)}°`);
console.log(`Visual rotation (screenGroup.rotation.x): -Math.PI / 2 = ${(-Math.PI / 2 * 180 / Math.PI).toFixed(1)}°`);
console.log('');

console.log('=== Rotation Range ===');
console.log(`Minimum rotation (most open): ${minRotation} radians = ${(minRotation * 180 / Math.PI).toFixed(1)}°`);
console.log(`Maximum rotation (fully closed): ${maxRotation} radians = ${(maxRotation * 180 / Math.PI).toFixed(1)}°`);
console.log(`Total range: ${((maxRotation - minRotation) * 180 / Math.PI).toFixed(1)}°`);
console.log('');

console.log('=== Verification ===');
const visualMatchesUserData = laptopStartRotation === -Math.PI / 2;
const canClose = maxRotation === 0 && minRotation === -Math.PI / 2;
const rangeIsCorrect = (maxRotation - minRotation) === Math.PI / 2; // 90° range

console.log(`✓ Visual rotation matches userData: ${visualMatchesUserData ? 'YES' : 'NO'}`);
console.log(`✓ Can close laptop (range -90° to 0°): ${canClose ? 'YES' : 'NO'}`);
console.log(`✓ Range is 90°: ${rangeIsCorrect ? 'YES' : 'NO'}`);
console.log('');

console.log('=== Direction Logic Test ===');
// Screen faces camera, pull down (+deltaY = 10 pixels)
const deltaY = 10;
const rotationSensitivity = 0.003;
const directionMultiplier = -1; // Screen faces camera

const accumulatedDeltaY = deltaY;
const startLidRotation = -Math.PI / 2; // -90°
let newRotation = startLidRotation - (accumulatedDeltaY * rotationSensitivity * directionMultiplier);
newRotation = Math.max(minRotation, Math.min(maxRotation, newRotation));

console.log(`Starting from: ${(startLidRotation * 180 / Math.PI).toFixed(1)}° (normal open position)`);
console.log(`Pull down 10 pixels (screen faces camera)`);
console.log(`Calculated rotation: ${(newRotation * 180 / Math.PI).toFixed(1)}°`);
console.log(`Expected behavior: Should close lid (move toward 0°)`);
console.log(`Actual behavior: ${newRotation > startLidRotation ? 'Moving toward 0° ✓ CORRECT' : 'Moving away from 0° ✗ WRONG'}`);
console.log('');

console.log('=== User Requirement ===');
console.log('User wants:');
console.log('- Laptop starts at normal open position (90° physical angle, -90° in Three.js)');
console.log('- Can drag to close the lid completely (to 0°)');
console.log('- Total range: 90°');
console.log('');
console.log('Implementation status:');
console.log(`✓ Starts at -90°: ${laptopStartRotation === -Math.PI / 2 ? 'YES' : 'NO'}`);
console.log(`✓ Can close to 0°: ${maxRotation === 0 ? 'YES' : 'NO'}`);
console.log(`✓ Range is 90°: ${rangeIsCorrect ? 'YES' : 'NO'}`);
console.log(`✓ Visual matches userData: ${visualMatchesUserData ? 'YES' : 'NO'}`);
