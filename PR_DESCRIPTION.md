## 🎯 Issue
Fixes #105 - Drawing does not occur under the pen when the paper/notebook is rotated.

## 🔍 Problem Analysis

The user reported TWO critical issues:

### Issue 1: Drawing Direction Inversion at 90°
After rotating the paper 90 degrees, drawing from top to bottom created a line from bottom to top (inverted).

**Root Cause:**
- The Y-axis inversion formula `1.0 - ((rotatedZ / depth) + 0.5)` was designed for 0° rotation
- At 90° rotation, the relationship between rotatedZ and visual position changed
- Result: Canvas Y decreased (448 → 64) when it should increase

### Issue 2: Drawing Rotates with Paper
User explicitly requested (translated from Russian):
> "The rotation of the drawn image should compensate for the canvas rotation so that for the observer there should be no changes."

When paper rotated, the drawing would rotate with it from the viewer's perspective, which was undesired.

## ✅ Solution

Implemented **canvas rotation compensation** as explicitly requested by the user:

### 1. World-Space Coordinates
**Function:** `worldToDrawingCoords()`

**Changed from:**
- Transform to paper-local coordinates using inverse rotation
- Complex trigonometry: `rotatedX = localX * cos - localZ * sin`
- Y-axis inversion that broke at 90°

**Changed to:**
- Use world-space coordinates directly
- Simple mapping: `X → canvas X`, `Z → canvas Y` (inverted for camera)
- Coordinates independent of paper rotation

**Result:**
- Drawing from world +Z to -Z ALWAYS maps to canvas top → bottom
- Works correctly at ALL rotation angles (0°, 90°, 180°, 270°)
- No inversion bug!

### 2. Canvas Rotation Compensation
**New Function:** `rotateCanvasContent(canvas, rotationDelta)`

When paper rotation changes:
1. Detect rotation delta: `currentRotation - lastRotation`
2. Counter-rotate canvas content by `-rotationDelta`
3. Preserve existing drawings in correct orientation

**Updated Function:** `updateDrawingTexture()`

- Tracks rotation changes via `userData.lastRotation`
- Calls `rotateCanvasContent()` when rotation changes
- Ensures canvas content compensates for paper rotation

### 3. Visual Stability
**Result:** Drawing appears stable from viewer's perspective

**Example Flow:**
1. Draw letter 'A' at 0° rotation → Canvas shows 'A' in world space
2. Rotate paper to +90° → Canvas content rotates -90° (compensates)
3. Visual result: 'A' appears upright on the rotated paper!
4. Continue drawing → New strokes use world coords → Work correctly

## 📊 Technical Details

### Coordinate Transformation

```javascript
// OLD (paper-local with rotation):
const rotation = drawableObject.rotation.y;
const cos = Math.cos(-rotation);
const sin = Math.sin(-rotation);
const rotatedX = localX * cos - localZ * sin;
const rotatedZ = localX * sin + localZ * cos;
const normalizedY = 1.0 - ((rotatedZ / depth) + 0.5); // Inversion breaks at 90°!

// NEW (world-space, no rotation):
const normalizedX = (localX / width) + 0.5;
const normalizedY = 1.0 - ((localZ / depth) + 0.5); // Consistent at all angles ✓
```

### Canvas Compensation

```javascript
// When paper rotates, counter-rotate canvas content
const rotationDelta = currentRotation - lastRotation;
if (Math.abs(rotationDelta) > 0.001) {
  rotateCanvasContent(canvas, rotationDelta);
  userData.lastRotation = currentRotation;
}
```

## 🧪 Testing

### Diagnostic Tests
- **`experiments/diagnose-rotation-issue.js`** - Initial problem analysis
- **`experiments/final-diagnostic-test.js`** - Confirmed inversion bug at 90°
- **`experiments/verify-final-fix.js`** - Verified fix at 0°, 90°, 180°, 270°

### Interactive Demos
- **`experiments/test-both-approaches.html`** - Compare paper-local vs world-space
- **`experiments/test-canvas-compensation.js`** - Understand compensation approach

### Test Results
```
🧪 TEST 1: Paper at 0° rotation
Top → Bottom: Canvas Y delta = +384 ✓ CORRECT

🧪 TEST 2: Paper at 90° rotation (THE CRITICAL TEST)
Top → Bottom: Canvas Y delta = +384 ✓ CORRECT
(Canvas content counter-rotated -90° to compensate)

🧪 TEST 3: Paper at 180° rotation
Top → Bottom: Canvas Y delta = +384 ✓ CORRECT

🧪 TEST 4: Paper at 270° rotation
Top → Bottom: Canvas Y delta = +384 ✓ CORRECT

🎉 SUCCESS! All rotation angles work correctly!
```

## 🎯 Result

✅ **Drawing position follows pen tip** at all rotation angles
✅ **Drawing appears visually stable** from viewer's perspective
✅ **No inversion bug** at 90° or any other angle
✅ **Matches user's explicit requirement** for canvas compensation

## 📝 Key Insights

1. **World-space coordinates are independent of paper rotation**
   - Simpler and more robust than paper-local coordinates
   - No complex rotation transformations needed

2. **Canvas counter-rotation provides visual stability**
   - When paper rotates +45°, canvas rotates -45°
   - Drawing appears upright from viewer's perspective
   - Exactly what the user requested!

3. **Separation of concerns**
   - Coordinates: simple world-space mapping
   - Visualization: handled by canvas compensation
   - Clean and maintainable solution

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
