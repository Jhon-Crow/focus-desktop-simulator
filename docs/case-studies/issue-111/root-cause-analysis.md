# Root Cause Analysis: Issue #111 - Corner Navigation Inverted Controls

## Executive Summary

**Issue:** Quick navigation shortcuts (Q/E/Z/C) in reading mode had inverted vertical controls. Pressing Q/E (intended for top corners) moved camera down, while pressing Z/C (intended for bottom corners) moved camera up.

**Root Cause:** Incorrect Z-axis coordinate interpretation when mapping book corners from world space to viewport corners. The code incorrectly assumed smaller Z values represented "top" corners, when in fact larger Z values are "top" from the camera's perspective.

**Fix:** Swapped the Z-coordinate calculations for top and bottom corners, aligning them correctly with the camera's viewing direction.

## Timeline of Events

### Session 1 (2026-01-06T14:54:12Z)
- **Initial Implementation:** First version of corner navigation feature
- **Approach:** Used fixed offset values based on calculated visible area
- **Problem:** Offsets didn't account for camera's field of view, zoom distance, or screen aspect ratio
- **Result:** Corners were approximately in middle of screen, not at viewport edges

### Session 2 (2026-01-06T15:18:01Z)
- **User Feedback:** Shortcuts not working at any zoom level, neither normal nor zoomed
- **New Approach:** Switched to dynamic calculation using Three.js raycasting
- **Implementation:** Unproject viewport corners to find exact intersections with book plane
- **Issue Introduced:** Z-axis inversion bug introduced during implementation
- **Result:** Mathematically correct raycasting, but wrong corner definitions

### Session 3 (2026-01-06T15:35:39Z)
- **User Feedback:** Controls inverted - top buttons go down, bottom buttons go up
- **Activity Log Evidence:** User provided activity-log-2026-01-06T15-48-20-400Z.txt
- **Positive Finding:** Top corners "practically ideal" (with minor top-left offset)
- **Request:** Add comprehensive camera jump logging, create case study

### Session 4 (Current - 2026-01-06T15:51:57Z)
- **Analysis:** Deep dive into activity logs and code
- **Root Cause Identified:** Z-axis coordinate misinterpretation
- **Fix Applied:** Corrected Z-coordinate calculations for all corners
- **Documentation:** Created comprehensive case study with timeline and analysis

## Root Cause Analysis

### Camera Setup Context

The camera in reading mode is positioned:
- **X position:** `bookWorldPos.x + panOffsetX`
- **Y position:** `bookWorldPos.y + zoomDistance` (e.g., +0.85 above book)
- **Z position:** `bookWorldPos.z + 0.65 + panOffsetZ` (behind the book)
- **Orientation:** Looking down at an angle towards the book (towards -Z direction)

### The Misconception

The original incorrect code (lines 11587-11594):

```javascript
const bookTopLeftZ = bookWorldPos.z - bookHalfDepth;     // WRONG
const bookTopRightZ = bookWorldPos.z - bookHalfDepth;    // WRONG
const bookBottomLeftZ = bookWorldPos.z + bookHalfDepth;  // WRONG
const bookBottomRightZ = bookWorldPos.z + bookHalfDepth; // WRONG
```

This assumed:
- **Smaller Z** (bookWorldPos.z - bookHalfDepth) = "top" of book
- **Larger Z** (bookWorldPos.z + bookHalfDepth) = "bottom" of book

### The Reality

From the camera's perspective (positioned at Z = bookWorldPos.z + 0.65, looking towards -Z):
- **Objects with larger Z** are CLOSER to camera → appear at TOP of viewport
- **Objects with smaller Z** are FARTHER from camera → appear at BOTTOM of viewport

### Evidence from Activity Logs

Analysis of `activity-log-2026-01-06T15-48-20-400Z.txt`:

