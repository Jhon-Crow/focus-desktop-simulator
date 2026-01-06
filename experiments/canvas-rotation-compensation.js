/**
 * Experiment: Canvas Rotation Compensation
 *
 * Goal: When paper/notebook rotates, rotate the canvas content to compensate,
 * so the drawing appears stable to the observer.
 *
 * Approach:
 * 1. Track last rotation in userData.lastRotation
 * 2. When rotation changes:
 *    a. Calculate rotation delta
 *    b. Copy current canvas content to temporary canvas
 *    c. Clear canvas
 *    d. Rotate and draw back the content with compensation rotation
 * 3. Don't rotate texture (keep texture.rotation = 0)
 *
 * Key insight:
 * - Paper rotates clockwise → rotate canvas content counterclockwise by same amount
 * - This makes drawing appear stable to observer
 *
 * Example:
 * - Paper at 0° with drawing "ABC"
 * - Paper rotates to 45° clockwise
 * - Canvas content rotates -45° (counterclockwise)
 * - To observer: "ABC" still appears upright!
 */

// Function to rotate canvas content
function rotateCanvasContent(canvas, rotationDelta) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  // Create temporary canvas to store current content
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d');

  // Copy current content to temp canvas
  tempCtx.drawImage(canvas, 0, 0);

  // Clear main canvas
  ctx.clearRect(0, 0, width, height);

  // Fill with white background (or preserve transparency based on settings)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Save state, translate to center, rotate, draw
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-rotationDelta); // Negative to compensate paper rotation
  ctx.translate(-width / 2, -height / 2);
  ctx.drawImage(tempCanvas, 0, 0);
  ctx.restore();
}

// Modified updateDrawingTexture with rotation compensation
function updateDrawingTexture_withCompensation(drawableObject) {
  if (!drawableObject || !drawableObject.userData.drawingCanvas) return;

  const canvas = drawableObject.userData.drawingCanvas;
  const currentRotation = drawableObject.rotation.y;

  // Initialize lastRotation if not set
  if (drawableObject.userData.lastRotation === undefined) {
    drawableObject.userData.lastRotation = currentRotation;
  }

  // Check if rotation changed
  const rotationDelta = currentRotation - drawableObject.userData.lastRotation;
  const rotationThreshold = 0.001; // Small threshold to avoid floating point issues

  if (Math.abs(rotationDelta) > rotationThreshold) {
    // Paper rotated! Compensate by rotating canvas content
    console.log(`Paper rotated by ${(rotationDelta * 180 / Math.PI).toFixed(2)}°, compensating canvas...`);
    rotateCanvasContent(canvas, rotationDelta);
    drawableObject.userData.lastRotation = currentRotation;
  }

  // Create or update texture WITHOUT rotation
  if (!drawableObject.userData.drawingTexture) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    // NO rotation applied to texture
    drawableObject.userData.drawingTexture = texture;
    // ... apply to object
  } else {
    drawableObject.userData.drawingTexture.needsUpdate = true;
  }
}

console.log('Canvas rotation compensation approach:');
console.log('1. Track rotation changes in userData.lastRotation');
console.log('2. When rotation changes, rotate canvas content by -delta');
console.log('3. No texture rotation needed');
console.log('4. Drawing appears stable to observer!');
