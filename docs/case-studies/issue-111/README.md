# Case Study: Issue #111 - Quick Navigation Shortcuts in Reading Mode

## Overview

This case study documents the implementation and debugging process for adding quick navigation shortcuts (Q/E/Z/C) to align book corners with screen corners in reading mode.

## Issue Description

**Original Request:** Add keyboard shortcuts for quick navigation in book reading mode:
- Q: Align top-left corner of book with top-left corner of screen
- E: Align top-right corner of book with top-right corner of screen
- Z: Align bottom-left corner of book with bottom-left corner of screen
- C: Align bottom-right corner of book with bottom-right corner of screen

**Challenge:** Navigation must work correctly at any zoom level (0.3x to 2.0x) and properly account for camera perspective, field of view, and aspect ratio.

## Files in This Case Study

### Activity Logs (User Testing)
- `activity-log-2026-01-06T15-12-47-436Z.txt` - First user test showing shortcuts not reaching corners
- `activity-log-2026-01-06T15-48-20-400Z.txt` - Second user test revealing inverted controls

### Solution Draft Logs (Development Sessions)
- `solution-draft-log-session-1.txt` - Initial implementation with fixed offsets (1238KB)
- `solution-draft-log-session-2.txt` - Raycasting implementation with Z-axis bug (1221KB)
- `solution-draft-log-session-3.txt` - Investigation and logging improvements (4383KB)

### Analysis Documents
- `root-cause-analysis.md` - Comprehensive root cause analysis with timeline and technical details
- `README.md` - This file

## Key Findings

### Problem 1: Fixed Offsets Don't Work
**Symptom:** Corners appeared in middle of screen, not at edges
**Cause:** Fixed offset calculations didn't account for camera FOV, distance, or aspect ratio
**Solution:** Switched to dynamic raycasting approach

### Problem 2: Inverted Vertical Controls (Critical Bug)
**Symptom:** Q/E (top) moved camera down, Z/C (bottom) moved camera up
**Cause:** Incorrect Z-axis coordinate interpretation for camera perspective
**Solution:** Swapped Z-coordinate calculations for top/bottom corners
**Details:** See `root-cause-analysis.md`

### Problem 3: Completely Reversed Key Mapping (Critical Bug - Session 4)
**Symptom:** All keys mapped to opposite corners:
- Q (top-left) → went to bottom-right
- E (top-right) → went to bottom-left
- Z (bottom-left) → went to top-right
- C (bottom-right) → went to top-left

**Cause:** Incorrect NDC (Normalized Device Coordinates) interpretation. Three.js uses Y: -1 for top and Y: +1 for bottom, opposite of typical screen coordinates.

**Solution:** Fixed viewport corner definitions:
- Top-left: `(-1, -1)` not `(-1, +1)`
- Top-right: `(+1, -1)` not `(+1, +1)`
- Bottom-left: `(-1, +1)` not `(-1, -1)`
- Bottom-right: `(+1, +1)` not `(+1, -1)`

### Problem 4: Left-Right Swap (Critical Bug - Sessions 5 & 6)
**Symptom:** Right keys (E, C) moved camera to left corners, left keys (Q, Z) moved camera to right corners

**Cause:** Camera movement direction is inverse to viewport appearance. When camera moves in +X direction (right), the scene appears to move LEFT in the viewport (and vice versa). The shift calculation `shiftX = bookCornerX - intersectionX` was correct for positioning but incorrect for camera movement direction.

**Root Cause Analysis:**
- WASD controls show: KeyA (left) uses `panOffsetX -= speed`, KeyD (right) uses `panOffsetX += speed`
- When `panOffsetX` increases (camera moves right in +X), the book appears to shift LEFT in viewport
- When `panOffsetX` decreases (camera moves left in -X), the book appears to shift RIGHT in viewport
- **This is an inverse relationship!**

**Solution:** Invert X-axis shift calculation:
```js
// Before (WRONG):
const shiftX = bookCornerX - intersectionX;

// After (CORRECT):
const shiftX = intersectionX - bookCornerX;  // Inverted X for camera movement
```

