# Test: Book and Magazine State Persistence

## Purpose
Verify that books and magazines remain open after application reload.

## Related Issues
- #98: Книга закрывается после перезагрузки (должна оставаться открытой)

## Changes Made

### Problem
Books and magazines would always start in a closed state after reload, even if they were open before the reload. This happened because the `isOpen` state was not being saved to or restored from `desk-state.json`.

### Root Cause
The state persistence system had two parts:
1. **Saving state** in `saveState()` function (lines 22866-23100)
2. **Restoring state** in `loadState()` function (lines 23235-23650+)

For both books and magazines, the `isOpen` boolean was never written to the state file during save, and therefore could not be restored during load.

### Solution
Added persistence for the `isOpen` state in four locations:

#### 1. Save book open state (src/renderer.js:22956)
```javascript
data.currentPage = obj.userData.currentPage || 0;
// Save open/close state
data.isOpen = obj.userData.isOpen || false;
break;
```

#### 2. Restore book open state (src/renderer.js:23440-23451)
```javascript
// Restore open/close state
if (objData.isOpen) {
  obj.userData.isOpen = true;
  const closedGroup = obj.getObjectByName('closedBook');
  const openGroup = obj.getObjectByName('openBook');
  if (closedGroup) closedGroup.visible = false;
  if (openGroup) {
    openGroup.visible = true;
    // Update pages to show content after PDF loads
    setTimeout(() => updateBookPages(obj), 100);
  }
}
```

#### 3. Save magazine open state (src/renderer.js:22986)
```javascript
data.currentPage = obj.userData.currentPage || 0;
// Save open/close state
data.isOpen = obj.userData.isOpen || false;
break;
```

#### 4. Restore magazine open state (src/renderer.js:23539-23550)
```javascript
// Restore open/close state
if (objData.isOpen) {
  obj.userData.isOpen = true;
  const closedGroup = obj.getObjectByName('closedMagazine');
  const openGroup = obj.getObjectByName('openMagazine');
  if (closedGroup) closedGroup.visible = false;
  if (openGroup) {
    openGroup.visible = true;
    // Update pages to show content after PDF loads
    setTimeout(() => updateMagazinePages(obj), 100);
  }
}
```

## Manual Testing Steps

### Prerequisites
1. Build and run the application: `npm start`
2. Have at least one book and one magazine on the desk

### Test Case 1: Book State Persistence
1. Open a book by clicking on it
2. Navigate to a specific page (e.g., page 5)
3. Leave the book open
4. Close and restart the application (Ctrl+R or close/reopen)
5. **Expected**: The book should still be open and showing the same page
6. **Before fix**: The book would be closed

### Test Case 2: Magazine State Persistence
1. Open a magazine by clicking on it
2. Navigate to a specific page
3. Leave the magazine open
4. Close and restart the application
5. **Expected**: The magazine should still be open and showing the same page
6. **Before fix**: The magazine would be closed

### Test Case 3: Mixed State
1. Open book A
2. Leave magazine B closed
3. Open magazine C
4. Leave book D closed
5. Restart the application
6. **Expected**:
   - Book A should be open
   - Magazine B should be closed
   - Magazine C should be open
   - Book D should be closed

### Test Case 4: Closed State Persistence
1. Open a book
2. Close it again (click to close)
3. Restart the application
4. **Expected**: The book should remain closed
5. This tests that `isOpen: false` is correctly saved

## Verification Checklist

- [ ] Books remain open after reload
- [ ] Magazines remain open after reload
- [ ] Books remain closed after reload if they were closed
- [ ] Magazines remain closed after reload if they were closed
- [ ] Current page is preserved for open books
- [ ] Current page is preserved for open magazines
- [ ] PDF content is displayed correctly on open books after reload
- [ ] PDF content is displayed correctly on open magazines after reload
- [ ] No console errors during state save/load
- [ ] Performance is not impacted (isOpen is a simple boolean)

## Technical Details

### State File Location
The state is saved to: `~/.config/focus-desktop-simulator/desk-state.json`

### State Structure (for books)
```json
{
  "objects": [
    {
      "type": "books",
      "isOpen": true,
      "currentPage": 5,
      "bookTitle": "My Book",
      "pdfPath": "...",
      ...
    }
  ]
}
```

### State Structure (for magazines)
```json
{
  "objects": [
    {
      "type": "magazine",
      "isOpen": true,
      "currentPage": 3,
      "magazineTitle": "Tech Magazine",
      "pdfPath": "...",
      ...
    }
  ]
}
```

## Notes

- The fix uses `setTimeout(() => updateBookPages(obj), 100)` to ensure PDF loading has started before updating pages
- The same pattern is used for both books and magazines
- The visibility of the `closedBook`/`closedMagazine` and `openBook`/`openMagazine` groups is properly managed
- This fix follows the existing pattern used in `toggleBookOpen()` and `toggleMagazineOpen()` functions

## Related Files

- `src/renderer.js` - Main renderer file with state persistence logic
  - Lines 3911+: `createBooks()` - Book initialization
  - Lines 4125+: `createMagazine()` - Magazine initialization
  - Lines 20086-20118: `toggleBookOpen()` - Book open/close logic
  - Lines 20680-20708: `toggleMagazineOpen()` - Magazine open/close logic
  - Lines 22866-23100: `saveState()` - State saving logic
  - Lines 23235-23650+: `loadState()` - State restoration logic
