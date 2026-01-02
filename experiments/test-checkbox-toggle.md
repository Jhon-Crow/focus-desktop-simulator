# Testing Checkbox Toggle Functionality

This document describes how to test the checkbox toggle functionality added to the markdown editor.

## Feature Description

The markdown editor now supports interactive checkboxes in the preview pane, similar to Obsidian. When you click a checkbox in the preview, it will:

1. Toggle the checkbox state (checked ↔ unchecked)
2. Update the source markdown text automatically (- [ ] ↔ - [x])
3. Update the preview display immediately
4. Support nested checkboxes at any level

## How to Test

1. **Start the application:**
   ```bash
   npm start
   ```

2. **Open the Laptop:**
   - Click on a laptop object in the game
   - Navigate to the laptop desktop

3. **Open the Markdown Editor:**
   - Click the "Editor" button (📝) on the laptop desktop

4. **Load test content:**
   - Copy the content from `experiments/test-checkboxes.md`
   - Paste it into the markdown editor
   - Or manually create checkboxes using `- [ ]` and `- [x]` syntax

5. **Test checkbox toggling:**
   - Click on any checkbox in the preview pane (right side)
   - Observe that:
     - The checkbox state changes
     - The source text (left side) is updated
     - The preview refreshes immediately

6. **Test nested checkboxes:**
   - Use the nested checkbox examples
   - Verify that clicking nested checkboxes works correctly
   - Each checkbox should toggle independently

7. **Test edge cases:**
   - Checkbox with formatting (bold, italic, code)
   - Checkbox with links
   - Both lowercase [x] and uppercase [X] for checked state
   - Multiple consecutive checkboxes

## Expected Behavior

### Before Implementation
- Checkboxes were rendered with `disabled` attribute
- Clicking checkboxes had no effect
- Source text never changed

### After Implementation
- Checkboxes are interactive (no `disabled` attribute)
- Clicking a checkbox toggles its state
- Source text updates from `- [ ]` to `- [x]` or vice versa
- Preview updates immediately
- Nested checkboxes work correctly
- Changes are saved to `laptop.userData.editorContent`

## Technical Details

### Implementation Changes

1. **Modified `parseMarkdown()` function** (renderer.js:14043-14109):
   - Added line tracking for checkboxes
   - Removed `disabled` attribute from checkbox input elements
   - Added `data-line` attribute to track source line number
   - Changed regex processing to use line-by-line approach

2. **Added checkbox click handler** (renderer.js:14114-14143):
   - Listens for clicks on checkbox elements in preview
   - Retrieves line number from `data-line` attribute
   - Toggles checkbox state in source text
   - Updates preview and saves changes

### Code Changes

- File: `src/renderer.js`
- Lines modified: 14043-14143
- Key features:
  - Line number tracking via `data-line` attribute
  - Event delegation on preview container
  - Direct source text manipulation
  - Immediate preview update
  - Auto-save to userData

## Related Issue

Fixes: https://github.com/Jhon-Crow/focus-desktop-simulator/issues/70

## Notes

- The implementation uses case-insensitive matching for [x] to support both lowercase and uppercase
- Changes are automatically saved to `laptop.userData.editorContent`
- The feature works with any level of nesting (limited only by markdown nesting capabilities)
- The checkbox toggle preserves all other formatting in the line (bold, italic, links, etc.)
