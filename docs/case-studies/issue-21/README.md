# Case Study: Issue #21 - Add Cards Feature

## Overview

**Issue**: [#21 - Add cards](https://github.com/Jhon-Crow/focus-desktop-simulator/issues/21)
**PR**: [#116](https://github.com/Jhon-Crow/focus-desktop-simulator/pull/116)
**Status**: In Progress (Bug Fix Round)

## Timeline / Sequence of Events

### Phase 1: Initial Implementation (Session 1)

1. **Issue Created**: User requested a card deck feature with the following requirements:
   - Box with card deck
   - Draw card on interaction
   - Standard/custom back image
   - Optional title on back
   - Front side with title, optional image, description
   - Cards can be stacked

2. **First Implementation**: AI implemented the core card deck feature including:
   - `createCardDeck()` function
   - `createCard()` function
   - `drawCardFromDeck()` function
   - `flipCard()` function with animation
   - Card interaction modal with front side editing
   - State persistence (save/load)

### Phase 2: First Review Feedback

3. **User Feedback (Comment 1)**:
   > "Когда из колоды достаётся карта она должна быть отмасштабирована так же как и колода"
   > (When a card is drawn from a deck, it should be scaled the same as the deck)

   > "Добавь в edit mode карты указание картинки рубашки и контента оборотной стороны"
   > (Add back image and back side content editing in card edit mode)

### Phase 3: Second Implementation (Session 2)

4. **Second Implementation**: AI added:
   - Card scale inheritance from deck
   - Back side editing UI in modal:
     - Back title input
     - Show title on back checkbox
     - Custom back image upload
     - Clear image button
   - `updateCardVisuals()` function to handle back side updates

### Phase 4: Second Review - Bug Report

5. **User Feedback (Comment 2)**:
   > "пункты 2 и 3 не выполнены"
   > (Points 2 and 3 are not fulfilled)

   Points 2 and 3 from the original issue refer to:
   - Point 2: "Рубашка стандартная/своя картинка" (Standard/custom back image)
   - Point 3: "Есть/нет title на рубашке" (Title on back or not)

## Root Cause Analysis

### Problem Description

The custom back image and title-on-back features were implemented in the `updateCardVisuals()` function (called when editing a card), but NOT in the `createCard()` function (called when creating a new card). This caused:

1. **Custom back image not showing**: When a card is drawn from a deck with a custom back image, the card is created with the default diamond pattern instead of the custom image.

2. **Title on back inconsistency**: The title rendering in `createCard()` was missing the semi-transparent background that `updateCardVisuals()` had, making it look different.

### Technical Details

**Location**: `src/renderer.js`

**Issue 1: createCard() function (lines 7019-7057)**

```javascript
// Back face creation code
// Fill with back color
backCtx.fillStyle = group.userData.backColor;
backCtx.fillRect(0, 0, 128, 180);

// Add diamond pattern (default) - ALWAYS drawn, no check for backImage
// ...diamond pattern code...

// Add title on back if configured - missing background
if (group.userData.showTitleOnBack && group.userData.backTitle) {
  backCtx.fillStyle = 'rgba(255,255,255,0.9)';
  backCtx.font = 'bold 14px Arial';
  backCtx.textAlign = 'center';
  backCtx.fillText(group.userData.backTitle, 64, 95); // Wrong Y position
}
```

**Issue 2: updateCardVisuals() correctly handles backImage (lines 7272-7289)**

```javascript
// Check for custom back image
if (cardData.backImage) {
  const img = new Image();
  img.onload = () => {
    backCtx.drawImage(img, 0, 0, 128, 180);
    drawBackContent();
  };
  // ...
}
```

### Why It Wasn't Caught Earlier

1. **Testing gap**: The implementation was tested by manually uploading a back image in the edit modal, which DOES call `updateCardVisuals()`. But drawing a card from a deck with a pre-set custom back image was not tested.

2. **Async nature**: Image loading is asynchronous. The `createCard()` function drew the texture synchronously, so even if it checked for `backImage`, it would need special handling for the async load.

3. **Code duplication**: The back texture rendering logic was duplicated between `createCard()` and `updateCardVisuals()` instead of being centralized, leading to inconsistency.

## Solution Implemented

### Fix 1: Call updateCardVisuals() after card creation

Added code at the end of `createCard()` to call `updateCardVisuals()` when custom back features are present:

```javascript
// If card has custom back image or back title, update visuals to render them properly
// (the initial back texture only renders the default pattern)
if (group.userData.backImage || (group.userData.showTitleOnBack && group.userData.backTitle)) {
  setTimeout(() => {
    updateCardVisuals(group);
  }, 0);
}
```

The `setTimeout` ensures the card object is fully added to the scene before updating, and properly handles async image loading.

### Fix 2: Consistent title rendering

Updated the title rendering in `createCard()` to match `updateCardVisuals()`:

```javascript
if (group.userData.showTitleOnBack && group.userData.backTitle) {
  // Draw text background for better readability
  backCtx.fillStyle = 'rgba(0,0,0,0.5)';
  backCtx.fillRect(10, 80, 108, 30);
  backCtx.fillStyle = 'rgba(255,255,255,0.9)';
  backCtx.font = 'bold 14px Arial';
  backCtx.textAlign = 'center';
  backCtx.fillText(group.userData.backTitle, 64, 100); // Correct Y position
}
```

## Lessons Learned

1. **Test the full user journey**: Not just editing features, but also the flow from deck configuration to card creation.

2. **Avoid code duplication**: The texture rendering should have been centralized in one function from the start.

3. **Consider async operations**: When dealing with images, always consider the async loading implications.

4. **Review feedback carefully**: The user's feedback about "points 2 and 3" referred to the original issue requirements, not the PR checklist.

## Files Changed

- `src/renderer.js`: Fixed `createCard()` function to properly handle custom back image and title

## Data Files

- `logs/solution-draft-log-1.txt`: First AI work session log
- `logs/solution-draft-log-2.txt`: Second AI work session log
- `data/issue-data.json`: Original issue data
- `data/pr-data.json`: Pull request data
- `data/pr-comments.json`: PR conversation comments

## Verification

Test cases to verify the fix:

1. Create a card deck
2. Set a custom back image on the deck
3. Draw a card - verify it has the custom back image
4. Set title on back for the deck with "Show title" enabled
5. Draw a card - verify it has the title on back with background

## References

- Original Issue: https://github.com/Jhon-Crow/focus-desktop-simulator/issues/21
- Pull Request: https://github.com/Jhon-Crow/focus-desktop-simulator/pull/116
- User Feedback Comment: https://github.com/Jhon-Crow/focus-desktop-simulator/pull/116#issuecomment-3719244194
