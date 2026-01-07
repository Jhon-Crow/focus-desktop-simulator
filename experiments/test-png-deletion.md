# Test Plan for PNG Deletion Fix

## Issue
PNG images from paper sheets and notebooks were not being deleted when the corresponding object was deleted.

## Root Cause
When drawings are saved, they are saved to TWO locations:
1. App data storage (for state persistence)
2. Custom folder (user-specified)

However, the deletion logic only deleted from app data storage, not from custom folders.

## Solution Implementation

### Changes Made

1. **src/renderer.js - saveDrawingToFile() (lines ~8897-8901)**
   - Store custom folder path and file path in `drawableObject.userData` when successfully saving to custom folder
   - Added fields: `customFolderPath` and `customFilePath`

2. **src/renderer.js - deleteDrawingFile() (lines ~8975-9003)**
   - Enhanced to delete from BOTH locations:
     - App data storage (existing functionality)
     - Custom folder (NEW functionality)
   - Added check for `customFilePath` existence
   - Added proper error handling for both deletion operations

3. **src/main.js - Added delete-drawing-file IPC handler (lines ~1209-1226)**
   - New IPC handler to delete PNG files from custom folders
   - Includes file existence check before deletion
   - Returns success even if file doesn't exist (idempotent operation)
   - Proper error handling and logging

4. **src/preload.js - Added deleteDrawingFile API (line 36)**
   - Exposed `deleteDrawingFile` function to renderer process
   - Maps to `delete-drawing-file` IPC channel

## Test Scenarios

### Scenario 1: Object with drawing in custom folder is deleted
**Setup:**
1. Create paper sheet or notebook
2. Draw on it with pen tool
3. Have custom save folder configured in pen settings
4. Drawing is saved to both app data AND custom folder

**Action:**
Delete the paper sheet or notebook

**Expected Result:**
- PNG file deleted from app data storage ✓
- PNG file deleted from custom folder ✓
- Console logs confirm both deletions

### Scenario 2: Object with drawing only in app data is deleted
**Setup:**
1. Create paper sheet or notebook
2. Draw on it with pen tool
3. NO custom save folder configured
4. Drawing only saved to app data

**Action:**
Delete the paper sheet or notebook

**Expected Result:**
- PNG file deleted from app data storage ✓
- No error attempting custom folder deletion (check skipped)

### Scenario 3: Clear all objects
**Setup:**
1. Create multiple paper sheets and notebooks
2. Draw on some of them
3. Mix of objects with/without custom folder saves

**Action:**
Use "Clear All Objects" function

**Expected Result:**
- All PNG files deleted from both locations
- No errors for objects without custom folder saves

### Scenario 4: File already deleted manually
**Setup:**
1. Create paper sheet with drawing in custom folder
2. Manually delete the PNG file from custom folder

**Action:**
Delete the paper sheet in the app

**Expected Result:**
- No error thrown
- Returns success (idempotent operation)
- Console logs "file not found" message

## Manual Testing Steps

Since this is an Electron app, automated testing would require:
1. Install dependencies: `npm install`
2. Run app: `npm start`
3. Test each scenario above manually

## Code Review Checklist

- [x] Saves store file paths for later deletion
- [x] Deletion handles both storage locations
- [x] IPC handler properly exposed in preload.js
- [x] File existence check before deletion
- [x] Error handling for permission issues
- [x] Idempotent deletion (safe to call multiple times)
- [x] Console logging for debugging
- [x] No breaking changes to existing functionality
- [x] Follows existing code patterns in the project

## Potential Edge Cases Handled

1. **File doesn't exist**: Handled gracefully, returns success
2. **Permission denied**: Error caught and logged, doesn't crash app
3. **Custom folder not configured**: Check skipped, no error
4. **Path doesn't exist**: File existence check prevents error
5. **Empty file path**: Handler would return success (file doesn't exist)

## Notes

- The fix is backward compatible - old objects without `customFilePath` simply skip the custom folder deletion
- State persistence is maintained through `saveState()` call in parent functions
- Physics cleanup and other object removal logic remains unchanged
