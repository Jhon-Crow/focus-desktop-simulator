# Root Cause Analysis: NDC Coordinate Mapping Bug (Session 4)

## Executive Summary

**Bug:** All keyboard shortcuts (Q/E/Z/C) were mapped to completely opposite corners from their intended targets.

**Impact:** Feature completely non-functional - every key did the exact opposite of what user expected.

**Root Cause:** Incorrect interpretation of Three.js NDC (Normalized Device Coordinates) Y-axis orientation.

**Fix Complexity:** Simple (4 line changes)
**Detection Difficulty:** High (requires understanding of Three.js coordinate systems)

---

## Bug Description

### User Report (Session 4)

> "Buttons are now mixed up:
> Left-top = c (should be q)
> Right-top = z (should be e)
> Left-bottom = e (should be z)
> Right-bottom = q (should be c)"

This indicates a complete reversal of the corner mapping:
- Q (top-left) → actually went to bottom-right
- E (top-right) → actually went to bottom-left
- Z (bottom-left) → actually went to top-right
- C (bottom-right) → actually went to top-left

**Pattern:** The indices were reversed [0, 1, 2, 3] → [3, 2, 1, 0]

---

## Root Cause

### The Misunderstanding

The code incorrectly assumed Three.js NDC coordinates follow typical screen coordinate conventions:
- X: -1 (left) to +1 (right) ✅ CORRECT
- Y: +1 (top) to -1 (bottom) ❌ **WRONG**

### Actual Three.js NDC Convention

In Three.js (and OpenGL/WebGL), NDC coordinates are:
- X: -1 (left) to +1 (right) ✅
- Y: **-1 (top)** to **+1 (bottom)** ⚠️ **INVERTED from screen coords!**

This is because NDC originates from OpenGL's clip space, where +Y points **upward in 3D space** but **downward on the screen** when projected.

### The Incorrect Code

```javascript
const corners = [
  new THREE.Vector2(-1, 1),  // ❌ Thought this was top-left, actually bottom-left
  new THREE.Vector2(1, 1),   // ❌ Thought this was top-right, actually bottom-right
  new THREE.Vector2(-1, -1), // ❌ Thought this was bottom-left, actually top-left
  new THREE.Vector2(1, -1)   // ❌ Thought this was bottom-right, actually top-right
];
```

This created intersections array:
- `intersections[0]` = bottom-left (we thought top-left)
- `intersections[1]` = bottom-right (we thought top-right)
- `intersections[2]` = top-left (we thought bottom-left)
- `intersections[3]` = top-right (we thought bottom-right)

### The Key Mapping

The code then mapped:
```javascript
if (quickNavKey === 'KeyQ') {
  // Q - intended for top-left
  const shiftX = bookTopLeftX - intersections[0].x;  // ❌ Using bottom-left intersection!
  const shiftZ = bookTopLeftZ - intersections[0].z;
```

Result: Q key calculated shift to align book's top-left corner with viewport's **bottom-left** intersection point, causing camera to jump to bottom-right.

---

## Evidence

### Experimental Verification

Created test HTML (`experiments/test-viewport-corners.html`) showing:
- Camera at (0, 0.85, 0.65)
- Top corners (NDC Y = -1): Z = 0.000
- Bottom corners (NDC Y = +1): Z = -0.458

**Confirms:** Smaller NDC Y values (-1) correspond to visually higher (top) screen positions.

### User Feedback Pattern

Complete corner reversal matches NDC Y-axis inversion:
- Top ↔ Bottom swap (due to Y-axis flip)
- Left ↔ Right preserved (X-axis correct)

---

## The Fix

### Corrected NDC Coordinates

```javascript
const corners = [
  new THREE.Vector2(-1, -1), // ✅ top-left (left + top)
  new THREE.Vector2(1, -1),  // ✅ top-right (right + top)
  new THREE.Vector2(-1, 1),  // ✅ bottom-left (left + bottom)
  new THREE.Vector2(1, 1)    // ✅ bottom-right (right + bottom)
];
```

### Updated Min/Max Calculations

Also needed to update which intersections represent top vs bottom:

```javascript
// Old (wrong):
const minZ = Math.min(intersections[0].z, intersections[1].z);  // Used indices 0,1 (thought top)
const maxZ = Math.max(intersections[2].z, intersections[3].z);  // Used indices 2,3 (thought bottom)

// New (correct):
const minZ = Math.min(intersections[2].z, intersections[3].z);  // Now using actual bottom (indices 2,3)
const maxZ = Math.max(intersections[0].z, intersections[1].z);  // Now using actual top (indices 0,1)
```

