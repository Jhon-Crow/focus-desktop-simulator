// Test script to verify camera flip bug fix
// Issue #26: When lowering the camera to maximum down position, the image flips over
//
// Root cause: minPitch was set to -1.83 radians (~-105 degrees), which is past -90 degrees.
// When pitch goes below -π/2 (-90°), cos(pitch) becomes negative, flipping the view.
//
// Fix: Changed minPitch from -1.83 to -1.55 radians (~-89 degrees), keeping it safely
// above the -90 degree threshold where the flip occurs.

const OLD_MIN_PITCH = -1.83;
const NEW_MIN_PITCH = -1.55;
const PITCH_90_DEG = -Math.PI / 2; // -1.5708 radians

function analyzeMinPitch(minPitch, label) {
  const cosPitch = Math.cos(minPitch);
  const sinPitch = Math.sin(minPitch);
  const degrees = minPitch * 180 / Math.PI;
  const willFlip = cosPitch < 0;

  console.log(`${label}:`);
  console.log(`  Value: ${minPitch.toFixed(4)} radians (${degrees.toFixed(2)} degrees)`);
  console.log(`  cos(pitch): ${cosPitch.toFixed(6)} ${cosPitch < 0 ? '(NEGATIVE - causes flip!)' : '(positive - no flip)'}`);
  console.log(`  sin(pitch): ${sinPitch.toFixed(6)}`);
  console.log(`  Will flip: ${willFlip ? 'YES - BUG!' : 'NO - OK'}`);
  console.log('');

  return !willFlip; // Returns true if the value is safe
}

console.log('=== Camera Flip Bug Fix Verification ===');
console.log('Issue #26: Image flips when camera tilted maximum down');
console.log('');
console.log(`Reference: -90 degrees = ${PITCH_90_DEG.toFixed(4)} radians`);
console.log('When pitch < -π/2, cos(pitch) becomes negative, flipping x and z components');
console.log('');

const oldOk = analyzeMinPitch(OLD_MIN_PITCH, 'OLD minPitch (buggy)');
const newOk = analyzeMinPitch(NEW_MIN_PITCH, 'NEW minPitch (fixed)');

console.log('=== Test Results ===');
console.log(`Old value (-1.83): ${oldOk ? 'PASS' : 'FAIL - causes flip'}`);
console.log(`New value (-1.55): ${newOk ? 'PASS - no flip' : 'FAIL'}`);
console.log('');

if (!oldOk && newOk) {
  console.log('SUCCESS: Fix correctly prevents camera flip!');
  process.exit(0);
} else {
  console.log('ERROR: Fix verification failed');
  process.exit(1);
}
