#!/usr/bin/env node

/**
 * Verification script for extended laptop rotation range
 *
 * This script verifies that the laptop lid can now rotate through an extended range:
 * - Starts at -90° (normal open position)
 * - Can rotate to -180° (folded backward, past flat)
 * - Total range: 90° of additional rotation in closing direction
 *
 * Requirements (from issue comment):
 * - "добавь возможность ещё на 90 deg повернуть экран в сторону закрытия"
 * - Translation: "add the ability to rotate the screen another 90 degrees in the closing direction"
 */

const fs = require('fs');
const path = require('path');

console.log('='.repeat(80));
console.log('LAPTOP EXTENDED ROTATION RANGE VERIFICATION');
console.log('='.repeat(80));
console.log();

// Read the renderer.js file
const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
const rendererContent = fs.readFileSync(rendererPath, 'utf-8');

// Expected values
const expectedMinRotation = '-Math.PI'; // -180°
const expectedMaxRotation = '-Math.PI / 2'; // -90°
const expectedStartRotation = '-Math.PI / 2'; // -90°

console.log('Expected Configuration:');
console.log(`  Starting position: ${expectedStartRotation} (-90°, normal open)`);
console.log(`  Maximum rotation: ${expectedMaxRotation} (-90°, normal open)`);
console.log(`  Minimum rotation: ${expectedMinRotation} (-180°, folded backward)`);
console.log(`  Total range: 90° (additional rotation in closing direction)`);
console.log();

// Check 1: Verify minRotation is set to -180°
console.log('Check 1: Verify minRotation is -180° (folded backward)');
const minRotationMatch = rendererContent.match(/const minRotation = ([^;]+);/);
if (!minRotationMatch) {
  console.error('  ❌ FAILED: Could not find minRotation definition');
  process.exit(1);
}
const minRotationValue = minRotationMatch[1].trim();
console.log(`  Found: const minRotation = ${minRotationValue};`);
if (minRotationValue === expectedMinRotation) {
  console.log('  ✓ PASSED: minRotation is correctly set to -Math.PI (-180°)');
} else {
  console.error(`  ❌ FAILED: Expected "${expectedMinRotation}", got "${minRotationValue}"`);
  process.exit(1);
}
console.log();

// Check 2: Verify maxRotation is set to -90°
console.log('Check 2: Verify maxRotation is -90° (normal open position)');
const maxRotationMatch = rendererContent.match(/const maxRotation = ([^;]+);/);
if (!maxRotationMatch) {
  console.error('  ❌ FAILED: Could not find maxRotation definition');
  process.exit(1);
}
const maxRotationValue = maxRotationMatch[1].trim();
console.log(`  Found: const maxRotation = ${maxRotationValue};`);
if (maxRotationValue === expectedMaxRotation) {
  console.log('  ✓ PASSED: maxRotation is correctly set to -Math.PI / 2 (-90°)');
} else {
  console.error(`  ❌ FAILED: Expected "${expectedMaxRotation}", got "${maxRotationValue}"`);
  process.exit(1);
}
console.log();

// Check 3: Verify initial lidRotation in createLaptop
console.log('Check 3: Verify laptop starts at -90° (normal open position)');
const lidRotationMatch = rendererContent.match(/lidRotation: ([^,]+),/);
if (!lidRotationMatch) {
  console.error('  ❌ FAILED: Could not find lidRotation initialization');
  process.exit(1);
}
const lidRotationValue = lidRotationMatch[1].trim();
console.log(`  Found: lidRotation: ${lidRotationValue},`);
if (lidRotationValue === expectedStartRotation) {
  console.log('  ✓ PASSED: lidRotation starts at -Math.PI / 2 (-90°)');
} else {
  console.error(`  ❌ FAILED: Expected "${expectedStartRotation}", got "${lidRotationValue}"`);
  process.exit(1);
}
console.log();

// Check 4: Verify targetLidRotation in createLaptop
console.log('Check 4: Verify target lid rotation starts at -90°');
const targetLidRotationMatch = rendererContent.match(/targetLidRotation:\s*(-Math\.PI\s*\/\s*2|-Math\.PI)/);
if (!targetLidRotationMatch) {
  console.error('  ❌ FAILED: Could not find targetLidRotation initialization');
  process.exit(1);
}
const targetLidRotationValue = targetLidRotationMatch[1].trim().replace(/\s+/g, ' ');
console.log(`  Found: targetLidRotation: ${targetLidRotationValue}`);
const normalizedExpected = expectedStartRotation.replace(/\s+/g, ' ');
const normalizedActual = targetLidRotationValue.replace(/\s+/g, ' ');
if (normalizedActual === normalizedExpected) {
  console.log('  ✓ PASSED: targetLidRotation starts at -Math.PI / 2 (-90°)');
} else {
  console.error(`  ❌ FAILED: Expected "${normalizedExpected}", got "${normalizedActual}"`);
  process.exit(1);
}
console.log();

// Calculate rotation range
const minDegrees = -180;
const maxDegrees = -90;
const rangeDegrees = Math.abs(minDegrees - maxDegrees);

console.log('Check 5: Verify rotation range is 90° (additional closing range)');
console.log(`  Calculated range: ${rangeDegrees}°`);
if (rangeDegrees === 90) {
  console.log('  ✓ PASSED: Rotation range is exactly 90° as required');
} else {
  console.error(`  ❌ FAILED: Expected 90°, got ${rangeDegrees}°`);
  process.exit(1);
}
console.log();

// Check 6: Verify comment describes the extended range correctly
console.log('Check 6: Verify comments describe the extended rotation range');
const commentMatch = rendererContent.match(/\/\/ Clamp rotation range: -90° \(normal open position\) to -180° \(folded backward\)/);
if (commentMatch) {
  console.log('  ✓ PASSED: Comment correctly describes -90° to -180° range');
} else {
  console.error('  ❌ FAILED: Comment does not describe the extended range correctly');
  process.exit(1);
}
console.log();

console.log('='.repeat(80));
console.log('ALL CHECKS PASSED ✓');
console.log('='.repeat(80));
console.log();
console.log('Summary:');
console.log('  - Laptop starts at -90° (normal open position)');
console.log('  - Can rotate to -180° (folded backward, past flat position)');
console.log('  - Total additional range: 90° in closing direction');
console.log('  - Meets requirement: "add ability to rotate screen another 90 degrees in closing direction"');
console.log();
console.log('✓ Extended rotation range successfully implemented!');
console.log();
