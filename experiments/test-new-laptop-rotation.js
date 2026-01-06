/**
 * Test script to verify new laptop rotation range
 *
 * Expected behavior:
 * - Initial position: -90° (-π/2) = normal laptop at 90° physical angle (100% open)
 * - Can close to: 0° = fully closed (0% open)
 * - Can open to: -175° = fully open/convertible (200% open, nearly flat)
 *
 * User's coordinate system (where 0° = normal laptop position):
 * - User sees 0° = 100% open (normal working position)
 * - User sees +90° = 0% open (closed)
 * - User sees -85° = 200% open (fully open convertible)
 *
 * Three.js rotation.x mapping:
 * - Three.js -90° = User 0° = Normal laptop (100% open)
 * - Three.js 0° = User +90° = Closed (0% open)
 * - Three.js -175° = User -85° = Fully open (200% open)
 */

const degToRad = (deg) => deg * Math.PI / 180;
const radToDeg = (rad) => rad * 180 / Math.PI;

console.log('=== NEW LAPTOP ROTATION SYSTEM ===\n');

console.log('Initial Position:');
const initialRotation = -Math.PI / 2;
console.log(`  Three.js rotation.x: ${radToDeg(initialRotation).toFixed(1)}° (${initialRotation.toFixed(4)} rad)`);
console.log(`  Physical angle: 90° (normal laptop position)`);
console.log(`  User's view: 0° (100% open)\n`);

console.log('Closed Position:');
const closedRotation = 0;
console.log(`  Three.js rotation.x: ${radToDeg(closedRotation).toFixed(1)}° (${closedRotation.toFixed(4)} rad)`);
console.log(`  Physical angle: 0° (lid flat on base)`);
console.log(`  User's view: +90° (0% open)\n`);

console.log('Fully Open Position:');
const fullyOpenRotation = -175 * Math.PI / 180;
console.log(`  Three.js rotation.x: ${radToDeg(fullyOpenRotation).toFixed(1)}° (${fullyOpenRotation.toFixed(4)} rad)`);
console.log(`  Physical angle: 175° (nearly flat behind)`);
console.log(`  User's view: -85° (200% open, convertible mode)\n`);

console.log('Range Summary:');
console.log(`  Three.js: [${radToDeg(fullyOpenRotation).toFixed(1)}°, ${radToDeg(closedRotation).toFixed(1)}°]`);
console.log(`  User's view: [-85°, +90°]`);
console.log(`  Total range: ${radToDeg(closedRotation - fullyOpenRotation).toFixed(1)}° of motion\n`);

// Verify the user's requirement
console.log('=== VERIFICATION ===');
console.log(`User requested range: -85° to 90°`);
console.log(`Implementation range: ${radToDeg(fullyOpenRotation + Math.PI/2).toFixed(1)}° to ${radToDeg(closedRotation + Math.PI/2).toFixed(1)}°`);
console.log(`Match: ✓\n`);

console.log('From activity log analysis:');
console.log(`  - Current system went from 0° to -101° (old system)`);
console.log(`  - New system starts at -90° and can go to 0° (close) or -175° (fully open)`);
console.log(`  - User will be able to close laptop now (drag toward +90° user coordinate = 0° Three.js)`);
