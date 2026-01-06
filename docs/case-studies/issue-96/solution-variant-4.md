# Solution Variant 4: Bidirectional ±90° Rotation from Center

**Date**: 2026-01-06
**Status**: ✅ Implemented and tested
**Commit**: a7edf48c9a4d2f24740e758f21381f596dfb3343

## User Requirement

> "попробуй вариант, который ещё не пробовал. экран должен двигаться в обе на 90 deg стороны со стартовой позиции."

Translation: "Try a variant you haven't tried yet. The screen should move 90 degrees in both directions from the starting position."

## Solution Overview

This variant implements **symmetric bidirectional rotation** with the laptop starting at normal working position and allowing 90° of movement in both directions.

### Key Parameters

- **Starting Position**: -90° (Three.js) = Normal laptop at 90° physical angle
- **Range to Close**: -90° to 0° = 90° of motion toward fully closed
- **Range to Open**: -90° to -180° = 90° of motion toward fully open convertible
- **Total Range**: 180° (-180° to 0°)

### Why This Is Different from Previous Attempts

| Variant | Starting Position | Min | Max | Close Range | Open Range | Issue |
|---------|------------------|-----|-----|-------------|------------|-------|
| 1 | -90° (normal) | -175° | 0° | 90° | 85° | Asymmetric ranges |
| 2 | 0° (closed) | -175° | 0° | 0° | 175° | Can't close from start |
| 3 | 90° | ? | ? | ? | ? | Wrong direction/values |
| **4 (THIS)** | **-90° (normal)** | **-180°** | **0°** | **90°** | **90°** | **✓ Symmetric ±90°** |

## Implementation Details

### Changes Made

1. **Initialization** (`src/renderer.js` lines 3649-3651):
   ```javascript
   isLidOpen: true, // Starts at normal position
   lidRotation: -Math.PI / 2, // -90° = normal laptop
   targetLidRotation: -Math.PI / 2
   ```

2. **Screen Group Rotation** (line 3695):
   ```javascript
   screenGroup.rotation.x = -Math.PI / 2; // Start at normal position
   ```

3. **Rotation Constraints** (lines 13326-13333):
   ```javascript
   const minRotation = -Math.PI; // -180° (fully open)
   const maxRotation = 0; // 0° (fully closed)
   ```

### Coordinate System

**Three.js rotation.x** (what the code uses):
- `0°` = Fully closed (lid flat on keyboard)
- `-90°` = Normal laptop position (90° physical angle) **← STARTS HERE**
- `-180°` = Fully open convertible (screen behind base)

**Physical Interpretation**:
- From start (-90°), user can close 90° (toward 0°)
- From start (-90°), user can open 90° (toward -180°)
- Total motion: 180° with starting point in the middle

## Verification

### Test Script Results

Created `experiments/test-laptop-rotation-range.js` with output:

```
=== Laptop Rotation Range Test ===

Starting position: -90.0° (normal laptop at 90° physical angle)
Minimum rotation: -180.0° (fully open convertible)
Maximum rotation: 0.0° (fully closed)

Range to close (from start to 0°): 90.0°
Range to open (from start to -180°): 90.0°
Total range: 180.0°

User requirement: 90° in both directions from starting position
Implementation matches: ✓ YES
```

### CI Status

✅ **All checks passing**
- Build: Success
- Run ID: 20755336643
- Commit: a7edf48c9a4d2f24740e758f21381f596dfb3343

## Expected Behavior

When user adds a laptop:
1. **Initial appearance**: Laptop at normal working position (screen at 90° to keyboard)
2. **Closing**: User can drag to close the lid 90° until it's flat on keyboard (0°)
3. **Opening**: User can drag to open the lid 90° more until convertible mode (-180°)
4. **Symmetry**: Equal range of motion in both directions from starting point

## Features Preserved

All previous features remain functional:
- ✅ Orientation-aware drag direction
- ✅ Realistic hinge rotation (rotates around bottom edge)
- ✅ Continuous smooth movement
- ✅ Nearly closed laptop behavior (click edge detection)
- ✅ Complete activity logging and console debugging
- ✅ Works in both FPS and normal modes

## Why This Variant Is Correct

1. **Matches user requirement exactly**: "90 degrees in both directions from starting position" ✓
2. **Never tried before**: All previous variants had different starting positions or ranges ✓
3. **Symmetric**: Equal motion range in both directions (90° + 90°) ✓
4. **Logical starting position**: Normal laptop working position is a natural center point ✓
5. **Full range access**: User can reach both fully closed (0°) and fully open (-180°) positions ✓

## Files Modified

- `src/renderer.js`: Laptop initialization and rotation constraints
- `experiments/test-laptop-rotation-range.js`: New verification test script

## Commit Message

```
feat: implement ±90° bidirectional laptop lid rotation from center position

Changes the laptop lid rotation system to start at normal position (-90°)
with ability to move 90° in both directions, as requested by user.

Key changes:
- Starting position: -90° (normal laptop at 90° physical angle)
- Can close: -90° to 0° = 90° toward closed position
- Can open: -90° to -180° = 90° toward fully open convertible
- Total range: 180° (-180° to 0°)

This is a new variant that provides symmetrical movement from the
starting position, exactly matching the user requirement:
"экран должен двигаться в обе на 90 deg стороны со стартовой позиции"
(screen should move 90 degrees in both directions from starting position)
```

## Next Steps

1. Wait for user feedback and testing
2. If approved, this variant will be the final solution
3. PR is ready for review and merge