**Attempts:**
1. First fix (commit 6562cce): Attempted to swap left/right book corner calculations - FAILED
2. Second fix (commit 868aabb): Reverted to original corner calculations - STILL FAILED
3. Third fix (commit e91c397): Identified true root cause - inverted camera movement direction ✅

### Problem 5: Jumpy Camera on Repeated Presses (Critical Bug - Session 9)
**Symptom:** After Bug #4 was fixed, pressing the same corner shortcut repeatedly caused the camera to jump back and forth between different positions instead of staying at the target corner.

**Root Cause:** The intersection calculations depended on the **current camera position**. When the camera moved after the first press, subsequent presses calculated intersections from a different viewpoint, giving different shift values.

**Solution:** Temporarily reset camera to centered position (panOffset = 0, 0) **before** calculating intersections, then restore the camera position. This ensures intersections are always calculated from the same reference point.

### Problem 6: WASD Navigation Hitting Invisible Wall (Critical Bug - Session 10)
**Symptom:** Users couldn't reach the beginning of text using WASD controls. The dynamic camera boundary constraints added in Session 8 were too restrictive.

**Root Cause:** The dynamic constraint formula `maxPanX = bookHalfWidth + (visibleWidth / 2)` calculated constraints based on book dimensions and viewport size, but this created overly restrictive limits that prevented users from panning to areas they needed to read.

**Solution:** Removed dynamic constraints from WASD controls, reverted to the original fixed ±1.5 limits that allow full navigation. Also removed constraints from corner shortcuts since those calculate exact positions that shouldn't be clamped.

### Problem 7: Exponential Camera Drift (Critical Bug - Session 7)
**Symptom:** When pressing any corner shortcut repeatedly, camera exponentially drifted away from book instead of staying at the corner. Example: pressing E 20 times caused panOffset.x to reach -649,159 (should be ~-0.7).

**Root Cause:** Code used `+=` to accumulate shift offsets:
```js
bookReadingState.panOffsetX += shiftX;  // BUG
bookReadingState.panOffsetZ += shiftZ;  // BUG
```

The intersections are calculated based on **current camera position** which already includes current `panOffsetX` and `panOffsetZ`. When we calculate the shift and then ADD it to the existing offsets, we're essentially doubling the offset on each press:

- Press 1: `offset = 0 + shift1` = shift1 ✅
- Press 2: Camera at shift1, intersections reflect this. New shift ≈ shift1. Result: `offset = shift1 + shift1` = 2×shift1 ❌
- Press 3: Camera at 2×shift1. New shift ≈ 2×shift1. Result: `offset = 2×shift1 + 2×shift1` = 4×shift1 ❌
- Press 4: `offset ≈ 8×shift1` ❌
- Exponential growth continues...

**Solution:** Changed from `+=` (accumulate) to `=` (set):
```js
bookReadingState.panOffsetX = shiftX;  // FIXED
bookReadingState.panOffsetZ = shiftZ;  // FIXED
```

The shift calculation already gives us the **absolute offset needed**, not a delta to add.

**Evidence from Activity Log:**
- 1st E press: panOffset.x = -0.723 ✅
- 2nd E press: panOffset.x = -0.741 (drift starts)
- 3rd E press: panOffset.x = -0.778
- 8th E press: panOffset.x = -1.884
- 9th E press: panOffset.x = -3.064
- 20th E press: panOffset.x = -649.159 (!)

After fix: Repeated presses maintain stable panOffset values ✅

## Technical Approach

### Raycasting Solution
Uses Three.js raycasting to unproject viewport corners onto book plane:

1. Define viewport corners in NDC (Normalized Device Coordinates):
   - Top-left: `(-1, -1)` (left + top)
   - Top-right: `(+1, -1)` (right + top)
   - Bottom-left: `(-1, +1)` (left + bottom)
   - Bottom-right: `(+1, +1)` (right + bottom)
   - Note: In Three.js, Y: -1 is top, Y: +1 is bottom
2. Create horizontal plane at book's Y level
3. Cast rays from camera through viewport corners
4. Find intersection points on book plane
5. Calculate camera shift: `bookCorner - viewportCornerIntersection`
6. Apply shift to pan offsets

