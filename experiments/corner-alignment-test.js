/**
 * Test script to understand camera projection and visible area calculations
 * For book reading mode corner navigation
 */

// Camera FOV: 75 degrees
// Camera position when in reading mode:
//   x: bookX + panOffsetX
//   y: bookY + zoomDistance (e.g., bookY + 0.85)
//   z: bookZ + 0.65 + panOffsetZ
// Camera look direction: pitched down to look at book center (bookX, bookY, bookZ)

// PROBLEM: Calculate the visible area at the book plane (Y = bookY)
// so that we can position the camera to align book corners with screen corners

// APPROACH 1: Simple 3D distance
// Distance from camera to book center = sqrt((zoomDist)^2 + (0.65)^2)
// Visible height = 2 * tan(fov/2) * distance3D
// This gives the visible dimensions perpendicular to the camera direction
// BUT the book plane is horizontal, not perpendicular to camera!

// APPROACH 2: Project onto book plane
// The camera is looking down at angle theta
// theta = atan2(zoomDist, 0.65)
// The visible area on the horizontal plane is larger than perpendicular to camera
// because of the angle

// APPROACH 3: Use camera projection matrix and raycasting
// Cast rays from camera through the four corners of the viewport
// Find where they intersect the book plane (Y = bookY)
// Calculate the dimensions

// Let's implement APPROACH 2:

const fov = 75; // degrees
const aspect = 1.78; // typical 16:9 aspect ratio (window.innerWidth / window.innerHeight)
const zoomDistance = 0.85;  // Y offset
const zOffset = 0.65;       // Z offset

const fovRad = (fov * Math.PI) / 180;

// Camera to book center
const distance3D = Math.sqrt(zoomDistance * zoomDistance + zOffset * zOffset);
console.log('3D distance:', distance3D);

// Pitch angle (looking down)
const pitchAngle = Math.atan2(zoomDistance, zOffset);
console.log('Pitch angle (radians):', pitchAngle);
console.log('Pitch angle (degrees):', (pitchAngle * 180) / Math.PI);

// CORRECT APPROACH:
// The camera FOV creates a frustum. We need to find where the four edges of this frustum
// intersect the horizontal plane at Y = bookY.

// The vertical FOV angle is `fov`
// The horizontal FOV angle is determined by aspect ratio: hFov = 2 * atan(tan(vFov/2) * aspect)

// From camera position, we need to find:
// 1. The point on the book plane directly below the camera
// 2. The visible extent in the Z direction (forward/backward)
// 3. The visible extent in the X direction (left/right)

// Visible extent in Z direction (forward/backward from book center):
// Top edge of frustum has angle: pitch - fov/2
// Bottom edge of frustum has angle: pitch + fov/2
// (negative pitch = looking down, positive = looking up)

const cameraPitch = -pitchAngle; // Negative because looking down
const topEdgeAngle = cameraPitch - fovRad / 2;
const bottomEdgeAngle = cameraPitch + fovRad / 2;

console.log('Camera pitch (negative = looking down):', cameraPitch, 'radians');
console.log('Top edge angle:', topEdgeAngle, 'radians');
console.log('Bottom edge angle:', bottomEdgeAngle, 'radians');

// Camera is at (camX, camY, camZ) = (bookX, bookY + zoomDist, bookZ + 0.65)
// Book plane is at Y = bookY
// We want to find Z positions where the top and bottom edges hit the book plane

// For top edge: start at camera, go in direction (0, sin(topAngle), cos(topAngle))
// Find t where camY + t * sin(topAngle) = bookY
// t = (bookY - camY) / sin(topAngle) = -zoomDist / sin(topAngle)
// Z position = camZ + t * cos(topAngle)

const tTop = -zoomDistance / Math.sin(topEdgeAngle);
const zTop = zOffset + tTop * Math.cos(topEdgeAngle);

const tBottom = -zoomDistance / Math.sin(bottomEdgeAngle);
const zBottom = zOffset + tBottom * Math.cos(bottomEdgeAngle);

console.log('Z at top edge:', zTop);
console.log('Z at bottom edge:', zBottom);
console.log('Visible Z extent (half):', Math.abs(zBottom - zTop) / 2);

// For horizontal direction, we use the horizontal FOV
const hFovRad = 2 * Math.atan(Math.tan(fovRad / 2) * aspect);
const leftEdgeAngle = -hFovRad / 2;
const rightEdgeAngle = hFovRad / 2;

console.log('Horizontal FOV:', (hFovRad * 180) / Math.PI, 'degrees');

// The visible width depends on the distance from camera to the book plane along the viewing direction
// Average Z position on book plane (center of visible area in Z)
const zCenter = (zTop + zBottom) / 2;

// Distance from camera to this center point
const distToCenter = Math.sqrt(zoomDistance * zoomDistance + (zOffset - zCenter) * (zOffset - zCenter));

// Actually, for the horizontal direction, we should use the distance along the current viewing ray
// At the center of the screen (Z = zCenter), the distance is:
const centerRayDist = distToCenter;

// Visible width at this distance
const visibleWidth = 2 * Math.tan(hFovRad / 2) * centerRayDist;

console.log('Visible width:', visibleWidth);

// FINAL VALUES for default zoom (0.85):
console.log('\n=== FINAL RESULTS ===');
console.log('Visible Z extent (forward/back): ±', Math.abs(zBottom - zTop) / 2);
console.log('Visible X extent (left/right): ±', visibleWidth / 2);
