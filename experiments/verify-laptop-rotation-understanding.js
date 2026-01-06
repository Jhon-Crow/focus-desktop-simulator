/**
 * Understanding laptop rotation values
 *
 * Current code:
 * - rotation.x = 0° → screen flat on base (closed) → 0% open
 * - rotation.x = -90° (-π/2) → screen at 90° from base → 100% open (normal laptop)
 * - rotation.x = -180° (-π) → screen flat behind base → 200% open (convertible)
 *
 * User's understanding from their comment:
 * "стартовая позиция = 0 deg, то есть ноутбук открыт на 100% и находится под углом 90 deg"
 * "starting position = 0 deg, meaning laptop is 100% open and at 90 deg angle"
 *
 * So user thinks:
 * - lidRotation value 0° = physical angle 90° = 100% open = normal working position
 * - lidRotation value -90° = physical angle 180° = 200% open = fully open/convertible
 * - lidRotation value +90° = physical angle 0° = 0% open = closed
 *
 * This means:
 * - Current: lidRotation in code represents how much screen rotates from closed position (negative = opening)
 * - User wants: lidRotation 0° to represent normal laptop position (90° physical angle)
 *
 * Required change:
 * - Initial lidRotation: 0° (instead of current 0° which is closed)
 * - But this 0° should visually show as 90° physical angle (normal laptop)
 * - Closing: +90° (instead of current 0°)
 * - Opening further: -85° (instead of current -180°)
 *
 * So the mapping is:
 * - User's rotation value 0° = Physical 90° = Current code -90° (-π/2)
 * - User's rotation value +90° = Physical 0° (closed) = Current code 0°
 * - User's rotation value -85° = Physical 175° = Current code -175° (about -π*0.97)
 *
 * Conclusion:
 * The initial position should be -π/2 (not 0), and range should be:
 * - From: -π/2 - π/2 + π/36 = -π/2 + 85°*π/180 ≈ -π/2 + 1.48 ≈ -0.09 radians ≈ -5°
 *
 * Wait, let me recalculate:
 * User wants range: -85° to +90°
 * If 0° = normal position (physical 90°), then:
 * - Normal position (0° user) = -90° rotation.x in Three.js
 * - Closed (+90° user) = -90° + 90° = 0° rotation.x in Three.js
 * - Fully open (-85° user) = -90° - 85° = -175° rotation.x in Three.js
 *
 * So in Three.js rotation.x values:
 * - Start: -π/2 (-90°) = normal laptop position
 * - Min (closing): 0° = closed
 * - Max (opening): -175° = fully open
 *
 * But user said range should be -85° to 90°, and direction of these values...
 *
 * Let me re-read: "диапазон движений должен быть от -85 до 90 deg"
 * "range of motion should be from -85 to 90 deg"
 *
 * OK so in the USER'S COORDINATE SYSTEM (where 0 = normal laptop):
 * - Can close to: +90° (closed)
 * - Can open to: -85° (fully open/convertible)
 * - Range: [-85°, +90°]
 *
 * To convert to Three.js rotation.x (where 0 = closed, -90 = normal, -180 = fully open):
 * - Three.js = User's value - 90°
 * - User +90° → Three.js 0° (closed)
 * - User 0° → Three.js -90° (normal)
 * - User -85° → Three.js -175° (fully open)
 *
 * So the fix is:
 * 1. Initial position: -90° (not 0°) - represents normal laptop position
 * 2. Min rotation: -175° (-85° - 90°) - fully open
 * 3. Max rotation: 0° (+90° - 90°) - closed
 * 4. Range in Three.js: [-175°, 0°] or [-0.97π, 0]
 */

console.log('Laptop rotation conversion:');
console.log('User coordinate system (0° = normal laptop at 90° physical angle):');
console.log('  Closed: +90°');
console.log('  Normal: 0°');
console.log('  Fully open: -85°');
console.log('');
console.log('Three.js rotation.x (0° = screen flat on base):');
const userToThreeJS = (userDeg) => userDeg - 90;
console.log('  Closed: ' + userToThreeJS(90) + '°');
console.log('  Normal: ' + userToThreeJS(0) + '°');
console.log('  Fully open: ' + userToThreeJS(-85) + '°');
console.log('');
console.log('In radians:');
const degToRad = (deg) => deg * Math.PI / 180;
console.log('  Initial (normal): ' + degToRad(userToThreeJS(0)) + ' rad (' + userToThreeJS(0) + '°)');
console.log('  Min (fully open): ' + degToRad(userToThreeJS(-85)) + ' rad (' + userToThreeJS(-85) + '°)');
console.log('  Max (closed): ' + degToRad(userToThreeJS(90)) + ' rad (' + userToThreeJS(90) + '°)');
