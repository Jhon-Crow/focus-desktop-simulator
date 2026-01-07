# Case Study: Issue #21 - Add Cards Feature

## Overview

**Issue**: [#21 - Add cards](https://github.com/Jhon-Crow/focus-desktop-simulator/issues/21)
**PR**: [#116](https://github.com/Jhon-Crow/focus-desktop-simulator/pull/116)
**Status**: In Progress (Bug Fix Round 4)

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

---

## Phase 5: Card Flip and Back Image Fit Issues (Round 4)

### User Feedback (Comment 4 - 2026-01-07T18:07:14Z)

The user reported multiple issues:

1. **Back image fit selector needed**: "Настройки ширины нужны для картинки на рубашке" (Width settings needed for back image)
2. **Use back image as background**: "Добавь возможность не занимать часть оборотной стороны картинкой, а использовать её в качестве фона" (Add option to use image as full background instead of partial area)
3. **Card flip not working**: "Всё ещё не переворачивается карточка" (Card still doesn't flip)
4. **Arrow key flip outside reading mode**: "Листание должно работать вне read mode, просто при наведённом прицеле и нажатии левой/правой стрелки (как у книг)" (Flipping should work outside read mode, just by aiming and pressing arrow keys like books)

### Activity Log Analysis

The user provided an activity log (`activity-log-2026-01-07T18-05-11-405Z.txt`) showing:

```
[2026-01-07T18:05:18.770Z] Card flipped
  Details: {
    "cardId": 14,
    "showingFront": false,
    "startRotation": "3.1416",
    "delta": "3.1416",
    "targetRotation": "3.1416"
  }
```

**Root Cause of Flip Bug**:
- The `flipCard` function calculated `delta = Math.PI` (3.1416) regardless of current rotation
- Animation went from `actualStartRotation + delta * eased` (e.g., 3.1416 + 3.1416 = 6.2832)
- But then snapped to `targetRotation = 3.1416` (Math.PI) at the end
- This created a visual jump/reset instead of smooth flip

### Solution Implemented (Round 4)

#### Fix 1: Complete Rewrite of `flipCard` Function

New implementation with directional control (like book pages):

```javascript
// Flip a card (like turning a book page)
// direction: 1 = flip to show front (like ArrowRight), -1 = flip to show back (like ArrowLeft)
// If no direction specified, toggles to the opposite side
function flipCard(cardObject, direction = null) {
  // ...
  // Now calculates actualDelta = targetRotation - actualStartRotation
  // Animates directly to target without snapping
}
```

Key changes:
- Added `direction` parameter for directional flipping
- Added `isFlipping` flag to prevent double-flip during animation
- Fixed animation to use `actualDelta = targetRotation - actualStartRotation`
- No more snap at end - animation goes directly to target

#### Fix 2: Arrow Key Flipping Outside Reading Mode

Added card flip support similar to book page navigation:

```javascript
// Card flip navigation (when not in reading mode, but aimed at card) - like book page turning
let cardObject = null;
// Check if aimed at card via raycast...
if (cardObject) {
  const direction = e.key === 'ArrowRight' ? 1 : -1;
  flipCard(cardObject, direction);
}
```

#### Fix 3: Back Image Fit Selector

Added `backImageFit` property with three modes:
- `fill` (default): Image covers entire card (used as background)
- `contain`: Image fits within a bounded area, maintaining aspect ratio
- `cover`: Image fills area, may crop to maintain aspect ratio

UI added to card customization panel with dropdown selector.

#### Fix 4: Updated Card Reading Mode

Reading mode now uses directional flipping:
- ArrowLeft = show back (page 1)
- ArrowRight = show front (page 2)

### Files Changed

- `src/renderer.js`:
  - Rewrote `flipCard()` function with direction support
  - Added arrow key handling for cards outside reading mode
  - Added `backImageFit` property to card userData
  - Updated `updateCardVisuals()` to handle back image fit modes
  - Added back image fit selector UI to customization panel
  - Added event handler for back image fit selector
  - Updated save/load to persist `backImageFit`

### Verification Test Cases

1. **Card flip with toggle**: Middle-click card, verify it flips to other side
2. **Card flip with arrows outside reading mode**: Aim at card, press ← → arrows, verify flip
3. **Directional flip**: Press → to show front, ← to show back
4. **Back image as background**: Upload back image, select "Full card background (fill)"
5. **Back image contained**: Upload back image, select "Fit within area (contain)"
6. **State persistence**: Save, reload, verify back image fit setting persists

---

## References

- Original Issue: https://github.com/Jhon-Crow/focus-desktop-simulator/issues/21
- Pull Request: https://github.com/Jhon-Crow/focus-desktop-simulator/pull/116
- User Feedback Comment (Round 3): https://github.com/Jhon-Crow/focus-desktop-simulator/pull/116#issuecomment-3719244194
- User Feedback Comment (Round 4): https://github.com/Jhon-Crow/focus-desktop-simulator/pull/116#issuecomment-3720106751
- Activity Log: `logs/activity-log-2026-01-07T18-05-11-405Z.txt`
