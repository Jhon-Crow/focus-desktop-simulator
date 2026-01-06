# Fix Summary: Z-Axis Inversion Issue #105

## Problem Statement

After rotating the paper by 90°, when the user draws a line "from top to bottom" by moving the mouse downward on the screen, the line appeared to be drawn "from bottom to top" on the canvas - inverted!

## Root Cause

The issue was in the `worldToDrawingCoords()` function in `src/renderer.js`. The coordinate transformation was mapping world Z coordinates directly to canvas Y coordinates without accounting for the camera's orientation.

### Camera Setup
```javascript
// Camera position and orientation
position: { x: 0, y: 4.5, z: 5.5 }  // Above and in front of desk
lookAt: { x: 0, y: 0, z: -1.5 }      // Looking toward negative Z
```

This means:
- Camera is at positive Z (+5.5)
- Camera looks toward negative Z direction
- When user moves mouse DOWN on screen → raycast moves toward -Z (away from camera)
- When user moves mouse UP on screen → raycast moves toward +Z (toward camera)

### Canvas Coordinate System
- Canvas Y=0 is at the TOP of the canvas
- Canvas Y=512 is at the BOTTOM of the canvas
- Moving "down" should INCREASE Y value

### The Bug
The old code mapped world Z directly to canvas Y:
```javascript
const normalizedY = (rotatedZ / depth) + 0.5;
```

This caused:
- World Z=+0.1 (toward camera) → Canvas Y=higher value (bottom)
- World Z=-0.1 (away from camera) → Canvas Y=lower value (top)

But user expects:
- Mouse moving DOWN (toward -Z) → Canvas Y increases (line goes down)
- Mouse moving UP (toward +Z) → Canvas Y decreases (line goes up)

**Result: INVERTED!** Mouse down = line goes up.

## The Fix

Invert the Z-to-Y mapping:
```javascript
const normalizedY = 1.0 - ((rotatedZ / depth) + 0.5);
```

Now:
- World Z=+0.1 (toward camera) → Canvas Y=lower value (top) ✅
- World Z=-0.1 (away from camera) → Canvas Y=higher value (bottom) ✅

**Result: CORRECT!** Mouse down = line goes down.

## Code Changes

**File: `src/renderer.js`**
**Function: `worldToDrawingCoords()`**
**Lines: 8641-8648**

```diff
  // Convert to normalized coordinates (0-1)
+ // IMPORTANT: Invert the Z-to-Y mapping because:
+ // - Camera is at +Z looking toward -Z
+ // - Mouse moving DOWN on screen goes toward -Z (away from camera)
+ // - But canvas Y should INCREASE when moving down (canvas Y=0 is at top)
+ // - So we flip: larger Z values (toward camera) map to smaller canvas Y (top)
  const normalizedX = (rotatedX / width) + 0.5;
- const normalizedY = (rotatedZ / depth) + 0.5;
+ const normalizedY = 1.0 - ((rotatedZ / depth) + 0.5);
```

## Verification

### Test Files Created
1. `test-line-inversion.js` - Reproduces the original issue
2. `test-canvas-y-direction.js` - Tests canvas Y-axis direction
3. `test-correct-camera-setup.js` - Verifies camera coordinate system
4. `test-screen-to-canvas.js` - Screen space to canvas mapping
5. `test-visual-drawing.js` - Visual drawing behavior
6. `debug-axis-direction.js` - Debug axis directions
7. `test-fix-verification.js` - **Verifies the fix works**

### Running the Verification
```bash
node experiments/test-fix-verification.js
```

### Results

**At 0° rotation:**
- OLD: Mouse DOWN → Canvas Y decreases ❌ INVERTED
- FIXED: Mouse DOWN → Canvas Y increases ✅ CORRECT

**At 90° rotation:**
- FIXED: Line goes horizontally ✅ CORRECT (perpendicular to screen movement)

**At 180° rotation:**
- FIXED: Mouse DOWN → Canvas Y decreases (expected - paper is upside down)

**At 270° rotation:**
- FIXED: Line goes horizontally ✅ CORRECT

## Technical Details

### Coordinate Transformation Pipeline
```
1. World Position (X, Y, Z in 3D space)
   ↓
2. Local Offset (relative to paper center)
   localX = worldX - paperX
   localZ = worldZ - paperZ
   ↓
3. Paper-Local Rotation (inverse rotation)
   rotatedX = localX * cos(-rotation) - localZ * sin(-rotation)
   rotatedZ = localX * sin(-rotation) + localZ * cos(-rotation)
   ↓
4. Normalized Coordinates (0 to 1)
   normalizedX = (rotatedX / width) + 0.5
   normalizedY = 1.0 - ((rotatedZ / depth) + 0.5)  ← INVERTED HERE
   ↓
5. Canvas Pixel Coordinates
   canvasX = floor(normalizedX * 512)
   canvasY = floor(normalizedY * 512)
```

### Why This Works

1. **Correct World-to-Local Transformation**: The inverse rotation properly transforms world coordinates into the paper's local coordinate system.

2. **Z-Axis Inversion**: The `1.0 - ...` inversion accounts for the camera looking down the -Z axis, ensuring that mouse movement down (toward -Z) increases canvas Y.

3. **Rotation Independence**: The fix works at all rotation angles because the inversion is applied in paper-local space, after the rotation transformation.

## Impact

- ✅ Drawing now works correctly at all paper rotation angles (0°, 90°, 180°, 270°)
- ✅ Lines go in the direction the user expects
- ✅ No more inverted drawing behavior
- ✅ Simple, maintainable code with clear comments

## Commit

```
fix: invert Z-to-Y canvas mapping to fix drawing direction

The issue was that the camera is positioned at +Z looking toward -Z,
so when the user moves the mouse DOWN on screen, the raycast moves
toward -Z (away from camera). However, canvas Y should INCREASE
when drawing downward (since canvas Y=0 is at the top).

The fix inverts the Z-to-Y mapping so that:
- Larger Z values (toward camera) → smaller canvas Y (top of canvas)
- Smaller Z values (away from camera) → larger canvas Y (bottom of canvas)

This ensures that drawing direction matches screen movement at all
paper rotation angles.

Addresses: #105
```

## References

- Issue: #105
- PR: #108
- Commit: 86b97f4f485e56d432ae603cf3ecaba20e52d1a0
