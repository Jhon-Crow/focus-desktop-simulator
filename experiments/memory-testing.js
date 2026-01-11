/**
 * Memory Testing Guide for Focus Desktop Simulator
 *
 * This file documents how to test memory management improvements
 * made to address issue #121 (repository work consuming server RAM).
 *
 * Key Changes Made:
 * =================
 *
 * 1. Added disposeThreeObject() function (renderer.js)
 *    - Properly disposes Three.js geometries, materials, and textures
 *    - Cleans up audio elements and Web Audio API nodes
 *    - Clears userData references that may hold large data
 *
 * 2. Updated removeObject() and clearAllObjects()
 *    - Now call disposeThreeObject() to properly release GPU resources
 *    - Clean up friction sound states
 *
 * 3. Added memoryMonitor utility (renderer.js)
 *    - Accessible via console: window.memoryMonitor
 *    - Provides real-time memory statistics
 *
 * How to Test Memory Management:
 * ==============================
 *
 * 1. Open DevTools in the Electron app (Ctrl+Shift+I or --dev flag)
 *
 * 2. Start memory monitoring:
 *    > memoryMonitor.startMonitoring(5000)  // Log every 5 seconds
 *
 * 3. Get current stats:
 *    > memoryMonitor.getStats()
 *
 * 4. Check memory trend:
 *    > memoryMonitor.getTrend()
 *
 * 5. Stop monitoring:
 *    > memoryMonitor.stopMonitoring()
 *
 * Memory Stress Test Procedure:
 * ============================
 *
 * 1. Start monitoring: memoryMonitor.startMonitoring(5000)
 *
 * 2. Add many objects to the desk (10-20 of various types)
 *
 * 3. Delete all objects: Click "Clear Desk" button
 *
 * 4. Check that geometries/materials/textures counts decrease
 *
 * 5. Repeat steps 2-4 several times
 *
 * 6. Check getTrend() - heap delta should not continuously grow
 *
 * Expected Results:
 * ================
 *
 * Before Fix:
 * - geometries/materials/textures counts would keep increasing
 * - usedJSHeapSize would grow with each add/delete cycle
 *
 * After Fix:
 * - geometries/materials/textures should return to baseline after clearing
 * - Memory should stabilize or decrease after garbage collection
 *
 * Force GC (if available):
 * > memoryMonitor.forceGC()
 *
 * Note: Requires running Electron with: --js-flags="--expose-gc"
 */

// Example test sequence (run in DevTools console):
const testSequence = `
// Step 1: Start monitoring
memoryMonitor.startMonitoring(5000);

// Step 2: Get baseline stats
const baseline = memoryMonitor.getStats();
console.log('Baseline:', baseline);

// Step 3: Add objects via UI, then clear desk

// Step 4: After clearing, check stats
const afterClear = memoryMonitor.getStats();
console.log('After clear:', afterClear);
console.log('Geometries delta:', afterClear.geometries - baseline.geometries);

// Step 5: Check trend
memoryMonitor.getTrend();

// Step 6: Stop when done
memoryMonitor.stopMonitoring();
`;

console.log('Memory testing guide loaded. See comments for instructions.');