| Key Pressed | Intended Corner | Camera Z Position | Pan Offset Z | Actual Result |
|-------------|----------------|-------------------|--------------|---------------|
| KeyC | Bottom-right | 1.128 | -0.903 | Top-right (inverted) |
| KeyZ | Bottom-left | 1.309 | -0.722 | Top-left (inverted) |
| KeyE | Top-right | 2.154 | +0.123 | Bottom-right (inverted) |
| KeyQ | Top-left | 2.428 | +0.397 | Bottom-left (inverted) |

**Observation:** Keys intended for "bottom" corners produced SMALLER Z values (1.1-1.3), while keys for "top" corners produced LARGER Z values (2.1-2.4). This confirms the inversion.

### The Correct Implementation

Fixed code:

```javascript
const bookTopLeftZ = bookWorldPos.z + bookHalfDepth;     // Top = larger Z (closer to camera)
const bookTopRightZ = bookWorldPos.z + bookHalfDepth;    // Top = larger Z (closer to camera)
const bookBottomLeftZ = bookWorldPos.z - bookHalfDepth;  // Bottom = smaller Z (farther from camera)
const bookBottomRightZ = bookWorldPos.z - bookHalfDepth; // Bottom = smaller Z (farther from camera)
```

### Why This Happened

1. **Coordinate System Ambiguity:** In many 2D contexts, +Y is "down" and -Y is "up". But in 3D world space with a camera looking down from behind, the Z-axis determines what appears at top/bottom of screen.

2. **Abstraction Leak:** The raycasting implementation was mathematically correct, but the semantic mapping of "top" and "bottom" corners to world-space Z coordinates was inverted.

3. **Insufficient Testing:** The raycasting approach was tested for mathematical correctness, but not verified against expected directional behavior.

## Resolution

### Changes Made

1. **renderer.js:11588-11594**: Swapped Z-coordinate calculations
   - Top corners now use `bookWorldPos.z + bookHalfDepth`
   - Bottom corners now use `bookWorldPos.z - bookHalfDepth`

2. **renderer.js:11577-11592**: Updated comments to explain coordinate system
   - Documented camera position and orientation
   - Clarified which Z values represent top vs. bottom from camera's perspective

### Remaining Work

**Fine-tuning top-left corner:** User reported top-left corner was "slightly lower than needed" (немного ниже чем надо). This may require minor adjustment to the Y-axis calculation or corner offset, but should be verified after fixing the primary Z-axis inversion.

## Lessons Learned

1. **Coordinate System Documentation:** Always document camera orientation and coordinate system conventions explicitly
2. **Semantic Clarity:** Use clear variable names that reflect the camera's perspective, not abstract geometric terms
3. **Activity Logging:** Comprehensive logging proved invaluable for debugging spatial issues
4. **Incremental Testing:** Test directional behavior at each implementation step, not just mathematical correctness

## References

- Issue: https://github.com/Jhon-Crow/focus-desktop-simulator/issues/111
- Pull Request: https://github.com/Jhon-Crow/focus-desktop-simulator/pull/112
- Activity Logs: `./activity-log-*.txt`
- Solution Draft Logs: `./solution-draft-log-session-*.txt`
- Three.js Raycasting: https://threejs.org/docs/#api/en/core/Raycaster
- Three.js NDC Coordinates: https://threejs.org/docs/#api/en/math/Vector2

## Appendix: Three.js Coordinate Systems

### Normalized Device Coordinates (NDC)
- X: -1 (left) to +1 (right)
- Y: -1 (bottom) to +1 (top)
- Z: -1 (near) to +1 (far)

### World Space (in this application)
- X: left (-) to right (+)
- Y: down (-) to up (+)
- Z: varies based on camera orientation
  - Camera at Z = bookWorldPos.z + 0.65
  - Looking towards -Z (decreasing Z values)
  - Therefore: larger Z = closer to camera = top of viewport
  - Therefore: smaller Z = farther from camera = bottom of viewport