**Advantages:**
- Mathematically exact
- Automatically handles all camera transformations
- Works at any zoom level
- Adapts to aspect ratio changes

## User Feedback Timeline

1. **Session 1 Feedback:** "Shortcuts barely move to the correct page, not reaching corners"
2. **Session 2 Feedback:** "Controls inverted - buttons for bottom corners go up, buttons for top corners go down"
3. **Session 2 Positive:** "Top positions practically ideal (top-left slightly low)"
4. **Session 3 Request:** "Create case study with timeline, root cause analysis, and data compilation"
5. **Session 4 Feedback:** "Keys completely mixed up - Q→bottom-right, E→bottom-left, Z→top-right, C→top-left" + "Bottom positions too far"
6. **Session 5 Feedback (after commit 6562cce):** "Nothing changed, right keys move left, left keys move right"
7. **Session 6 Feedback (after commit 868aabb):** "Nothing changed, right keys move left, left keys move right" (same issue persisted)
8. **Session 7 Feedback (after commit e91c397):** "First press works ~correctly, but repeat presses cause exponential camera drift away from book"

## Metrics

### Development Cost (Anthropic API)
- Session 1: $0.59 (Public estimate: $1.09, -46% difference)
- Session 2: $1.02 (Public estimate: $1.51, -32% difference)
- Session 3: $1.32 (Public estimate: $1.99, -33% difference)
- **Total:** ~$2.93 actual cost (~$4.59 public estimate)

### Code Changes
- **Files modified:** 1 (src/renderer.js)
- **Lines changed:** ~150 lines added/modified
- **Key commits:** 3 (initial implementation, raycasting fix, Z-axis inversion fix)

### Iterations
- **Implementation attempts:** 7
- **User tests:** 6+ documented
- **Critical bugs found:** 7 (fixed offsets, Z-axis inversion, NDC coordinate mapping, X-axis camera movement inversion, exponential camera drift, jumpy camera, overly restrictive WASD constraints)

## Resolution Status

- ✅ Fixed: Navigation shortcuts functional
- ✅ Fixed: Z-axis inversion corrected (Session 3)
- ✅ Fixed: NDC coordinate mapping (Session 4)
- ✅ Fixed: X-axis camera movement direction inversion (Session 6)
- ✅ Fixed: Exponential camera drift on repeated presses (Session 7)
- ✅ Fixed: Jumpy camera on repeated presses (Session 9)
- ✅ Fixed: WASD navigation hitting invisible wall (Session 10)
- ✅ Implemented: Enhanced camera jump logging with viewport intersection data
- ✅ Documented: Comprehensive case study
- ⏳ Pending: Final user testing to verify all functionality works as expected

## Lessons for Future Development

1. **Coordinate systems require explicit documentation** - Camera orientation and perspective must be clearly stated
2. **NDC coordinates vary by framework** - Three.js uses Y: -1 (top) to +1 (bottom), opposite of screen coordinates
3. **Camera movement is inverse to viewport appearance** - Moving camera right makes scene appear left (critical insight)
4. **Accumulation vs. assignment matters** - Using `+=` vs `=` can cause exponential feedback loops when updates depend on current state
5. **Test early, test often** - All bugs would have been caught immediately with basic corner navigation test including repeated presses
6. **Activity logging is invaluable** - Detailed logs enabled quick identification of Z-axis inversion and exponential drift patterns
7. **User testing reveals real issues** - Mathematical correctness ≠ correct user experience
8. **Case studies pay dividends** - Systematic analysis prevents similar bugs in the future
9. **First principles analysis beats trial-and-error** - Understanding WASD controls revealed the true camera movement direction
10. **Test edge cases** - Repeated actions can expose accumulation bugs that single tests miss

## Related Links

- Issue: https://github.com/Jhon-Crow/focus-desktop-simulator/issues/111
- Pull Request: https://github.com/Jhon-Crow/focus-desktop-simulator/pull/112
- Three.js Raycasting Documentation: https://threejs.org/docs/#api/en/core/Raycaster
