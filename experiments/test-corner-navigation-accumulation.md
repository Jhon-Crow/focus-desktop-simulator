# Corner Navigation Accumulation Bug Fix Test

## Bug Description
When pressing corner navigation shortcuts (Q, E, Z, C) multiple times in reading mode, the camera position exponentially drifts away from the book instead of staying at the same corner.

## Root Cause
The code used `+=` to accumulate shift offsets:
```javascript
bookReadingState.panOffsetX += shiftX;  // BUG
bookReadingState.panOffsetZ += shiftZ;  // BUG
```

The `intersections` are calculated based on the **current camera position** which already includes the current `panOffsetX` and `panOffsetZ`. When we calculate the shift and then ADD it to the existing offsets, we're essentially doubling the offset on each press.

## The Fix
Changed from `+=` (accumulate) to `=` (set):
```javascript
bookReadingState.panOffsetX = shiftX;  // FIXED
bookReadingState.panOffsetZ = shiftZ;  // FIXED
```

The shift calculation already gives us the absolute offset needed, not a delta to add.

## Test Case
1. Enter reading mode on a book
2. Press Q to go to top-left corner
3. Press Q again (should stay at same position, not drift left/up)
4. Press E repeatedly (should stay at top-right, not drift right/up)
5. Press Z repeatedly (should stay at bottom-left, not drift left/down)
6. Press C repeatedly (should stay at bottom-right, not drift right/down)

## Expected Behavior After Fix
- First press: Camera moves to align book corner with viewport corner ✅
- Subsequent presses of same key: Camera stays at the same position (panOffset values remain stable) ✅
- Switching between keys: Camera correctly repositions to new corner ✅

## Evidence from User's Activity Log
Before fix (exponential growth):
- 1st E press: panOffset.x = -0.723
- 2nd E press: panOffset.x = -0.741
- 3rd E press: panOffset.x = -0.778
- 8th E press: panOffset.x = -1.884
- 9th E press: panOffset.x = -3.064
- Final E press: panOffset.x = -649.159 (!)

After fix, repeated presses should maintain stable panOffset values.