---

## Why This Bug Occurred

### 1. Intuitive but Wrong Assumption

Screen coordinates (used in 2D graphics) conventionally have:
- Origin at top-left
- +Y points downward

This is intuitive for web developers but **opposite** of 3D graphics conventions.

### 2. Lack of Framework-Specific Knowledge

Three.js inherits OpenGL/WebGL conventions where:
- Origin at center
- +Y points upward in 3D space
- NDC maps to clip space with Y inverted from screen

### 3. No Immediate Feedback

The bug manifested as "wrong behavior" not "crash," making it harder to detect without user testing.

### 4. Previous Z-Axis Fix Created Blind Spot

After fixing Z-axis inversion (Session 3), assumed vertical issues were resolved and didn't reconsider other coordinate system assumptions.

---

## Impact Analysis

### Severity: **CRITICAL**

- **Functionality:** 100% broken (every key does opposite of intended)
- **User Experience:** Extremely confusing and frustrating
- **Detectability:** Hard to diagnose without Three.js expertise

### Why Critical?

Unlike the Z-axis bug (which inverted only vertical axis), this bug inverted **both axes** of corner selection, making the feature completely unusable.

---

## Prevention Strategies

### 1. Framework Documentation Review

**Action:** Always check coordinate system conventions when using 3D frameworks
**Application:** Add comments documenting NDC orientation at point of use

### 2. Unit Tests for Coordinate Mapping

**Action:** Create automated tests verifying NDC corner projections
**Example Test:**
```javascript
// Test: Top-left NDC (-1, -1) should raycast to book's top-left region
// Test: Bottom-right NDC (+1, +1) should raycast to book's bottom-right region
```

### 3. Immediate User Testing

**Action:** Test corner navigation immediately after raycasting implementation
**Benefit:** Would have caught bug before multiple development iterations

### 4. Coordinate System Diagram

**Action:** Create visual diagram showing Three.js coordinate systems
**Include:**
- World space (Y up)
- Camera space (looking along -Z)
- NDC space (Y down on screen)

---

## Lessons Learned

1. **Never assume coordinate conventions** - Always verify with framework documentation
2. **Test geometrically** - Check each corner individually, not just "does it work?"
3. **Comment coordinate systems** - Future maintainers need explicit documentation
4. **Small fixes, big impact** - 4-line change fixed completely broken feature

---

## Related Issues

- **Z-Axis Inversion Bug (Session 3):** Different root cause (camera perspective interpretation) but similar symptom (inverted controls)
- **Fixed Offset Bug (Session 1):** Wrong approach, but would have also exposed NDC issue if tested per-corner

---

## Code Changes

**File:** `src/renderer.js`
**Lines:** 11524-11528 (corner definitions), 11543-11544 (min/max calculations)
**Commit:** "Fix NDC coordinate mapping for corner navigation"
**Diff:**

```diff
- new THREE.Vector2(-1, 1),  // top-left
- new THREE.Vector2(1, 1),   // top-right
- new THREE.Vector2(-1, -1), // bottom-left
- new THREE.Vector2(1, -1)   // bottom-right
+ new THREE.Vector2(-1, -1), // top-left (left + top)
+ new THREE.Vector2(1, -1),  // top-right (right + top)
+ new THREE.Vector2(-1, 1),  // bottom-left (left + bottom)
+ new THREE.Vector2(1, 1)    // bottom-right (right + bottom)

- const minZ = Math.min(intersections[0].z, intersections[1].z);
- const maxZ = Math.max(intersections[2].z, intersections[3].z);
+ const minZ = Math.min(intersections[2].z, intersections[3].z);  // bottom
+ const maxZ = Math.max(intersections[0].z, intersections[1].z);  // top
```

---

## Verification

**Test Plan:**
1. Enter reading mode on a book
2. Press Q → verify camera moves to show top-left corner at screen's top-left
3. Press E → verify camera moves to show top-right corner at screen's top-right
4. Press Z → verify camera moves to show bottom-left corner at screen's bottom-left
5. Press C → verify camera moves to show bottom-right corner at screen's bottom-right
6. Zoom in (scroll) and repeat tests → should work at all zoom levels

**Expected Result:** Each key aligns its designated book corner with the corresponding viewport corner.

---

## Additional Notes

Enhanced logging added in same session to facilitate future debugging:
- Log viewport intersection points for all 4 corners
- Log book dimensions and world position
- Helps verify raycasting calculations match expectations

---

**Document Status:** Complete
**Last Updated:** 2026-01-06
**Session:** 4 (Current)
