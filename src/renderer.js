// Focus Desktop Simulator - Main Renderer
// Uses Three.js for 3D isometric desk simulation
// Three.js is loaded locally in index.html (available as global THREE)
// Includes pixel art post-processing effect (Signalis-style)

// ============================================================================
// GLOBAL ERROR HANDLERS (for debugging)
// ============================================================================
window.addEventListener('error', (event) => {
  console.error('Uncaught error:', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  camera: {
    // First-person desk view - looking at a PC desktop from a seated position
    // Near edge (keyboard) is ~2-4 degrees off top-down
    // Far edge (monitor area) is almost parallel to viewer, ~1-2 degrees higher
    fov: 75,  // Wide FOV for realistic first-person desk view
    near: 0.1,
    far: 1000,
    // Position: seated viewer looking down at desk from slightly in front and above
    position: { x: 0, y: 4.5, z: 5.5 },  // Above and in front of desk
    lookAt: { x: 0, y: 0, z: -1.5 }  // Looking at the far edge of the desk
  },
  desk: {
    // Desk surface only (no legs), fills most of the view
    width: 10,
    depth: 7,
    height: 0.1,
    legHeight: 0,  // No legs - like a PC desktop surface
    color: 0x8b6914
  },
  physics: {
    liftHeight: 0.5,
    liftSpeed: 0.15,
    dropSpeed: 0.2,
    gravity: 0.02
  },
  colors: {
    background: 0x1a1a2e,
    ambient: 0x404060,
    directional: 0xffffff,
    ground: 0x2d3748
  },
  // Pixel art post-processing settings (Signalis-style)
  pixelation: {
    enabled: true,
    pixelSize: 4,           // Size of pixels (higher = more pixelated)
    normalEdgeStrength: 0.3, // Edge detection based on normals
    depthEdgeStrength: 0.4   // Edge detection based on depth
  }
};

// ============================================================================
// GLOBAL STATE
// ============================================================================
let scene, camera, renderer;
let desk;
let deskObjects = [];
let selectedObject = null;
let isDragging = false;
let dragPlane;
let raycaster;
let mouse;
let previousMousePosition = { x: 0, y: 0 };
let objectIdCounter = 0;
let isLoadingState = false; // Flag to prevent saving during load
let saveStateDebounceTimer = null; // Debounce timer for saveState
let isSavingState = false; // Flag to prevent concurrent saves
let ffmpegAvailable = false; // FFmpeg availability status from main process

// Debug visualization state
let debugState = {
  showCollisionRadii: false,
  collisionHelpers: [],  // Array of THREE.Mesh objects for visualizing collisions
  showCameraRay: false   // Show camera crosshair ray for debugging
};

// Camera ray visualization helper
let cameraRayHelper = null;

// Pixel art post-processing state
let pixelRenderTarget, normalRenderTarget;
let pixelatedMaterial, normalMaterial;
let fsQuad, fsCamera, fsGeometry;
let renderResolution = new THREE.Vector2();

// Interaction modal state
let interactionObject = null;
let timerState = {
  active: false,
  running: false,
  remainingSeconds: 0,
  intervalId: null,
  alertAudioCtx: null,
  alertOscillator: null,
  isAlerting: false,
  // Alarm settings
  alarmEnabled: false,
  alarmHours: 0,
  alarmMinutes: 0,
  alarmTriggered: false,
  // Sound settings
  alertVolume: 0.5, // 0-1
  alertPitch: 800, // Hz (default 800Hz)
  customSoundDataUrl: null // Custom sound file data URL
};

// Shared audio context for metronome (reuse to avoid lag)
let sharedAudioCtx = null;
function getSharedAudioContext() {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (browsers often suspend audio contexts)
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

// ============================================================================
// AUDIO LOADING OVERLAY
// ============================================================================
// State for cancellable audio loading
let audioLoadingCancelled = false;
let audioLoadingResolve = null;

function showAudioLoadingOverlay() {
  audioLoadingCancelled = false;
  const overlay = document.getElementById('audio-loading-overlay');
  if (overlay) {
    overlay.classList.add('visible');
    // Setup cancel button handler
    const cancelBtn = document.getElementById('audio-loading-cancel');
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        audioLoadingCancelled = true;
        hideAudioLoadingOverlay();
        console.log('Audio loading cancelled by user');
        // If there's a pending promise, reject it
        if (audioLoadingResolve) {
          audioLoadingResolve.reject(new Error('Audio loading cancelled by user'));
          audioLoadingResolve = null;
        }
      };
    }
  }
}

function hideAudioLoadingOverlay() {
  const overlay = document.getElementById('audio-loading-overlay');
  if (overlay) {
    overlay.classList.remove('visible');
  }
}

// Pre-validate audio file using HTML5 Audio element
// This is much faster and won't hang the browser
async function preValidateAudioFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let timeout = null;
    let handled = false;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      URL.revokeObjectURL(url);
      audio.src = '';
    };

    const handleError = (msg) => {
      if (handled) return;
      handled = true;
      cleanup();
      reject(new Error(msg));
    };

    const handleSuccess = () => {
      if (handled) return;
      handled = true;
      cleanup();
      resolve(true);
    };

    // Timeout after 3 seconds - if it takes longer, file is probably problematic
    timeout = setTimeout(() => {
      handleError('Audio file validation timed out. The file may be corrupted or in an unsupported format.');
    }, 3000);

    audio.onerror = () => {
      handleError('Unable to load audio file. The file may be corrupted or in an unsupported format.');
    };

    // canplaythrough means the file can be played
    audio.oncanplaythrough = () => {
      handleSuccess();
    };

    // For short files, loadedmetadata may fire before canplaythrough
    audio.onloadedmetadata = () => {
      // Give it a bit more time for canplaythrough, but consider it valid
      setTimeout(() => {
        if (!handled) handleSuccess();
      }, 500);
    };

    audio.src = url;
    audio.load();
  });
}

// List of audio formats NOT supported by Chromium/Electron's Web Audio API
// These formats will cause decodeAudioData to hang or fail
const UNSUPPORTED_AUDIO_FORMATS = ['wma', 'wv', 'ape', 'ra', 'ram', 'mid', 'midi', 'amr', 'mka'];

// List of audio formats that are known to work well with Web Audio API
const SUPPORTED_AUDIO_FORMATS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'webm', 'opus'];

// Robust audio decoding function with fallback methods and timeout
async function decodeAudioBuffer(arrayBuffer, fileName = '') {
  const audioCtx = getSharedAudioContext();
  const bufferSize = arrayBuffer.byteLength;

  console.log('decodeAudioBuffer: Starting decode, buffer size:', bufferSize, 'AudioContext state:', audioCtx.state);

  // Check for unsupported format by filename extension
  if (fileName) {
    const extension = fileName.split('.').pop().toLowerCase();
    if (UNSUPPORTED_AUDIO_FORMATS.includes(extension)) {
      throw new Error(`The "${extension.toUpperCase()}" format is not supported by the browser. Please convert your audio file to MP3, WAV, or OGG format.`);
    }
  }

  // Warn about large files (>2MB) that may cause issues
  const MAX_RECOMMENDED_SIZE = 2 * 1024 * 1024; // 2MB
  if (bufferSize > MAX_RECOMMENDED_SIZE) {
    console.warn('decodeAudioBuffer: Large file detected (' + (bufferSize / (1024 * 1024)).toFixed(2) + 'MB). This may take a while or fail.');
  }

  // Ensure audio context is running
  if (audioCtx.state === 'suspended') {
    try {
      await audioCtx.resume();
      console.log('decodeAudioBuffer: AudioContext resumed');
    } catch (e) {
      console.warn('Could not resume audio context:', e);
    }
  }

  // Make a copy of the buffer since decodeAudioData can detach it
  const bufferCopy = arrayBuffer.slice(0);
  console.log('decodeAudioBuffer: Buffer copied, calling decodeAudioData...');

  // Use a 5 second timeout - if it takes longer, it's likely hung
  const DECODE_TIMEOUT_MS = 5000;
  let timeoutId = null;
  let isTimedOut = false;

  // Create a timeout promise to prevent indefinite hangs
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      isTimedOut = true;
      console.error('decodeAudioBuffer: Timeout after', DECODE_TIMEOUT_MS, 'ms');
      reject(new Error(`Audio decoding timed out after ${DECODE_TIMEOUT_MS / 1000} seconds. The file may be corrupted or in an unsupported format. Try converting to MP3 (128kbps) or WAV (16-bit PCM).`));
    }, DECODE_TIMEOUT_MS);
  });

  // Create the decode promise
  const decodePromise = new Promise((resolve, reject) => {
    let handled = false;

    const handleSuccess = (decodedBuffer) => {
      if (handled || isTimedOut || audioLoadingCancelled) return;
      handled = true;
      if (timeoutId) clearTimeout(timeoutId);
      console.log('Audio decoded successfully, duration:', decodedBuffer.duration, 'channels:', decodedBuffer.numberOfChannels);
      resolve(decodedBuffer);
    };

    const handleError = (err) => {
      if (handled || isTimedOut) return;
      handled = true;
      if (timeoutId) clearTimeout(timeoutId);
      console.error('decodeAudioData error:', err);
      reject(new Error('Unable to decode audio file. The file format may not be supported by your browser. Try converting to MP3 (128kbps) or WAV (16-bit PCM).'));
    };

    // Check if already cancelled
    if (audioLoadingCancelled) {
      if (timeoutId) clearTimeout(timeoutId);
      reject(new Error('Audio loading cancelled by user'));
      return;
    }

    // Use setTimeout(0) to yield to the event loop before starting decode
    // This allows the loading overlay to render before we start the potentially blocking operation
    setTimeout(() => {
      if (audioLoadingCancelled) {
        if (timeoutId) clearTimeout(timeoutId);
        reject(new Error('Audio loading cancelled by user'));
        return;
      }

      try {
        // Use callback form for maximum compatibility
        // Note: Some Electron versions may hang on decodeAudioData for certain files
        const result = audioCtx.decodeAudioData(bufferCopy, handleSuccess, handleError);

        // Modern browsers return a promise from decodeAudioData
        // Handle this as a fallback in case callbacks aren't called
        if (result && typeof result.then === 'function') {
          result
            .then((buffer) => {
              if (!handled && !isTimedOut && !audioLoadingCancelled) {
                console.log('decodeAudioData resolved via promise');
                handleSuccess(buffer);
              }
            })
            .catch((err) => {
              if (!handled && !isTimedOut) {
                console.log('decodeAudioData rejected via promise');
                handleError(err);
              }
            });
        }
      } catch (e) {
        // Some browsers throw synchronously instead of calling the error callback
        console.error('decodeAudioData sync error:', e);
        handleError(e);
      }
    }, 0);
  });

  // Race between decode and timeout
  return Promise.race([decodePromise, timeoutPromise]);
}

// ============================================================================
// AUDIO TRANSCODING TO WAV PCM
// ============================================================================
// This converts any decoded audio to a standard 16-bit PCM WAV format
// which is universally supported by all browsers and Electron versions.
// This solves issues with various audio formats (especially MP3s with
// unusual bit rates or WAV files with non-standard encoding).

/**
 * Encode an AudioBuffer to WAV format (16-bit PCM)
 * @param {AudioBuffer} audioBuffer - The decoded audio buffer
 * @returns {ArrayBuffer} - WAV file as ArrayBuffer
 */
function encodeAudioBufferToWav(audioBuffer) {
  const numChannels = Math.min(audioBuffer.numberOfChannels, 2); // Limit to stereo
  const sampleRate = audioBuffer.sampleRate;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const numSamples = audioBuffer.length;
  const dataSize = numSamples * blockAlign;
  const fileSize = 44 + dataSize; // 44 bytes for WAV header

  // Create buffer for the WAV file
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // Helper to write a string
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // Write WAV header
  writeString(0, 'RIFF');                         // ChunkID
  view.setUint32(4, fileSize - 8, true);          // ChunkSize
  writeString(8, 'WAVE');                         // Format
  writeString(12, 'fmt ');                        // Subchunk1ID
  view.setUint32(16, 16, true);                   // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);                    // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);          // NumChannels
  view.setUint32(24, sampleRate, true);           // SampleRate
  view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
  view.setUint16(32, blockAlign, true);           // BlockAlign
  view.setUint16(34, bitsPerSample, true);        // BitsPerSample
  writeString(36, 'data');                        // Subchunk2ID
  view.setUint32(40, dataSize, true);             // Subchunk2Size

  // Get channel data
  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  // Interleave and write sample data
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      // Convert float (-1 to 1) to 16-bit integer (-32768 to 32767)
      let sample = channels[c][i];
      // Clamp to prevent overflow
      sample = Math.max(-1, Math.min(1, sample));
      // Convert to 16-bit signed integer
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return buffer;
}

/**
 * Convert ArrayBuffer to data URL
 * @param {ArrayBuffer} arrayBuffer - The data
 * @param {string} mimeType - MIME type for the data URL
 * @returns {string} - Data URL
 */
function arrayBufferToDataUrl(arrayBuffer, mimeType = 'audio/wav') {
  const uint8Array = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/**
 * Trim an AudioBuffer to a maximum duration
 * @param {AudioBuffer} audioBuffer - The original audio buffer
 * @param {number} maxDuration - Maximum duration in seconds
 * @returns {AudioBuffer} - Trimmed audio buffer (or original if shorter)
 */
function trimAudioBuffer(audioBuffer, maxDuration) {
  if (audioBuffer.duration <= maxDuration) {
    return audioBuffer;
  }

  console.log('trimAudioBuffer: Trimming audio from', audioBuffer.duration, 'to', maxDuration, 'seconds');

  const audioCtx = getSharedAudioContext();
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const maxSamples = Math.floor(maxDuration * sampleRate);

  // Create a new, shorter buffer
  const trimmedBuffer = audioCtx.createBuffer(numChannels, maxSamples, sampleRate);

  // Copy the data
  for (let c = 0; c < numChannels; c++) {
    const sourceData = audioBuffer.getChannelData(c);
    const destData = trimmedBuffer.getChannelData(c);
    destData.set(sourceData.subarray(0, maxSamples));
  }

  return trimmedBuffer;
}

/**
 * Transcode audio file to WAV PCM format
 * This decodes the audio and re-encodes it as WAV PCM,
 * ensuring universal compatibility.
 * For metronome/timer sounds, we limit to 10 seconds to keep file size reasonable.
 * @param {ArrayBuffer} inputBuffer - The input audio file
 * @param {string} fileName - File name for logging/error messages
 * @param {number} maxDuration - Maximum duration in seconds (default: 10)
 * @returns {Promise<{audioBuffer: AudioBuffer, wavDataUrl: string}>}
 */
async function transcodeToWav(inputBuffer, fileName = '', maxDuration = 10) {
  console.log('transcodeToWav: Starting transcode for', fileName || 'audio file');

  // First, decode the original audio
  let audioBuffer = await decodeAudioBuffer(inputBuffer, fileName);

  console.log('transcodeToWav: Audio decoded, duration:', audioBuffer.duration,
              'channels:', audioBuffer.numberOfChannels,
              'sampleRate:', audioBuffer.sampleRate);

  // Trim to max duration if needed (to keep file size reasonable)
  if (audioBuffer.duration > maxDuration) {
    console.log('transcodeToWav: Audio is longer than', maxDuration, 'seconds, trimming...');
    audioBuffer = trimAudioBuffer(audioBuffer, maxDuration);
  }

  // Encode to WAV PCM
  const wavBuffer = encodeAudioBufferToWav(audioBuffer);
  console.log('transcodeToWav: WAV encoded, size:', (wavBuffer.byteLength / 1024).toFixed(1), 'KB');

  // Warn if resulting file is very large
  const MAX_REASONABLE_SIZE = 2 * 1024 * 1024; // 2MB
  if (wavBuffer.byteLength > MAX_REASONABLE_SIZE) {
    console.warn('transcodeToWav: Warning - transcoded file is large:',
                 (wavBuffer.byteLength / (1024 * 1024)).toFixed(2), 'MB');
  }

  // Convert to data URL
  const wavDataUrl = arrayBufferToDataUrl(wavBuffer);
  console.log('transcodeToWav: Data URL created, length:', wavDataUrl.length);

  return { audioBuffer, wavDataUrl };
}

// Safe wrapper for loading audio files from File objects
// This uses a simple, reliable approach:
// 1. Validate using HTML5 Audio element (fast, won't hang)
// 2. Read file as data URL
// 3. Return dataUrl for HTML5 Audio playback (no decodeAudioData which can hang)
//
// This approach avoids the Web Audio API's decodeAudioData which can hang
// indefinitely on certain audio files in Electron, causing a grey screen.
async function loadAudioFromFile(file) {
  console.log('loadAudioFromFile:', file.name, 'type:', file.type, 'size:', file.size);

  // Early check for completely unsupported formats
  const extension = file.name.split('.').pop().toLowerCase();
  if (UNSUPPORTED_AUDIO_FORMATS.includes(extension)) {
    throw new Error(`The "${extension.toUpperCase()}" format is not supported. Please convert your audio file to MP3, WAV, or OGG format.`);
  }

  // File size limits
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB absolute max
  const WARN_FILE_SIZE = 2 * 1024 * 1024; // 2MB warning threshold

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Please use a file smaller than 10MB.`);
  }

  if (file.size > WARN_FILE_SIZE) {
    console.warn('loadAudioFromFile: Large file detected:', (file.size / 1024 / 1024).toFixed(2), 'MB');
  }

  // Show loading overlay
  showAudioLoadingOverlay();

  try {
    // Step 1: Validate the audio file using HTML5 Audio element
    // This is fast, won't hang, and confirms the browser can play it
    console.log('Validating audio file with HTML5 Audio...');
    try {
      await preValidateAudioFile(file);
      console.log('Audio file validation passed');
    } catch (validationError) {
      // If HTML5 Audio can't play it, the file is likely corrupted or unsupported
      throw new Error(`Cannot load audio file: ${validationError.message}`);
    }

    // Check if cancelled
    if (audioLoadingCancelled) {
      throw new Error('Audio loading cancelled by user');
    }

    // Step 2: Read file as data URL for HTML5 Audio playback
    // This avoids decodeAudioData which can hang on certain files
    console.log('Reading file as data URL...');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read audio file'));
      reader.readAsDataURL(file);
    });

    console.log('File read complete, dataUrl length:', dataUrl.length);

    // Check if cancelled
    if (audioLoadingCancelled) {
      throw new Error('Audio loading cancelled by user');
    }

    // Return just the dataUrl - no audioBuffer needed
    // The playback code will use HTML5 Audio element instead of Web Audio API BufferSource
    hideAudioLoadingOverlay();
    return { audioBuffer: null, dataUrl };

  } finally {
    // Always hide the overlay when done (success or failure)
    hideAudioLoadingOverlay();
  }
}

// Convert ArrayBuffer to base64 string
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert base64 string to ArrayBuffer
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Safe wrapper for loading audio from data URL (for preloading saved sounds)
async function loadAudioFromDataUrl(dataUrl) {
  console.log('loadAudioFromDataUrl, dataUrl length:', dataUrl.length);

  // Convert data URL to ArrayBuffer using fetch
  const response = await fetch(dataUrl);
  const arrayBuffer = await response.arrayBuffer();

  console.log('DataURL converted to ArrayBuffer, size:', arrayBuffer.byteLength);

  // Decode the audio
  return await decodeAudioBuffer(arrayBuffer);
}

// Drag-and-drop state for menu items
let draggedPresetType = null;
let dragPreviewElement = null;

// Drag layer offset - controlled by scroll during drag
// This adds extra height to make objects stack on top of others
let dragLayerOffset = 0;

// Examine mode state (bringing object closer to camera)
let examineState = {
  active: false,
  object: null,
  originalPosition: null,
  originalRotation: null,
  originalScale: null,
  examineDistance: 2.5  // Distance from camera to examined object
};

// Pointer lock state
let pointerLockState = {
  isLocked: false,
  showInstructions: true  // Show instructions on first load
};

// Drawing state (for pen holder interaction)
let drawingState = {
  isDrawing: false,
  selectedPen: null, // Currently held pen color
  selectedPenColor: null, // Hex color value
  currentObject: null, // Object being drawn on (notebook or paper)
  currentLine: null, // Current line being drawn
  points: [] // Points in current line
};

// Pen drawing mode state (new feature - drawing directly with pen object)
let penDrawingMode = {
  active: false,              // Whether drawing mode is active
  heldPen: null,              // The pen object currently being held/dragged
  targetObject: null,         // The notebook/paper being drawn on
  drawingPath: [],            // Current stroke path [{x, y}, ...]
  isStrokeActive: false,      // Whether user is currently drawing a stroke (LMB down)
  saveFolder: null,           // Custom folder for saving drawings
  lineWidth: 2,               // Width of the drawing line
  lastIntersectionPoint: null, // Last raycaster intersection point with drawable surface
  middleMouseDownTime: null,  // Timestamp when MMB was pressed (for hold detection)
  pendingPen: null,           // Pen object waiting for hold timeout
  pendingDrawableObject: null, // Notebook/paper object waiting for hold timeout
  holdTimeout: null,          // Timeout ID for hold detection
  showRay: false,             // Whether to show the drawing ray for debugging
  mmbHoldCompleted: false     // Flag to track if hold-to-enter completed (prevent exit on release)
};

// Ray visualization helper for debugging
let drawingRayHelper = null;

// Laptop control state
let laptopControlState = {
  active: false,
  laptop: null,
  originalCameraPosition: null,
  originalCameraLook: null
};

// Book reading mode state
let bookReadingState = {
  active: false,
  book: null,
  originalCameraPos: null,
  originalCameraYaw: null,
  originalCameraPitch: null,
  middleMouseDownTime: 0,
  holdTimeout: null,
  // Zoom and pan controls for reading mode
  zoomDistance: 0.85, // Distance from book (Y offset)
  panOffsetX: 0,      // Pan offset parallel to book
  panOffsetZ: 0,      // Pan offset forward/backward
  // Cached book world position to avoid recalculating on every keypress
  bookWorldPos: null
};

// Inspection + drawing mode state (for notebooks/paper)
let inspectionDrawingState = {
  active: false,
  drawableObject: null, // The notebook/paper being inspected and drawn on
  originalCameraPos: null,
  originalCameraYaw: null,
  originalCameraPitch: null,
  // Zoom and pan controls (same as reading mode)
  zoomDistance: 0.85,
  panOffsetX: 0,
  panOffsetZ: 0,
  // Cached object world position
  objectWorldPos: null
};

// Cassette player mode state (similar to book reading mode)
let playerModeState = {
  active: false,
  player: null,
  originalCameraPos: null,
  originalCameraYaw: null,
  originalCameraPitch: null,
  middleMouseDownTime: 0,
  holdTimeout: null,
  // Zoom and pan controls for player mode
  zoomDistance: 0.25, // Distance from player (closer than book for button interaction)
  panOffsetX: 0,      // Pan offset left/right (A/D keys)
  panOffsetY: 0,      // Pan offset up/down (W/S keys)
  // Cached player world position to avoid recalculating on every keypress
  playerWorldPos: null,
  // Button navigation state (left/right arrows)
  currentButtonIndex: -1, // -1 = front view (no button selected), 0-3 = button index
  // Button order is player-type specific (set when entering player mode)
  // Mini player (cassette-player): buttons on top edge, order: play → stop → prev → next → (front view) → play ...
  // Big player (big-cassette-player): buttons on front face in order: prev → play → stop → next (left to right)
  buttonNames: ['prevButton', 'playButton', 'stopButton', 'nextButton'], // Default for big player (left to right order)
  buttonTypes: ['prev', 'play', 'stop', 'next'],
  // Mini player button order: play → stop → prev → next → (front view) → play ...
  miniPlayerButtonNames: ['playButton', 'stopButton', 'prevButton', 'nextButton'],
  miniPlayerButtonTypes: ['play', 'stop', 'prev', 'next'],
  // Big player button order: prev → play → stop → next → (front view) → prev ...
  bigPlayerButtonNames: ['prevButton', 'playButton', 'stopButton', 'nextButton'],
  bigPlayerButtonTypes: ['prev', 'play', 'stop', 'next']
};

// Double-click tracking for laptop desktop
let laptopDoubleClickState = {
  lastClickTime: 0,
  lastClickPos: { x: 0, y: 0 },
  doubleClickThreshold: 300 // ms
};

// Laptop cursor state for zoom mode
let laptopCursorState = {
  x: 256, // Center of 512px canvas
  y: 192, // Center of 384px canvas
  visible: false,
  targetLaptop: null
};

// Laptop start menu state
let laptopStartMenuState = {
  isOpen: false,
  targetLaptop: null
};

// Laptop icon drag state
let laptopIconDragState = {
  isDragging: false,
  iconName: null,
  startX: 0,
  startY: 0,
  offsetX: 0,
  offsetY: 0,
  targetLaptop: null
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
// Helper function to find the parent desk object from a child mesh
function getParentDeskObject(obj) {
  while (obj.parent && !deskObjects.includes(obj)) {
    obj = obj.parent;
  }
  return deskObjects.includes(obj) ? obj : null;
}

// ============================================================================
// FL STUDIO-STYLE AUTOMATION CURVE EDITOR
// ============================================================================
// Canvas-based curve editor for pitch/tempo curves similar to FL Studio's Automation Clip

/**
 * AutomationCurveEditor - A class for creating FL Studio-style automation curve editors
 *
 * Features:
 * - Add, move, delete control points by clicking/dragging on the canvas
 * - Multiple curve types between points (linear, smooth, step, sine, pulse)
 * - Tension control for smooth curves
 * - Real-time playback position indicator
 * - Grid background with value/time labels
 */
class AutomationCurveEditor {
  constructor(options = {}) {
    this.containerId = options.containerId;
    this.type = options.type || 'pitch'; // 'pitch' or 'tempo'
    this.object = options.object; // The metronome object
    this.onUpdate = options.onUpdate || (() => {});

    // Canvas dimensions
    this.width = options.width || 220;
    this.height = options.height || 120;

    // Value range
    this.minValue = options.minValue || (this.type === 'pitch' ? 50 : 10);
    this.maxValue = options.maxValue || (this.type === 'pitch' ? 200 : 220);
    this.valueUnit = options.valueUnit || (this.type === 'pitch' ? '%' : ' BPM');

    // Get control points from object or initialize defaults
    const pointsKey = this.type === 'pitch' ? 'pitchCurvePoints' : 'tempoCurvePoints';
    if (this.object.userData[pointsKey] && this.object.userData[pointsKey].length >= 2) {
      this.points = [...this.object.userData[pointsKey]];
    } else {
      // Default: start and end points based on current settings
      const startValue = this.type === 'pitch'
        ? (this.object.userData.pitchCurveStart || 100)
        : (this.object.userData.tempoCurveStart || 60);
      const endValue = this.type === 'pitch'
        ? (this.object.userData.pitchCurveEnd || 100)
        : (this.object.userData.tempoCurveEnd || 120);

      this.points = [
        { x: 0, y: startValue, curveType: 'smooth', tension: 0.5 },
        { x: 1, y: endValue, curveType: 'smooth', tension: 0.5 }
      ];
    }

    // Interaction state
    this.selectedPointIndex = -1;
    this.isDragging = false;
    this.isHovering = false;
    this.hoverPointIndex = -1;

    // Animation state
    this.playbackPosition = 0;
    this.animationFrameId = null;

    // Canvas and context
    this.canvas = null;
    this.ctx = null;
    this.container = null;

    // Initialize
    this.render();
  }

  /**
   * Create the HTML structure for the editor
   */
  render() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    this.container = container;

    // Get duration from object settings
    const durationKey = this.type === 'pitch' ? 'pitchCurveDuration' : 'tempoCurveDuration';
    const duration = this.object.userData[durationKey] || 60;
    const loopKey = this.type === 'pitch' ? 'pitchCurveLoop' : 'tempoCurveLoop';
    const isLooping = this.object.userData[loopKey] || false;
    const enabledKey = this.type === 'pitch' ? 'pitchCurveEnabled' : 'tempoCurveEnabled';
    const isEnabled = this.object.userData[enabledKey] || false;

    container.innerHTML = `
      <div class="automation-curve-editor" data-type="${this.type}">
        <div class="editor-header">
          <div class="editor-title">${this.type === 'pitch' ? '🎵 Pitch' : '⏱️ Tempo'} Curve</div>
          <div class="editor-controls">
            <button class="editor-btn ${isEnabled ? 'active' : ''}" data-action="toggle-enabled">
              ${isEnabled ? 'ON' : 'OFF'}
            </button>
            <button class="editor-btn danger" data-action="reset">Reset</button>
          </div>
        </div>

        <div class="time-labels">
          <span>0s</span>
          <span>${Math.round(duration / 2)}s</span>
          <span>${duration}s</span>
        </div>

        <div class="automation-curve-canvas-container">
          <canvas class="automation-curve-canvas" width="${this.width}" height="${this.height}"></canvas>
          <div class="playback-indicator" style="left: 0; display: none;"></div>
        </div>

        <div class="value-labels">
          <span>${this.minValue}${this.valueUnit}</span>
          <span>${Math.round((this.minValue + this.maxValue) / 2)}${this.valueUnit}</span>
          <span>${this.maxValue}${this.valueUnit}</span>
        </div>

        <div class="current-value-display">
          <span class="label">Current:</span>
          <span class="value" data-current-value>${this.getValueAtProgress(0).toFixed(0)}${this.valueUnit}</span>
        </div>

        <div class="settings-row">
          <div class="setting-group">
            <label>Duration (s)</label>
            <input type="number" data-setting="duration" value="${duration}" min="5" max="600" step="5">
          </div>
          <div class="setting-group">
            <label>
              <input type="checkbox" data-setting="loop" ${isLooping ? 'checked' : ''} style="margin-right: 4px;">
              Loop
            </label>
          </div>
        </div>

        <div class="settings-row" style="margin-top: 8px;">
          <div class="setting-group" style="flex: 2;">
            <label>Curve Type (for new points)</label>
            <div class="curve-type-selector">
              <button class="curve-type-btn active" data-curve-type="smooth">Smooth</button>
              <button class="curve-type-btn" data-curve-type="linear">Linear</button>
              <button class="curve-type-btn" data-curve-type="step">Step</button>
              <button class="curve-type-btn" data-curve-type="sine">Sine</button>
            </div>
          </div>
        </div>

        <div class="tension-slider-container">
          <label>Curve Tension: <span data-tension-display>50%</span></label>
          <input type="range" data-setting="tension" value="50" min="0" max="100" step="5">
        </div>

        <div class="help-text">
          Click on canvas to add points. Drag points to move. Right-click to delete.
        </div>
      </div>
    `;

    // Get canvas and context
    this.canvas = container.querySelector('.automation-curve-canvas');
    this.ctx = this.canvas.getContext('2d');

    // Attach event listeners
    this.attachEventListeners();

    // Initial draw
    this.draw();

    // Start animation loop if enabled and running
    if (isEnabled && this.object.userData.isRunning) {
      this.startAnimation();
    }
  }

  /**
   * Attach mouse and keyboard event listeners
   */
  attachEventListeners() {
    if (!this.canvas || !this.container) return;

    // Canvas mouse events
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
    this.canvas.addEventListener('contextmenu', this.handleContextMenu.bind(this));

    // Button events
    const toggleBtn = this.container.querySelector('[data-action="toggle-enabled"]');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggleEnabled());
    }

    const resetBtn = this.container.querySelector('[data-action="reset"]');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetCurve());
    }

    // Curve type buttons
    const curveTypeBtns = this.container.querySelectorAll('[data-curve-type]');
    curveTypeBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        curveTypeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Settings inputs
    const durationInput = this.container.querySelector('[data-setting="duration"]');
    if (durationInput) {
      durationInput.addEventListener('change', (e) => {
        const durationKey = this.type === 'pitch' ? 'pitchCurveDuration' : 'tempoCurveDuration';
        this.object.userData[durationKey] = parseInt(e.target.value) || 60;
        this.updateTimeLabels();
        this.savePoints();
      });
    }

    const loopInput = this.container.querySelector('[data-setting="loop"]');
    if (loopInput) {
      loopInput.addEventListener('change', (e) => {
        const loopKey = this.type === 'pitch' ? 'pitchCurveLoop' : 'tempoCurveLoop';
        this.object.userData[loopKey] = e.target.checked;
        this.savePoints();
      });
    }

    const tensionInput = this.container.querySelector('[data-setting="tension"]');
    if (tensionInput) {
      tensionInput.addEventListener('input', (e) => {
        const tension = parseInt(e.target.value) / 100;
        const display = this.container.querySelector('[data-tension-display]');
        if (display) display.textContent = e.target.value + '%';

        // Update tension of selected point or all points
        if (this.selectedPointIndex >= 0 && this.selectedPointIndex < this.points.length) {
          this.points[this.selectedPointIndex].tension = tension;
        } else {
          // Update all points
          this.points.forEach(p => p.tension = tension);
        }
        this.draw();
        this.savePoints();
      });
    }
  }

  /**
   * Handle mouse down on canvas
   */
  handleMouseDown(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.width;
    const y = 1 - (e.clientY - rect.top) / this.height;

    // Left click
    if (e.button === 0) {
      // Check if clicking near an existing point
      const clickedPointIndex = this.findPointNear(x, y);

      if (clickedPointIndex >= 0) {
        // Start dragging existing point
        this.selectedPointIndex = clickedPointIndex;
        this.isDragging = true;
        this.canvas.classList.add('dragging');
      } else {
        // Add new point
        this.addPoint(x, y);
        // Select the newly added point
        this.selectedPointIndex = this.findPointNear(x, y);
        this.isDragging = true;
        this.canvas.classList.add('dragging');
      }

      this.draw();
    }
  }

  /**
   * Handle mouse move on canvas
   */
  handleMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.width;
    const y = 1 - (e.clientY - rect.top) / this.height;

    if (this.isDragging && this.selectedPointIndex >= 0) {
      // Move the selected point
      const point = this.points[this.selectedPointIndex];

      // Clamp x to canvas bounds, but don't allow moving past adjacent points
      const minX = this.selectedPointIndex > 0 ? this.points[this.selectedPointIndex - 1].x + 0.01 : 0;
      const maxX = this.selectedPointIndex < this.points.length - 1 ? this.points[this.selectedPointIndex + 1].x - 0.01 : 1;

      // First and last points are locked horizontally
      if (this.selectedPointIndex === 0) {
        point.x = 0;
      } else if (this.selectedPointIndex === this.points.length - 1) {
        point.x = 1;
      } else {
        point.x = Math.max(minX, Math.min(maxX, x));
      }

      // Clamp y to value range
      const clampedY = Math.max(0, Math.min(1, y));
      point.y = this.minValue + clampedY * (this.maxValue - this.minValue);

      this.draw();
      this.updateCurrentValueDisplay(x);
    } else {
      // Hover detection
      const hoverIndex = this.findPointNear(x, y);
      if (hoverIndex !== this.hoverPointIndex) {
        this.hoverPointIndex = hoverIndex;
        this.canvas.style.cursor = hoverIndex >= 0 ? 'grab' : 'crosshair';
        this.draw();
      }
    }
  }

  /**
   * Handle mouse up on canvas
   */
  handleMouseUp(e) {
    if (this.isDragging) {
      this.isDragging = false;
      this.canvas.classList.remove('dragging');
      this.canvas.style.cursor = 'crosshair';
      this.savePoints();
    }
  }

  /**
   * Handle mouse leave
   */
  handleMouseLeave(e) {
    this.hoverPointIndex = -1;
    if (this.isDragging) {
      this.isDragging = false;
      this.canvas.classList.remove('dragging');
      this.savePoints();
    }
    this.draw();
  }

  /**
   * Handle right-click context menu (delete point)
   */
  handleContextMenu(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.width;
    const y = 1 - (e.clientY - rect.top) / this.height;

    const clickedPointIndex = this.findPointNear(x, y);

    // Can't delete first or last point
    if (clickedPointIndex > 0 && clickedPointIndex < this.points.length - 1) {
      this.points.splice(clickedPointIndex, 1);
      this.selectedPointIndex = -1;
      this.draw();
      this.savePoints();
    }
  }

  /**
   * Find a control point near the given coordinates
   * @param {number} x - X coordinate (0-1)
   * @param {number} y - Y coordinate (0-1)
   * @returns {number} Index of the point, or -1 if not found
   */
  findPointNear(x, y) {
    const threshold = 15 / this.width; // 15px threshold in normalized coords

    for (let i = 0; i < this.points.length; i++) {
      const point = this.points[i];
      const pointY = (point.y - this.minValue) / (this.maxValue - this.minValue);
      const dx = point.x - x;
      const dy = pointY - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < threshold) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Add a new control point
   * @param {number} x - X coordinate (0-1)
   * @param {number} y - Y coordinate (0-1)
   */
  addPoint(x, y) {
    // Get current curve type from UI
    const activeBtn = this.container.querySelector('.curve-type-btn.active');
    const curveType = activeBtn ? activeBtn.dataset.curveType : 'smooth';

    // Get current tension from UI
    const tensionInput = this.container.querySelector('[data-setting="tension"]');
    const tension = tensionInput ? parseInt(tensionInput.value) / 100 : 0.5;

    // Convert y from normalized to value range
    const value = this.minValue + Math.max(0, Math.min(1, y)) * (this.maxValue - this.minValue);

    // Find insertion point (keep sorted by x)
    let insertIndex = this.points.length;
    for (let i = 0; i < this.points.length; i++) {
      if (x < this.points[i].x) {
        insertIndex = i;
        break;
      }
    }

    // Insert new point
    this.points.splice(insertIndex, 0, {
      x: Math.max(0, Math.min(1, x)),
      y: value,
      curveType: curveType,
      tension: tension
    });

    this.savePoints();
  }

  /**
   * Toggle the curve enabled state
   */
  toggleEnabled() {
    const enabledKey = this.type === 'pitch' ? 'pitchCurveEnabled' : 'tempoCurveEnabled';
    this.object.userData[enabledKey] = !this.object.userData[enabledKey];

    // Update button text
    const btn = this.container.querySelector('[data-action="toggle-enabled"]');
    if (btn) {
      btn.textContent = this.object.userData[enabledKey] ? 'ON' : 'OFF';
      btn.classList.toggle('active', this.object.userData[enabledKey]);
    }

    // Reset curve start time when enabling
    if (this.object.userData[enabledKey]) {
      const startTimeKey = this.type === 'pitch' ? 'pitchCurveStartTime' : 'tempoCurveStartTime';
      this.object.userData[startTimeKey] = Date.now();
      this.startAnimation();
    } else {
      this.stopAnimation();
    }

    this.savePoints();
  }

  /**
   * Reset the curve to default (linear from current start to end)
   */
  resetCurve() {
    const startValue = this.type === 'pitch'
      ? (this.object.userData.tickPitch || 100)
      : (this.object.userData.bpm || 120);

    this.points = [
      { x: 0, y: startValue, curveType: 'smooth', tension: 0.5 },
      { x: 1, y: startValue, curveType: 'smooth', tension: 0.5 }
    ];

    this.selectedPointIndex = -1;
    this.draw();
    this.savePoints();
  }

  /**
   * Update the time labels based on current duration
   */
  updateTimeLabels() {
    const durationKey = this.type === 'pitch' ? 'pitchCurveDuration' : 'tempoCurveDuration';
    const duration = this.object.userData[durationKey] || 60;

    const labels = this.container.querySelector('.time-labels');
    if (labels) {
      labels.innerHTML = `
        <span>0s</span>
        <span>${Math.round(duration / 2)}s</span>
        <span>${duration}s</span>
      `;
    }
  }

  /**
   * Update the current value display
   */
  updateCurrentValueDisplay(progress) {
    const valueDisplay = this.container.querySelector('[data-current-value]');
    if (valueDisplay) {
      const value = this.getValueAtProgress(progress);
      valueDisplay.textContent = value.toFixed(0) + this.valueUnit;
    }
  }

  /**
   * Save points to the object's userData
   */
  savePoints() {
    const pointsKey = this.type === 'pitch' ? 'pitchCurvePoints' : 'tempoCurvePoints';
    this.object.userData[pointsKey] = [...this.points];

    // Also update legacy start/end values for backwards compatibility
    if (this.points.length >= 2) {
      const startKey = this.type === 'pitch' ? 'pitchCurveStart' : 'tempoCurveStart';
      const endKey = this.type === 'pitch' ? 'pitchCurveEnd' : 'tempoCurveEnd';
      this.object.userData[startKey] = this.points[0].y;
      this.object.userData[endKey] = this.points[this.points.length - 1].y;
    }

    // Call update callback
    this.onUpdate();

    // Trigger global save
    if (typeof saveState === 'function') {
      saveState();
    }
  }

  /**
   * Get the value at a specific progress point (0-1)
   * @param {number} progress - Progress through the curve (0-1)
   * @returns {number} The interpolated value
   */
  getValueAtProgress(progress) {
    if (this.points.length === 0) return this.minValue;
    if (this.points.length === 1) return this.points[0].y;

    // Find the two points that bracket this progress
    let p1Index = 0;
    let p2Index = 1;

    for (let i = 0; i < this.points.length - 1; i++) {
      if (progress >= this.points[i].x && progress <= this.points[i + 1].x) {
        p1Index = i;
        p2Index = i + 1;
        break;
      }
    }

    // Handle edge cases
    if (progress <= this.points[0].x) return this.points[0].y;
    if (progress >= this.points[this.points.length - 1].x) return this.points[this.points.length - 1].y;

    const p1 = this.points[p1Index];
    const p2 = this.points[p2Index];

    // Calculate local progress between the two points
    const localProgress = (progress - p1.x) / (p2.x - p1.x);

    // Apply curve interpolation based on curve type
    return this.interpolate(p1.y, p2.y, localProgress, p1.curveType, p1.tension);
  }

  /**
   * Interpolate between two values based on curve type
   */
  interpolate(v1, v2, t, curveType, tension = 0.5) {
    switch (curveType) {
      case 'linear':
        return v1 + (v2 - v1) * t;

      case 'step':
        return t < 0.5 ? v1 : v2;

      case 'smooth':
        // Smooth S-curve with tension control
        const smoothT = this.smoothstep(t, tension);
        return v1 + (v2 - v1) * smoothT;

      case 'sine':
        // Sine wave interpolation
        const sineT = (1 - Math.cos(t * Math.PI)) / 2;
        return v1 + (v2 - v1) * sineT;

      default:
        return v1 + (v2 - v1) * t;
    }
  }

  /**
   * Smoothstep function with tension control
   */
  smoothstep(t, tension) {
    // Tension 0 = linear, tension 1 = very smooth S-curve
    const power = 1 + tension * 3; // Range from 1 to 4

    if (t < 0.5) {
      return Math.pow(2 * t, power) / 2;
    } else {
      return 1 - Math.pow(2 * (1 - t), power) / 2;
    }
  }

  /**
   * Draw the curve on the canvas
   */
  draw() {
    if (!this.ctx) return;

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Clear canvas
    ctx.clearRect(0, 0, w, h);

    // Draw grid
    this.drawGrid();

    // Draw curve
    this.drawCurve();

    // Draw control points
    this.drawPoints();
  }

  /**
   * Draw the background grid
   */
  drawGrid() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;

    // Vertical lines (time divisions)
    const vDivisions = 8;
    for (let i = 1; i < vDivisions; i++) {
      const x = (w * i) / vDivisions;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Horizontal lines (value divisions)
    const hDivisions = 4;
    for (let i = 1; i < hDivisions; i++) {
      const y = (h * i) / hDivisions;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Draw center line more prominently
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  }

  /**
   * Draw the automation curve
   */
  drawCurve() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    if (this.points.length < 2) return;

    // Draw filled area under curve
    ctx.beginPath();
    ctx.moveTo(0, h);

    // Draw curve path
    const steps = 100;
    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      const value = this.getValueAtProgress(progress);
      const x = progress * w;
      const y = h - ((value - this.minValue) / (this.maxValue - this.minValue)) * h;

      if (i === 0) {
        ctx.lineTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.lineTo(w, h);
    ctx.closePath();

    // Fill with gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(79, 70, 229, 0.4)');
    gradient.addColorStop(1, 'rgba(79, 70, 229, 0.1)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw curve line
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      const value = this.getValueAtProgress(progress);
      const x = progress * w;
      const y = h - ((value - this.minValue) / (this.maxValue - this.minValue)) * h;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.strokeStyle = 'rgba(129, 140, 248, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /**
   * Draw control points
   */
  drawPoints() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    for (let i = 0; i < this.points.length; i++) {
      const point = this.points[i];
      const x = point.x * w;
      const y = h - ((point.y - this.minValue) / (this.maxValue - this.minValue)) * h;

      const isSelected = i === this.selectedPointIndex;
      const isHovered = i === this.hoverPointIndex;
      const isEndpoint = i === 0 || i === this.points.length - 1;

      // Draw outer ring for selected/hovered
      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(129, 140, 248, 0.3)';
        ctx.fill();
      }

      // Draw point
      ctx.beginPath();
      ctx.arc(x, y, isEndpoint ? 7 : 6, 0, Math.PI * 2);

      if (isEndpoint) {
        ctx.fillStyle = isSelected ? '#22c55e' : '#818cf8';
      } else {
        ctx.fillStyle = isSelected ? '#22c55e' : (isHovered ? '#a5b4fc' : '#4f46e5');
      }
      ctx.fill();

      // Draw border
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  /**
   * Start the playback position animation
   */
  startAnimation() {
    if (this.animationFrameId) return;

    const animate = () => {
      this.updatePlaybackPosition();
      this.animationFrameId = requestAnimationFrame(animate);
    };

    animate();
  }

  /**
   * Stop the playback position animation
   */
  stopAnimation() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Hide playback indicator
    const indicator = this.container.querySelector('.playback-indicator');
    if (indicator) {
      indicator.style.display = 'none';
    }
  }

  /**
   * Update the playback position indicator
   */
  updatePlaybackPosition() {
    const enabledKey = this.type === 'pitch' ? 'pitchCurveEnabled' : 'tempoCurveEnabled';
    const startTimeKey = this.type === 'pitch' ? 'pitchCurveStartTime' : 'tempoCurveStartTime';
    const durationKey = this.type === 'pitch' ? 'pitchCurveDuration' : 'tempoCurveDuration';
    const loopKey = this.type === 'pitch' ? 'pitchCurveLoop' : 'tempoCurveLoop';

    if (!this.object.userData[enabledKey] || !this.object.userData.isRunning) {
      this.stopAnimation();
      return;
    }

    const startTime = this.object.userData[startTimeKey] || Date.now();
    const duration = this.object.userData[durationKey] || 60;
    const isLooping = this.object.userData[loopKey] || false;

    const elapsed = (Date.now() - startTime) / 1000;
    let progress = elapsed / duration;

    if (isLooping) {
      progress = progress % 1;
    } else {
      progress = Math.min(progress, 1);
    }

    // Update indicator position
    const indicator = this.container.querySelector('.playback-indicator');
    if (indicator) {
      indicator.style.display = 'block';
      indicator.style.left = (progress * this.width) + 'px';
    }

    // Update current value display
    this.updateCurrentValueDisplay(progress);
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.stopAnimation();
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

// Store active curve editors for reference
const activeCurveEditors = new Map();

/**
 * Create an automation curve editor for a metronome object
 * @param {Object} object - The metronome object
 * @param {string} type - 'pitch' or 'tempo'
 * @param {string} containerId - The container element ID
 * @returns {AutomationCurveEditor} The editor instance
 */
function createAutomationCurveEditor(object, type, containerId) {
  // Clean up existing editor if any
  const existingKey = `${object.uuid}-${type}`;
  if (activeCurveEditors.has(existingKey)) {
    activeCurveEditors.get(existingKey).destroy();
  }

  const editor = new AutomationCurveEditor({
    containerId: containerId,
    type: type,
    object: object,
    onUpdate: () => {
      // Editor updated callback
    }
  });

  activeCurveEditors.set(existingKey, editor);
  return editor;
}

/**
 * Get the curve value at a given progress for an object
 * This is used by the metronome animation code to get the current pitch/tempo
 * @param {Object} object - The metronome object
 * @param {string} type - 'pitch' or 'tempo'
 * @param {number} progress - Progress through the curve (0-1)
 * @returns {number} The interpolated value
 */
function getCurveValueAtProgress(object, type, progress) {
  const pointsKey = type === 'pitch' ? 'pitchCurvePoints' : 'tempoCurvePoints';
  const points = object.userData[pointsKey];

  // If no custom points, fall back to legacy linear interpolation
  if (!points || points.length < 2) {
    const startKey = type === 'pitch' ? 'pitchCurveStart' : 'tempoCurveStart';
    const endKey = type === 'pitch' ? 'pitchCurveEnd' : 'tempoCurveEnd';
    const typeKey = type === 'pitch' ? 'pitchCurveType' : 'tempoCurveType';

    const startValue = object.userData[startKey] || (type === 'pitch' ? 100 : 60);
    const endValue = object.userData[endKey] || (type === 'pitch' ? 100 : 120);
    const curveType = object.userData[typeKey] || 'linear';

    // Apply legacy curve type
    let easedProgress = progress;
    switch (curveType) {
      case 'ease-in':
        easedProgress = progress * progress;
        break;
      case 'ease-out':
        easedProgress = 1 - (1 - progress) * (1 - progress);
        break;
      case 'sine':
        easedProgress = (Math.sin(progress * Math.PI * 2 - Math.PI / 2) + 1) / 2;
        break;
    }

    return startValue + (endValue - startValue) * easedProgress;
  }

  // Use custom points
  if (points.length === 1) return points[0].y;

  // Find the two points that bracket this progress
  let p1Index = 0;
  let p2Index = 1;

  for (let i = 0; i < points.length - 1; i++) {
    if (progress >= points[i].x && progress <= points[i + 1].x) {
      p1Index = i;
      p2Index = i + 1;
      break;
    }
  }

  // Handle edge cases
  if (progress <= points[0].x) return points[0].y;
  if (progress >= points[points.length - 1].x) return points[points.length - 1].y;

  const p1 = points[p1Index];
  const p2 = points[p2Index];

  // Calculate local progress between the two points
  const localProgress = (progress - p1.x) / (p2.x - p1.x);

  // Apply curve interpolation based on curve type
  return interpolateCurveValue(p1.y, p2.y, localProgress, p1.curveType, p1.tension);
}

/**
 * Interpolate between two values based on curve type (standalone function)
 */
function interpolateCurveValue(v1, v2, t, curveType, tension = 0.5) {
  switch (curveType) {
    case 'linear':
      return v1 + (v2 - v1) * t;

    case 'step':
      return t < 0.5 ? v1 : v2;

    case 'smooth':
      // Smooth S-curve with tension control
      const power = 1 + tension * 3;
      let smoothT;
      if (t < 0.5) {
        smoothT = Math.pow(2 * t, power) / 2;
      } else {
        smoothT = 1 - Math.pow(2 * (1 - t), power) / 2;
      }
      return v1 + (v2 - v1) * smoothT;

    case 'sine':
      // Sine wave interpolation
      const sineT = (1 - Math.cos(t * Math.PI)) / 2;
      return v1 + (v2 - v1) * sineT;

    default:
      return v1 + (v2 - v1) * t;
  }
}

// ============================================================================
// CAMERA CONTROL POINTS (Starting position and direction)
// ============================================================================
// These control points define the default camera state at startup.
// Based on the original camera.lookAt(CONFIG.camera.lookAt) behavior.
// To change the starting view, modify CONFIG.camera.position and CONFIG.camera.lookAt.
function calculateCameraAnglesFromLookAt(cameraPos, lookAtPos) {
  // Calculate direction vector from camera to lookAt point
  const dx = lookAtPos.x - cameraPos.x;
  const dy = lookAtPos.y - cameraPos.y;
  const dz = lookAtPos.z - cameraPos.z;

  // Calculate total length for pitch calculation
  const totalLen = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // yaw: horizontal angle from positive z axis (using atan2 for correct quadrant)
  const yaw = Math.atan2(dx, dz);

  // pitch: vertical angle (negative when looking down)
  const pitch = Math.asin(dy / totalLen);

  return { yaw, pitch };
}

// Calculate default angles from CONFIG control points
const DEFAULT_CAMERA_ANGLES = calculateCameraAnglesFromLookAt(
  CONFIG.camera.position,
  CONFIG.camera.lookAt
);

// First-person camera look state
let cameraLookState = {
  isLooking: true,   // Always enabled by default (FPS-style)
  sensitivity: 0.002,
  // Initial angles calculated from CONFIG.camera.lookAt control point
  yaw: DEFAULT_CAMERA_ANGLES.yaw,     // Horizontal rotation - facing the desk
  pitch: DEFAULT_CAMERA_ANGLES.pitch, // Vertical rotation - looking down at desk surface
  minPitch: -1.55,   // Looking down limit - ~89 degrees (just before -90° to prevent camera flip)
  maxPitch: 0.42,    // Looking up limit - extended by ~10 degrees more (~24 degrees total)
  // Yaw limits centered around the default yaw (±1.40 radians ~ ±80 degrees)
  // Extended by 10 degrees to reach all desk corners
  minYaw: DEFAULT_CAMERA_ANGLES.yaw - 1.40,  // Limit horizontal rotation to left
  maxYaw: DEFAULT_CAMERA_ANGLES.yaw + 1.40   // Limit horizontal rotation to right
};

// Physics state for objects
const physicsState = {
  enabled: true,
  velocities: new Map(),         // Store velocity for each object (x, z)
  angularVelocities: new Map(),  // Store angular velocity for each object (y-axis spin)
  tiltState: new Map(),          // Store tilt state for each object (x, z tilt angles)
  tiltVelocities: new Map(),     // Store tilt velocity for each object
  lastDragPosition: null,        // Track drag position for velocity calculation
  lastDragTime: 0,               // Track time for velocity calculation
  dragVelocity: { x: 0, z: 0 },  // Velocity of dragged object
  friction: 0.85,
  bounceFactor: 0.4,
  pushForce: 0.04,               // Reduced base push force (was 0.08)
  minPushSpeed: 0.02,            // Minimum drag speed needed to apply full push force
  tiltForce: 0.08,               // Reduced tilt force (was 0.15) - objects harder to tip
  tiltRecovery: 0.08,            // Increased recovery (was 0.05) - objects return upright faster
  maxTilt: Math.PI / 3,          // Maximum tilt before falling over (~60 degrees)
  tipOverThreshold: Math.PI / 4, // Angle at which object tips over completely (~45 degrees)
  // Performance optimization: only run full physics when objects are moving
  lastPhysicsTime: 0,
  physicsInterval: 32,           // Run physics every 32ms (~30fps) instead of every frame
  hasActivePhysics: false,       // Track if any object is moving
  // Stacking physics - friction-based pulling of stacked objects
  stackingFriction: 0.7,         // Base friction coefficient (0-1) - how strongly objects on top are pulled
  stackingSlipThreshold: 0.15   // Velocity threshold above which objects on top start to slip
};

// Object weight/stability configurations (affects how easily they tip)
// baseOffset is the distance from the object's origin to its bottom (for Y position correction when scaling)
// friction: coefficient of friction (0-1) - how grippy the object's surface is
//           Higher = more friction = objects on top stay in place better when moving
// noStackingOnTop: if true, objects cannot be stacked on top of this object (e.g., round/unstable surfaces)
const OBJECT_PHYSICS = {
  'clock': { weight: 0.5, stability: 0.5, height: 0.6, baseOffset: 0.35, friction: 0.4, noStackingOnTop: true },      // Round clock face - objects slide off
  'lamp': { weight: 1.2, stability: 0.85, height: 0.9, baseOffset: 0, friction: 0.5 },         // Heavy base, metal/ceramic
  'plant': { weight: 1.4, stability: 0.9, height: 0.5, baseOffset: 0, friction: 0.6 },         // Heavy pot, ceramic
  'coffee': { weight: 0.4, stability: 0.6, height: 0.3, baseOffset: 0, friction: 0.5 },        // Ceramic mug
  'laptop': { weight: 1.5, stability: 0.95, height: 0.3, baseOffset: 0, friction: 0.6 },       // Rubber feet, grippy
  'notebook': { weight: 0.3, stability: 0.95, height: 0.1, baseOffset: 0, friction: 0.7 },     // Paper/cardboard, very grippy
  'pen-holder': { weight: 0.6, stability: 0.6, height: 0.4, baseOffset: 0, friction: 0.5 },    // Ceramic/wood
  'pen': { weight: 0.05, stability: 0.2, height: 0.35, baseOffset: 0, friction: 0.3 },         // Smooth plastic, slides easily
  'books': { weight: 0.8, stability: 0.9, height: 0.15, baseOffset: 0, friction: 0.75 },       // Paper/cardboard, very grippy
  'magazine': { weight: 0.3, stability: 0.95, height: 0.02, baseOffset: 0, friction: 0.65 },   // Glossy paper, still grippy
  'photo-frame': { weight: 0.3, stability: 0.35, height: 0.5, baseOffset: 0.25, friction: 0.4, noStackingOnTop: true },// Tilted frame - objects slide off
  'globe': { weight: 1.0, stability: 0.7, height: 0.5, baseOffset: 0.025, friction: 0.45 },    // Smooth plastic base
  'trophy': { weight: 0.9, stability: 0.6, height: 0.4, baseOffset: 0, friction: 0.5 },        // Metal/marble base
  'hourglass': { weight: 0.5, stability: 0.45, height: 0.35, baseOffset: 0.015, friction: 0.4 },// Smooth glass/wood
  'metronome': { weight: 0.7, stability: 0.7, height: 0.45, baseOffset: 0, friction: 0.55 },   // Wood, moderate grip
  'paper': { weight: 0.05, stability: 0.98, height: 0.01, baseOffset: 0, friction: 0.8 },      // Paper, very grippy
  'cassette-player': { weight: 0.3, stability: 0.85, height: 0.08, baseOffset: 0, friction: 0.6 },  // Mini Walkman - compact plastic, moderate grip
  'big-cassette-player': { weight: 0.6, stability: 0.9, height: 0.12, baseOffset: 0, friction: 0.65 } // Big Walkman - larger plastic, good grip
};

// Adjust object Y position when scaling to keep bottom on desk surface
function adjustObjectYForScale(object, oldScale, newScale) {
  const type = object.userData.type;
  const physics = OBJECT_PHYSICS[type];
  if (!physics || physics.baseOffset === undefined) return;

  // The object's originalY is set for scale=1. When scaling, the bottom moves:
  // At scale 1: bottom is at originalY - baseOffset
  // At scale S: bottom would be at position.y - baseOffset * S
  // To keep bottom at desk: position.y = deskY + baseOffset * S
  const deskY = getDeskSurfaceY();
  const baseOffset = physics.baseOffset;

  // Calculate the original Y position at scale 1 (without the scale adjustment)
  const baseOriginalY = deskY + baseOffset;

  // New Y position should be: deskY + baseOffset * newScale
  const newY = deskY + baseOffset * newScale;

  object.position.y = newY;
  object.userData.originalY = newY;
  object.userData.targetY = newY;
}

// ============================================================================
// INITIALIZATION
// ============================================================================
function init() {
  // Create scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.colors.background);

  // Create camera (first-person desk view)
  // CONTROL POINTS: Position from CONFIG.camera.position, direction from CONFIG.camera.lookAt
  const aspect = window.innerWidth / window.innerHeight;
  camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, aspect, CONFIG.camera.near, CONFIG.camera.far);
  camera.position.set(CONFIG.camera.position.x, CONFIG.camera.position.y, CONFIG.camera.position.z);
  // Apply initial camera look direction based on CONFIG.camera.lookAt control point
  // The yaw/pitch are calculated from the lookAt point in DEFAULT_CAMERA_ANGLES
  updateCameraLook();

  // Create renderer - disable antialiasing for pixel art effect
  renderer = new THREE.WebGLRenderer({ antialias: !CONFIG.pixelation.enabled });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(CONFIG.pixelation.enabled ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  // Handle WebGL context lost and restored events to prevent gray screen
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    console.warn('WebGL context lost - attempting recovery');
  }, false);

  renderer.domElement.addEventListener('webglcontextrestored', () => {
    console.log('WebGL context restored - reinitializing');
    // Reinitialize pixel art post-processing if enabled
    if (CONFIG.pixelation.enabled) {
      setupPixelArtPostProcessing();
    }
  }, false);

  // Setup pixel art post-processing if enabled
  if (CONFIG.pixelation.enabled) {
    setupPixelArtPostProcessing();
  }

  // Create raycaster for mouse interaction
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Create invisible drag plane
  const planeGeometry = new THREE.PlaneGeometry(100, 100);
  const planeMaterial = new THREE.MeshBasicMaterial({ visible: false });
  dragPlane = new THREE.Mesh(planeGeometry, planeMaterial);
  dragPlane.rotation.x = -Math.PI / 2;
  dragPlane.position.y = CONFIG.desk.height;  // No legs, just surface
  scene.add(dragPlane);

  // Setup lighting
  setupLighting();

  // Create desk
  createDesk();

  // Create floor
  createFloor();

  // Setup event listeners
  setupEventListeners();

  // Initialize previousMousePosition to screen center to prevent jump on first move
  previousMousePosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  // Load saved state
  loadState();

  // Initialize FFmpeg status
  initializeFfmpegStatus();

  // Start animation loop
  animate();

  // Start clock update
  updateClock();
  setInterval(updateClock, 1000);

  // Hide loading screen
  setTimeout(() => {
    document.getElementById('loading').classList.add('hidden');
  }, 500);
}

// ============================================================================
// FFMPEG STATUS INITIALIZATION
// ============================================================================
async function initializeFfmpegStatus() {
  // Listen for FFmpeg status updates from main process (sent on app start)
  if (window.electronAPI && window.electronAPI.onFfmpegStatus) {
    window.electronAPI.onFfmpegStatus((available) => {
      console.log('FFmpeg status received from main process:', available);
      ffmpegAvailable = available;
    });
  }

  // Also request current status immediately
  if (window.electronAPI && window.electronAPI.getFfmpegStatus) {
    try {
      const result = await window.electronAPI.getFfmpegStatus();
      ffmpegAvailable = result.available;
      console.log('FFmpeg status on init:', ffmpegAvailable ? 'available' : 'not available');
    } catch (error) {
      console.error('Failed to get FFmpeg status:', error);
      ffmpegAvailable = false;
    }
  }
}

// ============================================================================
// PIXEL ART POST-PROCESSING SETUP (Signalis-style)
// ============================================================================
function setupPixelArtPostProcessing() {
  const pixelSize = CONFIG.pixelation.pixelSize;

  // Calculate render resolution (lower resolution for pixel art effect)
  const width = Math.floor(window.innerWidth / pixelSize);
  const height = Math.floor(window.innerHeight / pixelSize);
  renderResolution.set(width, height);

  // Create render target for the main scene (low resolution)
  pixelRenderTarget = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType
  });
  pixelRenderTarget.depthTexture = new THREE.DepthTexture(width, height);

  // Create render target for normals (for edge detection)
  normalRenderTarget = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType
  });

  // Material for rendering normals
  normalMaterial = new THREE.MeshNormalMaterial();

  // Create fullscreen quad for post-processing
  fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  fsGeometry = new THREE.BufferGeometry();
  fsGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  fsGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));

  // Create the pixelated shader material
  pixelatedMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      tNormal: { value: null },
      resolution: { value: new THREE.Vector4(width, height, 1 / width, 1 / height) },
      normalEdgeStrength: { value: CONFIG.pixelation.normalEdgeStrength },
      depthEdgeStrength: { value: CONFIG.pixelation.depthEdgeStrength }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      uniform sampler2D tNormal;
      uniform vec4 resolution;
      uniform float normalEdgeStrength;
      uniform float depthEdgeStrength;
      varying vec2 vUv;

      float getDepth(int x, int y) {
        return texture2D(tDepth, vUv + vec2(x, y) * resolution.zw).r;
      }

      vec3 getNormal(int x, int y) {
        return texture2D(tNormal, vUv + vec2(x, y) * resolution.zw).rgb * 2.0 - 1.0;
      }

      float depthEdgeIndicator(float depth, vec3 normal) {
        float diff = 0.0;
        diff += clamp(getDepth(1, 0) - depth, 0.0, 1.0);
        diff += clamp(getDepth(-1, 0) - depth, 0.0, 1.0);
        diff += clamp(getDepth(0, 1) - depth, 0.0, 1.0);
        diff += clamp(getDepth(0, -1) - depth, 0.0, 1.0);
        return floor(smoothstep(0.01, 0.02, diff) * 2.0) / 2.0;
      }

      float neighborNormalEdgeIndicator(int x, int y, float depth, vec3 normal) {
        float depthDiff = getDepth(x, y) - depth;
        vec3 neighborNormal = getNormal(x, y);
        vec3 normalEdgeBias = vec3(1.0, 1.0, 1.0);
        float normalDiff = dot(normal - neighborNormal, normalEdgeBias);
        float normalIndicator = clamp(smoothstep(-0.01, 0.01, normalDiff), 0.0, 1.0);
        float depthIndicator = clamp(sign(depthDiff * 0.25 + 0.0025), 0.0, 1.0);
        return (1.0 - dot(normal, neighborNormal)) * depthIndicator * normalIndicator;
      }

      float normalEdgeIndicator(float depth, vec3 normal) {
        float indicator = 0.0;
        indicator += neighborNormalEdgeIndicator(0, -1, depth, normal);
        indicator += neighborNormalEdgeIndicator(0, 1, depth, normal);
        indicator += neighborNormalEdgeIndicator(-1, 0, depth, normal);
        indicator += neighborNormalEdgeIndicator(1, 0, depth, normal);
        return step(0.1, indicator);
      }

      void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        float depth = 0.0;
        vec3 normal = vec3(0.0);

        if (depthEdgeStrength > 0.0 || normalEdgeStrength > 0.0) {
          depth = getDepth(0, 0);
          normal = getNormal(0, 0);
        }

        float dei = 0.0;
        if (depthEdgeStrength > 0.0) {
          dei = depthEdgeIndicator(depth, normal);
        }

        float nei = 0.0;
        if (normalEdgeStrength > 0.0) {
          nei = normalEdgeIndicator(depth, normal);
        }

        // Apply edge darkening for that crisp pixel art outline look
        float edgeFactor = dei > 0.0 ? (1.0 - depthEdgeStrength * dei) : (1.0 + normalEdgeStrength * nei);

        gl_FragColor = texel * edgeFactor;
      }
    `
  });

  fsQuad = new THREE.Mesh(fsGeometry, pixelatedMaterial);
}

function updatePixelArtRenderTargets() {
  if (!CONFIG.pixelation.enabled) return;

  const pixelSize = CONFIG.pixelation.pixelSize;
  const width = Math.floor(window.innerWidth / pixelSize);
  const height = Math.floor(window.innerHeight / pixelSize);
  renderResolution.set(width, height);

  pixelRenderTarget.setSize(width, height);
  normalRenderTarget.setSize(width, height);

  pixelatedMaterial.uniforms.resolution.value.set(width, height, 1 / width, 1 / height);
}

// ============================================================================
// LIGHTING SETUP
// ============================================================================
function setupLighting() {
  // Ambient light for overall illumination
  const ambientLight = new THREE.AmbientLight(CONFIG.colors.ambient, 0.6);
  scene.add(ambientLight);

  // Main directional light (sun-like)
  const directionalLight = new THREE.DirectionalLight(CONFIG.colors.directional, 0.8);
  directionalLight.position.set(5, 10, 7);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 50;
  directionalLight.shadow.camera.left = -10;
  directionalLight.shadow.camera.right = 10;
  directionalLight.shadow.camera.top = 10;
  directionalLight.shadow.camera.bottom = -10;
  scene.add(directionalLight);

  // Secondary fill light
  const fillLight = new THREE.DirectionalLight(0x6366f1, 0.3);
  fillLight.position.set(-5, 5, -5);
  scene.add(fillLight);

  // Subtle rim light
  const rimLight = new THREE.DirectionalLight(0xf472b6, 0.2);
  rimLight.position.set(0, 3, -10);
  scene.add(rimLight);
}

// ============================================================================
// DESK CREATION
// ============================================================================
function createDesk() {
  const deskGroup = new THREE.Group();

  // Desktop surface - flat like a PC desktop view
  const topGeometry = new THREE.BoxGeometry(CONFIG.desk.width, CONFIG.desk.height, CONFIG.desk.depth);
  const topMaterial = new THREE.MeshStandardMaterial({
    color: CONFIG.desk.color,
    roughness: 0.7,
    metalness: 0.1
  });
  const deskTop = new THREE.Mesh(topGeometry, topMaterial);
  deskTop.position.y = CONFIG.desk.height / 2;
  deskTop.castShadow = true;
  deskTop.receiveShadow = true;
  deskGroup.add(deskTop);

  // No legs - this is a top-down view like a PC desktop

  desk = deskGroup;
  scene.add(desk);
}

// ============================================================================
// FLOOR CREATION
// ============================================================================
function createFloor() {
  const floorGeometry = new THREE.PlaneGeometry(20, 20);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.ground,
    roughness: 0.9,
    metalness: 0
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}

// ============================================================================
// PRESET OBJECT CREATION
// ============================================================================
const PRESET_CREATORS = {
  clock: createClock,
  lamp: createLamp,
  plant: createPlant,
  coffee: createCoffeeMug,
  laptop: createLaptop,
  notebook: createNotebook,
  'pen-holder': createPenHolder,
  pen: createPen,
  books: createBooks,
  magazine: createMagazine,
  'photo-frame': createPhotoFrame,
  globe: createGlobe,
  trophy: createTrophy,
  hourglass: createHourglass,
  paper: createPaper,
  metronome: createMetronome,
  'cassette-player': createCassettePlayer,
  'big-cassette-player': createBigCassettePlayer,
  dictaphone: createDictaphone
};

// ============================================================================
// PALETTE CATEGORIES - Photoshop-style tool palette with variants
// ============================================================================
// Categories based on issue requirements:
// - Clocks (часы): clock, hourglass
// - Lighting (осветительные приборы): lamp
// - Writing (то на чём можно писать): notebook, paper, pen, pen-holder
// - Books (книги): books, magazine
// - Audio (звуковое): metronome
// - Trinkets (безделушки): coffee, plant, globe, trophy
// - Photo Frames (фоторамки): photo-frame
// - Tech: laptop (separate category for work devices)
const PALETTE_CATEGORIES = {
  clocks: {
    name: 'Clocks',
    icon: '🕐',
    variants: [
      { id: 'clock', name: 'Wall Clock', icon: '🕐' },
      { id: 'hourglass', name: 'Hourglass', icon: '⏳' }
    ],
    activeIndex: 0
  },
  lighting: {
    name: 'Lighting',
    icon: '💡',
    variants: [
      { id: 'lamp', name: 'Desk Lamp', icon: '💡' }
    ],
    activeIndex: 0
  },
  writing: {
    name: 'Writing',
    icon: '📝',
    variants: [
      { id: 'notebook', name: 'Notebook', icon: '📓' },
      { id: 'paper', name: 'Paper', icon: '📄' },
      { id: 'pen', name: 'Pen', icon: '🖌️' },
      { id: 'pen-holder', name: 'Pen Holder', icon: '🖊️' }
    ],
    activeIndex: 0
  },
  books: {
    name: 'Books',
    icon: '📚',
    variants: [
      { id: 'books', name: 'Book', icon: '📕' },
      { id: 'magazine', name: 'Magazine', icon: '📰' }
    ],
    activeIndex: 0
  },
  audio: {
    name: 'Audio',
    icon: '🎵',
    variants: [
      { id: 'metronome', name: 'Metronome', icon: '🎵' },
      { id: 'cassette-player', name: 'Mini Player', icon: '📼' },
      { id: 'big-cassette-player', name: 'Big Player', icon: '📻' },
      { id: 'dictaphone', name: 'Dictaphone', icon: '🎙️' }
    ],
    activeIndex: 0
  },
  trinkets: {
    name: 'Trinkets',
    icon: '🎁',
    variants: [
      { id: 'coffee', name: 'Coffee Mug', icon: '☕' },
      { id: 'plant', name: 'Plant', icon: '🌱' },
      { id: 'globe', name: 'Globe', icon: '🌍' },
      { id: 'trophy', name: 'Trophy', icon: '🏆' }
    ],
    activeIndex: 0
  },
  frames: {
    name: 'Photo Frames',
    icon: '🖼️',
    variants: [
      { id: 'photo-frame', name: 'Photo Frame', icon: '🖼️' }
    ],
    activeIndex: 0
  },
  tech: {
    name: 'Tech',
    icon: '💻',
    variants: [
      { id: 'laptop', name: 'Laptop', icon: '💻' }
    ],
    activeIndex: 0
  }
};

// Palette state
let paletteState = {
  hoveredCategory: null,
  contextMenuCategory: null
};

function createClock(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'clock',
    name: 'Clock',
    interactive: true,
    mainColor: options.mainColor || '#ffffff',
    accentColor: options.accentColor || '#1e293b'
  };

  // Clock body (frame)
  const bodyGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 32);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.3,
    metalness: 0.5
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  group.add(body);

  // Clock face (white background)
  const faceGeometry = new THREE.CircleGeometry(0.35, 32);
  const faceMaterial = new THREE.MeshStandardMaterial({
    color: 0xfafafa,
    roughness: 0.5
  });
  const face = new THREE.Mesh(faceGeometry, faceMaterial);
  face.position.z = 0.051;
  group.add(face);

  // Add hour markers (12 small dots around the dial)
  const markerMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.3,
    metalness: 0.5
  });

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2; // Start at 12 o'clock
    const radius = 0.28;
    const markerSize = (i % 3 === 0) ? 0.025 : 0.015; // Larger markers at 12, 3, 6, 9

    const markerGeometry = new THREE.CircleGeometry(markerSize, 8);
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0.052
    );
    group.add(marker);
  }

  // Hand material
  const handMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.3,
    metalness: 0.7
  });

  // Hour hand - pivot group (rotates around center)
  const hourPivot = new THREE.Group();
  hourPivot.name = 'hourHand';
  hourPivot.position.z = 0.06;

  // Hour hand geometry (offset so one end is at pivot)
  const hourGeometry = new THREE.BoxGeometry(0.035, 0.15, 0.02);
  const hourHand = new THREE.Mesh(hourGeometry, handMaterial);
  hourHand.position.y = 0.075; // Half the length, so it pivots from one end
  hourPivot.add(hourHand);
  group.add(hourPivot);

  // Minute hand - pivot group
  const minutePivot = new THREE.Group();
  minutePivot.name = 'minuteHand';
  minutePivot.position.z = 0.07;

  // Minute hand geometry
  const minuteGeometry = new THREE.BoxGeometry(0.025, 0.22, 0.02);
  const minuteHand = new THREE.Mesh(minuteGeometry, handMaterial);
  minuteHand.position.y = 0.11; // Half the length
  minutePivot.add(minuteHand);
  group.add(minutePivot);

  // Second hand - pivot group
  const secondPivot = new THREE.Group();
  secondPivot.name = 'secondHand';
  secondPivot.position.z = 0.08;

  const secondMaterial = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    roughness: 0.3,
    metalness: 0.5
  });

  // Second hand geometry
  const secondGeometry = new THREE.BoxGeometry(0.012, 0.26, 0.01);
  const secondHand = new THREE.Mesh(secondGeometry, secondMaterial);
  secondHand.position.y = 0.13; // Half the length
  secondPivot.add(secondHand);
  group.add(secondPivot);

  // Alarm hand - pivot group (red, positioned behind second hand, initially hidden)
  const alarmPivot = new THREE.Group();
  alarmPivot.name = 'alarmHand';
  alarmPivot.position.z = 0.055; // Behind other hands
  alarmPivot.visible = false; // Hidden by default until alarm is set

  const alarmMaterial = new THREE.MeshStandardMaterial({
    color: 0xff4444, // Bright red
    roughness: 0.3,
    metalness: 0.5,
    emissive: 0xff2222,
    emissiveIntensity: 0.3
  });

  // Alarm hand geometry - triangular/arrow shape pointing to alarm time
  const alarmGeometry = new THREE.BoxGeometry(0.04, 0.18, 0.01);
  const alarmHand = new THREE.Mesh(alarmGeometry, alarmMaterial);
  alarmHand.position.y = 0.09; // Half the length
  alarmPivot.add(alarmHand);

  // Small circle at the tip to make it distinctive
  const alarmTipGeometry = new THREE.CircleGeometry(0.02, 8);
  const alarmTip = new THREE.Mesh(alarmTipGeometry, alarmMaterial);
  alarmTip.position.y = 0.18;
  alarmTip.position.z = 0.005;
  alarmPivot.add(alarmTip);

  group.add(alarmPivot);

  // Center dot (covers pivot point)
  const centerGeometry = new THREE.SphereGeometry(0.035, 16, 16);
  const centerMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.2,
    metalness: 0.8
  });
  const center = new THREE.Mesh(centerGeometry, centerMaterial);
  center.position.z = 0.09;
  group.add(center);

  // Stand
  const standGeometry = new THREE.BoxGeometry(0.1, 0.3, 0.2);
  const standMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.4,
    metalness: 0.3
  });
  const stand = new THREE.Mesh(standGeometry, standMaterial);
  stand.position.y = -0.15;
  stand.castShadow = true;
  group.add(stand);

  // Rotate to stand upright on desk
  group.rotation.x = -Math.PI / 6;
  group.position.y = getDeskSurfaceY() + 0.35;

  return group;
}

function createLamp(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'lamp',
    name: 'Desk Lamp',
    interactive: true,
    isOn: true,
    mainColor: options.mainColor || '#64748b',
    accentColor: options.accentColor || '#fbbf24'
  };

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.9,   // Very rough = no glare
    metalness: 0.0    // No metalness = no reflections
  });

  // Heavy circular base for stability
  const baseGeometry = new THREE.CylinderGeometry(0.25, 0.28, 0.05, 32);
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.025;
  base.castShadow = true;
  group.add(base);

  // Vertical post from base
  const postGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.15, 16);
  const post = new THREE.Mesh(postGeometry, baseMaterial);
  post.position.y = 0.125;
  post.castShadow = true;
  group.add(post);

  // First angled arm segment (going up and forward at ~60 degrees)
  const arm1Group = new THREE.Group();
  arm1Group.position.set(0, 0.2, 0);
  arm1Group.rotation.z = -Math.PI / 6;  // Tilt forward ~30 degrees

  const arm1Geometry = new THREE.CylinderGeometry(0.015, 0.015, 0.45, 16);
  const arm1 = new THREE.Mesh(arm1Geometry, baseMaterial);
  arm1.position.y = 0.225;  // Center of arm
  arm1.castShadow = true;
  arm1Group.add(arm1);

  // Joint at top of first arm
  const joint1Geometry = new THREE.SphereGeometry(0.025, 16, 16);
  const joint1 = new THREE.Mesh(joint1Geometry, baseMaterial);
  joint1.position.y = 0.45;
  arm1Group.add(joint1);

  group.add(arm1Group);

  // Second arm segment (angled to bring lamp head forward)
  const arm2Group = new THREE.Group();
  // Position at the joint of first arm (accounting for arm1Group rotation)
  arm2Group.position.set(0.225, 0.59, 0);
  arm2Group.rotation.z = Math.PI / 4;  // Angle back ~45 degrees

  const arm2Geometry = new THREE.CylinderGeometry(0.015, 0.015, 0.35, 16);
  const arm2 = new THREE.Mesh(arm2Geometry, baseMaterial);
  arm2.position.y = 0.175;
  arm2.castShadow = true;
  arm2Group.add(arm2);

  group.add(arm2Group);

  // Lamp head (round shade pointing down at ~4-10 degree angle)
  const headGroup = new THREE.Group();
  // Position at end of second arm
  headGroup.position.set(0.35, 0.83, 0);
  // Rotate to point slightly forward and down (~7 degrees from vertical)
  headGroup.rotation.z = Math.PI / 25;  // ~7.2 degrees forward tilt

  // Outer shade (dome shape) - dome curving over top, open at bottom
  // Use the TOP hemisphere (thetaStart=0, thetaLength=π/2) - from north pole to equator
  // This creates a dome that curves from top down to the rim, with opening facing down
  const shadeGeometry = new THREE.SphereGeometry(0.15, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const shade = new THREE.Mesh(shadeGeometry, baseMaterial);
  // Position the shade so the opening (equator) is at y=0 and dome curves upward from there
  shade.position.y = 0;
  shade.castShadow = true;
  headGroup.add(shade);

  // Shade rim
  const rimGeometry = new THREE.TorusGeometry(0.15, 0.01, 8, 32);
  const rim = new THREE.Mesh(rimGeometry, baseMaterial);
  rim.rotation.x = Math.PI / 2;
  headGroup.add(rim);

  // Light bulb (round, visible from below)
  const bulbGeometry = new THREE.SphereGeometry(0.08, 16, 16);
  const bulbMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    emissive: new THREE.Color(group.userData.accentColor),
    emissiveIntensity: 1.5,
    roughness: 0.2
  });
  const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
  bulb.position.y = -0.05;  // Slightly below shade rim
  bulb.name = 'bulb';
  headGroup.add(bulb);

  // SpotLight for focused beam - brighter main light
  const spotLight = new THREE.SpotLight(
    new THREE.Color(group.userData.accentColor),
    6.0,           // Increased intensity for brighter beam (was 3.5)
    8,             // Increased distance (was 6)
    Math.PI / 3.5, // Wider cone angle (~51 degrees) for broader spotlight
    0.3,           // Slightly sharper edge for more defined beam
    1.2            // Less decay for brighter far reach
  );
  spotLight.position.set(0, -0.08, 0);
  // Target point straight down to illuminate desk area
  spotLight.target.position.set(0.3, -1.0, 0);
  spotLight.castShadow = true;
  spotLight.shadow.mapSize.width = 512;
  spotLight.shadow.mapSize.height = 512;
  spotLight.name = 'lampSpotLight';
  headGroup.add(spotLight);
  headGroup.add(spotLight.target);

  // Point light for residual illumination of the entire desk
  const ambientLight = new THREE.PointLight(
    new THREE.Color(group.userData.accentColor),
    1.2,    // Increased intensity (was 0.6) for better desk coverage
    12,     // Increased range to cover entire desk (was 6)
    1.5     // Less decay for wider spread
  );
  ambientLight.position.set(0, -0.05, 0);
  ambientLight.name = 'lampLight';
  headGroup.add(ambientLight);

  // Hemisphere light for ambient glow on the entire desk and surroundings
  const hemisphereLight = new THREE.HemisphereLight(
    new THREE.Color(group.userData.accentColor),
    0x000000,
    0.4     // Increased from 0.2 for more ambient illumination
  );
  hemisphereLight.position.set(0, -0.05, 0);
  hemisphereLight.name = 'lampAmbient';
  headGroup.add(hemisphereLight);

  group.add(headGroup);

  group.position.y = getDeskSurfaceY();

  return group;
}

function createPlant(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'plant',
    name: 'Potted Plant',
    interactive: false,
    mainColor: options.mainColor || '#92400e',
    accentColor: options.accentColor || '#22c55e'
  };

  // Pot
  const potGeometry = new THREE.CylinderGeometry(0.18, 0.14, 0.25, 16);
  const potMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.8
  });
  const pot = new THREE.Mesh(potGeometry, potMaterial);
  pot.position.y = 0.125;
  pot.castShadow = true;
  group.add(pot);

  // Soil
  const soilGeometry = new THREE.CylinderGeometry(0.16, 0.16, 0.05, 16);
  const soilMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d2914,
    roughness: 1
  });
  const soil = new THREE.Mesh(soilGeometry, soilMaterial);
  soil.position.y = 0.225;
  group.add(soil);

  // Plant leaves (simple spheres)
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.6
  });

  for (let i = 0; i < 5; i++) {
    const leafGeometry = new THREE.SphereGeometry(0.12 + Math.random() * 0.05, 8, 8);
    const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
    const angle = (i / 5) * Math.PI * 2;
    const radius = 0.08;
    leaf.position.set(
      Math.cos(angle) * radius,
      0.35 + Math.random() * 0.1,
      Math.sin(angle) * radius
    );
    leaf.scale.y = 1.2;
    leaf.castShadow = true;
    group.add(leaf);
  }

  group.position.y = getDeskSurfaceY();

  return group;
}

// Drink color presets
const DRINK_COLORS = {
  coffee: { color: 0x3d2914, name: 'Coffee' },
  tea: { color: 0x8b4513, name: 'Tea' },
  water: { color: 0x87ceeb, name: 'Water' },
  milk: { color: 0xfffaf0, name: 'Milk' },
  juice: { color: 0xffa500, name: 'Orange Juice' }
};

function createCoffeeMug(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'coffee',
    name: 'Coffee Mug',
    interactive: true, // Now interactive - sipping in examine mode
    drinkType: 'coffee',
    liquidLevel: 1.0, // 0-1, how full the mug is
    maxLiquidLevel: 1.0, // Store the starting level for display
    isHot: true, // Shows steam if true
    wavePhase: 0,
    isSipping: false, // Animation state
    isCheckingEmpty: false, // Animation state for looking at empty mug
    mainColor: options.mainColor || '#ffffff',
    accentColor: options.accentColor || '#3b82f6'
  };

  // Mug body - open cylinder (no top cap) to show liquid inside
  // Using openEnded=true creates a hollow cylinder without top/bottom caps
  const mugOuterGeometry = new THREE.CylinderGeometry(0.12, 0.1, 0.2, 32, 1, true);
  const mugMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.4,
    metalness: 0.1,
    side: THREE.DoubleSide // Visible from both inside and outside
  });
  const mugOuter = new THREE.Mesh(mugOuterGeometry, mugMaterial);
  mugOuter.position.y = 0.1;
  mugOuter.castShadow = true;
  group.add(mugOuter);

  // Mug bottom (solid base)
  const mugBottomGeometry = new THREE.CircleGeometry(0.1, 32);
  const mugBottom = new THREE.Mesh(mugBottomGeometry, mugMaterial);
  mugBottom.rotation.x = -Math.PI / 2;
  mugBottom.position.y = 0.001; // Just above desk
  group.add(mugBottom);

  // Mug inner wall (slightly smaller to give wall thickness)
  const mugInnerGeometry = new THREE.CylinderGeometry(0.095, 0.08, 0.19, 32, 1, true);
  const mugInnerMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor).multiplyScalar(0.9), // Slightly darker inside
    roughness: 0.5,
    metalness: 0.05,
    side: THREE.BackSide // Only visible from inside
  });
  const mugInner = new THREE.Mesh(mugInnerGeometry, mugInnerMaterial);
  mugInner.position.y = 0.105;
  group.add(mugInner);

  // Mug rim (top edge)
  const rimGeometry = new THREE.TorusGeometry(0.11, 0.012, 8, 32);
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.3,
    metalness: 0.2
  });
  const rim = new THREE.Mesh(rimGeometry, rimMaterial);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.2;
  group.add(rim);

  // Handle - D-shaped arc attached vertically to the mug side
  // TorusGeometry creates a half-ring (arc = PI)
  // Default orientation: arc in XY plane, endpoints at (±r, 0, 0), peak at (0, r, 0)
  //
  // For a proper D-handle viewed from the side:
  // - Endpoints attach to mug at top and bottom (vertically separated)
  // - Arc bulges outward from mug body (in +X direction when mug at origin)
  //
  // To achieve this we need TWO rotations:
  // 1. rotation.z = PI/2 rotates the arc so endpoints are vertical
  //    (endpoints move to (0, ±r, 0), peak moves to (-r, 0, 0))
  // 2. rotation.y = PI flips the handle so peak points outward (+X instead of -X)
  // Combined effect: endpoints at (0, ±r, 0), peak at (+r, 0, 0) - proper D-shape
  const handleGeometry = new THREE.TorusGeometry(0.05, 0.015, 8, 16, Math.PI);
  const handleMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.4
  });
  const handle = new THREE.Mesh(handleGeometry, handleMaterial);
  // Apply rotations: Z to make endpoints vertical, Y to flip arc outward
  // Note: Three.js applies rotations in XYZ order, so we set all at once
  handle.rotation.set(0, Math.PI, Math.PI / 2);
  // Position at mug edge (radius ~0.11), vertically centered on mug (y=0.1)
  handle.position.set(0.11, 0.1, 0);
  handle.castShadow = true;
  group.add(handle);

  // Liquid surface - flat disc that fills the mug interior
  // Using a disc geometry so it's visible from above looking into the mug
  const liquidGeometry = new THREE.CircleGeometry(0.085, 32);
  const liquidMaterial = new THREE.MeshStandardMaterial({
    color: DRINK_COLORS.coffee.color,
    roughness: 0.2,
    metalness: 0.3,
    side: THREE.DoubleSide // Visible from both sides
  });
  const liquid = new THREE.Mesh(liquidGeometry, liquidMaterial);
  liquid.name = 'liquid';
  liquid.rotation.x = -Math.PI / 2; // Lay flat
  liquid.position.y = 0.15; // Positioned inside the mug, slightly below rim
  group.add(liquid);

  // Liquid body (the depth of the liquid) - cylinder below the surface
  const liquidBodyGeometry = new THREE.CylinderGeometry(0.085, 0.075, 0.12, 32, 1, true);
  const liquidBodyMaterial = new THREE.MeshStandardMaterial({
    color: DRINK_COLORS.coffee.color,
    roughness: 0.3,
    metalness: 0.2,
    side: THREE.DoubleSide
  });
  const liquidBody = new THREE.Mesh(liquidBodyGeometry, liquidBodyMaterial);
  liquidBody.name = 'liquidBody';
  liquidBody.position.y = 0.09; // Below the surface
  group.add(liquidBody);

  // Decorative stripe
  const stripeGeometry = new THREE.CylinderGeometry(0.121, 0.121, 0.04, 32, 1, true);
  const stripeMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.4
  });
  const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial);
  stripe.position.y = 0.1;
  group.add(stripe);

  group.position.y = getDeskSurfaceY();

  return group;
}

function createLaptop(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'laptop',
    name: 'Laptop',
    interactive: true,
    isOn: false, // Power state
    isBooting: false, // Boot animation in progress
    bootProgress: 0, // 0-1 boot progress
    bootTime: options.bootTime || 4000, // Boot time in ms (default 4 seconds)
    screenState: 'off', // 'off', 'bios', 'loading', 'desktop'
    isZoomedIn: false, // Whether user is in laptop control mode
    editorContent: '', // Markdown editor content
    editorFileName: 'notes.md',
    notesFolderPath: options.notesFolderPath || null, // Folder path for saving notes (null = use default app folder)
    mainColor: options.mainColor || '#1e293b',
    accentColor: options.accentColor || '#60a5fa',
    bootScreenDataUrl: null, // Custom boot screen image data URL
    powerButtonColor: options.powerButtonColor || '#ff0000', // Power button color
    powerButtonGlow: options.powerButtonGlow !== undefined ? options.powerButtonGlow : true, // Whether button glows
    powerButtonBrightness: options.powerButtonBrightness !== undefined ? options.powerButtonBrightness : 50, // Glow brightness 0-100
    powerLedColor: options.powerLedColor || '#00ff00' // Power LED on color
  };

  // Base/keyboard part
  const baseGeometry = new THREE.BoxGeometry(0.8, 0.03, 0.5);
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.3,
    metalness: 0.7
  });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.015;
  base.castShadow = true;
  group.add(base);

  // Screen
  const screenGroup = new THREE.Group();
  screenGroup.name = 'screenGroup';

  const screenBackGeometry = new THREE.BoxGeometry(0.78, 0.5, 0.02);
  const screenBack = new THREE.Mesh(screenBackGeometry, baseMaterial);
  screenBack.castShadow = true;
  screenGroup.add(screenBack);

  // Screen display (starts black/off)
  const displayGeometry = new THREE.PlaneGeometry(0.7, 0.42);
  const displayMaterial = new THREE.MeshStandardMaterial({
    color: 0x000000, // Black when off
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.1
  });
  const display = new THREE.Mesh(displayGeometry, displayMaterial);
  display.position.z = 0.011;
  display.name = 'screen';
  screenGroup.add(display);

  screenGroup.position.set(0, 0.28, -0.23);
  screenGroup.rotation.x = -Math.PI / 6;
  group.add(screenGroup);

  // Keyboard area
  const keyboardGeometry = new THREE.PlaneGeometry(0.6, 0.35);
  const keyboardMaterial = new THREE.MeshStandardMaterial({
    color: 0x374151,
    roughness: 0.8
  });
  const keyboard = new THREE.Mesh(keyboardGeometry, keyboardMaterial);
  keyboard.rotation.x = -Math.PI / 2;
  keyboard.position.y = 0.031;
  keyboard.position.z = 0.05;
  keyboard.name = 'keyboard';
  group.add(keyboard);

  // Power button (in top right corner of keyboard area)
  // Keyboard is centered at Z=0.05, extends from X=-0.3 to X=0.3
  // Top edge of keyboard is at Z = 0.05 - 0.175 = -0.125
  // Power button - shorter cylinder for better proportions
  const powerBtnGeometry = new THREE.CylinderGeometry(0.015, 0.015, 0.02, 16);
  const buttonColor = new THREE.Color(group.userData.powerButtonColor);
  const powerBtnMaterial = new THREE.MeshStandardMaterial({
    color: buttonColor,
    emissive: group.userData.powerButtonGlow ? buttonColor : 0x000000,
    emissiveIntensity: group.userData.powerButtonGlow ? group.userData.powerButtonBrightness / 100 : 0,
    roughness: 0.2,
    metalness: 0.6
  });
  const powerButton = new THREE.Mesh(powerBtnGeometry, powerBtnMaterial);
  // Position in top-right corner of keyboard area, standing upright
  // X: near right edge (0.27), Y: on keyboard surface + half height, Z: near top of keyboard
  powerButton.position.set(0.27, 0.032 + 0.01, -0.08);
  powerButton.name = 'powerButton';
  group.add(powerButton);

  // Power LED indicator (next to power button)
  const ledGeometry = new THREE.CircleGeometry(0.004, 8);
  const ledMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    emissive: 0x000000,
    emissiveIntensity: 0
  });
  const powerLed = new THREE.Mesh(ledGeometry, ledMaterial);
  powerLed.rotation.x = -Math.PI / 2;
  // Position LED just below the power button
  powerLed.position.set(0.27, 0.033, -0.075);
  powerLed.name = 'powerLed';
  group.add(powerLed);

  group.position.y = getDeskSurfaceY();

  return group;
}

function createNotebook(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'notebook',
    name: 'Notebook',
    interactive: true, // Interactive - can draw with pen
    drawingLines: [], // Array of drawing line data
    fileName: options.fileName || 'notebook.png',
    mainColor: options.mainColor || '#3b82f6',
    accentColor: options.accentColor || '#ffffff'
  };

  // Cover
  const coverGeometry = new THREE.BoxGeometry(0.4, 0.03, 0.55);
  const coverMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.6
  });
  const cover = new THREE.Mesh(coverGeometry, coverMaterial);
  cover.position.y = 0.015;
  cover.castShadow = true;
  group.add(cover);

  // Pages
  const pagesGeometry = new THREE.BoxGeometry(0.38, 0.025, 0.53);
  const pagesMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.9
  });
  const pages = new THREE.Mesh(pagesGeometry, pagesMaterial);
  pages.position.y = 0.0375;
  group.add(pages);

  // Spine detail
  const spineGeometry = new THREE.BoxGeometry(0.03, 0.055, 0.55);
  const spine = new THREE.Mesh(spineGeometry, coverMaterial);
  spine.position.set(-0.185, 0.0275, 0);
  group.add(spine);

  group.position.y = getDeskSurfaceY();

  return group;
}

function createPenHolder(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'pen-holder',
    name: 'Pen Holder',
    interactive: false, // Just a container now
    mainColor: options.mainColor || '#64748b',
    accentColor: options.accentColor || '#f472b6'
  };

  // Holder cup (open cylinder)
  const holderGeometry = new THREE.CylinderGeometry(0.12, 0.1, 0.25, 16, 1, true);
  const holderMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.3,
    metalness: 0.6,
    side: THREE.DoubleSide
  });
  const holder = new THREE.Mesh(holderGeometry, holderMaterial);
  holder.position.y = 0.125;
  holder.castShadow = true;
  group.add(holder);

  // Bottom
  const bottomGeometry = new THREE.CircleGeometry(0.1, 16);
  const bottom = new THREE.Mesh(bottomGeometry, holderMaterial);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.001;
  group.add(bottom);

  // Inner ring at top for visual depth
  const rimGeometry = new THREE.TorusGeometry(0.11, 0.01, 8, 32);
  const rim = new THREE.Mesh(rimGeometry, holderMaterial);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.25;
  group.add(rim);

  group.position.y = getDeskSurfaceY();

  return group;
}

// Individual pen as a separate desk object
function createPen(options = {}) {
  const group = new THREE.Group();

  // Default pen colors available
  const penColors = {
    red: 0xef4444,
    blue: 0x3b82f6,
    green: 0x22c55e,
    black: 0x1a1a1a,
    purple: 0x8b5cf6,
    orange: 0xf97316
  };

  const penColor = options.penColor || 'blue';
  const colorHex = penColors[penColor] || penColors.blue;

  group.userData = {
    type: 'pen',
    name: `${penColor.charAt(0).toUpperCase() + penColor.slice(1)} Pen`,
    interactive: false,
    penColor: penColor,
    mainColor: options.mainColor || `#${colorHex.toString(16).padStart(6, '0')}`,
    accentColor: options.accentColor || '#d4d4d4',
    inkColor: options.inkColor || `#${colorHex.toString(16).padStart(6, '0')}`,
    colorHex: colorHex
  };

  // Create a sub-group for pen parts so we can pivot around the TIP (writing end)
  // When dragging, we rotate this subgroup, keeping the tip anchored
  // The cap (upper end when standing) swings freely
  const penBody = new THREE.Group();
  penBody.name = 'penBody';

  // Tip position is the anchor point (will be at Y=0 in penBody local space)
  const tipY = 0; // Tip at origin for pivot

  // Pen tip (silver/metallic) - at anchor point
  const tipGeometry = new THREE.ConeGeometry(0.012, 0.04, 8);
  const tipMaterial = new THREE.MeshStandardMaterial({
    color: 0xc0c0c0,
    roughness: 0.2,
    metalness: 0.8
  });
  const tip = new THREE.Mesh(tipGeometry, tipMaterial);
  tip.position.y = tipY; // Tip at pivot point
  tip.rotation.x = Math.PI; // Point down
  penBody.add(tip);

  // Pen body - above tip (toward cap)
  const bodyGeometry = new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.4,
    metalness: 0.2
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = tipY + 0.04 + 0.15; // Body center above tip (tip height 0.04 + half body 0.15)
  body.castShadow = true;
  penBody.add(body);

  // Pen cap - at top, furthest from anchor (will swing)
  const capGeometry = new THREE.CylinderGeometry(0.013, 0.013, 0.05, 8);
  const cap = new THREE.Mesh(capGeometry, bodyMaterial);
  cap.position.y = tipY + 0.04 + 0.3 + 0.025; // Cap center above body (tip 0.04 + body 0.3 + half cap 0.025)
  penBody.add(cap);

  // Clip on cap
  const clipGeometry = new THREE.BoxGeometry(0.003, 0.04, 0.015);
  const clipMaterial = new THREE.MeshStandardMaterial({
    color: 0xc0c0c0,
    roughness: 0.2,
    metalness: 0.8
  });
  const clip = new THREE.Mesh(clipGeometry, clipMaterial);
  clip.position.set(0.014, cap.position.y - 0.005, 0);
  penBody.add(clip);

  group.add(penBody);

  // Rotate pen to lie flat on the desk (along X axis)
  // The pen lies with tip toward -X, cap toward +X
  group.rotation.z = -Math.PI / 2;
  // Position so the pen sits on the desk surface
  // After rotation, the pen's radius determines the height above desk
  group.position.y = getDeskSurfaceY() + 0.015; // Raise by pen radius

  return group;
}

function createBooks(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'books',
    name: 'Book',
    interactive: true, // Interactive - can open to view PDF
    isOpen: false, // Whether book is open
    openAngle: 0, // Animation angle
    bookTitle: options.bookTitle || 'My Book',
    titleColor: options.titleColor || '#ffffff', // Title text color
    pdfPath: null, // Path to PDF file
    currentPage: 0, // Current page index
    totalPages: 0, // Total number of pages
    pdfResolution: options.pdfResolution || 512, // PDF rendering resolution (width in pixels)
    mainColor: options.mainColor || '#7c3aed',
    accentColor: options.accentColor || '#f59e0b',
    coverFitMode: options.coverFitMode || 'contain' // Cover image fit mode: 'contain', 'cover', 'stretch'
  };

  // Book closed group (visible when closed)
  const closedGroup = new THREE.Group();
  closedGroup.name = 'closedBook';

  // Single book model - Book cover
  const coverMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.7
  });

  const coverGeometry = new THREE.BoxGeometry(0.28, 0.04, 0.38);
  const cover = new THREE.Mesh(coverGeometry, coverMaterial);
  cover.name = 'cover'; // Name for getObjectByName access
  cover.position.y = 0.02;
  cover.castShadow = true;
  closedGroup.add(cover);

  // Pages (white interior)
  const pagesMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5f5f0,
    roughness: 0.9
  });

  const pagesGeometry = new THREE.BoxGeometry(0.26, 0.035, 0.36);
  const pages = new THREE.Mesh(pagesGeometry, pagesMaterial);
  pages.position.y = 0.02;
  closedGroup.add(pages);

  // Spine detail
  const spineMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.6
  });

  const spineGeometry = new THREE.BoxGeometry(0.02, 0.045, 0.38);
  const spine = new THREE.Mesh(spineGeometry, spineMaterial);
  spine.position.set(-0.13, 0.02, 0);
  spine.castShadow = true;
  closedGroup.add(spine);

  // Title on cover (rendered as texture with actual text)
  // Font size increased from 24 to 32 for better readability
  // Now supports multiline titles for long book names
  const createTitleTexture = (title, width, height, fontSize) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Background matches accent color
    const accentHex = group.userData.accentColor;
    ctx.fillStyle = accentHex;
    ctx.fillRect(0, 0, width, height);

    // Text styling - use configurable title color
    ctx.fillStyle = group.userData.titleColor || '#ffffff';
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Word wrap for long titles with padding
    // Also supports explicit line breaks entered by user
    const paddingX = 30; // Horizontal padding on each side
    const paddingY = 35; // Vertical padding top/bottom (increased from 15 for more spacing)
    const maxWidth = width - paddingX * 2;
    const maxHeight = height - paddingY * 2;

    // First split by explicit newlines, then word-wrap each line
    const paragraphs = title.split('\n');
    const lines = [];

    for (const paragraph of paragraphs) {
      const words = paragraph.split(' ');
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);
    }

    // Draw multiline title (centered vertically within padded area)
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    // Center within the padded area
    const availableHeight = maxHeight;
    const startY = paddingY + (availableHeight - totalHeight) / 2 + lineHeight / 2;

    lines.forEach((line, i) => {
      ctx.fillText(line, width / 2, startY + i * lineHeight);
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  };

  // Cover title - doubled font size from 32 to 64 for better readability
  // Increased vertical size from 0.08 to 0.12 for more top/bottom padding
  const coverTitleGeometry = new THREE.PlaneGeometry(0.22, 0.12);
  const coverTitleTexture = createTitleTexture(group.userData.bookTitle, 320, 174, 64);
  const coverTitleMaterial = new THREE.MeshStandardMaterial({
    map: coverTitleTexture,
    roughness: 0.5
  });
  const coverTitle = new THREE.Mesh(coverTitleGeometry, coverTitleMaterial);
  coverTitle.rotation.x = -Math.PI / 2;
  coverTitle.position.set(0.02, 0.041, 0);
  coverTitle.name = 'coverTitle';
  // Hide title background if title is empty or whitespace only
  const titleText = group.userData.bookTitle || '';
  coverTitle.visible = titleText.trim().length > 0;
  closedGroup.add(coverTitle);

  // Spine title removed per user feedback - spine is now plain accent color

  // Store the createTitleTexture function for later updates
  group.userData.createTitleTexture = createTitleTexture;

  group.add(closedGroup);

  // Book open group (visible when open)
  const openGroup = new THREE.Group();
  openGroup.name = 'openBook';
  openGroup.visible = false;

  // Left page (cover rotated back)
  const leftCoverGeometry = new THREE.BoxGeometry(0.28, 0.005, 0.38);
  const leftCover = new THREE.Mesh(leftCoverGeometry, coverMaterial);
  leftCover.position.set(-0.14, 0.003, 0);
  leftCover.name = 'leftCover';
  openGroup.add(leftCover);

  // Right page (cover rotated back)
  const rightCover = new THREE.Mesh(leftCoverGeometry, coverMaterial);
  rightCover.position.set(0.14, 0.003, 0);
  rightCover.name = 'rightCover';
  openGroup.add(rightCover);

  // Page block on left
  const leftPagesGeometry = new THREE.BoxGeometry(0.26, 0.02, 0.36);
  const leftPages = new THREE.Mesh(leftPagesGeometry, pagesMaterial);
  leftPages.position.set(-0.13, 0.015, 0);
  openGroup.add(leftPages);

  // Page block on right
  const rightPages = new THREE.Mesh(leftPagesGeometry, pagesMaterial);
  rightPages.position.set(0.13, 0.015, 0);
  openGroup.add(rightPages);

  // Left page surface (for displaying content)
  const pageSurfaceGeometry = new THREE.PlaneGeometry(0.24, 0.34);
  const leftPageSurfaceMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff8f0,
    roughness: 0.9,
    side: THREE.DoubleSide
  });
  const leftPageSurface = new THREE.Mesh(pageSurfaceGeometry, leftPageSurfaceMaterial);
  leftPageSurface.rotation.x = -Math.PI / 2;
  leftPageSurface.position.set(-0.13, 0.026, 0);
  leftPageSurface.name = 'leftPageSurface';
  openGroup.add(leftPageSurface);

  // Right page surface
  const rightPageSurfaceMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff8f0,
    roughness: 0.9,
    side: THREE.DoubleSide
  });
  const rightPageSurface = new THREE.Mesh(pageSurfaceGeometry, rightPageSurfaceMaterial);
  rightPageSurface.rotation.x = -Math.PI / 2;
  rightPageSurface.position.set(0.13, 0.026, 0);
  rightPageSurface.name = 'rightPageSurface';
  openGroup.add(rightPageSurface);

  // Spine when open
  const openSpineGeometry = new THREE.BoxGeometry(0.02, 0.03, 0.38);
  const openSpine = new THREE.Mesh(openSpineGeometry, spineMaterial);
  openSpine.position.set(0, 0.015, 0);
  openGroup.add(openSpine);

  group.add(openGroup);

  group.position.y = getDeskSurfaceY();

  return group;
}

function createMagazine(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'magazine',
    name: 'Magazine',
    interactive: true, // Interactive - can open to view PDF
    isOpen: false, // Whether magazine is open
    openAngle: 0, // Animation angle
    magazineTitle: options.magazineTitle || '',
    titleColor: options.titleColor || '#ffffff', // Title text color
    pdfPath: null, // Path to PDF file
    currentPage: 0, // Current page index
    totalPages: 0, // Total number of pages
    pdfResolution: options.pdfResolution || 512, // PDF rendering resolution (width in pixels)
    mainColor: options.mainColor || '#dc2626', // Red color for magazine
    accentColor: options.accentColor || '#fbbf24',
    coverFitMode: options.coverFitMode || 'cover' // Cover image fit mode: 'contain', 'cover', 'stretch'
  };

  // Magazine closed group (visible when closed)
  const closedGroup = new THREE.Group();
  closedGroup.name = 'closedMagazine';

  // Magazine cover - thinner than book
  const coverMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.5
  });

  // Magazine is wider and thinner than a book (A4-ish proportions)
  const coverGeometry = new THREE.BoxGeometry(0.22, 0.015, 0.30);
  const cover = new THREE.Mesh(coverGeometry, coverMaterial);
  cover.name = 'cover';
  cover.position.y = 0.0075;
  cover.castShadow = true;
  closedGroup.add(cover);

  // Pages (white interior) - magazine pages are thinner
  const pagesMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5f5f0,
    roughness: 0.9
  });

  const pagesGeometry = new THREE.BoxGeometry(0.20, 0.012, 0.28);
  const pages = new THREE.Mesh(pagesGeometry, pagesMaterial);
  pages.position.y = 0.0075;
  closedGroup.add(pages);

  // Magazine spine - very thin, just a binding edge (no prominent spine like a book)
  const spineMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.6
  });

  const spineGeometry = new THREE.BoxGeometry(0.008, 0.016, 0.30);
  const spine = new THREE.Mesh(spineGeometry, spineMaterial);
  spine.position.set(-0.106, 0.0075, 0);
  spine.castShadow = true;
  closedGroup.add(spine);

  // Title on cover - magazine titles are usually larger and bolder
  const createTitleTexture = (title, width, height, fontSize) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Background matches main color
    const mainHex = group.userData.mainColor;
    ctx.fillStyle = mainHex;
    ctx.fillRect(0, 0, width, height);

    // Text styling - use configurable title color
    ctx.fillStyle = group.userData.titleColor || '#ffffff';
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Word wrap for long titles with padding
    const paddingX = 20;
    const paddingY = 25;
    const maxWidth = width - paddingX * 2;
    const maxHeight = height - paddingY * 2;

    const paragraphs = title.split('\n');
    const lines = [];

    for (const paragraph of paragraphs) {
      const words = paragraph.split(' ');
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);
    }

    // Draw multiline title (centered vertically within padded area)
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    const availableHeight = maxHeight;
    const startY = paddingY + (availableHeight - totalHeight) / 2 + lineHeight / 2;

    lines.forEach((line, i) => {
      ctx.fillText(line, width / 2, startY + i * lineHeight);
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  };

  // Cover title - positioned at top of magazine
  const coverTitleGeometry = new THREE.PlaneGeometry(0.18, 0.08);
  const coverTitleTexture = createTitleTexture(group.userData.magazineTitle, 280, 124, 48);
  const coverTitleMaterial = new THREE.MeshStandardMaterial({
    map: coverTitleTexture,
    roughness: 0.5
  });
  const coverTitle = new THREE.Mesh(coverTitleGeometry, coverTitleMaterial);
  coverTitle.rotation.x = -Math.PI / 2;
  coverTitle.position.set(0, 0.016, -0.08);
  coverTitle.name = 'coverTitle';
  // Hide title background if title is empty or whitespace only
  const titleText = group.userData.magazineTitle || '';
  coverTitle.visible = titleText.trim().length > 0;
  closedGroup.add(coverTitle);

  // Store the createTitleTexture function for later updates
  group.userData.createTitleTexture = createTitleTexture;

  group.add(closedGroup);

  // Magazine open group (visible when open) - KEY DIFFERENCE: no spine gap between pages
  const openGroup = new THREE.Group();
  openGroup.name = 'openMagazine';
  openGroup.visible = false;

  // Left cover (back cover)
  const leftCoverGeometry = new THREE.BoxGeometry(0.22, 0.003, 0.30);
  const leftCover = new THREE.Mesh(leftCoverGeometry, coverMaterial);
  leftCover.position.set(-0.11, 0.0015, 0);
  leftCover.name = 'leftCover';
  openGroup.add(leftCover);

  // Right cover (front cover flipped)
  const rightCover = new THREE.Mesh(leftCoverGeometry, coverMaterial);
  rightCover.position.set(0.11, 0.0015, 0);
  rightCover.name = 'rightCover';
  openGroup.add(rightCover);

  // Page block on left - positioned to meet at center
  const leftPagesGeometry = new THREE.BoxGeometry(0.20, 0.008, 0.28);
  const leftPages = new THREE.Mesh(leftPagesGeometry, pagesMaterial);
  leftPages.position.set(-0.10, 0.007, 0);
  openGroup.add(leftPages);

  // Page block on right - positioned to meet at center
  const rightPages = new THREE.Mesh(leftPagesGeometry, pagesMaterial);
  rightPages.position.set(0.10, 0.007, 0);
  openGroup.add(rightPages);

  // Left page surface (for displaying content) - meets at center (x=0)
  const pageSurfaceGeometry = new THREE.PlaneGeometry(0.20, 0.28);
  const leftPageSurfaceMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff8f0,
    roughness: 0.9,
    side: THREE.DoubleSide
  });
  const leftPageSurface = new THREE.Mesh(pageSurfaceGeometry, leftPageSurfaceMaterial);
  leftPageSurface.rotation.x = -Math.PI / 2;
  // Position so right edge is at x=0 (pages meet flush)
  leftPageSurface.position.set(-0.10, 0.012, 0);
  leftPageSurface.name = 'leftPageSurface';
  openGroup.add(leftPageSurface);

  // Right page surface - meets at center (x=0)
  const rightPageSurfaceMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff8f0,
    roughness: 0.9,
    side: THREE.DoubleSide
  });
  const rightPageSurface = new THREE.Mesh(pageSurfaceGeometry, rightPageSurfaceMaterial);
  rightPageSurface.rotation.x = -Math.PI / 2;
  // Position so left edge is at x=0 (pages meet flush)
  rightPageSurface.position.set(0.10, 0.012, 0);
  rightPageSurface.name = 'rightPageSurface';
  openGroup.add(rightPageSurface);

  // No visible spine when open - pages meet flush for spread images

  group.add(openGroup);

  group.position.y = getDeskSurfaceY();

  return group;
}

function createPhotoFrame(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'photo-frame',
    name: 'Photo Frame',
    interactive: false, // Settings only in edit mode (RMB)
    photoTexture: null,
    mainColor: options.mainColor || '#92400e',
    accentColor: options.accentColor || '#60a5fa'
  };

  // Frame
  const frameGeometry = new THREE.BoxGeometry(0.35, 0.45, 0.03);
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.6
  });
  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  frame.castShadow = true;
  group.add(frame);

  // Photo area - can be updated with custom texture
  const photoGeometry = new THREE.PlaneGeometry(0.28, 0.38);
  const photoMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.5
  });
  const photo = new THREE.Mesh(photoGeometry, photoMaterial);
  photo.name = 'photoSurface';
  photo.position.z = 0.016;
  group.add(photo);

  // Stand - positioned further back to avoid clipping through frame front
  const standGeometry = new THREE.BoxGeometry(0.04, 0.25, 0.08);
  const stand = new THREE.Mesh(standGeometry, frameMaterial);
  stand.position.set(0, -0.12, -0.12);
  stand.rotation.x = Math.PI / 5; // Slightly steeper angle
  stand.castShadow = true;
  group.add(stand);

  group.rotation.x = -Math.PI / 12;
  group.position.y = getDeskSurfaceY() + 0.25;

  return group;
}

function createGlobe(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'globe',
    name: 'Globe',
    interactive: true,
    rotationSpeed: 0.002,
    mainColor: options.mainColor || '#3b82f6',
    accentColor: options.accentColor || '#22c55e'
  };

  // Base
  const baseGeometry = new THREE.CylinderGeometry(0.15, 0.18, 0.05, 32);
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.3,
    metalness: 0.7
  });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.castShadow = true;
  group.add(base);

  // Stand arm
  const armGeometry = new THREE.TorusGeometry(0.22, 0.015, 8, 32, Math.PI);
  const arm = new THREE.Mesh(armGeometry, baseMaterial);
  arm.position.y = 0.22;
  arm.rotation.x = Math.PI / 2;
  group.add(arm);

  // Globe sphere
  const globeGeometry = new THREE.SphereGeometry(0.2, 32, 32);
  const globeMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.4,
    metalness: 0.2
  });
  const globe = new THREE.Mesh(globeGeometry, globeMaterial);
  globe.position.y = 0.22;
  globe.name = 'globeSphere';
  globe.castShadow = true;
  group.add(globe);

  // Land masses (simplified)
  const landGeometry = new THREE.IcosahedronGeometry(0.205, 1);
  const landMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.6,
    wireframe: true
  });
  const land = new THREE.Mesh(landGeometry, landMaterial);
  land.position.y = 0.22;
  land.name = 'land';
  group.add(land);

  group.position.y = getDeskSurfaceY() + 0.025;

  return group;
}

function createTrophy(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'trophy',
    name: 'Trophy',
    interactive: false,
    mainColor: options.mainColor || '#fbbf24',
    accentColor: options.accentColor || '#92400e'
  };

  const trophyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.2,
    metalness: 0.9
  });

  // Base
  const baseGeometry = new THREE.BoxGeometry(0.2, 0.05, 0.2);
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.6
  });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.025;
  base.castShadow = true;
  group.add(base);

  // Stem
  const stemGeometry = new THREE.CylinderGeometry(0.03, 0.05, 0.15, 16);
  const stem = new THREE.Mesh(stemGeometry, trophyMaterial);
  stem.position.y = 0.125;
  stem.castShadow = true;
  group.add(stem);

  // Cup
  const cupGeometry = new THREE.CylinderGeometry(0.12, 0.06, 0.15, 32);
  const cup = new THREE.Mesh(cupGeometry, trophyMaterial);
  cup.position.y = 0.275;
  cup.castShadow = true;
  group.add(cup);

  // Handles
  [-1, 1].forEach(side => {
    const handleGeometry = new THREE.TorusGeometry(0.04, 0.015, 8, 16, Math.PI);
    const handle = new THREE.Mesh(handleGeometry, trophyMaterial);
    handle.position.set(side * 0.14, 0.26, 0);
    handle.rotation.y = Math.PI / 2;
    handle.rotation.x = Math.PI / 2 * side;
    group.add(handle);
  });

  group.position.y = getDeskSurfaceY();

  return group;
}

function createHourglass(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'hourglass',
    name: 'Hourglass',
    interactive: true,
    mainColor: options.mainColor || '#92400e',
    accentColor: options.accentColor || '#fbbf24'
  };

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.4,
    metalness: 0.6
  });

  // Top and bottom caps
  [0.25, 0].forEach(y => {
    const capGeometry = new THREE.CylinderGeometry(0.12, 0.12, 0.03, 16);
    const cap = new THREE.Mesh(capGeometry, frameMaterial);
    cap.position.y = y;
    cap.castShadow = true;
    group.add(cap);
  });

  // Glass bulbs
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0xadd8e6,
    transparent: true,
    opacity: 0.4,
    roughness: 0.1
  });

  // Top bulb
  const topBulbGeometry = new THREE.SphereGeometry(0.08, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const topBulb = new THREE.Mesh(topBulbGeometry, glassMaterial);
  topBulb.position.y = 0.19;
  topBulb.rotation.x = Math.PI;
  group.add(topBulb);

  // Bottom bulb
  const bottomBulb = new THREE.Mesh(topBulbGeometry, glassMaterial);
  bottomBulb.position.y = 0.06;
  group.add(bottomBulb);

  // Neck
  const neckGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.06, 16);
  const neck = new THREE.Mesh(neckGeometry, glassMaterial);
  neck.position.y = 0.125;
  group.add(neck);

  // Sand
  const sandMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.8
  });

  const sandTopGeometry = new THREE.ConeGeometry(0.05, 0.04, 16);
  const sandTop = new THREE.Mesh(sandTopGeometry, sandMaterial);
  sandTop.position.y = 0.17;
  sandTop.rotation.x = Math.PI;
  group.add(sandTop);

  const sandBottomGeometry = new THREE.ConeGeometry(0.06, 0.05, 16);
  const sandBottom = new THREE.Mesh(sandBottomGeometry, sandMaterial);
  sandBottom.position.y = 0.06;
  group.add(sandBottom);

  // Pillars
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const pillarGeometry = new THREE.CylinderGeometry(0.015, 0.015, 0.22, 8);
    const pillar = new THREE.Mesh(pillarGeometry, frameMaterial);
    pillar.position.set(
      Math.cos(angle) * 0.1,
      0.125,
      Math.sin(angle) * 0.1
    );
    group.add(pillar);
  }

  group.position.y = getDeskSurfaceY() + 0.015;

  return group;
}

function createPaper(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'paper',
    name: 'Paper Sheet',
    interactive: true, // Interactive - can draw with pen
    drawingLines: [], // Array of drawing line data
    fileName: options.fileName || 'drawing.png',
    mainColor: options.mainColor || '#ffffff', // Pure white for drawing
    accentColor: options.accentColor || '#cccccc'
  };

  const paperMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide
  });

  // A4 paper proportions (210mm x 297mm ~ 0.707 ratio)
  const paperWidth = 0.28;
  const paperHeight = 0.4;
  const paperThickness = 0.002;

  // Main paper sheet - blank white for drawing
  const paperGeometry = new THREE.BoxGeometry(paperWidth, paperThickness, paperHeight);
  const paper = new THREE.Mesh(paperGeometry, paperMaterial);
  paper.position.y = paperThickness / 2;
  paper.castShadow = true;
  paper.receiveShadow = true;
  group.add(paper);

  // Note: No decorative lines - paper is blank for drawing with pen

  group.position.y = getDeskSurfaceY();

  return group;
}

function createMetronome(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'metronome',
    name: 'Metronome',
    interactive: false, // Settings only in edit mode (RMB), middle-click just toggles
    isRunning: false,
    bpm: 120,
    volume: options.volume !== undefined ? options.volume : 0.5, // Volume 0-1
    tickSound: true, // Tick sound ON by default (strike sound)
    tickSoundType: 'strike', // 'strike' (default) or 'beep'
    tickPitch: options.tickPitch !== undefined ? options.tickPitch : 100, // Pitch percentage (100 = normal)
    customSoundDataUrl: null, // Custom sound file data URL
    pendulumAngle: 0,
    pendulumDirection: 1,
    // Pitch curve settings - allows pitch to change over time
    pitchCurveEnabled: options.pitchCurveEnabled !== undefined ? options.pitchCurveEnabled : false,
    pitchCurveType: options.pitchCurveType || 'linear', // 'linear', 'ease-in', 'ease-out', 'sine'
    pitchCurveStart: options.pitchCurveStart !== undefined ? options.pitchCurveStart : 100, // Start pitch %
    pitchCurveEnd: options.pitchCurveEnd !== undefined ? options.pitchCurveEnd : 100, // End pitch %
    pitchCurveDuration: options.pitchCurveDuration !== undefined ? options.pitchCurveDuration : 60, // Duration in seconds
    pitchCurveLoop: options.pitchCurveLoop !== undefined ? options.pitchCurveLoop : false, // Loop the curve
    pitchCurveStartTime: 0, // Timestamp when curve started
    // Tempo curve settings - allows BPM to change over time
    tempoCurveEnabled: options.tempoCurveEnabled !== undefined ? options.tempoCurveEnabled : false,
    tempoCurveType: options.tempoCurveType || 'linear', // 'linear', 'ease-in', 'ease-out', 'sine'
    tempoCurveStart: options.tempoCurveStart !== undefined ? options.tempoCurveStart : 60, // Start BPM
    tempoCurveEnd: options.tempoCurveEnd !== undefined ? options.tempoCurveEnd : 120, // End BPM
    tempoCurveDuration: options.tempoCurveDuration !== undefined ? options.tempoCurveDuration : 60, // Duration in seconds
    tempoCurveLoop: options.tempoCurveLoop !== undefined ? options.tempoCurveLoop : false, // Loop the curve
    tempoCurveStartTime: 0, // Timestamp when curve started
    mainColor: options.mainColor || '#8b4513',
    accentColor: options.accentColor || '#ffd700'
  };

  const woodMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.7,
    metalness: 0.1
  });

  const metalMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.3,
    metalness: 0.8
  });

  // Base (wooden pyramid-like shape)
  const baseGeometry = new THREE.CylinderGeometry(0.08, 0.15, 0.05, 4);
  const base = new THREE.Mesh(baseGeometry, woodMaterial);
  base.rotation.y = Math.PI / 4;
  base.position.y = 0.025;
  base.castShadow = true;
  group.add(base);

  // Body (tapered wooden box)
  const bodyGeometry = new THREE.CylinderGeometry(0.06, 0.12, 0.35, 4);
  const body = new THREE.Mesh(bodyGeometry, woodMaterial);
  body.rotation.y = Math.PI / 4;
  body.position.y = 0.225;
  body.castShadow = true;
  group.add(body);

  // Front face plate
  const facePlateGeometry = new THREE.PlaneGeometry(0.1, 0.2);
  const facePlateMaterial = new THREE.MeshStandardMaterial({
    color: 0xfffff0,
    roughness: 0.8
  });
  const facePlate = new THREE.Mesh(facePlateGeometry, facePlateMaterial);
  facePlate.position.set(0, 0.25, 0.07);
  group.add(facePlate);

  // Scale markings on face plate
  const markingMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.5
  });
  for (let i = 0; i < 7; i++) {
    const markGeometry = new THREE.BoxGeometry(0.06, 0.002, 0.001);
    const mark = new THREE.Mesh(markGeometry, markingMaterial);
    mark.position.set(0, 0.17 + i * 0.025, 0.072);
    group.add(mark);
  }

  // Pendulum pivot point
  const pivotGeometry = new THREE.CylinderGeometry(0.01, 0.01, 0.02, 16);
  const pivot = new THREE.Mesh(pivotGeometry, metalMaterial);
  pivot.rotation.x = Math.PI / 2;
  pivot.position.set(0, 0.35, 0.05);
  group.add(pivot);

  // Pendulum group (this will swing)
  const pendulumGroup = new THREE.Group();
  pendulumGroup.name = 'pendulum';
  pendulumGroup.position.set(0, 0.35, 0.05);

  // Pendulum arm
  const armGeometry = new THREE.BoxGeometry(0.008, 0.25, 0.008);
  const arm = new THREE.Mesh(armGeometry, metalMaterial);
  arm.position.y = -0.125;
  pendulumGroup.add(arm);

  // Pendulum weight (adjustable)
  const weightGeometry = new THREE.BoxGeometry(0.03, 0.04, 0.015);
  const weight = new THREE.Mesh(weightGeometry, metalMaterial);
  weight.name = 'weight';
  weight.position.y = -0.15;
  pendulumGroup.add(weight);

  // Pendulum bob at bottom
  const bobGeometry = new THREE.SphereGeometry(0.02, 16, 16);
  const bob = new THREE.Mesh(bobGeometry, metalMaterial);
  bob.position.y = -0.24;
  pendulumGroup.add(bob);

  group.add(pendulumGroup);

  // Top ornament
  const topGeometry = new THREE.ConeGeometry(0.03, 0.04, 4);
  const top = new THREE.Mesh(topGeometry, metalMaterial);
  top.rotation.y = Math.PI / 4;
  top.position.y = 0.42;
  group.add(top);

  group.position.y = getDeskSurfaceY();

  return group;
}

// ============================================================================
// SHARED AUDIO SYSTEM
// ============================================================================
// Shared audio infrastructure for all audio sources (cassette, dictaphone, etc.)
// This allows the dictaphone to capture audio from all virtual room sources
let sharedAudioSystem = {
  audioContext: null,
  masterGain: null,        // Master output node - all audio passes through here
  recordingGain: null,     // Gain node for mono recording (no spatial audio)
  recordingGainPanorama: null, // Gain node for panoramic recording (dictaphone-centered spatial audio)
  activePlayers: new Set(), // Set of active audio sources (cassette players, etc.)
  spatialNodes: new Map(),   // Map of object ID -> { pannerNode, gainNode, object } for playback spatial audio
  recordingSpatialNodes: new Map() // Map of object ID -> { pannerNode, gainNode, sourceNode } for recording with dictaphone-centered spatial
};

// ============================================================================
// SPATIAL AUDIO SYSTEM
// ============================================================================
// Calculates stereo panning and volume based on object position relative to camera
// Takes camera rotation into account for accurate left/right positioning

/**
 * Calculate spatial audio parameters (pan and volume) for an object
 * @param {THREE.Object3D} object - The 3D object with sound source
 * @param {THREE.Object3D} referenceObject - Optional reference object (default: camera).
 *        If provided, spatial audio is calculated relative to this object instead of camera.
 * @returns {{ pan: number, volume: number }} - Pan (-1 to 1) and volume (0 to 1) multipliers
 */
function calculateSpatialAudio(object, referenceObject = null) {
  if (!object) {
    return { pan: 0, volume: 1 };
  }

  // Get object's world position
  const objectPos = new THREE.Vector3();
  object.getWorldPosition(objectPos);

  // Get reference position (either provided object or camera)
  const refPos = new THREE.Vector3();
  if (referenceObject) {
    referenceObject.getWorldPosition(refPos);
  } else if (camera) {
    camera.getWorldPosition(refPos);
  } else {
    return { pan: 0, volume: 1 };
  }

  // Calculate relative position from reference to object (in world coordinates)
  const relativeX = objectPos.x - refPos.x;
  const relativeZ = objectPos.z - refPos.z;

  // Calculate distance for volume attenuation (unchanged by rotation)
  const distance = Math.sqrt(relativeX * relativeX + relativeZ * relativeZ);

  // Desk width is 10 units, depth is 7 units
  // Use shorter max distance for more aggressive falloff
  // Table width should feel "far" - noticeable volume difference
  const maxDistance = 6; // Reduced from 10 to make distance more noticeable
  const minDistance = 0.3; // Objects closer than this are at full volume

  // Calculate volume based on distance using inverse square law for more realistic falloff
  // This creates more dramatic difference between close and far sounds
  let volume = 1;
  if (distance > minDistance) {
    // Use inverse square falloff for more realistic sound attenuation
    // Formula: volume = 1 / (1 + k * distance^2), where k controls falloff speed
    const falloffFactor = 0.15; // Higher = faster falloff
    volume = 1 / (1 + falloffFactor * Math.pow(distance - minDistance, 2));
    // Very low minimum volume - objects at table edges should be quite quiet
    volume = Math.max(0.05, volume);
  }

  // Calculate panning based on position relative to camera's viewing direction
  // When the camera rotates, the sound panorama should change accordingly
  // Transform world-space relative position to camera-local space using yaw rotation

  // Get the camera's yaw angle (horizontal rotation)
  // For reference objects other than camera, we don't apply rotation transform
  let localX = relativeX;
  if (!referenceObject && cameraLookState) {
    // Transform world-space position to screen-space position
    // When looking down -Z (at desk), positive X should be on the RIGHT
    // We use the negative of the standard right-vector projection because:
    // - Standard 3D: Camera right = (cos(yaw), 0, -sin(yaw))
    // - But for a user sitting at a desk looking at their screen:
    //   Objects to the right of center (positive X) should be in the right speaker
    // The negation accounts for this perceptual convention
    const yaw = cameraLookState.yaw;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);

    // Negated projection to match perceptual left/right:
    // localX = -(relativeX * cos(yaw) - relativeZ * sin(yaw))
    localX = -relativeX * cosYaw + relativeZ * sinYaw;
  }

  // Pan range: -1 (full left) to 1 (full right)
  // Desk width is ~10 units, so max offset is ~5 units
  const panRange = 5; // Units from center for full pan
  let pan = localX / panRange;
  pan = Math.max(-1, Math.min(1, pan)); // Clamp to [-1, 1]

  return { pan, volume };
}

/**
 * Create or update spatial audio nodes for an object
 * Creates a StereoPannerNode for panning
 * @param {THREE.Object3D} object - The object to add spatial audio to
 * @param {GainNode} sourceGain - The gain node that outputs the audio
 * @returns {{ pannerNode: StereoPannerNode, gainNode: GainNode }} - The spatial audio nodes
 */
function createSpatialAudioNodes(object, sourceGain) {
  const audioCtx = getSharedAudioContext();

  // Create stereo panner node for left/right panning
  const pannerNode = audioCtx.createStereoPanner();

  // Create gain node for distance-based volume attenuation
  const gainNode = audioCtx.createGain();

  // Connect: source -> panner -> gain -> master
  pannerNode.connect(gainNode);

  // Calculate initial spatial parameters
  const spatial = calculateSpatialAudio(object);
  pannerNode.pan.value = spatial.pan;
  gainNode.gain.value = spatial.volume;

  // Store reference for updates
  if (object.userData && object.userData.id) {
    sharedAudioSystem.spatialNodes.set(object.userData.id, {
      pannerNode,
      gainNode,
      object
    });
  }

  return { pannerNode, gainNode };
}

/**
 * Create spatial audio nodes for recording (dictaphone-centered)
 * These nodes calculate pan/volume relative to the dictaphone, not the camera
 * @param {THREE.Object3D} object - The object to add spatial audio to
 * @param {AudioNode} sourceNode - The audio node that outputs the audio
 * @returns {{ pannerNode: StereoPannerNode, gainNode: GainNode }} - The spatial audio nodes for recording
 */
function createRecordingSpatialNodes(object, sourceNode) {
  const audioCtx = getSharedAudioContext();

  // Create stereo panner node for left/right panning (relative to dictaphone)
  const pannerNode = audioCtx.createStereoPanner();

  // Create gain node for distance-based volume attenuation
  const gainNode = audioCtx.createGain();

  // Connect: source -> panner -> gain -> recordingGainPanorama
  sourceNode.connect(pannerNode);
  pannerNode.connect(gainNode);
  gainNode.connect(sharedAudioSystem.recordingGainPanorama);

  // Initial values (will be updated when recording starts with dictaphone reference)
  pannerNode.pan.value = 0;
  gainNode.gain.value = 1;

  // Store reference for updates during recording
  if (object.userData && object.userData.id) {
    sharedAudioSystem.recordingSpatialNodes.set(object.userData.id, {
      pannerNode,
      gainNode,
      object
    });
  }

  return { pannerNode, gainNode };
}

/**
 * Update spatial audio parameters for an object (call during drag or animation)
 * @param {THREE.Object3D} object - The object that moved
 */
function updateSpatialAudio(object) {
  if (!object || !object.userData || !object.userData.id) return;

  const nodes = sharedAudioSystem.spatialNodes.get(object.userData.id);
  if (!nodes) return;

  const spatial = calculateSpatialAudio(object);

  // Smoothly update panning and volume to avoid clicks
  const audioCtx = sharedAudioSystem.audioContext;
  if (audioCtx && nodes.pannerNode && nodes.gainNode) {
    const now = audioCtx.currentTime;
    nodes.pannerNode.pan.setTargetAtTime(spatial.pan, now, 0.05);
    nodes.gainNode.gain.setTargetAtTime(spatial.volume, now, 0.05);
  }
}

/**
 * Update spatial audio for all active sound sources
 * Called from the animation loop
 */
function updateAllSpatialAudio() {
  // Update playback spatial audio (camera-relative) for all sound sources
  sharedAudioSystem.spatialNodes.forEach((nodes, objectId) => {
    if (nodes.object) {
      const spatial = calculateSpatialAudio(nodes.object);
      if (nodes.pannerNode && nodes.gainNode) {
        nodes.pannerNode.pan.value = spatial.pan;
        // Apply baseVolume if defined (for custom alarm sounds with user-set volume)
        const baseVolume = nodes.baseVolume !== undefined ? nodes.baseVolume : 1;
        nodes.gainNode.gain.value = spatial.volume * baseVolume;
      }
    }
  });

  // Update recording spatial audio (dictaphone-relative) when recording with environment panorama
  if (dictaphoneState.isRecording &&
      dictaphoneState.usePanoramicEnvironment &&
      dictaphoneState.currentRecordingObject) {
    const dictaphone = dictaphoneState.currentRecordingObject;

    // Update recording spatial nodes for all sound sources relative to dictaphone
    sharedAudioSystem.recordingSpatialNodes.forEach((nodes, objectId) => {
      if (nodes.object) {
        // Calculate spatial audio relative to dictaphone position, not camera
        const spatial = calculateSpatialAudio(nodes.object, dictaphone);
        if (nodes.pannerNode && nodes.gainNode) {
          nodes.pannerNode.pan.value = spatial.pan;
          const baseVolume = nodes.baseVolume !== undefined ? nodes.baseVolume : 1;
          nodes.gainNode.gain.value = spatial.volume * baseVolume;
        }
      }
    });
  }

  // Update dictaphone microphone panner if recording with panorama enabled
  // The pan is INVERTED because from the camera's perspective, if the dictaphone
  // is on the right, the recorded voice should appear on the LEFT in the recording
  // (as if the sound source is at the camera's position looking toward the dictaphone)
  // The volume is based on distance from camera - farther = quieter
  if (dictaphoneState.isRecording &&
      dictaphoneState.useMicrophonePanorama &&
      dictaphoneState.microphonePannerNode &&
      dictaphoneState.currentRecordingObject) {
    const spatial = calculateSpatialAudio(dictaphoneState.currentRecordingObject);
    // Invert the pan: if dictaphone is on the right (+pan), voice should be on the left (-pan)
    dictaphoneState.microphonePannerNode.pan.value = -spatial.pan;
    // Apply distance-based volume attenuation
    if (dictaphoneState.microphoneSpatialGainNode) {
      dictaphoneState.microphoneSpatialGainNode.gain.value = spatial.volume;
    }
  }
}

/**
 * Remove spatial audio nodes for an object
 * @param {string|number} objectId - The object ID
 */
function removeSpatialAudioNodes(objectId) {
  // Remove playback spatial nodes
  const nodes = sharedAudioSystem.spatialNodes.get(objectId);
  if (nodes) {
    try {
      if (nodes.pannerNode) nodes.pannerNode.disconnect();
      if (nodes.gainNode) nodes.gainNode.disconnect();
    } catch (e) {
      // Ignore disconnection errors
    }
    sharedAudioSystem.spatialNodes.delete(objectId);
  }

  // Remove recording spatial nodes
  const recordingNodes = sharedAudioSystem.recordingSpatialNodes.get(objectId);
  if (recordingNodes) {
    try {
      if (recordingNodes.pannerNode) recordingNodes.pannerNode.disconnect();
      if (recordingNodes.gainNode) recordingNodes.gainNode.disconnect();
    } catch (e) {
      // Ignore disconnection errors
    }
    sharedAudioSystem.recordingSpatialNodes.delete(objectId);
  }
}

// Get or create the shared audio context
function getSharedAudioContext() {
  if (!sharedAudioSystem.audioContext) {
    sharedAudioSystem.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Create master gain node - all audio goes through here
    sharedAudioSystem.masterGain = sharedAudioSystem.audioContext.createGain();
    sharedAudioSystem.masterGain.gain.value = 1.0;
    sharedAudioSystem.masterGain.connect(sharedAudioSystem.audioContext.destination);

    // Create recording tap gain node - this is where dictaphone connects (mono recording)
    sharedAudioSystem.recordingGain = sharedAudioSystem.audioContext.createGain();
    sharedAudioSystem.recordingGain.gain.value = 1.0;
    sharedAudioSystem.masterGain.connect(sharedAudioSystem.recordingGain);

    // Create panoramic recording tap node - preserves stereo spatial audio
    // This is connected directly to spatial audio outputs (after panner nodes)
    sharedAudioSystem.recordingGainPanorama = sharedAudioSystem.audioContext.createGain();
    sharedAudioSystem.recordingGainPanorama.gain.value = 1.0;

    console.log('Shared audio system initialized with spatial audio support');
  }
  return sharedAudioSystem.audioContext;
}

// Register an active audio player (cassette player starts playing)
function registerActivePlayer(playerId, audioNodes) {
  sharedAudioSystem.activePlayers.add(playerId);
  console.log('Registered active player:', playerId, '- total:', sharedAudioSystem.activePlayers.size);
}

// Unregister an audio player (stops playing)
function unregisterActivePlayer(playerId) {
  sharedAudioSystem.activePlayers.delete(playerId);
  console.log('Unregistered player:', playerId, '- total:', sharedAudioSystem.activePlayers.size);
}

// ============================================================================
// CASSETTE PLAYER
// ============================================================================
// Cassette player state for audio effects
let cassettePlayerState = {
  audioContext: null,
  audioElement: null,
  sourceNode: null,
  gainNode: null,
  // Effect nodes for tape simulation
  tapeHissNode: null,
  lowpassNode: null,
  highpassNode: null,
  wowFlutterNode: null,
  saturationNode: null,
  // State
  isPlaying: false,
  currentTrackIndex: 0,
  currentPlayerId: null // Track which player is active
};

function createCassettePlayer(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'cassette-player',
    name: 'Cassette Player',
    interactive: false, // Uses button clicks, not modal interaction
    // Playback state
    isPlaying: false,
    currentTrackIndex: 0,
    currentTime: options.currentTime || 0, // Track position for persistence
    // Music folder
    musicFolderPath: options.musicFolderPath || null,
    audioFiles: options.audioFiles || [], // Array of {name, fullName, path}
    // Audio effects settings
    tapeHissLevel: options.tapeHissLevel !== undefined ? options.tapeHissLevel : 0.3, // 0-1
    wowFlutterLevel: options.wowFlutterLevel !== undefined ? options.wowFlutterLevel : 0.5, // 0-1
    saturationLevel: options.saturationLevel !== undefined ? options.saturationLevel : 0.4, // 0-1
    lowCutoff: options.lowCutoff !== undefined ? options.lowCutoff : 80, // Hz
    highCutoff: options.highCutoff !== undefined ? options.highCutoff : 12000, // Hz
    volume: options.volume !== undefined ? options.volume : 0.7, // 0-1
    // Cassette animation state
    reelRotation: 0,
    // Colors - Classic Sony Walkman WM-10 style: cream/silver body with red accents
    mainColor: options.mainColor || '#d4d0c8', // Cream/silver
    accentColor: options.accentColor || '#c41e3a' // Red accent
  };

  // Materials
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.35,
    metalness: 0.15
  });

  const accentMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.3,
    metalness: 0.4
  });

  const darkPanelMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e, // Dark blue-black for cassette area
    roughness: 0.6,
    metalness: 0.1
  });

  const blackMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.8,
    metalness: 0.1
  });

  const silverMaterial = new THREE.MeshStandardMaterial({
    color: 0xc0c0c0,
    roughness: 0.2,
    metalness: 0.8
  });

  // Sony Walkman WM-10 style - HORIZONTAL orientation, ultra-compact handheld design
  // Reference: Image 3 shows the iconic horizontal Walkman with side-by-side reels
  // This is a pocket-sized device that fits in hand (not a suitcase!)
  // Main body dimensions (horizontal orientation - wider than tall, very slim)
  const bodyWidth = 0.11;   // Width (wider - cassette width)
  const bodyHeight = 0.08;  // Height (shorter - cassette height + controls)
  const bodyDepth = 0.018;  // Depth (ultra-thin - just enough for mechanism)

  // Main body - cream/silver colored
  const bodyGeometry = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth);
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = bodyHeight / 2;
  body.castShadow = true;
  group.add(body);

  // Red accent stripes at top and bottom (like WM-10)
  const topStripeGeometry = new THREE.BoxGeometry(bodyWidth + 0.002, 0.003, bodyDepth + 0.002);
  const topStripe = new THREE.Mesh(topStripeGeometry, accentMaterial);
  topStripe.position.set(0, bodyHeight - 0.0015, 0);
  group.add(topStripe);

  const bottomStripeGeometry = new THREE.BoxGeometry(bodyWidth + 0.002, 0.003, bodyDepth + 0.002);
  const bottomStripe = new THREE.Mesh(bottomStripeGeometry, accentMaterial);
  bottomStripe.position.set(0, 0.0015, 0);
  group.add(bottomStripe);

  // Large cassette window - rounded corners style (oval-ish frame like WM-10)
  // Takes up most of the front face
  const windowWidth = bodyWidth * 0.75;
  const windowHeight = bodyHeight * 0.7;

  // Dark cassette area background
  const cassetteAreaGeometry = new THREE.BoxGeometry(windowWidth + 0.008, windowHeight + 0.008, 0.003);
  const cassetteArea = new THREE.Mesh(cassetteAreaGeometry, darkPanelMaterial);
  cassetteArea.position.set(-bodyWidth * 0.08, bodyHeight * 0.52, bodyDepth / 2 + 0.001);
  group.add(cassetteArea);

  // Cassette window (transparent, shows reels)
  const windowGeometry = new THREE.BoxGeometry(windowWidth, windowHeight, 0.002);
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a4a5a,
    roughness: 0.1,
    metalness: 0.0,
    transparent: true,
    opacity: 0.4
  });
  const cassetteWindow = new THREE.Mesh(windowGeometry, windowMaterial);
  cassetteWindow.position.set(-bodyWidth * 0.08, bodyHeight * 0.52, bodyDepth / 2 + 0.003);
  group.add(cassetteWindow);

  // Cassette reels (visible through window) - SIDE BY SIDE (horizontal layout)
  const reelGroup = new THREE.Group();
  reelGroup.name = 'reels';
  reelGroup.position.set(-bodyWidth * 0.08, bodyHeight * 0.52, bodyDepth / 2 + 0.005);

  // Reels sized for compact design - larger relative to window for WM-10 look
  const reelRadius = 0.022;
  const reelSpacing = 0.032; // Distance from center to each reel
  const reelGeometry = new THREE.CylinderGeometry(reelRadius, reelRadius, 0.004, 24);
  const reelMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d2d3d,
    roughness: 0.4,
    metalness: 0.3
  });

  // Left reel (supply)
  const leftReelGroup = new THREE.Group();
  leftReelGroup.name = 'leftReel';
  leftReelGroup.position.set(-reelSpacing, 0, 0);
  const leftReelMesh = new THREE.Mesh(reelGeometry, reelMaterial);
  leftReelMesh.rotation.x = Math.PI / 2;
  leftReelGroup.add(leftReelMesh);
  reelGroup.add(leftReelGroup);

  // Right reel (take-up)
  const rightReelGroup = new THREE.Group();
  rightReelGroup.name = 'rightReel';
  rightReelGroup.position.set(reelSpacing, 0, 0);
  const rightReelMesh = new THREE.Mesh(reelGeometry, reelMaterial);
  rightReelMesh.rotation.x = Math.PI / 2;
  rightReelGroup.add(rightReelMesh);
  reelGroup.add(rightReelGroup);

  // Reel center hubs (white with hexagonal shape like real cassettes)
  const hubGeometry = new THREE.CylinderGeometry(0.007, 0.007, 0.006, 6);
  const hubMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5f5f5,
    roughness: 0.3
  });

  const leftHub = new THREE.Mesh(hubGeometry, hubMaterial);
  leftHub.rotation.x = Math.PI / 2;
  leftHub.position.set(-reelSpacing, 0, 0.002);
  reelGroup.add(leftHub);

  const rightHub = new THREE.Mesh(hubGeometry, hubMaterial);
  rightHub.rotation.x = Math.PI / 2;
  rightHub.position.set(reelSpacing, 0, 0.002);
  reelGroup.add(rightHub);

  // Reel outer rings (darker rim)
  const rimGeometry = new THREE.TorusGeometry(reelRadius - 0.002, 0.0015, 8, 24);
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0x1d1d2d,
    roughness: 0.5,
    metalness: 0.4
  });

  const leftRim = new THREE.Mesh(rimGeometry, rimMaterial);
  leftRim.position.set(-reelSpacing, 0, 0.003);
  reelGroup.add(leftRim);

  const rightRim = new THREE.Mesh(rimGeometry, rimMaterial);
  rightRim.position.set(reelSpacing, 0, 0.003);
  reelGroup.add(rightRim);

  // Tape path between reels (horizontal line)
  const tapeGeometry = new THREE.BoxGeometry(reelSpacing * 1.6, 0.003, 0.001);
  const tapeMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a2a1a, // Brown tape color
    roughness: 0.8
  });
  const tape = new THREE.Mesh(tapeGeometry, tapeMaterial);
  tape.position.set(0, -reelRadius * 0.7, 0.002);
  reelGroup.add(tape);

  group.add(reelGroup);

  // "SONY" label at top left
  const sonyLabelGeometry = new THREE.BoxGeometry(0.022, 0.006, 0.001);
  const sonyLabelMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.4
  });
  const sonyLabel = new THREE.Mesh(sonyLabelGeometry, sonyLabelMaterial);
  sonyLabel.position.set(-bodyWidth * 0.32, bodyHeight * 0.85, bodyDepth / 2 + 0.002);
  group.add(sonyLabel);

  // "WALKMAN" text area on the right side (red label like WM-10)
  const walkmanLabelGeometry = new THREE.BoxGeometry(0.006, 0.035, 0.001);
  const walkmanLabel = new THREE.Mesh(walkmanLabelGeometry, accentMaterial);
  walkmanLabel.position.set(bodyWidth * 0.4, bodyHeight * 0.5, bodyDepth / 2 + 0.002);
  group.add(walkmanLabel);

  // Display screen for track name (LCD-style) - clearly visible at bottom
  const screenWidth = bodyWidth * 0.6;
  const screenHeight = 0.012;
  const screenBackGeometry = new THREE.PlaneGeometry(screenWidth, screenHeight);
  const screenBackMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d4a3e,
    roughness: 0.8,
    metalness: 0.0
  });
  const screenBack = new THREE.Mesh(screenBackGeometry, screenBackMaterial);
  screenBack.position.set(-bodyWidth * 0.08, bodyHeight * 0.12, bodyDepth / 2 + 0.002);
  screenBack.name = 'screen';
  group.add(screenBack);

  // Screen text canvas texture
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 256;
  screenCanvas.height = 32;
  const screenCtx = screenCanvas.getContext('2d');

  // Initial screen display with matching font style to clock
  screenCtx.fillStyle = '#2d4a3e';
  screenCtx.fillRect(0, 0, 256, 32);
  screenCtx.fillStyle = '#7cfc7c';
  screenCtx.font = '300 14px "Segoe UI", Arial, sans-serif';
  screenCtx.letterSpacing = '2px';
  screenCtx.textAlign = 'center';
  screenCtx.textBaseline = 'middle';
  screenCtx.fillText('NO FOLDER', 128, 16);

  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.needsUpdate = true;

  const screenDisplayMaterial = new THREE.MeshBasicMaterial({
    map: screenTexture,
    transparent: true
  });
  const screenDisplay = new THREE.Mesh(
    new THREE.PlaneGeometry(screenWidth * 0.95, screenHeight * 0.85),
    screenDisplayMaterial
  );
  screenDisplay.position.set(-bodyWidth * 0.08, bodyHeight * 0.12, bodyDepth / 2 + 0.003);
  screenDisplay.name = 'screenDisplay';
  group.add(screenDisplay);

  // Store canvas reference for updates
  group.userData.screenCanvas = screenCanvas;
  group.userData.screenCtx = screenCtx;
  group.userData.screenTexture = screenTexture;

  // Control buttons on TOP EDGE (like WM-10 slider buttons)
  // Small, recessed buttons - much smaller than the cassette face
  const buttonY = bodyHeight;  // On top surface
  const buttonZ = 0;           // Centered
  const buttonSpacing = 0.018;

  // Create buttons group
  const buttonsGroup = new THREE.Group();
  buttonsGroup.name = 'buttons';

  // Button material - silver slider style
  const buttonMaterial = new THREE.MeshStandardMaterial({
    color: 0xa0a0a0,
    roughness: 0.3,
    metalness: 0.5
  });

  // Slider-style buttons (rectangular, like WM-10)
  const sliderButtonGeometry = new THREE.BoxGeometry(0.012, 0.004, 0.008);

  // Play button (with small red accent)
  const playButtonMaterial = new THREE.MeshStandardMaterial({
    color: 0x909090,
    roughness: 0.3,
    metalness: 0.5
  });
  const playButton = new THREE.Mesh(sliderButtonGeometry, playButtonMaterial);
  playButton.position.set(-buttonSpacing * 1.5, buttonY + 0.002, buttonZ);
  playButton.name = 'playButton';
  playButton.userData.buttonType = 'play';
  buttonsGroup.add(playButton);

  // Red dot on play button
  const playDotGeometry = new THREE.CylinderGeometry(0.002, 0.002, 0.001, 8);
  const playDot = new THREE.Mesh(playDotGeometry, accentMaterial);
  playDot.rotation.x = Math.PI / 2;
  playDot.position.set(-buttonSpacing * 1.5, buttonY + 0.005, buttonZ);
  playDot.userData.buttonType = 'play';
  buttonsGroup.add(playDot);

  // Stop button
  const stopButton = new THREE.Mesh(sliderButtonGeometry, buttonMaterial);
  stopButton.position.set(-buttonSpacing * 0.5, buttonY + 0.002, buttonZ);
  stopButton.name = 'stopButton';
  stopButton.userData.buttonType = 'stop';
  buttonsGroup.add(stopButton);

  // Previous track button
  const prevButton = new THREE.Mesh(sliderButtonGeometry, buttonMaterial);
  prevButton.position.set(buttonSpacing * 0.5, buttonY + 0.002, buttonZ);
  prevButton.name = 'prevButton';
  prevButton.userData.buttonType = 'prev';
  buttonsGroup.add(prevButton);

  // Next track button
  const nextButton = new THREE.Mesh(sliderButtonGeometry, buttonMaterial);
  nextButton.position.set(buttonSpacing * 1.5, buttonY + 0.002, buttonZ);
  nextButton.name = 'nextButton';
  nextButton.userData.buttonType = 'next';
  buttonsGroup.add(nextButton);

  // Button symbols (small engravings on top)
  const symbolMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 });

  // Play symbol (▶)
  const playSymbol = new THREE.Mesh(
    new THREE.ConeGeometry(0.002, 0.003, 3),
    symbolMaterial
  );
  playSymbol.rotation.x = -Math.PI / 2;
  playSymbol.rotation.z = -Math.PI / 2;
  playSymbol.position.set(-buttonSpacing * 1.5, buttonY + 0.0045, buttonZ);
  playSymbol.name = 'playSymbol';
  playSymbol.userData.buttonType = 'play';
  buttonsGroup.add(playSymbol);

  // Stop symbol (■)
  const stopSymbol = new THREE.Mesh(
    new THREE.BoxGeometry(0.003, 0.001, 0.003),
    symbolMaterial
  );
  stopSymbol.position.set(-buttonSpacing * 0.5, buttonY + 0.0045, buttonZ);
  stopSymbol.userData.buttonType = 'stop';
  buttonsGroup.add(stopSymbol);

  // Prev symbol (◀◀)
  const prevSymbol = new THREE.Mesh(
    new THREE.ConeGeometry(0.002, 0.003, 3),
    symbolMaterial
  );
  prevSymbol.rotation.x = -Math.PI / 2;
  prevSymbol.rotation.z = Math.PI / 2;
  prevSymbol.position.set(buttonSpacing * 0.5, buttonY + 0.0045, buttonZ);
  prevSymbol.userData.buttonType = 'prev';
  buttonsGroup.add(prevSymbol);

  // Next symbol (▶▶)
  const nextSymbol = new THREE.Mesh(
    new THREE.ConeGeometry(0.002, 0.003, 3),
    symbolMaterial
  );
  nextSymbol.rotation.x = -Math.PI / 2;
  nextSymbol.rotation.z = -Math.PI / 2;
  nextSymbol.position.set(buttonSpacing * 1.5, buttonY + 0.0045, buttonZ);
  nextSymbol.userData.buttonType = 'next';
  buttonsGroup.add(nextSymbol);

  group.add(buttonsGroup);

  // Volume wheel on the right side (classic style)
  const volumeWheelGeometry = new THREE.CylinderGeometry(0.006, 0.006, 0.008, 12);
  const volumeWheel = new THREE.Mesh(volumeWheelGeometry, silverMaterial);
  volumeWheel.rotation.z = Math.PI / 2;
  volumeWheel.position.set(bodyWidth / 2 + 0.004, bodyHeight * 0.5, 0);
  volumeWheel.name = 'volumeWheel';
  group.add(volumeWheel);

  // Volume wheel ridges (grip texture)
  for (let i = 0; i < 8; i++) {
    const ridgeGeometry = new THREE.BoxGeometry(0.0008, 0.0005, 0.005);
    const ridge = new THREE.Mesh(ridgeGeometry, blackMaterial);
    const angle = (i / 8) * Math.PI * 2;
    ridge.position.set(
      bodyWidth / 2 + 0.004 + Math.cos(angle) * 0.005,
      bodyHeight * 0.5 + Math.sin(angle) * 0.005,
      0
    );
    ridge.rotation.z = angle;
    group.add(ridge);
  }

  // Headphone jack on bottom edge
  const jackGeometry = new THREE.CylinderGeometry(0.0025, 0.0025, 0.006, 8);
  const jack = new THREE.Mesh(jackGeometry, blackMaterial);
  jack.position.set(-bodyWidth * 0.2, 0, 0);
  group.add(jack);

  // Belt clip on the back (smaller for compact design)
  const clipGeometry = new THREE.BoxGeometry(0.025, 0.006, 0.012);
  const clip = new THREE.Mesh(clipGeometry, silverMaterial);
  clip.position.set(0, bodyHeight * 0.7, -bodyDepth / 2 - 0.006);
  group.add(clip);

  group.position.y = getDeskSurfaceY();

  return group;
}

// ============================================================================
// BIG CASSETTE PLAYER - Classic large portable cassette player design
// ============================================================================
// This is the original "Big player" design - a larger, more boxy cassette player
// similar to classic portable players from the 80s/90s

function createBigCassettePlayer(options = {}) {
  // Big player uses the same design as the original Walkman-style cassette player from main branch
  const group = new THREE.Group();
  group.userData = {
    type: 'big-cassette-player',
    name: 'Big Cassette Player',
    interactive: false, // Uses button clicks, not modal interaction
    // Playback state
    isPlaying: false,
    currentTrackIndex: 0,
    currentTime: options.currentTime || 0, // Track position for persistence
    // Music folder
    musicFolderPath: options.musicFolderPath || null,
    audioFiles: options.audioFiles || [], // Array of {name, fullName, path}
    // Audio effects settings
    tapeHissLevel: options.tapeHissLevel !== undefined ? options.tapeHissLevel : 0.3, // 0-1
    wowFlutterLevel: options.wowFlutterLevel !== undefined ? options.wowFlutterLevel : 0.5, // 0-1
    saturationLevel: options.saturationLevel !== undefined ? options.saturationLevel : 0.4, // 0-1
    lowCutoff: options.lowCutoff !== undefined ? options.lowCutoff : 80, // Hz
    highCutoff: options.highCutoff !== undefined ? options.highCutoff : 12000, // Hz
    volume: options.volume !== undefined ? options.volume : 0.7, // 0-1
    // Cassette animation state
    reelRotation: 0,
    // Colors - Sony Walkman style: blue body with silver accents
    mainColor: options.mainColor || '#1e3a5f', // Classic Sony blue
    accentColor: options.accentColor || '#c0c0c0' // Silver accents
  };

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.4,
    metalness: 0.3
  });

  const metalMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.2,
    metalness: 0.8
  });

  const blackMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.8,
    metalness: 0.1
  });

  // Sony Walkman-style body - more compact and rectangular
  const bodyWidth = 0.45;  // Narrower
  const bodyHeight = 0.12; // Thinner
  const bodyDepth = 0.35;  // Shorter

  // Main body with rounded edges effect
  const bodyGeometry = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth);
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = bodyHeight / 2;
  body.castShadow = true;
  group.add(body);

  // Silver accent strip at the top (Walkman signature)
  const accentStripGeometry = new THREE.BoxGeometry(bodyWidth + 0.01, 0.015, bodyDepth + 0.01);
  const accentStrip = new THREE.Mesh(accentStripGeometry, metalMaterial);
  accentStrip.position.set(0, bodyHeight - 0.005, 0);
  group.add(accentStrip);

  // Cassette door/lid area (darker recessed panel)
  const lidPanelGeometry = new THREE.BoxGeometry(bodyWidth * 0.85, bodyHeight * 0.55, 0.015);
  const lidPanelMaterial = new THREE.MeshStandardMaterial({
    color: 0x0d1f33, // Darker blue
    roughness: 0.6,
    metalness: 0.2
  });
  const lidPanel = new THREE.Mesh(lidPanelGeometry, lidPanelMaterial);
  lidPanel.position.set(0, bodyHeight / 2 + 0.01, bodyDepth / 2 + 0.005);
  group.add(lidPanel);

  // Cassette window (transparent area showing reels) - more realistic
  const windowWidth = bodyWidth * 0.55;
  const windowHeight = bodyHeight * 0.38;
  const windowGeometry = new THREE.BoxGeometry(windowWidth, windowHeight, 0.008);
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333, // Dark tinted
    roughness: 0.05,
    metalness: 0.0,
    transparent: true,
    opacity: 0.5
  });
  const cassetteWindow = new THREE.Mesh(windowGeometry, windowMaterial);
  cassetteWindow.position.set(0, bodyHeight / 2 + 0.015, bodyDepth / 2 + 0.015);
  group.add(cassetteWindow);

  // Window frame (silver)
  const frameThickness = 0.008;
  const frameGeometry = new THREE.BoxGeometry(windowWidth + frameThickness * 2, windowHeight + frameThickness * 2, 0.005);
  const windowFrame = new THREE.Mesh(frameGeometry, metalMaterial);
  windowFrame.position.set(0, bodyHeight / 2 + 0.015, bodyDepth / 2 + 0.012);
  group.add(windowFrame);

  // Cassette reels (visible through window) - use Groups for proper rotation
  const reelGroup = new THREE.Group();
  reelGroup.name = 'reels';
  reelGroup.position.set(0, bodyHeight / 2 + 0.015, bodyDepth / 2 + 0.018);

  const reelGeometry = new THREE.CylinderGeometry(0.035, 0.035, 0.015, 16);
  const reelMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d2d2d,
    roughness: 0.5,
    metalness: 0.3
  });

  // Left reel (supply) - wrapped in a group for proper rotation axis
  const leftReelGroup = new THREE.Group();
  leftReelGroup.name = 'leftReel';
  leftReelGroup.position.set(-0.065, 0, 0);
  const leftReelMesh = new THREE.Mesh(reelGeometry, reelMaterial);
  leftReelMesh.rotation.x = Math.PI / 2; // Orient to face user
  leftReelGroup.add(leftReelMesh);
  reelGroup.add(leftReelGroup);

  // Right reel (take-up) - wrapped in a group for proper rotation axis
  const rightReelGroup = new THREE.Group();
  rightReelGroup.name = 'rightReel';
  rightReelGroup.position.set(0.065, 0, 0);
  const rightReelMesh = new THREE.Mesh(reelGeometry, reelMaterial);
  rightReelMesh.rotation.x = Math.PI / 2; // Orient to face user
  rightReelGroup.add(rightReelMesh);
  reelGroup.add(rightReelGroup);

  // Reel center hubs (white with spokes pattern)
  const hubGeometry = new THREE.CylinderGeometry(0.012, 0.012, 0.018, 6);
  const hubMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.3
  });

  const leftHub = new THREE.Mesh(hubGeometry, hubMaterial);
  leftHub.rotation.x = Math.PI / 2;
  leftHub.position.set(-0.065, 0, 0.003);
  reelGroup.add(leftHub);

  const rightHub = new THREE.Mesh(hubGeometry, hubMaterial);
  rightHub.rotation.x = Math.PI / 2;
  rightHub.position.set(0.065, 0, 0.003);
  reelGroup.add(rightHub);

  // Tape between reels
  const tapeGeometry = new THREE.BoxGeometry(0.09, 0.003, 0.002);
  const tapeMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a2a1a, // Brown tape color
    roughness: 0.8
  });
  const tape = new THREE.Mesh(tapeGeometry, tapeMaterial);
  tape.position.set(0, 0.022, 0);
  reelGroup.add(tape);

  group.add(reelGroup);

  // Display screen for track name (LCD-style) - positioned below cassette window on front face
  const screenWidth = bodyWidth * 0.75;
  const screenHeight = 0.028;
  const screenGeometry = new THREE.PlaneGeometry(screenWidth, screenHeight);
  const screenBackMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d4a3e, // Dark green LCD background
    roughness: 0.8,
    metalness: 0.0
  });
  const screenBack = new THREE.Mesh(screenGeometry, screenBackMaterial);
  screenBack.position.set(0, bodyHeight / 2 - 0.028, bodyDepth / 2 + 0.008);
  screenBack.name = 'screen';
  group.add(screenBack);

  // Screen text canvas texture
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 256;
  screenCanvas.height = 32;
  const screenCtx = screenCanvas.getContext('2d');

  // Initial screen display
  screenCtx.fillStyle = '#2d4a3e';
  screenCtx.fillRect(0, 0, 256, 32);
  screenCtx.fillStyle = '#7cfc7c'; // Green LCD text
  screenCtx.font = 'bold 18px Courier New, monospace';
  screenCtx.textAlign = 'center';
  screenCtx.textBaseline = 'middle';
  screenCtx.fillText('NO FOLDER', 128, 16);

  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.needsUpdate = true;

  const screenDisplayMaterial = new THREE.MeshBasicMaterial({
    map: screenTexture,
    transparent: true
  });
  const screenDisplay = new THREE.Mesh(
    new THREE.PlaneGeometry(screenWidth * 0.95, screenHeight * 0.85),
    screenDisplayMaterial
  );
  screenDisplay.position.set(0, bodyHeight / 2 - 0.028, bodyDepth / 2 + 0.009);
  screenDisplay.name = 'screenDisplay';
  group.add(screenDisplay);

  // Store canvas reference for updates
  group.userData.screenCanvas = screenCanvas;
  group.userData.screenCtx = screenCtx;
  group.userData.screenTexture = screenTexture;

  // Control buttons - Walkman style (horizontal row at bottom front)
  const buttonWidth = 0.045;
  const buttonHeight = 0.018;
  const buttonDepth = 0.012;
  const buttonY = bodyHeight / 2 - 0.052;
  const buttonZ = bodyDepth / 2 + 0.003;
  const buttonSpacing = 0.055;

  const buttonGeometry = new THREE.BoxGeometry(buttonWidth, buttonHeight, buttonDepth);

  // Button materials - Walkman style (silver/gray buttons)
  const buttonMaterial = new THREE.MeshStandardMaterial({
    color: 0x808080,
    roughness: 0.4,
    metalness: 0.5
  });
  const playButtonMaterial = new THREE.MeshStandardMaterial({
    color: 0xff6600, // Orange play button (Sony style)
    roughness: 0.4,
    metalness: 0.3
  });
  const stopButtonMaterial = new THREE.MeshStandardMaterial({
    color: 0x606060,
    roughness: 0.4,
    metalness: 0.5
  });

  // Create buttons group
  const buttonsGroup = new THREE.Group();
  buttonsGroup.name = 'buttons';

  // Previous track button (|◀)
  const prevButton = new THREE.Mesh(buttonGeometry, buttonMaterial);
  prevButton.position.set(-buttonSpacing * 1.5, buttonY, buttonZ);
  prevButton.name = 'prevButton';
  prevButton.userData.buttonType = 'prev';
  buttonsGroup.add(prevButton);

  // Play/Pause button (▶/❚❚)
  const playButton = new THREE.Mesh(buttonGeometry, playButtonMaterial);
  playButton.position.set(-buttonSpacing * 0.5, buttonY, buttonZ);
  playButton.name = 'playButton';
  playButton.userData.buttonType = 'play';
  buttonsGroup.add(playButton);

  // Stop button (■)
  const stopButton = new THREE.Mesh(buttonGeometry, stopButtonMaterial);
  stopButton.position.set(buttonSpacing * 0.5, buttonY, buttonZ);
  stopButton.name = 'stopButton';
  stopButton.userData.buttonType = 'stop';
  buttonsGroup.add(stopButton);

  // Next track button (▶|)
  const nextButton = new THREE.Mesh(buttonGeometry, buttonMaterial);
  nextButton.position.set(buttonSpacing * 1.5, buttonY, buttonZ);
  nextButton.name = 'nextButton';
  nextButton.userData.buttonType = 'next';
  buttonsGroup.add(nextButton);

  // Add button symbols using small geometries
  const symbolMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });

  // Prev symbol (◀|) - also add buttonType to symbols for click detection
  const prevSymbol1 = new THREE.Mesh(
    new THREE.ConeGeometry(0.006, 0.012, 3),
    symbolMaterial
  );
  prevSymbol1.rotation.z = Math.PI / 2;
  prevSymbol1.position.set(-buttonSpacing * 1.5 + 0.004, buttonY, buttonZ + buttonDepth / 2 + 0.002);
  prevSymbol1.userData.buttonType = 'prev'; // Add for click detection
  buttonsGroup.add(prevSymbol1);

  const prevSymbol2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.002, 0.012, 0.002),
    symbolMaterial
  );
  prevSymbol2.position.set(-buttonSpacing * 1.5 - 0.01, buttonY, buttonZ + buttonDepth / 2 + 0.002);
  prevSymbol2.userData.buttonType = 'prev'; // Add for click detection
  buttonsGroup.add(prevSymbol2);

  // Play symbol (▶)
  const playSymbol = new THREE.Mesh(
    new THREE.ConeGeometry(0.007, 0.014, 3),
    symbolMaterial
  );
  playSymbol.rotation.z = -Math.PI / 2;
  playSymbol.position.set(-buttonSpacing * 0.5, buttonY, buttonZ + buttonDepth / 2 + 0.002);
  playSymbol.name = 'playSymbol';
  playSymbol.userData.buttonType = 'play'; // Add for click detection
  buttonsGroup.add(playSymbol);

  // Stop symbol (■)
  const stopSymbol = new THREE.Mesh(
    new THREE.BoxGeometry(0.009, 0.009, 0.002),
    symbolMaterial
  );
  stopSymbol.position.set(buttonSpacing * 0.5, buttonY, buttonZ + buttonDepth / 2 + 0.002);
  stopSymbol.userData.buttonType = 'stop'; // Add for click detection
  buttonsGroup.add(stopSymbol);

  // Next symbol (|▶)
  const nextSymbol1 = new THREE.Mesh(
    new THREE.BoxGeometry(0.002, 0.012, 0.002),
    symbolMaterial
  );
  nextSymbol1.position.set(buttonSpacing * 1.5 - 0.01, buttonY, buttonZ + buttonDepth / 2 + 0.002);
  nextSymbol1.userData.buttonType = 'next'; // Add for click detection
  buttonsGroup.add(nextSymbol1);

  const nextSymbol2 = new THREE.Mesh(
    new THREE.ConeGeometry(0.006, 0.012, 3),
    symbolMaterial
  );
  nextSymbol2.rotation.z = -Math.PI / 2;
  nextSymbol2.position.set(buttonSpacing * 1.5 + 0.004, buttonY, buttonZ + buttonDepth / 2 + 0.002);
  nextSymbol2.userData.buttonType = 'next'; // Add for click detection
  buttonsGroup.add(nextSymbol2);

  group.add(buttonsGroup);

  // Volume wheel on the side (classic Walkman style)
  const volumeWheelGeometry = new THREE.CylinderGeometry(0.015, 0.015, 0.02, 16);
  const volumeWheel = new THREE.Mesh(volumeWheelGeometry, metalMaterial);
  volumeWheel.rotation.z = Math.PI / 2;
  volumeWheel.position.set(bodyWidth / 2 + 0.01, bodyHeight / 2, -0.05);
  volumeWheel.name = 'volumeWheel';
  group.add(volumeWheel);

  // Headphone jack (3.5mm)
  const jackGeometry = new THREE.CylinderGeometry(0.006, 0.006, 0.015, 8);
  const jack = new THREE.Mesh(jackGeometry, blackMaterial);
  jack.rotation.x = Math.PI / 2;
  jack.position.set(bodyWidth / 4, bodyHeight / 2, -bodyDepth / 2 - 0.008);
  group.add(jack);

  // "WALKMAN" style text label (decorative stripe)
  const labelGeometry = new THREE.BoxGeometry(bodyWidth * 0.5, 0.008, 0.003);
  const labelMaterial = new THREE.MeshStandardMaterial({
    color: 0xff6600, // Orange Sony accent
    roughness: 0.3,
    metalness: 0.5
  });
  const label = new THREE.Mesh(labelGeometry, labelMaterial);
  label.position.set(0, 0.003, bodyDepth / 2 + 0.001);
  group.add(label);

  // Belt clip on the back
  const clipGeometry = new THREE.BoxGeometry(0.06, 0.015, 0.025);
  const clip = new THREE.Mesh(clipGeometry, metalMaterial);
  clip.position.set(0, bodyHeight - 0.008, -bodyDepth / 2 + 0.012);
  group.add(clip);

  group.position.y = getDeskSurfaceY();

  return group;
}

// Update cassette player screen display
function updateCassetteScreen(object, text, scrolling = false) {
  if (!object.userData.screenCtx || !object.userData.screenTexture) return;

  const ctx = object.userData.screenCtx;
  const canvas = object.userData.screenCanvas;

  // Clear screen with LCD background
  ctx.fillStyle = '#2d4a3e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw text in LCD green with font style matching clock display
  ctx.fillStyle = '#7cfc7c';
  ctx.font = '300 14px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Handle long text with scrolling or truncation
  let displayText = text;
  if (text.length > 18) {
    if (scrolling && object.userData.isPlaying) {
      // Animate scrolling text
      const time = Date.now();
      const scrollOffset = Math.floor((time / 200) % (text.length + 5));
      const paddedText = text + '     ' + text;
      displayText = paddedText.substring(scrollOffset, scrollOffset + 18);
    } else {
      displayText = text.substring(0, 15) + '...';
    }
  }

  ctx.fillText(displayText, canvas.width / 2, canvas.height / 2);

  object.userData.screenTexture.needsUpdate = true;
}

// ============================================================================
// CASSETTE AUDIO EFFECTS
// ============================================================================
// Creates tape-like audio effects: hiss, wow & flutter, frequency limiting, saturation

function createCassetteAudioNodes(audioContext) {
  const nodes = {};

  // Tape hiss generator (white noise)
  const bufferSize = 2 * audioContext.sampleRate;
  const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }

  nodes.noiseSource = audioContext.createBufferSource();
  nodes.noiseSource.buffer = noiseBuffer;
  nodes.noiseSource.loop = true;

  // Noise gain (for tape hiss level)
  nodes.noiseGain = audioContext.createGain();
  nodes.noiseGain.gain.value = 0.02; // Very low - background hiss

  // High-pass filter for noise (to make it more like tape hiss)
  nodes.noiseHighpass = audioContext.createBiquadFilter();
  nodes.noiseHighpass.type = 'highpass';
  nodes.noiseHighpass.frequency.value = 2000;

  // Connect noise chain
  nodes.noiseSource.connect(nodes.noiseHighpass);
  nodes.noiseHighpass.connect(nodes.noiseGain);

  // Low-pass filter (tape frequency limitation - around 12-15kHz)
  nodes.lowpass = audioContext.createBiquadFilter();
  nodes.lowpass.type = 'lowpass';
  nodes.lowpass.frequency.value = 12000;
  nodes.lowpass.Q.value = 0.7;

  // High-pass filter (remove very low frequencies)
  nodes.highpass = audioContext.createBiquadFilter();
  nodes.highpass.type = 'highpass';
  nodes.highpass.frequency.value = 80;
  nodes.highpass.Q.value = 0.7;

  // Mid-range boost (tape warmth)
  nodes.midBoost = audioContext.createBiquadFilter();
  nodes.midBoost.type = 'peaking';
  nodes.midBoost.frequency.value = 1000;
  nodes.midBoost.Q.value = 0.8;
  nodes.midBoost.gain.value = 2; // Slight boost

  // Wow and Flutter (pitch modulation) using delay with modulated time
  nodes.wowFlutterDelay = audioContext.createDelay(0.1);
  nodes.wowFlutterDelay.delayTime.value = 0.005;

  // LFO for wow effect (slow pitch variation)
  nodes.wowLFO = audioContext.createOscillator();
  nodes.wowLFO.type = 'sine';
  nodes.wowLFO.frequency.value = 0.5; // 0.5 Hz - slow wow

  nodes.wowLFOGain = audioContext.createGain();
  nodes.wowLFOGain.gain.value = 0.001; // Small delay modulation

  // LFO for flutter effect (faster pitch variation)
  nodes.flutterLFO = audioContext.createOscillator();
  nodes.flutterLFO.type = 'sine';
  nodes.flutterLFO.frequency.value = 6; // 6 Hz - faster flutter

  nodes.flutterLFOGain = audioContext.createGain();
  nodes.flutterLFOGain.gain.value = 0.0005; // Smaller modulation

  // Connect LFOs to delay time
  nodes.wowLFO.connect(nodes.wowLFOGain);
  nodes.wowLFOGain.connect(nodes.wowFlutterDelay.delayTime);

  nodes.flutterLFO.connect(nodes.flutterLFOGain);
  nodes.flutterLFOGain.connect(nodes.wowFlutterDelay.delayTime);

  // Soft saturation using waveshaper (tape saturation)
  nodes.saturation = audioContext.createWaveShaper();
  nodes.saturation.curve = createSaturationCurve(0.4);
  nodes.saturation.oversample = '2x';

  // Main gain
  nodes.mainGain = audioContext.createGain();
  nodes.mainGain.gain.value = 0.7;

  // Output merger (to combine music with noise)
  nodes.merger = audioContext.createGain();

  return nodes;
}

// Create saturation curve for waveshaper
function createSaturationCurve(amount) {
  const samples = 44100;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    // Soft clipping formula
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }

  return curve;
}

// Show track name overlay (AIMP style - top of screen, semi-transparent)
// Uses same font style as the clock display (#clock-display in index.html) but larger and bolder
// The clock uses: font-size: 24px, font-weight: 300, letter-spacing: 2px
// We use larger, bolder, and 60-70% opacity as requested
function showTrackNameOverlay(trackName) {
  // Remove any existing overlay
  const existingOverlay = document.getElementById('track-name-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }

  // Create overlay element
  const overlay = document.createElement('div');
  overlay.id = 'track-name-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 60px;
    left: 50%;
    transform: translateX(-50%);
    padding: 15px 30px;
    color: rgba(255, 255, 255, 0.65);
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 32px;
    font-weight: 600;
    letter-spacing: 2px;
    z-index: 10000;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s ease-in-out;
    max-width: 80%;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 2px 15px rgba(0, 0, 0, 0.5);
  `;
  overlay.textContent = trackName;
  document.body.appendChild(overlay);

  // Fade in
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
  });

  // Fade out after 3 seconds
  setTimeout(() => {
    overlay.style.opacity = '0';
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.remove();
      }
    }, 300);
  }, 3000);
}

// Play audio with cassette effects
async function playCassetteTrack(object, trackIndex, startTime = 0) {
  if (!object.userData.audioFiles || object.userData.audioFiles.length === 0) {
    console.log('No audio files to play');
    return;
  }

  // Clamp track index
  trackIndex = Math.max(0, Math.min(trackIndex, object.userData.audioFiles.length - 1));
  object.userData.currentTrackIndex = trackIndex;
  // Reset currentTime when starting a new track (unless resuming)
  if (startTime === 0) {
    object.userData.currentTime = 0;
  }

  const track = object.userData.audioFiles[trackIndex];
  console.log('Playing cassette track:', track.name);

  // Update screen display
  updateCassetteScreen(object, track.name, true);

  // Show track name overlay (AIMP style) - only when starting a new track
  if (startTime === 0) {
    showTrackNameOverlay(track.name);
  }

  try {
    // Stop this player's currently playing audio (not other players!)
    stopPlayerAudio(object);

    // Read audio file
    const result = await window.electronAPI.readAudioFile(track.path);
    if (!result.success) {
      console.error('Failed to read audio file:', result.error);
      updateCassetteScreen(object, 'READ ERROR');
      return;
    }

    // Use shared audio context for all audio sources
    // This allows the dictaphone to capture audio from cassette players
    const audioCtx = getSharedAudioContext();
    cassettePlayerState.audioContext = audioCtx;

    // Resume context if suspended
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    // Create HTML5 Audio element for playback
    const audio = new Audio(result.dataUrl);
    audio.volume = 1.0; // Volume controlled through gain nodes

    // Store audio state per-player in object.userData (allows independent playback)
    object.userData.audioElement = audio;
    object.userData.audioContext = audioCtx;

    // Create media element source
    const sourceNode = audioCtx.createMediaElementSource(audio);
    object.userData.sourceNode = sourceNode;

    // Create effect nodes
    const nodes = createCassetteAudioNodes(audioCtx);

    // Apply user settings
    const hissLevel = object.userData.tapeHissLevel || 0.3;
    const wowFlutterLevel = object.userData.wowFlutterLevel || 0.5;
    const saturationLevel = object.userData.saturationLevel || 0.4;
    const volume = object.userData.volume || 0.7;

    // Adjust effect levels
    // Noise gain is scaled by both hissLevel and volume so white noise respects the main volume
    nodes.noiseGain.gain.value = 0.015 * hissLevel * volume;
    nodes.wowLFOGain.gain.value = 0.001 * wowFlutterLevel;
    nodes.flutterLFOGain.gain.value = 0.0005 * wowFlutterLevel;
    nodes.saturation.curve = createSaturationCurve(saturationLevel);
    nodes.mainGain.gain.value = volume;

    // Set frequency limits
    nodes.lowpass.frequency.value = object.userData.highCutoff || 12000;
    nodes.highpass.frequency.value = object.userData.lowCutoff || 80;

    // Connect the audio chain:
    // source -> highpass -> lowpass -> midBoost -> wowFlutter -> saturation -> mainGain -> destination
    sourceNode.connect(nodes.highpass);
    nodes.highpass.connect(nodes.lowpass);
    nodes.lowpass.connect(nodes.midBoost);
    nodes.midBoost.connect(nodes.wowFlutterDelay);
    nodes.wowFlutterDelay.connect(nodes.saturation);
    nodes.saturation.connect(nodes.mainGain);
    nodes.mainGain.connect(nodes.merger);

    // Connect noise (tape hiss) to merger
    nodes.noiseGain.connect(nodes.merger);

    // Create spatial audio nodes for position-based panning and volume
    // This enables sound to change based on object position relative to camera
    const spatialNodes = createSpatialAudioNodes(object, nodes.merger);

    // Connect merger -> spatial panner -> spatial gain -> master (for playback)
    nodes.merger.connect(spatialNodes.pannerNode);
    spatialNodes.gainNode.connect(sharedAudioSystem.masterGain);

    // Connect merger to mono recording (no spatial processing)
    nodes.merger.connect(sharedAudioSystem.recordingGain);

    // Create separate spatial nodes for recording (dictaphone-centered)
    // These are updated relative to dictaphone position, not camera
    const recordingSpatialNodes = createRecordingSpatialNodes(object, nodes.merger);
    nodes.recordingSpatialPanner = recordingSpatialNodes.pannerNode;
    nodes.recordingSpatialGain = recordingSpatialNodes.gainNode;

    // Store spatial nodes for position updates
    nodes.spatialPanner = spatialNodes.pannerNode;
    nodes.spatialGain = spatialNodes.gainNode;

    // Register this player as active for dictaphone to know about
    registerActivePlayer(object.userData.id, nodes);
    object.userData.connectedToSharedAudio = true;

    // Store nodes for cleanup per-player
    object.userData.effectNodes = nodes;

    // Start LFOs
    nodes.wowLFO.start();
    nodes.flutterLFO.start();
    nodes.noiseSource.start();

    // Handle track end
    audio.onended = () => {
      if (object.userData.isPlaying) {
        // Auto-play next track
        const nextIndex = object.userData.currentTrackIndex + 1;
        if (nextIndex < object.userData.audioFiles.length) {
          playCassetteTrack(object, nextIndex);
        } else {
          // End of playlist
          stopPlayerAudio(object);
          object.userData.isPlaying = false;
          object.userData.currentTrackIndex = 0;
          object.userData.currentTime = 0;
          updateCassetteScreen(object, 'END');
          saveState();
        }
      }
    };

    // Update currentTime periodically for persistence
    audio.ontimeupdate = () => {
      object.userData.currentTime = audio.currentTime;
    };

    // Set start time if resuming from a previous position
    if (startTime > 0) {
      audio.currentTime = startTime;
    }

    // Start playback
    await audio.play();
    object.userData.isPlaying = true;

    saveState();
  } catch (error) {
    console.error('Error playing cassette track:', error);
    updateCassetteScreen(object, 'PLAY ERROR');
    object.userData.isPlaying = false;
  }
}

// Stop a specific player's audio (per-player audio state)
function stopPlayerAudio(object) {
  if (!object || !object.userData) return;

  if (object.userData.audioElement) {
    object.userData.audioElement.pause();
    object.userData.audioElement.src = '';
    object.userData.audioElement = null;
  }

  if (object.userData.sourceNode) {
    try {
      object.userData.sourceNode.disconnect();
    } catch (e) {}
    object.userData.sourceNode = null;
  }

  if (object.userData.effectNodes) {
    const nodes = object.userData.effectNodes;
    try {
      if (nodes.wowLFO) nodes.wowLFO.stop();
      if (nodes.flutterLFO) nodes.flutterLFO.stop();
      if (nodes.noiseSource) nodes.noiseSource.stop();
      // Disconnect spatial audio nodes
      if (nodes.spatialPanner) nodes.spatialPanner.disconnect();
      if (nodes.spatialGain) nodes.spatialGain.disconnect();
    } catch (e) {}
    object.userData.effectNodes = null;
  }

  // Remove spatial audio nodes from tracking
  removeSpatialAudioNodes(object.userData.id);

  // Unregister from shared audio system
  if (object.userData.connectedToSharedAudio) {
    unregisterActivePlayer(object.userData.id);
    object.userData.connectedToSharedAudio = false;
  }

  object.userData.isPlaying = false;
}

// Stop cassette playback (legacy - for backwards compatibility)
function stopCassettePlayback() {
  if (cassettePlayerState.audioElement) {
    cassettePlayerState.audioElement.pause();
    cassettePlayerState.audioElement.src = '';
    cassettePlayerState.audioElement = null;
  }

  if (cassettePlayerState.sourceNode) {
    try {
      cassettePlayerState.sourceNode.disconnect();
    } catch (e) {}
    cassettePlayerState.sourceNode = null;
  }

  if (cassettePlayerState.effectNodes) {
    const nodes = cassettePlayerState.effectNodes;
    try {
      if (nodes.wowLFO) nodes.wowLFO.stop();
      if (nodes.flutterLFO) nodes.flutterLFO.stop();
      if (nodes.noiseSource) nodes.noiseSource.stop();
    } catch (e) {}
    cassettePlayerState.effectNodes = null;
  }

  cassettePlayerState.isPlaying = false;
}

// Pause/resume cassette playback (uses per-player audio state)
function toggleCassettePlayback(object) {
  if (!object.userData.audioElement) {
    // Not playing - start from current track
    if (object.userData.audioFiles && object.userData.audioFiles.length > 0) {
      playCassetteTrack(object, object.userData.currentTrackIndex, object.userData.currentTime);
    } else {
      updateCassetteScreen(object, 'NO MUSIC');
    }
    return;
  }

  if (object.userData.audioElement.paused) {
    object.userData.audioElement.play();
    object.userData.isPlaying = true;
    // Resume tape hiss when resuming playback (scaled by volume)
    if (object.userData.effectNodes && object.userData.effectNodes.noiseGain) {
      const hissLevel = object.userData.tapeHissLevel || 0.3;
      const volume = object.userData.volume || 0.7;
      object.userData.effectNodes.noiseGain.gain.value = 0.015 * hissLevel * volume;
    }
  } else {
    object.userData.audioElement.pause();
    object.userData.isPlaying = false;
    // Store current playback position for persistence
    object.userData.currentTime = object.userData.audioElement.currentTime;
    // Mute tape hiss when pausing (set noise gain to 0)
    if (object.userData.effectNodes && object.userData.effectNodes.noiseGain) {
      object.userData.effectNodes.noiseGain.gain.value = 0;
    }
  }

  saveState();
}

// Previous track (uses per-player audio state)
function cassettePrevTrack(object) {
  if (!object.userData.audioFiles || object.userData.audioFiles.length === 0) return;

  const newIndex = Math.max(0, object.userData.currentTrackIndex - 1);
  if (object.userData.isPlaying) {
    playCassetteTrack(object, newIndex);
  } else {
    object.userData.currentTrackIndex = newIndex;
    updateCassetteScreen(object, object.userData.audioFiles[newIndex].name);
    saveState();
  }
}

// Next track (uses per-player audio state)
function cassetteNextTrack(object) {
  if (!object.userData.audioFiles || object.userData.audioFiles.length === 0) return;

  const newIndex = Math.min(object.userData.audioFiles.length - 1, object.userData.currentTrackIndex + 1);
  if (object.userData.isPlaying) {
    playCassetteTrack(object, newIndex);
  } else {
    object.userData.currentTrackIndex = newIndex;
    updateCassetteScreen(object, object.userData.audioFiles[newIndex].name);
    saveState();
  }
}

// Stop cassette player (uses per-player audio state)
function cassetteStop(object) {
  stopPlayerAudio(object);
  object.userData.isPlaying = false;
  object.userData.currentTrackIndex = 0;
  object.userData.currentTime = 0;

  if (object.userData.audioFiles && object.userData.audioFiles.length > 0) {
    updateCassetteScreen(object, 'STOPPED');
  } else {
    updateCassetteScreen(object, 'NO FOLDER');
  }

  saveState();
}

// Handle button click on cassette player
function handleCassetteButtonClick(object, buttonType) {
  switch (buttonType) {
    case 'prev':
      cassettePrevTrack(object);
      break;
    case 'play':
      toggleCassettePlayback(object);
      break;
    case 'stop':
      cassetteStop(object);
      break;
    case 'next':
      cassetteNextTrack(object);
      break;
  }
}

// ============================================================================
// DICTAPHONE
// ============================================================================
// Dictaphone state for recording
let dictaphoneState = {
  audioContext: null,
  mediaRecorder: null,
  recordedChunks: [],
  isRecording: false,
  currentRecorderId: null,
  microphoneStream: null,
  // For mixing virtual room sounds with microphone
  destinationNode: null,
  microphoneGainNode: null,
  microphonePannerNode: null, // For panoramic microphone recording (left/right panning)
  microphoneSpatialGainNode: null, // For panoramic microphone recording (distance-based volume)
  virtualAudioGainNode: null,
  sampleRate: 48000,
  // For volume level visualization
  analyserNode: null,
  microphoneSource: null,
  // For dynamic panorama switching during recording
  currentRecordingObject: null,  // Reference to the dictaphone object being recorded
  usePanoramicEnvironment: false,  // Current environment panorama state
  useMicrophonePanorama: false     // Current microphone panorama state
};

// Pure JavaScript WAV encoder - converts AudioBuffer to WAV format
function encodeWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;

  // Get all channel data
  const channels = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }
  const numSamples = channels[0].length;

  // Calculate buffer size
  const dataSize = numSamples * blockAlign;
  const bufferSize = 44 + dataSize;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // Write WAV header
  let offset = 0;

  // RIFF chunk descriptor
  writeString(view, offset, 'RIFF'); offset += 4;
  view.setUint32(offset, bufferSize - 8, true); offset += 4;
  writeString(view, offset, 'WAVE'); offset += 4;

  // fmt sub-chunk
  writeString(view, offset, 'fmt '); offset += 4;
  view.setUint32(offset, 16, true); offset += 4; // Subchunk1Size (16 for PCM)
  view.setUint16(offset, 1, true); offset += 2; // AudioFormat (1 = PCM)
  view.setUint16(offset, numChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true); offset += 4; // ByteRate
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, bitsPerSample, true); offset += 2;

  // data sub-chunk
  writeString(view, offset, 'data'); offset += 4;
  view.setUint32(offset, dataSize, true); offset += 4;

  // Write interleaved audio data
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return buffer;

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}

// Encode WAV directly from PCM Float32Array samples (no decoding required)
// This avoids decodeAudioData() which can hang on certain audio data
function encodePcmToWav(pcmChunks, sampleRate, numChannels = 1) {
  // Concatenate all PCM chunks into a single Float32Array
  const totalLength = pcmChunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const samples = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of pcmChunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }

  // Convert to 16-bit PCM
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const bufferSize = 44 + dataSize;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  function writeString(view, off, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(off + i, string.charCodeAt(i));
    }
  }

  let pos = 0;
  // RIFF chunk descriptor
  writeString(view, pos, 'RIFF'); pos += 4;
  view.setUint32(pos, bufferSize - 8, true); pos += 4;
  writeString(view, pos, 'WAVE'); pos += 4;

  // fmt sub-chunk
  writeString(view, pos, 'fmt '); pos += 4;
  view.setUint32(pos, 16, true); pos += 4; // Subchunk1Size
  view.setUint16(pos, 1, true); pos += 2; // AudioFormat (PCM)
  view.setUint16(pos, numChannels, true); pos += 2;
  view.setUint32(pos, sampleRate, true); pos += 4;
  view.setUint32(pos, sampleRate * blockAlign, true); pos += 4; // ByteRate
  view.setUint16(pos, blockAlign, true); pos += 2;
  view.setUint16(pos, bitsPerSample, true); pos += 2;

  // data sub-chunk
  writeString(view, pos, 'data'); pos += 4;
  view.setUint32(pos, dataSize, true); pos += 4;

  // Write audio data
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(pos, intSample, true);
    pos += 2;
  }

  return buffer;
}

// Convert webm blob to WAV using AudioContext
// Note: decodeAudioData may not support WebM/Opus in all browsers/versions
// Adding timeout to prevent hanging
async function convertWebmToWav(webmBlob, audioContext) {
  const DECODE_TIMEOUT = 10000; // 10 second timeout

  try {
    console.log('convertWebmToWav: Starting conversion, blob size:', webmBlob.size);
    const arrayBuffer = await webmBlob.arrayBuffer();
    console.log('convertWebmToWav: ArrayBuffer created, size:', arrayBuffer.byteLength);

    // Wrap decodeAudioData with timeout to prevent hanging
    const audioBuffer = await Promise.race([
      audioContext.decodeAudioData(arrayBuffer.slice(0)), // Use slice to create a copy (decodeAudioData detaches the buffer)
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('decodeAudioData timeout - WebM format may not be supported')), DECODE_TIMEOUT)
      )
    ]);

    console.log('convertWebmToWav: Audio decoded, duration:', audioBuffer.duration, 'seconds, channels:', audioBuffer.numberOfChannels);

    const wavBuffer = encodeWav(audioBuffer);
    console.log('convertWebmToWav: WAV encoded, size:', wavBuffer.byteLength);

    return new Blob([wavBuffer], { type: 'audio/wav' });
  } catch (error) {
    console.error('convertWebmToWav: Error converting WebM to WAV:', error.message);
    console.error('convertWebmToWav: This may be because decodeAudioData does not support WebM/Opus format');
    throw error;
  }
}

function createDictaphone(options = {}) {
  const group = new THREE.Group();
  group.userData = {
    type: 'dictaphone',
    name: 'Dictaphone',
    interactive: false, // Uses button clicks, not modal interaction
    // Recording state
    isRecording: false,
    recordingNumber: options.recordingNumber || 1,
    // Folder for saving recordings
    recordingsFolderPath: options.recordingsFolderPath || null,
    // Recording format: 'wav' (default), 'mp3', or 'webm'
    recordingFormat: options.recordingFormat || 'wav',
    // Recording volume: 0-200% (default 100%)
    recordingVolume: options.recordingVolume !== undefined ? options.recordingVolume : 100,
    // Panoramic recording options (for spatial audio)
    recordMicrophonePanorama: options.recordMicrophonePanorama !== undefined ? options.recordMicrophonePanorama : false,
    recordEnvironmentPanorama: options.recordEnvironmentPanorama !== undefined ? options.recordEnvironmentPanorama : true,
    // Colors - all black minimalist design
    mainColor: options.mainColor || '#1a1a1a', // Black
    accentColor: options.accentColor || '#2a2a2a' // Dark gray accent
  };

  // Materials - black plastic
  const blackPlasticMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.mainColor),
    roughness: 0.7,
    metalness: 0.1
  });

  const darkGrayMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.userData.accentColor),
    roughness: 0.6,
    metalness: 0.2
  });

  // Flat base/stand - rectangular, flat
  const baseWidth = 0.12;
  const baseDepth = 0.08;
  const baseHeight = 0.015;
  const baseGeometry = new THREE.BoxGeometry(baseWidth, baseHeight, baseDepth);
  const base = new THREE.Mesh(baseGeometry, blackPlasticMaterial);
  base.position.y = baseHeight / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  // Long neck/stem - angled and slightly curved using TubeGeometry
  const neckRadius = 0.008;
  const neckHeight = 0.25;

  // Create a curved path for the neck - tilted forward and slightly curved
  class NeckCurve extends THREE.Curve {
    constructor() {
      super();
    }
    getPoint(t) {
      // Start at base, curve forward as it goes up
      const y = t * neckHeight;
      // Add forward tilt (negative z) that increases with height
      const tiltAngle = 0.25; // About 15 degrees forward
      const curveAmount = 0.015; // Slight curve
      const z = -t * neckHeight * Math.tan(tiltAngle) - curveAmount * Math.sin(t * Math.PI);
      return new THREE.Vector3(0, y, z);
    }
  }

  const neckCurve = new NeckCurve();
  const neckGeometry = new THREE.TubeGeometry(neckCurve, 20, neckRadius, 16, false);
  const neck = new THREE.Mesh(neckGeometry, blackPlasticMaterial);
  neck.position.set(0, baseHeight, 0);
  neck.castShadow = true;
  group.add(neck);

  // Calculate the end position of the neck for placing the foam
  const neckEndPoint = neckCurve.getPoint(1);

  // Microphone head - small oval foam (capsule shape)
  const foamRadiusX = 0.025;
  const foamRadiusY = 0.035;
  const foamGeometry = new THREE.SphereGeometry(foamRadiusX, 16, 12);
  foamGeometry.scale(1, foamRadiusY / foamRadiusX, 1); // Make it oval

  const foamMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a, // Black foam
    roughness: 0.95,
    metalness: 0
  });
  const foam = new THREE.Mesh(foamGeometry, foamMaterial);
  // Position at the end of the curved neck
  foam.position.set(
    neckEndPoint.x,
    baseHeight + neckEndPoint.y + foamRadiusY * 0.7,
    neckEndPoint.z
  );
  foam.castShadow = true;
  foam.name = 'microphoneFoam';
  group.add(foam);

  // Power button on the base (like laptop power button) - circular
  const buttonRadius = 0.012;
  const buttonHeight = 0.004;
  const buttonGeometry = new THREE.CylinderGeometry(buttonRadius, buttonRadius, buttonHeight, 16);

  const buttonMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a3a3a,
    roughness: 0.4,
    metalness: 0.3
  });
  const powerButton = new THREE.Mesh(buttonGeometry, buttonMaterial);
  powerButton.position.set(0, baseHeight + buttonHeight / 2, baseDepth / 2 - 0.015);
  powerButton.rotation.x = Math.PI / 2; // Lay flat facing user
  powerButton.name = 'powerButton';
  powerButton.userData.buttonType = 'power';
  powerButton.castShadow = true;
  group.add(powerButton);

  // Power button symbol (circle with line) - decorative
  const symbolGeometry = new THREE.RingGeometry(0.005, 0.007, 16);
  const symbolMaterial = new THREE.MeshBasicMaterial({
    color: 0x666666,
    side: THREE.DoubleSide
  });
  const powerSymbol = new THREE.Mesh(symbolGeometry, symbolMaterial);
  powerSymbol.position.set(0, baseHeight + buttonHeight + 0.001, baseDepth / 2 - 0.015);
  powerSymbol.rotation.x = -Math.PI / 2;
  powerSymbol.userData.buttonType = 'power';
  group.add(powerSymbol);

  // Power symbol line at top
  const lineGeometry = new THREE.BoxGeometry(0.002, 0.006, 0.001);
  const powerLine = new THREE.Mesh(lineGeometry, symbolMaterial);
  powerLine.position.set(0, baseHeight + buttonHeight + 0.001, baseDepth / 2 - 0.015 + 0.006);
  powerLine.rotation.x = -Math.PI / 2;
  powerLine.userData.buttonType = 'power';
  group.add(powerLine);

  // LED indicator - small, hidden when not recording
  const ledRadius = 0.004;
  const ledGeometry = new THREE.SphereGeometry(ledRadius, 12, 8);

  // LED off material (barely visible dark)
  const ledOffMaterial = new THREE.MeshStandardMaterial({
    color: 0x330000,
    roughness: 0.3,
    metalness: 0.5,
    transparent: true,
    opacity: 0.3
  });

  const led = new THREE.Mesh(ledGeometry, ledOffMaterial);
  led.position.set(buttonRadius + 0.008, baseHeight + 0.003, baseDepth / 2 - 0.015);
  led.name = 'recordingLed';
  group.add(led);

  // LED point light (red glow when recording) - starts invisible
  const ledLight = new THREE.PointLight(0xff0000, 0, 0.5, 2);
  ledLight.position.copy(led.position);
  ledLight.name = 'ledLight';
  group.add(ledLight);

  group.position.y = getDeskSurfaceY();

  return group;
}

// Toggle dictaphone recording
async function toggleDictaphoneRecording(object) {
  if (!object || object.userData.type !== 'dictaphone') {
    console.log('toggleDictaphoneRecording: invalid object or not a dictaphone', object?.userData?.type);
    return;
  }

  // Use both object.userData.isRecording AND dictaphoneState.isRecording for robustness
  // This handles cases where state might get out of sync
  const isRecordingLocal = object.userData.isRecording;
  const isRecordingGlobal = dictaphoneState.isRecording && dictaphoneState.currentRecorderId === object.userData.id;

  console.log('toggleDictaphoneRecording called:');
  console.log('  - object.userData.isRecording:', isRecordingLocal);
  console.log('  - dictaphoneState.isRecording:', dictaphoneState.isRecording);
  console.log('  - dictaphoneState.currentRecorderId:', dictaphoneState.currentRecorderId);
  console.log('  - object.userData.id:', object.userData.id);

  if (isRecordingLocal || isRecordingGlobal) {
    // Stop recording
    console.log('Stopping recording...');
    await stopDictaphoneRecording(object);
  } else {
    // Start recording
    console.log('Starting recording...');
    await startDictaphoneRecording(object);
  }
}

// Start recording
async function startDictaphoneRecording(object) {
  if (!object || object.userData.isRecording) return;

  // Check if folder is set
  if (!object.userData.recordingsFolderPath) {
    console.log('No recordings folder set - opening folder selection');
    const result = await window.electronAPI.selectRecordingsFolder();
    if (!result.success || result.canceled) {
      console.log('Folder selection canceled');
      return;
    }
    object.userData.recordingsFolderPath = result.folderPath;
    object.userData.recordingNumber = result.nextRecordingNumber;
    saveState();
  }

  try {
    // Use the shared audio context - same as cassette player
    // This is critical for capturing virtual room sounds!
    const audioCtx = getSharedAudioContext();
    dictaphoneState.audioContext = audioCtx;

    // Resume audio context if suspended
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    // Create destination for mixing audio sources
    dictaphoneState.destinationNode = audioCtx.createMediaStreamDestination();

    // Request microphone access
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      dictaphoneState.microphoneStream = micStream;

      // Connect microphone to destination with volume control
      const micSource = audioCtx.createMediaStreamSource(micStream);
      dictaphoneState.microphoneSource = micSource;
      dictaphoneState.microphoneGainNode = audioCtx.createGain();
      // Apply recording volume setting (0-200%)
      const volumeMultiplier = (object.userData.recordingVolume || 100) / 100;
      dictaphoneState.microphoneGainNode.gain.value = volumeMultiplier;

      // Create analyser node for volume level visualization
      dictaphoneState.analyserNode = audioCtx.createAnalyser();
      dictaphoneState.analyserNode.fftSize = 256;
      dictaphoneState.analyserNode.smoothingTimeConstant = 0.3;

      // Check if microphone panorama is enabled
      // If enabled, apply spatial panning based on dictaphone position
      const useMicPanorama = object.userData.recordMicrophonePanorama === true;

      if (useMicPanorama) {
        // Create panner node for microphone spatial positioning (left/right)
        dictaphoneState.microphonePannerNode = audioCtx.createStereoPanner();
        // Create gain node for distance-based volume attenuation
        dictaphoneState.microphoneSpatialGainNode = audioCtx.createGain();

        const spatial = calculateSpatialAudio(object);
        // Invert pan: if dictaphone is on the right (+pan), voice should be on the left (-pan)
        // This simulates recording from the camera's perspective
        dictaphoneState.microphonePannerNode.pan.value = -spatial.pan;
        // Apply distance-based volume attenuation
        dictaphoneState.microphoneSpatialGainNode.gain.value = spatial.volume;

        // Chain: micSource -> analyserNode -> microphoneGainNode -> pannerNode -> spatialGain -> destinationNode
        micSource.connect(dictaphoneState.analyserNode);
        dictaphoneState.analyserNode.connect(dictaphoneState.microphoneGainNode);
        dictaphoneState.microphoneGainNode.connect(dictaphoneState.microphonePannerNode);
        dictaphoneState.microphonePannerNode.connect(dictaphoneState.microphoneSpatialGainNode);
        dictaphoneState.microphoneSpatialGainNode.connect(dictaphoneState.destinationNode);

        console.log('Microphone connected with panoramic panning (inverted):', -spatial.pan, 'volume:', spatial.volume);
      } else {
        // Chain: micSource -> analyserNode -> microphoneGainNode -> destinationNode (no panning)
        micSource.connect(dictaphoneState.analyserNode);
        dictaphoneState.analyserNode.connect(dictaphoneState.microphoneGainNode);
        dictaphoneState.microphoneGainNode.connect(dictaphoneState.destinationNode);
      }

      console.log('Microphone connected for recording with volume:', volumeMultiplier, 'panorama:', useMicPanorama);
    } catch (micError) {
      console.warn('Could not access microphone:', micError);
      // Continue without microphone - will record only virtual sounds
    }

    // Connect virtual room sounds from the shared audio system
    // This captures all audio going through the room (cassette players, etc.)
    // If environment panorama is enabled, use the panoramic gain node (preserves stereo panning)
    const usePanoramicEnvironment = object.userData.recordEnvironmentPanorama !== false;

    // Store reference to the object and panorama states for dynamic switching
    dictaphoneState.currentRecordingObject = object;
    dictaphoneState.usePanoramicEnvironment = usePanoramicEnvironment;
    dictaphoneState.useMicrophonePanorama = object.userData.recordMicrophonePanorama === true;

    if (sharedAudioSystem.recordingGain || sharedAudioSystem.recordingGainPanorama) {
      dictaphoneState.virtualAudioGainNode = audioCtx.createGain();
      dictaphoneState.virtualAudioGainNode.gain.value = 0.7; // Mix at 70%
      dictaphoneState.virtualAudioGainNode.connect(dictaphoneState.destinationNode);

      // Connect from the appropriate shared recording tap based on panorama setting
      const environmentSource = usePanoramicEnvironment
        ? sharedAudioSystem.recordingGainPanorama
        : sharedAudioSystem.recordingGain;

      if (environmentSource) {
        environmentSource.connect(dictaphoneState.virtualAudioGainNode);
      }

      console.log('Virtual room audio connected for recording via shared audio system');
      console.log('  Using panoramic recording:', usePanoramicEnvironment);
      console.log('  Active players:', sharedAudioSystem.activePlayers.size);
    } else {
      console.log('Shared audio system not initialized - recording microphone only');
    }

    // Use MediaRecorder for recording (runs on background thread, won't block rendering)
    // This prevents the gray screen issue that occurred with ScriptProcessorNode
    dictaphoneState.recordedChunks = [];
    dictaphoneState.sampleRate = audioCtx.sampleRate;

    // Choose best available codec
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    console.log('Using MediaRecorder with mimeType:', mimeType);

    dictaphoneState.mediaRecorder = new MediaRecorder(
      dictaphoneState.destinationNode.stream,
      { mimeType }
    );

    dictaphoneState.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        dictaphoneState.recordedChunks.push(event.data);
      }
    };

    // Start recording - collect data every 100ms for smooth recording
    dictaphoneState.mediaRecorder.start(100);
    console.log('MediaRecorder started, sample rate:', audioCtx.sampleRate);
    dictaphoneState.isRecording = true;
    dictaphoneState.currentRecorderId = object.userData.id;
    object.userData.isRecording = true;

    // Update LED visual
    updateDictaphoneLed(object, true);

    console.log('Dictaphone recording started');
    saveState();

  } catch (error) {
    console.error('Error starting dictaphone recording:', error);
    object.userData.isRecording = false;
    dictaphoneState.isRecording = false;
  }
}

/**
 * Switch the environment panorama setting during recording.
 * This dynamically re-routes audio to/from the stereo panning node.
 * @param {boolean} usePanoramic - Whether to use panoramic (stereo panning) recording
 */
function switchDictaphoneEnvironmentPanorama(usePanoramic) {
  if (!dictaphoneState.isRecording || !dictaphoneState.virtualAudioGainNode) {
    console.log('Cannot switch environment panorama: not recording or no virtual audio');
    return;
  }

  // If already in the requested state, do nothing
  if (dictaphoneState.usePanoramicEnvironment === usePanoramic) {
    return;
  }

  try {
    // Disconnect the current source from virtualAudioGainNode
    const oldSource = dictaphoneState.usePanoramicEnvironment
      ? sharedAudioSystem.recordingGainPanorama
      : sharedAudioSystem.recordingGain;

    if (oldSource) {
      try {
        oldSource.disconnect(dictaphoneState.virtualAudioGainNode);
      } catch (e) {
        // May fail if not connected, ignore
      }
    }

    // Connect the new source to virtualAudioGainNode
    const newSource = usePanoramic
      ? sharedAudioSystem.recordingGainPanorama
      : sharedAudioSystem.recordingGain;

    if (newSource) {
      newSource.connect(dictaphoneState.virtualAudioGainNode);
    }

    dictaphoneState.usePanoramicEnvironment = usePanoramic;
    console.log('Switched environment panorama to:', usePanoramic);
  } catch (e) {
    console.error('Error switching environment panorama:', e);
  }
}

/**
 * Switch the microphone panorama setting during recording.
 * This dynamically adds/removes the stereo panner on the microphone input.
 * @param {boolean} usePanoramic - Whether to apply stereo panning to microphone
 */
function switchDictaphoneMicrophonePanorama(usePanoramic) {
  if (!dictaphoneState.isRecording || !dictaphoneState.audioContext) {
    console.log('Cannot switch microphone panorama: not recording');
    return;
  }

  // If already in the requested state, do nothing
  if (dictaphoneState.useMicrophonePanorama === usePanoramic) {
    return;
  }

  const audioCtx = dictaphoneState.audioContext;

  try {
    if (usePanoramic) {
      // Add panning and spatial gain: disconnect microphoneGainNode from destinationNode, add panner and spatial gain between them
      if (dictaphoneState.microphoneGainNode && dictaphoneState.destinationNode) {
        // Create panner node if it doesn't exist
        if (!dictaphoneState.microphonePannerNode) {
          dictaphoneState.microphonePannerNode = audioCtx.createStereoPanner();
        }
        // Create spatial gain node if it doesn't exist
        if (!dictaphoneState.microphoneSpatialGainNode) {
          dictaphoneState.microphoneSpatialGainNode = audioCtx.createGain();
        }

        // Calculate current spatial position based on dictaphone object
        // Invert pan: if dictaphone is on the right (+pan), voice should be on the left (-pan)
        // Volume is based on distance from camera
        const object = dictaphoneState.currentRecordingObject;
        if (object) {
          const spatial = calculateSpatialAudio(object);
          dictaphoneState.microphonePannerNode.pan.value = -spatial.pan;
          dictaphoneState.microphoneSpatialGainNode.gain.value = spatial.volume;
        }

        // Reconnect: gain -> panner -> spatialGain -> destination
        try {
          dictaphoneState.microphoneGainNode.disconnect(dictaphoneState.destinationNode);
        } catch (e) {
          // May fail if not connected, ignore
        }
        dictaphoneState.microphoneGainNode.connect(dictaphoneState.microphonePannerNode);
        dictaphoneState.microphonePannerNode.connect(dictaphoneState.microphoneSpatialGainNode);
        dictaphoneState.microphoneSpatialGainNode.connect(dictaphoneState.destinationNode);

        console.log('Enabled microphone panorama with pan (inverted):', dictaphoneState.microphonePannerNode.pan.value, 'volume:', dictaphoneState.microphoneSpatialGainNode.gain.value);
      }
    } else {
      // Remove panning and spatial gain: disconnect panner/spatialGain, connect gain directly to destination
      if (dictaphoneState.microphoneGainNode && dictaphoneState.destinationNode) {
        try {
          if (dictaphoneState.microphonePannerNode) {
            dictaphoneState.microphoneGainNode.disconnect(dictaphoneState.microphonePannerNode);
          }
          if (dictaphoneState.microphoneSpatialGainNode) {
            dictaphoneState.microphonePannerNode.disconnect(dictaphoneState.microphoneSpatialGainNode);
            dictaphoneState.microphoneSpatialGainNode.disconnect(dictaphoneState.destinationNode);
          } else if (dictaphoneState.microphonePannerNode) {
            dictaphoneState.microphonePannerNode.disconnect(dictaphoneState.destinationNode);
          }
        } catch (e) {
          // May fail if not connected, ignore
        }
        dictaphoneState.microphoneGainNode.connect(dictaphoneState.destinationNode);

        console.log('Disabled microphone panorama');
      }
    }

    dictaphoneState.useMicrophonePanorama = usePanoramic;
  } catch (e) {
    console.error('Error switching microphone panorama:', e);
  }
}

// Stop recording
async function stopDictaphoneRecording(object) {
  console.log('=== stopDictaphoneRecording START ===');
  console.log('  object?.userData?.id:', object?.userData?.id);
  console.log('  object?.userData?.isRecording:', object?.userData?.isRecording);
  console.log('  object?.userData?.recordingsFolderPath:', object?.userData?.recordingsFolderPath);
  console.log('  dictaphoneState.isRecording:', dictaphoneState.isRecording);
  console.log('  dictaphoneState.currentRecorderId:', dictaphoneState.currentRecorderId);
  console.log('  dictaphoneState.recordedChunks.length:', dictaphoneState.recordedChunks?.length);

  // Check both local and global state to be robust
  const isRecordingLocal = object?.userData?.isRecording;
  const isRecordingGlobal = dictaphoneState.isRecording;

  if (!object || (!isRecordingLocal && !isRecordingGlobal)) {
    console.log('stopDictaphoneRecording: early return - object invalid or not recording');
    console.log('  object is null:', !object);
    console.log('  isRecordingLocal:', isRecordingLocal);
    console.log('  isRecordingGlobal:', isRecordingGlobal);
    return;
  }

  try {
    // Stop MediaRecorder
    if (dictaphoneState.mediaRecorder && dictaphoneState.mediaRecorder.state !== 'inactive') {
      console.log('Stopping MediaRecorder...');

      // Create a promise that resolves when onstop fires
      const stopPromise = new Promise((resolve) => {
        dictaphoneState.mediaRecorder.onstop = () => {
          console.log('MediaRecorder stopped, chunks collected:', dictaphoneState.recordedChunks?.length || 0);
          resolve();
        };
      });

      dictaphoneState.mediaRecorder.stop();
      await stopPromise;
    }

    // Stop microphone stream
    if (dictaphoneState.microphoneStream) {
      dictaphoneState.microphoneStream.getTracks().forEach(track => track.stop());
      dictaphoneState.microphoneStream = null;
    }

    // Disconnect analyser node
    if (dictaphoneState.analyserNode) {
      try {
        dictaphoneState.analyserNode.disconnect();
      } catch (e) {}
      dictaphoneState.analyserNode = null;
    }

    // Disconnect microphone source
    if (dictaphoneState.microphoneSource) {
      try {
        dictaphoneState.microphoneSource.disconnect();
      } catch (e) {}
      dictaphoneState.microphoneSource = null;
    }

    // Disconnect microphone panner (for panoramic recording)
    if (dictaphoneState.microphonePannerNode) {
      try {
        dictaphoneState.microphonePannerNode.disconnect();
      } catch (e) {}
      dictaphoneState.microphonePannerNode = null;
    }

    // Disconnect microphone spatial gain (for distance-based volume)
    if (dictaphoneState.microphoneSpatialGainNode) {
      try {
        dictaphoneState.microphoneSpatialGainNode.disconnect();
      } catch (e) {}
      dictaphoneState.microphoneSpatialGainNode = null;
    }

    // Disconnect virtual audio
    if (dictaphoneState.virtualAudioGainNode) {
      try {
        dictaphoneState.virtualAudioGainNode.disconnect();
      } catch (e) {}
      dictaphoneState.virtualAudioGainNode = null;
    }

    // Update state
    object.userData.isRecording = false;
    dictaphoneState.isRecording = false;
    dictaphoneState.currentRecorderId = null;
    dictaphoneState.currentRecordingObject = null;
    dictaphoneState.usePanoramicEnvironment = false;
    dictaphoneState.useMicrophonePanorama = false;

    // Update LED visual
    updateDictaphoneLed(object, false);

    console.log('Dictaphone recording stopped');
    saveState();

    // Save the recording
    console.log('Calling saveDictaphoneRecording...');
    await saveDictaphoneRecording(object);
    console.log('=== stopDictaphoneRecording END ===');

  } catch (error) {
    console.error('Error stopping dictaphone recording:', error);
    console.error('Error stack:', error.stack);
  }
}

// Save recording to file
async function saveDictaphoneRecording(object) {
  console.log('=== saveDictaphoneRecording START ===');
  console.log('  recordedChunks:', dictaphoneState.recordedChunks?.length || 0);
  console.log('  folderPath:', object?.userData?.recordingsFolderPath);
  console.log('  recordingNumber:', object?.userData?.recordingNumber);
  console.log('  recordingFormat:', object?.userData?.recordingFormat);

  if (!dictaphoneState.recordedChunks || dictaphoneState.recordedChunks.length === 0) {
    console.log('No recording data to save - recordedChunks is empty');
    return;
  }

  // Check if folder path is set
  if (!object || !object.userData || !object.userData.recordingsFolderPath) {
    console.error('Cannot save recording: folder path is not set');
    console.error('  object:', !!object);
    console.error('  userData:', !!object?.userData);
    console.error('  recordingsFolderPath:', object?.userData?.recordingsFolderPath);
    alert('Cannot save recording: please select a folder first');
    dictaphoneState.recordedChunks = [];
    return;
  }

  try {
    // Combine all recorded chunks into a single blob
    const webmBlob = new Blob(dictaphoneState.recordedChunks, { type: 'audio/webm' });
    console.log('WebM blob created, size:', webmBlob.size, 'bytes');

    const format = object.userData.recordingFormat || 'wav';
    const folderPath = object.userData.recordingsFolderPath;
    const recordingNumber = object.userData.recordingNumber || 1;

    // Always send WebM data to main process
    // Browser-based WebM to WAV conversion is unreliable (decodeAudioData doesn't support WebM/Opus in Chromium)
    // FFmpeg handles all conversions (WAV, MP3) reliably
    // WebM format saves directly without conversion
    console.log('Converting WebM blob to base64...');
    const arrayBuffer = await webmBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const audioDataBase64 = btoa(binary);
    const dataFormat = 'webm';
    console.log('WebM base64 encoded, length:', audioDataBase64.length, 'characters');

    console.log('Calling saveRecording IPC:');
    console.log('  folderPath:', folderPath);
    console.log('  recordingNumber:', recordingNumber);
    console.log('  format:', format);
    console.log('  dataFormat:', dataFormat);

    const result = await window.electronAPI.saveRecording(
      folderPath,
      recordingNumber,
      audioDataBase64,
      format,
      dataFormat  // Tell main process what format the data is in
    );

    console.log('saveRecording IPC result:', JSON.stringify(result));

    if (result.success) {
      console.log('✓ Recording saved successfully:', result.fileName);
      console.log('  File path:', result.filePath);
      console.log('  Actual format:', result.actualFormat);

      // Show message if format was different from requested
      if (result.message) {
        console.log('  Note:', result.message);
        // Only show alert for unexpected format changes
        if (result.actualFormat !== format) {
          alert(`Note: ${result.message}`);
        }
      }

      // Increment recording number for next recording
      object.userData.recordingNumber = recordingNumber + 1;
      saveState();
    } else {
      console.error('✗ Failed to save recording:', result.error);
      alert('Failed to save recording: ' + result.error);
    }

    // Clear recorded chunks
    dictaphoneState.recordedChunks = [];
    console.log('=== saveDictaphoneRecording END ===');

  } catch (error) {
    console.error('Error saving recording:', error);
    console.error('Error stack:', error.stack);
    alert('Error saving recording: ' + error.message);
    dictaphoneState.recordedChunks = [];
  }
}

// Update LED visual state
function updateDictaphoneLed(object, isRecording) {
  try {
    const led = object.getObjectByName('recordingLed');
    const ledLight = object.getObjectByName('ledLight');

    if (led) {
      // Dispose old material to prevent WebGL resource leaks
      if (led.material) {
        led.material.dispose();
      }

      if (isRecording) {
        // Bright red LED
        led.material = new THREE.MeshStandardMaterial({
          color: 0xff0000,
          roughness: 0.3,
          metalness: 0.2,
          emissive: new THREE.Color(0xff0000),
          emissiveIntensity: 0.8
        });
      } else {
        // Dim/off LED
        led.material = new THREE.MeshStandardMaterial({
          color: 0x330000,
          roughness: 0.3,
          metalness: 0.5,
          transparent: true,
          opacity: 0.3
        });
      }
    }

    if (ledLight) {
      // Set light intensity
      ledLight.intensity = isRecording ? 0.3 : 0;
    }
  } catch (error) {
    console.error('Error updating dictaphone LED:', error);
  }
}

// Get current audio level from dictaphone analyser (returns 0-100)
// This is used for the volume level indicator in the UI
function getDictaphoneAudioLevel() {
  if (!dictaphoneState.isRecording || !dictaphoneState.analyserNode) {
    return 0;
  }

  try {
    const analyser = dictaphoneState.analyserNode;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(dataArray);

    // Calculate RMS (Root Mean Square) for accurate volume level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const sample = (dataArray[i] - 128) / 128; // Normalize to -1 to 1
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / dataArray.length);

    // Convert RMS to percentage (0-100) with some amplification for visibility
    // RMS typically ranges from 0 to ~0.5 for typical audio
    const level = Math.min(100, rms * 200);

    return level;
  } catch (error) {
    console.warn('Error getting audio level:', error);
    return 0;
  }
}

// Handle dictaphone button click
function handleDictaphoneButtonClick(object, buttonType) {
  switch (buttonType) {
    case 'power':
      toggleDictaphoneRecording(object);
      break;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function getDeskSurfaceY() {
  return CONFIG.desk.height;  // No legs, just surface height
}

function addObjectToDesk(type, options = {}) {
  const creator = PRESET_CREATORS[type];
  if (!creator) return null;

  const object = creator(options);
  object.userData.id = objectIdCounter++;
  object.userData.originalY = object.position.y;
  object.userData.targetY = object.position.y;
  object.userData.isLifted = false;

  // Random position on desk
  const deskHalfWidth = CONFIG.desk.width / 2 - 0.3;
  const deskHalfDepth = CONFIG.desk.depth / 2 - 0.3;
  object.position.x = options.x !== undefined ? options.x : (Math.random() - 0.5) * deskHalfWidth * 2;
  object.position.z = options.z !== undefined ? options.z : (Math.random() - 0.5) * deskHalfDepth * 2;

  // Apply rotation if specified
  if (options.rotationY !== undefined) {
    object.rotation.y = options.rotationY;
    object.userData.rotationY = options.rotationY;
  }

  // Apply scale if specified and adjust Y position to keep object on desk
  if (options.scale !== undefined && options.scale > 0) {
    object.scale.set(options.scale, options.scale, options.scale);
    object.userData.scale = options.scale;
    // Adjust Y position to account for scale change
    adjustObjectYForScale(object, 1.0, options.scale);
  } else if (type === 'magazine' && options.scale === undefined) {
    // Magazines default to 5.0x scale (same as book max scale) for better readability
    const defaultMagazineScale = 5.0;
    object.scale.set(defaultMagazineScale, defaultMagazineScale, defaultMagazineScale);
    object.userData.scale = defaultMagazineScale;
    adjustObjectYForScale(object, 1.0, defaultMagazineScale);
  } else if (type === 'dictaphone' && options.scale === undefined) {
    // Dictaphone defaults to 3.0x scale for better visibility
    const defaultDictaphoneScale = 3.0;
    object.scale.set(defaultDictaphoneScale, defaultDictaphoneScale, defaultDictaphoneScale);
    object.userData.scale = defaultDictaphoneScale;
    adjustObjectYForScale(object, 1.0, defaultDictaphoneScale);
  }

  deskObjects.push(object);
  scene.add(object);

  // Update debug visualization if active
  if (debugState.showCollisionRadii) {
    updateCollisionDebugHelpers();
  }

  // Don't save state during loading to avoid overwriting loaded data
  if (!isLoadingState) {
    saveState();
  }

  return object;
}

function removeObject(object) {
  const index = deskObjects.indexOf(object);
  if (index > -1) {
    deskObjects.splice(index, 1);
    scene.remove(object);
    // Clean up physics data
    physicsState.velocities.delete(object.userData.id);
    physicsState.angularVelocities.delete(object.userData.id);
    physicsState.tiltState.delete(object.userData.id);
    physicsState.tiltVelocities.delete(object.userData.id);

    // Delete drawing file if this is a notebook or paper with drawings
    if ((object.userData.type === 'notebook' || object.userData.type === 'paper') &&
        object.userData.drawingLines && object.userData.drawingLines.length > 0) {
      deleteDrawingFile(object);
    }

    // Update debug visualization if active
    if (debugState.showCollisionRadii) {
      updateCollisionDebugHelpers();
    }

    saveState();
  }
}

// Clear all objects from the desk
function clearAllObjects() {
  // Remove all objects from scene and physics
  while (deskObjects.length > 0) {
    const obj = deskObjects.pop();
    scene.remove(obj);
    // Clean up physics data
    physicsState.velocities.delete(obj.userData.id);
    physicsState.angularVelocities.delete(obj.userData.id);
    physicsState.tiltState.delete(obj.userData.id);
    physicsState.tiltVelocities.delete(obj.userData.id);

    // Delete drawing file if this is a notebook or paper with drawings
    if ((obj.userData.type === 'notebook' || obj.userData.type === 'paper') &&
        obj.userData.drawingLines && obj.userData.drawingLines.length > 0) {
      deleteDrawingFile(obj);
    }
  }

  // Clear debug visualization helpers
  if (debugState.showCollisionRadii) {
    updateCollisionDebugHelpers();
  }

  // Close any open panels/modals
  selectedObject = null;
  document.getElementById('customization-panel').classList.remove('open');
  closeInteractionModal();

  saveState();
}

// Reset an object that has fallen over back to upright position
function resetFallenObject(object) {
  if (!object.userData.isFallen) return;

  object.userData.isFallen = false;

  // Reset rotation to upright (preserve Y rotation)
  const yRotation = object.rotation.y;
  const physics = getObjectPhysics(object);

  // Get the original base rotation for this object type
  const creator = PRESET_CREATORS[object.userData.type];
  if (creator) {
    // Create a temporary object to get default rotation
    const temp = creator({});
    object.rotation.x = temp.rotation.x;
    object.rotation.z = temp.rotation.z;
    object.rotation.y = yRotation;
    object.position.y = temp.position.y;
    scene.remove(temp);
  } else {
    object.rotation.x = 0;
    object.rotation.z = 0;
    object.rotation.y = yRotation;
    object.position.y = object.userData.originalY;
  }

  // Reset tilt state
  physicsState.tiltState.set(object.userData.id, { x: 0, z: 0 });
  physicsState.tiltVelocities.set(object.userData.id, { x: 0, z: 0 });
  object.userData.baseTiltX = undefined;
}

// ============================================================================
// PEN ORIENTATION FUNCTIONS (for drawing mode)
// ============================================================================

// Make pen stand vertical when picked up by user (tip pointing down)
function makePenVertical(pen) {
  if (pen.userData.type !== 'pen') return;

  // Reset the group rotation to stand upright
  pen.rotation.x = 0;
  pen.rotation.z = 0;
  // Keep Y rotation (user's preferred facing direction)

  // Reset penBody sub-group
  const penBody = pen.getObjectByName('penBody');
  if (penBody) {
    penBody.rotation.x = 0;
    penBody.rotation.z = 0;
  }

  pen.userData.isHeldByUser = true;
}

// Make pen lie flat on desk (default resting orientation)
function makePenFlat(pen) {
  if (pen.userData.type !== 'pen') return;

  // Rotate pen to lie flat on the desk (along X axis)
  pen.rotation.z = -Math.PI / 2;
  pen.rotation.x = 0;

  // Reset penBody sub-group
  const penBody = pen.getObjectByName('penBody');
  if (penBody) {
    penBody.rotation.x = 0;
    penBody.rotation.z = 0;
  }

  pen.userData.isHeldByUser = false;
}

// Tilt pen for drawing mode (angled as if writing)
function makePenDrawingAngle(pen) {
  if (pen.userData.type !== 'pen') return;

  // Tilt pen at a comfortable writing angle (~60 degrees from vertical)
  // The pen should lean toward where user would be writing
  pen.rotation.x = Math.PI / 6;  // Tilt forward
  pen.rotation.z = -Math.PI / 6; // Slight side angle for natural grip

  const penBody = pen.getObjectByName('penBody');
  if (penBody) {
    penBody.rotation.x = 0;
    penBody.rotation.z = 0;
  }
}

// ============================================================================
// PEN DRAWING MODE FUNCTIONS
// ============================================================================

// Toggle drawing mode on/off
function togglePenDrawingMode() {
  if (penDrawingMode.active) {
    exitPenDrawingMode();
  } else {
    enterPenDrawingMode();
  }
}

// Enter drawing mode with the held pen (for toggling when already holding)
function enterPenDrawingMode() {
  if (!penDrawingMode.heldPen) return;

  penDrawingMode.active = true;
  makePenDrawingAngle(penDrawingMode.heldPen);

  // Use the pen's line width setting
  penDrawingMode.lineWidth = penDrawingMode.heldPen.userData.lineWidth || 2;

  // Stop normal dragging - pen is now attached to cursor in drawing mode
  if (isDragging && selectedObject === penDrawingMode.heldPen) {
    isDragging = false;
    selectedObject = null;
  }

  // Show drawing mode indicator
  showDrawingModeIndicator(true);

  console.log('Drawing mode: ON - Use LMB on notebook/paper to draw');
}

// Enter drawing mode by hovering over a pen and pressing MMB (new method)
function enterPenDrawingModeWithPen(pen) {
  if (!pen || pen.userData.type !== 'pen') return;

  // Set this pen as the held pen for drawing mode
  penDrawingMode.heldPen = pen;
  penDrawingMode.active = true;

  // Tilt pen to drawing angle
  makePenDrawingAngle(pen);

  // Use the pen's line width and showRay settings
  penDrawingMode.lineWidth = pen.userData.lineWidth || 2;
  penDrawingMode.showRay = pen.userData.showDrawingRay || false;

  // If user was dragging this pen, stop dragging
  if (isDragging && selectedObject === pen) {
    isDragging = false;
    selectedObject = null;
  }

  // Lift pen to drawing height immediately (don't wait for mouse move)
  // This prevents the pen from "disappearing" by being too low
  const penTipHeight = getDeskSurfaceY() + 0.03;
  pen.position.y = penTipHeight;
  pen.userData.isLifted = true;

  // Show drawing mode indicator
  showDrawingModeIndicator(true);

  console.log('Drawing mode: ON - Use LMB on notebook/paper to draw');
}

// Exit drawing mode and save any drawings
function exitPenDrawingMode() {
  penDrawingMode.active = false;

  // Drop the pen (make it lie flat on the desk)
  if (penDrawingMode.heldPen) {
    makePenFlat(penDrawingMode.heldPen);
    // Calculate proper drop height
    const dropY = calculateStackingY(penDrawingMode.heldPen);
    penDrawingMode.heldPen.userData.originalY = dropY;
    penDrawingMode.heldPen.userData.targetY = dropY;
    penDrawingMode.heldPen.userData.isLifted = false;
    penDrawingMode.heldPen = null;
  }

  // Save any drawing on the current target object
  if (penDrawingMode.targetObject) {
    saveDrawingToFile(penDrawingMode.targetObject);
    penDrawingMode.targetObject = null;
  }

  // Clear drawing path
  penDrawingMode.drawingPath = [];
  penDrawingMode.isStrokeActive = false;

  // Remove ray visualization helper
  if (drawingRayHelper) {
    scene.remove(drawingRayHelper);
    drawingRayHelper = null;
  }

  // Hide drawing mode indicator
  showDrawingModeIndicator(false);

  console.log('Drawing mode: OFF');
}

// Show/hide drawing mode indicator
function showDrawingModeIndicator(show) {
  let indicator = document.getElementById('drawing-mode-indicator');

  if (show) {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'drawing-mode-indicator';
      indicator.style.cssText = `
        position: fixed;
        top: 70px;
        right: 20px;
        background: rgba(79, 70, 229, 0.9);
        color: white;
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 1000;
        pointer-events: none;
        box-shadow: 0 4px 15px rgba(79, 70, 229, 0.3);
      `;
      indicator.textContent = '🖊️ Drawing Mode - LMB to draw on paper/notebook';
      document.body.appendChild(indicator);
    }
    indicator.style.display = 'block';
  } else {
    if (indicator) {
      indicator.style.display = 'none';
    }
  }
}

// Find notebook or paper under the pen position using ray from pen base through tip
function findDrawableObjectUnderPen() {
  if (!penDrawingMode.heldPen) {
    // Remove ray helper if pen is not held
    if (drawingRayHelper) {
      scene.remove(drawingRayHelper);
      drawingRayHelper = null;
    }
    return null;
  }

  // Get pen base (holder end) and tip positions in world coordinates
  const pen = penDrawingMode.heldPen;

  // Pen base is at the pen's world position (the holder end)
  const penBase = new THREE.Vector3();
  pen.getWorldPosition(penBase);

  // Calculate pen tip position based on pen orientation
  // The pen model has its tip pointing down along local -Y axis
  // In drawing mode, pen is tilted at about 60 degrees
  // Account for pen scale to prevent large pens from getting stuck
  const penScale = pen.userData.scale || pen.scale.x || 1.0;
  const baseTipLength = 0.15; // Base pen length ~0.15 units
  const tipOffset = new THREE.Vector3(0, -baseTipLength * penScale, 0);
  tipOffset.applyQuaternion(pen.quaternion);
  const penTip = penBase.clone().add(tipOffset);

  // Create a ray from base through tip
  const rayOrigin = penBase.clone();
  const rayDirection = new THREE.Vector3().subVectors(penTip, penBase).normalize();

  // Update or create ray visualization if debug mode is enabled
  if (penDrawingMode.showRay) {
    // Create a thick ray that extends in both directions from pen base
    const rayLengthDown = 3.0; // Length extending down through tip
    const rayLengthUp = 1.5;   // Length extending up from base (visible from above)

    // Calculate endpoints
    const rayEndDown = penBase.clone().add(rayDirection.clone().multiplyScalar(rayLengthDown));
    const rayEndUp = penBase.clone().add(rayDirection.clone().multiplyScalar(-rayLengthUp));

    if (!drawingRayHelper) {
      // Create a thick cylinder to visualize the ray (more visible than ArrowHelper)
      const rayGroup = new THREE.Group();
      rayGroup.name = 'drawingRayHelper';

      // Use a cylinder geometry for thickness
      const totalLength = rayLengthDown + rayLengthUp;
      const rayGeometry = new THREE.CylinderGeometry(0.008, 0.008, totalLength, 8);
      const rayMaterial = new THREE.MeshBasicMaterial({
        color: 0xff00ff,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false
      });
      const rayCylinder = new THREE.Mesh(rayGeometry, rayMaterial);
      rayCylinder.renderOrder = 999; // Render on top
      rayGroup.add(rayCylinder);

      // Add small spheres at both ends for visibility
      const sphereGeometry = new THREE.SphereGeometry(0.015, 8, 8);
      const sphereMaterial = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        depthTest: false,
        depthWrite: false
      });
      const endSphereDown = new THREE.Mesh(sphereGeometry, sphereMaterial);
      endSphereDown.name = 'endDown';
      endSphereDown.renderOrder = 1000;
      rayGroup.add(endSphereDown);

      const endSphereUp = new THREE.Mesh(sphereGeometry.clone(), sphereMaterial.clone());
      endSphereUp.material.color.setHex(0x00ff00); // Green for top
      endSphereUp.name = 'endUp';
      endSphereUp.renderOrder = 1000;
      rayGroup.add(endSphereUp);

      drawingRayHelper = rayGroup;
      scene.add(drawingRayHelper);
    }

    // Update ray position and orientation
    if (drawingRayHelper) {
      const totalLength = rayLengthDown + rayLengthUp;
      const midPoint = penBase.clone().add(rayDirection.clone().multiplyScalar((rayLengthDown - rayLengthUp) / 2));

      // Position at midpoint of the ray
      drawingRayHelper.position.copy(midPoint);

      // Orient to point along ray direction
      // Cylinders are vertical by default, so we need to rotate to align with direction
      const upVector = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(upVector, rayDirection);
      drawingRayHelper.quaternion.copy(quaternion);

      // Update end sphere positions (in local space)
      const endDown = drawingRayHelper.getObjectByName('endDown');
      const endUp = drawingRayHelper.getObjectByName('endUp');
      if (endDown) {
        endDown.position.set(0, -totalLength/2, 0);
      }
      if (endUp) {
        endUp.position.set(0, totalLength/2, 0);
      }
    }
  } else {
    // Remove ray helper if debug mode is disabled
    if (drawingRayHelper) {
      scene.remove(drawingRayHelper);
      drawingRayHelper = null;
    }
  }

  // Use multiple raycasting approaches for reliability
  // Filter drawable objects (exclude the pen itself to avoid self-collision)
  const drawableObjects = deskObjects.filter(obj =>
    (obj.userData.type === 'notebook' || obj.userData.type === 'paper') &&
    obj !== pen
  );

  // Approach 1: Ray from pen base through tip (original)
  const rayStartOffset = penBase.clone().add(rayDirection.clone().multiplyScalar(-0.5));
  const tempRaycaster = new THREE.Raycaster(rayStartOffset, rayDirection, 0, 5.0);
  let intersects = tempRaycaster.intersectObjects(drawableObjects, true);

  // Approach 2: If first approach fails, try a straight downward ray from pen tip
  if (intersects.length === 0) {
    const downRay = new THREE.Vector3(0, -1, 0); // Straight down
    const tipAbove = penTip.clone();
    tipAbove.y += 0.5; // Start from above the tip
    const downRaycaster = new THREE.Raycaster(tipAbove, downRay, 0, 2.0);
    intersects = downRaycaster.intersectObjects(drawableObjects, true);
  }

  // Approach 3: If still fails, try from pen base straight down
  if (intersects.length === 0) {
    const downRay = new THREE.Vector3(0, -1, 0);
    const baseAbove = penBase.clone();
    baseAbove.y += 0.5;
    const baseDownRaycaster = new THREE.Raycaster(baseAbove, downRay, 0, 2.0);
    intersects = baseDownRaycaster.intersectObjects(drawableObjects, true);
  }

  if (intersects.length > 0) {
    // Find the parent object that is in deskObjects
    let object = intersects[0].object;
    while (object.parent && !deskObjects.includes(object)) {
      object = object.parent;
    }

    if (deskObjects.includes(object)) {
      // Store the intersection point for drawing coordinate calculation
      penDrawingMode.lastIntersectionPoint = intersects[0].point.clone();
      return object;
    }
  }

  return null;
}

// Convert world position to local drawing coordinates on a drawable object
function worldToDrawingCoords(worldPos, drawableObject) {
  if (!drawableObject) return null;

  // Get object's world position and rotation
  const objPos = new THREE.Vector3();
  drawableObject.getWorldPosition(objPos);

  // Calculate local offset
  const localX = worldPos.x - objPos.x;
  const localZ = worldPos.z - objPos.z;

  // Get object dimensions with scale applied
  const baseWidth = drawableObject.userData.type === 'notebook' ? 0.4 : 0.28;
  const baseDepth = drawableObject.userData.type === 'notebook' ? 0.55 : 0.4;
  const scale = drawableObject.userData.scale || drawableObject.scale.x || 1.0;
  const width = baseWidth * scale;
  const depth = baseDepth * scale;

  // Convert to normalized coordinates (0-1)
  const normalizedX = (localX / width) + 0.5;
  const normalizedY = (localZ / depth) + 0.5;

  // Apply object rotation (simplified - just Y rotation)
  const cos = Math.cos(-drawableObject.rotation.y);
  const sin = Math.sin(-drawableObject.rotation.y);
  const centeredX = normalizedX - 0.5;
  const centeredY = normalizedY - 0.5;
  const rotatedX = centeredX * cos - centeredY * sin + 0.5;
  const rotatedY = centeredX * sin + centeredY * cos + 0.5;

  // Convert to canvas coordinates (512x512 for drawing)
  const canvasSize = 512;
  return {
    x: Math.floor(rotatedX * canvasSize),
    y: Math.floor(rotatedY * canvasSize)
  };
}

// Create or get the drawing canvas for a drawable object
function getDrawingCanvas(drawableObject) {
  if (!drawableObject) return null;

  // Check if canvas already exists
  if (drawableObject.userData.drawingCanvas) {
    return drawableObject.userData.drawingCanvas;
  }

  // Create new canvas
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;

  const ctx = canvas.getContext('2d');

  // Fill with white or transparent background based on object settings
  const hasTransparentBg = drawableObject.userData.transparentBackground === true;
  if (hasTransparentBg) {
    ctx.clearRect(0, 0, 512, 512);
  } else {
    // Default: white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 512);
  }

  // Store in userData
  drawableObject.userData.drawingCanvas = canvas;
  drawableObject.userData.drawingCtx = ctx;

  // Create texture for 3D rendering
  updateDrawingTexture(drawableObject);

  return canvas;
}

// Update the 3D texture from the drawing canvas
function updateDrawingTexture(drawableObject) {
  if (!drawableObject || !drawableObject.userData.drawingCanvas) return;

  const canvas = drawableObject.userData.drawingCanvas;

  // Create or update texture
  if (!drawableObject.userData.drawingTexture) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    drawableObject.userData.drawingTexture = texture;

    // Find the page surface and apply texture
    applyDrawingTextureToObject(drawableObject);
  } else {
    drawableObject.userData.drawingTexture.needsUpdate = true;
  }
}

// Apply the drawing texture to the object's surface
function applyDrawingTextureToObject(drawableObject) {
  if (!drawableObject || !drawableObject.userData.drawingTexture) return;

  const texture = drawableObject.userData.drawingTexture;

  // Find the appropriate mesh to apply the texture
  drawableObject.traverse((child) => {
    if (child.isMesh) {
      // For notebook and paper, apply to top surface
      if (child.material && child.material.color) {
        // Create a new material with the drawing texture overlay
        const originalColor = child.material.color.clone();

        // Create custom material that blends drawing with base color
        const drawingMaterial = new THREE.MeshStandardMaterial({
          color: originalColor,
          map: texture,
          transparent: true,
          roughness: child.material.roughness || 0.9,
          metalness: child.material.metalness || 0
        });

        // Store original material for restoration
        if (!child.userData.originalMaterial) {
          child.userData.originalMaterial = child.material;
        }

        // Only apply to the "pages" part
        if (child.material.color.getHexString() === 'ffffff' ||
            child.material.color.getHexString() === 'fffff5' ||
            child.material.color.getHexString() === 'f5f5f0') {
          child.material = drawingMaterial;
        }
      }
    }
  });
}

// Add a point to the current stroke
function addDrawingPoint(worldPos) {
  if (!penDrawingMode.active || !penDrawingMode.heldPen) return;

  // Use the worldPos parameter directly - it's the exact crosshair intersection point
  // This ensures drawing happens exactly where the crosshair aims
  const mousePos = pointerLockState.isLocked ? new THREE.Vector2(0, 0) : mouse;
  raycaster.setFromCamera(mousePos, camera);

  // Raycast to drawable objects, excluding the pen to prevent blocking
  const drawableObjects = deskObjects.filter(obj =>
    (obj.userData.type === 'notebook' || obj.userData.type === 'paper') &&
    obj !== penDrawingMode.heldPen
  );
  const intersects = raycaster.intersectObjects(drawableObjects, true);

  if (intersects.length === 0) return;

  // Find the parent object that is in deskObjects
  let target = intersects[0].object;
  while (target.parent && !deskObjects.includes(target)) {
    target = target.parent;
  }

  if (!deskObjects.includes(target)) return;

  // Use the provided worldPos (crosshair intersection) for accurate drawing
  const intersectionPoint = worldPos.clone();

  // Set as current target if not set
  if (penDrawingMode.targetObject !== target) {
    // Save previous target's drawing if different
    if (penDrawingMode.targetObject) {
      saveDrawingToFile(penDrawingMode.targetObject);
    }
    penDrawingMode.targetObject = target;
  }

  // Get or create drawing canvas
  const canvas = getDrawingCanvas(target);
  if (!canvas) return;

  const ctx = target.userData.drawingCtx;

  // Convert intersection point to canvas coordinates
  const coords = worldToDrawingCoords(intersectionPoint, target);
  if (!coords || coords.x < 0 || coords.x > 512 || coords.y < 0 || coords.y > 512) return;

  // Get pen ink color
  const pen = penDrawingMode.heldPen;
  const inkColor = pen.userData.inkColor || pen.userData.mainColor || '#000000';

  // Add point to path
  penDrawingMode.drawingPath.push(coords);

  // Draw line from previous point if available
  if (penDrawingMode.drawingPath.length >= 2) {
    const prevPoint = penDrawingMode.drawingPath[penDrawingMode.drawingPath.length - 2];

    ctx.beginPath();
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = penDrawingMode.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(prevPoint.x, prevPoint.y);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();

    // Update texture
    updateDrawingTexture(target);
  }

  // Add to object's drawing lines for persistence
  if (!target.userData.drawingLines) {
    target.userData.drawingLines = [];
  }
}

// End the current stroke
function endDrawingStroke() {
  if (penDrawingMode.drawingPath.length > 0 && penDrawingMode.targetObject) {
    // Save the completed stroke to the object's data
    const strokeData = {
      points: [...penDrawingMode.drawingPath],
      color: penDrawingMode.heldPen?.userData.inkColor || '#000000',
      width: penDrawingMode.lineWidth,
      timestamp: Date.now()
    };

    if (!penDrawingMode.targetObject.userData.drawingLines) {
      penDrawingMode.targetObject.userData.drawingLines = [];
    }
    penDrawingMode.targetObject.userData.drawingLines.push(strokeData);
  }

  penDrawingMode.drawingPath = [];
  penDrawingMode.isStrokeActive = false;
}

// Generate a filename for the drawing
function generateDrawingFilename(drawableObject) {
  const type = drawableObject.userData.type;
  const id = drawableObject.userData.id;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${type}-${id}-${timestamp}.png`;
}

// Save drawing to file
async function saveDrawingToFile(drawableObject) {
  if (!drawableObject || !drawableObject.userData.drawingCanvas) return;

  // Only save if there are actual drawings
  if (!drawableObject.userData.drawingLines || drawableObject.userData.drawingLines.length === 0) return;

  const canvas = drawableObject.userData.drawingCanvas;
  const dataUrl = canvas.toDataURL('image/png');

  // Generate filename if not set
  if (!drawableObject.userData.drawingFileName) {
    drawableObject.userData.drawingFileName = generateDrawingFilename(drawableObject);
  }

  // Save using the object data storage (like PDFs) for state persistence
  const objectId = drawableObject.userData.id;
  try {
    if (window.electronAPI && window.electronAPI.saveObjectData) {
      await window.electronAPI.saveObjectData(objectId, 'drawing', dataUrl);
      console.log('Drawing saved to app data:', drawableObject.userData.drawingFileName);
    }
  } catch (err) {
    console.error('Error saving drawing to app data:', err);
  }

  // Also save to custom folder if set in the pen's settings
  const customFolder = penDrawingMode.saveFolder;
  if (customFolder && window.electronAPI && window.electronAPI.saveDrawingFile) {
    try {
      const result = await window.electronAPI.saveDrawingFile(
        customFolder,
        drawableObject.userData.drawingFileName,
        dataUrl
      );
      if (result.success) {
        console.log('Drawing also saved to custom folder:', result.filePath);
      } else {
        console.error('Error saving to custom folder:', result.error);
      }
    } catch (err) {
      console.error('Error saving drawing to custom folder:', err);
    }
  }

  // Also update the state save
  saveState();
}

// Load drawing from file
async function loadDrawingFromFile(drawableObject) {
  if (!drawableObject) return;

  const objectId = drawableObject.userData.id;
  try {
    if (window.electronAPI && window.electronAPI.loadObjectData) {
      const result = await window.electronAPI.loadObjectData(objectId, 'drawing');
      if (result.success && result.data) {
        // Create canvas and load image
        const canvas = getDrawingCanvas(drawableObject);
        const ctx = drawableObject.userData.drawingCtx;

        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
          updateDrawingTexture(drawableObject);
        };
        img.src = result.data;

        console.log('Drawing loaded for object:', objectId);
      }
    }
  } catch (err) {
    console.error('Error loading drawing:', err);
  }
}

// Redraw all strokes from saved data (for restoring from state)
function redrawAllStrokes(drawableObject) {
  if (!drawableObject || !drawableObject.userData.drawingLines) return;

  const canvas = getDrawingCanvas(drawableObject);
  if (!canvas) return;

  const ctx = drawableObject.userData.drawingCtx;

  // Clear canvas first
  ctx.clearRect(0, 0, 512, 512);

  // Redraw all strokes
  for (const stroke of drawableObject.userData.drawingLines) {
    if (stroke.points.length < 2) continue;

    ctx.beginPath();
    ctx.strokeStyle = stroke.color || '#000000';
    ctx.lineWidth = stroke.width || 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }

  updateDrawingTexture(drawableObject);
}

// Delete drawing file when object is deleted
async function deleteDrawingFile(drawableObject) {
  if (!drawableObject) return;

  const objectId = drawableObject.userData.id;
  try {
    if (window.electronAPI && window.electronAPI.saveObjectData) {
      // Pass null to delete the file
      await window.electronAPI.saveObjectData(objectId, 'drawing', null);
      console.log('Drawing deleted for object:', objectId);
    }
  } catch (err) {
    console.error('Error deleting drawing:', err);
  }
}

function updateObjectColor(object, colorType, colorValue) {
  if (!object) return;

  const oldMainColor = object.userData.mainColor;
  const oldAccentColor = object.userData.accentColor;

  object.userData[colorType] = colorValue;

  // Recreate the object with new colors to ensure proper color application
  const type = object.userData.type;
  const creator = PRESET_CREATORS[type];
  if (!creator) return;

  // Store position and state
  const position = { x: object.position.x, y: object.position.y, z: object.position.z };
  const rotation = { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z };
  const scale = { x: object.scale.x, y: object.scale.y, z: object.scale.z };
  const id = object.userData.id;
  const originalY = object.userData.originalY;
  const savedRotationY = object.userData.rotationY;
  const savedScale = object.userData.scale;

  // Store type-specific properties that should be preserved
  const typeSpecificData = {};
  switch (type) {
    case 'books':
      typeSpecificData.bookTitle = object.userData.bookTitle;
      typeSpecificData.titleColor = object.userData.titleColor;
      typeSpecificData.pdfPath = object.userData.pdfPath;
      typeSpecificData.totalPages = object.userData.totalPages;
      typeSpecificData.currentPage = object.userData.currentPage;
      typeSpecificData.isOpen = object.userData.isOpen;
      // Preserve PDF document and data for content display after style change
      typeSpecificData.pdfDocument = object.userData.pdfDocument;
      typeSpecificData.pdfDataUrl = object.userData.pdfDataUrl;
      typeSpecificData.pdfDataDirty = object.userData.pdfDataDirty; // Preserve dirty flag
      typeSpecificData.pdfResolution = object.userData.pdfResolution;
      typeSpecificData.renderedPages = object.userData.renderedPages;
      typeSpecificData.pageTextures = object.userData.pageTextures;
      // Preserve cover image data
      typeSpecificData.coverImageDataUrl = object.userData.coverImageDataUrl;
      typeSpecificData.coverImageDirty = object.userData.coverImageDirty; // Preserve dirty flag
      typeSpecificData.coverFitMode = object.userData.coverFitMode;
      typeSpecificData.firstPageAsCover = object.userData.firstPageAsCover;
      break;
    case 'magazine':
      typeSpecificData.magazineTitle = object.userData.magazineTitle;
      typeSpecificData.titleColor = object.userData.titleColor;
      typeSpecificData.pdfPath = object.userData.pdfPath;
      typeSpecificData.totalPages = object.userData.totalPages;
      typeSpecificData.currentPage = object.userData.currentPage;
      typeSpecificData.isOpen = object.userData.isOpen;
      // Preserve PDF document and data for content display after style change
      typeSpecificData.pdfDocument = object.userData.pdfDocument;
      typeSpecificData.pdfDataUrl = object.userData.pdfDataUrl;
      typeSpecificData.pdfDataDirty = object.userData.pdfDataDirty;
      typeSpecificData.pdfResolution = object.userData.pdfResolution;
      typeSpecificData.renderedPages = object.userData.renderedPages;
      typeSpecificData.pageTextures = object.userData.pageTextures;
      // Preserve cover image data
      typeSpecificData.coverImageDataUrl = object.userData.coverImageDataUrl;
      typeSpecificData.coverImageDirty = object.userData.coverImageDirty;
      typeSpecificData.coverFitMode = object.userData.coverFitMode;
      typeSpecificData.firstPageAsCover = object.userData.firstPageAsCover;
      break;
    case 'coffee':
      typeSpecificData.drinkType = object.userData.drinkType;
      typeSpecificData.liquidLevel = object.userData.liquidLevel;
      typeSpecificData.isHot = object.userData.isHot;
      break;
    case 'metronome':
      typeSpecificData.bpm = object.userData.bpm;
      typeSpecificData.tickSound = object.userData.tickSound;
      typeSpecificData.tickSoundType = object.userData.tickSoundType;
      typeSpecificData.isRunning = object.userData.isRunning;
      typeSpecificData.volume = object.userData.volume;
      typeSpecificData.tickPitch = object.userData.tickPitch;
      typeSpecificData.customSoundDataUrl = object.userData.customSoundDataUrl;
      // Preserve pitch curve settings
      typeSpecificData.pitchCurveEnabled = object.userData.pitchCurveEnabled;
      typeSpecificData.pitchCurveType = object.userData.pitchCurveType;
      typeSpecificData.pitchCurveStart = object.userData.pitchCurveStart;
      typeSpecificData.pitchCurveEnd = object.userData.pitchCurveEnd;
      typeSpecificData.pitchCurveDuration = object.userData.pitchCurveDuration;
      typeSpecificData.pitchCurveLoop = object.userData.pitchCurveLoop;
      typeSpecificData.pitchCurvePoints = object.userData.pitchCurvePoints;
      // Preserve tempo curve settings
      typeSpecificData.tempoCurveEnabled = object.userData.tempoCurveEnabled;
      typeSpecificData.tempoCurveType = object.userData.tempoCurveType;
      typeSpecificData.tempoCurveStart = object.userData.tempoCurveStart;
      typeSpecificData.tempoCurveEnd = object.userData.tempoCurveEnd;
      typeSpecificData.tempoCurveDuration = object.userData.tempoCurveDuration;
      typeSpecificData.tempoCurveLoop = object.userData.tempoCurveLoop;
      typeSpecificData.tempoCurvePoints = object.userData.tempoCurvePoints;
      break;
    case 'photo-frame':
      typeSpecificData.photoDataUrl = object.userData.photoDataUrl;
      typeSpecificData.photoTexture = object.userData.photoTexture;
      break;
    case 'laptop':
      typeSpecificData.bootTime = object.userData.bootTime;
      typeSpecificData.bootScreenDataUrl = object.userData.bootScreenDataUrl;
      typeSpecificData.bootScreenTexture = object.userData.bootScreenTexture;
      typeSpecificData.powerLedColor = object.userData.powerLedColor;
      typeSpecificData.powerButtonColor = object.userData.powerButtonColor;
      typeSpecificData.editorContent = object.userData.editorContent;
      typeSpecificData.editorFileName = object.userData.editorFileName;
      typeSpecificData.wallpaperDataUrl = object.userData.wallpaperDataUrl;
      break;
    case 'pen':
      typeSpecificData.penColor = object.userData.penColor;
      typeSpecificData.inkColor = object.userData.inkColor;
      typeSpecificData.colorHex = object.userData.colorHex;
      break;
  }

  // Create new object with updated colors
  const newObject = creator({
    mainColor: object.userData.mainColor,
    accentColor: object.userData.accentColor
  });

  // Restore position, rotation, scale and other properties
  newObject.position.set(position.x, position.y, position.z);
  newObject.rotation.set(rotation.x, rotation.y, rotation.z);
  newObject.scale.set(scale.x, scale.y, scale.z);
  newObject.userData.id = id;
  newObject.userData.originalY = originalY;
  newObject.userData.targetY = position.y;
  newObject.userData.isLifted = false;
  newObject.userData.rotationY = savedRotationY;
  newObject.userData.scale = savedScale;

  // Restore type-specific properties
  Object.assign(newObject.userData, typeSpecificData);

  // For books, update the title texture with the restored title and resize for multi-line
  if (type === 'books' && newObject.userData.createTitleTexture) {
    const closedGroup = newObject.getObjectByName('closedBook');
    if (closedGroup) {
      const coverTitle = closedGroup.getObjectByName('coverTitle');
      if (coverTitle) {
        // Calculate dimensions for multi-line titles
        const title = typeSpecificData.bookTitle || '';

        // Hide title background if title is empty or whitespace only
        coverTitle.visible = title.trim().length > 0;

        // Only update texture if title is visible
        if (coverTitle.visible) {
          const lines = title.split('\n');
          const baseHeight = 116;
          const lineAddition = 60;
          const lineCount = Math.max(1, lines.length);
          const canvasHeight = baseHeight + (lineCount - 1) * lineAddition;
          const baseGeoHeight = 0.08;
          const geoHeight = baseGeoHeight * (canvasHeight / baseHeight);

          // Update geometry for multi-line
          const newGeometry = new THREE.PlaneGeometry(0.22, geoHeight);
          coverTitle.geometry.dispose();
          coverTitle.geometry = newGeometry;
          coverTitle.position.y = 0.041 + (lineCount - 1) * 0.01;

          const newCoverTexture = newObject.userData.createTitleTexture(typeSpecificData.bookTitle, 320, canvasHeight, 64);
          coverTitle.material.map = newCoverTexture;
          coverTitle.material.needsUpdate = true;
        }
      }
    }

    // Restore cover image if present (with fit mode)
    if (typeSpecificData.coverImageDataUrl) {
      const fitMode = newObject.userData.coverFitMode || 'contain';
      applyCoverImageWithFit(newObject, typeSpecificData.coverImageDataUrl, fitMode);
    }

    // Update book thickness and pages if PDF is loaded
    if (typeSpecificData.pdfDocument) {
      updateBookThickness(newObject);
      // Clear texture cache to force re-render with new colors
      newObject.userData.pageTextures = {};
      if (typeSpecificData.isOpen) {
        updateBookPagesWithPDF(newObject);
      }
    }

    // Toggle book to correct open/closed state
    if (typeSpecificData.isOpen) {
      const closedGroup = newObject.getObjectByName('closedBook');
      const openGroup = newObject.getObjectByName('openBook');
      if (closedGroup) closedGroup.visible = false;
      if (openGroup) openGroup.visible = true;
    }
  }

  // For magazine, update the title texture and restore state
  if (type === 'magazine' && newObject.userData.createTitleTexture) {
    const closedGroup = newObject.getObjectByName('closedMagazine');
    if (closedGroup) {
      const coverTitle = closedGroup.getObjectByName('coverTitle');
      if (coverTitle) {
        const title = typeSpecificData.magazineTitle || '';
        coverTitle.visible = title.trim().length > 0;

        if (coverTitle.visible) {
          const lines = title.split('\n');
          const baseHeight = 124;
          const lineAddition = 50;
          const lineCount = Math.max(1, lines.length);
          const canvasHeight = baseHeight + (lineCount - 1) * lineAddition;
          const baseGeoHeight = 0.08;
          const geoHeight = baseGeoHeight * (canvasHeight / baseHeight);

          const newGeometry = new THREE.PlaneGeometry(0.18, geoHeight);
          coverTitle.geometry.dispose();
          coverTitle.geometry = newGeometry;
          coverTitle.position.y = 0.016 + (lineCount - 1) * 0.008;

          const newCoverTexture = newObject.userData.createTitleTexture(typeSpecificData.magazineTitle, 280, canvasHeight, 48);
          coverTitle.material.map = newCoverTexture;
          coverTitle.material.needsUpdate = true;
        }
      }
    }

    // Restore cover image if present (with fit mode)
    if (typeSpecificData.coverImageDataUrl) {
      const fitMode = newObject.userData.coverFitMode || 'cover';
      applyMagazineCoverImageWithFit(newObject, typeSpecificData.coverImageDataUrl, fitMode);
    }

    // Update magazine thickness and pages if PDF is loaded
    if (typeSpecificData.pdfDocument) {
      updateMagazineThickness(newObject);
      newObject.userData.pageTextures = {};
      if (typeSpecificData.isOpen) {
        updateMagazinePagesWithPDF(newObject);
      }
    }

    // Toggle magazine to correct open/closed state
    if (typeSpecificData.isOpen) {
      const closedGroup = newObject.getObjectByName('closedMagazine');
      const openGroup = newObject.getObjectByName('openMagazine');
      if (closedGroup) closedGroup.visible = false;
      if (openGroup) openGroup.visible = true;
    }
  }

  // For coffee mug, update liquid color and level
  if (type === 'coffee') {
    const liquid = newObject.getObjectByName('liquid');
    const liquidBody = newObject.getObjectByName('liquidBody');
    if (typeSpecificData.drinkType && DRINK_COLORS[typeSpecificData.drinkType]) {
      if (liquid) liquid.material.color.set(DRINK_COLORS[typeSpecificData.drinkType].color);
      if (liquidBody) liquidBody.material.color.set(DRINK_COLORS[typeSpecificData.drinkType].color);
    }
    const level = typeSpecificData.liquidLevel !== undefined ? typeSpecificData.liquidLevel : 0.8;
    if (liquid) {
      liquid.visible = level > 0.05;
      liquid.position.y = 0.03 + level * 0.14;
    }
    if (liquidBody) {
      liquidBody.visible = level > 0.05;
      liquidBody.scale.y = Math.max(0.1, level);
      liquidBody.position.y = 0.015 + level * 0.07;
    }
  }

  // For photo frame, restore the photo texture
  if (type === 'photo-frame' && typeSpecificData.photoDataUrl) {
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(typeSpecificData.photoDataUrl, (texture) => {
      const photoSurface = newObject.getObjectByName('photoSurface');
      if (photoSurface) {
        photoSurface.material.map = texture;
        photoSurface.material.color.set(0xffffff);
        photoSurface.material.needsUpdate = true;
        newObject.userData.photoTexture = texture;
      }
    });
  }

  // For laptop, restore the desktop texture with wallpaper if present
  if (type === 'laptop' && typeSpecificData.wallpaperDataUrl) {
    // Update the desktop texture with wallpaper
    const screen = newObject.getObjectByName('screen');
    if (screen && newObject.userData.createDesktopTexture) {
      newObject.userData.createDesktopTexture().then(texture => {
        screen.material.map = texture;
        screen.material.needsUpdate = true;
        newObject.userData.desktopTexture = texture;
      });
    }
  }

  // Replace in scene and array
  const index = deskObjects.indexOf(object);
  if (index > -1) {
    deskObjects[index] = newObject;
    scene.remove(object);
    scene.add(newObject);
    selectedObject = newObject;
  }

  saveState();
}

// ============================================================================
// PHYSICS SYSTEM
// ============================================================================

// Collision radii for all object types (used for push-away physics)
// Using predefined values avoids expensive recursive bounding box calculations
// that can cause stack overflow with complex objects (e.g., PDFs with many pages)
// Values are smaller than visual geometry to allow objects to touch before colliding
// Collision radii can be adjusted using collisionRadiusMultiplier setting (default 1.0)
// These are base values that get multiplied by the global multiplier
const OBJECT_COLLISION_RADII_BASE = {
  'clock': 0.1,        // Clock stand is thin, body is tall not wide
  'lamp': 0.08,        // Base radius ~0.25, but use smaller collision
  'plant': 0.08,       // Pot radius 0.18, use small
  'coffee': 0.06,      // Mug radius 0.12, use smaller
  'laptop': 0.15,      // Base is 0.8 x 0.5, use smaller for stacking detection
  'notebook': 0.1,     // BoxGeometry 0.4 x 0.55, use small radius
  'pen-holder': 0.06,  // CylinderGeometry radius 0.12
  'pen': 0.04,         // Small, lying flat
  'books': 0.08,       // BoxGeometry 0.28 x 0.38, reduced to allow closer placement
  'magazine': 0.07,    // BoxGeometry 0.22 x 0.30
  'photo-frame': 0.07, // Photo frame is thin
  'globe': 0.08,       // Base radius 0.18
  'trophy': 0.06,      // BoxGeometry 0.2 x 0.2
  'hourglass': 0.06,   // CylinderGeometry radius 0.12
  'paper': 0.08,       // BoxGeometry 0.28 x 0.4
  'metronome': 0.07,   // Base radius 0.15
  'cassette-player': 0.07, // Sony Walkman WM-10 style horizontal player (0.11 x 0.08)
  'big-cassette-player': 0.14 // Sony Walkman style player (0.45 x 0.35)
};

// Global collision radius multiplier (adjustable in settings, 0.5 to 2.0)
let collisionRadiusMultiplier = 1.0;

// Collision heights for all object types (used for vertical overlap check in collisions)
// Objects only collide horizontally when their vertical ranges overlap
// These values match the actual visual heights of objects
// Collision heights can be adjusted using collisionHeightMultiplier setting
const OBJECT_COLLISION_HEIGHTS_BASE = {
  'clock': 0.6,        // Tall clock
  'lamp': 0.9,         // Tall lamp
  'plant': 0.5,        // Medium plant
  'coffee': 0.25,      // Short mug
  'laptop': 0.25,      // When closed, quite flat
  'notebook': 0.05,    // Very flat
  'pen-holder': 0.35,  // Medium height cylinder
  'pen': 0.02,         // Very flat when lying down
  'books': 0.06,       // Single book is quite flat
  'magazine': 0.01,    // Very flat magazine
  'photo-frame': 0.5,  // Tall when standing
  'globe': 0.4,        // Medium globe
  'trophy': 0.35,      // Medium trophy
  'hourglass': 0.3,    // Medium hourglass
  'paper': 0.005,      // Paper sheet is very flat
  'metronome': 0.4,    // Medium metronome
  'cassette-player': 0.08, // Sony Walkman WM-10 style horizontal player (height 0.08)
  'big-cassette-player': 0.12 // Sony Walkman style player (height 0.12)
};

// Default collision height for unknown object types
const DEFAULT_COLLISION_HEIGHT_BASE = 0.3;

// Global collision height multiplier (adjustable in settings, 0.2 to 2.0)
let collisionHeightMultiplier = 1.0;

// Get the adjusted collision radii
function getObjectCollisionRadii() {
  const adjusted = {};
  for (const [type, radius] of Object.entries(OBJECT_COLLISION_RADII_BASE)) {
    adjusted[type] = radius * collisionRadiusMultiplier;
  }
  return adjusted;
}

// Stacking radii for all object types (used for stacking detection)
// These values match the actual footprint of objects for proper overlap detection
// Larger values allow objects to be placed on top of each other more easily
const OBJECT_STACKING_RADII = {
  'clock': 0.2,        // Clock base
  'lamp': 0.25,        // Lamp base radius
  'plant': 0.18,       // Pot radius
  'coffee': 0.12,      // Mug radius
  'laptop': 0.5,       // Base is 0.8 x 0.5, use half diagonal
  'notebook': 0.34,    // BoxGeometry 0.4 x 0.55, half diagonal
  'pen-holder': 0.12,  // CylinderGeometry radius
  'pen': 0.18,         // Pen length when lying flat
  'books': 0.24,       // BoxGeometry 0.28 x 0.38, half diagonal
  'magazine': 0.19,    // BoxGeometry 0.22 x 0.30, half diagonal
  'photo-frame': 0.2,  // Photo frame footprint
  'globe': 0.18,       // Globe base
  'trophy': 0.14,      // Trophy base
  'hourglass': 0.12,   // Hourglass base
  'paper': 0.24,       // BoxGeometry 0.28 x 0.4, half diagonal
  'metronome': 0.15,   // Metronome base
  'cassette-player': 0.07, // Sony Walkman WM-10 style horizontal (0.11 x 0.08 diagonal / 2)
  'big-cassette-player': 0.28 // Sony Walkman style player (0.45 x 0.35 diagonal / 2)
};

// Default collision radius for unknown object types
const DEFAULT_COLLISION_RADIUS_BASE = 0.1;

// Default stacking radius for unknown object types
const DEFAULT_STACKING_RADIUS = 0.25;

function getObjectBounds(object) {
  const type = object.userData.type;
  const scale = object.scale?.x || 1;

  // Get per-object collision radius multiplier (default 1.0 = 100%)
  const objectMultiplier = object.userData.objectCollisionRadiusMultiplier || 1.0;

  // Use predefined collision radius if available (with global and per-object multipliers applied)
  const baseRadius = OBJECT_COLLISION_RADII_BASE[type];
  if (baseRadius !== undefined) {
    return baseRadius * collisionRadiusMultiplier * objectMultiplier * scale;
  }

  // For unknown types, use default radius
  // This avoids expensive recursive setFromObject() calls that can cause
  // stack overflow with complex objects like PDFs with many pages
  return DEFAULT_COLLISION_RADIUS_BASE * collisionRadiusMultiplier * objectMultiplier * scale;
}

// Get stacking radius for an object (used for overlap detection when stacking)
// Returns larger values than getObjectBounds to allow proper stacking detection
function getStackingRadius(object) {
  const type = object.userData.type;
  const scale = object.scale?.x || 1;

  // Use predefined stacking radius if available
  if (OBJECT_STACKING_RADII[type] !== undefined) {
    return OBJECT_STACKING_RADII[type] * scale;
  }

  // For unknown types, use default stacking radius
  return DEFAULT_STACKING_RADIUS * scale;
}

// Get additional collision points for objects with complex shapes (e.g., laptop monitor)
// Returns array of { x, z, radius, height, rotation } relative to object position
// These represent multiple small collision zones for more realistic collision detection
// The rotation field contains the object's Y rotation so collision detection can rotate points
function getExtraCollisionPoints(object) {
  const type = object.userData.type;
  const scale = object.scale?.x || 1;
  const objectRotationY = object.rotation?.y || 0;

  // Laptop has multiple collision points along the tilted monitor screen
  if (type === 'laptop') {
    const points = [];
    // The laptop screen is at (0, 0.28, -0.23) rotated -PI/6 (30 deg backward)
    // Screen is 0.78 wide (x) and 0.5 tall (y before rotation)
    // After rotation, the screen extends backward (negative Z) and upward
    const screenTilt = Math.PI / 6; // 30 degrees
    const screenHeight = 0.5;
    const screenWidth = 0.78;
    const screenCenterY = 0.28;
    const screenCenterZ = -0.23;

    // Calculate the bottom and top edges of the tilted screen
    // Bottom edge is at -screenHeight/2 from center, rotated by screenTilt
    const bottomEdgeY = screenCenterY - (screenHeight / 2) * Math.cos(screenTilt);
    const bottomEdgeZ = screenCenterZ + (screenHeight / 2) * Math.sin(screenTilt);
    // Top edge is at +screenHeight/2 from center, rotated by screenTilt
    const topEdgeY = screenCenterY + (screenHeight / 2) * Math.cos(screenTilt);
    const topEdgeZ = screenCenterZ - (screenHeight / 2) * Math.sin(screenTilt);

    // Create 5 small collision cylinders spread across the screen width
    // Each cylinder extends from keyboard level to top of screen
    const numPoints = 5;
    const collisionRadius = 0.04; // Small radius for each collision point

    // Collision should start from keyboard level (y=0.03) and extend to top of screen
    const keyboardLevel = 0.03;
    const collisionHeight = topEdgeY - keyboardLevel; // From keyboard to top of screen

    for (let i = 0; i < numPoints; i++) {
      // Spread points along the X axis (screen width)
      const t = (i / (numPoints - 1)) - 0.5; // -0.5 to 0.5
      const xOffset = t * (screenWidth - 0.1); // Leave small margin at edges

      // Position collision cylinder at the center Z of the screen (between bottom and top edges)
      const centerZ = (bottomEdgeZ + topEdgeZ) / 2;

      points.push({
        x: xOffset * scale,
        z: centerZ * scale,
        radius: collisionRadius * scale,
        height: collisionHeight * scale,
        baseY: keyboardLevel * scale, // Start from keyboard level
        rotation: objectRotationY // Store object's Y rotation for collision detection
      });
    }

    return points;
  }

  // No extra collision points for other objects
  return [];
}

// Get collision height for an object (used for vertical overlap check)
// Objects only collide horizontally when their vertical ranges overlap
function getCollisionHeight(object) {
  const type = object.userData.type;
  const scale = object.scale?.y || object.scale?.x || 1;

  // Get per-object collision height multiplier (default 1.0 = 100%)
  const objectMultiplier = object.userData.objectCollisionHeightMultiplier || 1.0;

  // Use predefined collision height if available (with global and per-object multipliers applied)
  const baseHeight = OBJECT_COLLISION_HEIGHTS_BASE[type];
  if (baseHeight !== undefined) {
    return baseHeight * collisionHeightMultiplier * objectMultiplier * scale;
  }

  // For unknown types, use default collision height
  return DEFAULT_COLLISION_HEIGHT_BASE * collisionHeightMultiplier * objectMultiplier * scale;
}

// Check if two objects overlap vertically (their vertical ranges intersect)
// Returns true if objects should collide horizontally, false if one is above the other
function objectsOverlapVertically(obj1, physics1, obj2, physics2) {
  // Get collision heights for both objects
  const height1 = getCollisionHeight(obj1);
  const height2 = getCollisionHeight(obj2);

  // Get base offsets (distance from object origin to bottom)
  const baseOffset1 = physics1.baseOffset || 0;
  const baseOffset2 = physics2.baseOffset || 0;

  // Calculate vertical ranges (bottom to top) for each object
  // Object position.y is typically at the center or base, baseOffset corrects this
  const bottom1 = obj1.position.y - baseOffset1;
  const top1 = bottom1 + height1;
  const bottom2 = obj2.position.y - baseOffset2;
  const top2 = bottom2 + height2;

  // Check if ranges overlap: ranges overlap if one doesn't start after the other ends
  // Using a small tolerance (0.01) to prevent floating point issues
  const tolerance = 0.01;
  return !(top1 < bottom2 + tolerance || top2 < bottom1 + tolerance);
}

function initPhysicsForObject(object) {
  if (!physicsState.velocities.has(object.userData.id)) {
    physicsState.velocities.set(object.userData.id, { x: 0, z: 0 });
    physicsState.angularVelocities.set(object.userData.id, 0);
    physicsState.tiltState.set(object.userData.id, { x: 0, z: 0 });
    physicsState.tiltVelocities.set(object.userData.id, { x: 0, z: 0 });
  }
}

function getObjectPhysics(object) {
  const type = object.userData.type;
  return OBJECT_PHYSICS[type] || { weight: 1.0, stability: 0.5, height: 0.3, friction: 0.5 };
}

// ============================================================================
// DEBUG VISUALIZATION - Show collision radii for debugging
// ============================================================================

// Create a semi-transparent cylinder to visualize collision radius
function createCollisionHelper(object) {
  const collisionRadius = getObjectBounds(object);
  const stackingRadius = getStackingRadius(object);
  const collisionHeight = getCollisionHeight(object);
  const physics = getObjectPhysics(object);

  // Create a group to hold both collision and stacking helpers
  const helperGroup = new THREE.Group();
  helperGroup.userData.isDebugHelper = true;
  helperGroup.userData.targetObjectId = object.userData.id;

  // Collision radius visualization (red/orange - used for push physics)
  // Now uses collisionHeight which is adjustable via settings
  const collisionGeometry = new THREE.CylinderGeometry(collisionRadius, collisionRadius, collisionHeight, 16, 1, true);
  const collisionMaterial = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const collisionHelper = new THREE.Mesh(collisionGeometry, collisionMaterial);
  collisionHelper.position.y = collisionHeight / 2;
  helperGroup.add(collisionHelper);

  // Add collision radius ring at the base
  const collisionRing = new THREE.RingGeometry(collisionRadius - 0.01, collisionRadius + 0.01, 32);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const collisionRingMesh = new THREE.Mesh(collisionRing, ringMaterial);
  collisionRingMesh.rotation.x = -Math.PI / 2;
  collisionRingMesh.position.y = 0.01;
  helperGroup.add(collisionRingMesh);

  // Stacking radius visualization (blue/cyan - used for stacking detection)
  // Uses physics.height as stacking considers the visual height
  const stackingGeometry = new THREE.CylinderGeometry(stackingRadius, stackingRadius, physics.height, 16, 1, true);
  const stackingMaterial = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const stackingHelper = new THREE.Mesh(stackingGeometry, stackingMaterial);
  stackingHelper.position.y = physics.height / 2;
  helperGroup.add(stackingHelper);

  // Add stacking radius ring at the base
  const stackingRing = new THREE.RingGeometry(stackingRadius - 0.01, stackingRadius + 0.01, 32);
  const stackingRingMaterial = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const stackingRingMesh = new THREE.Mesh(stackingRing, stackingRingMaterial);
  stackingRingMesh.rotation.x = -Math.PI / 2;
  stackingRingMesh.position.y = 0.02;
  helperGroup.add(stackingRingMesh);

  // Add extra collision points visualization (green - for complex shapes like laptop monitor)
  const extraPoints = getExtraCollisionPoints(object);
  extraPoints.forEach(point => {
    const extraGeometry = new THREE.CylinderGeometry(point.radius, point.radius, point.height, 8, 1, true);
    const extraMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const extraHelper = new THREE.Mesh(extraGeometry, extraMaterial);
    extraHelper.position.set(point.x, point.baseY + point.height / 2, point.z);
    helperGroup.add(extraHelper);

    // Add ring at base of extra collision point
    const extraRing = new THREE.RingGeometry(point.radius - 0.005, point.radius + 0.005, 16);
    const extraRingMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const extraRingMesh = new THREE.Mesh(extraRing, extraRingMaterial);
    extraRingMesh.rotation.x = -Math.PI / 2;
    extraRingMesh.position.set(point.x, point.baseY + 0.01, point.z);
    helperGroup.add(extraRingMesh);
  });

  // Position and rotate helper to match the object
  helperGroup.position.copy(object.position);
  helperGroup.rotation.y = object.rotation.y; // Match Y rotation for collision visualization

  return helperGroup;
}

// Update all debug collision helpers
function updateCollisionDebugHelpers() {
  // Remove old helpers
  debugState.collisionHelpers.forEach(helper => {
    scene.remove(helper);
    helper.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  });
  debugState.collisionHelpers = [];

  // If debug mode is off, we're done
  if (!debugState.showCollisionRadii) return;

  // Create helpers for all desk objects
  deskObjects.forEach(object => {
    if (object.userData.isFallen) return;
    if (object.userData.isExamining || object.userData.isReturning) return;

    const helper = createCollisionHelper(object);
    scene.add(helper);
    debugState.collisionHelpers.push(helper);
  });
}

// Update positions and rotations of debug helpers each frame
function updateCollisionDebugPositions() {
  if (!debugState.showCollisionRadii) return;

  debugState.collisionHelpers.forEach(helper => {
    const targetId = helper.userData.targetObjectId;
    const targetObject = deskObjects.find(obj => obj.userData.id === targetId);
    if (targetObject) {
      helper.position.copy(targetObject.position);
      helper.rotation.y = targetObject.rotation.y; // Match Y rotation for collision visualization
    }
  });
}

// Toggle collision debug visualization
function toggleCollisionDebug() {
  debugState.showCollisionRadii = !debugState.showCollisionRadii;

  // Update button text
  const btn = document.getElementById('toggle-collision-debug-btn');
  if (btn) {
    btn.textContent = debugState.showCollisionRadii ? '🔳 Hide Collision Radii' : '🔲 Show Collision Radii';
    btn.style.background = debugState.showCollisionRadii ? 'rgba(34, 197, 94, 0.2)' : 'rgba(79, 70, 229, 0.2)';
    btn.style.borderColor = debugState.showCollisionRadii ? 'rgba(34, 197, 94, 0.4)' : 'rgba(79, 70, 229, 0.4)';
    btn.style.color = debugState.showCollisionRadii ? '#4ade80' : '#818cf8';
  }

  updateCollisionDebugHelpers();
}

// Toggle camera ray debug visualization
function toggleCameraRayDebug() {
  debugState.showCameraRay = !debugState.showCameraRay;

  // Update button text
  const btn = document.getElementById('toggle-camera-ray-btn');
  if (btn) {
    btn.textContent = debugState.showCameraRay ? '🔳 Hide Camera Ray' : '🔲 Show Camera Ray';
    btn.style.background = debugState.showCameraRay ? 'rgba(34, 197, 94, 0.2)' : 'rgba(79, 70, 229, 0.2)';
    btn.style.borderColor = debugState.showCameraRay ? 'rgba(34, 197, 94, 0.4)' : 'rgba(79, 70, 229, 0.4)';
    btn.style.color = debugState.showCameraRay ? '#4ade80' : '#818cf8';
  }

  updateCameraRayHelper();
}

// Update camera ray visualization
function updateCameraRayHelper() {
  if (!debugState.showCameraRay) {
    // Remove ray helper if debug mode is disabled
    if (cameraRayHelper) {
      scene.remove(cameraRayHelper);
      cameraRayHelper = null;
    }
    return;
  }

  // Create or update camera ray visualization
  // Ray goes from camera through crosshair/center of screen
  const mousePos = pointerLockState.isLocked ? new THREE.Vector2(0, 0) : mouse;
  raycaster.setFromCamera(mousePos, camera);

  // Create ray helper if it doesn't exist
  if (!cameraRayHelper) {
    // Create a thick cylinder to visualize the camera ray
    const rayGroup = new THREE.Group();
    rayGroup.name = 'cameraRayHelper';

    // Ray length extending from camera
    const rayLength = 20.0;
    const rayGeometry = new THREE.CylinderGeometry(0.01, 0.01, rayLength, 8);
    const rayMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff, // Cyan color for camera ray
      transparent: true,
      opacity: 0.8,
      depthTest: false,
      depthWrite: false
    });
    const rayCylinder = new THREE.Mesh(rayGeometry, rayMaterial);
    rayCylinder.renderOrder = 999;
    rayGroup.add(rayCylinder);

    // Add a small sphere at the end for visibility
    const sphereGeometry = new THREE.SphereGeometry(0.02, 8, 8);
    const sphereMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00, // Green for endpoint
      depthTest: false,
      depthWrite: false
    });
    const endSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    endSphere.name = 'endSphere';
    endSphere.renderOrder = 1000;
    rayGroup.add(endSphere);

    cameraRayHelper = rayGroup;
    scene.add(cameraRayHelper);
  }

  // Update ray position and orientation
  if (cameraRayHelper) {
    const rayLength = 20.0;
    const rayOrigin = raycaster.ray.origin.clone();
    const rayDirection = raycaster.ray.direction.clone();

    // Position at midpoint of the ray
    const midPoint = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(rayLength / 2));
    cameraRayHelper.position.copy(midPoint);

    // Orient to point along ray direction
    const upVector = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(upVector, rayDirection);
    cameraRayHelper.quaternion.copy(quaternion);

    // Update end sphere position
    const endSphere = cameraRayHelper.getObjectByName('endSphere');
    if (endSphere) {
      endSphere.position.set(0, rayLength / 2, 0);
    }
  }
}

// ============================================================================
// STACKING PHYSICS - Objects on top of each other with friction-based pulling
// ============================================================================

// Find all objects that are stacked directly on top of the given object
// Returns array of objects that are resting on the given object's top surface
function findObjectsOnTop(baseObject) {
  if (!baseObject || baseObject.userData.isFallen) return [];

  const basePhysics = getObjectPhysics(baseObject);

  // Objects that don't allow stacking have no objects on top
  if (basePhysics.noStackingOnTop) return [];

  // Use stacking radius (actual object footprint) for overlap detection
  const baseRadius = getStackingRadius(baseObject);
  const baseTop = baseObject.position.y + basePhysics.height;
  const result = [];

  deskObjects.forEach(obj => {
    if (obj === baseObject) return;
    if (obj.userData.isFallen) return;
    if (obj.userData.isLifted) return;  // Skip objects currently being lifted/dragged
    if (obj.userData.isExamining || obj.userData.isReturning) return;

    const objPhysics = getObjectPhysics(obj);
    // Use stacking radius for the top object too
    const objRadius = getStackingRadius(obj);
    const objBottom = obj.position.y;

    // Check if object is resting on top of baseObject (vertically)
    // Object's bottom should be at approximately baseObject's top (with small tolerance)
    // Increased tolerance to account for slight positioning variations
    const verticalTolerance = 0.1;
    const isOnTop = Math.abs(objBottom - baseTop) < verticalTolerance;

    if (!isOnTop) return;

    // Check horizontal overlap - objects must overlap significantly to be considered stacked
    // Use larger threshold (0.9) to detect stacking when objects are mostly aligned
    const dx = obj.position.x - baseObject.position.x;
    const dz = obj.position.z - baseObject.position.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    const overlapThreshold = (baseRadius + objRadius) * 0.9;

    if (horizontalDist < overlapThreshold) {
      result.push(obj);
    }
  });

  return result;
}

// Recursively find all objects in the stack above the given object
// Returns array of all objects stacked on top, including objects on top of those, etc.
function findAllStackedAbove(baseObject, visited = new Set()) {
  if (!baseObject || visited.has(baseObject.userData.id)) return [];
  visited.add(baseObject.userData.id);

  const directlyOnTop = findObjectsOnTop(baseObject);
  const allAbove = [...directlyOnTop];

  // Recursively find objects on top of those
  directlyOnTop.forEach(obj => {
    const aboveThis = findAllStackedAbove(obj, visited);
    allAbove.push(...aboveThis);
  });

  return allAbove;
}

// Calculate total weight of all objects stacked on top of a given object
function calculateStackedWeight(baseObject) {
  const stackedObjects = findAllStackedAbove(baseObject);
  let totalWeight = 0;

  stackedObjects.forEach(obj => {
    const physics = getObjectPhysics(obj);
    totalWeight += physics.weight;
  });

  return totalWeight;
}

// Get the effective friction coefficient between two stacked objects
// Uses the minimum friction of the two surfaces in contact
function getStackingFriction(bottomObject, topObject) {
  const bottomPhysics = getObjectPhysics(bottomObject);
  const topPhysics = getObjectPhysics(topObject);

  // Friction is limited by the slipperier of the two surfaces
  // Multiply by the base stacking friction factor
  const surfaceFriction = Math.min(bottomPhysics.friction || 0.5, topPhysics.friction || 0.5);
  return surfaceFriction * physicsState.stackingFriction;
}

// Move objects that are stacked on top when the base object moves
// Uses friction physics to determine how much the stacked objects move with the base
function moveStackedObjects(baseObject, deltaX, deltaZ, dragSpeed) {
  const objectsOnTop = findObjectsOnTop(baseObject);
  if (objectsOnTop.length === 0) return;

  const basePhysics = getObjectPhysics(baseObject);

  objectsOnTop.forEach(topObj => {
    initPhysicsForObject(topObj);

    const friction = getStackingFriction(baseObject, topObj);
    const topPhysics = getObjectPhysics(topObj);

    // Calculate how much the top object moves with the base
    // Based on friction physics: F_friction = μ * m * g
    // Higher friction = object moves more with the base
    // Lower friction = object tends to stay in place (slides off)

    // At low speeds, friction keeps objects together
    // At high speeds, they start to slip
    const slipFactor = Math.min(1.0, dragSpeed / physicsState.stackingSlipThreshold);

    // Movement transfer: at low speeds, transfer based on friction
    // At high speeds, reduce transfer (objects slip)
    let movementTransfer = friction * (1.0 - slipFactor * 0.5);

    // Heavier objects on top resist movement more (inertia)
    // But friction also increases with weight, so net effect is smaller
    const weightRatio = topPhysics.weight / (basePhysics.weight + 0.1);
    movementTransfer *= Math.max(0.3, 1.0 - weightRatio * 0.3);

    // Move the top object
    const moveX = deltaX * movementTransfer;
    const moveZ = deltaZ * movementTransfer;

    // Apply movement directly for objects directly on top during drag
    topObj.position.x += moveX;
    topObj.position.z += moveZ;

    // Also give them a velocity in the same direction for smooth continuation
    const vel = physicsState.velocities.get(topObj.userData.id);
    if (vel) {
      vel.x += moveX * 0.3;
      vel.z += moveZ * 0.3;
    }

    // Update their Y position to stay stacked
    const baseTop = baseObject.position.y + basePhysics.height;
    const topBaseOffset = OBJECT_PHYSICS[topObj.userData.type]?.baseOffset || 0;
    const topScale = topObj.userData.scale || topObj.scale.x || 1.0;
    topObj.position.y = baseTop + topBaseOffset * topScale;
    topObj.userData.originalY = topObj.position.y;
    topObj.userData.targetY = topObj.position.y;

    // Recursively move objects stacked on top of this one
    moveStackedObjects(topObj, moveX, moveZ, dragSpeed * movementTransfer);
  });
}

// Check if an object has lost its support and should fall
// Called when an object is pulled from under another (isPullingOut mode)
// Returns true if the object has no support and should drop to desk level
function checkAndDropUnsupportedObjects(pulledObject) {
  const deskSurfaceY = getDeskSurfaceY();

  // Find all objects that might have been resting on the pulled object
  deskObjects.forEach(obj => {
    if (obj === pulledObject) return;
    if (obj.userData.isFallen) return;
    if (obj.userData.isLifted) return;
    if (obj.userData.isExamining || obj.userData.isReturning) return;

    const objPhysics = getObjectPhysics(obj);
    const objBottom = obj.position.y;

    // Skip objects that are already at desk level
    if (Math.abs(objBottom - deskSurfaceY) < 0.05) return;

    // Check if this object was on top of the pulled object (or would be now)
    // Use stacking radius for overlap detection
    const pulledRadius = getStackingRadius(pulledObject);
    const objRadius = getStackingRadius(obj);

    const dx = obj.position.x - pulledObject.position.x;
    const dz = obj.position.z - pulledObject.position.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);

    // Check if objects horizontally overlap (this object was likely on the pulled one)
    // and if the pulled object has moved enough to remove support
    const overlapThreshold = (pulledRadius + objRadius) * 0.5; // Objects no longer overlap

    if (horizontalDist > overlapThreshold) {
      // The pulled object has moved far enough - check if top object still has support
      const newSupportY = findSupportingY(obj, obj.position.x, obj.position.z);

      // If new support is lower than current position, drop to it
      if (newSupportY < objBottom - 0.02) {
        initPhysicsForObject(obj);

        // Set target Y to new support position
        const baseOffset = OBJECT_PHYSICS[obj.userData.type]?.baseOffset || 0;
        const scale = obj.userData.scale || obj.scale.x || 1.0;
        const newY = newSupportY + baseOffset * scale;

        obj.userData.originalY = newY;
        obj.userData.targetY = newY;

        // Give a small velocity for smooth falling animation
        const vel = physicsState.velocities.get(obj.userData.id);
        if (vel) {
          // Add slight random horizontal drift during fall
          vel.x += (Math.random() - 0.5) * 0.01;
          vel.z += (Math.random() - 0.5) * 0.01;
        }
      }
    }
  });
}

// Find the Y position of the nearest supporting surface below an object
// Used when an object loses its current support
function findSupportingY(object, x, z) {
  const deskSurfaceY = getDeskSurfaceY();
  let highestSupportY = deskSurfaceY;

  const objRadius = getStackingRadius(object);

  deskObjects.forEach(other => {
    if (other === object) return;
    if (other.userData.isFallen) return;
    if (other.userData.isLifted) return;

    const otherPhysics = getObjectPhysics(other);
    const otherRadius = getStackingRadius(other);
    const otherScale = other.userData.scale || other.scale.x || 1.0;
    const otherTop = other.position.y + otherPhysics.height * otherScale;

    // Check horizontal overlap
    const dx = x - other.position.x;
    const dz = z - other.position.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    const overlapThreshold = (objRadius + otherRadius) * 0.7;

    // Check if this object could support the falling one
    if (horizontalDist < overlapThreshold && otherTop > highestSupportY && otherTop < object.position.y) {
      highestSupportY = otherTop;
    }
  });

  return highestSupportY;
}

// Calculate the additional drag resistance from objects stacked on top
// Returns a resistance value (0 = no additional resistance, 1 = maximum resistance)
function calculateStackedResistance(baseObject) {
  const stackedWeight = calculateStackedWeight(baseObject);
  const basePhysics = getObjectPhysics(baseObject);

  // Resistance based on the ratio of stacked weight to base weight
  // More weight on top = harder to drag
  const weightRatio = stackedWeight / (basePhysics.weight + 0.1);

  // Apply a curve to make the effect more gradual
  // Light objects (like paper) on top add minimal resistance
  // Heavy objects (like books, laptop) add significant resistance
  const resistance = Math.min(0.8, weightRatio * 0.4);

  return resistance;
}

// Helper function to check collision between a point and an object's extra collision points
// Returns the collision info if collision detected, null otherwise
function checkExtraCollisionPoints(pointX, pointZ, pointRadius, pointY, targetObj) {
  const extraPoints = getExtraCollisionPoints(targetObj);
  if (extraPoints.length === 0) return null;

  for (const point of extraPoints) {
    // Apply rotation to transform local collision point to world space
    // Use the stored rotation from the point (which is the object's Y rotation)
    const rotation = point.rotation || 0;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);

    // Rotate the local x,z offset by the object's Y rotation
    const rotatedX = point.x * cosR - point.z * sinR;
    const rotatedZ = point.x * sinR + point.z * cosR;

    // Calculate world position of this collision point
    const collisionX = targetObj.position.x + rotatedX;
    const collisionZ = targetObj.position.z + rotatedZ;
    const collisionY = targetObj.position.y + point.baseY;

    // Check horizontal distance
    const dx = pointX - collisionX;
    const dz = pointZ - collisionZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const minDist = pointRadius + point.radius;

    // Check if collision occurs
    if (dist < minDist && dist > 0.01) {
      // Check vertical overlap - the extra collision point extends from baseY upward
      const pointBottom = pointY;
      const pointTop = pointY + 0.1; // Approximate height of dragged object check
      const collisionTop = collisionY + point.height;

      // Vertical overlap check
      if (pointBottom < collisionTop && pointTop > collisionY) {
        return {
          dx: dx,
          dz: dz,
          dist: dist,
          minDist: minDist,
          collisionX: collisionX,
          collisionZ: collisionZ
        };
      }
    }
  }
  return null;
}

// Lightweight drag collision check (runs every frame during drag for responsiveness)
function updateDragCollisions() {
  if (!isDragging || !selectedObject) return;

  const draggedRadius = getObjectBounds(selectedObject);
  const draggedPhysics = getObjectPhysics(selectedObject);

  deskObjects.forEach(obj => {
    if (obj === selectedObject) return;
    if (obj.userData.isExamining || obj.userData.isReturning) return;
    if (obj.userData.isFallen) return;

    initPhysicsForObject(obj);

    const otherRadius = getObjectBounds(obj);
    const otherPhysics = getObjectPhysics(obj);

    // Skip collision if objects don't overlap vertically (one is above the other)
    // This allows stacking objects on top of each other without pushing
    if (!objectsOverlapVertically(selectedObject, draggedPhysics, obj, otherPhysics)) {
      // Still check extra collision points (like laptop monitor) which have their own height
      const extraCollision = checkExtraCollisionPoints(
        selectedObject.position.x,
        selectedObject.position.z,
        draggedRadius,
        selectedObject.position.y,
        obj
      );
      if (!extraCollision) return;

      // Handle collision with extra collision point
      const { dx, dz, dist, minDist } = extraCollision;
      const normalX = -dx / dist;
      const normalZ = -dz / dist;

      const dragSpeed = Math.sqrt(
        physicsState.dragVelocity.x * physicsState.dragVelocity.x +
        physicsState.dragVelocity.z * physicsState.dragVelocity.z
      );

      const speedMultiplier = Math.max(0, Math.min(1, (dragSpeed - physicsState.minPushSpeed) / 0.1));
      const weightRatio = draggedPhysics.weight / otherPhysics.weight;
      const pushMultiplier = Math.min(weightRatio * 1.5, 3.0) * speedMultiplier;

      const pushX = normalX * physicsState.pushForce * pushMultiplier;
      const pushZ = normalZ * physicsState.pushForce * pushMultiplier;

      const vel = physicsState.velocities.get(obj.userData.id);
      vel.x += pushX;
      vel.z += pushZ;

      // Separate objects to prevent overlap
      const overlap = minDist - dist;
      obj.position.x += normalX * overlap * 0.5;
      obj.position.z += normalZ * overlap * 0.5;
      return;
    }

    const minDist = (draggedRadius + otherRadius) * 0.7;

    const dx = obj.position.x - selectedObject.position.x;
    const dz = obj.position.z - selectedObject.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < minDist && dist > 0.01) {
      // Collision detected! Push the other object
      const normalX = dx / dist;
      const normalZ = dz / dist;

      const dragSpeed = Math.sqrt(
        physicsState.dragVelocity.x * physicsState.dragVelocity.x +
        physicsState.dragVelocity.z * physicsState.dragVelocity.z
      );

      const speedMultiplier = Math.max(0, Math.min(1, (dragSpeed - physicsState.minPushSpeed) / 0.1));
      const weightRatio = draggedPhysics.weight / otherPhysics.weight;
      const pushMultiplier = Math.min(weightRatio * 1.5, 3.0) * speedMultiplier;

      const pushX = normalX * physicsState.pushForce * pushMultiplier;
      const pushZ = normalZ * physicsState.pushForce * pushMultiplier;

      const vel = physicsState.velocities.get(obj.userData.id);
      vel.x += pushX;
      vel.z += pushZ;

      // Separate objects to prevent overlap
      const overlap = minDist - dist;
      obj.position.x += normalX * overlap * 0.5;
      obj.position.z += normalZ * overlap * 0.5;
    }
  });
}

function updatePhysics() {
  if (!physicsState.enabled) return;

  // Performance optimization: throttle physics updates
  const now = Date.now();
  if (now - physicsState.lastPhysicsTime < physicsState.physicsInterval) {
    // Still update dragging collision detection at full rate for responsiveness
    if (isDragging && selectedObject) {
      updateDragCollisions();
    }
    return;
  }
  physicsState.lastPhysicsTime = now;

  const deskHalfWidth = CONFIG.desk.width / 2 - 0.2;
  const deskHalfDepth = CONFIG.desk.depth / 2 - 0.2;

  // Track if any physics is active this frame
  let hasActivePhysics = false;

  // Update velocities, positions, and tilting for all non-dragged objects
  deskObjects.forEach(obj => {
    // Skip if object is being dragged, examined, or is in examine mode
    if (obj === selectedObject && isDragging) return;
    if (obj.userData.isExamining || obj.userData.isReturning) return;
    if (examineState.active && examineState.object === obj) return;
    if (obj.userData.isFallen) return;  // Skip physics for fallen objects

    initPhysicsForObject(obj);

    const vel = physicsState.velocities.get(obj.userData.id);
    const angVel = physicsState.angularVelocities.get(obj.userData.id);
    const tilt = physicsState.tiltState.get(obj.userData.id);
    const tiltVel = physicsState.tiltVelocities.get(obj.userData.id);
    const physics = getObjectPhysics(obj);

    // Apply velocity
    if (Math.abs(vel.x) > 0.001 || Math.abs(vel.z) > 0.001) {
      // Store old position to calculate actual movement
      const oldX = obj.position.x;
      const oldZ = obj.position.z;

      obj.position.x += vel.x;
      obj.position.z += vel.z;

      // Apply friction
      vel.x *= physicsState.friction;
      vel.z *= physicsState.friction;

      // Clamp to desk bounds with bounce
      if (obj.position.x > deskHalfWidth) {
        obj.position.x = deskHalfWidth;
        vel.x = -vel.x * physicsState.bounceFactor;
      } else if (obj.position.x < -deskHalfWidth) {
        obj.position.x = -deskHalfWidth;
        vel.x = -vel.x * physicsState.bounceFactor;
      }

      if (obj.position.z > deskHalfDepth) {
        obj.position.z = deskHalfDepth;
        vel.z = -vel.z * physicsState.bounceFactor;
      } else if (obj.position.z < -deskHalfDepth) {
        obj.position.z = -deskHalfDepth;
        vel.z = -vel.z * physicsState.bounceFactor;
      }

      // Move objects stacked on top using friction physics
      // When an object moves due to being pushed, objects on top should also move
      const actualDeltaX = obj.position.x - oldX;
      const actualDeltaZ = obj.position.z - oldZ;
      const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      if (Math.abs(actualDeltaX) > 0.0001 || Math.abs(actualDeltaZ) > 0.0001) {
        moveStackedObjects(obj, actualDeltaX, actualDeltaZ, speed);
      }
    }

    // Apply angular velocity (rotation around Y axis)
    if (Math.abs(angVel) > 0.001) {
      obj.rotation.y += angVel;
      physicsState.angularVelocities.set(obj.userData.id, angVel * physicsState.friction);
    }

    // Apply tilt velocity and update tilt
    // Skip tilt for pens - they already lie flat and shouldn't tilt
    if (tilt && tiltVel && obj.userData.type !== 'pen') {
      // Apply tilt velocity
      tilt.x += tiltVel.x;
      tilt.z += tiltVel.z;

      // Apply friction to tilt velocity
      tiltVel.x *= 0.9;
      tiltVel.z *= 0.9;

      // Recovery force - objects try to return to upright based on stability
      const recoveryForce = physicsState.tiltRecovery * physics.stability;
      tiltVel.x -= tilt.x * recoveryForce;
      tiltVel.z -= tilt.z * recoveryForce;

      // Check if object has tipped over
      const totalTilt = Math.sqrt(tilt.x * tilt.x + tilt.z * tilt.z);
      if (totalTilt > physicsState.tipOverThreshold) {
        // Object tips over! Complete the fall
        obj.userData.isFallen = true;

        // Skip tip-over rotation for objects that already lie flat (like pens)
        // These objects have very low height and are already horizontal
        if (physics.height > 0.1) {
          // Animate falling to the side
          const fallDirection = { x: tilt.x / totalTilt, z: tilt.z / totalTilt };
          obj.rotation.x = fallDirection.z * Math.PI / 2;
          obj.rotation.z = -fallDirection.x * Math.PI / 2;

          // Adjust position to rest on the side
          const heightOffset = physics.height * 0.3;
          obj.position.y = getDeskSurfaceY() + heightOffset;
        } else {
          // For flat objects, just keep their current rotation
          // Position them slightly above desk (their radius)
          obj.position.y = getDeskSurfaceY() + 0.02;
        }

        // Clear physics state for this object
        physicsState.tiltState.set(obj.userData.id, { x: 0, z: 0 });
        physicsState.tiltVelocities.set(obj.userData.id, { x: 0, z: 0 });
      } else {
        // Clamp tilt to max
        if (Math.abs(tilt.x) > physicsState.maxTilt) {
          tilt.x = Math.sign(tilt.x) * physicsState.maxTilt;
        }
        if (Math.abs(tilt.z) > physicsState.maxTilt) {
          tilt.z = Math.sign(tilt.z) * physicsState.maxTilt;
        }

        // Apply tilt to object rotation (add to existing rotation)
        // Store original rotations if not stored
        if (obj.userData.baseTiltX === undefined) {
          obj.userData.baseTiltX = obj.rotation.x;
          obj.userData.baseTiltZ = obj.rotation.z;
        }
        obj.rotation.x = obj.userData.baseTiltX + tilt.z;
        obj.rotation.z = obj.userData.baseTiltZ - tilt.x;
      }
    }
  });

  // Check collisions between dragged object and other objects
  if (isDragging && selectedObject) {
    const draggedRadius = getObjectBounds(selectedObject);
    const draggedPhysics = getObjectPhysics(selectedObject);

    deskObjects.forEach(obj => {
      if (obj === selectedObject) return;
      if (obj.userData.isExamining || obj.userData.isReturning) return;
      if (obj.userData.isFallen) return;

      initPhysicsForObject(obj);

      const otherRadius = getObjectBounds(obj);
      const otherPhysics = getObjectPhysics(obj);

      // Skip collision if objects don't overlap vertically (one is above the other)
      if (!objectsOverlapVertically(selectedObject, draggedPhysics, obj, otherPhysics)) {
        return;
      }

      const minDist = (draggedRadius + otherRadius) * 0.7;

      const dx = obj.position.x - selectedObject.position.x;
      const dz = obj.position.z - selectedObject.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < minDist && dist > 0.01) {
        // Collision detected! Push and tilt the other object
        const normalX = dx / dist;
        const normalZ = dz / dist;

        // Calculate drag speed for force scaling
        const dragSpeed = Math.sqrt(
          physicsState.dragVelocity.x * physicsState.dragVelocity.x +
          physicsState.dragVelocity.z * physicsState.dragVelocity.z
        );

        // Scale force by drag speed (slow = less force, fast = more force)
        // Minimum threshold to prevent tiny movements from causing big reactions
        const speedMultiplier = Math.max(0, Math.min(1, (dragSpeed - physicsState.minPushSpeed) / 0.1));

        // Calculate push force based on weight difference and speed
        const weightRatio = draggedPhysics.weight / otherPhysics.weight;
        const pushMultiplier = Math.min(weightRatio * 1.5, 3.0) * speedMultiplier;

        const pushX = normalX * physicsState.pushForce * pushMultiplier;
        const pushZ = normalZ * physicsState.pushForce * pushMultiplier;

        const vel = physicsState.velocities.get(obj.userData.id);
        vel.x += pushX;
        vel.z += pushZ;

        // Add tilt based on collision (only if moving fast enough)
        // Higher stability means harder to tip
        const tiltVel = physicsState.tiltVelocities.get(obj.userData.id);
        const tiltAmount = physicsState.tiltForce * (1 - otherPhysics.stability) * pushMultiplier * speedMultiplier;
        tiltVel.x += normalX * tiltAmount;
        tiltVel.z += normalZ * tiltAmount;

        // Add some spin based on collision angle (also scaled by speed)
        const crossProduct = dx * pushZ - dz * pushX;
        const angVel = physicsState.angularVelocities.get(obj.userData.id);
        physicsState.angularVelocities.set(obj.userData.id, angVel + crossProduct * 0.3 * speedMultiplier);

        // Separate objects to prevent overlap
        const overlap = minDist - dist;
        obj.position.x += normalX * overlap * 0.5;
        obj.position.z += normalZ * overlap * 0.5;
      }
    });
  }

  // Check collisions from rotating objects (when an object is being scrolled to rotate)
  deskObjects.forEach(rotatingObj => {
    if (rotatingObj.userData.isExamining || rotatingObj.userData.isReturning) return;
    if (rotatingObj.userData.isFallen) return;

    const rotAngVel = physicsState.angularVelocities.get(rotatingObj.userData.id);
    if (!rotAngVel || Math.abs(rotAngVel) < 0.01) return;

    const rotRadius = getObjectBounds(rotatingObj);
    const rotPhysics = getObjectPhysics(rotatingObj);

    deskObjects.forEach(obj => {
      if (obj === rotatingObj) return;
      if (obj === selectedObject && isDragging) return;
      if (obj.userData.isExamining || obj.userData.isReturning) return;
      if (obj.userData.isFallen) return;

      initPhysicsForObject(obj);

      const otherRadius = getObjectBounds(obj);
      const otherPhysics = getObjectPhysics(obj);

      // Skip collision if objects don't overlap vertically (one is above the other)
      if (!objectsOverlapVertically(rotatingObj, rotPhysics, obj, otherPhysics)) {
        return;
      }

      const minDist = (rotRadius + otherRadius) * 0.8;

      const dx = obj.position.x - rotatingObj.position.x;
      const dz = obj.position.z - rotatingObj.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < minDist && dist > 0.01) {
        // Rotating object hitting another object
        const normalX = dx / dist;
        const normalZ = dz / dist;

        // Calculate tangent force from rotation
        const tangentX = -normalZ * Math.sign(rotAngVel);
        const tangentZ = normalX * Math.sign(rotAngVel);

        const rotSpeed = Math.abs(rotAngVel) * rotRadius;
        const forceMultiplier = rotPhysics.weight / otherPhysics.weight;

        const vel = physicsState.velocities.get(obj.userData.id);
        vel.x += (normalX * 0.5 + tangentX * 0.5) * rotSpeed * forceMultiplier * 0.5;
        vel.z += (normalZ * 0.5 + tangentZ * 0.5) * rotSpeed * forceMultiplier * 0.5;

        // Add tilt from rotating collision
        const tiltVel = physicsState.tiltVelocities.get(obj.userData.id);
        const tiltAmount = physicsState.tiltForce * (1 - otherPhysics.stability) * rotSpeed * forceMultiplier;
        tiltVel.x += normalX * tiltAmount * 0.5;
        tiltVel.z += normalZ * tiltAmount * 0.5;
      }
    });
  });

  // Check collisions between all pairs of non-dragged moving objects
  for (let i = 0; i < deskObjects.length; i++) {
    const objA = deskObjects[i];
    if (objA === selectedObject && isDragging) continue;
    if (objA.userData.isExamining || objA.userData.isReturning) continue;
    if (objA.userData.isFallen) continue;

    const radiusA = getObjectBounds(objA);
    const physicsA = getObjectPhysics(objA);
    const velA = physicsState.velocities.get(objA.userData.id);
    if (!velA) continue;

    for (let j = i + 1; j < deskObjects.length; j++) {
      const objB = deskObjects[j];
      if (objB === selectedObject && isDragging) continue;
      if (objB.userData.isExamining || objB.userData.isReturning) continue;
      if (objB.userData.isFallen) continue;

      const radiusB = getObjectBounds(objB);
      const physicsB = getObjectPhysics(objB);
      const velB = physicsState.velocities.get(objB.userData.id);
      if (!velB) continue;

      // Skip collision if objects don't overlap vertically (one is above the other)
      if (!objectsOverlapVertically(objA, physicsA, objB, physicsB)) {
        continue;
      }

      const minDist = (radiusA + radiusB) * 0.7;

      const dx = objB.position.x - objA.position.x;
      const dz = objB.position.z - objA.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < minDist && dist > 0.01) {
        // Elastic collision between two objects
        const nx = dx / dist;
        const nz = dz / dist;

        // Relative velocity
        const dvx = velA.x - velB.x;
        const dvz = velA.z - velB.z;

        // Relative velocity along collision normal
        const dvn = dvx * nx + dvz * nz;

        // Only resolve if objects are moving towards each other
        if (dvn > 0) {
          // Weighted elastic collision based on object weights
          const totalWeight = physicsA.weight + physicsB.weight;
          const weightA = physicsA.weight / totalWeight;
          const weightB = physicsB.weight / totalWeight;

          velA.x -= dvn * nx * weightB;
          velA.z -= dvn * nz * weightB;
          velB.x += dvn * nx * weightA;
          velB.z += dvn * nz * weightA;

          // Add tilt from collision
          const impactSpeed = Math.sqrt(dvx * dvx + dvz * dvz);
          const tiltVelA = physicsState.tiltVelocities.get(objA.userData.id);
          const tiltVelB = physicsState.tiltVelocities.get(objB.userData.id);

          if (tiltVelA) {
            const tiltAmountA = impactSpeed * physicsState.tiltForce * (1 - physicsA.stability) * weightB;
            tiltVelA.x -= nx * tiltAmountA;
            tiltVelA.z -= nz * tiltAmountA;
          }
          if (tiltVelB) {
            const tiltAmountB = impactSpeed * physicsState.tiltForce * (1 - physicsB.stability) * weightA;
            tiltVelB.x += nx * tiltAmountB;
            tiltVelB.z += nz * tiltAmountB;
          }
        }

        // Separate objects
        const overlap = minDist - dist;
        objA.position.x -= (nx * overlap * 0.25);
        objA.position.z -= (nz * overlap * 0.25);
        objB.position.x += (nx * overlap * 0.25);
        objB.position.z += (nz * overlap * 0.25);
      }
    }
  }
}

// ============================================================================
// CLOCK UPDATE
// ============================================================================
function updateClock() {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');

  document.getElementById('clock-display').textContent = `${hours}:${minutes}:${seconds}`;

  // Check if alarm should trigger
  if (timerState.alarmEnabled && !timerState.alarmTriggered && !timerState.isAlerting) {
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();

    if (currentHours === timerState.alarmHours && currentMinutes === timerState.alarmMinutes) {
      // Trigger the alarm
      timerState.alarmTriggered = true;
      playTimerAlert();
    }
  }

  // Reset alarm triggered flag when time changes past the alarm minute
  if (timerState.alarmTriggered) {
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    if (currentHours !== timerState.alarmHours || currentMinutes !== timerState.alarmMinutes) {
      timerState.alarmTriggered = false;
    }
  }

  // Update 3D clock objects
  deskObjects.forEach(obj => {
    if (obj.userData.type === 'clock') {
      const hourHand = obj.getObjectByName('hourHand');
      const minuteHand = obj.getObjectByName('minuteHand');
      const secondHand = obj.getObjectByName('secondHand');

      // Calculate angles for real time display
      // Hands rotate clockwise, so we use negative angles
      // 12 o'clock is at the top (positive Y), which is 0 radians for our setup

      if (hourHand) {
        // Hour hand: full rotation every 12 hours, plus gradual movement based on minutes
        const hourAngle = -((now.getHours() % 12) / 12) * Math.PI * 2 - (now.getMinutes() / 60) * (Math.PI / 6);
        hourHand.rotation.z = hourAngle;
      }

      if (minuteHand) {
        // Minute hand: full rotation every 60 minutes, plus gradual movement based on seconds
        const minuteAngle = -(now.getMinutes() / 60) * Math.PI * 2 - (now.getSeconds() / 60) * (Math.PI / 30);
        minuteHand.rotation.z = minuteAngle;
      }

      if (secondHand) {
        // Second hand: full rotation every 60 seconds
        const secondAngle = -(now.getSeconds() / 60) * Math.PI * 2;
        secondHand.rotation.z = secondAngle;
      }
    }
  });
}

// ============================================================================
// PALETTE SYSTEM - Photoshop-style tool palette
// ============================================================================
function initializePalette() {
  const paletteContainer = document.getElementById('palette-container');
  if (!paletteContainer) return;

  // Generate palette HTML
  paletteContainer.innerHTML = '';

  for (const [categoryId, category] of Object.entries(PALETTE_CATEGORIES)) {
    const activeVariant = category.variants[category.activeIndex];

    const categoryEl = document.createElement('div');
    categoryEl.className = 'palette-category';
    categoryEl.dataset.category = categoryId;

    categoryEl.innerHTML = `
      <div class="palette-header" data-category="${categoryId}" draggable="true">
        <span class="category-icon">${category.icon}</span>
        <span class="category-name">${category.name}</span>
        <span class="active-variant">${activeVariant.icon}</span>
        ${category.variants.length > 1 ? '<span class="variant-hint">RMB or Scroll to change</span>' : ''}
      </div>
    `;

    paletteContainer.appendChild(categoryEl);
  }

  // Add event listeners to palette headers
  document.querySelectorAll('.palette-header').forEach(header => {
    const categoryId = header.dataset.category;
    const category = PALETTE_CATEGORIES[categoryId];

    // Click (LMB) to add the active variant to desk
    header.addEventListener('click', (e) => {
      if (e.button !== 0) return; // Only left click
      const activeVariant = category.variants[category.activeIndex];
      addObjectToDesk(activeVariant.id);
      document.getElementById('menu').classList.remove('open');
    });

    // Drag and drop support
    header.addEventListener('dragstart', (e) => {
      const activeVariant = category.variants[category.activeIndex];
      draggedPresetType = activeVariant.id;

      // Create custom drag preview
      dragPreviewElement = document.createElement('div');
      dragPreviewElement.className = 'drag-preview';
      dragPreviewElement.innerHTML = `<span class="icon">${activeVariant.icon}</span><span class="name">${activeVariant.name}</span>`;
      document.body.appendChild(dragPreviewElement);

      // Position off-screen initially (will be updated in dragover)
      dragPreviewElement.style.left = '-1000px';
      dragPreviewElement.style.top = '-1000px';

      // Set transparent drag image
      const emptyImg = new Image();
      emptyImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(emptyImg, 0, 0);
      e.dataTransfer.effectAllowed = 'copy';

      // Close the menu during drag
      document.getElementById('menu').classList.remove('open');
    });

    header.addEventListener('dragend', () => {
      // Clean up drag preview
      if (dragPreviewElement) {
        dragPreviewElement.remove();
        dragPreviewElement = null;
      }
      draggedPresetType = null;
    });

    // RMB (Right Mouse Button) to open variant selector
    header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (category.variants.length <= 1) return; // No variants to choose

      openVariantContextMenu(categoryId, e.clientX, e.clientY);
    });

    // Mouse wheel to cycle through variants
    header.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (category.variants.length <= 1) return; // No variants to cycle

      // Scroll down = next, scroll up = previous
      const direction = e.deltaY > 0 ? 1 : -1;
      cycleVariant(categoryId, direction);
    });

    // Track hover for wheel cycling
    header.addEventListener('mouseenter', () => {
      paletteState.hoveredCategory = categoryId;
    });

    header.addEventListener('mouseleave', () => {
      paletteState.hoveredCategory = null;
    });
  });

  // Close context menu on click outside
  document.addEventListener('click', (e) => {
    const contextMenu = document.getElementById('variant-context-menu');
    if (contextMenu && contextMenu.classList.contains('open')) {
      if (!contextMenu.contains(e.target)) {
        closeVariantContextMenu();
      }
    }
  });

  // Also close on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeVariantContextMenu();
    }
  });
}

function openVariantContextMenu(categoryId, x, y) {
  const contextMenu = document.getElementById('variant-context-menu');
  const itemsContainer = document.getElementById('variant-context-items');
  const category = PALETTE_CATEGORIES[categoryId];

  if (!contextMenu || !itemsContainer || !category) return;

  paletteState.contextMenuCategory = categoryId;

  // Populate menu items
  itemsContainer.innerHTML = '';
  category.variants.forEach((variant, index) => {
    const item = document.createElement('div');
    item.className = 'context-item' + (index === category.activeIndex ? ' active' : '');
    item.innerHTML = `
      <span class="context-icon">${variant.icon}</span>
      <span class="context-name">${variant.name}</span>
    `;

    item.addEventListener('click', () => {
      selectVariant(categoryId, index);
      closeVariantContextMenu();
    });

    itemsContainer.appendChild(item);
  });

  // Position menu
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';

  // Make sure menu doesn't go off screen
  contextMenu.classList.add('open');
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = (window.innerWidth - rect.width - 10) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = (window.innerHeight - rect.height - 10) + 'px';
  }
}

function closeVariantContextMenu() {
  const contextMenu = document.getElementById('variant-context-menu');
  if (contextMenu) {
    contextMenu.classList.remove('open');
  }
  paletteState.contextMenuCategory = null;
}

function selectVariant(categoryId, index) {
  const category = PALETTE_CATEGORIES[categoryId];
  if (!category) return;

  category.activeIndex = index;
  updatePaletteUI(categoryId);
}

function cycleVariant(categoryId, direction) {
  const category = PALETTE_CATEGORIES[categoryId];
  if (!category) return;

  const numVariants = category.variants.length;
  category.activeIndex = (category.activeIndex + direction + numVariants) % numVariants;
  updatePaletteUI(categoryId);
}

function updatePaletteUI(categoryId) {
  const category = PALETTE_CATEGORIES[categoryId];
  if (!category) return;

  const activeVariant = category.variants[category.activeIndex];

  // Update the header's active variant icon
  const header = document.querySelector(`.palette-header[data-category="${categoryId}"]`);
  if (header) {
    const activeIcon = header.querySelector('.active-variant');
    if (activeIcon) {
      activeIcon.textContent = activeVariant.icon;
    }
  }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================
function setupEventListeners() {
  const container = document.getElementById('canvas-container');

  // Mouse events
  container.addEventListener('mousedown', onMouseDown, false);
  container.addEventListener('mousemove', onMouseMove, false);
  container.addEventListener('mouseup', onMouseUp, false);
  container.addEventListener('contextmenu', onRightClick, false);
  // Double-click examine removed - use drag+scroll instead
  container.addEventListener('wheel', onMouseWheel, { passive: false });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    // Alt+I toggles the left sidebar (menu)
    if (e.altKey && (e.key === 'i' || e.key === 'I' || e.key === 'ш' || e.key === 'Ш')) {
      e.preventDefault();
      const menu = document.getElementById('menu');
      menu.classList.toggle('open');
      // Exit pointer lock when opening menu so cursor is visible
      if (menu.classList.contains('open') && document.pointerLockElement) {
        document.exitPointerLock();
      }
    }

    // Arrow keys for player mode - button navigation with camera centering
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.ctrlKey) {
      if (playerModeState.active && playerModeState.player) {
        e.preventDefault();
        navigatePlayerButtons(e.key === 'ArrowRight' ? 1 : -1);
        return;
      }
    }

    // Arrow keys for book - page navigation in reading mode, or when aimed at book
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey && !e.ctrlKey) {
      // In inspection+drawing mode, arrow keys pan the view
      if (inspectionDrawingState.active && inspectionDrawingState.objectWorldPos) {
        e.preventDefault();
        const objectWorldPos = inspectionDrawingState.objectWorldPos;
        const moveSpeed = 0.1;
        if (e.key === 'ArrowLeft') inspectionDrawingState.panOffsetX -= moveSpeed;
        if (e.key === 'ArrowRight') inspectionDrawingState.panOffsetX += moveSpeed;
        if (e.key === 'ArrowUp') inspectionDrawingState.panOffsetZ -= moveSpeed;
        if (e.key === 'ArrowDown') inspectionDrawingState.panOffsetZ += moveSpeed;

        // Clamp pan offsets to reasonable limits
        inspectionDrawingState.panOffsetX = Math.max(-1.5, Math.min(1.5, inspectionDrawingState.panOffsetX));
        inspectionDrawingState.panOffsetZ = Math.max(-1.5, Math.min(1.5, inspectionDrawingState.panOffsetZ));

        // Update camera position
        camera.position.set(
          objectWorldPos.x + inspectionDrawingState.panOffsetX,
          objectWorldPos.y + inspectionDrawingState.zoomDistance,
          objectWorldPos.z + 0.65 + inspectionDrawingState.panOffsetZ
        );
        return;
      }

      // In reading mode, ArrowLeft/Right turn pages, ArrowUp/Down pan vertically
      if (bookReadingState.active && bookReadingState.book) {
        e.preventDefault();
        const book = bookReadingState.book;

        // Arrow Left/Right for page turning in reading mode
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const totalPages = book.userData.totalPages || 10;
          if (e.key === 'ArrowLeft' && book.userData.currentPage > 0) {
            // Use correct page turn function based on type
            if (book.userData.type === 'magazine') {
              animateMagazinePageTurn(book, -1);
            } else {
              animatePageTurn(book, -1);
            }
          } else if (e.key === 'ArrowRight' && book.userData.currentPage < totalPages - 1) {
            if (!book.userData.totalPages) book.userData.totalPages = 10;
            // Use correct page turn function based on type
            if (book.userData.type === 'magazine') {
              animateMagazinePageTurn(book, 1);
            } else {
              animatePageTurn(book, 1);
            }
          }
          return;
        }

        // Arrow Up/Down for vertical panning in reading mode
        // Use cached book position if available, otherwise skip
        if (!bookReadingState.bookWorldPos) return;
        const bookWorldPos = bookReadingState.bookWorldPos;
        const moveSpeed = 0.1;
        if (e.key === 'ArrowUp') bookReadingState.panOffsetZ -= moveSpeed;
        if (e.key === 'ArrowDown') bookReadingState.panOffsetZ += moveSpeed;

        // Clamp pan offsets to reasonable limits
        bookReadingState.panOffsetZ = Math.max(-1.5, Math.min(1.5, bookReadingState.panOffsetZ));

        // Update camera position
        camera.position.set(
          bookWorldPos.x + bookReadingState.panOffsetX,
          bookWorldPos.y + bookReadingState.zoomDistance,
          bookWorldPos.z + 0.65 + bookReadingState.panOffsetZ
        );
        return;
      }

      // Page navigation (only ArrowLeft/ArrowRight, not in reading mode)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Check if we're examining a book/magazine or have a book/magazine modal open
        let bookObject = null;
        if (examineState.active && examineState.object &&
            (examineState.object.userData.type === 'books' || examineState.object.userData.type === 'magazine')) {
          bookObject = examineState.object;
        } else if (interactionObject &&
            (interactionObject.userData.type === 'books' || interactionObject.userData.type === 'magazine')) {
          bookObject = interactionObject;
        } else {
          // Also check if crosshair is aimed at a book/magazine (raycast from center of screen)
          const centerMouse = new THREE.Vector2(0, 0);
          raycaster.setFromCamera(centerMouse, camera);
          const intersects = raycaster.intersectObjects(deskObjects, true);
          for (const hit of intersects) {
            const obj = getParentDeskObject(hit.object);
            if (obj && (obj.userData.type === 'books' || obj.userData.type === 'magazine') && obj.userData.isOpen) {
              bookObject = obj;
              break;
            }
          }
        }

        if (bookObject && bookObject.userData.isOpen) {
          e.preventDefault();
          // If no PDF is loaded, use a default number of pages for the animation
          const totalPages = bookObject.userData.totalPages || 10;
          if (e.key === 'ArrowLeft' && bookObject.userData.currentPage > 0) {
            // Previous page with animation
            if (bookObject.userData.type === 'magazine') {
              animateMagazinePageTurn(bookObject, -1);
            } else {
              animatePageTurn(bookObject, -1);
            }
          } else if (e.key === 'ArrowRight' && bookObject.userData.currentPage < totalPages - 1) {
            // Next page with animation
            // Ensure totalPages is set for the animation
            if (!bookObject.userData.totalPages) bookObject.userData.totalPages = 10;
            if (bookObject.userData.type === 'magazine') {
              animateMagazinePageTurn(bookObject, 1);
            } else {
              animatePageTurn(bookObject, 1);
            }
          }
        }
      }
    }

    // WASD movement controls
    const wasdKey = e.code;
    if (wasdKey === 'KeyW' || wasdKey === 'KeyA' || wasdKey === 'KeyS' || wasdKey === 'KeyD') {
      // Don't process if typing in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // In inspection+drawing mode, WASD is used for panning the view
      if (inspectionDrawingState.active && inspectionDrawingState.objectWorldPos) {
        e.preventDefault();
        const panSpeed = 0.1;
        const objectWorldPos = inspectionDrawingState.objectWorldPos;

        // W/S for forward/backward panning, A/D for left/right panning
        if (wasdKey === 'KeyW') inspectionDrawingState.panOffsetZ -= panSpeed;
        if (wasdKey === 'KeyS') inspectionDrawingState.panOffsetZ += panSpeed;
        if (wasdKey === 'KeyA') inspectionDrawingState.panOffsetX -= panSpeed;
        if (wasdKey === 'KeyD') inspectionDrawingState.panOffsetX += panSpeed;

        // Clamp pan offsets to reasonable limits
        inspectionDrawingState.panOffsetX = Math.max(-1.5, Math.min(1.5, inspectionDrawingState.panOffsetX));
        inspectionDrawingState.panOffsetZ = Math.max(-1.5, Math.min(1.5, inspectionDrawingState.panOffsetZ));

        // Update camera position
        camera.position.set(
          objectWorldPos.x + inspectionDrawingState.panOffsetX,
          objectWorldPos.y + inspectionDrawingState.zoomDistance,
          objectWorldPos.z + 0.65 + inspectionDrawingState.panOffsetZ
        );
        return;
      }

      // In reading mode, WASD is used for panning the view
      if (bookReadingState.active && bookReadingState.book && bookReadingState.bookWorldPos) {
        e.preventDefault();
        const panSpeed = 0.1;
        // Use cached book position to avoid recalculating on every keypress
        const bookWorldPos = bookReadingState.bookWorldPos;

        // W/S for forward/backward panning, A/D for left/right panning
        if (wasdKey === 'KeyW') bookReadingState.panOffsetZ -= panSpeed;
        if (wasdKey === 'KeyS') bookReadingState.panOffsetZ += panSpeed;
        if (wasdKey === 'KeyA') bookReadingState.panOffsetX -= panSpeed;
        if (wasdKey === 'KeyD') bookReadingState.panOffsetX += panSpeed;

        // Clamp pan offsets to reasonable limits
        bookReadingState.panOffsetX = Math.max(-1.5, Math.min(1.5, bookReadingState.panOffsetX));
        bookReadingState.panOffsetZ = Math.max(-1.5, Math.min(1.5, bookReadingState.panOffsetZ));

        // Update camera position
        camera.position.set(
          bookWorldPos.x + bookReadingState.panOffsetX,
          bookWorldPos.y + bookReadingState.zoomDistance,
          bookWorldPos.z + 0.65 + bookReadingState.panOffsetZ
        );
        return;
      }

      // In player mode, WASD is used for panning the view
      if (playerModeState.active && playerModeState.player && playerModeState.playerWorldPos) {
        e.preventDefault();

        // Reset button navigation when using WASD for manual panning
        if (playerModeState.currentButtonIndex !== -1) {
          playerModeState.currentButtonIndex = -1;
        }

        const panSpeed = 0.03; // Smaller pan speed for player (it's smaller object)
        // Use cached player position to avoid recalculating on every keypress
        const playerWorldPos = playerModeState.playerWorldPos;
        const viewDistance = playerModeState.zoomDistance;

        // W/S for up/down panning, A/D for left/right panning
        if (wasdKey === 'KeyW') playerModeState.panOffsetY += panSpeed;
        if (wasdKey === 'KeyS') playerModeState.panOffsetY -= panSpeed;
        if (wasdKey === 'KeyA') playerModeState.panOffsetX -= panSpeed;
        if (wasdKey === 'KeyD') playerModeState.panOffsetX += panSpeed;

        // Clamp pan offsets - X is limited, Y allows going above the player
        playerModeState.panOffsetX = Math.max(-0.5, Math.min(0.5, playerModeState.panOffsetX));
        // Y offset has higher upper limit to allow viewing from above
        playerModeState.panOffsetY = Math.max(-0.3, Math.min(1.0, playerModeState.panOffsetY));

        // Update camera position - pan left/right and up/down
        camera.position.set(
          playerWorldPos.x + playerModeState.panOffsetX,
          playerWorldPos.y + playerModeState.panOffsetY, // Move up/down with W/S
          playerWorldPos.z + viewDistance
        );

        // Update camera pitch to look straight at the player (level view)
        cameraLookState.pitch = 0; // Level with the player
        updateCameraLook();

        return;
      }

      const moveSpeed = 0.1;

      // Normal mode and inspection mode - camera movement
      if (!examineState.active || (examineState.active && examineState.object)) {
        e.preventDefault();
        const cameraMoveSpeed = 0.15;

        // Get camera direction for forward/back movement
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);
        direction.y = 0; // Keep movement on horizontal plane
        direction.normalize();

        // Get right vector for strafe movement
        const right = new THREE.Vector3();
        right.crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();

        if (wasdKey === 'KeyW') {
          camera.position.addScaledVector(direction, cameraMoveSpeed);
        }
        if (wasdKey === 'KeyS') {
          camera.position.addScaledVector(direction, -cameraMoveSpeed);
        }
        if (wasdKey === 'KeyA') {
          camera.position.addScaledVector(right, -cameraMoveSpeed);
        }
        if (wasdKey === 'KeyD') {
          camera.position.addScaledVector(right, cameraMoveSpeed);
        }

        // Optional: clamp camera position to reasonable bounds
        camera.position.x = Math.max(-8, Math.min(8, camera.position.x));
        camera.position.z = Math.max(-5, Math.min(12, camera.position.z));
        camera.position.y = Math.max(1, Math.min(8, camera.position.y));
      }
    }
  });

  // Window resize
  window.addEventListener('resize', onWindowResize, false);

  // Menu toggle
  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('menu').classList.toggle('open');
  });

  // Initialize palette system (Photoshop-style with categories and variants)
  initializePalette();

  // Drop zone (canvas container)
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    // Update drag preview position
    if (dragPreviewElement) {
      dragPreviewElement.style.left = (e.clientX + 15) + 'px';
      dragPreviewElement.style.top = (e.clientY + 15) + 'px';
    }
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();

    if (draggedPresetType) {
      // Calculate drop position on desk
      const rect = renderer.domElement.getBoundingClientRect();
      const dropMouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      raycaster.setFromCamera(dropMouse, camera);
      const intersects = raycaster.intersectObject(dragPlane);

      if (intersects.length > 0) {
        const point = intersects[0].point;

        // Clamp to desk bounds
        const halfWidth = CONFIG.desk.width / 2 - 0.3;
        const halfDepth = CONFIG.desk.depth / 2 - 0.3;

        const x = Math.max(-halfWidth, Math.min(halfWidth, point.x));
        const z = Math.max(-halfDepth, Math.min(halfDepth, point.z));

        addObjectToDesk(draggedPresetType, { x, z });
      } else {
        // If no intersection with desk, add at random position
        addObjectToDesk(draggedPresetType);
      }

      // Clean up
      if (dragPreviewElement) {
        dragPreviewElement.remove();
        dragPreviewElement = null;
      }
      draggedPresetType = null;
    }
  });

  // Delete button
  document.getElementById('delete-object').addEventListener('click', () => {
    if (selectedObject) {
      removeObject(selectedObject);
      selectedObject = null;
      document.getElementById('customization-panel').classList.remove('open');
    }
  });

  // Clear desk button - removes all objects from desk
  document.getElementById('clear-desk-btn').addEventListener('click', () => {
    if (confirm('Are you sure you want to remove all objects from the desk?')) {
      clearAllObjects();
      document.getElementById('menu').classList.remove('open');
    }
  });

  // Debug collision visualization toggle
  const toggleCollisionBtn = document.getElementById('toggle-collision-debug-btn');
  if (toggleCollisionBtn) {
    toggleCollisionBtn.addEventListener('click', () => {
      toggleCollisionDebug();
    });
  }

  // Debug camera ray visualization toggle
  const toggleCameraRayBtn = document.getElementById('toggle-camera-ray-btn');
  if (toggleCameraRayBtn) {
    toggleCameraRayBtn.addEventListener('click', () => {
      toggleCameraRayDebug();
    });
  }

  // Collision radius slider
  const collisionRadiusSlider = document.getElementById('collision-radius-slider');
  const collisionRadiusValue = document.getElementById('collision-radius-value');
  if (collisionRadiusSlider && collisionRadiusValue) {
    // Load saved value from localStorage
    const savedMultiplier = localStorage.getItem('collisionRadiusMultiplier');
    if (savedMultiplier !== null) {
      collisionRadiusMultiplier = parseFloat(savedMultiplier);
      collisionRadiusSlider.value = collisionRadiusMultiplier * 100;
      collisionRadiusValue.textContent = Math.round(collisionRadiusMultiplier * 100) + '%';
    }

    collisionRadiusSlider.addEventListener('input', (e) => {
      const percentage = parseInt(e.target.value);
      collisionRadiusMultiplier = percentage / 100;
      collisionRadiusValue.textContent = percentage + '%';

      // Save to localStorage
      localStorage.setItem('collisionRadiusMultiplier', collisionRadiusMultiplier.toString());

      // Update collision debug visualization if enabled
      if (debugState.showCollisionRadii) {
        updateCollisionDebugHelpers();
      }
    });
  }

  // Collision height slider
  const collisionHeightSlider = document.getElementById('collision-height-slider');
  const collisionHeightValue = document.getElementById('collision-height-value');
  if (collisionHeightSlider && collisionHeightValue) {
    // Load saved value from localStorage
    const savedMultiplier = localStorage.getItem('collisionHeightMultiplier');
    if (savedMultiplier !== null) {
      collisionHeightMultiplier = parseFloat(savedMultiplier);
      collisionHeightSlider.value = collisionHeightMultiplier * 100;
      collisionHeightValue.textContent = Math.round(collisionHeightMultiplier * 100) + '%';
    }

    collisionHeightSlider.addEventListener('input', (e) => {
      const percentage = parseInt(e.target.value);
      collisionHeightMultiplier = percentage / 100;
      collisionHeightValue.textContent = percentage + '%';

      // Save to localStorage
      localStorage.setItem('collisionHeightMultiplier', collisionHeightMultiplier.toString());

      // Update collision debug visualization if enabled
      if (debugState.showCollisionRadii) {
        updateCollisionDebugHelpers();
      }
    });
  }

  // Per-object collision settings accordion (in customization panel)
  const collisionAccordionToggle = document.getElementById('collision-accordion-toggle');
  const collisionAccordionContent = document.getElementById('collision-accordion-content');
  if (collisionAccordionToggle && collisionAccordionContent) {
    collisionAccordionToggle.addEventListener('click', () => {
      collisionAccordionToggle.classList.toggle('open');
      collisionAccordionContent.classList.toggle('open');
    });
  }

  // Per-object collision radius slider
  const objectCollisionRadiusSlider = document.getElementById('object-collision-radius-slider');
  const objectCollisionRadiusValue = document.getElementById('object-collision-radius-value');
  if (objectCollisionRadiusSlider && objectCollisionRadiusValue) {
    objectCollisionRadiusSlider.addEventListener('input', (e) => {
      if (!selectedObject) return;
      const percentage = parseInt(e.target.value);
      selectedObject.userData.objectCollisionRadiusMultiplier = percentage / 100;
      objectCollisionRadiusValue.textContent = percentage + '%';
      saveState();
      // Update collision debug visualization if enabled
      if (debugState.showCollisionRadii) {
        updateCollisionDebugHelpers();
      }
    });
    // Add scroll-based adjustment
    addScrollToSlider(objectCollisionRadiusSlider, (value) => {
      if (!selectedObject) return;
      selectedObject.userData.objectCollisionRadiusMultiplier = value / 100;
      objectCollisionRadiusValue.textContent = value + '%';
      saveState();
      if (debugState.showCollisionRadii) {
        updateCollisionDebugHelpers();
      }
    });
  }

  // Per-object collision height slider
  const objectCollisionHeightSlider = document.getElementById('object-collision-height-slider');
  const objectCollisionHeightValue = document.getElementById('object-collision-height-value');
  if (objectCollisionHeightSlider && objectCollisionHeightValue) {
    objectCollisionHeightSlider.addEventListener('input', (e) => {
      if (!selectedObject) return;
      const percentage = parseInt(e.target.value);
      selectedObject.userData.objectCollisionHeightMultiplier = percentage / 100;
      objectCollisionHeightValue.textContent = percentage + '%';
      saveState();
      // Update collision debug visualization if enabled
      if (debugState.showCollisionRadii) {
        updateCollisionDebugHelpers();
      }
    });
    // Add scroll-based adjustment
    addScrollToSlider(objectCollisionHeightSlider, (value) => {
      if (!selectedObject) return;
      selectedObject.userData.objectCollisionHeightMultiplier = value / 100;
      objectCollisionHeightValue.textContent = value + '%';
      saveState();
      if (debugState.showCollisionRadii) {
        updateCollisionDebugHelpers();
      }
    });
  }

  // Per-object collision reset button
  const collisionResetBtn = document.getElementById('collision-reset-btn');
  if (collisionResetBtn) {
    collisionResetBtn.addEventListener('click', () => {
      if (!selectedObject) return;
      // Reset to default (1.0 = 100%)
      selectedObject.userData.objectCollisionRadiusMultiplier = 1.0;
      selectedObject.userData.objectCollisionHeightMultiplier = 1.0;
      // Update UI
      if (objectCollisionRadiusSlider) objectCollisionRadiusSlider.value = 100;
      if (objectCollisionRadiusValue) objectCollisionRadiusValue.textContent = '100%';
      if (objectCollisionHeightSlider) objectCollisionHeightSlider.value = 100;
      if (objectCollisionHeightValue) objectCollisionHeightValue.textContent = '100%';
      saveState();
      // Update collision debug visualization if enabled
      if (debugState.showCollisionRadii) {
        updateCollisionDebugHelpers();
      }
    });
  }

  // Color swatches
  document.querySelectorAll('#main-colors .color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      if (selectedObject) {
        updateObjectColor(selectedObject, 'mainColor', swatch.dataset.color);
        document.querySelectorAll('#main-colors .color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
      }
    });
  });

  document.querySelectorAll('#accent-colors .color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      if (selectedObject) {
        // Block accent color change for Photo Frame if a photo is loaded
        if (selectedObject.userData.type === 'photo-frame' && selectedObject.userData.photoDataUrl) {
          // Photo is loaded - show hint that photo must be removed first
          const dynamicOptions = document.getElementById('object-specific-options');
          if (dynamicOptions) {
            // Flash a warning message
            const existingWarning = dynamicOptions.querySelector('.accent-warning');
            if (existingWarning) existingWarning.remove();
            const warning = document.createElement('div');
            warning.className = 'accent-warning';
            warning.style.cssText = 'color: #fbbf24; font-size: 12px; margin-top: 10px; padding: 8px; background: rgba(251, 191, 36, 0.1); border-radius: 6px; text-align: center;';
            warning.textContent = 'Remove photo first to change accent color';
            dynamicOptions.insertBefore(warning, dynamicOptions.firstChild);
            setTimeout(() => warning.remove(), 3000);
          }
          return; // Don't update color
        }
        updateObjectColor(selectedObject, 'accentColor', swatch.dataset.color);
        document.querySelectorAll('#accent-colors .color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
      }
    });
  });

  // Close panels when clicking outside
  container.addEventListener('click', (e) => {
    if (!e.target.closest('#menu') && !e.target.closest('#menu-toggle')) {
      document.getElementById('menu').classList.remove('open');
    }
  });

  // Modal close button
  document.getElementById('close-modal').addEventListener('click', closeInteractionModal);
  document.getElementById('modal-overlay').addEventListener('click', closeInteractionModal);

  // Pointer lock setup
  setupPointerLock(container);
}

// ============================================================================
// POINTER LOCK (FPS-style mouse capture)
// ============================================================================
function setupPointerLock(container) {
  const crosshair = document.getElementById('crosshair');
  const instructions = document.getElementById('pointer-lock-instructions');

  // Show initial instructions
  if (pointerLockState.showInstructions) {
    instructions.classList.add('visible');
  }

  // Click to request pointer lock
  container.addEventListener('click', (e) => {
    // Don't lock if clicking on UI elements or in examine mode
    if (e.target.closest('#menu') || e.target.closest('#customization-panel') ||
        e.target.closest('#interaction-modal') || isDragging) {
      return;
    }

    // Request pointer lock
    if (!pointerLockState.isLocked) {
      container.requestPointerLock = container.requestPointerLock ||
                                     container.mozRequestPointerLock ||
                                     container.webkitRequestPointerLock;
      if (container.requestPointerLock) {
        container.requestPointerLock();
      }
    }
  });

  // Pointer lock change handler
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('mozpointerlockchange', onPointerLockChange);
  document.addEventListener('webkitpointerlockchange', onPointerLockChange);

  function onPointerLockChange() {
    const lockElement = document.pointerLockElement ||
                        document.mozPointerLockElement ||
                        document.webkitPointerLockElement;

    if (lockElement === container) {
      // Pointer is locked
      pointerLockState.isLocked = true;
      pointerLockState.showInstructions = false;
      crosshair.classList.add('visible');
      instructions.classList.remove('visible');
    } else {
      // Pointer is unlocked
      pointerLockState.isLocked = false;
      crosshair.classList.remove('visible');
    }
  }

  // Pointer lock error handler
  document.addEventListener('pointerlockerror', onPointerLockError);
  document.addEventListener('mozpointerlockerror', onPointerLockError);
  document.addEventListener('webkitpointerlockerror', onPointerLockError);

  function onPointerLockError() {
    console.warn('Pointer lock failed');
  }
}

function onMouseDown(event) {
  // Middle mouse button - quick interaction or hold for book reading mode
  if (event.button === 1) {
    event.preventDefault();

    // If drawing mode is active, check if clicking on a drawable surface to enter inspection mode
    if (penDrawingMode.active && !inspectionDrawingState.active) {
      // Check if hovering over notebook/paper to enter inspection+drawing mode
      updateMousePosition(event);
      raycaster.setFromCamera(mouse, camera);
      // Exclude the pen from raycasting to prevent it from blocking the drawable surface
      const objectsToCheck = deskObjects.filter(obj => obj !== penDrawingMode.heldPen);
      const intersects = raycaster.intersectObjects(objectsToCheck, true);

      if (intersects.length > 0) {
        const clickedMesh = intersects[0].object;
        let object = clickedMesh;
        while (object.parent && !deskObjects.includes(object)) {
          object = object.parent;
        }

        if (deskObjects.includes(object) && (object.userData.type === 'notebook' || object.userData.type === 'paper')) {
          // Enter inspection mode while keeping drawing mode active
          penDrawingMode.middleMouseDownTime = Date.now();
          penDrawingMode.pendingDrawableObject = object;
          penDrawingMode.mmbHoldCompleted = false;
          penDrawingMode.holdTimeout = setTimeout(() => {
            // Hold for 300ms - enter inspection+drawing mode
            enterInspectionDrawingMode(object);
            penDrawingMode.mmbHoldCompleted = true;
            penDrawingMode.holdTimeout = null;
          }, 300);
          return;
        }
      }

      // If not clicking on drawable, exit drawing mode
      penDrawingMode.middleMouseDownTime = Date.now();
      penDrawingMode.mmbHoldCompleted = false;
      penDrawingMode.holdTimeout = setTimeout(() => {
        exitPenDrawingMode();
        penDrawingMode.mmbHoldCompleted = true;
        penDrawingMode.holdTimeout = null;
      }, 300);
      return;
    }

    // If inspection mode is active (with or without drawing), MMB hold exits all modes
    if (inspectionDrawingState.active) {
      penDrawingMode.middleMouseDownTime = Date.now();
      penDrawingMode.mmbHoldCompleted = false;
      penDrawingMode.holdTimeout = setTimeout(() => {
        // Hold for 300ms - exit all drawing-related modes
        if (penDrawingMode.active) {
          exitPenDrawingMode();
        }
        if (inspectionDrawingState.active) {
          exitInspectionDrawingMode();
        }
        penDrawingMode.mmbHoldCompleted = true;
        penDrawingMode.holdTimeout = null;
      }, 300);
      return;
    }

    // In reading mode, MMB does nothing (use LMB click to exit reading mode)
    if (bookReadingState.active) {
      return;
    }

    // In player mode, MMB hold exits player mode, quick click interacts with player buttons
    if (playerModeState.active && playerModeState.player) {
      playerModeState.middleMouseDownTime = Date.now();
      playerModeState.holdTimeout = setTimeout(() => {
        // Hold for 300ms - exit player mode
        exitPlayerMode();
        playerModeState.holdTimeout = null; // Mark as already handled
      }, 300);
      return;
    }

    updateMousePosition(event);

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(deskObjects, true);

    if (intersects.length > 0) {
      const clickedMesh = intersects[0].object;
      let object = clickedMesh;
      while (object.parent && !deskObjects.includes(object)) {
        object = object.parent;
      }

      if (deskObjects.includes(object)) {
        // If hovering over a pen, set up hold timeout to toggle drawing mode
        if (object.userData.type === 'pen') {
          penDrawingMode.middleMouseDownTime = Date.now();
          penDrawingMode.pendingPen = object;
          penDrawingMode.mmbHoldCompleted = false; // Reset flag
          penDrawingMode.holdTimeout = setTimeout(() => {
            // Hold for 300ms - enter drawing mode
            enterPenDrawingModeWithPen(object);
            penDrawingMode.mmbHoldCompleted = true; // Mark hold as completed
            penDrawingMode.holdTimeout = null; // Mark as already handled
          }, 300);
          return;
        }

        // If hovering over notebook/paper, set up hold timeout to enter inspection+drawing mode
        if (object.userData.type === 'notebook' || object.userData.type === 'paper') {
          penDrawingMode.middleMouseDownTime = Date.now();
          penDrawingMode.pendingDrawableObject = object;
          penDrawingMode.mmbHoldCompleted = false; // Reset flag
          penDrawingMode.holdTimeout = setTimeout(() => {
            // Hold for 300ms - enter inspection+drawing mode
            enterInspectionDrawingMode(object);
            penDrawingMode.mmbHoldCompleted = true; // Mark hold as completed
            penDrawingMode.holdTimeout = null; // Mark as already handled
          }, 300);
          return;
        }

        // For books and magazines, check if user is holding for reading mode
        if (object.userData.type === 'books' || object.userData.type === 'magazine') {
          bookReadingState.middleMouseDownTime = Date.now();
          bookReadingState.book = object;
          bookReadingState.holdTimeout = setTimeout(() => {
            // If book/magazine is open, enter reading mode after holding for 300ms
            // If book/magazine is closed, a hold does nothing extra (will just toggle on quick release)
            if (object.userData.isOpen) {
              enterBookReadingMode(object);
              bookReadingState.holdTimeout = null; // Mark as already handled
            }
          }, 300);
        } else if (object.userData.type === 'cassette-player' || object.userData.type === 'big-cassette-player') {
          // For cassette player (mini or big), enter player mode after holding for 300ms
          playerModeState.middleMouseDownTime = Date.now();
          playerModeState.player = object;
          playerModeState.holdTimeout = setTimeout(() => {
            // Enter player mode after holding for 300ms
            enterPlayerMode(object);
            playerModeState.holdTimeout = null; // Mark as already handled
          }, 300);
        } else {
          // Perform quick toggle interaction based on object type
          // Pass the clicked mesh so we can detect sub-component clicks (like power button)
          performQuickInteraction(object, clickedMesh);
        }
      }
    }
    return;
  }

  // Right mouse button - edit mode (customization panel)
  // Handle here because contextmenu doesn't fire properly when pointer is locked
  if (event.button === 2) {
    event.preventDefault();
    handleRightClick(event);
    return;
  }

  if (event.button !== 0) return; // Left click only

  // If in drawing mode, LMB starts drawing instead of dragging objects
  if (penDrawingMode.active && penDrawingMode.heldPen) {
    // Check if there's a drawable surface under the pen
    const target = findDrawableObjectUnderPen();
    if (target) {
      // Start a new stroke
      penDrawingMode.isStrokeActive = true;
      penDrawingMode.drawingPath = [];
      // Add first point
      const penWorldPos = new THREE.Vector3();
      penDrawingMode.heldPen.getWorldPosition(penWorldPos);
      addDrawingPoint(penWorldPos);
    }
    // In drawing mode, don't allow picking up/dragging other objects - return early
    return;
  }

  // If in book reading mode, LMB click exits reading mode
  if (bookReadingState.active) {
    exitBookReadingMode();
    return;
  }

  // If in inspection+drawing mode, LMB exits the mode (unless actively drawing)
  if (inspectionDrawingState.active) {
    // If we have a pen in drawing mode, start drawing instead of exiting
    if (penDrawingMode.active && penDrawingMode.heldPen) {
      // Check if there's a drawable surface under the pen
      const target = findDrawableObjectUnderPen();
      if (target) {
        // Start a new stroke
        penDrawingMode.isStrokeActive = true;
        penDrawingMode.drawingPath = [];
        // Add first point
        const penWorldPos = new THREE.Vector3();
        penDrawingMode.heldPen.getWorldPosition(penWorldPos);
        addDrawingPoint(penWorldPos);
      }
      return;
    }
    // Otherwise, exit inspection mode
    exitInspectionDrawingMode();
    return;
  }

  // If in player mode:
  // - LMB clicking anywhere exits player mode (for consistency, all button clicks use MMB only)
  if (playerModeState.active && playerModeState.player) {
    exitPlayerMode();
    return;
  }

  // If in examine mode with LMB click:
  // - If clicked on the examined object, start dragging it
  // - Otherwise, don't exit (use LMB + scroll up to exit)
  if (examineState.active && examineState.object) {
    // Check if clicking on the examined object to start drag
    updateMousePosition(event);
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects([examineState.object], true);

    if (intersects.length > 0) {
      // Start dragging from examine mode
      const object = examineState.object;
      const originalPosition = examineState.originalPosition.clone();

      // Exit examine mode but don't animate back - start dragging instead
      object.userData.isExamining = false;
      object.userData.isReturning = false;
      object.userData.examineTarget = null;
      object.userData.examineScaleTarget = undefined;
      closeInteractionModal();

      // Move object back to desk level for dragging
      object.position.copy(originalPosition);
      if (examineState.originalScale) {
        object.scale.copy(examineState.originalScale);
      }

      // Clear examine state
      examineState.active = false;
      examineState.object = null;
      examineState.originalPosition = null;
      examineState.originalRotation = null;
      examineState.originalScale = null;

      // Start dragging
      selectedObject = object;
      isDragging = true;
      dragLayerOffset = 0;

      // Check if there are objects stacked on top of this one
      const objectsOnTop = findObjectsOnTop(object);
      const hasObjectsOnTop = objectsOnTop.length > 0;

      // If there are objects on top, don't lift - drag horizontally to pull out from under
      // This allows the user to "pull out" an object from a stack without lifting the whole stack
      if (hasObjectsOnTop) {
        object.userData.isLifted = false;
        object.userData.isPullingOut = true; // Mark as pulling out from under a stack
        // Keep the current Y position, don't lift
      } else {
        // No objects on top - lift normally
        object.userData.isLifted = true;
        object.userData.isPullingOut = false;
        object.userData.targetY = object.userData.originalY + CONFIG.physics.liftHeight;
      }

      document.getElementById('customization-panel').classList.remove('open');
      return;
    }
    // If not clicking on the object, don't do anything
    return;
  }

  updateMousePosition(event);

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(deskObjects, true);

  // Close customization panel when clicking anywhere (both on objects or empty space)
  // This ensures edit mode exits when clicking outside the panel
  const panel = document.getElementById('customization-panel');
  if (panel && panel.classList.contains('open')) {
    panel.classList.remove('open');
    selectedObject = null;
    // Clear dynamic options
    const dynamicOptions = document.getElementById('object-specific-options');
    if (dynamicOptions) dynamicOptions.innerHTML = '';
  }

  if (intersects.length > 0) {
    // Find the root object
    let object = intersects[0].object;
    while (object.parent && !deskObjects.includes(object)) {
      object = object.parent;
    }

    if (deskObjects.includes(object)) {
      // Check for click on laptop screen when zoomed in with cursor mode
      if (object.userData.type === 'laptop' && object.userData.isZoomedIn && object.userData.isOn && !object.userData.isBooting) {
        const clickedMesh = intersects[0].object;
        if (clickedMesh.name === 'screen') {
          const now = Date.now();
          const timeDiff = now - laptopDoubleClickState.lastClickTime;

          // Use cursor position if cursor mode is active, otherwise use UV
          let clickX, clickY;
          if (laptopCursorState.visible && laptopCursorState.targetLaptop === object) {
            // Cursor mode - use cursor position directly (already in canvas coordinates)
            clickX = laptopCursorState.x / 512;
            clickY = 1 - (laptopCursorState.y / 384); // Flip Y
          } else {
            // Fallback to UV coordinates
            const uv = intersects[0].uv;
            if (uv) {
              clickX = uv.x;
              clickY = uv.y;
            }
          }

          if (clickX !== undefined) {
            // Convert to canvas coordinates for easier comparison
            const canvasX = laptopCursorState.visible ? laptopCursorState.x : clickX * 512;
            const canvasY = laptopCursorState.visible ? laptopCursorState.y : (1 - clickY) * 384;

            // Check Start button click (single click)
            const startBtnX = 5;
            const startBtnY = 384 - 24;
            const startBtnW = 60;
            const startBtnH = 20;

            if (canvasX >= startBtnX && canvasX <= startBtnX + startBtnW &&
                canvasY >= startBtnY && canvasY <= startBtnY + startBtnH) {
              // Toggle start menu
              if (laptopStartMenuState.isOpen && laptopStartMenuState.targetLaptop === object) {
                laptopStartMenuState.isOpen = false;
                laptopStartMenuState.targetLaptop = null;
              } else {
                laptopStartMenuState.isOpen = true;
                laptopStartMenuState.targetLaptop = object;
              }
              updateLaptopDesktopWithCursor(object);
              return;
            }

            // Check shutdown button click if start menu is open (Windows XP style)
            if (laptopStartMenuState.isOpen && laptopStartMenuState.targetLaptop === object) {
              const menuX = 0;
              const menuY = 384 - 28 - 160;  // Updated for XP menu height
              const menuW = 200;             // Updated for XP menu width
              const menuH = 160;
              const bottomBarY = menuY + menuH - 34;  // Orange bottom bar
              const shutdownX = menuX + menuW - 90;
              const shutdownY = bottomBarY + 7;

              // Check if clicking on Turn Off button in orange bar
              if (canvasX >= shutdownX && canvasX <= shutdownX + 80 &&
                  canvasY >= shutdownY && canvasY <= shutdownY + 20) {
                // Shutdown the laptop
                laptopStartMenuState.isOpen = false;
                laptopStartMenuState.targetLaptop = null;
                toggleLaptopPower(object);
                return;
              }

              // Click outside menu closes it
              if (canvasX < menuX || canvasX > menuX + menuW ||
                  canvasY < menuY || canvasY > menuY + menuH) {
                laptopStartMenuState.isOpen = false;
                laptopStartMenuState.targetLaptop = null;
                updateLaptopDesktopWithCursor(object);
              }
            }

            // Get icon position from saved positions or default
            const iconPos = object.userData.iconPositions || { obsidian: { x: 60, y: 60 } };
            const iconPosX = iconPos.obsidian?.x || 60;
            const iconPosY = iconPos.obsidian?.y || 60;
            const iconSize = 48;

            // Check if click is on the icon (using canvas coordinates)
            const dx = canvasX - iconPosX;
            const dy = canvasY - iconPosY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const onIcon = dist < iconSize;

            if (timeDiff < laptopDoubleClickState.doubleClickThreshold) {
              // Double-click detected - open editor if on icon
              if (onIcon) {
                openMarkdownEditor(object);
                laptopDoubleClickState.lastClickTime = 0;
                return;
              }
            } else if (onIcon) {
              // Single click on icon - start dragging
              laptopIconDragState.isDragging = true;
              laptopIconDragState.iconName = 'obsidian';
              laptopIconDragState.startX = canvasX;
              laptopIconDragState.startY = canvasY;
              laptopIconDragState.offsetX = canvasX - iconPosX;
              laptopIconDragState.offsetY = canvasY - iconPosY;
              laptopIconDragState.targetLaptop = object;
            }
          }
          laptopDoubleClickState.lastClickTime = now;
          return; // Don't start dragging when in laptop zoom mode
        }
      }

      // Don't allow dragging if object is still animating from examine mode
      if (object.userData.isExamining || object.userData.isReturning) {
        return;
      }

      selectedObject = object;
      isDragging = true;
      dragLayerOffset = 0; // Reset layer offset when starting drag

      // Clear any examine mode state that might be interfering
      object.userData.examineTarget = null;
      object.userData.examineScaleTarget = undefined;
      object.userData.isExamining = false;
      object.userData.isReturning = false;

      // Reset fallen object when picked up
      if (object.userData.isFallen) {
        resetFallenObject(object);
      }

      // If picking up a pen, make it vertical and track as held pen
      if (object.userData.type === 'pen') {
        makePenVertical(object);
        penDrawingMode.heldPen = object;
      }

      // Check if there are objects stacked on top of this one
      const objectsOnTop = findObjectsOnTop(object);
      const hasObjectsOnTop = objectsOnTop.length > 0;

      // If there are objects on top, don't lift - drag horizontally to pull out from under
      // This allows the user to "pull out" an object from a stack without lifting the whole stack
      if (hasObjectsOnTop) {
        object.userData.isLifted = false;
        object.userData.isPullingOut = true; // Mark as pulling out from under a stack
        // Keep the current Y position, don't lift
      } else {
        // No objects on top - lift normally
        object.userData.isLifted = true;
        object.userData.isPullingOut = false;
        object.userData.targetY = object.userData.originalY + CONFIG.physics.liftHeight;
      }
    }
  }
}

function onMouseMove(event) {
  // Use pointer lock movement data if locked, otherwise use delta from previous position
  let deltaX, deltaY;
  if (pointerLockState.isLocked) {
    // Use movementX/Y for pointer lock (raw mouse movement)
    deltaX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
    deltaY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;
  } else {
    // Fallback to calculating delta from previous position
    deltaX = event.clientX - previousMousePosition.x;
    deltaY = event.clientY - previousMousePosition.y;
  }

  // FPS-style camera look - active when pointer is locked
  // Camera continues to move even while dragging - object stays under crosshair
  const modal = document.getElementById('interaction-modal');
  const isModalOpen = modal && modal.classList.contains('open');

  // Check if any laptop is in zoom mode (allow camera rotation in laptop zoom mode)
  let inLaptopZoomMode = false;
  let zoomedLaptop = null;
  for (const obj of deskObjects) {
    if (obj.userData.type === 'laptop' && obj.userData.isZoomedIn) {
      inLaptopZoomMode = true;
      zoomedLaptop = obj;
      break;
    }
  }

  // Handle laptop cursor movement when in zoom mode with laptop on
  if (inLaptopZoomMode && zoomedLaptop && zoomedLaptop.userData.isOn && !zoomedLaptop.userData.isBooting && pointerLockState.isLocked) {
    // Move cursor on laptop screen
    laptopCursorState.visible = true;
    laptopCursorState.targetLaptop = zoomedLaptop;

    // Update cursor position (sensitivity adjusted for screen size)
    const cursorSensitivity = 0.8;
    laptopCursorState.x += deltaX * cursorSensitivity;
    laptopCursorState.y += deltaY * cursorSensitivity;

    // Clamp cursor to screen bounds (512x384 canvas)
    laptopCursorState.x = Math.max(0, Math.min(512, laptopCursorState.x));
    laptopCursorState.y = Math.max(0, Math.min(384, laptopCursorState.y));

    // Handle icon dragging
    if (laptopIconDragState.isDragging && laptopIconDragState.targetLaptop === zoomedLaptop) {
      // Update icon position based on cursor
      if (!zoomedLaptop.userData.iconPositions) {
        zoomedLaptop.userData.iconPositions = { obsidian: { x: 60, y: 60 } };
      }
      const iconName = laptopIconDragState.iconName;
      if (iconName && zoomedLaptop.userData.iconPositions[iconName]) {
        // Calculate new position
        let newX = laptopCursorState.x - laptopIconDragState.offsetX;
        let newY = laptopCursorState.y - laptopIconDragState.offsetY;

        // Clamp to screen bounds (with padding for icon size)
        const iconSize = 48;
        const taskbarHeight = 30;
        newX = Math.max(iconSize / 2, Math.min(512 - iconSize / 2, newX));
        newY = Math.max(iconSize / 2 + 20, Math.min(384 - taskbarHeight - iconSize / 2, newY));

        zoomedLaptop.userData.iconPositions[iconName].x = newX;
        zoomedLaptop.userData.iconPositions[iconName].y = newY;
      }
    }

    // Update the desktop texture to show cursor
    updateLaptopDesktopWithCursor(zoomedLaptop);

    // Also allow camera rotation to follow cursor movement (see below)
  } else if (!inLaptopZoomMode && laptopCursorState.visible) {
    // Exited laptop zoom mode, hide cursor
    laptopCursorState.visible = false;
    laptopCursorState.targetLaptop = null;
  }

  // Allow camera look normally, or in laptop zoom mode even with modal open
  // In laptop zoom mode, camera follows mouse movement to allow viewing entire screen
  if (pointerLockState.isLocked && cameraLookState.isLooking && (!isModalOpen || inLaptopZoomMode)) {
    // Update yaw and pitch
    cameraLookState.yaw -= deltaX * cameraLookState.sensitivity;
    cameraLookState.pitch -= deltaY * cameraLookState.sensitivity;

    // Clamp pitch to prevent flipping (looking too far up or down)
    cameraLookState.pitch = Math.max(cameraLookState.minPitch, Math.min(cameraLookState.maxPitch, cameraLookState.pitch));

    // Clamp yaw to prevent rotating too far left/right (seated person perspective)
    cameraLookState.yaw = Math.max(cameraLookState.minYaw, Math.min(cameraLookState.maxYaw, cameraLookState.yaw));

    // Update camera direction
    updateCameraLook();
  }

  previousMousePosition = { x: event.clientX, y: event.clientY };

  updateMousePosition(event);

  // In drawing mode, pen follows cursor (attached to cursor at pen tip)
  if (penDrawingMode.active && penDrawingMode.heldPen) {
    // Calculate pen position based on cursor/crosshair
    const halfWidth = CONFIG.desk.width / 2 - 0.2;
    const halfDepth = CONFIG.desk.depth / 2 - 0.2;

    let crosshairPoint = null; // The point where the crosshair/cursor aims
    let targetX, targetZ, targetY;

    // In inspection+drawing mode, use different raycasting approach
    if (inspectionDrawingState.active && inspectionDrawingState.drawableObject) {
      // In inspection mode, raycast to the drawable object's surface directly
      const mousePos = pointerLockState.isLocked ? new THREE.Vector2(0, 0) : mouse;
      raycaster.setFromCamera(mousePos, camera);

      // Raycast to the inspected drawable object
      const intersects = raycaster.intersectObjects([inspectionDrawingState.drawableObject], true);
      if (intersects.length > 0) {
        crosshairPoint = intersects[0].point.clone();
      } else {
        // If not intersecting the drawable, use desk plane
        const intersectsPlane = raycaster.intersectObject(dragPlane);
        if (intersectsPlane.length > 0) {
          crosshairPoint = intersectsPlane[0].point.clone();
        }
      }
    } else {
      // Normal drawing mode (not in inspection)
      const mousePos = pointerLockState.isLocked ? new THREE.Vector2(0, 0) : mouse;
      raycaster.setFromCamera(mousePos, camera);

      // First try to raycast to drawable surfaces for more accurate positioning
      // Exclude the pen itself to prevent self-blocking
      const drawableObjects = deskObjects.filter(obj =>
        (obj.userData.type === 'notebook' || obj.userData.type === 'paper') &&
        obj !== penDrawingMode.heldPen
      );
      const drawableIntersects = raycaster.intersectObjects(drawableObjects, true);

      if (drawableIntersects.length > 0) {
        crosshairPoint = drawableIntersects[0].point.clone();
      } else {
        // Fall back to desk plane
        const intersects = raycaster.intersectObject(dragPlane);
        if (intersects.length > 0) {
          crosshairPoint = intersects[0].point.clone();
        }
      }
    }

    // Position pen so that the pen TIP is at the crosshair point
    // The pen tip (apex of the cone at Y~=-0.02 in local space) should be at the ray-surface intersection
    if (crosshairPoint) {
      // The pen tip apex is at approximately Y=-0.02 in local penBody space
      // We need to offset the pen group position so the tip ends up at crosshairPoint
      // A small height correction prevents the tip from clipping into the surface
      // Scale the correction with pen size to prevent large pens from getting stuck
      const penScale = penDrawingMode.heldPen.userData.scale || penDrawingMode.heldPen.scale.x || 1.0;
      const baseTipHeightCorrection = 0.02; // Base offset to lift tip slightly above surface
      const tipHeightCorrection = baseTipHeightCorrection * penScale;

      // Position pen group so tip is at crosshair point with height correction
      targetX = crosshairPoint.x;
      targetZ = crosshairPoint.z;
      targetY = crosshairPoint.y + tipHeightCorrection;

      // Clamp to desk boundaries
      targetX = Math.max(-halfWidth, Math.min(halfWidth, targetX));
      targetZ = Math.max(-halfDepth, Math.min(halfDepth, targetZ));

      // Apply position to pen - tip will be at crosshair point
      penDrawingMode.heldPen.position.x = targetX;
      penDrawingMode.heldPen.position.z = targetZ;
      penDrawingMode.heldPen.position.y = targetY;

      // Update ray visualization (for visual realism/debugging only)
      const drawableTarget = findDrawableObjectUnderPen();

      // If stroke is active, add drawing point at the crosshair intersection
      if (penDrawingMode.isStrokeActive) {
        addDrawingPoint(crosshairPoint);
      }
    }
  }

  if (isDragging && selectedObject) {
    // Clamp to desk bounds
    const halfWidth = CONFIG.desk.width / 2 - 0.2;
    const halfDepth = CONFIG.desk.depth / 2 - 0.2;

    let newX, newZ;

    if (pointerLockState.isLocked) {
      // When pointer is locked, the object stays under the crosshair (screen center)
      // Camera moves, and we raycast from screen center to find where object should be
      const centerMouse = new THREE.Vector2(0, 0); // Screen center
      raycaster.setFromCamera(centerMouse, camera);
      const intersects = raycaster.intersectObject(dragPlane);

      if (intersects.length > 0) {
        const point = intersects[0].point;
        newX = Math.max(-halfWidth, Math.min(halfWidth, point.x));
        newZ = Math.max(-halfDepth, Math.min(halfDepth, point.z));
      } else {
        return; // No valid position
      }
    } else {
      // When pointer is not locked, use raycasting for absolute positioning
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(dragPlane);

      if (intersects.length > 0) {
        const point = intersects[0].point;
        newX = Math.max(-halfWidth, Math.min(halfWidth, point.x));
        newZ = Math.max(-halfDepth, Math.min(halfDepth, point.z));
      } else {
        return; // No valid position
      }
    }

    // Track drag velocity for physics collision force scaling
    const now = Date.now();
    if (physicsState.lastDragPosition && physicsState.lastDragTime > 0) {
      const dt = (now - physicsState.lastDragTime) / 1000; // Convert to seconds
      if (dt > 0 && dt < 0.1) { // Ignore stale data
        physicsState.dragVelocity.x = (newX - physicsState.lastDragPosition.x) / dt;
        physicsState.dragVelocity.z = (newZ - physicsState.lastDragPosition.z) / dt;
      }
    }
    physicsState.lastDragPosition = { x: newX, z: newZ };
    physicsState.lastDragTime = now;

    // Calculate drag speed for stacking physics
    const dragSpeed = Math.sqrt(
      physicsState.dragVelocity.x * physicsState.dragVelocity.x +
      physicsState.dragVelocity.z * physicsState.dragVelocity.z
    );

    // Apply resistance when pulling object from under other objects
    const pullResistance = calculatePullResistance(selectedObject, selectedObject.position.x, selectedObject.position.z, newX, newZ);

    // Apply additional resistance from objects stacked on top
    // Objects with heavy items on top are harder to drag (realistic physics)
    const stackedResistance = calculateStackedResistance(selectedObject);

    // Combine resistances (they compound)
    const totalResistance = Math.min(0.9, pullResistance + stackedResistance);

    // If there's resistance, lerp toward target position instead of snapping
    if (totalResistance > 0) {
      const resistanceFactor = Math.max(0.1, 1 - totalResistance * 0.6);
      newX = selectedObject.position.x + (newX - selectedObject.position.x) * resistanceFactor;
      newZ = selectedObject.position.z + (newZ - selectedObject.position.z) * resistanceFactor;
    }

    // Calculate actual movement delta for stacking physics
    const deltaX = newX - selectedObject.position.x;
    const deltaZ = newZ - selectedObject.position.z;

    selectedObject.position.x = newX;
    selectedObject.position.z = newZ;

    // Handle drawing in pen drawing mode
    if (penDrawingMode.active && penDrawingMode.isStrokeActive &&
        selectedObject.userData.type === 'pen') {
      // Get the pen's world position for drawing
      const penWorldPos = new THREE.Vector3();
      selectedObject.getWorldPosition(penWorldPos);
      addDrawingPoint(penWorldPos);
    }

    // Move objects stacked on top using friction physics
    // They get pulled along due to friction, but may slip at high speeds
    // Only move stacked objects if we're lifting (not pulling out from under)
    if (!selectedObject.userData.isPullingOut) {
      moveStackedObjects(selectedObject, deltaX, deltaZ, dragSpeed);
    }

    // Dynamically adjust Y position while dragging
    if (selectedObject.userData.isPullingOut) {
      // When pulling out from under a stack, stay at current Y level
      // Don't lift - this allows sliding out horizontally from under objects
      // The Y position stays at the original position on the desk surface
      selectedObject.userData.targetY = selectedObject.userData.originalY;

      // Check if objects on top have lost their support and should fall
      checkAndDropUnsupportedObjects(selectedObject);
    } else {
      // Normal dragging - ride on top of other objects
      // This allows the dragged object to "ride" on top of static objects
      const dragStackY = calculateDragStackingY(selectedObject, newX, newZ);
      const liftedY = dragStackY + CONFIG.physics.liftHeight;
      selectedObject.userData.targetY = liftedY;
    }
  }

  // Update tooltip
  if (!isDragging) {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(deskObjects, true);

    const tooltip = document.getElementById('tooltip');

    if (intersects.length > 0) {
      let object = intersects[0].object;
      while (object.parent && !deskObjects.includes(object)) {
        object = object.parent;
      }

      if (object.userData.name) {
        tooltip.textContent = object.userData.name;
        tooltip.style.left = event.clientX + 15 + 'px';
        tooltip.style.top = event.clientY + 15 + 'px';
        tooltip.classList.add('visible');
        document.body.style.cursor = 'grab';
      }
    } else {
      tooltip.classList.remove('visible');
      document.body.style.cursor = 'default';
    }
  } else {
    document.body.style.cursor = 'grabbing';
  }

  previousMousePosition = { x: event.clientX, y: event.clientY };
}

function onMouseUp(event) {
  // Handle laptop icon drag end (before other handlers)
  if (laptopIconDragState.isDragging) {
    // End icon dragging and save state
    const laptop = laptopIconDragState.targetLaptop;
    laptopIconDragState.isDragging = false;
    laptopIconDragState.iconName = null;
    laptopIconDragState.targetLaptop = null;

    // Save the new icon position to state
    if (laptop) {
      saveState();
    }
    return;
  }

  // Middle mouse button - handle book quick click or cancel hold timeout
  if (event.button === 1) {
    // If MMB hold just completed (entered or exited a mode), ignore this release
    if (penDrawingMode.mmbHoldCompleted) {
      penDrawingMode.mmbHoldCompleted = false; // Reset flag
      penDrawingMode.middleMouseDownTime = null;
      penDrawingMode.pendingPen = null;
      penDrawingMode.pendingDrawableObject = null;
      return;
    }

    // If user releases before pen hold timeout fired, cancel it (quick click does nothing for pens)
    if (penDrawingMode.holdTimeout) {
      clearTimeout(penDrawingMode.holdTimeout);
      penDrawingMode.holdTimeout = null;
      penDrawingMode.pendingPen = null;
      penDrawingMode.pendingDrawableObject = null;
      penDrawingMode.middleMouseDownTime = null;
      // Quick click on pen does nothing - only hold activates drawing mode
      return;
    }

    // If in reading mode, don't exit on release - stay in mode until user clicks elsewhere
    if (bookReadingState.active) {
      return;
    }

    // If in player mode, MMB quick click interacts with player buttons
    if (playerModeState.active && playerModeState.player) {
      // If user releases before the hold timeout fired (300ms), it's a quick click - interact with player
      if (playerModeState.holdTimeout) {
        clearTimeout(playerModeState.holdTimeout);
        playerModeState.holdTimeout = null;

        // Quick click in player mode - handle player button interaction via raycasting
        updateMousePosition(event);
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects([playerModeState.player], true);

        if (intersects.length > 0) {
          // Clicked on the player - handle button interaction
          const clickedMesh = intersects[0].object;
          performQuickInteraction(playerModeState.player, clickedMesh);
        }
        // If clicked outside, do nothing (don't exit - that's MMB hold)
      }
      return;
    }

    // If user releases before the hold timeout fired, it's a quick click - toggle book/magazine
    if (bookReadingState.holdTimeout) {
      clearTimeout(bookReadingState.holdTimeout);
      bookReadingState.holdTimeout = null;

      // Quick click on book/magazine - toggle open/close
      if (bookReadingState.book) {
        if (bookReadingState.book.userData.type === 'magazine') {
          toggleMagazineOpen(bookReadingState.book);
        } else {
          toggleBookOpen(bookReadingState.book);
        }
        bookReadingState.book = null;
      }
    }

    // If user releases before the player mode hold timeout fired, cancel it and perform quick interaction
    if (playerModeState.holdTimeout) {
      clearTimeout(playerModeState.holdTimeout);
      playerModeState.holdTimeout = null;

      // Quick click on cassette player - perform quick interaction
      if (playerModeState.player) {
        performQuickInteraction(playerModeState.player, null);
        playerModeState.player = null;
      }
    }
    return;
  }

  // End drawing stroke if in drawing mode (LMB release)
  if (event.button === 0 && penDrawingMode.active && penDrawingMode.isStrokeActive) {
    endDrawingStroke();
  }

  if (isDragging && selectedObject) {
    // Check for pen holder insertion
    const insertionResult = checkPenHolderInsertion(selectedObject);

    if (insertionResult.inserted) {
      // Pen was inserted into a holder - animate to position inside holder
      selectedObject.userData.isLifted = false;
      selectedObject.userData.isPullingOut = false; // Clear pulling out state
      selectedObject.userData.inHolder = insertionResult.holder;
      selectedObject.userData.holderSlot = insertionResult.slot;
      selectedObject.userData.originalY = insertionResult.y;
      selectedObject.userData.targetY = insertionResult.y;
      selectedObject.position.x = insertionResult.x;
      selectedObject.position.z = insertionResult.z;
      // Rotate pen to stand upright in holder (reset from lying flat position)
      selectedObject.rotation.x = 0;
      selectedObject.rotation.y = 0;
      selectedObject.rotation.z = Math.random() * 0.2 - 0.1; // Slight random lean
      // Also reset the penBody sub-group rotation
      const penBody = selectedObject.getObjectByName('penBody');
      if (penBody) {
        penBody.rotation.x = 0;
        penBody.rotation.z = 0;
      }
    } else {
      // Check if dropping on top of another object (stacking)
      const dropY = calculateStackingY(selectedObject);

      // Update the original Y to the new stacking position
      selectedObject.userData.originalY = dropY;

      // Drop the object
      selectedObject.userData.isLifted = false;
      selectedObject.userData.isPullingOut = false; // Clear pulling out state
      selectedObject.userData.targetY = dropY;

      // Clear holder reference if pen was removed from holder
      if (selectedObject.userData.inHolder) {
        selectedObject.userData.inHolder = null;
        selectedObject.userData.holderSlot = null;
      }

      // If dropping a pen, make it lie flat unless in drawing mode
      if (selectedObject.userData.type === 'pen' && !penDrawingMode.active) {
        makePenFlat(selectedObject);
      }
    }

    // Clear held pen reference if we're not in drawing mode
    if (selectedObject.userData.type === 'pen' && !penDrawingMode.active) {
      penDrawingMode.heldPen = null;
    }

    isDragging = false;
    dragLayerOffset = 0; // Reset layer offset when dropping

    // Reset drag velocity tracking
    physicsState.lastDragPosition = null;
    physicsState.lastDragTime = 0;
    physicsState.dragVelocity = { x: 0, z: 0 };

    saveState();
  }
}

// Check if a pen is being dropped on/into a pen holder (or empty mug)
// Returns { inserted: false } if not, or { inserted: true, holder, x, y, z, slot } if yes
function checkPenHolderInsertion(droppedObject) {
  // Only check for pens
  if (droppedObject.userData.type !== 'pen') {
    return { inserted: false };
  }

  // Get the pen's position in world coordinates
  const penWorldPos = new THREE.Vector3();
  droppedObject.getWorldPosition(penWorldPos);

  // Check all pen holders and empty mugs
  for (const obj of deskObjects) {
    const isHolder = obj.userData.type === 'pen-holder';
    const isEmptyMug = obj.userData.type === 'coffee' && obj.userData.liquidLevel < 0.1;

    if (!isHolder && !isEmptyMug) continue;
    if (obj === droppedObject) continue;

    const holderX = obj.position.x;
    const holderZ = obj.position.z;
    const holderY = obj.position.y;

    // Calculate distance from pen CENTER to holder center (XZ plane)
    // This is more forgiving than checking the exact tip position
    const dx = penWorldPos.x - holderX;
    const dz = penWorldPos.z - holderZ;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Use a larger detection radius for easier insertion
    // The holder inner radius is about 0.1, use 0.2 for forgiving detection
    const detectionRadius = isHolder ? 0.25 : 0.15;

    // Check if pen is near the holder opening (horizontal distance)
    // The user wants to just place the pen near/over the holder
    if (dist < detectionRadius) {
      // Find an available slot position
      const slot = findAvailableHolderSlot(obj, droppedObject);

      // Calculate Y position inside holder
      const holderScale = obj.userData.scale || obj.scale.x || 1.0;
      const baseY = obj.position.y;
      const penY = baseY + 0.15 * holderScale; // Pen tip rests inside, cap sticks up

      return {
        inserted: true,
        holder: obj,
        x: holderX + slot.offsetX,
        y: penY,
        z: holderZ + slot.offsetZ,
        slot: slot.index
      };
    }
  }

  return { inserted: false };
}

// Find an available slot position for a pen in a holder
function findAvailableHolderSlot(holder, excludePen) {
  // Get all pens currently in this holder
  const pensInHolder = deskObjects.filter(obj =>
    obj.userData.type === 'pen' &&
    obj.userData.inHolder === holder &&
    obj !== excludePen
  );

  // Slot positions (circular arrangement)
  const maxSlots = 6;
  const slotRadius = 0.04;
  const slots = [];

  for (let i = 0; i < maxSlots; i++) {
    const angle = (i / maxSlots) * Math.PI * 2;
    slots.push({
      index: i,
      offsetX: Math.cos(angle) * slotRadius,
      offsetZ: Math.sin(angle) * slotRadius,
      occupied: false
    });
  }

  // Mark occupied slots
  pensInHolder.forEach(pen => {
    if (pen.userData.holderSlot !== undefined && pen.userData.holderSlot < maxSlots) {
      slots[pen.userData.holderSlot].occupied = true;
    }
  });

  // Find first unoccupied slot
  const availableSlot = slots.find(s => !s.occupied);
  if (availableSlot) {
    return availableSlot;
  }

  // If all slots are full, use center with random offset
  return {
    index: -1,
    offsetX: (Math.random() - 0.5) * 0.02,
    offsetZ: (Math.random() - 0.5) * 0.02
  };
}

// Calculate Y position for dragging - allows object to ride on top of ANY object (no weight check)
// Uses dragLayerOffset to allow user-controlled stacking via scroll
function calculateDragStackingY(draggedObject, posX, posZ) {
  // Use stacking radius for overlap detection (larger, based on actual object footprint)
  const draggedRadius = getStackingRadius(draggedObject);
  const baseY = getDeskSurfaceY();
  const draggedBaseOffset = OBJECT_PHYSICS[draggedObject.userData.type]?.baseOffset || 0;
  // Account for scale when calculating base offset
  const objectScale = draggedObject.userData.scale || draggedObject.scale.x || 1.0;

  // Default Y position (on desk surface) - apply scale to baseOffset
  let stackY = baseY + draggedBaseOffset * objectScale;

  // Collect all objects we're overlapping with and their heights
  const overlappingObjects = [];

  // Check all other objects to see if we're above any of them
  deskObjects.forEach(obj => {
    if (obj === draggedObject) return;
    if (obj.userData.isFallen) return;

    // Use stacking radius for the other object too
    const otherRadius = getStackingRadius(obj);
    const otherPhysics = getObjectPhysics(obj);

    // Skip objects that don't allow stacking on top (e.g., round clock, tilted photo frame)
    if (otherPhysics.noStackingOnTop) return;

    // Calculate horizontal distance
    const dx = posX - obj.position.x;
    const dz = posZ - obj.position.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);

    // Check if objects overlap horizontally (with generous tolerance for stacking)
    const overlapThreshold = (draggedRadius + otherRadius) * 0.8;

    if (horizontalDist < overlapThreshold) {
      // Calculate the top surface of the object below
      const otherScale = obj.userData.scale || obj.scale.x || 1.0;
      const objTopY = obj.position.y + otherPhysics.height * otherScale;
      overlappingObjects.push({ obj, topY: objTopY });
    }
  });

  // If there are overlapping objects
  if (overlappingObjects.length > 0) {
    // Find the highest object
    const highestTop = overlappingObjects.reduce((max, o) => Math.max(max, o.topY), 0);

    // Safety check: don't stack on objects that are themselves lifted/dragged
    // or objects that are unreasonably high (likely a bug)
    const MAX_REASONABLE_HEIGHT = baseY + 3.0; // 3 units above desk is plenty
    if (highestTop > MAX_REASONABLE_HEIGHT) {
      // Ignore unreasonably high objects - they're likely stuck/bugged
      return stackY;
    }

    if (dragLayerOffset > 0) {
      // User scrolled up - definitely stack on top with extra height
      stackY = Math.max(stackY, highestTop + draggedBaseOffset + dragLayerOffset * 0.02);
    } else {
      // Default behavior: stack on top of overlapping objects (more intuitive)
      // Objects will naturally rest on top of whatever they're dragged over
      stackY = Math.max(stackY, highestTop + draggedBaseOffset * objectScale);
    }
  }

  // Final safety clamp to prevent objects from flying too high
  const MAX_STACK_HEIGHT = baseY + 2.5;
  stackY = Math.min(stackY, MAX_STACK_HEIGHT);

  return stackY;
}

// Calculate Y position for stacking - checks if the object is above another and returns appropriate Y
// Now stacks automatically when dropped on top of another object, or manually with scroll up
function calculateStackingY(droppedObject) {
  // Use stacking radius for overlap detection (larger, based on actual object footprint)
  const droppedRadius = getStackingRadius(droppedObject);
  const droppedPhysics = getObjectPhysics(droppedObject);
  const baseY = getDeskSurfaceY();
  const droppedBaseOffset = OBJECT_PHYSICS[droppedObject.userData.type]?.baseOffset || 0;
  // Account for scale when calculating base offset
  const objectScale = droppedObject.userData.scale || droppedObject.scale.x || 1.0;

  // Default Y position (on desk surface) - apply scale to baseOffset
  let stackY = baseY + droppedBaseOffset * objectScale;

  // If dragLayerOffset was used, the user explicitly wants to stack on top
  const wantsToStackOnTop = dragLayerOffset > 0;

  // Collect all overlapping objects
  const overlappingObjects = [];

  // Check all other objects to see if we're above any of them
  deskObjects.forEach(obj => {
    if (obj === droppedObject) return;
    if (obj.userData.isFallen) return;

    // Use stacking radius for the other object too
    const otherRadius = getStackingRadius(obj);
    const otherPhysics = getObjectPhysics(obj);

    // Skip objects that don't allow stacking on top (e.g., round clock, tilted photo frame)
    if (otherPhysics.noStackingOnTop) return;

    // Calculate horizontal distance
    const dx = droppedObject.position.x - obj.position.x;
    const dz = droppedObject.position.z - obj.position.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);

    // Check if objects overlap horizontally (with generous tolerance for stacking)
    // Use 0.8 multiplier to make stacking easier - objects stack when significantly overlapping
    const overlapThreshold = (droppedRadius + otherRadius) * 0.8;

    if (horizontalDist < overlapThreshold) {
      // Calculate the top surface of the object below
      const otherScale = obj.userData.scale || obj.scale.x || 1.0;
      const objTopY = obj.position.y + otherPhysics.height * otherScale;
      overlappingObjects.push({ obj, topY: objTopY });
    }
  });

  // If there are overlapping objects, stack on top automatically
  // Stacking happens either when user scrolled up (dragLayerOffset > 0) OR when object is being lifted
  if (overlappingObjects.length > 0) {
    // Find the highest overlapping object
    const highestTop = overlappingObjects.reduce((max, o) => Math.max(max, o.topY), 0);

    // Safety check: don't stack on objects that are unreasonably high (likely a bug)
    const MAX_REASONABLE_HEIGHT = baseY + 3.0; // 3 units above desk is plenty
    if (highestTop > MAX_REASONABLE_HEIGHT) {
      // Ignore unreasonably high objects - they're likely stuck/bugged
      return stackY;
    }

    // Check if the dropped object was above desk level (lifted/stacking)
    const wasLifted = droppedObject.position.y > baseY + droppedBaseOffset * objectScale + 0.05;

    if (wantsToStackOnTop || wasLifted) {
      // Stack on top of all overlapping objects
      stackY = Math.max(stackY, highestTop + droppedBaseOffset * objectScale);
    }
    // If not lifted and not scrolled, use desk level (slide under)
  }

  // Final safety clamp to prevent objects from flying too high
  const MAX_STACK_HEIGHT = baseY + 2.5;
  stackY = Math.min(stackY, MAX_STACK_HEIGHT);

  return stackY;
}

// Calculate resistance when pulling an object from under other objects
// Returns a value from 0 (no resistance) to 1 (maximum resistance)
function calculatePullResistance(draggedObject, currentX, currentZ, targetX, targetZ) {
  // Use stacking radius for overlap detection
  const draggedRadius = getStackingRadius(draggedObject);
  const draggedPhysics = getObjectPhysics(draggedObject);
  let totalResistance = 0;

  // Check all other objects to see if dragged object is under any of them
  deskObjects.forEach(obj => {
    if (obj === draggedObject) return;
    if (obj.userData.isFallen) return;
    if (obj.userData.isLifted) return; // Don't apply resistance from lifted objects

    // Use stacking radius for the other object too
    const otherRadius = getStackingRadius(obj);
    const otherPhysics = getObjectPhysics(obj);

    // Calculate horizontal distance at current position
    const dx = currentX - obj.position.x;
    const dz = currentZ - obj.position.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);

    // Check if objects overlap horizontally
    const overlapThreshold = (draggedRadius + otherRadius) * 0.8;

    if (horizontalDist < overlapThreshold) {
      // Check if dragged object is UNDER this object (based on Y positions)
      const draggedScale = draggedObject.userData.scale || draggedObject.scale.x || 1.0;
      const draggedTop = draggedObject.position.y + draggedPhysics.height * draggedScale;
      const objBottom = obj.position.y;

      // If the object above us has its bottom at or above our top, we're under it
      if (objBottom >= draggedTop - 0.1 && objBottom < draggedTop + 0.3) {
        // Calculate how much we're trying to pull out from under
        const pullDist = Math.sqrt((targetX - currentX) ** 2 + (targetZ - currentZ) ** 2);
        // Resistance based on overlap and weight of object on top
        const overlap = 1 - (horizontalDist / overlapThreshold);
        const weightFactor = Math.min(1, (otherPhysics.weight || 0.5) * 0.5);
        totalResistance += overlap * weightFactor;
      }
    }
  });

  return Math.min(1, totalResistance);
}

function onMouseWheel(event) {
  updateMousePosition(event);

  // If in inspection+drawing mode: scroll zooms in/out on the object (no rotation)
  if (inspectionDrawingState.active && inspectionDrawingState.objectWorldPos) {
    event.preventDefault();

    // Zoom: scroll up = zoom in (closer), scroll down = zoom out (further)
    const zoomDelta = event.deltaY > 0 ? 0.08 : -0.08;
    inspectionDrawingState.zoomDistance = Math.max(0.3, Math.min(2.0, inspectionDrawingState.zoomDistance + zoomDelta));

    // Update camera position using cached object position
    const objectWorldPos = inspectionDrawingState.objectWorldPos;

    camera.position.set(
      objectWorldPos.x + inspectionDrawingState.panOffsetX,
      objectWorldPos.y + inspectionDrawingState.zoomDistance,
      objectWorldPos.z + 0.65 + inspectionDrawingState.panOffsetZ
    );
    return;
  }

  // If in book reading mode: scroll zooms in/out on the book (no rotation)
  if (bookReadingState.active && bookReadingState.book && bookReadingState.bookWorldPos) {
    event.preventDefault();

    // Zoom: scroll up = zoom in (closer), scroll down = zoom out (further)
    const zoomDelta = event.deltaY > 0 ? 0.08 : -0.08;
    bookReadingState.zoomDistance = Math.max(0.3, Math.min(2.0, bookReadingState.zoomDistance + zoomDelta));

    // Update camera position using cached book position
    const bookWorldPos = bookReadingState.bookWorldPos;

    camera.position.set(
      bookWorldPos.x + bookReadingState.panOffsetX,
      bookWorldPos.y + bookReadingState.zoomDistance,
      bookWorldPos.z + 0.65 + bookReadingState.panOffsetZ
    );
    return;
  }

  // If in player mode: scroll zooms in/out on the player (no rotation)
  if (playerModeState.active && playerModeState.player && playerModeState.playerWorldPos) {
    event.preventDefault();

    // If in button navigation mode (not front view), scroll resets to front view for zooming
    if (playerModeState.currentButtonIndex !== -1) {
      playerModeState.currentButtonIndex = -1;
    }

    // Zoom: scroll up = zoom in (closer), scroll down = zoom out (further)
    const zoomDelta = event.deltaY > 0 ? 0.05 : -0.05;
    const playerScale = playerModeState.player.scale.x || 1;
    playerModeState.zoomDistance = Math.max(0.1 * playerScale, Math.min(0.8 * playerScale, playerModeState.zoomDistance + zoomDelta));

    // Update camera position using cached player position
    const playerWorldPos = playerModeState.playerWorldPos;
    const viewDistance = playerModeState.zoomDistance;

    camera.position.set(
      playerWorldPos.x + playerModeState.panOffsetX,
      playerWorldPos.y + playerModeState.panOffsetY, // Move up/down with W/S
      playerWorldPos.z + viewDistance
    );

    // Update camera pitch to look straight at the player (level view)
    cameraLookState.pitch = 0; // Level with the player
    updateCameraLook();

    return;
  }

  // If in examine mode: scroll rotates object, LMB held + scroll UP exits, Shift+scroll scales
  // Check if modal is open - Shift+scroll for scaling should work even with modal open
  const modal = document.getElementById('interaction-modal');
  const isModalOpen = modal && modal.classList.contains('open');

  if (examineState.active && examineState.object) {
    const object = examineState.object;

    // Shift+scroll scales object - should work even when modal is open
    if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation(); // Prevent modal from capturing this event
      // Scale object (preserving proportions) with Shift+scroll
      const scaleDelta = event.deltaY > 0 ? 0.95 : 1.05;
      const minScale = 0.3;
      // Books, magazines, cassette player, and dictaphone can be scaled larger for reading/interaction
      let maxScale = 3.0;
      if (object.userData.type === 'magazine' || object.userData.type === 'cassette-player' || object.userData.type === 'big-cassette-player') {
        maxScale = 10.0;
      } else if (object.userData.type === 'books') {
        maxScale = 5.0;
      } else if (object.userData.type === 'dictaphone') {
        maxScale = 6.0; // 2x of the default 3.0 scale
      }

      const oldScale = object.scale.x;
      const newScale = oldScale * scaleDelta;
      if (newScale >= minScale && newScale <= maxScale) {
        object.scale.set(newScale, newScale, newScale);
        object.userData.scale = newScale;
        // Update the examine scale target to match the new scale
        // so the animation doesn't fight with the manual scale
        object.userData.examineScaleTarget = newScale;
        // Also update original scale so it persists when exiting examine mode
        if (examineState.originalScale) {
          examineState.originalScale.set(newScale, newScale, newScale);
        }
        // Adjust original Y position for when object returns to desk
        adjustObjectYForScale(object, oldScale, newScale);
        saveState();
      }
      return;
    }

    // Skip rotation/exit controls if modal is open (don't interfere with modal scrolling)
    if (isModalOpen) {
      return;
    }

    event.preventDefault();

    // Scroll UP (deltaY < 0) with LMB held exits examine mode
    // This prevents accidental exits
    if (event.deltaY < 0 && !event.shiftKey && event.buttons === 1) {
      exitExamineMode();
      return;
    }

    // Scroll (both UP and DOWN) rotates object around Y axis
    // Scroll DOWN (deltaY > 0) rotates clockwise, scroll UP (deltaY < 0) rotates counter-clockwise
    const rotationDelta = event.deltaY > 0 ? 0.15 : -0.15;
    object.rotation.y += rotationDelta;
    object.userData.rotationY = object.rotation.y;
    saveState();
    return;
  }

  // If dragging an object
  if (isDragging && selectedObject) {
    event.preventDefault();

    if (event.deltaY > 0) {
      // Scroll down - enter examine mode (brings object closer)
      isDragging = false;
      selectedObject.userData.isLifted = false;
      selectedObject.userData.targetY = selectedObject.userData.originalY;
      dragLayerOffset = 0; // Reset layer offset
      enterExamineMode(selectedObject);
    } else if (event.deltaY < 0) {
      // Scroll up during drag - increase layer offset to stack on top
      dragLayerOffset += 5;
    }
    return;
  }

  // Check if hovering over an object
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(deskObjects, true);

  if (intersects.length > 0) {
    // Find the root object
    let object = intersects[0].object;
    while (object.parent && !deskObjects.includes(object)) {
      object = object.parent;
    }

    if (deskObjects.includes(object)) {
      event.preventDefault();

      // Check if Shift key is held for scaling, otherwise rotate
      if (event.shiftKey) {
        // Scale object (preserving proportions)
        const scaleDelta = event.deltaY > 0 ? 0.95 : 1.05;
        const minScale = 0.3;
        // Books, magazines, cassette player, and dictaphone can be scaled larger for reading/interaction
        let maxScale = 3.0;
        if (object.userData.type === 'magazine' || object.userData.type === 'cassette-player' || object.userData.type === 'big-cassette-player') {
          maxScale = 10.0;
        } else if (object.userData.type === 'books') {
          maxScale = 5.0;
        } else if (object.userData.type === 'dictaphone') {
          maxScale = 6.0; // 2x of the default 3.0 scale
        }

        const oldScale = object.scale.x;
        const newScale = oldScale * scaleDelta;
        if (newScale >= minScale && newScale <= maxScale) {
          object.scale.set(newScale, newScale, newScale);
          object.userData.scale = newScale;
          // Adjust Y position to keep object on desk surface
          adjustObjectYForScale(object, oldScale, newScale);
          saveState();
        }
      } else {
        // Rotate object around Y axis (perpendicular to desk)
        const rotationDelta = event.deltaY > 0 ? 0.15 : -0.15;
        object.rotation.y += rotationDelta;
        object.userData.rotationY = object.rotation.y;
        saveState();
      }
    }
  } else {
    // If not hovering over an object, adjust camera distance ONLY if Alt is held
    if (event.altKey) {
      event.preventDefault();
      const zoomDelta = event.deltaY > 0 ? 0.3 : -0.3;

      // Calculate new camera position (move along the view direction)
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);

      const newX = camera.position.x - direction.x * zoomDelta;
      const newY = camera.position.y - direction.y * zoomDelta;
      const newZ = camera.position.z - direction.z * zoomDelta;

      // Limit camera distance
      const minDistance = 3;
      const maxDistance = 15;
      const lookAt = new THREE.Vector3(CONFIG.camera.lookAt.x, CONFIG.camera.lookAt.y, CONFIG.camera.lookAt.z);
      const newPos = new THREE.Vector3(newX, newY, newZ);
      const distance = newPos.distanceTo(lookAt);

      if (distance >= minDistance && distance <= maxDistance) {
        camera.position.set(newX, newY, newZ);
        saveState();
      }
    }
  }
}

function onRightClick(event) {
  event.preventDefault();
  // Don't re-process if customization panel is already open
  // This prevents contextmenu from closing the panel opened by mousedown
  const panel = document.getElementById('customization-panel');
  if (panel && panel.classList.contains('open')) {
    return;
  }
  handleRightClick(event);
}

// Handle right-click for edit mode - works both when pointer is locked and unlocked
function handleRightClick(event) {
  // When pointer is locked, use screen center for raycasting
  // When unlocked, use mouse position
  let raycastMouse;
  if (pointerLockState.isLocked) {
    raycastMouse = new THREE.Vector2(0, 0); // Screen center
  } else {
    updateMousePosition(event);
    raycastMouse = mouse;
  }

  raycaster.setFromCamera(raycastMouse, camera);
  const intersects = raycaster.intersectObjects(deskObjects, true);

  // Filter intersections to only consider objects within a reasonable distance (10 units)
  // Increased from 5 to 10 to ensure objects at the edge of the desk are detected
  const validIntersects = intersects.filter(hit => hit.distance < 10);

  if (validIntersects.length > 0) {
    let object = validIntersects[0].object;
    while (object.parent && !deskObjects.includes(object)) {
      object = object.parent;
    }

    if (deskObjects.includes(object)) {
      selectedObject = object;

      // Exit pointer lock to show cursor for panel interaction
      if (pointerLockState.isLocked) {
        document.exitPointerLock();
      }

      // Update customization panel
      document.getElementById('customization-title').textContent = `Customize: ${object.userData.name}`;
      document.getElementById('customization-panel').classList.add('open');

      // Highlight current colors
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));

      if (object.userData.mainColor) {
        const mainSwatch = document.querySelector(`#main-colors .color-swatch[data-color="${object.userData.mainColor}"]`);
        if (mainSwatch) mainSwatch.classList.add('selected');
      }

      if (object.userData.accentColor) {
        const accentSwatch = document.querySelector(`#accent-colors .color-swatch[data-color="${object.userData.accentColor}"]`);
        if (accentSwatch) accentSwatch.classList.add('selected');
      }

      // Add object-specific customization options
      updateCustomizationPanel(object);

      // Update per-object collision settings sliders
      updateObjectCollisionUI(object);
    }
  } else {
    // RMB on empty space - only open left sidebar if right sidebar is not open
    // This ensures right sidebar (customization panel) has priority
    const customizationPanel = document.getElementById('customization-panel');
    if (!customizationPanel.classList.contains('open')) {
      // Clear any selected object
      selectedObject = null;
      // Clear dynamic options
      const dynamicOptions = document.getElementById('object-specific-options');
      if (dynamicOptions) dynamicOptions.innerHTML = '';

      // Open left sidebar menu
      const menu = document.getElementById('menu');
      menu.classList.add('open');
      // Exit pointer lock when opening menu so cursor is visible
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    }
  }
}

// Update per-object collision settings UI when an object is selected
function updateObjectCollisionUI(object) {
  const radiusSlider = document.getElementById('object-collision-radius-slider');
  const radiusValue = document.getElementById('object-collision-radius-value');
  const heightSlider = document.getElementById('object-collision-height-slider');
  const heightValue = document.getElementById('object-collision-height-value');

  if (radiusSlider && radiusValue) {
    const radiusMultiplier = object.userData.objectCollisionRadiusMultiplier || 1.0;
    const radiusPercent = Math.round(radiusMultiplier * 100);
    radiusSlider.value = radiusPercent;
    radiusValue.textContent = radiusPercent + '%';
  }

  if (heightSlider && heightValue) {
    const heightMultiplier = object.userData.objectCollisionHeightMultiplier || 1.0;
    const heightPercent = Math.round(heightMultiplier * 100);
    heightSlider.value = heightPercent;
    heightValue.textContent = heightPercent + '%';
  }
}

// Update customization panel with object-specific options
function updateCustomizationPanel(object) {
  // Get or create the dynamic options container
  let dynamicOptions = document.getElementById('object-specific-options');
  if (!dynamicOptions) {
    // Create container after accent colors but before delete button
    dynamicOptions = document.createElement('div');
    dynamicOptions.id = 'object-specific-options';
    const deleteBtn = document.getElementById('delete-object');
    deleteBtn.parentNode.insertBefore(dynamicOptions, deleteBtn);
  }

  // Clear existing content
  dynamicOptions.innerHTML = '';

  // Add object-specific options based on type
  switch (object.userData.type) {
    case 'coffee':
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Drink Type</label>
          <div class="color-picker-container" id="drink-types" style="flex-direction: column; gap: 8px;">
            ${Object.entries(DRINK_COLORS).map(([key, drink]) => `
              <button class="drink-option ${object.userData.drinkType === key ? 'selected' : ''}"
                      data-drink="${key}"
                      style="width: 100%; padding: 8px 12px; background: ${object.userData.drinkType === key ? 'rgba(79, 70, 229, 0.3)' : 'rgba(255,255,255,0.1)'}; border: 1px solid ${object.userData.drinkType === key ? 'rgba(79, 70, 229, 0.6)' : 'rgba(255,255,255,0.2)'}; border-radius: 8px; color: #fff; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 10px;">
                <span style="width: 20px; height: 20px; border-radius: 4px; background: #${drink.color.toString(16).padStart(6, '0')};"></span>
                ${drink.name}
              </button>
            `).join('')}
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Fill Level: <span id="fill-level-display">${Math.round(object.userData.liquidLevel * 100)}%</span></label>
          <input type="range" id="fill-level" min="0" max="100" value="${object.userData.liquidLevel * 100}"
                 style="width: 100%; margin-top: 8px; accent-color: #4f46e5;">
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
            <input type="checkbox" id="hot-drink" ${object.userData.isHot ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #4f46e5;">
            Hot drink (shows steam)
          </label>
        </div>
      `;
      setupMugCustomizationHandlers(object);
      break;

    case 'metronome':
      const volumePercent = Math.round((object.userData.volume || 0.5) * 100);
      const pitchPercent = object.userData.tickPitch || 100;
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>BPM: <span id="bpm-display">${object.userData.bpm}</span></label>
          <input type="range" id="metronome-bpm-edit" min="10" max="220" value="${object.userData.bpm}"
                 style="width: 100%; margin-top: 8px; accent-color: #4f46e5;">
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Volume: <span id="volume-display">${volumePercent}%</span></label>
          <input type="range" id="metronome-volume-edit" min="0" max="100" value="${volumePercent}"
                 style="width: 100%; margin-top: 8px; accent-color: #4f46e5;">
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Pitch: <span id="pitch-display">${pitchPercent}%</span></label>
          <input type="range" id="metronome-pitch-edit" min="50" max="200" value="${pitchPercent}"
                 style="width: 100%; margin-top: 8px; accent-color: #4f46e5;">
        </div>

        <!-- FL Studio-style Pitch Curve Editor -->
        <div class="customization-group" style="margin-top: 15px;">
          <div id="pitch-curve-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; cursor: pointer;">
            <span style="color: rgba(255,255,255,0.8); font-size: 12px;">🎵 Pitch Automation Curve</span>
            <span id="pitch-curve-arrow" style="color: rgba(255,255,255,0.5); font-size: 12px;">▼</span>
          </div>
          <div id="pitch-curve-content" style="display: none; border: 1px solid rgba(255,255,255,0.1); border-top: none; border-radius: 0 0 8px 8px;">
            <div id="pitch-curve-editor-container"></div>
          </div>
        </div>

        <!-- FL Studio-style Tempo Curve Editor -->
        <div class="customization-group" style="margin-top: 15px;">
          <div id="tempo-curve-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; cursor: pointer;">
            <span style="color: rgba(255,255,255,0.8); font-size: 12px;">⏱️ Tempo Automation Curve</span>
            <span id="tempo-curve-arrow" style="color: rgba(255,255,255,0.5); font-size: 12px;">▼</span>
          </div>
          <div id="tempo-curve-content" style="display: none; border: 1px solid rgba(255,255,255,0.1); border-top: none; border-radius: 0 0 8px 8px;">
            <div id="tempo-curve-editor-container"></div>
          </div>
        </div>

        <div class="customization-group" style="margin-top: 15px;">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
            <input type="checkbox" id="tick-sound" ${object.userData.tickSound ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #4f46e5;">
            Enable tick sound
          </label>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Sound Type</label>
          <div style="display: flex; gap: 10px; margin-top: 8px;">
            <button id="sound-type-strike" class="timer-btn ${object.userData.tickSoundType !== 'beep' && object.userData.tickSoundType !== 'custom' ? 'pause' : 'start'}" style="flex: 1;">
              Strike
            </button>
            <button id="sound-type-beep" class="timer-btn ${object.userData.tickSoundType === 'beep' ? 'pause' : 'start'}" style="flex: 1;">
              Beep
            </button>
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Custom Sound File</label>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
            <label style="display: inline-block; padding: 10px 15px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 8px; color: #fff; cursor: pointer; text-align: center;">
              ${object.userData.customSoundDataUrl ? 'Change Sound' : 'Upload Sound'}
              <input type="file" id="metronome-custom-sound" accept="audio/*" style="display: none;">
            </label>
            ${object.userData.customSoundDataUrl ? `
              <button id="sound-type-custom" class="timer-btn ${object.userData.tickSoundType === 'custom' ? 'pause' : 'start'}" style="width: 100%;">
                Use Custom Sound
              </button>
              <button id="metronome-clear-sound" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #ef4444; cursor: pointer;">
                Clear Sound
              </button>
            ` : ''}
          </div>
        </div>
      `;
      setupMetronomeCustomizationHandlers(object);
      break;

    case 'photo-frame':
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Photo</label>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
            <label style="display: inline-block; padding: 10px 15px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 8px; color: #fff; cursor: pointer; text-align: center;">
              Choose Photo
              <input type="file" id="photo-upload-edit" accept="image/*" style="display: none;">
            </label>
            <button id="photo-clear-edit" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #ef4444; cursor: pointer;">
              Clear Photo
            </button>
          </div>
        </div>
      `;
      setupPhotoFrameCustomizationHandlers(object);
      break;

    case 'books':
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Book Title</label>
          <textarea id="book-title-edit" placeholder="Enter book title"
                 style="width: 100%; min-height: 40px; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #fff; margin-top: 8px; resize: vertical; font-family: inherit; font-size: inherit;">${object.userData.bookTitle || ''}</textarea>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Title Color</label>
          <div id="book-title-colors" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;">
            <div class="color-swatch${(object.userData.titleColor || '#ffffff') === '#ffffff' ? ' selected' : ''}" style="background: #ffffff; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${(object.userData.titleColor || '#ffffff') === '#ffffff' ? '#fff' : 'transparent'};" data-color="#ffffff"></div>
            <div class="color-swatch${object.userData.titleColor === '#000000' ? ' selected' : ''}" style="background: #000000; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#000000' ? '#fff' : 'rgba(255,255,255,0.3)'};" data-color="#000000"></div>
            <div class="color-swatch${object.userData.titleColor === '#fbbf24' ? ' selected' : ''}" style="background: #fbbf24; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#fbbf24' ? '#fff' : 'transparent'};" data-color="#fbbf24"></div>
            <div class="color-swatch${object.userData.titleColor === '#ef4444' ? ' selected' : ''}" style="background: #ef4444; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#ef4444' ? '#fff' : 'transparent'};" data-color="#ef4444"></div>
            <div class="color-swatch${object.userData.titleColor === '#22c55e' ? ' selected' : ''}" style="background: #22c55e; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#22c55e' ? '#fff' : 'transparent'};" data-color="#22c55e"></div>
            <div class="color-swatch${object.userData.titleColor === '#3b82f6' ? ' selected' : ''}" style="background: #3b82f6; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#3b82f6' ? '#fff' : 'transparent'};" data-color="#3b82f6"></div>
            <div class="color-swatch${object.userData.titleColor === '#8b5cf6' ? ' selected' : ''}" style="background: #8b5cf6; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#8b5cf6' ? '#fff' : 'transparent'};" data-color="#8b5cf6"></div>
            <div class="color-swatch${object.userData.titleColor === '#ec4899' ? ' selected' : ''}" style="background: #ec4899; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#ec4899' ? '#fff' : 'transparent'};" data-color="#ec4899"></div>
            <div class="color-swatch${object.userData.titleColor === '#c084fc' ? ' selected' : ''}" style="background: #c084fc; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#c084fc' ? '#fff' : 'transparent'};" data-color="#c084fc"></div>
            <div class="color-swatch${object.userData.titleColor === '#64748b' ? ' selected' : ''}" style="background: #64748b; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#64748b' ? '#fff' : 'transparent'};" data-color="#64748b"></div>
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>PDF File</label>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
            <label style="display: inline-block; padding: 10px 15px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 8px; color: #fff; cursor: pointer; text-align: center;">
              ${object.userData.pdfPath ? 'Change PDF' : 'Choose PDF'}
              <input type="file" id="book-pdf-edit" accept=".pdf" style="display: none;">
            </label>
            ${object.userData.pdfPath ? `
              <div style="color: rgba(255,255,255,0.5); font-size: 12px;">
                Current: ${object.userData.pdfPath.split('/').pop() || object.userData.pdfPath.split('\\\\').pop()}
              </div>
              <button id="book-pdf-clear-edit" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #ef4444; cursor: pointer;">
                Clear PDF
              </button>
            ` : ''}
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>PDF Resolution: <span id="pdf-resolution-display">${object.userData.pdfResolution || 512}px</span></label>
          <input type="range" id="book-pdf-resolution" min="384" max="1536" step="128" value="${object.userData.pdfResolution || 512}"
                 style="width: 100%; margin-top: 8px; accent-color: #4f46e5;">
          <div style="display: flex; justify-content: space-between; color: rgba(255,255,255,0.4); font-size: 10px; margin-top: 4px;">
            <span>Fast</span>
            <span>Quality</span>
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Cover Image (optional)</label>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
            <label style="display: inline-block; padding: 10px 15px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 8px; color: #fff; cursor: pointer; text-align: center;">
              Upload Image
              <input type="file" id="book-cover-image" accept="image/*" style="display: none;">
            </label>
            <button id="book-cover-use-pdf" style="padding: 10px 15px; background: rgba(34, 197, 94, 0.2); border: 1px solid rgba(34, 197, 94, 0.4); border-radius: 8px; color: #22c55e; cursor: pointer;${object.userData.pdfDocument ? '' : ' opacity: 0.5;'}">
              Use PDF Page 1 as Cover${object.userData.pdfDocument ? '' : ' (load PDF first)'}
            </button>
            ${object.userData.coverImageDataUrl ? `
              <div style="color: rgba(255,255,255,0.5); font-size: 12px;">
                Cover image set
              </div>
              <button id="book-cover-clear" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #ef4444; cursor: pointer;">
                Clear Cover Image
              </button>
            ` : ''}
          </div>
        </div>
        ${object.userData.coverImageDataUrl ? `
        <div class="customization-group" style="margin-top: 15px;">
          <label>Cover Position</label>
          <div id="book-cover-fit-mode" style="display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap;">
            <button class="fit-mode-btn${object.userData.coverFitMode === 'contain' ? ' selected' : ''}" data-mode="contain" style="padding: 8px 12px; background: ${object.userData.coverFitMode === 'contain' ? 'rgba(79, 70, 229, 0.5)' : 'rgba(255,255,255,0.1)'}; border: 1px solid ${object.userData.coverFitMode === 'contain' ? 'rgba(79, 70, 229, 0.8)' : 'rgba(255,255,255,0.2)'}; border-radius: 6px; color: #fff; cursor: pointer; font-size: 12px;">
              Fit Width
            </button>
            <button class="fit-mode-btn${object.userData.coverFitMode === 'cover' ? ' selected' : ''}" data-mode="cover" style="padding: 8px 12px; background: ${object.userData.coverFitMode === 'cover' ? 'rgba(79, 70, 229, 0.5)' : 'rgba(255,255,255,0.1)'}; border: 1px solid ${object.userData.coverFitMode === 'cover' ? 'rgba(79, 70, 229, 0.8)' : 'rgba(255,255,255,0.2)'}; border-radius: 6px; color: #fff; cursor: pointer; font-size: 12px;">
              Fill Cover
            </button>
            <button class="fit-mode-btn${object.userData.coverFitMode === 'stretch' ? ' selected' : ''}" data-mode="stretch" style="padding: 8px 12px; background: ${object.userData.coverFitMode === 'stretch' ? 'rgba(79, 70, 229, 0.5)' : 'rgba(255,255,255,0.1)'}; border: 1px solid ${object.userData.coverFitMode === 'stretch' ? 'rgba(79, 70, 229, 0.8)' : 'rgba(255,255,255,0.2)'}; border-radius: 6px; color: #fff; cursor: pointer; font-size: 12px;">
              Stretch
            </button>
          </div>
          <div style="color: rgba(255,255,255,0.4); font-size: 11px; margin-top: 6px;">
            ${object.userData.coverFitMode === 'contain' ? 'Image fits within cover width, may show background' : object.userData.coverFitMode === 'cover' ? 'Image fills entire cover, may crop edges' : 'Image stretched to fit exactly'}
          </div>
        </div>
        ` : ''}
      `;
      setupBookCustomizationHandlers(object);
      break;

    case 'magazine':
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Magazine Title</label>
          <textarea id="magazine-title-edit" placeholder="Enter magazine title"
                 style="width: 100%; min-height: 40px; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #fff; margin-top: 8px; resize: vertical; font-family: inherit; font-size: inherit;">${object.userData.magazineTitle || ''}</textarea>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Title Color</label>
          <div id="magazine-title-colors" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;">
            <div class="color-swatch${(object.userData.titleColor || '#ffffff') === '#ffffff' ? ' selected' : ''}" style="background: #ffffff; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${(object.userData.titleColor || '#ffffff') === '#ffffff' ? '#fff' : 'transparent'};" data-color="#ffffff"></div>
            <div class="color-swatch${object.userData.titleColor === '#000000' ? ' selected' : ''}" style="background: #000000; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#000000' ? '#fff' : 'rgba(255,255,255,0.3)'};" data-color="#000000"></div>
            <div class="color-swatch${object.userData.titleColor === '#fbbf24' ? ' selected' : ''}" style="background: #fbbf24; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#fbbf24' ? '#fff' : 'transparent'};" data-color="#fbbf24"></div>
            <div class="color-swatch${object.userData.titleColor === '#ef4444' ? ' selected' : ''}" style="background: #ef4444; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#ef4444' ? '#fff' : 'transparent'};" data-color="#ef4444"></div>
            <div class="color-swatch${object.userData.titleColor === '#22c55e' ? ' selected' : ''}" style="background: #22c55e; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#22c55e' ? '#fff' : 'transparent'};" data-color="#22c55e"></div>
            <div class="color-swatch${object.userData.titleColor === '#3b82f6' ? ' selected' : ''}" style="background: #3b82f6; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#3b82f6' ? '#fff' : 'transparent'};" data-color="#3b82f6"></div>
            <div class="color-swatch${object.userData.titleColor === '#8b5cf6' ? ' selected' : ''}" style="background: #8b5cf6; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#8b5cf6' ? '#fff' : 'transparent'};" data-color="#8b5cf6"></div>
            <div class="color-swatch${object.userData.titleColor === '#ec4899' ? ' selected' : ''}" style="background: #ec4899; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#ec4899' ? '#fff' : 'transparent'};" data-color="#ec4899"></div>
            <div class="color-swatch${object.userData.titleColor === '#c084fc' ? ' selected' : ''}" style="background: #c084fc; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#c084fc' ? '#fff' : 'transparent'};" data-color="#c084fc"></div>
            <div class="color-swatch${object.userData.titleColor === '#64748b' ? ' selected' : ''}" style="background: #64748b; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${object.userData.titleColor === '#64748b' ? '#fff' : 'transparent'};" data-color="#64748b"></div>
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>PDF File</label>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
            <label style="display: inline-block; padding: 10px 15px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 8px; color: #fff; cursor: pointer; text-align: center;">
              ${object.userData.pdfPath ? 'Change PDF' : 'Choose PDF'}
              <input type="file" id="magazine-pdf-edit" accept=".pdf" style="display: none;">
            </label>
            ${object.userData.pdfPath ? `
              <div style="color: rgba(255,255,255,0.5); font-size: 12px;">
                Current: ${object.userData.pdfPath.split('/').pop() || object.userData.pdfPath.split('\\\\').pop()}
              </div>
              <button id="magazine-pdf-clear-edit" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #ef4444; cursor: pointer;">
                Clear PDF
              </button>
            ` : ''}
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>PDF Resolution: <span id="magazine-pdf-resolution-display">${object.userData.pdfResolution || 512}px</span></label>
          <input type="range" id="magazine-pdf-resolution" min="384" max="1536" step="128" value="${object.userData.pdfResolution || 512}"
                 style="width: 100%; margin-top: 8px; accent-color: #4f46e5;">
          <div style="display: flex; justify-content: space-between; color: rgba(255,255,255,0.4); font-size: 10px; margin-top: 4px;">
            <span>Fast</span>
            <span>Quality</span>
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Cover Image (optional)</label>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
            <label style="display: inline-block; padding: 10px 15px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 8px; color: #fff; cursor: pointer; text-align: center;">
              Upload Image
              <input type="file" id="magazine-cover-image" accept="image/*" style="display: none;">
            </label>
            <button id="magazine-cover-use-pdf" style="padding: 10px 15px; background: rgba(34, 197, 94, 0.2); border: 1px solid rgba(34, 197, 94, 0.4); border-radius: 8px; color: #22c55e; cursor: pointer;${object.userData.pdfDocument ? '' : ' opacity: 0.5;'}">
              Use PDF Page 1 as Cover${object.userData.pdfDocument ? '' : ' (load PDF first)'}
            </button>
            ${object.userData.coverImageDataUrl ? `
              <div style="color: rgba(255,255,255,0.5); font-size: 12px;">
                Cover image set
              </div>
              <button id="magazine-cover-clear" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #ef4444; cursor: pointer;">
                Clear Cover Image
              </button>
            ` : ''}
          </div>
        </div>
        ${object.userData.coverImageDataUrl ? `
        <div class="customization-group" style="margin-top: 15px;">
          <label>Cover Position</label>
          <div id="magazine-cover-fit-mode" style="display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap;">
            <button class="fit-mode-btn${object.userData.coverFitMode === 'contain' ? ' selected' : ''}" data-mode="contain" style="padding: 8px 12px; background: ${object.userData.coverFitMode === 'contain' ? 'rgba(79, 70, 229, 0.5)' : 'rgba(255,255,255,0.1)'}; border: 1px solid ${object.userData.coverFitMode === 'contain' ? 'rgba(79, 70, 229, 0.8)' : 'rgba(255,255,255,0.2)'}; border-radius: 6px; color: #fff; cursor: pointer; font-size: 12px;">
              Fit Width
            </button>
            <button class="fit-mode-btn${object.userData.coverFitMode === 'cover' ? ' selected' : ''}" data-mode="cover" style="padding: 8px 12px; background: ${object.userData.coverFitMode === 'cover' ? 'rgba(79, 70, 229, 0.5)' : 'rgba(255,255,255,0.1)'}; border: 1px solid ${object.userData.coverFitMode === 'cover' ? 'rgba(79, 70, 229, 0.8)' : 'rgba(255,255,255,0.2)'}; border-radius: 6px; color: #fff; cursor: pointer; font-size: 12px;">
              Fill Cover
            </button>
            <button class="fit-mode-btn${object.userData.coverFitMode === 'stretch' ? ' selected' : ''}" data-mode="stretch" style="padding: 8px 12px; background: ${object.userData.coverFitMode === 'stretch' ? 'rgba(79, 70, 229, 0.5)' : 'rgba(255,255,255,0.1)'}; border: 1px solid ${object.userData.coverFitMode === 'stretch' ? 'rgba(79, 70, 229, 0.8)' : 'rgba(255,255,255,0.2)'}; border-radius: 6px; color: #fff; cursor: pointer; font-size: 12px;">
              Stretch
            </button>
          </div>
          <div style="color: rgba(255,255,255,0.4); font-size: 11px; margin-top: 6px;">
            ${object.userData.coverFitMode === 'contain' ? 'Image fits within cover width, may show background' : object.userData.coverFitMode === 'cover' ? 'Image fills entire cover, may crop edges' : 'Image stretched to fit exactly'}
          </div>
        </div>
        ` : ''}
      `;
      setupMagazineCustomizationHandlers(object);
      break;

    case 'pen':
      const penBodyColor = object.userData.mainColor || '#3b82f6';
      const penInkColor = object.userData.inkColor || object.userData.mainColor || '#3b82f6';
      const penLineWidth = object.userData.lineWidth || 2;
      const penSaveFolder = object.userData.drawingsSaveFolder || '';
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Body Color</label>
          <div id="pen-body-colors" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;">
            <div class="color-swatch${penBodyColor === '#3b82f6' ? ' selected' : ''}" style="background: #3b82f6; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#3b82f6' ? '#fff' : 'transparent'};" data-color="#3b82f6"></div>
            <div class="color-swatch${penBodyColor === '#ef4444' ? ' selected' : ''}" style="background: #ef4444; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#ef4444' ? '#fff' : 'transparent'};" data-color="#ef4444"></div>
            <div class="color-swatch${penBodyColor === '#22c55e' ? ' selected' : ''}" style="background: #22c55e; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#22c55e' ? '#fff' : 'transparent'};" data-color="#22c55e"></div>
            <div class="color-swatch${penBodyColor === '#1a1a1a' ? ' selected' : ''}" style="background: #1a1a1a; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#1a1a1a' ? '#fff' : 'rgba(255,255,255,0.3)'};" data-color="#1a1a1a"></div>
            <div class="color-swatch${penBodyColor === '#8b5cf6' ? ' selected' : ''}" style="background: #8b5cf6; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#8b5cf6' ? '#fff' : 'transparent'};" data-color="#8b5cf6"></div>
            <div class="color-swatch${penBodyColor === '#f97316' ? ' selected' : ''}" style="background: #f97316; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#f97316' ? '#fff' : 'transparent'};" data-color="#f97316"></div>
            <div class="color-swatch${penBodyColor === '#ec4899' ? ' selected' : ''}" style="background: #ec4899; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#ec4899' ? '#fff' : 'transparent'};" data-color="#ec4899"></div>
            <div class="color-swatch${penBodyColor === '#06b6d4' ? ' selected' : ''}" style="background: #06b6d4; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penBodyColor === '#06b6d4' ? '#fff' : 'transparent'};" data-color="#06b6d4"></div>
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Ink Color (for writing)</label>
          <div id="pen-ink-colors" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;">
            <div class="color-swatch${penInkColor === '#3b82f6' ? ' selected' : ''}" style="background: #3b82f6; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#3b82f6' ? '#fff' : 'transparent'};" data-color="#3b82f6"></div>
            <div class="color-swatch${penInkColor === '#ef4444' ? ' selected' : ''}" style="background: #ef4444; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#ef4444' ? '#fff' : 'transparent'};" data-color="#ef4444"></div>
            <div class="color-swatch${penInkColor === '#22c55e' ? ' selected' : ''}" style="background: #22c55e; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#22c55e' ? '#fff' : 'transparent'};" data-color="#22c55e"></div>
            <div class="color-swatch${penInkColor === '#000000' ? ' selected' : ''}" style="background: #000000; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#000000' ? '#fff' : 'rgba(255,255,255,0.3)'};" data-color="#000000"></div>
            <div class="color-swatch${penInkColor === '#8b5cf6' ? ' selected' : ''}" style="background: #8b5cf6; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#8b5cf6' ? '#fff' : 'transparent'};" data-color="#8b5cf6"></div>
            <div class="color-swatch${penInkColor === '#f97316' ? ' selected' : ''}" style="background: #f97316; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#f97316' ? '#fff' : 'transparent'};" data-color="#f97316"></div>
            <div class="color-swatch${penInkColor === '#ec4899' ? ' selected' : ''}" style="background: #ec4899; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#ec4899' ? '#fff' : 'transparent'};" data-color="#ec4899"></div>
            <div class="color-swatch${penInkColor === '#06b6d4' ? ' selected' : ''}" style="background: #06b6d4; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 2px solid ${penInkColor === '#06b6d4' ? '#fff' : 'transparent'};" data-color="#06b6d4"></div>
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Line Width</label>
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px;">
            <input type="range" id="pen-line-width" min="1" max="10" value="${penLineWidth}"
                   style="flex: 1; cursor: pointer;">
            <span id="pen-line-width-val" style="color: rgba(255,255,255,0.7); font-size: 12px; min-width: 30px;">${penLineWidth}px</span>
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Save Drawings To</label>
          <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
            <div id="pen-save-folder-display" style="font-size: 11px; color: rgba(255,255,255,0.6); word-break: break-all; min-height: 20px;">
              ${penSaveFolder || 'Default (app data folder)'}
            </div>
            <button id="pen-select-folder-btn" style="padding: 8px 12px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 6px; color: #fff; cursor: pointer; font-size: 12px;">
              📁 Select Folder
            </button>
            ${penSaveFolder ? `
              <button id="pen-clear-folder-btn" style="padding: 8px 12px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; color: #ef4444; cursor: pointer; font-size: 12px;">
                Clear (use default)
              </button>
            ` : ''}
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
            <input type="checkbox" id="pen-show-ray" ${object.userData.showDrawingRay ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #4f46e5;">
            Show Drawing Ray (Debug)
          </label>
          <div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 8px; line-height: 1.5;">
            When checked, visualizes the ray used to calculate drawing position on surfaces.
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <div style="padding: 12px; background: rgba(79, 70, 229, 0.2); border-radius: 8px; border: 1px solid rgba(79, 70, 229, 0.3);">
            <div style="font-size: 13px; color: rgba(255,255,255,0.9); margin-bottom: 8px;">🖊️ Drawing Mode</div>
            <div style="font-size: 11px; color: rgba(255,255,255,0.6); line-height: 1.5;">
              1. Pick up the pen (LMB)<br>
              2. Hold MMB on pen to enter drawing mode<br>
              3. Move pen over notebook/paper and hold LMB to draw<br>
              4. Hold MMB again to exit and save<br>
              <br>
              💡 You can also hold MMB on a notebook/paper to enter inspection mode with zoom and panning.
            </div>
          </div>
        </div>
      `;
      setupPenCustomizationHandlers(object);
      break;

    case 'notebook':
    case 'paper':
      const hasTransparentBg = object.userData.transparentBackground === true;
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
            <input type="checkbox" id="transparent-background" ${hasTransparentBg ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #4f46e5;">
            Transparent Background
          </label>
          <div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 8px; line-height: 1.5;">
            When unchecked, drawings will have a white background. When checked, drawings will have a transparent background.
          </div>
        </div>
      `;
      setupNotebookPaperCustomizationHandlers(object);
      break;

    case 'laptop':
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Power Button</label>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <label style="color: rgba(255,255,255,0.7); font-size: 12px;">Color:</label>
              <input type="color" id="laptop-power-btn-color" value="${object.userData.powerButtonColor || '#ff0000'}"
                     style="width: 40px; height: 24px; border: none; cursor: pointer; border-radius: 4px;">
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <label style="color: rgba(255,255,255,0.7); font-size: 12px;">Glow:</label>
              <input type="checkbox" id="laptop-power-btn-glow" ${object.userData.powerButtonGlow ? 'checked' : ''}
                     style="width: 18px; height: 18px; cursor: pointer;">
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <label style="color: rgba(255,255,255,0.7); font-size: 12px;">Brightness:</label>
              <input type="range" id="laptop-power-btn-brightness" min="0" max="100" value="${object.userData.powerButtonBrightness || 50}"
                     style="flex: 1; cursor: pointer;">
              <span id="laptop-power-btn-brightness-val" style="color: rgba(255,255,255,0.7); font-size: 12px;">${object.userData.powerButtonBrightness || 50}%</span>
            </div>
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Power LED Color</label>
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px;">
            <input type="color" id="laptop-led-color-edit" value="${object.userData.powerLedColor || '#00ff00'}"
                   style="width: 40px; height: 30px; border: none; cursor: pointer; border-radius: 4px;">
            <span id="laptop-led-color-display" style="color: rgba(255,255,255,0.7);">${object.userData.powerLedColor || '#00ff00'}</span>
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Desktop Wallpaper</label>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
            <label style="display: inline-block; padding: 10px 15px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 8px; color: #fff; cursor: pointer; text-align: center;">
              ${object.userData.wallpaperDataUrl ? 'Change Wallpaper' : 'Upload Wallpaper'}
              <input type="file" id="laptop-wallpaper-edit" accept="image/*" style="display: none;">
            </label>
            ${object.userData.wallpaperDataUrl ? `
              <button id="laptop-wallpaper-clear" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #ef4444; cursor: pointer;">
                Clear Wallpaper
              </button>
            ` : ''}
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Boot Screen Image</label>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
            <label style="display: inline-block; padding: 10px 15px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 8px; color: #fff; cursor: pointer; text-align: center;">
              ${object.userData.bootScreenDataUrl ? 'Change Boot Screen' : 'Upload Boot Screen'}
              <input type="file" id="laptop-boot-screen-edit" accept="image/*" style="display: none;">
            </label>
            ${object.userData.bootScreenDataUrl ? `
              <button id="laptop-boot-screen-clear" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #ef4444; cursor: pointer;">
                Clear Boot Screen
              </button>
            ` : ''}
          </div>
        </div>
        <div class="customization-group" style="margin-top: 15px;">
          <label>Notes Save Folder</label>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
            <div id="laptop-notes-folder-display" style="color: rgba(255,255,255,0.5); font-size: 12px; word-break: break-all;">
              ${object.userData.notesFolderPath
                ? (object.userData.notesFolderPath.split('/').pop() || object.userData.notesFolderPath.split('\\').pop())
                : 'Default (App folder)'}
            </div>
            <button id="laptop-notes-folder-select" style="padding: 10px 15px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 8px; color: #fff; cursor: pointer;">
              ${object.userData.notesFolderPath ? 'Change Folder' : 'Select Notes Folder'}
            </button>
            ${object.userData.notesFolderPath ? `
              <button id="laptop-notes-folder-clear" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #ef4444; cursor: pointer;">
                Use Default Folder
              </button>
            ` : ''}
          </div>
        </div>
      `;
      setupLaptopCustomizationHandlers(object);
      break;

    case 'cassette-player':
    case 'big-cassette-player':
      const volumePercentCassette = Math.round((object.userData.volume || 0.7) * 100);
      const hissLevel = Math.round((object.userData.tapeHissLevel || 0.3) * 100);
      const wowFlutterLevel = Math.round((object.userData.wowFlutterLevel || 0.5) * 100);
      const saturationLevel = Math.round((object.userData.saturationLevel || 0.4) * 100);
      const lowCutoff = object.userData.lowCutoff || 80;
      const highCutoff = object.userData.highCutoff || 12000;
      const trackCount = object.userData.audioFiles ? object.userData.audioFiles.length : 0;
      const currentTrack = object.userData.currentTrackIndex || 0;
      const folderDisplay = object.userData.musicFolderPath
        ? object.userData.musicFolderPath.split('/').pop() || object.userData.musicFolderPath.split('\\').pop()
        : 'No folder selected';
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Music Folder</label>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
            <div style="color: rgba(255,255,255,0.5); font-size: 12px; word-break: break-all;">
              ${folderDisplay}
            </div>
            <div style="color: rgba(255,255,255,0.4); font-size: 11px;">
              ${trackCount} tracks found
            </div>
            <button id="cassette-select-folder" style="padding: 10px 15px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 8px; color: #fff; cursor: pointer;">
              ${object.userData.musicFolderPath ? 'Change Folder' : 'Select Music Folder'}
            </button>
            ${object.userData.musicFolderPath ? `
              <button id="cassette-refresh-folder" style="padding: 10px 15px; background: rgba(34, 197, 94, 0.2); border: 1px solid rgba(34, 197, 94, 0.4); border-radius: 8px; color: #22c55e; cursor: pointer;">
                Refresh Folder
              </button>
              <button id="cassette-clear-folder" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #ef4444; cursor: pointer;">
                Clear Folder
              </button>
            ` : ''}
          </div>
        </div>

        <div class="customization-group" style="margin-top: 15px;">
          <label>Volume: <span id="cassette-volume-display">${volumePercentCassette}%</span></label>
          <input type="range" id="cassette-volume" min="0" max="100" value="${volumePercentCassette}"
                 style="width: 100%; margin-top: 8px; accent-color: #4f46e5;">
        </div>

        <!-- Tape Effects Accordion -->
        <div class="customization-group" style="margin-top: 15px;">
          <div id="tape-effects-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; cursor: pointer;">
            <span style="color: rgba(255,255,255,0.8); font-size: 12px;">Tape Effects</span>
            <span id="tape-effects-arrow" style="color: rgba(255,255,255,0.5); font-size: 12px;">▼</span>
          </div>
          <div id="tape-effects-content" style="display: none; padding: 12px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-top: none; border-radius: 0 0 8px 8px;">
            <div style="margin-bottom: 12px;">
              <label style="display: block; color: rgba(255,255,255,0.7); font-size: 11px; margin-bottom: 6px;">Tape Hiss: <span id="cassette-hiss-display">${hissLevel}%</span></label>
              <input type="range" id="cassette-hiss" min="0" max="100" value="${hissLevel}" style="width: 100%; accent-color: #4f46e5;">
            </div>
            <div style="margin-bottom: 12px;">
              <label style="display: block; color: rgba(255,255,255,0.7); font-size: 11px; margin-bottom: 6px;">Wow & Flutter: <span id="cassette-flutter-display">${wowFlutterLevel}%</span></label>
              <input type="range" id="cassette-flutter" min="0" max="100" value="${wowFlutterLevel}" style="width: 100%; accent-color: #4f46e5;">
            </div>
            <div style="margin-bottom: 12px;">
              <label style="display: block; color: rgba(255,255,255,0.7); font-size: 11px; margin-bottom: 6px;">Saturation: <span id="cassette-saturation-display">${saturationLevel}%</span></label>
              <input type="range" id="cassette-saturation" min="0" max="100" value="${saturationLevel}" style="width: 100%; accent-color: #4f46e5;">
            </div>
            <div style="margin-bottom: 12px;">
              <label style="display: block; color: rgba(255,255,255,0.7); font-size: 11px; margin-bottom: 6px;">Low Cut: <span id="cassette-lowcut-display">${lowCutoff}Hz</span></label>
              <input type="range" id="cassette-lowcut" min="20" max="200" value="${lowCutoff}" style="width: 100%; accent-color: #4f46e5;">
            </div>
            <div>
              <label style="display: block; color: rgba(255,255,255,0.7); font-size: 11px; margin-bottom: 6px;">High Cut: <span id="cassette-highcut-display">${highCutoff}Hz</span></label>
              <input type="range" id="cassette-highcut" min="4000" max="20000" step="500" value="${highCutoff}" style="width: 100%; accent-color: #4f46e5;">
            </div>
          </div>
        </div>

        ${trackCount > 0 ? `
        <div class="customization-group" style="margin-top: 15px;">
          <label>Tracks (${trackCount})</label>
          <div id="cassette-track-list" style="max-height: 150px; overflow-y: auto; margin-top: 8px; background: rgba(0,0,0,0.2); border-radius: 8px; padding: 8px;">
            ${object.userData.audioFiles.map((file, i) => `
              <div class="cassette-track-item" data-index="${i}"
                   style="padding: 8px 12px; margin-bottom: 4px; background: ${i === currentTrack ? 'rgba(79, 70, 229, 0.3)' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${i === currentTrack ? 'rgba(79, 70, 229, 0.5)' : 'rgba(255,255,255,0.1)'}; border-radius: 6px; color: #fff; cursor: pointer; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${i + 1}. ${file.name}
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}

        <div style="margin-top: 15px; color: rgba(255,255,255,0.4); font-size: 11px;">
          Click the player buttons to control playback.
        </div>
      `;
      setupCassetteCustomizationHandlers(object);
      break;

    case 'dictaphone':
      const recordingsFolderDisplay = object.userData.recordingsFolderPath
        ? object.userData.recordingsFolderPath.split('/').pop() || object.userData.recordingsFolderPath.split('\\').pop()
        : 'No folder selected';
      const nextRecording = object.userData.recordingNumber || 1;
      // If FFmpeg is not available, force format to webm
      let recordingFormat = object.userData.recordingFormat || 'wav';
      if (!ffmpegAvailable && (recordingFormat === 'wav' || recordingFormat === 'mp3')) {
        recordingFormat = 'webm';
        object.userData.recordingFormat = 'webm';
      }
      // Determine if WAV/MP3 buttons should be disabled
      const wavMp3Disabled = !ffmpegAvailable;
      const disabledStyle = 'opacity: 0.4; cursor: not-allowed;';
      // Get recording volume (default 100%)
      const recordingVolume = object.userData.recordingVolume !== undefined ? object.userData.recordingVolume : 100;
      // Get panoramic recording settings
      const recordMicPanorama = object.userData.recordMicrophonePanorama === true;
      const recordEnvPanorama = object.userData.recordEnvironmentPanorama !== false; // Default true
      dynamicOptions.innerHTML = `
        <div class="customization-group" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Recording Volume: <span id="dictaphone-volume-display">${recordingVolume}%</span></label>
          <input type="range" id="dictaphone-volume-slider" min="0" max="200" value="${recordingVolume}" step="5"
            style="width: 100%; height: 6px; margin-top: 8px;">
          <div style="display: flex; justify-content: space-between; color: rgba(255,255,255,0.4); font-size: 10px; margin-top: 4px;">
            <span>0%</span>
            <span>100%</span>
            <span>200%</span>
          </div>
        </div>

        <div class="customization-group" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Panoramic Recording (Stereo Panning)</label>
          <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 10px;">
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: rgba(255,255,255,0.8); font-size: 12px;">
              <input type="checkbox" id="dictaphone-mic-panorama" ${recordMicPanorama ? 'checked' : ''}
                style="width: 18px; height: 18px; cursor: pointer; accent-color: #4f46e5;">
              <span>Microphone panorama</span>
              <span style="color: rgba(255,255,255,0.4); font-size: 10px;">(position mic based on dictaphone location)</span>
            </label>
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: rgba(255,255,255,0.8); font-size: 12px;">
              <input type="checkbox" id="dictaphone-env-panorama" ${recordEnvPanorama ? 'checked' : ''}
                style="width: 18px; height: 18px; cursor: pointer; accent-color: #4f46e5;">
              <span>Environment panorama</span>
              <span style="color: rgba(255,255,255,0.4); font-size: 10px;">(record objects with stereo panning)</span>
            </label>
          </div>
        </div>

        <div class="customization-group" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Audio Level</label>
          <div style="margin-top: 8px;">
            <div style="background: rgba(0,0,0,0.3); border-radius: 4px; height: 24px; overflow: hidden; position: relative;">
              <div id="dictaphone-level-bar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #22c55e 0%, #22c55e 60%, #eab308 80%, #ef4444 100%); transition: width 0.05s ease-out;"></div>
              <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center;">
                <span id="dictaphone-level-text" style="color: rgba(255,255,255,0.7); font-size: 11px; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">
                  ${object.userData.isRecording ? 'Recording...' : 'Not recording'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="customization-group" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Recording Format</label>
          <div id="dictaphone-format-buttons" style="display: flex; gap: 8px; margin-top: 8px;">
            <button data-format="wav" ${wavMp3Disabled ? 'disabled' : ''} style="flex: 1; padding: 10px; background: ${recordingFormat === 'wav' ? 'rgba(79, 70, 229, 0.3)' : 'rgba(255,255,255,0.1)'}; border: 1px solid ${recordingFormat === 'wav' ? 'rgba(79, 70, 229, 0.6)' : 'rgba(255,255,255,0.2)'}; border-radius: 8px; color: #fff; cursor: pointer; font-size: 12px; ${wavMp3Disabled ? disabledStyle : ''}">
              WAV
            </button>
            <button data-format="mp3" ${wavMp3Disabled ? 'disabled' : ''} style="flex: 1; padding: 10px; background: ${recordingFormat === 'mp3' ? 'rgba(79, 70, 229, 0.3)' : 'rgba(255,255,255,0.1)'}; border: 1px solid ${recordingFormat === 'mp3' ? 'rgba(79, 70, 229, 0.6)' : 'rgba(255,255,255,0.2)'}; border-radius: 8px; color: #fff; cursor: pointer; font-size: 12px; ${wavMp3Disabled ? disabledStyle : ''}">
              MP3
            </button>
            <button data-format="webm" style="flex: 1; padding: 10px; background: ${recordingFormat === 'webm' ? 'rgba(79, 70, 229, 0.3)' : 'rgba(255,255,255,0.1)'}; border: 1px solid ${recordingFormat === 'webm' ? 'rgba(79, 70, 229, 0.6)' : 'rgba(255,255,255,0.2)'}; border-radius: 8px; color: #fff; cursor: pointer; font-size: 12px;">
              WebM
            </button>
          </div>
          <div id="dictaphone-ffmpeg-status" style="color: ${ffmpegAvailable ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)'}; font-size: 10px; margin-top: 6px;">
            ${ffmpegAvailable
              ? '✓ FFmpeg installed. All formats available.'
              : '⚠ FFmpeg not installed. Only WebM format available.'}
          </div>
        </div>

        <div class="customization-group" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <label>Recordings Folder</label>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">
            <div style="color: rgba(255,255,255,0.5); font-size: 12px; word-break: break-all;">
              ${recordingsFolderDisplay}
            </div>
            <div style="color: rgba(255,255,255,0.4); font-size: 11px;">
              Next recording: Запись ${nextRecording}.${recordingFormat}
            </div>
            <button id="dictaphone-select-folder" style="padding: 10px 15px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 8px; color: #fff; cursor: pointer;">
              ${object.userData.recordingsFolderPath ? 'Change Folder' : 'Select Recordings Folder'}
            </button>
            ${object.userData.recordingsFolderPath ? `
              <button id="dictaphone-clear-folder" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #ef4444; cursor: pointer;">
                Clear Folder
              </button>
            ` : ''}
          </div>
        </div>

        <div style="margin-top: 15px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
          <div style="color: rgba(255,255,255,0.7); font-size: 12px; margin-bottom: 8px;">Recording Status</div>
          <div id="dictaphone-status" style="color: ${object.userData.isRecording ? '#ef4444' : 'rgba(255,255,255,0.4)'}; font-size: 11px;">
            ${object.userData.isRecording ? '🔴 Recording in progress...' : '⚫ Not recording'}
          </div>
        </div>

        <div style="margin-top: 15px; color: rgba(255,255,255,0.4); font-size: 11px;">
          Click the power button to start/stop recording.<br>
          Records both microphone input and virtual room sounds.<br>
          ${!ffmpegAvailable ? `
          <strong style="color: rgba(239, 68, 68, 0.7);">Install <a href="https://ffmpeg.org/download.html" target="_blank" style="color: rgba(79, 70, 229, 0.8);">FFmpeg</a> for WAV/MP3 format support.</strong>
          ` : ''}
        </div>
      `;
      setupDictaphoneCustomizationHandlers(object);
      break;
  }
}

// Helper function to add scroll-based slider adjustment
function addScrollToSlider(slider, onChange) {
  if (!slider) return;
  slider.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const step = parseFloat(slider.step) || 1;
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    let newValue = parseFloat(slider.value);

    // Scroll up = increase, scroll down = decrease
    if (e.deltaY < 0) {
      newValue = Math.min(max, newValue + step);
    } else {
      newValue = Math.max(min, newValue - step);
    }

    slider.value = newValue;
    // Trigger the input event so existing handlers work
    slider.dispatchEvent(new Event('input'));
    if (onChange) onChange(newValue);
  }, { passive: false });
}

function setupMugCustomizationHandlers(object) {
  // Drink type buttons
  setTimeout(() => {
    const drinkButtons = document.querySelectorAll('#drink-types button');
    drinkButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const drinkType = btn.dataset.drink;
        object.userData.drinkType = drinkType;

        // Update liquid color
        const liquid = object.getObjectByName('liquid');
        const liquidBody = object.getObjectByName('liquidBody');
        if (DRINK_COLORS[drinkType]) {
          if (liquid) {
            liquid.material.color.set(DRINK_COLORS[drinkType].color);
            liquid.material.needsUpdate = true;
          }
          if (liquidBody) {
            liquidBody.material.color.set(DRINK_COLORS[drinkType].color);
            liquidBody.material.needsUpdate = true;
          }
        }

        // Update button styles
        drinkButtons.forEach(b => {
          b.style.background = b.dataset.drink === drinkType ? 'rgba(79, 70, 229, 0.3)' : 'rgba(255,255,255,0.1)';
          b.style.borderColor = b.dataset.drink === drinkType ? 'rgba(79, 70, 229, 0.6)' : 'rgba(255,255,255,0.2)';
        });

        saveState();
      });
    });

    // Fill level slider
    const fillSlider = document.getElementById('fill-level');
    const fillDisplay = document.getElementById('fill-level-display');
    if (fillSlider) {
      fillSlider.addEventListener('input', (e) => {
        const level = parseInt(e.target.value) / 100;
        object.userData.liquidLevel = level;
        fillDisplay.textContent = `${Math.round(level * 100)}%`;

        // Update liquid visibility and position
        const liquid = object.getObjectByName('liquid');
        const liquidBody = object.getObjectByName('liquidBody');
        if (liquid) {
          liquid.visible = level > 0.05;
          // The liquid surface (disc) position based on fill level
          // Base position is 0.03 (bottom of mug), max is 0.17 (near rim)
          liquid.position.y = 0.03 + level * 0.14;
        }
        if (liquidBody) {
          liquidBody.visible = level > 0.05;
          // Scale and position the liquid body cylinder
          liquidBody.scale.y = Math.max(0.1, level);
          liquidBody.position.y = 0.015 + level * 0.07;
        }

        saveState();
      });

      // Add scroll-based adjustment for fill slider
      addScrollToSlider(fillSlider);
    }

    // Hot drink checkbox
    const hotCheckbox = document.getElementById('hot-drink');
    if (hotCheckbox) {
      hotCheckbox.addEventListener('change', (e) => {
        object.userData.isHot = e.target.checked;
        updateSteamVisibility(object);
        saveState();
      });
    }
  }, 0);
}

function setupMetronomeCustomizationHandlers(object) {
  setTimeout(() => {
    const bpmSlider = document.getElementById('metronome-bpm-edit');
    const bpmDisplay = document.getElementById('bpm-display');
    if (bpmSlider) {
      bpmSlider.addEventListener('input', (e) => {
        object.userData.bpm = parseInt(e.target.value);
        bpmDisplay.textContent = e.target.value;
        saveState();
      });

      // Add scroll-based adjustment for BPM slider
      addScrollToSlider(bpmSlider);
    }

    // Volume slider
    const volumeSlider = document.getElementById('metronome-volume-edit');
    const volumeDisplay = document.getElementById('volume-display');
    if (volumeSlider) {
      volumeSlider.addEventListener('input', (e) => {
        object.userData.volume = parseInt(e.target.value) / 100;
        volumeDisplay.textContent = e.target.value + '%';
        saveState();
      });

      // Add scroll-based adjustment for volume slider
      addScrollToSlider(volumeSlider);
    }

    // Pitch slider
    const pitchSlider = document.getElementById('metronome-pitch-edit');
    const pitchDisplay = document.getElementById('pitch-display');
    if (pitchSlider) {
      pitchSlider.addEventListener('input', (e) => {
        object.userData.tickPitch = parseInt(e.target.value);
        pitchDisplay.textContent = e.target.value + '%';
        saveState();
      });

      // Add scroll-based adjustment for pitch slider
      addScrollToSlider(pitchSlider);
    }

    // FL Studio-style Pitch Curve Editor
    const pitchCurveToggle = document.getElementById('pitch-curve-toggle');
    const pitchCurveContent = document.getElementById('pitch-curve-content');
    const pitchCurveArrow = document.getElementById('pitch-curve-arrow');
    let pitchCurveEditor = null;

    if (pitchCurveToggle && pitchCurveContent) {
      pitchCurveToggle.addEventListener('click', () => {
        const isOpen = pitchCurveContent.style.display !== 'none';
        pitchCurveContent.style.display = isOpen ? 'none' : 'block';
        pitchCurveArrow.textContent = isOpen ? '▼' : '▲';
        pitchCurveToggle.style.borderRadius = isOpen ? '8px' : '8px 8px 0 0';

        // Initialize curve editor when accordion is opened
        if (!isOpen && !pitchCurveEditor) {
          pitchCurveEditor = createAutomationCurveEditor(object, 'pitch', 'pitch-curve-editor-container');
        }
      });
    }

    // FL Studio-style Tempo Curve Editor
    const tempoCurveToggle = document.getElementById('tempo-curve-toggle');
    const tempoCurveContent = document.getElementById('tempo-curve-content');
    const tempoCurveArrow = document.getElementById('tempo-curve-arrow');
    let tempoCurveEditor = null;

    if (tempoCurveToggle && tempoCurveContent) {
      tempoCurveToggle.addEventListener('click', () => {
        const isOpen = tempoCurveContent.style.display !== 'none';
        tempoCurveContent.style.display = isOpen ? 'none' : 'block';
        tempoCurveArrow.textContent = isOpen ? '▼' : '▲';
        tempoCurveToggle.style.borderRadius = isOpen ? '8px' : '8px 8px 0 0';

        // Initialize curve editor when accordion is opened
        if (!isOpen && !tempoCurveEditor) {
          tempoCurveEditor = createAutomationCurveEditor(object, 'tempo', 'tempo-curve-editor-container');
        }
      });
    }

    const tickCheckbox = document.getElementById('tick-sound');
    if (tickCheckbox) {
      tickCheckbox.addEventListener('change', (e) => {
        object.userData.tickSound = e.target.checked;
        saveState();
      });
    }

    // Sound type buttons
    const strikeBtn = document.getElementById('sound-type-strike');
    const beepBtn = document.getElementById('sound-type-beep');
    const customBtn = document.getElementById('sound-type-custom');

    const updateSoundTypeButtons = () => {
      if (strikeBtn) {
        strikeBtn.classList.remove('start', 'pause');
        strikeBtn.classList.add(object.userData.tickSoundType === 'strike' ? 'pause' : 'start');
      }
      if (beepBtn) {
        beepBtn.classList.remove('start', 'pause');
        beepBtn.classList.add(object.userData.tickSoundType === 'beep' ? 'pause' : 'start');
      }
      if (customBtn) {
        customBtn.classList.remove('start', 'pause');
        customBtn.classList.add(object.userData.tickSoundType === 'custom' ? 'pause' : 'start');
      }
    };

    updateSoundTypeButtons();

    if (strikeBtn) {
      strikeBtn.addEventListener('click', () => {
        object.userData.tickSoundType = 'strike';
        updateSoundTypeButtons();
        saveState();
      });
    }

    if (beepBtn) {
      beepBtn.addEventListener('click', () => {
        object.userData.tickSoundType = 'beep';
        updateSoundTypeButtons();
        saveState();
      });
    }

    if (customBtn) {
      customBtn.addEventListener('click', () => {
        object.userData.tickSoundType = 'custom';
        updateSoundTypeButtons();
        saveState();
      });
    }

    // Custom sound file upload
    const customSoundInput = document.getElementById('metronome-custom-sound');
    if (customSoundInput) {
      customSoundInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Check if file is audio by MIME type or extension (some files may not have proper MIME type in Electron)
        const isAudioByType = file.type.startsWith('audio/');
        const extension = file.name.split('.').pop().toLowerCase();

        // First, check for explicitly unsupported formats
        if (UNSUPPORTED_AUDIO_FORMATS.includes(extension)) {
          console.log('Metronome file rejected - unsupported format:', file.name);
          alert(`The "${extension.toUpperCase()}" format is not supported.\n\nPlease convert your audio file to MP3, WAV, or OGG format.`);
          e.target.value = '';
          return;
        }

        const isAudioByExtension = SUPPORTED_AUDIO_FORMATS.includes(extension);

        if (!isAudioByType && !isAudioByExtension) {
          console.log('File rejected - not recognized as audio:', file.name, 'type:', file.type);
          alert('Please select an audio file (MP3, WAV, OGG, etc.)');
          e.target.value = '';
          return;
        }

        console.log('Loading metronome custom sound:', file.name);

        // Show loading indicator
        const uploadBtn = document.querySelector('#metronome-custom-sound + .upload-btn') ||
                         document.querySelector('.upload-btn');
        const originalBtnText = uploadBtn ? uploadBtn.textContent : '';
        if (uploadBtn) {
          uploadBtn.textContent = 'Loading...';
          uploadBtn.style.opacity = '0.7';
          uploadBtn.style.pointerEvents = 'none';
        }

        try {
          // Use the robust audio loading helper
          const { dataUrl } = await loadAudioFromFile(file);

          object.userData.tickSoundType = 'custom';
          object.userData.customSoundDataUrl = dataUrl;
          saveState();

          console.log('Metronome custom sound loaded successfully');

          // Refresh the customization panel to show the new buttons
          updateCustomizationPanel(object);
        } catch (err) {
          console.error('Error loading metronome custom sound:', err);
          alert('Could not load audio file:\n\n' + (err.message || 'Unknown error'));
          // Reset the file input
          e.target.value = '';
          // Restore upload button
          if (uploadBtn) {
            uploadBtn.textContent = originalBtnText;
            uploadBtn.style.opacity = '';
            uploadBtn.style.pointerEvents = '';
          }
        }
      });
    }

    // Clear custom sound button
    const clearSoundBtn = document.getElementById('metronome-clear-sound');
    if (clearSoundBtn) {
      clearSoundBtn.addEventListener('click', () => {
        object.userData.customSoundDataUrl = null;
        if (object.userData.tickSoundType === 'custom') {
          object.userData.tickSoundType = 'strike';
        }
        saveState();
        // Refresh the customization panel
        updateCustomizationPanel(object);
      });
    }
  }, 0);
}

// Preload custom sound for metronome - validates saved sound is still playable
async function preloadMetronomeCustomSound(object) {
  if (!object.userData.customSoundDataUrl) return;

  try {
    console.log('Validating metronome custom sound...');

    // Just validate that the data URL can create a playable audio element
    // No need to decode - HTML5 Audio handles it at play time
    const testAudio = new Audio(object.userData.customSoundDataUrl);

    // Wait for the audio to be ready to play
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Audio validation timeout')), 5000);

      testAudio.oncanplaythrough = () => {
        clearTimeout(timeout);
        resolve();
      };

      testAudio.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Audio validation failed'));
      };

      testAudio.load();
    });

    // Automatically switch to custom sound when loaded successfully
    object.userData.tickSoundType = 'custom';
    console.log('Metronome custom sound validated successfully');
    // Don't call saveState() here - this function is called during loading
    // and calling saveState during load causes race conditions
  } catch (e) {
    console.error('Error validating metronome custom sound:', e);
    // Reset custom sound state on error - but don't show alert during preload
    // as this could be triggered during page load
    object.userData.customSoundDataUrl = null;
  }
}

function setupLaptopCustomizationHandlers(object) {
  setTimeout(() => {
    const powerBtnColor = document.getElementById('laptop-power-btn-color');
    const powerBtnGlow = document.getElementById('laptop-power-btn-glow');
    const powerBtnBrightness = document.getElementById('laptop-power-btn-brightness');
    const powerBtnBrightnessVal = document.getElementById('laptop-power-btn-brightness-val');
    const ledColorInput = document.getElementById('laptop-led-color-edit');
    const ledColorDisplay = document.getElementById('laptop-led-color-display');
    const wallpaperInput = document.getElementById('laptop-wallpaper-edit');
    const wallpaperClear = document.getElementById('laptop-wallpaper-clear');
    const bootScreenInput = document.getElementById('laptop-boot-screen-edit');
    const bootScreenClear = document.getElementById('laptop-boot-screen-clear');

    // Helper to update power button material
    const updatePowerButton = () => {
      const powerButton = object.getObjectByName('powerButton');
      if (powerButton) {
        const btnColor = new THREE.Color(object.userData.powerButtonColor);
        powerButton.material.color.copy(btnColor);
        if (object.userData.powerButtonGlow) {
          powerButton.material.emissive.copy(btnColor);
          powerButton.material.emissiveIntensity = object.userData.powerButtonBrightness / 100;
        } else {
          powerButton.material.emissive.setHex(0x000000);
          powerButton.material.emissiveIntensity = 0;
        }
      }
    };

    if (powerBtnColor) {
      powerBtnColor.addEventListener('input', (e) => {
        object.userData.powerButtonColor = e.target.value;
        updatePowerButton();
        saveState();
      });
    }

    if (powerBtnGlow) {
      powerBtnGlow.addEventListener('change', (e) => {
        object.userData.powerButtonGlow = e.target.checked;
        updatePowerButton();
        saveState();
      });
    }

    if (powerBtnBrightness) {
      powerBtnBrightness.addEventListener('input', (e) => {
        object.userData.powerButtonBrightness = parseInt(e.target.value);
        if (powerBtnBrightnessVal) powerBtnBrightnessVal.textContent = e.target.value + '%';
        updatePowerButton();
        saveState();
      });
      // Add scroll support
      addScrollToSlider(powerBtnBrightness, (val) => {
        object.userData.powerButtonBrightness = parseInt(val);
        if (powerBtnBrightnessVal) powerBtnBrightnessVal.textContent = val + '%';
        updatePowerButton();
        saveState();
      });
    }

    if (ledColorInput) {
      ledColorInput.addEventListener('input', (e) => {
        const color = e.target.value;
        object.userData.powerLedColor = color;
        if (ledColorDisplay) ledColorDisplay.textContent = color;

        // Update LED color if laptop is on
        if (object.userData.isOn) {
          const powerLed = object.getObjectByName('powerLed');
          if (powerLed) {
            const ledColor = new THREE.Color(color);
            powerLed.material.color.copy(ledColor);
            powerLed.material.emissive.copy(ledColor);
          }
        }
        saveState();
      });
    }

    // Wallpaper upload handler
    if (wallpaperInput) {
      wallpaperInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const imageUrl = event.target.result;
            object.userData.wallpaperDataUrl = imageUrl;
            // Preload the wallpaper image for cursor mode
            const img = new Image();
            img.onload = () => {
              object.userData.wallpaperImage = img;
              // Update the desktop texture if laptop is on
              if (object.userData.isOn && object.userData.screenState === 'desktop') {
                updateLaptopDesktop(object);
              }
            };
            img.src = imageUrl;
            saveState();
            // Refresh the panel to update button text
            updateCustomizationPanel(object);
          };
          reader.readAsDataURL(file);
        }
      });
    }

    if (wallpaperClear) {
      wallpaperClear.addEventListener('click', () => {
        object.userData.wallpaperDataUrl = null;
        object.userData.wallpaperImage = null;
        // Update the desktop texture if laptop is on
        if (object.userData.isOn && object.userData.screenState === 'desktop') {
          updateLaptopDesktop(object);
        }
        saveState();
        // Refresh the panel to update button text
        updateCustomizationPanel(object);
      });
    }

    if (bootScreenInput) {
      bootScreenInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const imageUrl = event.target.result;
            object.userData.bootScreenDataUrl = imageUrl;
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(imageUrl, (texture) => {
              object.userData.bootScreenTexture = texture;
              saveState();
            });
          };
          reader.readAsDataURL(file);
        }
      });
    }

    if (bootScreenClear) {
      bootScreenClear.addEventListener('click', () => {
        if (object.userData.bootScreenTexture) {
          object.userData.bootScreenTexture.dispose();
          object.userData.bootScreenTexture = null;
        }
        object.userData.bootScreenDataUrl = null;
        saveState();
        // Refresh the panel to update button text
        updateCustomizationPanel(object);
      });
    }

    // Notes folder selection handlers
    const notesFolderSelect = document.getElementById('laptop-notes-folder-select');
    const notesFolderClear = document.getElementById('laptop-notes-folder-clear');
    const notesFolderDisplay = document.getElementById('laptop-notes-folder-display');

    // If no custom folder is set, show the actual default folder path
    if (notesFolderDisplay && !object.userData.notesFolderPath) {
      window.electronAPI.getDefaultNotesFolder().then(result => {
        if (result.success && notesFolderDisplay) {
          notesFolderDisplay.textContent = result.folderPath;
        }
      }).catch(err => console.error('Error getting default notes folder:', err));
    }

    if (notesFolderSelect) {
      notesFolderSelect.addEventListener('click', async () => {
        try {
          const result = await window.electronAPI.selectNotesFolder();
          if (result.success && !result.canceled) {
            object.userData.notesFolderPath = result.folderPath;
            saveState();
            updateCustomizationPanel(object);
          }
        } catch (error) {
          console.error('Error selecting notes folder:', error);
        }
      });
    }

    if (notesFolderClear) {
      notesFolderClear.addEventListener('click', () => {
        object.userData.notesFolderPath = null;
        saveState();
        updateCustomizationPanel(object);
      });
    }
  }, 0);
}

function setupCassetteCustomizationHandlers(object) {
  setTimeout(() => {
    // Music folder selection
    const selectFolderBtn = document.getElementById('cassette-select-folder');
    const refreshFolderBtn = document.getElementById('cassette-refresh-folder');
    const clearFolderBtn = document.getElementById('cassette-clear-folder');

    if (selectFolderBtn) {
      selectFolderBtn.addEventListener('click', async () => {
        try {
          const result = await window.electronAPI.selectMusicFolder();
          if (result.success && !result.canceled) {
            // Remember if player was playing before folder change
            const wasPlaying = object.userData.isPlaying;

            // Stop current playback before changing folder
            if (wasPlaying) {
              stopPlayerAudio(object);
            }

            object.userData.musicFolderPath = result.folderPath;
            object.userData.audioFiles = result.audioFiles;
            object.userData.currentTrackIndex = 0;

            if (result.audioFiles.length > 0) {
              updateCassetteScreen(object, result.audioFiles[0].name);

              // If player was playing, start playing the first track from new folder
              if (wasPlaying) {
                playCassetteTrack(object, 0, 0);
              }
            } else {
              updateCassetteScreen(object, 'NO TRACKS');
            }

            saveState();
            updateCustomizationPanel(object);
          }
        } catch (error) {
          console.error('Error selecting music folder:', error);
        }
      });
    }

    if (refreshFolderBtn) {
      refreshFolderBtn.addEventListener('click', async () => {
        if (!object.userData.musicFolderPath) return;

        try {
          const result = await window.electronAPI.refreshMusicFolder(object.userData.musicFolderPath);
          if (result.success) {
            object.userData.audioFiles = result.audioFiles;
            // Keep current track index if still valid
            if (object.userData.currentTrackIndex >= result.audioFiles.length) {
              object.userData.currentTrackIndex = 0;
            }
            saveState();
            updateCustomizationPanel(object);
          }
        } catch (error) {
          console.error('Error refreshing music folder:', error);
        }
      });
    }

    if (clearFolderBtn) {
      clearFolderBtn.addEventListener('click', () => {
        // Stop this player's playback first (per-player audio state)
        stopPlayerAudio(object);

        object.userData.musicFolderPath = null;
        object.userData.audioFiles = [];
        object.userData.currentTrackIndex = 0;
        object.userData.isPlaying = false;
        updateCassetteScreen(object, 'NO FOLDER');
        saveState();
        updateCustomizationPanel(object);
      });
    }

    // Volume slider
    const volumeSlider = document.getElementById('cassette-volume');
    const volumeDisplay = document.getElementById('cassette-volume-display');
    if (volumeSlider) {
      volumeSlider.addEventListener('input', (e) => {
        object.userData.volume = parseInt(e.target.value) / 100;
        volumeDisplay.textContent = e.target.value + '%';

        // Update live playback volume for this player (per-player audio state)
        if (object.userData.effectNodes) {
          object.userData.effectNodes.mainGain.gain.value = object.userData.volume;
          // Also update white noise volume proportionally
          const hissLevel = object.userData.tapeHissLevel || 0.3;
          object.userData.effectNodes.noiseGain.gain.value = 0.015 * hissLevel * object.userData.volume;
        }
        saveState();
      });
      addScrollToSlider(volumeSlider);
    }

    // Tape effects accordion toggle
    const tapeEffectsToggle = document.getElementById('tape-effects-toggle');
    const tapeEffectsContent = document.getElementById('tape-effects-content');
    const tapeEffectsArrow = document.getElementById('tape-effects-arrow');
    if (tapeEffectsToggle && tapeEffectsContent) {
      tapeEffectsToggle.addEventListener('click', () => {
        const isOpen = tapeEffectsContent.style.display !== 'none';
        tapeEffectsContent.style.display = isOpen ? 'none' : 'block';
        tapeEffectsArrow.textContent = isOpen ? '▼' : '▲';
        tapeEffectsToggle.style.borderRadius = isOpen ? '8px' : '8px 8px 0 0';
      });
    }

    // Tape hiss slider
    const hissSlider = document.getElementById('cassette-hiss');
    const hissDisplay = document.getElementById('cassette-hiss-display');
    if (hissSlider) {
      hissSlider.addEventListener('input', (e) => {
        object.userData.tapeHissLevel = parseInt(e.target.value) / 100;
        hissDisplay.textContent = e.target.value + '%';

        // Update live playback for this player (per-player audio state, scaled by volume)
        if (object.userData.effectNodes) {
          const volume = object.userData.volume || 0.7;
          object.userData.effectNodes.noiseGain.gain.value = 0.015 * object.userData.tapeHissLevel * volume;
        }
        saveState();
      });
      addScrollToSlider(hissSlider);
    }

    // Wow & Flutter slider
    const flutterSlider = document.getElementById('cassette-flutter');
    const flutterDisplay = document.getElementById('cassette-flutter-display');
    if (flutterSlider) {
      flutterSlider.addEventListener('input', (e) => {
        object.userData.wowFlutterLevel = parseInt(e.target.value) / 100;
        flutterDisplay.textContent = e.target.value + '%';

        // Update live playback for this player (per-player audio state)
        if (object.userData.effectNodes) {
          object.userData.effectNodes.wowLFOGain.gain.value = 0.001 * object.userData.wowFlutterLevel;
          object.userData.effectNodes.flutterLFOGain.gain.value = 0.0005 * object.userData.wowFlutterLevel;
        }
        saveState();
      });
      addScrollToSlider(flutterSlider);
    }

    // Saturation slider
    const saturationSlider = document.getElementById('cassette-saturation');
    const saturationDisplay = document.getElementById('cassette-saturation-display');
    if (saturationSlider) {
      saturationSlider.addEventListener('input', (e) => {
        object.userData.saturationLevel = parseInt(e.target.value) / 100;
        saturationDisplay.textContent = e.target.value + '%';

        // Update live playback for this player (per-player audio state)
        if (object.userData.effectNodes) {
          object.userData.effectNodes.saturation.curve = createSaturationCurve(object.userData.saturationLevel);
        }
        saveState();
      });
      addScrollToSlider(saturationSlider);
    }

    // Low cut slider
    const lowcutSlider = document.getElementById('cassette-lowcut');
    const lowcutDisplay = document.getElementById('cassette-lowcut-display');
    if (lowcutSlider) {
      lowcutSlider.addEventListener('input', (e) => {
        object.userData.lowCutoff = parseInt(e.target.value);
        lowcutDisplay.textContent = e.target.value + 'Hz';

        // Update live playback for this player (per-player audio state)
        if (object.userData.effectNodes) {
          object.userData.effectNodes.highpass.frequency.value = object.userData.lowCutoff;
        }
        saveState();
      });
      addScrollToSlider(lowcutSlider);
    }

    // High cut slider
    const highcutSlider = document.getElementById('cassette-highcut');
    const highcutDisplay = document.getElementById('cassette-highcut-display');
    if (highcutSlider) {
      highcutSlider.addEventListener('input', (e) => {
        object.userData.highCutoff = parseInt(e.target.value);
        highcutDisplay.textContent = e.target.value + 'Hz';

        // Update live playback for this player (per-player audio state)
        if (object.userData.effectNodes) {
          object.userData.effectNodes.lowpass.frequency.value = object.userData.highCutoff;
        }
        saveState();
      });
      addScrollToSlider(highcutSlider);
    }

    // Track list click handlers
    const trackItems = document.querySelectorAll('.cassette-track-item');
    trackItems.forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        object.userData.currentTrackIndex = index;

        // Update visual selection
        trackItems.forEach(t => {
          const isSelected = parseInt(t.dataset.index) === index;
          t.style.background = isSelected ? 'rgba(79, 70, 229, 0.3)' : 'rgba(255,255,255,0.05)';
          t.style.borderColor = isSelected ? 'rgba(79, 70, 229, 0.5)' : 'rgba(255,255,255,0.1)';
        });

        // If playing, switch to the selected track
        if (object.userData.isPlaying) {
          playCassetteTrack(object, index);
        } else {
          updateCassetteScreen(object, object.userData.audioFiles[index].name);
        }

        saveState();
      });
    });
  }, 0);
}

function setupDictaphoneCustomizationHandlers(object) {
  setTimeout(() => {
    // Volume slider
    const volumeSlider = document.getElementById('dictaphone-volume-slider');
    const volumeDisplay = document.getElementById('dictaphone-volume-display');

    if (volumeSlider) {
      volumeSlider.addEventListener('input', (e) => {
        const volume = parseInt(e.target.value);
        object.userData.recordingVolume = volume;
        if (volumeDisplay) {
          volumeDisplay.textContent = `${volume}%`;
        }

        // Update gain node in real-time if recording
        if (dictaphoneState.isRecording && dictaphoneState.microphoneGainNode) {
          dictaphoneState.microphoneGainNode.gain.value = volume / 100;
        }

        saveState();
      });

      // Add scroll wheel support for volume slider
      addScrollToSlider(volumeSlider, (value) => {
        object.userData.recordingVolume = value;
        if (volumeDisplay) {
          volumeDisplay.textContent = `${value}%`;
        }
        if (dictaphoneState.isRecording && dictaphoneState.microphoneGainNode) {
          dictaphoneState.microphoneGainNode.gain.value = value / 100;
        }
        saveState();
      });
    }

    // Panoramic recording checkboxes
    const micPanoramaCheckbox = document.getElementById('dictaphone-mic-panorama');
    const envPanoramaCheckbox = document.getElementById('dictaphone-env-panorama');

    if (micPanoramaCheckbox) {
      micPanoramaCheckbox.addEventListener('change', (e) => {
        object.userData.recordMicrophonePanorama = e.target.checked;
        console.log('Microphone panorama:', e.target.checked);
        // If currently recording, switch the panorama dynamically
        if (dictaphoneState.isRecording && dictaphoneState.currentRecorderId === object.userData.id) {
          switchDictaphoneMicrophonePanorama(e.target.checked);
        }
        saveState();
      });
    }

    if (envPanoramaCheckbox) {
      envPanoramaCheckbox.addEventListener('change', (e) => {
        object.userData.recordEnvironmentPanorama = e.target.checked;
        console.log('Environment panorama:', e.target.checked);
        // If currently recording, switch the panorama dynamically
        if (dictaphoneState.isRecording && dictaphoneState.currentRecorderId === object.userData.id) {
          switchDictaphoneEnvironmentPanorama(e.target.checked);
        }
        saveState();
      });
    }

    // Format selection buttons
    const formatButtons = document.querySelectorAll('#dictaphone-format-buttons button');
    formatButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        // Skip disabled buttons (WAV/MP3 when FFmpeg is not available)
        if (btn.disabled) {
          return;
        }

        const format = btn.dataset.format;
        object.userData.recordingFormat = format;

        // Update button styles (only for enabled buttons)
        formatButtons.forEach(b => {
          if (!b.disabled) {
            const isSelected = b.dataset.format === format;
            b.style.background = isSelected ? 'rgba(79, 70, 229, 0.3)' : 'rgba(255,255,255,0.1)';
            b.style.borderColor = isSelected ? 'rgba(79, 70, 229, 0.6)' : 'rgba(255,255,255,0.2)';
          }
        });

        saveState();
        updateCustomizationPanel(object);
      });
    });

    // Recordings folder selection
    const selectFolderBtn = document.getElementById('dictaphone-select-folder');
    const clearFolderBtn = document.getElementById('dictaphone-clear-folder');

    if (selectFolderBtn) {
      selectFolderBtn.addEventListener('click', async () => {
        try {
          const format = object.userData.recordingFormat || 'wav';
          const result = await window.electronAPI.selectRecordingsFolder(format);
          if (result.success && !result.canceled) {
            object.userData.recordingsFolderPath = result.folderPath;
            object.userData.recordingNumber = result.nextRecordingNumber;
            saveState();
            updateCustomizationPanel(object);
          }
        } catch (error) {
          console.error('Error selecting recordings folder:', error);
        }
      });
    }

    if (clearFolderBtn) {
      clearFolderBtn.addEventListener('click', () => {
        // Stop recording first if active
        if (dictaphoneState.currentRecorderId === object.userData.id && object.userData.isRecording) {
          stopDictaphoneRecording(object);
        }

        object.userData.recordingsFolderPath = null;
        object.userData.recordingNumber = 1;
        saveState();
        updateCustomizationPanel(object);
      });
    }
  }, 0);
}

function setupPenCustomizationHandlers(object) {
  setTimeout(() => {
    const bodyColorsContainer = document.getElementById('pen-body-colors');
    const inkColorsContainer = document.getElementById('pen-ink-colors');

    // Body color swatches
    if (bodyColorsContainer) {
      const swatches = bodyColorsContainer.querySelectorAll('.color-swatch');
      swatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
          const color = swatch.dataset.color;
          object.userData.mainColor = color;

          // Update the pen body and cap color
          object.children.forEach(child => {
            if (child.isMesh && child.material) {
              // Body and cap share the same material by reference, update body
              if (child.geometry.type === 'CylinderGeometry' && child.position.y > 0.1) {
                child.material.color.set(color);
                child.material.needsUpdate = true;
              }
            }
          });

          // Update swatch selection visuals
          swatches.forEach(s => {
            s.style.borderColor = s.dataset.color === color ? '#fff' : (s.dataset.color === '#1a1a1a' ? 'rgba(255,255,255,0.3)' : 'transparent');
          });

          saveState();
        });
      });
    }

    // Ink color swatches
    if (inkColorsContainer) {
      const swatches = inkColorsContainer.querySelectorAll('.color-swatch');
      swatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
          const color = swatch.dataset.color;
          object.userData.inkColor = color;

          // Update swatch selection visuals
          swatches.forEach(s => {
            s.style.borderColor = s.dataset.color === color ? '#fff' : (s.dataset.color === '#000000' ? 'rgba(255,255,255,0.3)' : 'transparent');
          });

          saveState();
        });
      });
    }

    // Line width slider
    const lineWidthSlider = document.getElementById('pen-line-width');
    const lineWidthVal = document.getElementById('pen-line-width-val');
    if (lineWidthSlider && lineWidthVal) {
      lineWidthSlider.addEventListener('input', (e) => {
        const width = parseInt(e.target.value);
        object.userData.lineWidth = width;
        lineWidthVal.textContent = width + 'px';
        // Also update the global penDrawingMode line width
        penDrawingMode.lineWidth = width;
        saveState();
      });
    }

    // Drawings save folder selection
    const selectFolderBtn = document.getElementById('pen-select-folder-btn');
    const clearFolderBtn = document.getElementById('pen-clear-folder-btn');
    const folderDisplay = document.getElementById('pen-save-folder-display');

    if (selectFolderBtn) {
      selectFolderBtn.addEventListener('click', async () => {
        if (window.electronAPI && window.electronAPI.selectDrawingsFolder) {
          try {
            const result = await window.electronAPI.selectDrawingsFolder();
            if (result.success && !result.canceled && result.folderPath) {
              object.userData.drawingsSaveFolder = result.folderPath;
              // Also update the global penDrawingMode saveFolder
              penDrawingMode.saveFolder = result.folderPath;
              if (folderDisplay) {
                folderDisplay.textContent = result.folderPath;
              }
              saveState();
              // Refresh the customization panel to show the clear button
              updateCustomizationPanel(object);
            }
          } catch (err) {
            console.error('Error selecting drawings folder:', err);
          }
        }
      });
    }

    if (clearFolderBtn) {
      clearFolderBtn.addEventListener('click', () => {
        object.userData.drawingsSaveFolder = null;
        penDrawingMode.saveFolder = null;
        if (folderDisplay) {
          folderDisplay.textContent = 'Default (app data folder)';
        }
        saveState();
        // Refresh the customization panel to hide the clear button
        updateCustomizationPanel(object);
      });
    }

    // Show drawing ray checkbox
    const showRayCheckbox = document.getElementById('pen-show-ray');
    if (showRayCheckbox) {
      showRayCheckbox.addEventListener('change', (e) => {
        object.userData.showDrawingRay = e.target.checked;
        penDrawingMode.showRay = e.target.checked;
        saveState();
      });
    }
  }, 0);
}

function setupNotebookPaperCustomizationHandlers(object) {
  setTimeout(() => {
    const transparentBgCheckbox = document.getElementById('transparent-background');

    if (transparentBgCheckbox) {
      transparentBgCheckbox.addEventListener('change', (e) => {
        object.userData.transparentBackground = e.target.checked;

        // If there's an existing canvas, recreate it with the new background
        if (object.userData.drawingCanvas) {
          const ctx = object.userData.drawingCtx;
          const canvas = object.userData.drawingCanvas;

          // Clear canvas and redraw with new background
          if (e.target.checked) {
            ctx.clearRect(0, 0, 512, 512);
          } else {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 512, 512);
          }

          // Redraw all existing strokes
          if (object.userData.drawingLines && object.userData.drawingLines.length > 0) {
            object.userData.drawingLines.forEach(stroke => {
              if (stroke.points && stroke.points.length >= 2) {
                ctx.beginPath();
                ctx.strokeStyle = stroke.color || '#000000';
                ctx.lineWidth = stroke.width || 2;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
                for (let i = 1; i < stroke.points.length; i++) {
                  ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
                }
                ctx.stroke();
              }
            });
          }

          // Update the 3D texture
          updateDrawingTexture(object);
        }

        saveState();
      });
    }
  }, 0);
}

function setupPhotoFrameCustomizationHandlers(object) {
  setTimeout(() => {
    const uploadInput = document.getElementById('photo-upload-edit');
    const clearBtn = document.getElementById('photo-clear-edit');

    if (uploadInput) {
      uploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const imageUrl = event.target.result;
            // Store data URL for persistence
            object.userData.photoDataUrl = imageUrl;
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(imageUrl, (texture) => {
              const photoSurface = object.getObjectByName('photoSurface');
              if (photoSurface) {
                photoSurface.material.map = texture;
                photoSurface.material.color.set(0xffffff);
                photoSurface.material.needsUpdate = true;
                object.userData.photoTexture = texture;
              }
              saveState(); // Save after photo is loaded
            });
          };
          reader.readAsDataURL(file);
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const photoSurface = object.getObjectByName('photoSurface');
        if (photoSurface) {
          if (object.userData.photoTexture) {
            object.userData.photoTexture.dispose();
            object.userData.photoTexture = null;
          }
          object.userData.photoDataUrl = null;
          photoSurface.material.map = null;
          photoSurface.material.color.set(new THREE.Color(object.userData.accentColor));
          photoSurface.material.needsUpdate = true;
          saveState();
        }
      });
    }
  }, 0);
}

function setupBookCustomizationHandlers(object) {
  setTimeout(() => {
    const titleInput = document.getElementById('book-title-edit');
    const titleColorsContainer = document.getElementById('book-title-colors');
    const pdfInput = document.getElementById('book-pdf-edit');
    const clearBtn = document.getElementById('book-pdf-clear-edit');

    // Helper to update book title textures with dynamic geometry resizing for multi-line titles
    const updateBookTitleTextures = () => {
      if (object.userData.createTitleTexture) {
        const closedGroup = object.getObjectByName('closedBook');
        if (closedGroup) {
          const coverTitle = closedGroup.getObjectByName('coverTitle');
          if (coverTitle) {
            // Calculate number of lines needed for the title
            const title = object.userData.bookTitle || '';

            // Hide title background if title is empty or whitespace only
            coverTitle.visible = title.trim().length > 0;

            // Only update texture if title is visible
            if (coverTitle.visible) {
              const lines = title.split('\n');

              // Calculate canvas and geometry height based on line count
              // Base height is 116px for 1 line, add 60px per additional line
              const baseHeight = 116;
              const lineAddition = 60;
              const lineCount = Math.max(1, lines.length);
              const canvasHeight = baseHeight + (lineCount - 1) * lineAddition;

              // Update geometry height proportionally (base is 0.08 for 116px)
              const baseGeoHeight = 0.08;
              const geoHeight = baseGeoHeight * (canvasHeight / baseHeight);

              // Create new geometry with updated height
              const newGeometry = new THREE.PlaneGeometry(0.22, geoHeight);
              coverTitle.geometry.dispose();
              coverTitle.geometry = newGeometry;

              // Adjust position to keep title centered on cover
              // Original position is 0.041 for single line, move up slightly for multi-line
              coverTitle.position.y = 0.041 + (lineCount - 1) * 0.01;

              // Create texture with dynamic height
              const newCoverTexture = object.userData.createTitleTexture(title, 320, canvasHeight, 64);
              coverTitle.material.map = newCoverTexture;
              coverTitle.material.needsUpdate = true;
            }
          }
          // Spine title removed - no longer updated
        }
      }
    };

    if (titleInput) {
      titleInput.addEventListener('change', (e) => {
        object.userData.bookTitle = e.target.value;
        updateBookTitleTextures();
        saveState();
      });
      titleInput.addEventListener('blur', (e) => {
        object.userData.bookTitle = e.target.value;
        updateBookTitleTextures();
        saveState();
      });
    }

    // Title color preset swatches
    if (titleColorsContainer) {
      const swatches = titleColorsContainer.querySelectorAll('.color-swatch');
      swatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
          const color = swatch.dataset.color;
          object.userData.titleColor = color;
          updateBookTitleTextures();
          saveState();
          // Update swatch selection visuals
          swatches.forEach(s => {
            s.style.borderColor = s.dataset.color === color ? '#fff' : (s.dataset.color === '#000000' ? 'rgba(255,255,255,0.3)' : 'transparent');
          });
        });
      });
    }

    if (pdfInput) {
      pdfInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type === 'application/pdf') {
          object.userData.pdfPath = file.path || file.name;
          object.userData.pdfFile = file;
          // Actually load and render the PDF (loadPDFToBook sets isLoadingPdf internally)
          loadPDFToBook(object, file);
          // Update the customization panel to show the new file
          updateCustomizationPanel(object);
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        object.userData.pdfPath = null;
        object.userData.pdfDataUrl = null;
        object.userData.pdfDataDirty = false; // No PDF = nothing to save
        object.userData.pdfDocument = null;
        object.userData.totalPages = 0;
        object.userData.currentPage = 0;
        object.userData.renderedPages = {};
        object.userData.pageTextures = {};
        // Delete the separate PDF data file
        window.electronAPI.saveObjectData(object.userData.id, 'pdf', null);
        // Update book thickness (reset to minimum)
        updateBookThickness(object);
        saveState();
        // Update the customization panel
        updateCustomizationPanel(object);
      });
    }

    // PDF resolution slider
    const resolutionSlider = document.getElementById('book-pdf-resolution');
    const resolutionDisplay = document.getElementById('pdf-resolution-display');
    if (resolutionSlider) {
      resolutionSlider.addEventListener('input', (e) => {
        const newRes = parseInt(e.target.value);
        object.userData.pdfResolution = newRes;
        if (resolutionDisplay) {
          resolutionDisplay.textContent = `${newRes}px`;
        }
      });
      resolutionSlider.addEventListener('change', (e) => {
        const newRes = parseInt(e.target.value);
        object.userData.pdfResolution = newRes;
        // Clear cached rendered pages and textures so they re-render at new resolution
        object.userData.renderedPages = {};
        object.userData.pageTextures = {};
        // Re-render current pages if book is open
        if (object.userData.isOpen && object.userData.pdfDocument) {
          updateBookPagesWithPDF(object);
        }
        saveState();
      });
    }

    // Cover image handlers
    const coverImageInput = document.getElementById('book-cover-image');
    const coverUsePdfBtn = document.getElementById('book-cover-use-pdf');
    const coverClearBtn = document.getElementById('book-cover-clear');

    // Helper to apply cover image to the book cover
    const applyCoverImage = (dataUrl) => {
      // Store the data URL first
      object.userData.coverImageDataUrl = dataUrl;
      object.userData.coverImageDirty = true; // Mark as dirty so it gets saved
      // Apply with current fit mode
      const fitMode = object.userData.coverFitMode || 'contain';
      applyCoverImageWithFit(object, dataUrl, fitMode);
      saveState();
      updateCustomizationPanel(object);
    };

    if (coverImageInput) {
      coverImageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = () => {
            applyCoverImage(reader.result);
          };
          reader.readAsDataURL(file);
        }
      });
    }

    if (coverUsePdfBtn) {
      coverUsePdfBtn.addEventListener('click', async () => {
        if (object.userData.pdfDocument) {
          try {
            // Render PDF page 1 to canvas
            const pdfDoc = object.userData.pdfDocument;
            const page = await pdfDoc.getPage(1);
            const viewport = page.getViewport({ scale: 2.0 });

            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');

            await page.render({
              canvasContext: ctx,
              viewport: viewport
            }).promise;

            // Convert to data URL and apply
            const dataUrl = canvas.toDataURL('image/png');
            applyCoverImage(dataUrl);

            // Mark that first page is used as cover - skip it in content
            object.userData.firstPageAsCover = true;
            // Reset to page 0 and update content (which now skips page 1)
            object.userData.currentPage = 0;
            // Clear cached pages and textures to force re-render with offset
            object.userData.renderedPages = {};
            object.userData.pageTextures = {};
            if (object.userData.isOpen) {
              updateBookPagesWithPDF(object);
            }
            saveState();
          } catch (error) {
            console.error('Error rendering PDF page for cover:', error);
          }
        }
      });
    }

    if (coverClearBtn) {
      coverClearBtn.addEventListener('click', () => {
        // Restore original single material (no image)
        const closedGroup = object.getObjectByName('closedBook');
        if (closedGroup) {
          const cover = closedGroup.getObjectByName('cover');
          if (cover) {
            // Create a fresh single material for all faces
            const baseMaterial = new THREE.MeshStandardMaterial({
              color: new THREE.Color(object.userData.mainColor),
              roughness: 0.7
            });
            cover.material = baseMaterial;
            cover.material.needsUpdate = true;
          }
        }
        object.userData.coverImageDataUrl = null;
        object.userData.coverImageDirty = false; // No cover = nothing to save
        object.userData.originalCoverMaterial = null;
        // Delete the separate cover image data file
        window.electronAPI.saveObjectData(object.userData.id, 'cover', null);
        // Also clear the first page as cover flag
        object.userData.firstPageAsCover = false;
        // Clear cached pages and textures to force re-render without offset
        object.userData.renderedPages = {};
        object.userData.pageTextures = {};
        if (object.userData.isOpen) {
          updateBookPagesWithPDF(object);
        }
        saveState();
        updateCustomizationPanel(object);
      });
    }

    // Cover fit mode handler
    const fitModeContainer = document.getElementById('book-cover-fit-mode');
    if (fitModeContainer) {
      const fitModeButtons = fitModeContainer.querySelectorAll('.fit-mode-btn');
      fitModeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const newMode = btn.dataset.mode;
          object.userData.coverFitMode = newMode;
          // Re-apply cover image with new fit mode
          if (object.userData.coverImageDataUrl) {
            applyCoverImageWithFit(object, object.userData.coverImageDataUrl, newMode);
          }
          saveState();
          updateCustomizationPanel(object);
        });
      });
    }
  }, 0);
}

// Helper function to apply cover image with fit mode
function applyCoverImageWithFit(object, dataUrl, fitMode) {
  const img = new Image();
  img.onload = () => {
    // Book cover dimensions (approximately 0.28 x 0.38)
    const coverAspect = 0.28 / 0.38; // ~0.737 (width / height)
    const imgAspect = img.width / img.height;

    // Create a canvas to draw the properly positioned image
    const canvas = document.createElement('canvas');
    const canvasSize = 512; // Square canvas for simplicity
    canvas.width = canvasSize;
    canvas.height = Math.round(canvasSize / coverAspect);
    const ctx = canvas.getContext('2d');

    // Fill with main color as background
    ctx.fillStyle = object.userData.mainColor || '#7c3aed';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let drawX = 0, drawY = 0, drawWidth = canvas.width, drawHeight = canvas.height;

    if (fitMode === 'contain') {
      // Fit image within bounds, maintaining aspect ratio
      if (imgAspect > coverAspect) {
        // Image is wider - fit to width
        drawWidth = canvas.width;
        drawHeight = canvas.width / imgAspect;
        drawY = (canvas.height - drawHeight) / 2;
      } else {
        // Image is taller - fit to height
        drawHeight = canvas.height;
        drawWidth = canvas.height * imgAspect;
        drawX = (canvas.width - drawWidth) / 2;
      }
    } else if (fitMode === 'cover') {
      // Fill entire cover, cropping edges if needed
      if (imgAspect > coverAspect) {
        // Image is wider - fit to height, crop sides
        drawHeight = canvas.height;
        drawWidth = canvas.height * imgAspect;
        drawX = (canvas.width - drawWidth) / 2;
      } else {
        // Image is taller - fit to width, crop top/bottom
        drawWidth = canvas.width;
        drawHeight = canvas.width / imgAspect;
        drawY = (canvas.height - drawHeight) / 2;
      }
    }
    // 'stretch' uses default values (full canvas dimensions)

    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const closedGroup = object.getObjectByName('closedBook');
    if (closedGroup) {
      const cover = closedGroup.getObjectByName('cover');
      if (cover) {
        const baseMaterial = new THREE.MeshStandardMaterial({
          color: new THREE.Color(object.userData.mainColor),
          roughness: 0.7
        });
        const topMaterial = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.5
        });
        cover.material = [
          baseMaterial, // +x
          baseMaterial, // -x
          topMaterial,  // +y (top face - this gets the cover image)
          baseMaterial, // -y
          baseMaterial, // +z
          baseMaterial  // -z
        ];
        cover.material.forEach(m => m.needsUpdate = true);
      }
    }
  };
  img.src = dataUrl;
}

// Update steam visibility for mug
function updateSteamVisibility(object) {
  let steam = object.getObjectByName('steam');

  if (object.userData.isHot && object.userData.liquidLevel > 0.1) {
    if (!steam) {
      // Create steam particles
      steam = createSteamEffect();
      steam.name = 'steam';
      object.add(steam);
    }
    steam.visible = true;
  } else if (steam) {
    steam.visible = false;
  }
}

// Create simple steam effect
function createSteamEffect() {
  const steamGroup = new THREE.Group();

  // Create multiple steam wisps
  for (let i = 0; i < 3; i++) {
    const wispGeometry = new THREE.SphereGeometry(0.02, 8, 8);
    const wispMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      roughness: 1
    });
    const wisp = new THREE.Mesh(wispGeometry, wispMaterial);
    wisp.position.set(
      (Math.random() - 0.5) * 0.05,
      0.22 + i * 0.03,
      (Math.random() - 0.5) * 0.05
    );
    wisp.scale.set(1 + i * 0.2, 1.5 + i * 0.3, 1 + i * 0.2);
    steamGroup.add(wisp);
  }

  return steamGroup;
}

// Create liquid pour effect (droplets falling from tilted mug)
function createPourEffect(drinkType = 'coffee') {
  const pourGroup = new THREE.Group();
  const drinkColor = DRINK_COLORS[drinkType] ? DRINK_COLORS[drinkType].color : 0x3d2914;

  // Create multiple droplets
  for (let i = 0; i < 5; i++) {
    const dropGeometry = new THREE.SphereGeometry(0.015, 6, 6);
    const dropMaterial = new THREE.MeshStandardMaterial({
      color: drinkColor,
      transparent: true,
      opacity: 0.8,
      roughness: 0.3
    });
    const drop = new THREE.Mesh(dropGeometry, dropMaterial);
    drop.position.set(
      0.08 + (Math.random() - 0.5) * 0.02, // Offset to the side (where mug edge would be)
      0.15 - i * 0.08, // Staggered heights
      (Math.random() - 0.5) * 0.02
    );
    pourGroup.add(drop);
  }

  return pourGroup;
}

// Double-click examine removed - use drag+scroll down to enter, scroll up to exit

function enterExamineMode(object) {
  // Store original state
  examineState.active = true;
  examineState.object = object;
  examineState.originalPosition = object.position.clone();
  examineState.originalRotation = object.rotation.clone();
  examineState.originalScale = object.scale.clone();

  // Use shorter examine distance for small objects like pens
  // This brings them closer to the camera for better visibility
  let examineDistance = 2.0; // Default distance
  let yOffset = -0.1; // Position slightly below center of view

  // Adjust distance based on object type
  if (object.userData.type === 'pen') {
    examineDistance = 1.2; // Bring pen much closer
    yOffset = -0.2; // Lower position so cursor can reach
  } else if (object.userData.type === 'books' || object.userData.type === 'magazine') {
    examineDistance = 1.5;
  }

  examineState.examineDistance = examineDistance;

  // Calculate position close to camera
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  // Target position in front of the camera (slightly below center)
  const targetPosition = new THREE.Vector3(
    camera.position.x + direction.x * examineDistance,
    camera.position.y + direction.y * examineDistance + yOffset,
    camera.position.z + direction.z * examineDistance
  );

  // Animate object to examine position
  object.userData.examineTarget = targetPosition;
  object.userData.isExamining = true;

  // Scale up slightly for better view
  const examineScale = Math.max(object.scale.x * 1.5, 1.2);
  object.userData.examineScaleTarget = examineScale;

  // Add visual hint that object is being examined
  document.body.style.cursor = 'zoom-out';
}

function exitExamineMode() {
  if (!examineState.active || !examineState.object) return;

  const object = examineState.object;

  // Store original position locally before clearing state
  const originalPosition = examineState.originalPosition.clone();
  const originalScale = examineState.originalScale.clone();

  // Animate back to original position
  object.userData.examineTarget = originalPosition;
  object.userData.examineScaleTarget = originalScale.x;
  object.userData.isExamining = false;
  object.userData.isReturning = true;

  // Close interaction modal if open
  closeInteractionModal();

  // Reset cursor
  document.body.style.cursor = 'default';

  // Clear examine state immediately (animation still uses local copies)
  examineState.active = false;
  examineState.object = null;
  examineState.originalPosition = null;
  examineState.originalRotation = null;
  examineState.originalScale = null;

  // Clear animation flags after animation completes
  setTimeout(() => {
    if (object.userData.isReturning) {
      object.position.copy(originalPosition);
      object.scale.copy(originalScale);
    }
    // Clean up all examine-related flags
    object.userData.isReturning = false;
    object.userData.examineTarget = null;
    object.userData.examineScaleTarget = undefined;
  }, 500);
}

// ============================================================================
// OBJECT INTERACTION MODAL
// ============================================================================
function openInteractionModal(object) {
  interactionObject = object;
  const modal = document.getElementById('interaction-modal');
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('interaction-content');
  const title = document.getElementById('modal-title');
  const icon = document.getElementById('modal-icon');

  // Set title and icon based on object type
  const objectIcons = {
    'clock': '🕐',
    'lamp': '💡',
    'laptop': '💻',
    'globe': '🌍',
    'hourglass': '⏳',
    'metronome': '🎵',
    'photo-frame': '🖼️',
    'coffee': '☕',
    'pen-holder': '🖊️',
    'books': '📕',
    'magazine': '📰',
    'notebook': '📓',
    'paper': '📄'
  };

  title.textContent = object.userData.name;
  icon.textContent = objectIcons[object.userData.type] || '⚙️';

  // Generate content based on object type
  content.innerHTML = getInteractionContent(object);

  // Setup interaction handlers
  setupInteractionHandlers(object);

  // Exit pointer lock to show cursor for panel interaction
  if (pointerLockState.isLocked) {
    document.exitPointerLock();
  }

  // Show modal
  modal.classList.add('open');
  overlay.classList.add('open');
}

function closeInteractionModal() {
  const modal = document.getElementById('interaction-modal');
  const overlay = document.getElementById('modal-overlay');

  modal.classList.remove('open');
  overlay.classList.remove('open');
  interactionObject = null;

  // Re-acquire pointer lock so camera control works immediately
  const container = document.getElementById('game-container');
  if (container && !document.pointerLockElement) {
    try {
      container.requestPointerLock();
    } catch (e) {
      // Pointer lock might fail if user hasn't interacted yet
    }
  }
}

function getInteractionContent(object) {
  switch (object.userData.type) {
    case 'clock':
      const clockData = object.userData;
      const alarmHours = timerState.alarmHours || 0;
      const alarmMinutes = timerState.alarmMinutes || 0;
      const alarmEnabled = timerState.alarmEnabled || false;
      const alertVolume = Math.round((timerState.alertVolume || 0.5) * 100);
      const alertPitch = Math.round((timerState.alertPitch || 800) / 8); // Convert Hz to percentage (800Hz = 100%)
      return `
        <div class="timer-controls">
          <!-- Timer Section -->
          <div style="margin-bottom: 15px;">
            <div style="color: rgba(255,255,255,0.7); font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Timer</div>
            <div class="timer-display">
              <div class="time" id="timer-display">00:00:00</div>
            </div>
            <div class="timer-input-group">
              <input type="number" id="timer-hours" min="0" max="23" value="0" placeholder="HH" class="timer-scroll-input">
              <span>:</span>
              <input type="number" id="timer-minutes" min="0" max="59" value="5" placeholder="MM" class="timer-scroll-input">
              <span>:</span>
              <input type="number" id="timer-seconds" min="0" max="59" value="0" placeholder="SS" class="timer-scroll-input">
            </div>
            <div class="timer-buttons">
              <button class="timer-btn start" id="timer-start">Start</button>
              <button class="timer-btn pause" id="timer-pause" style="display:none">Pause</button>
              <button class="timer-btn reset" id="timer-reset">Reset</button>
            </div>
          </div>

          <!-- Alarm Section -->
          <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
            <div style="color: rgba(255,255,255,0.7); font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Alarm</div>
            <div class="timer-input-group">
              <input type="number" id="alarm-hours" min="0" max="23" value="${alarmHours}" placeholder="HH" class="timer-scroll-input">
              <span>:</span>
              <input type="number" id="alarm-minutes" min="0" max="59" value="${alarmMinutes}" placeholder="MM" class="timer-scroll-input">
            </div>
            <div class="timer-buttons" style="margin-top: 10px;">
              <button class="timer-btn ${alarmEnabled ? 'pause' : 'start'}" id="alarm-toggle">
                ${alarmEnabled ? 'Alarm ON' : 'Set Alarm'}
              </button>
              <button class="timer-btn reset" id="alarm-clear" ${!alarmEnabled ? 'disabled' : ''}>Clear</button>
            </div>
          </div>

          <!-- Sound Settings Accordion -->
          <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
            <div id="sound-settings-toggle" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 15px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; cursor: pointer;">
              <span style="color: rgba(255,255,255,0.8); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Sound Settings</span>
              <span id="sound-settings-arrow" style="color: rgba(255,255,255,0.5); font-size: 12px;">▼</span>
            </div>
            <div id="sound-settings-content" style="display: none; padding: 15px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-top: none; border-radius: 0 0 8px 8px;">
              <div style="margin-bottom: 15px;">
                <label style="display: block; color: rgba(255,255,255,0.7); font-size: 12px; margin-bottom: 8px;">Volume: <span id="alert-volume-display">${alertVolume}%</span></label>
                <input type="range" id="alert-volume" min="0" max="100" value="${alertVolume}" style="width: 100%; accent-color: #4f46e5;">
              </div>
              <div style="margin-bottom: 15px;">
                <label style="display: block; color: rgba(255,255,255,0.7); font-size: 12px; margin-bottom: 8px;">Pitch: <span id="alert-pitch-display">${alertPitch}%</span></label>
                <input type="range" id="alert-pitch" min="50" max="200" value="${alertPitch}" style="width: 100%; accent-color: #4f46e5;">
              </div>
              <div>
                <label style="display: block; color: rgba(255,255,255,0.7); font-size: 12px; margin-bottom: 8px;">Custom Sound</label>
                <div style="display: flex; flex-direction: column; gap: 10px;">
                  <label style="display: inline-block; padding: 10px 15px; background: rgba(79, 70, 229, 0.3); border: 1px solid rgba(79, 70, 229, 0.5); border-radius: 8px; color: #fff; cursor: pointer; text-align: center;">
                    ${timerState.customSoundDataUrl ? 'Change Sound' : 'Upload Sound'}
                    <input type="file" id="timer-custom-sound" accept="audio/*" style="display: none;">
                  </label>
                  ${timerState.customSoundDataUrl ? `
                    <button id="timer-use-custom" class="timer-btn start" style="width: 100%;">Use Custom Sound</button>
                    <button id="timer-clear-sound" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #ef4444; cursor: pointer;">Clear Sound</button>
                  ` : ''}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

    case 'lamp':
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" id="lamp-status">${object.userData.isOn ? 'ON' : 'OFF'}</div>
          </div>
          <div class="timer-buttons">
            <button class="timer-btn ${object.userData.isOn ? 'pause' : 'start'}" id="lamp-toggle">
              ${object.userData.isOn ? 'Turn Off' : 'Turn On'}
            </button>
          </div>
        </div>
      `;

    case 'laptop':
      const screenStatus = object.userData.isOn
        ? (object.userData.isBooting ? 'Booting...' : 'On')
        : 'Off';
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">Laptop</div>
            <div style="color: rgba(255,255,255,0.6); margin-top: 10px;">Status: ${screenStatus}</div>
          </div>
          <div class="timer-buttons" style="flex-direction: column; gap: 10px;">
            <button class="timer-btn ${object.userData.isOn ? 'pause' : 'start'}" id="laptop-power"
                    ${object.userData.isBooting ? 'disabled' : ''}>
              ${object.userData.isOn ? 'Shutdown' : 'Power On'}
            </button>
            ${object.userData.isOn && !object.userData.isBooting ? `
              <button class="timer-btn start" id="laptop-editor">Open Markdown Editor</button>
            ` : ''}
          </div>
          <div style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 15px;">
            <div style="color: rgba(255,255,255,0.7); font-size: 12px; margin-bottom: 8px;">Boot Screen Image</div>
            <div style="display: flex; gap: 8px;">
              <label class="timer-btn start" style="flex: 1; text-align: center; cursor: pointer;">
                ${object.userData.bootScreenDataUrl ? 'Change' : 'Upload'}
                <input type="file" id="laptop-boot-screen" accept="image/*" style="display: none;">
              </label>
              ${object.userData.bootScreenDataUrl ? `
                <button class="timer-btn reset" id="laptop-boot-clear">Clear</button>
              ` : ''}
            </div>
          </div>
          <div style="margin-top: 10px;">
            <div style="color: rgba(255,255,255,0.7); font-size: 12px; margin-bottom: 8px;">Power LED Color</div>
            <input type="color" id="laptop-led-color" value="${object.userData.powerLedColor || '#00ff00'}"
                   style="width: 40px; height: 30px; border: none; cursor: pointer;">
          </div>
          ${object.userData.isOn && !object.userData.isBooting ? `
            <div style="margin-top: 15px; color: rgba(255,255,255,0.5); font-size: 12px;">
              Middle-click laptop to toggle power
            </div>
          ` : ''}
        </div>
      `;

    case 'globe':
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">Rotation: ${object.userData.rotationSpeed > 0 ? 'ON' : 'OFF'}</div>
          </div>
          <div class="timer-buttons">
            <button class="timer-btn ${object.userData.rotationSpeed > 0 ? 'pause' : 'start'}" id="globe-toggle">
              ${object.userData.rotationSpeed > 0 ? 'Stop Rotation' : 'Start Rotation'}
            </button>
          </div>
        </div>
      `;

    case 'hourglass':
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">Hourglass</div>
          </div>
          <div class="timer-buttons">
            <button class="timer-btn start" id="hourglass-flip">Flip Hourglass</button>
          </div>
        </div>
      `;

    case 'metronome':
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" id="metronome-status" style="font-size: 28px;">${object.userData.isRunning ? 'RUNNING' : 'STOPPED'}</div>
            <div style="color: rgba(255,255,255,0.6); margin-top: 10px;">${object.userData.bpm} BPM</div>
          </div>
          <div class="timer-input-group">
            <input type="range" id="metronome-bpm" min="10" max="220" value="${object.userData.bpm}"
                   style="width: 100%; accent-color: #4f46e5;">
          </div>
          <div class="timer-buttons">
            <button class="timer-btn ${object.userData.isRunning ? 'pause' : 'start'}" id="metronome-toggle">
              ${object.userData.isRunning ? 'Stop' : 'Start'}
            </button>
            <button class="timer-btn ${object.userData.tickSound ? 'pause' : 'reset'}" id="metronome-sound">
              Sound: ${object.userData.tickSound ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      `;

    case 'photo-frame':
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">Photo Frame</div>
            <div style="color: rgba(255,255,255,0.6); margin-top: 10px;">Upload an image to display</div>
          </div>
          <div class="timer-buttons" style="flex-direction: column; gap: 15px;">
            <label class="timer-btn start" style="cursor: pointer; display: inline-block;">
              Choose Photo
              <input type="file" id="photo-upload" accept="image/*" style="display: none;">
            </label>
            <button class="timer-btn reset" id="photo-clear">Clear Photo</button>
          </div>
        </div>
      `;

    case 'coffee':
      const currentDrink = DRINK_COLORS[object.userData.drinkType] || DRINK_COLORS.coffee;
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">${currentDrink.name}</div>
            <div style="color: rgba(255,255,255,0.6); margin-top: 10px;">Middle-click to sip drink</div>
            <div style="color: rgba(255,255,255,0.5); margin-top: 5px;">Fill: ${Math.round(object.userData.liquidLevel * 100)}%</div>
          </div>
        </div>
      `;

    case 'pen-holder':
      const pensGroup = object.getObjectByName('pens');
      const availablePens = pensGroup ? pensGroup.children.filter(p => p.visible).map(p => p.userData.penColor) : [];
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">Pen Holder</div>
            <div style="color: rgba(255,255,255,0.6); margin-top: 10px;">
              ${drawingState.selectedPen ? `Holding: ${drawingState.selectedPen} pen` : 'Select a pen to draw'}
            </div>
          </div>
          <div class="timer-buttons" style="flex-wrap: wrap; gap: 10px;">
            ${[
              { name: 'red', color: '#ef4444' },
              { name: 'blue', color: '#3b82f6' },
              { name: 'green', color: '#22c55e' },
              { name: 'black', color: '#000000' }
            ].map(pen => {
              const isAvailable = availablePens.includes(pen.name);
              const isSelected = drawingState.selectedPen === pen.name;
              return `
                <button class="timer-btn ${isSelected ? 'pause' : 'start'}"
                        id="pen-${pen.name}"
                        style="min-width: 70px; background: ${isAvailable ? pen.color : '#444'}; opacity: ${isAvailable ? 1 : 0.3};"
                        ${!isAvailable ? 'disabled' : ''}>
                  ${pen.name.charAt(0).toUpperCase() + pen.name.slice(1)}
                </button>
              `;
            }).join('')}
          </div>
          ${drawingState.selectedPen ? `
            <div class="timer-buttons" style="margin-top: 15px;">
              <button class="timer-btn reset" id="pen-return">Return Pen</button>
            </div>
          ` : ''}
          <div style="color: rgba(255,255,255,0.5); margin-top: 15px; font-size: 12px;">
            With pen selected: hover over Notebook/Paper and draw with middle mouse button
          </div>
        </div>
      `;

    case 'books':
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">Book</div>
            <div style="color: rgba(255,255,255,0.6); margin-top: 10px;">
              ${object.userData.isOpen ? 'Book is open' : 'Middle-click to open'}
            </div>
          </div>
          <div style="margin-top: 15px;">
            <label style="color: rgba(255,255,255,0.7); display: block; margin-bottom: 8px;">Book Title</label>
            <input type="text" id="book-title" value="${object.userData.bookTitle || ''}"
                   placeholder="Enter book title"
                   style="width: 100%; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #fff;">
          </div>
          <div style="margin-top: 15px;">
            <label style="color: rgba(255,255,255,0.7); display: block; margin-bottom: 8px;">PDF File</label>
            <label class="timer-btn start" style="cursor: pointer; display: inline-block; width: 100%; text-align: center;">
              ${object.userData.pdfPath ? 'Change PDF' : 'Choose PDF'}
              <input type="file" id="book-pdf" accept=".pdf" style="display: none;">
            </label>
            ${object.userData.pdfPath ? `
              <div style="color: rgba(255,255,255,0.5); margin-top: 8px; font-size: 12px;">
                Current: ${object.userData.pdfPath.split('/').pop() || object.userData.pdfPath.split('\\\\').pop()}
              </div>
            ` : ''}
          </div>
          <div class="timer-buttons" style="margin-top: 15px;">
            <button class="timer-btn ${object.userData.isOpen ? 'pause' : 'start'}" id="book-toggle">
              ${object.userData.isOpen ? 'Close Book' : 'Open Book'}
            </button>
          </div>
          ${object.userData.isOpen && object.userData.totalPages > 0 ? `
            <div class="timer-buttons" style="margin-top: 10px;">
              <button class="timer-btn reset" id="book-prev" ${object.userData.currentPage <= 0 ? 'disabled' : ''}>← Prev</button>
              <span style="color: rgba(255,255,255,0.7); padding: 0 15px;">
                Page ${object.userData.currentPage + 1} / ${object.userData.totalPages}
              </span>
              <button class="timer-btn start" id="book-next" ${object.userData.currentPage >= object.userData.totalPages - 1 ? 'disabled' : ''}>Next →</button>
            </div>
          ` : ''}
        </div>
      `;

    case 'magazine':
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">Magazine</div>
            <div style="color: rgba(255,255,255,0.6); margin-top: 10px;">
              ${object.userData.isOpen ? 'Magazine is open' : 'Middle-click to open'}
            </div>
          </div>
          <div style="margin-top: 15px;">
            <label style="color: rgba(255,255,255,0.7); display: block; margin-bottom: 8px;">Magazine Title</label>
            <input type="text" id="magazine-title" value="${object.userData.magazineTitle || ''}"
                   placeholder="Enter magazine title"
                   style="width: 100%; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #fff;">
          </div>
          <div style="margin-top: 15px;">
            <label style="color: rgba(255,255,255,0.7); display: block; margin-bottom: 8px;">PDF File</label>
            <label class="timer-btn start" style="cursor: pointer; display: inline-block; width: 100%; text-align: center;">
              ${object.userData.pdfPath ? 'Change PDF' : 'Choose PDF'}
              <input type="file" id="magazine-pdf" accept=".pdf" style="display: none;">
            </label>
            ${object.userData.pdfPath ? `
              <div style="color: rgba(255,255,255,0.5); margin-top: 8px; font-size: 12px;">
                Current: ${object.userData.pdfPath.split('/').pop() || object.userData.pdfPath.split('\\\\').pop()}
              </div>
            ` : ''}
          </div>
          <div class="timer-buttons" style="margin-top: 15px;">
            <button class="timer-btn ${object.userData.isOpen ? 'pause' : 'start'}" id="magazine-toggle">
              ${object.userData.isOpen ? 'Close Magazine' : 'Open Magazine'}
            </button>
          </div>
          ${object.userData.isOpen && object.userData.totalPages > 0 ? `
            <div class="timer-buttons" style="margin-top: 10px;">
              <button class="timer-btn reset" id="magazine-prev" ${object.userData.currentPage <= 0 ? 'disabled' : ''}>← Prev</button>
              <span style="color: rgba(255,255,255,0.7); padding: 0 15px;">
                Page ${object.userData.currentPage + 1} / ${object.userData.totalPages}
              </span>
              <button class="timer-btn start" id="magazine-next" ${object.userData.currentPage >= object.userData.totalPages - 1 ? 'disabled' : ''}>Next →</button>
            </div>
          ` : ''}
        </div>
      `;

    case 'notebook':
    case 'paper':
      // Notebook and paper are drawing surfaces
      const hasDrawings = object.userData.drawingLines && object.userData.drawingLines.length > 0;
      return `
        <div class="timer-controls">
          <div class="timer-display">
            <div class="time" style="font-size: 24px;">${object.userData.type === 'notebook' ? '📓 Notebook' : '📄 Paper'}</div>
            <div style="color: rgba(255,255,255,0.7); margin-top: 15px; font-size: 14px;">
              This is a drawing surface.
            </div>
          </div>
          <div style="margin-top: 15px; padding: 15px; background: rgba(79, 70, 229, 0.1); border: 1px solid rgba(79, 70, 229, 0.3); border-radius: 8px;">
            <div style="color: rgba(255,255,255,0.8); font-size: 13px; margin-bottom: 10px;">How to draw:</div>
            <ol style="color: rgba(255,255,255,0.7); font-size: 12px; margin: 0; padding-left: 20px; line-height: 1.8;">
              <li>Add a pen to the desk</li>
              <li>Hover over the pen and press <strong>MMB</strong> to enter drawing mode</li>
              <li>Move the pen over this surface</li>
              <li>Hold <strong>LMB</strong> to draw</li>
              <li>Press <strong>MMB</strong> again to exit drawing mode</li>
            </ol>
          </div>
          ${hasDrawings ? `
            <div style="margin-top: 15px; color: rgba(255,255,255,0.5); font-size: 12px;">
              ✏️ This surface has drawings
            </div>
          ` : ''}
        </div>
      `;

    default:
      return `<p style="color: rgba(255,255,255,0.7);">No interactions available for this object.</p>`;
  }
}

function setupInteractionHandlers(object) {
  switch (object.userData.type) {
    case 'clock':
      setupTimerHandlers();
      break;
    case 'lamp':
      setupLampHandlers(object);
      break;
    case 'laptop':
      setupLaptopHandlers(object);
      break;
    case 'globe':
      setupGlobeHandlers(object);
      break;
    case 'hourglass':
      setupHourglassHandlers(object);
      break;
    case 'metronome':
      setupMetronomeHandlers(object);
      break;
    case 'photo-frame':
      setupPhotoFrameHandlers(object);
      break;
    case 'coffee':
      setupMugHandlers(object);
      break;
    case 'pen-holder':
      setupPenHolderHandlers(object);
      break;
    case 'books':
      setupBookHandlers(object);
      break;
    case 'magazine':
      setupMagazineHandlers(object);
      break;
  }
}

function setupTimerHandlers() {
  const startBtn = document.getElementById('timer-start');
  const pauseBtn = document.getElementById('timer-pause');
  const resetBtn = document.getElementById('timer-reset');
  const display = document.getElementById('timer-display');

  // Initialize display with current timer state
  if (timerState.active) {
    updateTimerDisplay();
    if (timerState.running) {
      startBtn.style.display = 'none';
      pauseBtn.style.display = 'inline-block';
      display.classList.add('running');
    }
  }

  startBtn.addEventListener('click', () => {
    const hours = parseInt(document.getElementById('timer-hours').value) || 0;
    const minutes = parseInt(document.getElementById('timer-minutes').value) || 0;
    const seconds = parseInt(document.getElementById('timer-seconds').value) || 0;

    timerState.remainingSeconds = hours * 3600 + minutes * 60 + seconds;

    if (timerState.remainingSeconds > 0) {
      timerState.active = true;
      timerState.running = true;
      startBtn.style.display = 'none';
      pauseBtn.style.display = 'inline-block';
      display.classList.add('running');
      display.classList.remove('paused');

      timerState.intervalId = setInterval(() => {
        if (timerState.remainingSeconds > 0) {
          timerState.remainingSeconds--;
          updateTimerDisplay();
        } else {
          // Timer finished - alert user
          clearInterval(timerState.intervalId);
          timerState.running = false;
          timerState.active = false;
          display.classList.remove('running');

          // Play a notification sound or visual alert
          playTimerAlert();
        }
      }, 1000);

      // Close modal after starting timer
      closeInteractionModal();
    }
  });

  pauseBtn.addEventListener('click', () => {
    if (timerState.running) {
      clearInterval(timerState.intervalId);
      timerState.running = false;
      startBtn.textContent = 'Resume';
      startBtn.style.display = 'inline-block';
      pauseBtn.style.display = 'none';
      display.classList.remove('running');
      display.classList.add('paused');
    }
  });

  resetBtn.addEventListener('click', () => {
    clearInterval(timerState.intervalId);
    timerState.active = false;
    timerState.running = false;
    timerState.remainingSeconds = 0;
    startBtn.textContent = 'Start';
    startBtn.style.display = 'inline-block';
    pauseBtn.style.display = 'none';
    display.textContent = '00:00:00';
    display.classList.remove('running', 'paused');
  });

  // Setup alarm handlers
  const alarmToggleBtn = document.getElementById('alarm-toggle');
  const alarmClearBtn = document.getElementById('alarm-clear');

  if (alarmToggleBtn) {
    alarmToggleBtn.addEventListener('click', () => {
      const alarmHours = parseInt(document.getElementById('alarm-hours').value) || 0;
      const alarmMinutes = parseInt(document.getElementById('alarm-minutes').value) || 0;

      if (!timerState.alarmEnabled) {
        // Set alarm
        timerState.alarmHours = alarmHours;
        timerState.alarmMinutes = alarmMinutes;
        timerState.alarmEnabled = true;
        timerState.alarmTriggered = false;

        alarmToggleBtn.textContent = 'Alarm ON';
        alarmToggleBtn.classList.remove('start');
        alarmToggleBtn.classList.add('pause');
        alarmClearBtn.disabled = false;

        // Update the alarm hand on clock objects
        updateAlarmHandsOnAllClocks();

        // Close modal after setting alarm
        closeInteractionModal();
      } else {
        // Toggle off
        timerState.alarmEnabled = false;
        alarmToggleBtn.textContent = 'Set Alarm';
        alarmToggleBtn.classList.remove('pause');
        alarmToggleBtn.classList.add('start');
        alarmClearBtn.disabled = true;

        // Hide alarm hand
        updateAlarmHandsOnAllClocks();
      }
    });
  }

  if (alarmClearBtn) {
    alarmClearBtn.addEventListener('click', () => {
      timerState.alarmEnabled = false;
      timerState.alarmTriggered = false;
      alarmToggleBtn.textContent = 'Set Alarm';
      alarmToggleBtn.classList.remove('pause');
      alarmToggleBtn.classList.add('start');
      alarmClearBtn.disabled = true;

      // Hide alarm hand
      updateAlarmHandsOnAllClocks();
    });
  }

  // Add real-time alarm hand preview when changing alarm time inputs
  const alarmHoursInput = document.getElementById('alarm-hours');
  const alarmMinutesInput = document.getElementById('alarm-minutes');

  const updateAlarmHandPreview = () => {
    const hours = parseInt(alarmHoursInput?.value) || 0;
    const minutes = parseInt(alarmMinutesInput?.value) || 0;
    // Update preview on all clocks by temporarily setting the values
    const prevHours = timerState.alarmHours;
    const prevMinutes = timerState.alarmMinutes;
    const wasEnabled = timerState.alarmEnabled;

    // Temporarily enable and set values for preview
    timerState.alarmHours = hours;
    timerState.alarmMinutes = minutes;
    timerState.alarmEnabled = true;
    updateAlarmHandsOnAllClocks();

    // Restore previous enabled state but keep the new time values
    // This way the hand shows the preview position but the alarm isn't actually set
    if (!wasEnabled) {
      // Keep showing the preview even if not enabled yet
      // The hand will remain visible as a preview
    }
  };

  if (alarmHoursInput) {
    alarmHoursInput.addEventListener('input', updateAlarmHandPreview);
    alarmHoursInput.addEventListener('wheel', (e) => {
      // Let the wheel event happen first, then update preview
      setTimeout(updateAlarmHandPreview, 0);
    });
  }

  if (alarmMinutesInput) {
    alarmMinutesInput.addEventListener('input', updateAlarmHandPreview);
    alarmMinutesInput.addEventListener('wheel', (e) => {
      // Let the wheel event happen first, then update preview
      setTimeout(updateAlarmHandPreview, 0);
    });
  }

  // Setup sound settings accordion
  const soundSettingsToggle = document.getElementById('sound-settings-toggle');
  const soundSettingsContent = document.getElementById('sound-settings-content');
  const soundSettingsArrow = document.getElementById('sound-settings-arrow');

  if (soundSettingsToggle) {
    soundSettingsToggle.addEventListener('click', () => {
      const isOpen = soundSettingsContent.style.display !== 'none';
      soundSettingsContent.style.display = isOpen ? 'none' : 'block';
      soundSettingsArrow.textContent = isOpen ? '▼' : '▲';
      soundSettingsToggle.style.borderRadius = isOpen ? '8px' : '8px 8px 0 0';
    });
  }

  // Volume slider
  const volumeSlider = document.getElementById('alert-volume');
  const volumeDisplay = document.getElementById('alert-volume-display');
  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      timerState.alertVolume = parseInt(e.target.value) / 100;
      volumeDisplay.textContent = e.target.value + '%';
    });
    addScrollToSlider(volumeSlider);
  }

  // Pitch slider
  const pitchSlider = document.getElementById('alert-pitch');
  const pitchDisplay = document.getElementById('alert-pitch-display');
  if (pitchSlider) {
    pitchSlider.addEventListener('input', (e) => {
      timerState.alertPitch = parseInt(e.target.value) * 8; // Convert percentage to Hz (100% = 800Hz)
      pitchDisplay.textContent = e.target.value + '%';
    });
    addScrollToSlider(pitchSlider);
  }

  // Custom sound upload
  const customSoundInput = document.getElementById('timer-custom-sound');
  if (customSoundInput) {
    customSoundInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // Check if file is audio by MIME type or extension (some files may not have proper MIME type in Electron)
      const isAudioByType = file.type.startsWith('audio/');
      const extension = file.name.split('.').pop().toLowerCase();

      // First, check for explicitly unsupported formats
      if (UNSUPPORTED_AUDIO_FORMATS.includes(extension)) {
        console.log('Timer file rejected - unsupported format:', file.name);
        alert(`The "${extension.toUpperCase()}" format is not supported.\n\nPlease convert your audio file to MP3, WAV, or OGG format.`);
        e.target.value = '';
        return;
      }

      const isAudioByExtension = SUPPORTED_AUDIO_FORMATS.includes(extension);

      if (!isAudioByType && !isAudioByExtension) {
        console.log('Timer file rejected - not recognized as audio:', file.name, 'type:', file.type);
        alert('Please select an audio file (MP3, WAV, OGG, etc.)');
        e.target.value = '';
        return;
      }

      console.log('Loading timer custom sound:', file.name);

      // Show loading indicator
      const uploadBtn = document.querySelector('.upload-btn');
      const originalBtnText = uploadBtn ? uploadBtn.textContent : '';
      if (uploadBtn) {
        uploadBtn.textContent = 'Loading...';
        uploadBtn.style.opacity = '0.7';
        uploadBtn.style.pointerEvents = 'none';
      }

      try {
        // Use the robust audio loading helper
        const { dataUrl } = await loadAudioFromFile(file);

        timerState.useCustomSound = true;
        timerState.customSoundDataUrl = dataUrl;

        console.log('Timer custom sound loaded successfully');

        // Refresh the modal to show new buttons
        if (interactionObject && interactionObject.userData.type === 'clock') {
          const content = document.getElementById('interaction-content');
          content.innerHTML = getInteractionContent(interactionObject);
          setupTimerHandlers();
        }
      } catch (err) {
        console.error('Error loading timer custom sound:', err);
        alert('Could not load audio file:\n\n' + (err.message || 'Unknown error'));
        // Reset the file input
        e.target.value = '';
        // Restore upload button
        if (uploadBtn) {
          uploadBtn.textContent = originalBtnText;
          uploadBtn.style.opacity = '';
          uploadBtn.style.pointerEvents = '';
        }
      }
    });
  }

  // Use custom sound button
  const useCustomBtn = document.getElementById('timer-use-custom');
  if (useCustomBtn) {
    useCustomBtn.addEventListener('click', () => {
      timerState.useCustomSound = true;
    });
  }

  // Clear custom sound button
  const clearSoundBtn = document.getElementById('timer-clear-sound');
  if (clearSoundBtn) {
    clearSoundBtn.addEventListener('click', () => {
      timerState.customSoundDataUrl = null;
      timerState.useCustomSound = false;
      // Refresh the modal
      if (interactionObject && interactionObject.userData.type === 'clock') {
        const content = document.getElementById('interaction-content');
        content.innerHTML = getInteractionContent(interactionObject);
        setupTimerHandlers();
      }
    });
  }

  // Setup scroll-based digit change for timer inputs
  setupScrollInputs();
}

// Setup scroll-based digit change for timer/alarm inputs
function setupScrollInputs() {
  const scrollInputs = document.querySelectorAll('.timer-scroll-input');
  scrollInputs.forEach(input => {
    input.addEventListener('wheel', (e) => {
      e.preventDefault();
      const currentValue = parseInt(input.value) || 0;
      const min = parseInt(input.min) || 0;
      const max = parseInt(input.max) || 59;
      const step = e.deltaY < 0 ? 1 : -1;
      let newValue = currentValue + step;

      // Wrap around
      if (newValue > max) newValue = min;
      if (newValue < min) newValue = max;

      input.value = newValue;
    });
  });
}

// Preload custom sound for timer to avoid delay
async function preloadTimerCustomSound() {
  if (!timerState.customSoundDataUrl) return;

  try {
    console.log('Validating timer custom sound...');

    // Just validate that the data URL can create a playable audio element
    // No need to decode - HTML5 Audio handles it at play time
    const testAudio = new Audio(timerState.customSoundDataUrl);

    // Wait for the audio to be ready to play
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Audio validation timeout')), 5000);

      testAudio.oncanplaythrough = () => {
        clearTimeout(timeout);
        resolve();
      };

      testAudio.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Audio validation failed'));
      };

      testAudio.load();
    });

    // Automatically enable custom sound when validated successfully
    timerState.useCustomSound = true;
    console.log('Timer custom sound validated successfully');
  } catch (e) {
    console.error('Error validating timer custom sound:', e);
    // Reset custom sound state on error - but don't show alert during preload
    // as this could be triggered during page load
    timerState.customSoundDataUrl = null;
    timerState.useCustomSound = false;
  }
}

// Update alarm hands on all clock objects
// Update the alarm hand position on a clock object
function updateClockAlarmHand(clockObject) {
  const alarmHand = clockObject.getObjectByName('alarmHand');
  if (!alarmHand) return;

  if (timerState.alarmEnabled) {
    // Show the alarm hand
    alarmHand.visible = true;

    // Calculate angle for alarm time (like an hour hand)
    // 12 hours = 360 degrees, so each hour = 30 degrees
    // Convert to 12-hour format and calculate angle
    // Use the same formula as the hour hand: -(hourFloat / 12) * Math.PI * 2
    const hours12 = (timerState.alarmHours % 12) + timerState.alarmMinutes / 60;
    const angle = -(hours12 / 12) * Math.PI * 2;
    alarmHand.rotation.z = angle;
  } else {
    // Hide the alarm hand
    alarmHand.visible = false;
  }
}

function updateAlarmHandsOnAllClocks() {
  deskObjects.forEach(obj => {
    if (obj.userData.type === 'clock') {
      updateClockAlarmHand(obj);
    }
  });
}

function updateTimerDisplay() {
  const display = document.getElementById('timer-display');
  if (display) {
    const hours = Math.floor(timerState.remainingSeconds / 3600);
    const minutes = Math.floor((timerState.remainingSeconds % 3600) / 60);
    const seconds = timerState.remainingSeconds % 60;
    display.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}

function playTimerAlert() {
  // Visual alert - flash the background
  const modal = document.getElementById('interaction-modal');
  modal.style.animation = 'timerAlert 0.5s ease 3';
  setTimeout(() => {
    modal.style.animation = '';
  }, 1500);

  const volume = timerState.alertVolume || 0.5;
  const pitch = timerState.alertPitch || 800;

  // Find a clock object for spatial audio positioning
  // Use the first clock in the scene (alarm is global but we position sound at a clock)
  const clockObject = deskObjects.find(obj => obj.userData.type === 'clock');
  const spatial = clockObject ? calculateSpatialAudio(clockObject) : { pan: 0, volume: 1 };
  const spatialVolume = volume * spatial.volume;

  // Check if custom sound is available and should be used
  // Use HTML5 Audio element for playback (doesn't hang like Web Audio API decodeAudioData)
  if (timerState.useCustomSound && timerState.customSoundDataUrl) {
    try {
      timerState.isAlerting = true;

      // Use Web Audio API for spatial audio processing
      const audioCtx = getSharedAudioContext();
      const audio = new Audio(timerState.customSoundDataUrl);
      timerState.customAudioElement = audio;
      audio.playbackRate = pitch / 800; // Pitch adjustment via playback rate

      // Create media element source for spatial audio
      const source = audioCtx.createMediaElementSource(audio);
      const panner = audioCtx.createStereoPanner();
      const gain = audioCtx.createGain();

      // Playback chain: source -> panner (camera-relative) -> gain -> master
      source.connect(panner);
      panner.connect(gain);
      gain.connect(sharedAudioSystem.masterGain);

      // Connect source to mono recording (no spatial processing)
      source.connect(sharedAudioSystem.recordingGain);

      // Create recording spatial nodes (dictaphone-relative) for panoramic recording
      const recordingPanner = audioCtx.createStereoPanner();
      const recordingGain = audioCtx.createGain();
      source.connect(recordingPanner);
      recordingPanner.connect(recordingGain);
      recordingGain.connect(sharedAudioSystem.recordingGainPanorama);
      recordingPanner.pan.value = 0; // Will be updated in real-time
      recordingGain.gain.value = 1;

      panner.pan.value = spatial.pan;
      gain.gain.value = spatialVolume;

      // Store for cleanup
      timerState.alertSpatialNodes = { source, panner, gain, recordingPanner, recordingGain };
      timerState.alertClockObject = clockObject;

      // Register with spatial audio system for real-time position updates (playback)
      if (clockObject && clockObject.userData && clockObject.userData.id) {
        sharedAudioSystem.spatialNodes.set('clock-alarm-' + clockObject.userData.id, {
          pannerNode: panner,
          gainNode: gain,
          object: clockObject,
          baseVolume: volume  // Store base volume for recalculation
        });
        // Register recording spatial nodes for dictaphone-relative updates
        sharedAudioSystem.recordingSpatialNodes.set('clock-alarm-' + clockObject.userData.id, {
          pannerNode: recordingPanner,
          gainNode: recordingGain,
          object: clockObject,
          baseVolume: volume
        });
      }

      // Play custom sound in a loop
      const playCustomLoop = () => {
        if (!timerState.isAlerting) return;

        try {
          audio.currentTime = 0;
          audio.play().catch(err => {
            console.error('Error playing custom sound:', err);
            stopTimerAlert();
            playDefaultTimerAlert(volume, pitch, spatial);
          });
        } catch (playErr) {
          console.error('Error playing custom sound:', playErr);
          stopTimerAlert();
          playDefaultTimerAlert(volume, pitch, spatial);
        }
      };

      // Loop the sound
      audio.onended = () => {
        if (timerState.isAlerting) {
          setTimeout(playCustomLoop, 500); // 500ms pause between plays
        }
      };

      playCustomLoop();

      // Auto-stop after 30 seconds
      setTimeout(() => {
        stopTimerAlert();
      }, 30000);
    } catch (e) {
      console.log('Custom audio not available, falling back to default:', e.message);
      playDefaultTimerAlert(volume, pitch, spatial);
    }
  } else {
    playDefaultTimerAlert(volume, pitch, spatial);
  }
}

function playDefaultTimerAlert(volume, pitch, spatial = { pan: 0, volume: 1 }) {
  // Play a continuous beeping sound using Web Audio API with spatial audio
  // The sound will continue until stopped by middle-click on clock
  try {
    // Use shared audio context for proper spatial audio and recording support
    const audioCtx = getSharedAudioContext();
    timerState.alertAudioCtx = audioCtx;
    timerState.alertOscillator = audioCtx.createOscillator();
    const pulseGainNode = audioCtx.createGain();  // For on/off pulsing
    const spatialGainNode = audioCtx.createGain();  // For spatial volume (can be updated)
    const pannerNode = audioCtx.createStereoPanner();

    // Playback chain: oscillator -> pulseGain -> spatialGain -> panner (camera-relative) -> master
    timerState.alertOscillator.connect(pulseGainNode);
    pulseGainNode.connect(spatialGainNode);
    spatialGainNode.connect(pannerNode);
    pannerNode.connect(sharedAudioSystem.masterGain);

    // Connect pulseGain to mono recording (no spatial processing)
    pulseGainNode.connect(sharedAudioSystem.recordingGain);

    // Create recording spatial nodes (dictaphone-relative) for panoramic recording
    const recordingPanner = audioCtx.createStereoPanner();
    const recordingGainNode = audioCtx.createGain();
    pulseGainNode.connect(recordingPanner);
    recordingPanner.connect(recordingGainNode);
    recordingGainNode.connect(sharedAudioSystem.recordingGainPanorama);
    recordingPanner.pan.value = 0; // Will be updated in real-time
    recordingGainNode.gain.value = 1;

    // Apply spatial audio panning and initial volume
    pannerNode.pan.value = spatial.pan;
    spatialGainNode.gain.value = spatial.volume;

    timerState.alertOscillator.frequency.value = pitch;
    timerState.alertOscillator.type = 'sine';

    // Create a pulsing effect by modulating the pulse gain (on/off)
    const now = audioCtx.currentTime;
    const peakGain = 0.6 * volume;  // Base volume without spatial (spatial handled separately)

    // Pulse the sound on/off
    let time = now;
    for (let i = 0; i < 60; i++) { // Up to 30 seconds of pulsing (60 * 0.5s)
      pulseGainNode.gain.setValueAtTime(peakGain, time);
      pulseGainNode.gain.setValueAtTime(0, time + 0.3);
      time += 0.5;
    }

    // Store spatial nodes for cleanup
    timerState.alertSpatialNodes = {
      panner: pannerNode,
      gain: spatialGainNode,
      pulseGain: pulseGainNode,
      recordingPanner: recordingPanner,
      recordingGain: recordingGainNode
    };

    // Find clock object for spatial audio updates
    const clockObject = deskObjects.find(obj => obj.userData.type === 'clock');
    timerState.alertClockObject = clockObject;

    // Register with spatial audio system for real-time position updates (playback)
    if (clockObject && clockObject.userData && clockObject.userData.id) {
      sharedAudioSystem.spatialNodes.set('clock-alarm-' + clockObject.userData.id, {
        pannerNode: pannerNode,
        gainNode: spatialGainNode,
        object: clockObject,
        baseVolume: 1  // Volume already applied via pulse gain
      });
      // Register recording spatial nodes for dictaphone-relative updates
      sharedAudioSystem.recordingSpatialNodes.set('clock-alarm-' + clockObject.userData.id, {
        pannerNode: recordingPanner,
        gainNode: recordingGainNode,
        object: clockObject,
        baseVolume: 1
      });
    }

    timerState.alertOscillator.start();
    timerState.isAlerting = true;

    // Auto-stop after 30 seconds if not manually stopped
    setTimeout(() => {
      stopTimerAlert();
    }, 30000);
  } catch (e) {
    console.log('Audio not available:', e);
  }
}

function stopTimerAlert() {
  timerState.isAlerting = false; // Stop any custom sound loops first

  // Remove from spatial audio systems before disconnecting
  if (timerState.alertClockObject && timerState.alertClockObject.userData && timerState.alertClockObject.userData.id) {
    const clockAlarmId = 'clock-alarm-' + timerState.alertClockObject.userData.id;
    sharedAudioSystem.spatialNodes.delete(clockAlarmId);
    sharedAudioSystem.recordingSpatialNodes.delete(clockAlarmId);
  }
  timerState.alertClockObject = null;

  // Stop HTML5 Audio element if playing (custom sound)
  if (timerState.customAudioElement) {
    try {
      timerState.customAudioElement.pause();
      timerState.customAudioElement.currentTime = 0;
    } catch (e) {
      // Ignore if already stopped
    }
    timerState.customAudioElement = null;
  }

  // Disconnect spatial audio nodes (both playback and recording)
  if (timerState.alertSpatialNodes) {
    try {
      if (timerState.alertSpatialNodes.source) timerState.alertSpatialNodes.source.disconnect();
      if (timerState.alertSpatialNodes.panner) timerState.alertSpatialNodes.panner.disconnect();
      if (timerState.alertSpatialNodes.gain) timerState.alertSpatialNodes.gain.disconnect();
      if (timerState.alertSpatialNodes.pulseGain) timerState.alertSpatialNodes.pulseGain.disconnect();
      if (timerState.alertSpatialNodes.recordingPanner) timerState.alertSpatialNodes.recordingPanner.disconnect();
      if (timerState.alertSpatialNodes.recordingGain) timerState.alertSpatialNodes.recordingGain.disconnect();
    } catch (e) {
      // Ignore if already disconnected
    }
    timerState.alertSpatialNodes = null;
  }

  // Stop Web Audio API oscillator if playing (default alert)
  if (timerState.alertOscillator) {
    try {
      timerState.alertOscillator.stop();
      // We now use the shared audio context, so don't close it
    } catch (e) {
      // Ignore if already stopped
    }
    timerState.alertOscillator = null;
    timerState.alertAudioCtx = null;
  }
}

function setupLampHandlers(object) {
  const toggleBtn = document.getElementById('lamp-toggle');
  const status = document.getElementById('lamp-status');

  toggleBtn.addEventListener('click', () => {
    object.userData.isOn = !object.userData.isOn;

    const bulb = object.getObjectByName('bulb');
    const light = object.getObjectByName('lampLight');
    const spotLight = object.getObjectByName('lampSpotLight');
    const ambientLight = object.getObjectByName('lampAmbient');

    if (object.userData.isOn) {
      if (bulb) {
        bulb.material.emissiveIntensity = 1.5;
      }
      if (light) {
        light.intensity = 0.8;
      }
      if (spotLight) {
        spotLight.intensity = 3.0;
      }
      if (ambientLight) {
        ambientLight.intensity = 0.3;
      }
      status.textContent = 'ON';
      toggleBtn.textContent = 'Turn Off';
      toggleBtn.className = 'timer-btn pause';
    } else {
      if (bulb) {
        bulb.material.emissiveIntensity = 0;
      }
      if (light) {
        light.intensity = 0;
      }
      if (spotLight) {
        spotLight.intensity = 0;
      }
      if (ambientLight) {
        ambientLight.intensity = 0;
      }
      status.textContent = 'OFF';
      toggleBtn.textContent = 'Turn On';
      toggleBtn.className = 'timer-btn start';
    }
  });
}

function setupLaptopHandlers(object) {
  const powerBtn = document.getElementById('laptop-power');
  const editorBtn = document.getElementById('laptop-editor');
  const bootScreenInput = document.getElementById('laptop-boot-screen');
  const bootClearBtn = document.getElementById('laptop-boot-clear');
  const ledColorInput = document.getElementById('laptop-led-color');

  if (powerBtn) {
    powerBtn.addEventListener('click', () => {
      toggleLaptopPower(object);
      // Refresh modal after state change
      setTimeout(() => {
        if (interactionObject === object) {
          const content = document.getElementById('interaction-content');
          content.innerHTML = getInteractionContent(object);
          setupInteractionHandlers(object);
        }
      }, 100);
    });
  }

  if (editorBtn) {
    editorBtn.addEventListener('click', () => {
      openMarkdownEditor(object);
    });
  }

  if (bootScreenInput) {
    bootScreenInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const imageUrl = event.target.result;
          object.userData.bootScreenDataUrl = imageUrl;

          // Create texture for boot screen
          const textureLoader = new THREE.TextureLoader();
          textureLoader.load(imageUrl, (texture) => {
            object.userData.bootScreenTexture = texture;
            saveState();
            // Refresh modal to show updated button
            if (interactionObject === object) {
              const content = document.getElementById('interaction-content');
              content.innerHTML = getInteractionContent(object);
              setupInteractionHandlers(object);
            }
          });
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (bootClearBtn) {
    bootClearBtn.addEventListener('click', () => {
      if (object.userData.bootScreenTexture) {
        object.userData.bootScreenTexture.dispose();
        object.userData.bootScreenTexture = null;
      }
      object.userData.bootScreenDataUrl = null;
      saveState();
      // Refresh modal
      if (interactionObject === object) {
        const content = document.getElementById('interaction-content');
        content.innerHTML = getInteractionContent(object);
        setupInteractionHandlers(object);
      }
    });
  }

  if (ledColorInput) {
    ledColorInput.addEventListener('change', (e) => {
      object.userData.powerLedColor = e.target.value;
      // Update LED color if laptop is on
      if (object.userData.isOn) {
        const powerLed = object.getObjectByName('powerLed');
        if (powerLed) {
          const ledColor = new THREE.Color(e.target.value);
          powerLed.material.color.copy(ledColor);
          powerLed.material.emissive.copy(ledColor);
        }
      }
      saveState();
    });
  }
}

// Markdown Editor Functions
// Helper function to generate filename with timestamp for saving notes
function getTimestampedFilename(baseName) {
  // Remove .md extension if present
  let name = baseName;
  if (name.endsWith('.md')) {
    name = name.slice(0, -3);
  }

  // Create timestamp in format: YYYY-MM-DD HH-MM-SS
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `${year}-${month}-${day} ${hours}-${minutes}-${seconds}`;

  // Return filename with timestamp (space separated) and .md extension
  return `${name} ${timestamp}.md`;
}

function openMarkdownEditor(laptop) {
  // Close the interaction modal
  closeInteractionModal();
  exitExamineMode();

  // Exit pointer lock to show cursor for editor interaction
  if (document.pointerLockElement) {
    document.exitPointerLock();
  }

  // Create markdown editor overlay
  const editorOverlay = document.createElement('div');
  editorOverlay.id = 'markdown-editor-overlay';
  editorOverlay.innerHTML = `
    <div class="md-editor-container">
      <div class="md-editor-header">
        <div class="md-editor-title">
          <span class="md-editor-icon">📝</span>
          <input type="text" id="md-filename" value="${laptop.userData.editorFileName}" class="md-filename-input">
        </div>
        <div class="md-editor-actions">
          <button id="md-save" class="md-btn md-btn-save">Save</button>
          <button id="md-close" class="md-btn md-btn-close">×</button>
        </div>
      </div>
      <div class="md-editor-body">
        <div class="md-editor-pane md-editor-source">
          <div class="md-pane-header">Source</div>
          <textarea id="md-source" placeholder="Write your markdown here...">${laptop.userData.editorContent}</textarea>
        </div>
        <div class="md-editor-pane md-editor-preview">
          <div class="md-pane-header">Preview</div>
          <div id="md-preview" class="md-preview-content"></div>
        </div>
      </div>
      <div class="md-editor-footer">
        <span class="md-status">Obsidian-style Markdown Editor</span>
        <span class="md-word-count" id="md-word-count">0 words</span>
      </div>
    </div>
  `;
  document.body.appendChild(editorOverlay);

  // Add editor styles
  if (!document.getElementById('md-editor-styles')) {
    const styles = document.createElement('style');
    styles.id = 'md-editor-styles';
    styles.textContent = `
      #markdown-editor-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.9);
        z-index: 300;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.3s ease;
        /* Custom laptop-style cursor using SVG data URL */
        cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='20' viewBox='0 0 16 20'%3E%3Cpath fill='white' stroke='black' stroke-width='1' d='M1,1 L1,16 L4,13 L7,19 L9,18 L6,12 L10,12 Z'/%3E%3C/svg%3E") 1 1, auto;
      }
      #markdown-editor-overlay * {
        cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='20' viewBox='0 0 16 20'%3E%3Cpath fill='white' stroke='black' stroke-width='1' d='M1,1 L1,16 L4,13 L7,19 L9,18 L6,12 L10,12 Z'/%3E%3C/svg%3E") 1 1, auto;
      }
      #markdown-editor-overlay textarea, #markdown-editor-overlay input {
        cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='2' height='16' viewBox='0 0 2 16'%3E%3Crect fill='white' stroke='black' stroke-width='0.5' x='0' y='0' width='2' height='16'/%3E%3C/svg%3E") 1 8, text;
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .md-editor-container {
        width: 90%;
        height: 85%;
        max-width: 1400px;
        background: #1e1e2e;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      .md-editor-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 15px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.2);
        border-radius: 12px 12px 0 0;
      }
      .md-editor-title {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .md-editor-icon { font-size: 20px; }
      .md-filename-input {
        background: transparent;
        border: 1px solid transparent;
        color: #fff;
        font-size: 16px;
        padding: 5px 10px;
        border-radius: 6px;
      }
      .md-filename-input:focus {
        border-color: rgba(139, 92, 246, 0.5);
        outline: none;
        background: rgba(255, 255, 255, 0.05);
      }
      .md-editor-actions { display: flex; gap: 10px; }
      .md-btn {
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
      }
      .md-btn-save {
        background: rgba(139, 92, 246, 0.8);
        color: #fff;
      }
      .md-btn-save:hover { background: rgba(139, 92, 246, 1); }
      .md-btn-close {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
        font-size: 18px;
        padding: 8px 12px;
      }
      .md-btn-close:hover { background: rgba(255, 255, 255, 0.2); }
      .md-editor-body {
        flex: 1;
        display: flex;
        overflow: hidden;
      }
      .md-editor-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .md-editor-source { border-right: 1px solid rgba(255, 255, 255, 0.1); }
      .md-pane-header {
        padding: 8px 15px;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: rgba(255, 255, 255, 0.5);
        background: rgba(0, 0, 0, 0.2);
      }
      #md-source {
        flex: 1;
        background: transparent;
        border: none;
        color: #cdd6f4;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 14px;
        line-height: 1.6;
        padding: 15px;
        resize: none;
        outline: none;
      }
      #md-source::placeholder { color: rgba(255, 255, 255, 0.3); }
      .md-preview-content {
        flex: 1;
        padding: 15px;
        overflow-y: auto;
        color: #cdd6f4;
        font-size: 14px;
        line-height: 1.8;
      }
      .md-preview-content h1 { font-size: 2em; color: #cba6f7; margin: 0.5em 0; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.3em; }
      .md-preview-content h2 { font-size: 1.5em; color: #89b4fa; margin: 0.5em 0; }
      .md-preview-content h3 { font-size: 1.25em; color: #94e2d5; margin: 0.5em 0; }
      .md-preview-content p { margin: 0.8em 0; }
      .md-preview-content code { background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-family: monospace; }
      .md-preview-content pre { background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; overflow-x: auto; }
      .md-preview-content pre code { background: none; padding: 0; }
      .md-preview-content blockquote { border-left: 3px solid #cba6f7; padding-left: 15px; margin: 1em 0; color: rgba(255,255,255,0.7); }
      .md-preview-content ul, .md-preview-content ol { padding-left: 25px; margin: 0.5em 0; }
      .md-preview-content li { margin: 0.3em 0; }
      .md-preview-content li.checkbox { list-style: none; margin-left: -20px; }
      .md-preview-content li.checkbox input[type="checkbox"] { margin-right: 8px; transform: scale(1.2); accent-color: #a6e3a1; }
      .md-preview-content li.checkbox.checked { text-decoration: line-through; color: rgba(255,255,255,0.5); }
      .md-preview-content a { color: #89b4fa; }
      .md-preview-content strong { color: #f9e2af; }
      .md-preview-content em { color: #a6e3a1; }
      .md-preview-content hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 1.5em 0; }
      .md-editor-footer {
        display: flex;
        justify-content: space-between;
        padding: 10px 20px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.5);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.2);
        border-radius: 0 0 12px 12px;
      }
    `;
    document.head.appendChild(styles);
  }

  // Setup editor functionality
  const sourceTextarea = document.getElementById('md-source');
  const preview = document.getElementById('md-preview');
  const wordCount = document.getElementById('md-word-count');
  const saveBtn = document.getElementById('md-save');
  const closeBtn = document.getElementById('md-close');
  const filenameInput = document.getElementById('md-filename');

  function updatePreview() {
    const md = sourceTextarea.value;
    preview.innerHTML = parseMarkdown(md);
    const words = md.trim().split(/\s+/).filter(w => w.length > 0).length;
    wordCount.textContent = `${words} word${words !== 1 ? 's' : ''}`;
  }

  function parseMarkdown(text) {
    // Simple markdown parser
    const lines = text.split('\n');

    // Helper function to apply inline formatting (bold, italic, code, links)
    function applyInlineFormatting(text) {
      return text
        // Bold and Italic
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Links
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    }

    // Process line by line to maintain line tracking for checkboxes
    let htmlLines = [];
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let processedLine = line;

      // Escape HTML first
      processedLine = processedLine
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Check for checkbox lines
      if (/^- \[x\] (.*)$/i.test(line)) {
        const content = applyInlineFormatting(processedLine.replace(/^- \[x\] /i, ''));
        htmlLines.push(`<li class="checkbox checked" data-line="${i}"><input type="checkbox" checked data-line="${i}"> ${content}</li>`);
      }
      else if (/^- \[ \] (.*)$/.test(line)) {
        const content = applyInlineFormatting(processedLine.replace(/^- \[ \] /, ''));
        htmlLines.push(`<li class="checkbox" data-line="${i}"><input type="checkbox" data-line="${i}"> ${content}</li>`);
      }
      // Check for plain list items
      else if (/^- (.*)$/.test(line)) {
        const content = applyInlineFormatting(processedLine.replace(/^- /, ''));
        htmlLines.push(`<li>${content}</li>`);
      }
      // Headers
      else if (/^### (.*)$/.test(line)) {
        const content = applyInlineFormatting(processedLine.replace(/^### /, ''));
        htmlLines.push(`<h3>${content}</h3>`);
      }
      else if (/^## (.*)$/.test(line)) {
        const content = applyInlineFormatting(processedLine.replace(/^## /, ''));
        htmlLines.push(`<h2>${content}</h2>`);
      }
      else if (/^# (.*)$/.test(line)) {
        const content = applyInlineFormatting(processedLine.replace(/^# /, ''));
        htmlLines.push(`<h1>${content}</h1>`);
      }
      // Blockquotes
      else if (/^> (.*)$/.test(line)) {
        const content = applyInlineFormatting(processedLine.replace(/^&gt; /, ''));
        htmlLines.push(`<blockquote>${content}</blockquote>`);
      }
      // Horizontal rule
      else if (/^---$/.test(line)) {
        htmlLines.push('<hr>');
      }
      // Code blocks (multiline handling)
      else if (/^```/.test(line)) {
        let codeBlock = [line];
        i++;
        while (i < lines.length && !/```$/.test(lines[i])) {
          codeBlock.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          codeBlock.push(lines[i]);
        }
        const codeContent = codeBlock.slice(1, -1).join('\n')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        htmlLines.push(`<pre><code>${codeContent}</code></pre>`);
      }
      // Regular paragraph
      else if (processedLine.trim() !== '') {
        htmlLines.push(applyInlineFormatting(processedLine));
      }
      // Empty line
      else {
        htmlLines.push('');
      }
    }

    let html = htmlLines.join('<br>');

    // Wrap consecutive li elements in ul
    html = html.replace(/(<li[^>]*>.*?<\/li>(<br>)?)+/g, (match) => {
      return '<ul>' + match.replace(/<br>/g, '') + '</ul>';
    });

    return html;
  }

  sourceTextarea.addEventListener('input', updatePreview);
  updatePreview();

  // Handle checkbox clicks in preview to toggle checkbox state
  preview.addEventListener('click', (e) => {
    if (e.target.type === 'checkbox' && e.target.hasAttribute('data-line')) {
      const lineIndex = parseInt(e.target.getAttribute('data-line'), 10);
      const lines = sourceTextarea.value.split('\n');

      if (lineIndex >= 0 && lineIndex < lines.length) {
        const line = lines[lineIndex];

        // Toggle checkbox state in source text
        if (/^- \[x\] /i.test(line)) {
          // Change checked to unchecked
          lines[lineIndex] = line.replace(/^- \[x\] /i, '- [ ] ');
        } else if (/^- \[ \] /.test(line)) {
          // Change unchecked to checked
          lines[lineIndex] = line.replace(/^- \[ \] /, '- [x] ');
        }

        // Update the source textarea
        sourceTextarea.value = lines.join('\n');

        // Update preview
        updatePreview();

        // Save the changes to userData
        laptop.userData.editorContent = sourceTextarea.value;
        saveState();
      }
    }
  });

  // Focus the textarea immediately so user can start typing
  setTimeout(() => {
    sourceTextarea.focus();
    // Move cursor to end of content
    sourceTextarea.setSelectionRange(sourceTextarea.value.length, sourceTextarea.value.length);
  }, 100);

  saveBtn.addEventListener('click', async () => {
    laptop.userData.editorContent = sourceTextarea.value;
    laptop.userData.editorFileName = filenameInput.value || 'notes.md';
    saveState();

    // Save to file if content is not empty
    if (sourceTextarea.value.trim().length > 0) {
      try {
        // Use configured folder or default app folder
        let folderPath = laptop.userData.notesFolderPath;
        if (!folderPath) {
          const defaultResult = await window.electronAPI.getDefaultNotesFolder();
          if (defaultResult.success) {
            folderPath = defaultResult.folderPath;
          }
        }

        if (folderPath) {
          // Add timestamp to filename when saving
          const timestampedFilename = getTimestampedFilename(laptop.userData.editorFileName);
          const result = await window.electronAPI.saveMarkdownFile(
            folderPath,
            timestampedFilename,
            sourceTextarea.value
          );
          if (result.success) {
            console.log('Note saved to:', result.filePath);
          } else {
            console.error('Failed to save note:', result.error);
          }
        }
      } catch (error) {
        console.error('Error saving note to file:', error);
      }
    }
  });

  // Function to save and close the editor (exitLaptopMode: also exit laptop zoom mode)
  async function saveAndClose(exitLaptopMode = false) {
    laptop.userData.editorContent = sourceTextarea.value;
    laptop.userData.editorFileName = filenameInput.value || 'notes.md';

    // If exiting laptop mode while editor is open, mark it as "was open" for:
    // 1. Showing editor screenshot on laptop screen when not in zoom mode
    // 2. Auto-reopening editor when re-entering laptop zoom mode
    // Only clear the flag when user explicitly closes the editor (X button or Escape)
    if (exitLaptopMode) {
      laptop.userData.editorWasOpen = true;
    } else {
      laptop.userData.editorWasOpen = false;
    }

    editorOverlay.remove();
    // Update laptop desktop to show note preview or editor window
    if (laptop.userData.screenState === 'desktop') {
      if (exitLaptopMode) {
        // Will be updated in exitLaptopZoomMode with persisted state
        // No need to call updateLaptopDesktop here
      } else {
        updateLaptopDesktop(laptop);
      }
    }
    saveState();
    document.removeEventListener('keydown', handleEditorKeys);
    document.removeEventListener('mousedown', handleEditorMiddleClick);

    // Save to file if content is not empty
    if (sourceTextarea.value.trim().length > 0) {
      try {
        // Use configured folder or default app folder
        let folderPath = laptop.userData.notesFolderPath;
        if (!folderPath) {
          const defaultResult = await window.electronAPI.getDefaultNotesFolder();
          if (defaultResult.success) {
            folderPath = defaultResult.folderPath;
          }
        }

        if (folderPath) {
          // Add timestamp to filename when saving
          const timestampedFilename = getTimestampedFilename(laptop.userData.editorFileName);
          const result = await window.electronAPI.saveMarkdownFile(
            folderPath,
            timestampedFilename,
            sourceTextarea.value
          );
          if (result.success) {
            console.log('Note saved to:', result.filePath);
          } else {
            console.error('Failed to save note:', result.error);
          }
        }
      } catch (error) {
        console.error('Error saving note to file:', error);
      }
    }

    // Exit laptop zoom mode if requested
    if (exitLaptopMode) {
      closeInteractionModal();
      exitLaptopZoomMode(laptop);
    }
  }

  closeBtn.addEventListener('click', () => saveAndClose(false));

  // Handle keyboard shortcuts
  const handleEditorKeys = (e) => {
    if (e.key === 'Escape') {
      saveAndClose(false);
    }
  };
  document.addEventListener('keydown', handleEditorKeys);

  // Handle middle-click to save and exit laptop mode entirely
  const handleEditorMiddleClick = (e) => {
    if (e.button === 1) { // Middle mouse button
      e.preventDefault();
      saveAndClose(true); // Exit laptop mode too
    }
  };
  document.addEventListener('mousedown', handleEditorMiddleClick);
}

function setupGlobeHandlers(object) {
  const toggleBtn = document.getElementById('globe-toggle');

  toggleBtn.addEventListener('click', () => {
    if (object.userData.rotationSpeed > 0) {
      object.userData.rotationSpeed = 0;
      toggleBtn.textContent = 'Start Rotation';
      toggleBtn.className = 'timer-btn start';
    } else {
      object.userData.rotationSpeed = 0.002;
      toggleBtn.textContent = 'Stop Rotation';
      toggleBtn.className = 'timer-btn pause';
    }
  });
}

function setupHourglassHandlers(object) {
  const flipBtn = document.getElementById('hourglass-flip');

  flipBtn.addEventListener('click', () => {
    // Animate flip around X axis (upside down flip)
    const startRotationX = object.rotation.x;
    const endRotationX = startRotationX + Math.PI;
    const startY = object.position.y;
    // The hourglass model is 0.25 units tall, centered at ~0.125
    // When flipped, we need to lift it to prevent clipping
    const liftHeight = 0.3; // Extra height during flip
    const duration = 600;
    const startTime = Date.now();

    function animateFlip() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease in-out
      const easeProgress = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      object.rotation.x = startRotationX + (endRotationX - startRotationX) * easeProgress;

      // Lift up during middle of animation, then settle back
      const liftProgress = Math.sin(progress * Math.PI); // Peaks at 0.5
      object.position.y = startY + liftProgress * liftHeight;

      if (progress < 1) {
        requestAnimationFrame(animateFlip);
      } else {
        // Ensure final position is correct
        object.position.y = startY;
      }
    }

    animateFlip();
  });
}

function setupMetronomeHandlers(object) {
  const toggleBtn = document.getElementById('metronome-toggle');
  const soundBtn = document.getElementById('metronome-sound');
  const bpmSlider = document.getElementById('metronome-bpm');
  const status = document.getElementById('metronome-status');

  toggleBtn.addEventListener('click', () => {
    object.userData.isRunning = !object.userData.isRunning;
    if (object.userData.isRunning) {
      // Reset pitch curve start time when starting
      object.userData.pitchCurveStartTime = Date.now();
      status.textContent = 'RUNNING';
      status.classList.add('running');
      toggleBtn.textContent = 'Stop';
      toggleBtn.className = 'timer-btn pause';
    } else {
      status.textContent = 'STOPPED';
      status.classList.remove('running');
      toggleBtn.textContent = 'Start';
      toggleBtn.className = 'timer-btn start';
      // Reset pendulum to center when stopped
      object.userData.pendulumAngle = 0;
      const pendulum = object.getObjectByName('pendulum');
      if (pendulum) pendulum.rotation.z = 0;
    }
  });

  soundBtn.addEventListener('click', () => {
    object.userData.tickSound = !object.userData.tickSound;
    soundBtn.textContent = `Sound: ${object.userData.tickSound ? 'ON' : 'OFF'}`;
    soundBtn.className = `timer-btn ${object.userData.tickSound ? 'pause' : 'reset'}`;
  });

  bpmSlider.addEventListener('input', (e) => {
    object.userData.bpm = parseInt(e.target.value);
    // Update the BPM display
    const bpmDisplay = bpmSlider.parentElement.previousElementSibling.querySelector('div:last-child');
    if (bpmDisplay) {
      bpmDisplay.textContent = `${object.userData.bpm} BPM`;
    }
  });

  // Add scroll-based adjustment for BPM slider
  addScrollToSlider(bpmSlider);
}

function setupPhotoFrameHandlers(object) {
  const uploadInput = document.getElementById('photo-upload');
  const clearBtn = document.getElementById('photo-clear');

  uploadInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const imageUrl = event.target.result;
        // Store data URL for persistence
        object.userData.photoDataUrl = imageUrl;

        // Create texture from uploaded image
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(imageUrl, (texture) => {
          // Find the photo surface mesh
          const photoSurface = object.getObjectByName('photoSurface');
          if (photoSurface) {
            // Update the material with the new texture
            photoSurface.material.map = texture;
            photoSurface.material.color.set(0xffffff); // White to show texture properly
            photoSurface.material.needsUpdate = true;

            // Store texture reference for cleanup
            object.userData.photoTexture = texture;
          }
          saveState(); // Save after photo is loaded
        });
      };
      reader.readAsDataURL(file);
    }
  });

  clearBtn.addEventListener('click', () => {
    const photoSurface = object.getObjectByName('photoSurface');
    if (photoSurface) {
      // Dispose of the old texture
      if (object.userData.photoTexture) {
        object.userData.photoTexture.dispose();
        object.userData.photoTexture = null;
      }
      // Clear the data URL for persistence
      object.userData.photoDataUrl = null;

      // Reset to default color
      photoSurface.material.map = null;
      photoSurface.material.color.set(new THREE.Color(object.userData.accentColor));
      photoSurface.material.needsUpdate = true;
      saveState();
    }
  });
}

function setupMugHandlers(object) {
  const drinkButtons = document.querySelectorAll('[data-drink]');
  const levelSlider = document.getElementById('mug-level');

  drinkButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const drinkType = btn.dataset.drink;
      object.userData.drinkType = drinkType;

      // Update liquid color
      const liquid = object.getObjectByName('liquid');
      const liquidBody = object.getObjectByName('liquidBody');
      if (DRINK_COLORS[drinkType]) {
        if (liquid) {
          liquid.material.color.set(DRINK_COLORS[drinkType].color);
          liquid.material.needsUpdate = true;
        }
        if (liquidBody) {
          liquidBody.material.color.set(DRINK_COLORS[drinkType].color);
          liquidBody.material.needsUpdate = true;
        }
      }

      // Update button styles
      drinkButtons.forEach(b => {
        b.className = `timer-btn ${b.dataset.drink === drinkType ? 'pause' : 'start'}`;
      });

      // Update title display
      const titleDisplay = document.querySelector('.timer-display .time');
      if (titleDisplay && DRINK_COLORS[drinkType]) {
        titleDisplay.textContent = DRINK_COLORS[drinkType].name;
      }
    });
  });

  if (levelSlider) {
    levelSlider.addEventListener('input', (e) => {
      const level = parseInt(e.target.value) / 100;
      object.userData.liquidLevel = level;

      // Update liquid height and position
      const liquid = object.getObjectByName('liquid');
      const liquidBody = object.getObjectByName('liquidBody');
      if (liquid) {
        liquid.visible = level > 0.05;
        liquid.position.y = 0.03 + level * 0.14;
      }
      if (liquidBody) {
        liquidBody.visible = level > 0.05;
        liquidBody.scale.y = Math.max(0.1, level);
        liquidBody.position.y = 0.015 + level * 0.07;
      }

      // Update label
      const label = levelSlider.previousElementSibling;
      if (label) {
        label.textContent = `Fill Level: ${Math.round(level * 100)}%`;
      }
    });
  }
}

// ============================================================================
// PEN HOLDER HANDLERS
// ============================================================================
function setupPenHolderHandlers(object) {
  const penButtons = ['red', 'blue', 'green', 'black'].map(color =>
    document.getElementById(`pen-${color}`)
  );
  const returnBtn = document.getElementById('pen-return');

  penButtons.forEach(btn => {
    if (btn && !btn.disabled) {
      btn.addEventListener('click', () => {
        const penColor = btn.id.replace('pen-', '');
        selectPen(object, penColor);

        // Refresh modal
        const content = document.getElementById('interaction-content');
        content.innerHTML = getInteractionContent(object);
        setupPenHolderHandlers(object);
      });
    }
  });

  if (returnBtn) {
    returnBtn.addEventListener('click', () => {
      returnPen(object);

      // Refresh modal
      const content = document.getElementById('interaction-content');
      content.innerHTML = getInteractionContent(object);
      setupPenHolderHandlers(object);
    });
  }
}

function selectPen(penHolder, penColor) {
  // If already holding a pen, return it first
  if (drawingState.selectedPen) {
    returnPen(penHolder);
  }

  // Select the new pen
  drawingState.selectedPen = penColor;
  const pensGroup = penHolder.getObjectByName('pens');
  if (pensGroup) {
    pensGroup.children.forEach(pen => {
      if (pen.userData.penColor === penColor) {
        pen.visible = false; // Hide pen from holder
        drawingState.selectedPenColor = pen.userData.colorHex;
      }
    });
  }
}

function returnPen(penHolder) {
  if (!drawingState.selectedPen) return;

  const pensGroup = penHolder.getObjectByName('pens');
  if (pensGroup) {
    pensGroup.children.forEach(pen => {
      if (pen.userData.penColor === drawingState.selectedPen) {
        pen.visible = true; // Show pen in holder again
      }
    });
  }

  drawingState.selectedPen = null;
  drawingState.selectedPenColor = null;
}

// ============================================================================
// BOOK HANDLERS
// ============================================================================
function setupBookHandlers(object) {
  const toggleBtn = document.getElementById('book-toggle');
  const titleInput = document.getElementById('book-title');
  const pdfInput = document.getElementById('book-pdf');
  const prevBtn = document.getElementById('book-prev');
  const nextBtn = document.getElementById('book-next');

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      toggleBookOpen(object);

      // Refresh modal
      const content = document.getElementById('interaction-content');
      content.innerHTML = getInteractionContent(object);
      setupBookHandlers(object);
    });
  }

  if (titleInput) {
    titleInput.addEventListener('change', (e) => {
      object.userData.bookTitle = e.target.value;
      // Update title texture on cover with dynamic resizing for multi-line
      if (object.userData.createTitleTexture) {
        const closedGroup = object.getObjectByName('closedBook');
        if (closedGroup) {
          const coverTitle = closedGroup.getObjectByName('coverTitle');
          if (coverTitle) {
            // Calculate number of lines needed for the title
            const title = e.target.value || '';

            // Hide title background if title is empty or whitespace only
            coverTitle.visible = title.trim().length > 0;

            // Only update texture if title is visible
            if (coverTitle.visible) {
              const lines = title.split('\n');

              // Calculate canvas and geometry height based on line count
              const baseHeight = 116;
              const lineAddition = 60;
              const lineCount = Math.max(1, lines.length);
              const canvasHeight = baseHeight + (lineCount - 1) * lineAddition;

              // Update geometry height proportionally (base is 0.08 for 116px)
              const baseGeoHeight = 0.08;
              const geoHeight = baseGeoHeight * (canvasHeight / baseHeight);

              // Create new geometry with updated height
              const newGeometry = new THREE.PlaneGeometry(0.22, geoHeight);
              coverTitle.geometry.dispose();
              coverTitle.geometry = newGeometry;

              // Adjust position for multi-line
              coverTitle.position.y = 0.041 + (lineCount - 1) * 0.01;

              // Create texture with dynamic height
              const newCoverTexture = object.userData.createTitleTexture(title, 320, canvasHeight, 64);
              coverTitle.material.map = newCoverTexture;
              coverTitle.material.needsUpdate = true;
            }
          }
        }
      }
      saveState();
    });
  }

  if (pdfInput) {
    pdfInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.type === 'application/pdf') {
        // Store the PDF file path
        object.userData.pdfPath = file.name;
        object.userData.pdfFile = file;

        // Load PDF (loadPDFToBook sets isLoadingPdf internally)
        loadPDFToBook(object, file);
      }
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (object.userData.currentPage > 0) {
        object.userData.currentPage--;
        updateBookPages(object);

        // Refresh modal
        const content = document.getElementById('interaction-content');
        content.innerHTML = getInteractionContent(object);
        setupBookHandlers(object);
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (object.userData.currentPage < object.userData.totalPages - 1) {
        object.userData.currentPage++;
        updateBookPages(object);

        // Refresh modal
        const content = document.getElementById('interaction-content');
        content.innerHTML = getInteractionContent(object);
        setupBookHandlers(object);
      }
    });
  }
}

async function loadPDFToBook(book, file) {
  // Prevent multiple simultaneous loads
  if (book.userData.isLoadingPdf) {
    console.log('PDF already loading, skipping duplicate load request');
    return;
  }

  // Set loading flag immediately
  book.userData.isLoadingPdf = true;

  // Use PDF.js to load and render the PDF
  const reader = new FileReader();

  reader.onload = async () => {
    try {
      // Check if PDF.js is available
      if (typeof pdfjsLib === 'undefined') {
        console.warn('PDF.js library not loaded. Using placeholder.');
        book.userData.totalPages = 10;
        book.userData.currentPage = 0;
        book.userData.isLoadingPdf = false;
        updateBookPages(book);
        return;
      }

      // Load PDF document using PDF.js
      const typedArray = new Uint8Array(reader.result);
      const loadingTask = pdfjsLib.getDocument({ data: typedArray });

      const pdfDoc = await loadingTask.promise;
      console.log(`PDF loaded: ${pdfDoc.numPages} pages`);

      // Store PDF document reference for later page rendering
      book.userData.pdfDocument = pdfDoc;
      book.userData.totalPages = pdfDoc.numPages;
      book.userData.currentPage = 0;
      book.userData.renderedPages = {}; // Cache for rendered page canvases
      book.userData.pageTextures = {}; // Cache for THREE.Texture objects
      book.userData.isLoadingPdf = false; // Clear loading flag

      // Update book thickness based on page count
      updateBookThickness(book);

      // Store PDF as base64 data URL for persistence after reload
      const base64Reader = new FileReader();
      base64Reader.onload = () => {
        book.userData.pdfDataUrl = base64Reader.result;
        book.userData.pdfDataDirty = true; // Mark as dirty so it gets saved
        saveState();
      };
      base64Reader.readAsDataURL(file);

      // Automatically open the book to show the PDF content
      if (!book.userData.isOpen) {
        toggleBookOpen(book);
      }

      // Update the page surfaces with actual PDF content
      await updateBookPagesWithPDF(book);

      // Refresh the modal to show the PDF content immediately
      const content = document.getElementById('interaction-content');
      if (content && interactionObject === book) {
        content.innerHTML = getInteractionContent(book);
        setupBookHandlers(book);
      }

      saveState();
    } catch (error) {
      console.error('Error loading PDF:', error);
      book.userData.totalPages = 1;
      book.userData.currentPage = 0;
      book.userData.isLoadingPdf = false;
      updateBookPages(book);
    }
  };

  reader.onerror = () => {
    console.error('Error reading PDF file');
    book.userData.isLoadingPdf = false;
    updateBookPages(book);
  };

  reader.readAsArrayBuffer(file);
}

// Load PDF from base64 data URL (for restoring from saved state)
async function loadPDFFromDataUrl(book, dataUrl) {
  if (!dataUrl || typeof pdfjsLib === 'undefined') {
    console.warn('Cannot load PDF: missing data URL or PDF.js library');
    return;
  }

  try {
    book.userData.isLoadingPdf = true;
    book.userData.loadingProgress = 0;

    // Convert base64 data URL to array buffer
    const base64 = dataUrl.split(',')[1];
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const loadingTask = pdfjsLib.getDocument({ data: bytes });

    // Track loading progress
    loadingTask.onProgress = (progressData) => {
      if (progressData.total > 0) {
        book.userData.loadingProgress = Math.round((progressData.loaded / progressData.total) * 100);
        // Update page display to show progress
        if (book.userData.isOpen) {
          updateBookPages(book);
        }
      }
    };

    const pdfDoc = await loadingTask.promise;
    console.log(`PDF restored from saved state: ${pdfDoc.numPages} pages`);

    // Store PDF document reference for later page rendering
    book.userData.pdfDocument = pdfDoc;
    book.userData.totalPages = pdfDoc.numPages;
    book.userData.currentPage = book.userData.currentPage || 0;
    book.userData.renderedPages = {}; // Cache for rendered page canvases
    book.userData.pageTextures = {}; // Cache for THREE.Texture objects
    book.userData.isLoadingPdf = false; // Clear loading flag
    book.userData.loadingProgress = 100; // Mark as complete
    book.userData.pdfDataUrl = dataUrl; // Keep the data URL

    // Update book thickness based on page count
    updateBookThickness(book);

    // Update pages if book is open
    if (book.userData.isOpen) {
      await updateBookPagesWithPDF(book);
    }
  } catch (error) {
    console.error('Error loading PDF from data URL:', error);
    book.userData.isLoadingPdf = false;
    book.userData.loadingProgress = 0;
  }
}

// Render a PDF page to a canvas
async function renderPDFPageToCanvas(pdfDoc, pageNum, canvasWidth, canvasHeight) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });

    // Calculate scale to fit the canvas while maintaining aspect ratio
    const scaleX = canvasWidth / viewport.width;
    const scaleY = canvasHeight / viewport.height;
    const scale = Math.min(scaleX, scaleY);

    const scaledViewport = page.getViewport({ scale });

    // Create canvas for rendering
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');

    // Fill with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Center the rendered PDF on the canvas
    const offsetX = (canvas.width - scaledViewport.width) / 2;
    const offsetY = (canvas.height - scaledViewport.height) / 2;

    ctx.translate(offsetX, offsetY);

    // Render PDF page to canvas
    const renderContext = {
      canvasContext: ctx,
      viewport: scaledViewport
    };

    await page.render(renderContext).promise;

    return canvas;
  } catch (error) {
    console.error(`Error rendering PDF page ${pageNum}:`, error);
    return null;
  }
}

// Update book pages with actual PDF content
async function updateBookPagesWithPDF(book) {
  const openGroup = book.getObjectByName('openBook');
  if (!openGroup) return;

  const leftPage = openGroup.getObjectByName('leftPageSurface');
  const rightPage = openGroup.getObjectByName('rightPageSurface');

  const pdfDoc = book.userData.pdfDocument;
  if (!pdfDoc) {
    // Fall back to placeholder if no PDF document
    updateBookPages(book);
    return;
  }

  // PDF rendering resolution (user-configurable via edit menu)
  // Default 768x1086, can be increased for better quality or decreased for performance
  const canvasWidth = book.userData.pdfResolution || 512;
  const canvasHeight = Math.round(canvasWidth * 1.414); // A4 aspect ratio

  // Page offset: if first page is used as cover, skip it in content
  const pageOffset = book.userData.firstPageAsCover ? 1 : 0;

  // Initialize texture cache if needed
  if (!book.userData.pageTextures) {
    book.userData.pageTextures = {};
  }

  // Render left page (current page)
  const leftPageNum = book.userData.currentPage * 2 + 1 + pageOffset; // 1-indexed with offset
  if (leftPage && leftPageNum <= pdfDoc.numPages) {
    // Check if we already have a cached texture for this page
    let texture = book.userData.pageTextures[leftPageNum];
    if (!texture) {
      let canvas = book.userData.renderedPages[leftPageNum];
      if (!canvas) {
        canvas = await renderPDFPageToCanvas(pdfDoc, leftPageNum, canvasWidth, canvasHeight);
        if (canvas) {
          book.userData.renderedPages[leftPageNum] = canvas;
        }
      }

      if (canvas) {
        texture = new THREE.CanvasTexture(canvas);
        texture.anisotropy = 16;
        // Use LinearFilter for crisp PDF rendering (no mipmap blur)
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        book.userData.pageTextures[leftPageNum] = texture;
      }
    }

    if (texture && leftPage.material.map !== texture) {
      leftPage.material.map = texture;
      leftPage.material.needsUpdate = true;
    }
  } else if (leftPage) {
    // Show blank page if beyond PDF pages
    createBlankPageTexture(leftPage, canvasWidth, canvasHeight, leftPageNum);
  }

  // Render right page (current page + 1)
  const rightPageNum = book.userData.currentPage * 2 + 2 + pageOffset; // 1-indexed with offset
  if (rightPage && rightPageNum <= pdfDoc.numPages) {
    // Check if we already have a cached texture for this page
    let texture = book.userData.pageTextures[rightPageNum];
    if (!texture) {
      let canvas = book.userData.renderedPages[rightPageNum];
      if (!canvas) {
        canvas = await renderPDFPageToCanvas(pdfDoc, rightPageNum, canvasWidth, canvasHeight);
        if (canvas) {
          book.userData.renderedPages[rightPageNum] = canvas;
        }
      }

      if (canvas) {
        texture = new THREE.CanvasTexture(canvas);
        texture.anisotropy = 16;
        // Use LinearFilter for crisp PDF rendering (no mipmap blur)
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        book.userData.pageTextures[rightPageNum] = texture;
      }
    }

    if (texture && rightPage.material.map !== texture) {
      rightPage.material.map = texture;
      rightPage.material.needsUpdate = true;
    }
  } else if (rightPage) {
    // Show blank page if beyond PDF pages
    createBlankPageTexture(rightPage, canvasWidth, canvasHeight, rightPageNum);
  }
}

// Create a blank page texture for pages beyond PDF content
function createBlankPageTexture(pageMesh, width, height, pageNum) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#fff8f0';
  ctx.fillRect(0, 0, width, height);

  // Page number at bottom
  ctx.fillStyle = '#999';
  ctx.font = '36px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Page ${pageNum}`, width / 2, height - 60);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 16;
  pageMesh.material.map = texture;
  pageMesh.material.needsUpdate = true;
}

// Update book thickness based on page count
function updateBookThickness(book) {
  const totalPages = book.userData.totalPages || 10;
  // Reduced thickness per page for thinner books
  // Paper sheet thickness in model units: ~0.0001 (0.1mm)
  // 5 sheets = 0.0005 minimum thickness for pages
  const paperSheetThickness = 0.0001;
  const minPagesThickness = paperSheetThickness * 5; // 5 paper sheets minimum
  const thicknessPerPage = 0.00008; // Reduced: each page adds 0.08mm (was 0.2mm)
  const baseThickness = 0.015; // Reduced base thickness (was 0.04)
  // Min thickness based on 5 paper sheets + cover, max 0.08 for very thick books
  const calculatedThickness = Math.max(minPagesThickness + 0.01, Math.min(0.08, baseThickness + (totalPages * thicknessPerPage)));

  const closedGroup = book.getObjectByName('closedBook');
  if (closedGroup) {
    const cover = closedGroup.getObjectByName('cover');
    const pages = closedGroup.children.find(c => c !== cover && c.name !== 'coverTitle' && c.geometry && c.geometry.type === 'BoxGeometry' && c.material && c.material.color && c.material.color.r > 0.9);
    const spine = closedGroup.children.find(c => c.name !== 'cover' && c.name !== 'coverTitle' && c.geometry && c.geometry.type === 'BoxGeometry' && c.position.x < -0.1);

    if (cover) {
      // Update cover geometry height
      const oldGeo = cover.geometry;
      cover.geometry = new THREE.BoxGeometry(0.28, calculatedThickness, 0.38);
      oldGeo.dispose();
      cover.position.y = calculatedThickness / 2;
    }

    if (pages) {
      // Update pages geometry height (slightly less than cover)
      const oldGeo = pages.geometry;
      const pagesThickness = calculatedThickness - 0.005;
      pages.geometry = new THREE.BoxGeometry(0.26, pagesThickness, 0.36);
      oldGeo.dispose();
      pages.position.y = calculatedThickness / 2;
    }

    if (spine) {
      // Update spine geometry height
      const oldGeo = spine.geometry;
      const spineThickness = calculatedThickness + 0.005;
      spine.geometry = new THREE.BoxGeometry(0.02, spineThickness, 0.38);
      oldGeo.dispose();
      spine.position.y = calculatedThickness / 2;
    }

    // Update cover title position
    const coverTitle = closedGroup.getObjectByName('coverTitle');
    if (coverTitle) {
      coverTitle.position.y = calculatedThickness + 0.001;
    }
  }

  // Store thickness for reference
  book.userData.bookThickness = calculatedThickness;
}

function updateBookPages(book) {
  // If PDF document is loaded, use PDF.js rendering instead of placeholder
  if (book.userData.pdfDocument) {
    updateBookPagesWithPDF(book);
    return;
  }

  const openGroup = book.getObjectByName('openBook');
  if (!openGroup) return;

  const leftPage = openGroup.getObjectByName('leftPageSurface');
  const rightPage = openGroup.getObjectByName('rightPageSurface');

  // PDF rendering resolution (user-configurable via edit menu)
  const canvasWidth = book.userData.pdfResolution || 512;
  const canvasHeight = Math.round(canvasWidth * 1.414); // A4 aspect ratio
  const margin = Math.round(60 * canvasWidth / 768);
  const lineHeight = Math.round(42 * canvasWidth / 768);

  // Check if PDF is loading - show animated ellipsis
  const isLoading = book.userData.isLoadingPdf;

  // Create page texture for left page
  if (leftPage && book.userData.totalPages > 0) {
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff8f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Page border
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 2;
    ctx.strokeRect(margin / 2, margin / 2, canvas.width - margin, canvas.height - margin);

    ctx.fillStyle = '#333';
    const pageNum = book.userData.currentPage * 2;

    // Page number header - scaled for optimized resolution
    ctx.font = 'bold 42px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Page ${pageNum + 1}`, canvas.width / 2, 90);

    // Divider line
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(margin, 120);
    ctx.lineTo(canvas.width - margin, 120);
    ctx.stroke();

    // Content area - clear font for optimized resolution
    ctx.font = '36px Georgia, serif';
    ctx.textAlign = 'left';

    const pdfFileName = book.userData.pdfPath
      ? book.userData.pdfPath.split('/').pop() || book.userData.pdfPath.split('\\').pop()
      : null;

    // Show loading animation if PDF is loading
    let contentLines;
    if (isLoading) {
      // Draw animated gradient loading indicator
      const time = Date.now() / 1000;
      const gradientWidth = canvasWidth - margin * 2;
      const gradientHeight = 60;
      const gradientY = 240;

      // Create animated gradient that sweeps left to right
      const offset = (Math.sin(time * 2) + 1) / 2; // 0 to 1 oscillation
      const shimmerPos = offset * gradientWidth;

      // Base loading bar background
      ctx.fillStyle = '#e0e0e0';
      ctx.fillRect(margin, gradientY, gradientWidth, gradientHeight);

      // Animated shimmer gradient
      const shimmerGradient = ctx.createLinearGradient(
        margin + shimmerPos - 100, gradientY,
        margin + shimmerPos + 100, gradientY
      );
      shimmerGradient.addColorStop(0, 'rgba(200, 200, 220, 0)');
      shimmerGradient.addColorStop(0.3, 'rgba(180, 180, 220, 0.6)');
      shimmerGradient.addColorStop(0.5, 'rgba(160, 160, 240, 0.9)');
      shimmerGradient.addColorStop(0.7, 'rgba(180, 180, 220, 0.6)');
      shimmerGradient.addColorStop(1, 'rgba(200, 200, 220, 0)');
      ctx.fillStyle = shimmerGradient;
      ctx.fillRect(margin, gradientY, gradientWidth, gradientHeight);

      // Border around loading bar
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 2;
      ctx.strokeRect(margin, gradientY, gradientWidth, gradientHeight);

      // Get animated ellipsis based on time
      const dots = '.'.repeat((Math.floor(Date.now() / 500) % 3) + 1);
      const progress = book.userData.loadingProgress || 0;
      contentLines = [
        'Loading PDF' + dots,
        progress > 0 ? `${progress}%` : '',
        pdfFileName ? `📄 ${pdfFileName}` : ''
      ].filter(line => line !== '');

      // Draw loading text above gradient
      ctx.font = '48px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#333';
      contentLines.forEach((line, i) => {
        ctx.fillText(line, canvasWidth / 2, 190 + i * lineHeight);
      });

      // Draw progress bar fill if progress is available
      if (progress > 0) {
        const progressWidth = (gradientWidth * progress) / 100;
        ctx.fillStyle = 'rgba(79, 70, 229, 0.6)'; // Purple progress fill
        ctx.fillRect(margin, gradientY, progressWidth, gradientHeight);
      }

      // Skip normal content drawing since we drew custom loading
      contentLines = [];
    } else if (pdfFileName) {
      contentLines = [
        `📄 ${pdfFileName}`,
        '',
        'PDF will be displayed',
        'once loaded.',
        '',
        'If content is not showing,',
        'right-click the book and',
        're-select the PDF file.',
        '',
        `Pages ${pageNum + 1}-${pageNum + 2}`,
        '← / → to turn pages'
      ];
    } else {
      contentLines = [
        'No PDF loaded',
        '',
        'Right-click to open',
        'customization panel,',
        'then select PDF file.',
        '',
        'Content will appear',
        'once a PDF is selected.'
      ];
    }

    contentLines.forEach((line, i) => {
      ctx.fillText(line, margin, 240 + i * lineHeight);
    });

    // Page footer
    ctx.font = '36px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#888';
    ctx.fillText(book.userData.bookTitle || 'Untitled', canvas.width / 2, canvas.height - 60);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 16; // Better quality at angles
    leftPage.material.map = texture;
    leftPage.material.needsUpdate = true;
  }

  // Create page texture for right page
  if (rightPage && book.userData.totalPages > 0) {
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff8f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Page border
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 2;
    ctx.strokeRect(margin / 2, margin / 2, canvas.width - margin, canvas.height - margin);

    ctx.fillStyle = '#333';
    const pageNum = book.userData.currentPage * 2 + 1;

    // Page number header - scaled for 2x resolution
    ctx.font = 'bold 56px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Page ${pageNum + 1}`, canvas.width / 2, 120);

    // Divider line
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(margin, 160);
    ctx.lineTo(canvas.width - margin, 160);
    ctx.stroke();

    // Content area - clear font for 2x resolution
    ctx.font = '48px Georgia, serif';
    ctx.textAlign = 'left';

    const totalPages = book.userData.totalPages || 10;
    const contentLines = [
      'Lorem ipsum dolor',
      'sit amet, consectetur',
      'adipiscing elit.',
      '',
      'Sed do eiusmod',
      'tempor incididunt ut',
      'labore et dolore.',
      '',
      'Ut enim ad minim,',
      'quis nostrud ullamco.',
      '',
      `Page ${pageNum + 1} of ${totalPages * 2}`
    ];

    contentLines.forEach((line, i) => {
      ctx.fillText(line, margin, 240 + i * lineHeight);
    });

    // Page footer
    ctx.font = '36px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#888';
    ctx.fillText(`${pageNum + 1} / ${totalPages * 2}`, canvas.width / 2, canvas.height - 60);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 16; // Better quality at angles
    rightPage.material.map = texture;
    rightPage.material.needsUpdate = true;
  }
}

// Helper function to update steam visibility
function updateSteamVisibility(object) {
  const steam = object.getObjectByName('steam');
  if (steam) {
    steam.visible = object.userData.isHot && object.userData.liquidLevel > 0.1;
  }
}

// Quick interaction function for middle-click toggle actions
// This allows simple interactions without picking up or opening modal
// clickedMesh is the actual mesh that was clicked (for detecting sub-component clicks)
function performQuickInteraction(object, clickedMesh = null) {
  const type = object.userData.type;

  switch (type) {
    case 'lamp':
      // Toggle lamp on/off
      object.userData.isOn = !object.userData.isOn;

      const bulb = object.getObjectByName('bulb');
      const light = object.getObjectByName('lampLight');
      const spotLight = object.getObjectByName('lampSpotLight');
      const ambientLight = object.getObjectByName('lampAmbient');

      if (object.userData.isOn) {
        if (bulb) bulb.material.emissiveIntensity = 1.5;
        if (light) light.intensity = 0.8;
        if (spotLight) spotLight.intensity = 3.0;
        if (ambientLight) ambientLight.intensity = 0.3;
      } else {
        if (bulb) bulb.material.emissiveIntensity = 0;
        if (light) light.intensity = 0;
        if (spotLight) spotLight.intensity = 0;
        if (ambientLight) ambientLight.intensity = 0;
      }
      break;

    case 'hourglass':
      // Flip hourglass animation around X axis (upside down flip)
      const startRotationX = object.rotation.x;
      const endRotationX = startRotationX + Math.PI;
      const startY = object.position.y;
      const liftHeight = 0.3; // Lift during flip to prevent table clipping
      const duration = 600;
      const startTime = Date.now();

      function animateFlip() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease in-out
        const easeProgress = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        object.rotation.x = startRotationX + (endRotationX - startRotationX) * easeProgress;

        // Lift during middle of animation
        const liftProgress = Math.sin(progress * Math.PI);
        object.position.y = startY + liftProgress * liftHeight;

        if (progress < 1) {
          requestAnimationFrame(animateFlip);
        } else {
          object.position.y = startY;
        }
      }

      animateFlip();
      break;

    case 'globe':
      // Toggle globe rotation
      if (object.userData.rotationSpeed > 0) {
        object.userData.rotationSpeed = 0;
      } else {
        object.userData.rotationSpeed = 0.01;
      }
      break;

    case 'clock':
      // Middle-click on clock stops the timer alert sound (without picking up)
      if (timerState.isAlerting) {
        stopTimerAlert();
      } else if (object.userData.interactive) {
        // If no alert, open the timer modal
        enterExamineMode(object);
        openInteractionModal(object);
      }
      break;

    case 'metronome':
      // Toggle metronome on/off with middle-click
      object.userData.isRunning = !object.userData.isRunning;
      if (object.userData.isRunning) {
        // Reset pitch and tempo curve start times when starting
        object.userData.pitchCurveStartTime = Date.now();
        object.userData.tempoCurveStartTime = Date.now();
      } else {
        // Reset pendulum when stopped
        object.userData.pendulumAngle = 0;
        const pendulum = object.getObjectByName('pendulum');
        if (pendulum) pendulum.rotation.z = 0;
      }
      break;

    case 'coffee':
      // In examine mode, sip the drink
      if (examineState.active && examineState.object === object) {
        performMugSip(object);
      } else {
        // Enter examine mode first
        enterExamineMode(object);
      }
      break;

    case 'books':
      // Toggle book open/closed
      toggleBookOpen(object);
      break;

    case 'magazine':
      // Toggle magazine open/closed
      toggleMagazineOpen(object);
      break;

    case 'laptop':
      // Check if the power button was clicked
      if (clickedMesh && clickedMesh.name === 'powerButton') {
        // Toggle power only when clicking on power button
        toggleLaptopPower(object);
      } else {
        // Enter laptop zoom mode for other areas
        enterLaptopZoomMode(object);
      }
      break;

    case 'cassette-player':
    case 'big-cassette-player':
      // Handle button clicks on the cassette player (mini or big)
      if (clickedMesh && clickedMesh.userData && clickedMesh.userData.buttonType) {
        handleCassetteButtonClick(object, clickedMesh.userData.buttonType);
      } else {
        // Check if clicking near the buttons group
        let buttonType = null;
        if (clickedMesh && clickedMesh.parent) {
          // Walk up to find if we're inside a button or buttons group
          let parent = clickedMesh;
          while (parent && parent !== object) {
            if (parent.userData && parent.userData.buttonType) {
              buttonType = parent.userData.buttonType;
              break;
            }
            if (parent.name === 'prevButton') buttonType = 'prev';
            else if (parent.name === 'playButton') buttonType = 'play';
            else if (parent.name === 'stopButton') buttonType = 'stop';
            else if (parent.name === 'nextButton') buttonType = 'next';
            if (buttonType) break;
            parent = parent.parent;
          }
        }
        if (buttonType) {
          handleCassetteButtonClick(object, buttonType);
        } else {
          // No button clicked - toggle play/pause as default action
          toggleCassettePlayback(object);
        }
      }
      break;

    case 'dictaphone':
      console.log('Dictaphone quick interaction, object.userData.isRecording:', object.userData.isRecording, 'id:', object.userData.id);
      // Handle button clicks on the dictaphone
      if (clickedMesh && clickedMesh.userData && clickedMesh.userData.buttonType) {
        handleDictaphoneButtonClick(object, clickedMesh.userData.buttonType);
      } else {
        // Check if clicking near the power button
        let buttonType = null;
        if (clickedMesh && clickedMesh.parent) {
          // Walk up to find if we're inside a button
          let parent = clickedMesh;
          while (parent && parent !== object) {
            if (parent.userData && parent.userData.buttonType) {
              buttonType = parent.userData.buttonType;
              break;
            }
            if (parent.name === 'powerButton') buttonType = 'power';
            if (buttonType) break;
            parent = parent.parent;
          }
        }
        if (buttonType) {
          handleDictaphoneButtonClick(object, buttonType);
        } else {
          // No button clicked - toggle recording as default action
          toggleDictaphoneRecording(object);
        }
      }
      break;

    case 'pen-holder':
      // Pen holder is now just a container, no interaction
      break;

    case 'notebook':
    case 'paper':
      // Drawing surfaces - open interaction modal to show instructions
      enterExamineMode(object);
      openInteractionModal(object);
      break;

    default:
      // For non-toggle objects, open the interaction modal instead
      if (object.userData.interactive) {
        enterExamineMode(object);
        openInteractionModal(object);
      }
      break;
  }
}

// ============================================================================
// MUG SIPPING ANIMATION
// ============================================================================
function performMugSip(object) {
  if (object.userData.isSipping || object.userData.isCheckingEmpty) return;

  if (object.userData.liquidLevel > 0.05) {
    // Sip animation - tilt mug toward camera
    object.userData.isSipping = true;
    const sipAmount = 0.15; // Each sip takes 15% of the drink

    // Calculate direction from mug to camera to determine tilt axis
    const mugWorldPos = new THREE.Vector3();
    object.getWorldPosition(mugWorldPos);
    const dirToCamera = new THREE.Vector3();
    dirToCamera.subVectors(camera.position, mugWorldPos).normalize();

    // Calculate the tilt angle based on camera direction
    // We need to tilt the mug towards the camera (as if drinking)
    const tiltAngle = 0.7; // More pronounced tilt for sipping

    // Store starting rotations
    const startRotationX = object.rotation.x;
    const startRotationZ = object.rotation.z;

    // Calculate target rotation to tilt toward camera
    // The mug should tilt on the axis perpendicular to the camera direction
    const tiltX = startRotationX + dirToCamera.z * tiltAngle;
    const tiltZ = startRotationZ - dirToCamera.x * tiltAngle;

    const duration = 800;
    const startTime = Date.now();

    function animateSip() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      if (progress < 0.3) {
        // Tilt up toward camera
        const tiltProgress = progress / 0.3;
        object.rotation.x = startRotationX + (tiltX - startRotationX) * tiltProgress;
        object.rotation.z = startRotationZ + (tiltZ - startRotationZ) * tiltProgress;
      } else if (progress < 0.7) {
        // Hold position (drinking)
        object.rotation.x = tiltX;
        object.rotation.z = tiltZ;
      } else {
        // Tilt back down
        const returnProgress = (progress - 0.7) / 0.3;
        object.rotation.x = tiltX + (startRotationX - tiltX) * returnProgress;
        object.rotation.z = tiltZ + (startRotationZ - tiltZ) * returnProgress;
      }

      if (progress < 1) {
        requestAnimationFrame(animateSip);
      } else {
        object.rotation.x = startRotationX;
        object.rotation.z = startRotationZ;
        object.userData.isSipping = false;

        // Reduce liquid level
        object.userData.liquidLevel = Math.max(0, object.userData.liquidLevel - sipAmount);

        // Update liquid visual
        const liquid = object.getObjectByName('liquid');
        const liquidBody = object.getObjectByName('liquidBody');
        const level = object.userData.liquidLevel;
        if (liquid) {
          if (level < 0.05) {
            liquid.visible = false;
          } else {
            liquid.visible = true;
            liquid.position.y = 0.03 + level * 0.14;
          }
        }
        if (liquidBody) {
          if (level < 0.05) {
            liquidBody.visible = false;
          } else {
            liquidBody.visible = true;
            liquidBody.scale.y = Math.max(0.1, level);
            liquidBody.position.y = 0.015 + level * 0.07;
          }
        }

        // Update steam visibility
        updateSteamVisibility(object);
        saveState();
      }
    }

    animateSip();
  } else {
    // Empty mug - check if there's anything left (tilt toward camera to look inside)
    object.userData.isCheckingEmpty = true;

    // Calculate direction from mug to camera
    const mugWorldPos = new THREE.Vector3();
    object.getWorldPosition(mugWorldPos);
    const dirToCamera = new THREE.Vector3();
    dirToCamera.subVectors(camera.position, mugWorldPos).normalize();

    const checkAngle = 1.4; // Almost upside down

    const startRotationX = object.rotation.x;
    const startRotationZ = object.rotation.z;

    // Tilt toward camera
    const checkRotationX = startRotationX + dirToCamera.z * checkAngle;
    const checkRotationZ = startRotationZ - dirToCamera.x * checkAngle;

    const duration = 1200;
    const startTime = Date.now();

    function animateCheck() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      if (progress < 0.4) {
        // Tilt up to look inside
        const tiltProgress = progress / 0.4;
        object.rotation.x = startRotationX + (checkRotationX - startRotationX) * tiltProgress;
        object.rotation.z = startRotationZ + (checkRotationZ - startRotationZ) * tiltProgress;
      } else if (progress < 0.6) {
        // Rotate slightly to look around
        const lookProgress = (progress - 0.4) / 0.2;
        object.rotation.x = checkRotationX + Math.sin(lookProgress * Math.PI * 2) * 0.1;
        object.rotation.z = checkRotationZ + Math.cos(lookProgress * Math.PI * 2) * 0.1;
      } else {
        // Return to original position
        const returnProgress = (progress - 0.6) / 0.4;
        object.rotation.x = checkRotationX + (startRotationX - checkRotationX) * returnProgress;
        object.rotation.z = checkRotationZ + (startRotationZ - checkRotationZ) * returnProgress;
      }

      if (progress < 1) {
        requestAnimationFrame(animateCheck);
      } else {
        object.rotation.x = startRotationX;
        object.rotation.z = startRotationZ;
        object.userData.isCheckingEmpty = false;
      }
    }

    animateCheck();
  }
}

// ============================================================================
// BOOK OPEN/CLOSE ANIMATION
// ============================================================================
function toggleBookOpen(object) {
  const closedGroup = object.getObjectByName('closedBook');
  const openGroup = object.getObjectByName('openBook');

  if (object.userData.isOpen) {
    // Close book animation
    object.userData.isOpen = false;
    if (openGroup) openGroup.visible = false;
    if (closedGroup) closedGroup.visible = true;
  } else {
    // Open book animation
    object.userData.isOpen = true;
    if (closedGroup) closedGroup.visible = false;
    if (openGroup) openGroup.visible = true;

    // Initialize currentPage to 0 if not set, and update the page content
    if (object.userData.currentPage === undefined) {
      object.userData.currentPage = 0;
    }

    // If book has a saved PDF data URL but PDF not loaded yet, start loading
    if (object.userData.pdfDataUrl && !object.userData.pdfDocument && !object.userData.isLoadingPdf) {
      // Set loading flag and show loading indicator
      object.userData.isLoadingPdf = true;
      updateBookPages(object); // This will show loading indicator
      // Start async PDF loading
      loadPDFFromDataUrl(object, object.userData.pdfDataUrl);
    } else {
      // Update pages to show content (this will render PDF if loaded or show placeholder)
      updateBookPages(object);
    }
  }
}

// Page turning animation for book
function animatePageTurn(book, direction) {
  if (book.userData.isTurningPage) return; // Don't interrupt ongoing animation

  // Prevent flipping beyond first or last page
  const currentPage = book.userData.currentPage || 0;
  const totalPages = book.userData.totalPages || 10;
  const maxPage = Math.ceil(totalPages / 2) - 1; // Max spread index (0-indexed)

  if (direction < 0 && currentPage <= 0) {
    return; // Can't flip before first page
  }
  if (direction > 0 && currentPage >= maxPage) {
    return; // Can't flip beyond last page
  }

  book.userData.isTurningPage = true;

  const openGroup = book.getObjectByName('openBook');
  if (!openGroup) {
    book.userData.isTurningPage = false;
    return;
  }

  // Create a temporary page for animation
  // The page should flip from one side to the other, rotating around the spine
  const pageGeometry = new THREE.PlaneGeometry(0.24, 0.34);
  const pageMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff8f0,
    side: THREE.DoubleSide,
    roughness: 0.9
  });
  const turningPage = new THREE.Mesh(pageGeometry, pageMaterial);

  // Create a pivot group positioned at the spine edge of the page
  // The pivot is at the spine (X=0), and the page extends outward
  const pivotGroup = new THREE.Group();
  pivotGroup.position.set(0, 0.028, 0); // At spine, at page surface height

  // Position page so its inner edge is at the pivot (spine)
  // The page center is offset by half the page width from the spine
  turningPage.position.set(direction > 0 ? 0.12 : -0.12, 0, 0);
  turningPage.rotation.x = -Math.PI / 2; // Lie flat, facing up
  pivotGroup.add(turningPage);
  openGroup.add(pivotGroup);

  const startAngle = 0;
  // Rotate around Z axis (spine direction) to flip the page from one side to the other
  // This is the correct axis for a flat book lying on a desk
  const endAngle = direction > 0 ? -Math.PI : Math.PI; // Flip 180° to opposite side
  const duration = 400;
  const startTime = Date.now();

  function animate() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Ease in-out curve for smooth animation
    const easeProgress = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    // Rotate the pivot group around Z axis (spine runs along Z)
    // This flips the page from right-to-left or left-to-right
    pivotGroup.rotation.z = startAngle + (endAngle - startAngle) * easeProgress;

    // Page arcs up slightly at midpoint of animation
    const liftFactor = Math.sin(progress * Math.PI) * 0.06;
    pivotGroup.position.y = 0.028 + liftFactor;

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // Animation complete - update page and cleanup immediately
      openGroup.remove(pivotGroup);
      book.userData.currentPage += direction;
      book.userData.isTurningPage = false;

      // Update pages synchronously
      updateBookPages(book);

      // Update modal if open
      if (interactionObject === book) {
        const content = document.getElementById('interaction-content');
        if (content) {
          content.innerHTML = getInteractionContent(book);
          setupBookHandlers(book);
        }
      }
    }
  }

  // Pre-render upcoming pages while animation plays
  if (book.userData.pdfDocument) {
    const nextPage1 = (book.userData.currentPage + direction) * 2 + 1;
    const nextPage2 = (book.userData.currentPage + direction) * 2 + 2;
    const pdfDoc = book.userData.pdfDocument;

    // Pre-render in background using book's configured resolution
    const resWidth = book.userData.pdfResolution || 512;
    const resHeight = Math.round(resWidth * 1.414);
    if (nextPage1 > 0 && nextPage1 <= pdfDoc.numPages && !book.userData.renderedPages[nextPage1]) {
      renderPDFPageToCanvas(pdfDoc, nextPage1, resWidth, resHeight).then(canvas => {
        if (canvas) book.userData.renderedPages[nextPage1] = canvas;
      });
    }
    if (nextPage2 > 0 && nextPage2 <= pdfDoc.numPages && !book.userData.renderedPages[nextPage2]) {
      renderPDFPageToCanvas(pdfDoc, nextPage2, resWidth, resHeight).then(canvas => {
        if (canvas) book.userData.renderedPages[nextPage2] = canvas;
      });
    }
  }

  animate();
}

// ============================================================================
// MAGAZINE HANDLERS AND FUNCTIONS
// ============================================================================
function setupMagazineHandlers(object) {
  const toggleBtn = document.getElementById('magazine-toggle');
  const titleInput = document.getElementById('magazine-title');
  const pdfInput = document.getElementById('magazine-pdf');
  const prevBtn = document.getElementById('magazine-prev');
  const nextBtn = document.getElementById('magazine-next');

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      toggleMagazineOpen(object);

      // Refresh modal
      const content = document.getElementById('interaction-content');
      content.innerHTML = getInteractionContent(object);
      setupMagazineHandlers(object);
    });
  }

  if (titleInput) {
    titleInput.addEventListener('change', (e) => {
      object.userData.magazineTitle = e.target.value;
      // Update title texture on cover with dynamic resizing for multi-line
      if (object.userData.createTitleTexture) {
        const closedGroup = object.getObjectByName('closedMagazine');
        if (closedGroup) {
          const coverTitle = closedGroup.getObjectByName('coverTitle');
          if (coverTitle) {
            const title = e.target.value || '';

            // Hide title background if title is empty or whitespace only
            coverTitle.visible = title.trim().length > 0;

            // Only update texture if title is visible
            if (coverTitle.visible) {
              const lines = title.split('\n');

              // Calculate canvas and geometry height based on line count
              const baseHeight = 124;
              const lineAddition = 50;
              const lineCount = Math.max(1, lines.length);
              const canvasHeight = baseHeight + (lineCount - 1) * lineAddition;

              // Update geometry height proportionally
              const baseGeoHeight = 0.08;
              const geoHeight = baseGeoHeight * (canvasHeight / baseHeight);

              // Create new geometry with updated height
              const newGeometry = new THREE.PlaneGeometry(0.18, geoHeight);
              coverTitle.geometry.dispose();
              coverTitle.geometry = newGeometry;

              // Adjust position for multi-line
              coverTitle.position.y = 0.016 + (lineCount - 1) * 0.008;

              // Create texture with dynamic height
              const newCoverTexture = object.userData.createTitleTexture(title, 280, canvasHeight, 48);
              coverTitle.material.map = newCoverTexture;
              coverTitle.material.needsUpdate = true;
            }
          }
        }
      }
      saveState();
    });
  }

  if (pdfInput) {
    pdfInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.type === 'application/pdf') {
        object.userData.pdfPath = file.name;
        object.userData.pdfFile = file;
        loadPDFToMagazine(object, file);
      }
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (object.userData.currentPage > 0) {
        object.userData.currentPage--;
        updateMagazinePages(object);

        // Refresh modal
        const content = document.getElementById('interaction-content');
        content.innerHTML = getInteractionContent(object);
        setupMagazineHandlers(object);
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (object.userData.currentPage < object.userData.totalPages - 1) {
        object.userData.currentPage++;
        updateMagazinePages(object);

        // Refresh modal
        const content = document.getElementById('interaction-content');
        content.innerHTML = getInteractionContent(object);
        setupMagazineHandlers(object);
      }
    });
  }
}

// Helper function to set the first page of PDF as the magazine cover
async function setFirstPageAsCoverForMagazine(magazine) {
  const pdfDoc = magazine.userData.pdfDocument;
  if (!pdfDoc) return;

  try {
    const canvas = await renderPDFPageToCanvas(pdfDoc, 1, 512, 700);
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png');
      magazine.userData.coverImageDataUrl = dataUrl;
      magazine.userData.coverImageDirty = true;
      magazine.userData.firstPageAsCover = true;
      const fitMode = magazine.userData.coverFitMode || 'cover';
      applyMagazineCoverImageWithFit(magazine, dataUrl, fitMode);
    }
  } catch (error) {
    console.error('Error setting first page as cover:', error);
  }
}

async function loadPDFToMagazine(magazine, file) {
  if (magazine.userData.isLoadingPdf) {
    console.log('PDF already loading, skipping duplicate load request');
    return;
  }

  magazine.userData.isLoadingPdf = true;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const typedArray = new Uint8Array(arrayBuffer);

    if (typeof pdfjsLib === 'undefined') {
      console.error('PDF.js library not loaded');
      magazine.userData.totalPages = 10;
      magazine.userData.currentPage = 0;
      magazine.userData.isLoadingPdf = false;
      updateMagazinePages(magazine);
      return;
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
    const pdfDoc = await pdfjsLib.getDocument(typedArray).promise;

    magazine.userData.pdfDocument = pdfDoc;
    magazine.userData.totalPages = pdfDoc.numPages;
    magazine.userData.currentPage = 0;
    magazine.userData.renderedPages = {};
    magazine.userData.pageTextures = {};
    magazine.userData.isLoadingPdf = false;

    updateMagazineThickness(magazine);

    // Store PDF as data URL for saving
    const base64Reader = new FileReader();
    base64Reader.onload = () => {
      magazine.userData.pdfDataUrl = base64Reader.result;
      magazine.userData.pdfDataDirty = true;
    };
    base64Reader.readAsDataURL(file);

    // Automatically set first page as cover (default behavior after PDF upload)
    await setFirstPageAsCoverForMagazine(magazine);

    // Automatically open the magazine to show the PDF content
    if (!magazine.userData.isOpen) {
      toggleMagazineOpen(magazine);
    }

    await updateMagazinePagesWithPDF(magazine);

    // Update UI if modal is open
    const content = document.getElementById('interaction-content');
    if (content && interactionObject === magazine) {
      content.innerHTML = getInteractionContent(magazine);
      setupMagazineHandlers(magazine);
    }
    saveState();
  } catch (error) {
    console.error('Error loading PDF:', error);
    magazine.userData.totalPages = 1;
    magazine.userData.currentPage = 0;
    magazine.userData.isLoadingPdf = false;
    updateMagazinePages(magazine);
  }
}

async function loadPDFFromDataUrlToMagazine(magazine, dataUrl) {
  try {
    magazine.userData.isLoadingPdf = true;
    magazine.userData.loadingProgress = 0;

    const base64 = dataUrl.split(',')[1];
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
    const loadingTask = pdfjsLib.getDocument({
      data: bytes,
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
      cMapPacked: true
    });

    loadingTask.onProgress = (progressData) => {
      if (progressData.total > 0) {
        magazine.userData.loadingProgress = Math.round((progressData.loaded / progressData.total) * 100);
      }
      if (magazine.userData.isOpen) {
        updateMagazinePages(magazine);
      }
    };

    const pdfDoc = await loadingTask.promise;

    magazine.userData.pdfDocument = pdfDoc;
    magazine.userData.totalPages = pdfDoc.numPages;
    magazine.userData.currentPage = magazine.userData.currentPage || 0;
    magazine.userData.renderedPages = {};
    magazine.userData.pageTextures = {};
    magazine.userData.isLoadingPdf = false;
    magazine.userData.loadingProgress = 100;
    magazine.userData.pdfDataUrl = dataUrl;

    updateMagazineThickness(magazine);

    if (magazine.userData.isOpen) {
      await updateMagazinePagesWithPDF(magazine);
    }
  } catch (error) {
    console.error('Error loading PDF from data URL:', error);
    magazine.userData.isLoadingPdf = false;
    magazine.userData.loadingProgress = 0;
  }
}

async function updateMagazinePagesWithPDF(magazine) {
  const openGroup = magazine.getObjectByName('openMagazine');
  if (!openGroup) return;

  const leftPage = openGroup.getObjectByName('leftPageSurface');
  const rightPage = openGroup.getObjectByName('rightPageSurface');

  const pdfDoc = magazine.userData.pdfDocument;

  if (!pdfDoc) {
    updateMagazinePages(magazine);
    return;
  }

  // Use magazine's configured resolution
  const canvasWidth = magazine.userData.pdfResolution || 512;
  const canvasHeight = Math.round(canvasWidth * 1.4); // A4 aspect ratio

  const pageOffset = magazine.userData.firstPageAsCover ? 1 : 0;

  if (!magazine.userData.pageTextures) {
    magazine.userData.pageTextures = {};
  }

  // Left page
  const leftPageNum = magazine.userData.currentPage * 2 + 1 + pageOffset;
  if (leftPage && leftPageNum <= pdfDoc.numPages) {
    let texture = magazine.userData.pageTextures[leftPageNum];
    if (!texture) {
      let canvas = magazine.userData.renderedPages[leftPageNum];
      if (!canvas) {
        canvas = await renderPDFPageToCanvas(pdfDoc, leftPageNum, canvasWidth, canvasHeight);
        if (canvas) {
          magazine.userData.renderedPages[leftPageNum] = canvas;
        }
      }
      if (canvas) {
        texture = new THREE.CanvasTexture(canvas);
        texture.anisotropy = 16;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        magazine.userData.pageTextures[leftPageNum] = texture;
      }
    }
    if (texture) {
      leftPage.material.map = texture;
      leftPage.material.color.set(0xffffff);
      leftPage.material.needsUpdate = true;
    }
  }

  // Right page
  const rightPageNum = magazine.userData.currentPage * 2 + 2 + pageOffset;
  if (rightPage && rightPageNum <= pdfDoc.numPages) {
    let texture = magazine.userData.pageTextures[rightPageNum];
    if (!texture) {
      let canvas = magazine.userData.renderedPages[rightPageNum];
      if (!canvas) {
        canvas = await renderPDFPageToCanvas(pdfDoc, rightPageNum, canvasWidth, canvasHeight);
        if (canvas) {
          magazine.userData.renderedPages[rightPageNum] = canvas;
        }
      }
      if (canvas) {
        texture = new THREE.CanvasTexture(canvas);
        texture.anisotropy = 16;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        magazine.userData.pageTextures[rightPageNum] = texture;
      }
    }
    if (texture) {
      rightPage.material.map = texture;
      rightPage.material.color.set(0xffffff);
      rightPage.material.needsUpdate = true;
    }
  }
}

function updateMagazineThickness(magazine) {
  const totalPages = magazine.userData.totalPages || 10;
  // Magazines should be slightly thinner than books
  // Magazine paper is typically thinner (0.07mm vs 0.08mm for books)
  const thicknessPerPage = 0.00007; // Each page adds 0.07mm (thinner than book's 0.08mm)
  const baseThickness = 0.012; // Thinner base than book's 0.015
  const minThickness = 0.006; // Minimum thickness for very thin magazines
  const maxThickness = 0.06; // Max thickness (thinner than book's 0.08)
  const calculatedThickness = Math.max(minThickness, Math.min(maxThickness, baseThickness + (totalPages * thicknessPerPage)));

  const closedGroup = magazine.getObjectByName('closedMagazine');
  if (!closedGroup) return;

  // Find cover and update its height
  const cover = closedGroup.children.find(c => c.name === 'cover');
  if (cover) {
    const oldGeo = cover.geometry;
    cover.geometry = new THREE.BoxGeometry(0.22, calculatedThickness + 0.003, 0.30);
    oldGeo.dispose();
    cover.position.y = (calculatedThickness + 0.003) / 2;
  }

  // Find pages block and update
  const pages = closedGroup.children.find(c => c !== cover && c.name !== 'coverTitle' && c.geometry && c.geometry.type === 'BoxGeometry' && c.position.x > -0.1 && c.position.x < 0.1);
  if (pages) {
    const oldGeo = pages.geometry;
    pages.geometry = new THREE.BoxGeometry(0.20, calculatedThickness, 0.28);
    oldGeo.dispose();
    pages.position.y = calculatedThickness / 2;
  }

  // Find spine and update
  const spine = closedGroup.children.find(c => c.name !== 'cover' && c.name !== 'coverTitle' && c.geometry && c.geometry.type === 'BoxGeometry' && c.position.x < -0.1);
  if (spine) {
    const oldGeo = spine.geometry;
    const spineThickness = calculatedThickness + 0.002;
    spine.geometry = new THREE.BoxGeometry(0.008, spineThickness, 0.30);
    oldGeo.dispose();
    spine.position.y = calculatedThickness / 2;
  }

  magazine.userData.magazineThickness = calculatedThickness;
}

function updateMagazinePages(magazine) {
  if (magazine.userData.pdfDocument) {
    updateMagazinePagesWithPDF(magazine);
    return;
  }

  const openGroup = magazine.getObjectByName('openMagazine');
  if (!openGroup) return;

  const leftPage = openGroup.getObjectByName('leftPageSurface');
  const rightPage = openGroup.getObjectByName('rightPageSurface');

  const canvasWidth = magazine.userData.pdfResolution || 512;
  const canvasHeight = Math.round(canvasWidth * 1.4);

  const isLoading = magazine.userData.isLoadingPdf;

  // Placeholder for left page
  if (leftPage && magazine.userData.totalPages > 0) {
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#fff8f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#333';
    ctx.font = `${Math.floor(canvasWidth / 18)}px Arial`;
    ctx.textAlign = 'center';

    if (isLoading) {
      const progress = magazine.userData.loadingProgress || 0;
      ctx.fillText('Loading PDF...', canvas.width / 2, canvas.height / 2 - 30);
      ctx.fillText(`${progress}%`, canvas.width / 2, canvas.height / 2 + 30);
    } else {
      ctx.fillText('No PDF loaded', canvas.width / 2, canvas.height / 2 - 30);
      ctx.fillText('Right-click to add PDF', canvas.width / 2, canvas.height / 2 + 30);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 16;
    leftPage.material.map = texture;
    leftPage.material.color.set(0xffffff);
    leftPage.material.needsUpdate = true;
  }

  // Placeholder for right page
  if (rightPage && magazine.userData.totalPages > 0) {
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#fff8f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!isLoading) {
      ctx.fillStyle = '#333';
      ctx.font = `${Math.floor(canvasWidth / 18)}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText(magazine.userData.magazineTitle || 'Untitled', canvas.width / 2, canvas.height - 60);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 16;
    rightPage.material.map = texture;
    rightPage.material.color.set(0xffffff);
    rightPage.material.needsUpdate = true;
  }
}

function toggleMagazineOpen(object) {
  const closedGroup = object.getObjectByName('closedMagazine');
  const openGroup = object.getObjectByName('openMagazine');

  if (object.userData.isOpen) {
    // Close magazine
    object.userData.isOpen = false;
    if (openGroup) openGroup.visible = false;
    if (closedGroup) closedGroup.visible = true;
  } else {
    // Open magazine
    object.userData.isOpen = true;
    if (closedGroup) closedGroup.visible = false;
    if (openGroup) openGroup.visible = true;

    if (object.userData.currentPage === undefined) {
      object.userData.currentPage = 0;
    }

    // If magazine has a saved PDF data URL but PDF not loaded yet, start loading
    if (object.userData.pdfDataUrl && !object.userData.pdfDocument && !object.userData.isLoadingPdf) {
      object.userData.isLoadingPdf = true;
      updateMagazinePages(object);
      loadPDFFromDataUrlToMagazine(object, object.userData.pdfDataUrl);
    } else {
      updateMagazinePages(object);
    }
  }
}

// Page turning animation for magazine
function animateMagazinePageTurn(magazine, direction) {
  if (magazine.userData.isTurningPage) return;

  const currentPage = magazine.userData.currentPage || 0;
  const totalPages = magazine.userData.totalPages || 10;
  const maxPage = Math.ceil(totalPages / 2) - 1;

  if (direction < 0 && currentPage <= 0) return;
  if (direction > 0 && currentPage >= maxPage) return;

  magazine.userData.isTurningPage = true;

  const openGroup = magazine.getObjectByName('openMagazine');
  if (!openGroup) {
    magazine.userData.isTurningPage = false;
    return;
  }

  // Create a temporary page for animation
  const pageGeometry = new THREE.PlaneGeometry(0.20, 0.28);
  const pageMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff8f0,
    side: THREE.DoubleSide,
    roughness: 0.9
  });
  const turningPage = new THREE.Mesh(pageGeometry, pageMaterial);

  const pivotGroup = new THREE.Group();
  pivotGroup.position.set(0, 0.013, 0); // At spine, at page surface height

  // Position page so its inner edge is at the pivot
  turningPage.position.set(direction > 0 ? 0.10 : -0.10, 0, 0);
  turningPage.rotation.x = -Math.PI / 2;
  pivotGroup.add(turningPage);
  openGroup.add(pivotGroup);

  const startAngle = 0;
  const endAngle = direction > 0 ? -Math.PI : Math.PI;
  const duration = 400;
  const startTime = Date.now();

  function animate() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);

    const easeProgress = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    pivotGroup.rotation.z = startAngle + (endAngle - startAngle) * easeProgress;

    const liftFactor = Math.sin(progress * Math.PI) * 0.04;
    pivotGroup.position.y = 0.013 + liftFactor;

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      openGroup.remove(pivotGroup);
      magazine.userData.currentPage += direction;
      magazine.userData.isTurningPage = false;

      updateMagazinePages(magazine);

      if (interactionObject === magazine) {
        const content = document.getElementById('interaction-content');
        if (content) {
          content.innerHTML = getInteractionContent(magazine);
          setupMagazineHandlers(magazine);
        }
      }
    }
  }

  // Pre-render upcoming pages
  if (magazine.userData.pdfDocument) {
    const nextPage1 = (magazine.userData.currentPage + direction) * 2 + 1;
    const nextPage2 = (magazine.userData.currentPage + direction) * 2 + 2;
    const pdfDoc = magazine.userData.pdfDocument;

    const resWidth = magazine.userData.pdfResolution || 512;
    const resHeight = Math.round(resWidth * 1.4);
    if (nextPage1 > 0 && nextPage1 <= pdfDoc.numPages && !magazine.userData.renderedPages[nextPage1]) {
      renderPDFPageToCanvas(pdfDoc, nextPage1, resWidth, resHeight).then(canvas => {
        if (canvas) magazine.userData.renderedPages[nextPage1] = canvas;
      });
    }
    if (nextPage2 > 0 && nextPage2 <= pdfDoc.numPages && !magazine.userData.renderedPages[nextPage2]) {
      renderPDFPageToCanvas(pdfDoc, nextPage2, resWidth, resHeight).then(canvas => {
        if (canvas) magazine.userData.renderedPages[nextPage2] = canvas;
      });
    }
  }

  animate();
}

// Apply cover image with fit mode for magazine
function applyMagazineCoverImageWithFit(object, imageDataUrl, fitMode) {
  const closedGroup = object.getObjectByName('closedMagazine');
  if (!closedGroup) return;

  const cover = closedGroup.getObjectByName('cover');
  if (!cover) return;

  const img = new Image();
  img.onload = () => {
    // Magazine cover dimensions (0.22 x 0.30)
    const coverWidth = 512;
    const coverHeight = Math.round(512 * (0.30 / 0.22));

    const canvas = document.createElement('canvas');
    canvas.width = coverWidth;
    canvas.height = coverHeight;
    const ctx = canvas.getContext('2d');

    // Fill with main color as background
    ctx.fillStyle = object.userData.mainColor || '#dc2626';
    ctx.fillRect(0, 0, coverWidth, coverHeight);

    const imgAspect = img.width / img.height;
    const coverAspect = coverWidth / coverHeight;

    let sx, sy, sw, sh, dx, dy, dw, dh;

    if (fitMode === 'stretch') {
      ctx.drawImage(img, 0, 0, coverWidth, coverHeight);
    } else if (fitMode === 'cover') {
      if (imgAspect > coverAspect) {
        sh = img.height;
        sw = sh * coverAspect;
        sx = (img.width - sw) / 2;
        sy = 0;
      } else {
        sw = img.width;
        sh = sw / coverAspect;
        sx = 0;
        sy = (img.height - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, coverWidth, coverHeight);
    } else {
      if (imgAspect > coverAspect) {
        dw = coverWidth;
        dh = coverWidth / imgAspect;
        dx = 0;
        dy = (coverHeight - dh) / 2;
      } else {
        dh = coverHeight;
        dw = coverHeight * imgAspect;
        dx = (coverWidth - dw) / 2;
        dy = 0;
      }
      ctx.drawImage(img, dx, dy, dw, dh);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    // Apply to top face of cover
    const materials = [
      cover.material, // right
      cover.material, // left
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5 }), // top
      cover.material, // bottom
      cover.material, // front
      cover.material  // back
    ];
    cover.material = materials;

    saveState();
  };
  img.src = imageDataUrl;
}

function setupMagazineCustomizationHandlers(object) {
  const titleInput = document.getElementById('magazine-title-edit');
  const titleColorsContainer = document.getElementById('magazine-title-colors');
  const pdfInput = document.getElementById('magazine-pdf-edit');
  const clearBtn = document.getElementById('magazine-pdf-clear-edit');

  const updateMagazineTitleTextures = () => {
    if (object.userData.createTitleTexture) {
      const closedGroup = object.getObjectByName('closedMagazine');
      if (closedGroup) {
        const coverTitle = closedGroup.getObjectByName('coverTitle');
        if (coverTitle) {
          const title = object.userData.magazineTitle || '';
          coverTitle.visible = title.trim().length > 0;

          if (coverTitle.visible) {
            const lines = title.split('\n');
            const baseHeight = 124;
            const lineAddition = 50;
            const lineCount = Math.max(1, lines.length);
            const canvasHeight = baseHeight + (lineCount - 1) * lineAddition;
            const baseGeoHeight = 0.08;
            const geoHeight = baseGeoHeight * (canvasHeight / baseHeight);

            const newGeometry = new THREE.PlaneGeometry(0.18, geoHeight);
            coverTitle.geometry.dispose();
            coverTitle.geometry = newGeometry;
            coverTitle.position.y = 0.016 + (lineCount - 1) * 0.008;

            const newCoverTexture = object.userData.createTitleTexture(title, 280, canvasHeight, 48);
            coverTitle.material.map = newCoverTexture;
            coverTitle.material.needsUpdate = true;
          }
        }
      }
    }
    saveState();
  };

  if (titleInput) {
    titleInput.addEventListener('input', (e) => {
      object.userData.magazineTitle = e.target.value;
      updateMagazineTitleTextures();
    });
    titleInput.addEventListener('change', (e) => {
      object.userData.magazineTitle = e.target.value;
      updateMagazineTitleTextures();
    });
  }

  if (titleColorsContainer) {
    titleColorsContainer.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        object.userData.titleColor = swatch.dataset.color;
        titleColorsContainer.querySelectorAll('.color-swatch').forEach(s => {
          s.style.border = '2px solid transparent';
        });
        swatch.style.border = '2px solid #fff';
        updateMagazineTitleTextures();
      });
    });
  }

  if (pdfInput) {
    pdfInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.type === 'application/pdf') {
        object.userData.pdfPath = file.name;
        loadPDFToMagazine(object, file);
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      object.userData.pdfDocument = null;
      object.userData.pdfPath = null;
      object.userData.pdfDataUrl = null;
      object.userData.pdfDataDirty = false;
      object.userData.renderedPages = {};
      object.userData.pageTextures = {};
      object.userData.totalPages = 0;
      object.userData.currentPage = 0;

      updateMagazineThickness(object);

      if (object.userData.isOpen) {
        updateMagazinePages(object);
      }
      saveState();
    });
  }

  // Resolution slider
  const resolutionSlider = document.getElementById('magazine-pdf-resolution');
  const resolutionDisplay = document.getElementById('magazine-pdf-resolution-display');
  if (resolutionSlider) {
    resolutionSlider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      if (resolutionDisplay) {
        resolutionDisplay.textContent = `${value}px`;
      }
      object.userData.pdfResolution = value;
    });
    resolutionSlider.addEventListener('change', () => {
      object.userData.renderedPages = {};
      object.userData.pageTextures = {};
      if (object.userData.isOpen && object.userData.pdfDocument) {
        updateMagazinePagesWithPDF(object);
      }
      saveState();
    });
  }

  // Cover image handlers
  const coverImageInput = document.getElementById('magazine-cover-image');
  const coverUsePdfBtn = document.getElementById('magazine-cover-use-pdf');
  const coverClearBtn = document.getElementById('magazine-cover-clear');

  if (coverImageInput) {
    coverImageInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          object.userData.coverImageDataUrl = reader.result;
          object.userData.coverImageDirty = true;
          const fitMode = object.userData.coverFitMode || 'cover';
          applyMagazineCoverImageWithFit(object, reader.result, fitMode);

          if (object.userData.isOpen) {
            updateMagazinePagesWithPDF(object);
          }

          showEditModal(object);
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (coverUsePdfBtn && object.userData.pdfDocument) {
    coverUsePdfBtn.addEventListener('click', async () => {
      const canvas = await renderPDFPageToCanvas(object.userData.pdfDocument, 1, 512, 700);
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        object.userData.coverImageDataUrl = dataUrl;
        object.userData.coverImageDirty = true;
        object.userData.firstPageAsCover = true;
        const fitMode = object.userData.coverFitMode || 'cover';
        applyMagazineCoverImageWithFit(object, dataUrl, fitMode);

        if (object.userData.isOpen) {
          updateMagazinePagesWithPDF(object);
        }

        showEditModal(object);
      }
    });
  }

  if (coverClearBtn) {
    coverClearBtn.addEventListener('click', () => {
      object.userData.coverImageDataUrl = null;
      object.userData.coverImageDirty = false;
      object.userData.firstPageAsCover = false;

      const closedGroup = object.getObjectByName('closedMagazine');
      if (closedGroup) {
        const cover = closedGroup.getObjectByName('cover');
        if (cover) {
          cover.material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(object.userData.mainColor || '#dc2626'),
            roughness: 0.5
          });
        }
      }

      if (object.userData.isOpen) {
        updateMagazinePagesWithPDF(object);
      }

      showEditModal(object);
      saveState();
    });
  }

  // Cover fit mode
  const fitModeContainer = document.getElementById('magazine-cover-fit-mode');
  if (fitModeContainer) {
    fitModeContainer.querySelectorAll('.fit-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        object.userData.coverFitMode = mode;

        if (object.userData.coverImageDataUrl) {
          applyMagazineCoverImageWithFit(object, object.userData.coverImageDataUrl, mode);
        }

        showEditModal(object);
      });
    });
  }
}

// ============================================================================
// LAPTOP POWER TOGGLE AND BOOT ANIMATION
// ============================================================================

// Enter laptop zoom mode (focus on screen)
function enterLaptopZoomMode(object) {
  if (object.userData.isZoomedIn) {
    // Already zoomed in, exit zoom mode
    exitLaptopZoomMode(object);
    return;
  }

  object.userData.isZoomedIn = true;

  // Initialize cursor state for laptop screen interaction
  // Restore last cursor position if available, otherwise center
  laptopCursorState.x = object.userData.lastCursorX !== undefined ? object.userData.lastCursorX : 256;
  laptopCursorState.y = object.userData.lastCursorY !== undefined ? object.userData.lastCursorY : 192;
  laptopCursorState.visible = object.userData.isOn && !object.userData.isBooting;
  laptopCursorState.targetLaptop = object;

  // Keep pointer lock active - laptop cursor is controlled via mouse movement
  // No need to exit pointer lock or show system cursor

  // If editor was open when we left, re-open it
  if (object.userData.editorWasOpen) {
    if (object.userData.isOn && !object.userData.isBooting) {
      // Laptop is on and ready - open editor immediately
      setTimeout(() => {
        openMarkdownEditor(object);
      }, 100);
    } else if (!object.userData.isOn) {
      // Laptop is off - turn it on instantly (no boot animation) and open editor
      instantLaptopPowerOn(object);
      // Update cursor visibility since laptop is now on
      laptopCursorState.visible = true;
      setTimeout(() => {
        openMarkdownEditor(object);
      }, 100);
    } else if (object.userData.isBooting) {
      // Laptop is booting - wait for boot to complete then open editor
      const checkBootComplete = () => {
        if (!object.userData.isBooting) {
          laptopCursorState.visible = true;
          openMarkdownEditor(object);
        } else {
          setTimeout(checkBootComplete, 100);
        }
      };
      setTimeout(checkBootComplete, 100);
    }
  }

  // Get screen position in world coordinates
  const screenGroup = object.getObjectByName('screenGroup');
  if (!screenGroup) return;

  const screenWorldPos = new THREE.Vector3();
  screenGroup.getWorldPosition(screenWorldPos);

  // Store original camera state for returning
  object.userData.originalCameraPos = camera.position.clone();
  object.userData.originalCameraYaw = cameraLookState.yaw;
  object.userData.originalCameraPitch = cameraLookState.pitch;

  // Calculate target position in front of the screen
  const direction = new THREE.Vector3();
  object.getWorldDirection(direction);

  // Position camera to look at screen from front
  const targetCameraPos = new THREE.Vector3(
    screenWorldPos.x,
    screenWorldPos.y + 0.2,
    screenWorldPos.z + 0.8
  );

  // Animate camera to target position
  const startPos = camera.position.clone();
  const startTime = Date.now();
  const duration = 500;

  function animateZoom() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // Ease out cubic

    camera.position.lerpVectors(startPos, targetCameraPos, eased);

    if (progress < 1) {
      requestAnimationFrame(animateZoom);
    }
  }

  animateZoom();

  // When entering laptop zoom mode:
  // - If laptop is off: just zoom in, user can click power button to turn on
  // - Otherwise: just zoom in, user sees the desktop and can interact
  // Note: Editor is NOT auto-opened even if there's saved content - user must click Obsidian icon
}

function exitLaptopZoomMode(object) {
  if (!object.userData.isZoomedIn) return;

  object.userData.isZoomedIn = false;

  // Close any open markdown editor overlay when exiting laptop mode
  const editorOverlay = document.getElementById('markdown-editor-overlay');
  if (editorOverlay) {
    // Save content before removing
    const sourceTextarea = document.getElementById('md-source');
    const filenameInput = document.getElementById('md-filename');
    if (sourceTextarea) {
      object.userData.editorContent = sourceTextarea.value;
    }
    if (filenameInput) {
      object.userData.editorFileName = filenameInput.value || 'notes.md';
    }
    // Mark that editor was open so it can be restored on re-entry
    object.userData.editorWasOpen = true;
    editorOverlay.remove();
  }

  // Save cursor state for visual persistence on screen
  object.userData.lastCursorX = laptopCursorState.x;
  object.userData.lastCursorY = laptopCursorState.y;
  object.userData.lastStartMenuOpen = laptopStartMenuState.isOpen && laptopStartMenuState.targetLaptop === object;

  // Reset cursor interaction state but keep visuals
  laptopCursorState.visible = false;
  laptopCursorState.targetLaptop = null;

  // Update desktop texture with persisted cursor and start menu
  if (object.userData.isOn && object.userData.screenState === 'desktop') {
    updateLaptopDesktopWithPersistedState(object);
  }

  // Animate camera back to original position
  if (object.userData.originalCameraPos) {
    const startPos = camera.position.clone();
    const targetPos = object.userData.originalCameraPos;
    const startTime = Date.now();
    const duration = 400;

    function animateZoomOut() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      camera.position.lerpVectors(startPos, targetPos, eased);

      if (progress < 1) {
        requestAnimationFrame(animateZoomOut);
      } else {
        // Restore camera look direction
        if (object.userData.originalCameraYaw !== undefined) {
          cameraLookState.yaw = object.userData.originalCameraYaw;
        }
        if (object.userData.originalCameraPitch !== undefined) {
          cameraLookState.pitch = object.userData.originalCameraPitch;
        }
        updateCameraLook();

        // Re-acquire pointer lock after exiting laptop zoom mode
        const container = document.getElementById('canvas-container');
        if (container && !document.pointerLockElement) {
          setTimeout(() => {
            container.requestPointerLock();
          }, 100);
        }
      }
    }

    animateZoomOut();
  }
}

// ============================================================================
// BOOK READING MODE
// ============================================================================

function enterBookReadingMode(book) {
  if (bookReadingState.active) return;

  bookReadingState.active = true;
  bookReadingState.book = book;

  // Reset zoom and pan offsets
  bookReadingState.zoomDistance = 0.85;
  bookReadingState.panOffsetX = 0;
  bookReadingState.panOffsetZ = 0;

  // Store original camera state
  bookReadingState.originalCameraPos = camera.position.clone();
  bookReadingState.originalCameraYaw = cameraLookState.yaw;
  bookReadingState.originalCameraPitch = cameraLookState.pitch;

  // Get book position in world coordinates and cache it
  // This avoids recalculating on every keypress during pan/zoom
  const bookWorldPos = new THREE.Vector3();
  book.getWorldPosition(bookWorldPos);
  bookReadingState.bookWorldPos = bookWorldPos;

  // Calculate target camera position - at comfortable reading height above the book
  // Higher position for comfortable viewing distance
  const targetCameraPos = new THREE.Vector3(
    bookWorldPos.x,
    bookWorldPos.y + bookReadingState.zoomDistance, // Use zoomDistance for reading
    bookWorldPos.z + 0.65  // Further back for better overview
  );

  // Animate camera to reading position
  const startPos = camera.position.clone();
  const startTime = Date.now();
  const duration = 400;

  function animateToReading() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // Ease out cubic

    camera.position.lerpVectors(startPos, targetCameraPos, eased);

    // Point camera down at book
    // Camera is above and behind the book, needs to look down
    // Negative pitch = looking down, positive = looking up
    const lookAtY = bookWorldPos.y + 0.03;
    const verticalDist = camera.position.y - lookAtY; // Height above book
    const horizontalDist = Math.abs(camera.position.z - bookWorldPos.z); // Distance from book
    // Calculate the downward angle (should be negative for looking down)
    const targetPitch = -Math.atan2(verticalDist, horizontalDist);
    cameraLookState.pitch = bookReadingState.originalCameraPitch + (targetPitch - bookReadingState.originalCameraPitch) * eased;
    updateCameraLook();

    if (progress < 1) {
      requestAnimationFrame(animateToReading);
    }
  }

  animateToReading();
}

function exitBookReadingMode() {
  if (!bookReadingState.active) return;

  bookReadingState.active = false;

  // Animate camera back to original position
  if (bookReadingState.originalCameraPos) {
    const startPos = camera.position.clone();
    const targetPos = bookReadingState.originalCameraPos;
    const startPitch = cameraLookState.pitch;
    const targetPitch = bookReadingState.originalCameraPitch;
    const startYaw = cameraLookState.yaw;
    const targetYaw = bookReadingState.originalCameraYaw;
    const startTime = Date.now();
    const duration = 300;

    function animateFromReading() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      camera.position.lerpVectors(startPos, targetPos, eased);

      // Restore camera look direction
      cameraLookState.pitch = startPitch + (targetPitch - startPitch) * eased;
      cameraLookState.yaw = startYaw + (targetYaw - startYaw) * eased;
      updateCameraLook();

      if (progress < 1) {
        requestAnimationFrame(animateFromReading);
      }
    }

    animateFromReading();
  }

  bookReadingState.book = null;
  bookReadingState.bookWorldPos = null;
}

// ============================================================================
// INSPECTION + DRAWING MODE (for notebooks/paper)
// ============================================================================

function enterInspectionDrawingMode(drawableObject) {
  if (inspectionDrawingState.active) return;

  inspectionDrawingState.active = true;
  inspectionDrawingState.drawableObject = drawableObject;

  // Reset zoom and pan offsets
  inspectionDrawingState.zoomDistance = 0.85;
  inspectionDrawingState.panOffsetX = 0;
  inspectionDrawingState.panOffsetZ = 0;

  // Store original camera state
  inspectionDrawingState.originalCameraPos = camera.position.clone();
  inspectionDrawingState.originalCameraYaw = cameraLookState.yaw;
  inspectionDrawingState.originalCameraPitch = cameraLookState.pitch;

  // Get object position in world coordinates and cache it
  const objectWorldPos = new THREE.Vector3();
  drawableObject.getWorldPosition(objectWorldPos);
  inspectionDrawingState.objectWorldPos = objectWorldPos;

  // Calculate target camera position - at comfortable viewing height above the object
  const targetCameraPos = new THREE.Vector3(
    objectWorldPos.x,
    objectWorldPos.y + inspectionDrawingState.zoomDistance,
    objectWorldPos.z + 0.65
  );

  // Animate camera to inspection position
  const startPos = camera.position.clone();
  const startTime = Date.now();
  const duration = 400;

  function animateToInspection() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // Ease out cubic

    camera.position.lerpVectors(startPos, targetCameraPos, eased);

    // Point camera down at object
    const lookAtY = objectWorldPos.y + 0.03;
    const verticalDist = camera.position.y - lookAtY;
    const horizontalDist = Math.abs(camera.position.z - objectWorldPos.z);
    const targetPitch = -Math.atan2(verticalDist, horizontalDist);
    cameraLookState.pitch = inspectionDrawingState.originalCameraPitch + (targetPitch - inspectionDrawingState.originalCameraPitch) * eased;
    updateCameraLook();

    if (progress < 1) {
      requestAnimationFrame(animateToInspection);
    }
  }

  animateToInspection();
}

function exitInspectionDrawingMode() {
  if (!inspectionDrawingState.active) return;

  inspectionDrawingState.active = false;

  // Animate camera back to original position
  if (inspectionDrawingState.originalCameraPos) {
    const startPos = camera.position.clone();
    const targetPos = inspectionDrawingState.originalCameraPos;
    const startPitch = cameraLookState.pitch;
    const targetPitch = inspectionDrawingState.originalCameraPitch;
    const startYaw = cameraLookState.yaw;
    const targetYaw = inspectionDrawingState.originalCameraYaw;
    const startTime = Date.now();
    const duration = 300;

    function animateFromInspection() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      camera.position.lerpVectors(startPos, targetPos, eased);

      // Restore camera look direction
      cameraLookState.pitch = startPitch + (targetPitch - startPitch) * eased;
      cameraLookState.yaw = startYaw + (targetYaw - startYaw) * eased;
      updateCameraLook();

      if (progress < 1) {
        requestAnimationFrame(animateFromInspection);
      }
    }

    animateFromInspection();
  }

  inspectionDrawingState.drawableObject = null;
  inspectionDrawingState.objectWorldPos = null;
}

// ============================================================================
// CASSETTE PLAYER MODE (similar to book reading mode for convenient button interaction)
// ============================================================================

function enterPlayerMode(player) {
  if (playerModeState.active) return;

  playerModeState.active = true;
  playerModeState.player = player;

  // Set button order based on player type
  // Big player: buttons on front face in order prev → play → stop → next (left to right)
  // Mini player: buttons on top edge, same order for consistency
  const isBigPlayer = player.userData.type === 'big-cassette-player';
  if (isBigPlayer) {
    playerModeState.buttonNames = playerModeState.bigPlayerButtonNames;
    playerModeState.buttonTypes = playerModeState.bigPlayerButtonTypes;
  } else {
    playerModeState.buttonNames = playerModeState.miniPlayerButtonNames;
    playerModeState.buttonTypes = playerModeState.miniPlayerButtonTypes;
  }

  // Reset zoom and pan offsets
  playerModeState.zoomDistance = 0.25;
  playerModeState.panOffsetX = 0;
  playerModeState.panOffsetY = 0;
  playerModeState.currentButtonIndex = -1; // Start with front view

  // Store original camera state
  playerModeState.originalCameraPos = camera.position.clone();
  playerModeState.originalCameraYaw = cameraLookState.yaw;
  playerModeState.originalCameraPitch = cameraLookState.pitch;

  // Get player position in world coordinates and cache it
  const playerWorldPos = new THREE.Vector3();
  player.getWorldPosition(playerWorldPos);
  playerModeState.playerWorldPos = playerWorldPos;

  // Get the player's scale to adjust viewing distance
  const playerScale = player.scale.x || 1;

  // Get player's rotation to calculate correct camera position
  const playerRotationY = player.rotation.y;

  // Calculate target camera position - different for big vs mini player
  // Mini player: compact horizontal WM-10 style, needs to be closer
  // Big player: match play button view distance for consistency
  const viewDistance = isBigPlayer ? 0.25 * playerScale : 0.08 * playerScale;
  // Camera height: position to see buttons and screen
  const cameraHeight = isBigPlayer ? 0.06 * playerScale : 0.04 * playerScale;
  // Tilt angle for initial view (big player uses same as button view for consistency)
  const initialTilt = isBigPlayer ? -0.295 : 0;

  const targetCameraPos = new THREE.Vector3(
    playerWorldPos.x + Math.sin(playerRotationY) * viewDistance,
    playerWorldPos.y + cameraHeight,
    playerWorldPos.z + Math.cos(playerRotationY) * viewDistance
  );

  // Calculate target yaw from look direction (looking at player)
  const lookDir = new THREE.Vector3().subVectors(playerWorldPos, targetCameraPos);
  const targetYaw = Math.atan2(lookDir.x, lookDir.z);

  // Animate camera to player viewing position
  const startPos = camera.position.clone();
  const startYaw = cameraLookState.yaw;
  const startTime = Date.now();
  const duration = 400;

  function animateToPlayer() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // Ease out cubic

    camera.position.lerpVectors(startPos, targetCameraPos, eased);

    // Use appropriate tilt for player type (big player needs slight downward angle to match button view)
    cameraLookState.pitch = playerModeState.originalCameraPitch + (initialTilt - playerModeState.originalCameraPitch) * eased;
    cameraLookState.yaw = startYaw + (targetYaw - startYaw) * eased;
    updateCameraLook();

    if (progress < 1) {
      requestAnimationFrame(animateToPlayer);
    }
  }

  animateToPlayer();
}

function exitPlayerMode() {
  if (!playerModeState.active) return;

  playerModeState.active = false;

  // Animate camera back to original position
  if (playerModeState.originalCameraPos) {
    const startPos = camera.position.clone();
    const targetPos = playerModeState.originalCameraPos;
    const startPitch = cameraLookState.pitch;
    const targetPitch = playerModeState.originalCameraPitch;
    const startYaw = cameraLookState.yaw;
    const targetYaw = playerModeState.originalCameraYaw;
    const startTime = Date.now();
    const duration = 300;

    function animateFromPlayer() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      camera.position.lerpVectors(startPos, targetPos, eased);

      // Restore camera look direction
      cameraLookState.pitch = startPitch + (targetPitch - startPitch) * eased;
      cameraLookState.yaw = startYaw + (targetYaw - startYaw) * eased;
      updateCameraLook();

      if (progress < 1) {
        requestAnimationFrame(animateFromPlayer);
      }
    }

    animateFromPlayer();
  }

  playerModeState.player = null;
  playerModeState.playerWorldPos = null;
  playerModeState.currentButtonIndex = -1;
}

// Navigate between player buttons with arrow keys
// direction: 1 for right (next button), -1 for left (previous button or front view)
function navigatePlayerButtons(direction) {
  if (!playerModeState.active || !playerModeState.player) return;

  const player = playerModeState.player;
  const numButtons = playerModeState.buttonNames.length; // 4 buttons

  // Calculate new index: -1 = front view, 0-3 = buttons
  let newIndex = playerModeState.currentButtonIndex + direction;

  // Wrap around: -1 -> front view, beyond last button -> front view
  if (newIndex < -1) newIndex = numButtons - 1;
  if (newIndex >= numButtons) newIndex = -1;

  playerModeState.currentButtonIndex = newIndex;

  // Get player world position
  const playerWorldPos = new THREE.Vector3();
  player.getWorldPosition(playerWorldPos);
  const playerScale = player.scale.x || 1;

  // Get player's rotation to calculate correct button positions
  const playerRotationY = player.rotation.y;

  // Different camera positioning based on player type
  const isBigPlayer = player.userData.type === 'big-cassette-player';

  if (newIndex === -1) {
    // Front view mode - camera faces the player screen directly
    // Mini player: needs to be closer for better visibility
    // Big player: farther for better overview (0.32 vs 0.28, increased per feedback)
    const viewDistance = isBigPlayer ? 0.32 * playerScale : 0.08 * playerScale;
    // Camera height: position to see buttons and screen
    const cameraHeight = isBigPlayer ? 0.06 * playerScale : 0.04 * playerScale;
    // Tilt angle for front view (big player uses same as button view for consistency)
    // Big player: -0.261 radians (raised 1 degree from -0.278)
    const frontViewTilt = isBigPlayer ? -0.261 : 0;

    // Calculate target position in front of the player (accounting for player rotation)
    const targetCameraPos = new THREE.Vector3(
      playerWorldPos.x + Math.sin(playerRotationY) * viewDistance,
      playerWorldPos.y + cameraHeight,
      playerWorldPos.z + Math.cos(playerRotationY) * viewDistance
    );

    // Animate camera to front view
    animateCameraToPosition(targetCameraPos, playerWorldPos, frontViewTilt, 250);
  } else {
    // Button view mode - camera centers on the selected button
    const buttonName = playerModeState.buttonNames[newIndex];
    const buttonsGroup = player.getObjectByName('buttons');

    if (buttonsGroup) {
      const button = buttonsGroup.getObjectByName(buttonName);

      if (button) {
        // Get button position in world coordinates
        const buttonWorldPos = new THREE.Vector3();
        button.getWorldPosition(buttonWorldPos);

        // Position camera above and angled to see the button
        // Different positioning based on player type:
        // - Mini player (cassette-player): buttons on TOP EDGE, need to look down more (~4 degrees additional)
        // - Big player (big-cassette-player): buttons on FRONT FACE, look more level
        const viewDistance = isBigPlayer ? 0.25 * playerScale : 0.08 * playerScale;
        const cameraHeight = isBigPlayer ? 0.06 * playerScale : 0.08 * playerScale;
        // Tilt angles for button visibility (different for each player type)
        // Big player: -0.261 radians (front-facing buttons, raised 1 degree from -0.278)
        // Mini player: -0.805 radians (top-edge buttons)
        const buttonTilt = isBigPlayer ? -0.261 : -0.805;

        const targetCameraPos = new THREE.Vector3(
          buttonWorldPos.x + Math.sin(playerRotationY) * viewDistance,
          buttonWorldPos.y + cameraHeight,
          buttonWorldPos.z + Math.cos(playerRotationY) * viewDistance
        );

        // Look at the button with a downward angle
        const lookAtPos = buttonWorldPos.clone();

        animateCameraToPosition(targetCameraPos, lookAtPos, buttonTilt, 200);
      }
    }
  }
}

// Helper function to animate camera to a position with look target
function animateCameraToPosition(targetPos, lookAtPos, targetPitch, duration) {
  const startPos = camera.position.clone();
  const startPitch = cameraLookState.pitch;
  const startTime = Date.now();

  // Calculate target yaw from look direction
  const lookDir = new THREE.Vector3().subVectors(lookAtPos, targetPos);
  const targetYaw = Math.atan2(lookDir.x, lookDir.z);
  const startYaw = cameraLookState.yaw;

  function animateCamera() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // Ease out cubic

    camera.position.lerpVectors(startPos, targetPos, eased);

    cameraLookState.pitch = startPitch + (targetPitch - startPitch) * eased;
    cameraLookState.yaw = startYaw + (targetYaw - startYaw) * eased;
    updateCameraLook();

    if (progress < 1) {
      requestAnimationFrame(animateCamera);
    } else {
      // Update player mode offsets to match new position
      if (playerModeState.playerWorldPos) {
        playerModeState.panOffsetX = targetPos.x - playerModeState.playerWorldPos.x;
        playerModeState.panOffsetY = targetPos.y - playerModeState.playerWorldPos.y;
      }
    }
  }

  animateCamera();
}

// Create laptop desktop texture with Obsidian icon
function createLaptopDesktopTexture(laptop, hasNote = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');

  // Check if there's a custom wallpaper
  if (laptop.userData.wallpaperDataUrl) {
    // Draw custom wallpaper
    const img = new Image();
    img.src = laptop.userData.wallpaperDataUrl;
    // Note: This is synchronous draw, may need to handle async loading
    try {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } catch (e) {
      // Fallback to default gradient if image fails
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, '#005a5a');
      gradient.addColorStop(1, '#003838');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  } else {
    // Default: Dark teal gradient background (Windows-style)
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#005a5a');
    gradient.addColorStop(1, '#003838');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Draw Obsidian icon (purple/violet gemstone shape)
  // Use saved icon positions if available
  const iconPos = laptop.userData.iconPositions || { obsidian: { x: 60, y: 60 } };
  const iconX = iconPos.obsidian?.x || 60;
  const iconY = iconPos.obsidian?.y || 60;
  const iconSize = 48;

  // Icon background (darker circle)
  ctx.beginPath();
  ctx.arc(iconX, iconY, iconSize / 2 + 4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fill();

  // Obsidian gem shape (simplified diamond/gem)
  ctx.beginPath();
  ctx.moveTo(iconX, iconY - iconSize / 2); // Top
  ctx.lineTo(iconX + iconSize / 2, iconY); // Right
  ctx.lineTo(iconX, iconY + iconSize / 2); // Bottom
  ctx.lineTo(iconX - iconSize / 2, iconY); // Left
  ctx.closePath();

  // Gradient fill for gem
  const gemGradient = ctx.createLinearGradient(iconX - iconSize / 2, iconY - iconSize / 2, iconX + iconSize / 2, iconY + iconSize / 2);
  gemGradient.addColorStop(0, '#9b59b6');
  gemGradient.addColorStop(0.5, '#8b5cf6');
  gemGradient.addColorStop(1, '#6366f1');
  ctx.fillStyle = gemGradient;
  ctx.fill();

  // Gem highlight
  ctx.beginPath();
  ctx.moveTo(iconX, iconY - iconSize / 2);
  ctx.lineTo(iconX + iconSize / 4, iconY - iconSize / 8);
  ctx.lineTo(iconX, iconY);
  ctx.lineTo(iconX - iconSize / 4, iconY - iconSize / 8);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.fill();

  // Icon label
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Obsidian', iconX, iconY + iconSize / 2 + 16);

  // Show open editor window only if editorWasOpen flag is true
  // (This means user exited laptop mode with editor still open)
  const showEditorWindow = laptop.userData.editorWasOpen && hasNote && laptop.userData.editorContent;
  if (showEditorWindow) {
    // Large window covering most of the screen (like a real open app)
    const winWidth = 380;
    const winHeight = 260;
    const winX = (canvas.width - winWidth) / 2;
    const winY = 30;

    // Window shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(winX + 4, winY + 4, winWidth, winHeight);

    // Window background (dark editor theme)
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(winX, winY, winWidth, winHeight);

    // Window border
    ctx.strokeStyle = '#45475a';
    ctx.lineWidth = 1;
    ctx.strokeRect(winX, winY, winWidth, winHeight);

    // Title bar
    const titleBarHeight = 26;
    const titleGradient = ctx.createLinearGradient(winX, winY, winX, winY + titleBarHeight);
    titleGradient.addColorStop(0, '#313244');
    titleGradient.addColorStop(1, '#1e1e2e');
    ctx.fillStyle = titleGradient;
    ctx.fillRect(winX, winY, winWidth, titleBarHeight);

    // Title bar bottom border
    ctx.strokeStyle = '#45475a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(winX, winY + titleBarHeight);
    ctx.lineTo(winX + winWidth, winY + titleBarHeight);
    ctx.stroke();

    // Window title (Obsidian icon + filename)
    ctx.fillStyle = '#cdd6f4';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('◆ ' + (laptop.userData.editorFileName || 'notes.md'), winX + 10, winY + 17);

    // Window control buttons (right side of title bar)
    const btnY = winY + 7;
    const btnSize = 12;
    // Close button
    ctx.fillStyle = '#f38ba8';
    ctx.beginPath();
    ctx.arc(winX + winWidth - 14, btnY + btnSize/2, btnSize/2, 0, Math.PI * 2);
    ctx.fill();
    // Maximize button
    ctx.fillStyle = '#a6e3a1';
    ctx.beginPath();
    ctx.arc(winX + winWidth - 32, btnY + btnSize/2, btnSize/2, 0, Math.PI * 2);
    ctx.fill();
    // Minimize button
    ctx.fillStyle = '#f9e2af';
    ctx.beginPath();
    ctx.arc(winX + winWidth - 50, btnY + btnSize/2, btnSize/2, 0, Math.PI * 2);
    ctx.fill();

    // Editor content area
    const contentY = winY + titleBarHeight + 8;
    const contentX = winX + 12;
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = '#cdd6f4';
    ctx.textAlign = 'left';

    // Show editor content (more lines visible)
    const lines = laptop.userData.editorContent.split('\n').slice(0, 16);
    lines.forEach((line, i) => {
      // Render checkboxes specially
      let displayLine = line;
      if (line.includes('- [ ]')) {
        displayLine = line.replace('- [ ]', '☐');
      } else if (line.includes('- [x]') || line.includes('- [X]')) {
        displayLine = line.replace(/- \[[xX]\]/, '☑');
      }
      const truncated = displayLine.length > 48 ? displayLine.substring(0, 48) + '...' : displayLine;
      ctx.fillText(truncated, contentX, contentY + i * 13);
    });

    // Scroll bar on right side
    ctx.fillStyle = '#45475a';
    ctx.fillRect(winX + winWidth - 8, winY + titleBarHeight + 4, 6, winHeight - titleBarHeight - 8);
    ctx.fillStyle = '#585b70';
    ctx.fillRect(winX + winWidth - 8, winY + titleBarHeight + 8, 6, 40);
  }

  // Taskbar at bottom
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, canvas.height - 28, canvas.width, 28);

  // Clock in taskbar
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  ctx.fillStyle = '#ffffff';
  ctx.font = '11px Arial';
  ctx.textAlign = 'right';
  ctx.fillText(timeStr, canvas.width - 10, canvas.height - 10);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Update laptop desktop display
function updateLaptopDesktop(laptop) {
  const screen = laptop.getObjectByName('screen');
  if (!screen) return;

  const hasNote = laptop.userData.editorContent && laptop.userData.editorContent.trim().length > 0;
  const texture = createLaptopDesktopTexture(laptop, hasNote);

  screen.material.map = texture;
  screen.material.color.set(0xffffff);
  screen.material.emissive.set(0xffffff);
  screen.material.emissiveIntensity = 0.3;
  screen.material.needsUpdate = true;

  // Store reference for icon click detection
  laptop.userData.desktopTexture = texture;
}

// Update laptop desktop with cursor overlay (for zoom mode interaction)
function updateLaptopDesktopWithCursor(laptop) {
  const screen = laptop.getObjectByName('screen');
  if (!screen) return;

  const hasNote = laptop.userData.editorContent && laptop.userData.editorContent.trim().length > 0;

  // Create base desktop texture content
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');

  // Check if there's a custom wallpaper
  if (laptop.userData.wallpaperDataUrl) {
    // If wallpaperImage not loaded yet, load it now
    if (!laptop.userData.wallpaperImage) {
      const img = new Image();
      img.onload = () => {
        laptop.userData.wallpaperImage = img;
        updateLaptopDesktopWithCursor(laptop); // Re-run with loaded image
      };
      img.src = laptop.userData.wallpaperDataUrl;
      // For now, draw default background
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, '#005a5a');
      gradient.addColorStop(1, '#003838');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.drawImage(laptop.userData.wallpaperImage, 0, 0, canvas.width, canvas.height);
    }
  } else {
    // Default: Dark teal gradient background (Windows-style)
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#005a5a');
    gradient.addColorStop(1, '#003838');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Draw Obsidian icon (using saved position or default)
  const iconPos = laptop.userData.iconPositions || { obsidian: { x: 60, y: 60 } };
  const iconX = iconPos.obsidian?.x || 60;
  const iconY = iconPos.obsidian?.y || 60;
  const iconSize = 48;

  // Check if cursor is over icon for hover effect (or if dragging)
  const cursorOverIcon = (Math.abs(laptopCursorState.x - iconX) < iconSize / 2 + 10 &&
                         Math.abs(laptopCursorState.y - iconY) < iconSize / 2 + 20) ||
                         (laptopIconDragState.isDragging && laptopIconDragState.iconName === 'obsidian');

  // Icon background (highlight if hovered)
  ctx.beginPath();
  ctx.arc(iconX, iconY, iconSize / 2 + 4, 0, Math.PI * 2);
  ctx.fillStyle = cursorOverIcon ? 'rgba(100, 100, 255, 0.4)' : 'rgba(0, 0, 0, 0.3)';
  ctx.fill();

  // Icon selection highlight
  if (cursorOverIcon) {
    ctx.strokeStyle = 'rgba(150, 150, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Obsidian gem shape
  ctx.beginPath();
  ctx.moveTo(iconX, iconY - iconSize / 2);
  ctx.lineTo(iconX + iconSize / 2, iconY);
  ctx.lineTo(iconX, iconY + iconSize / 2);
  ctx.lineTo(iconX - iconSize / 2, iconY);
  ctx.closePath();

  const gemGradient = ctx.createLinearGradient(iconX - iconSize / 2, iconY - iconSize / 2, iconX + iconSize / 2, iconY + iconSize / 2);
  gemGradient.addColorStop(0, '#9b59b6');
  gemGradient.addColorStop(0.5, '#8b5cf6');
  gemGradient.addColorStop(1, '#6366f1');
  ctx.fillStyle = gemGradient;
  ctx.fill();

  // Gem highlight
  ctx.beginPath();
  ctx.moveTo(iconX, iconY - iconSize / 2);
  ctx.lineTo(iconX + iconSize / 4, iconY - iconSize / 8);
  ctx.lineTo(iconX, iconY);
  ctx.lineTo(iconX - iconSize / 4, iconY - iconSize / 8);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.fill();

  // Icon label
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Obsidian', iconX, iconY + iconSize / 2 + 16);

  // Draw editor window only if editorWasOpen flag is true
  // (This means user exited laptop mode with editor still open, or editor is currently open)
  if (hasNote && laptop.userData.editorContent && laptop.userData.editorWasOpen) {
    const winWidth = 380;
    const winHeight = 260;
    const winX = (canvas.width - winWidth) / 2;
    const winY = 30;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(winX + 4, winY + 4, winWidth, winHeight);
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(winX, winY, winWidth, winHeight);
    ctx.strokeStyle = '#45475a';
    ctx.lineWidth = 1;
    ctx.strokeRect(winX, winY, winWidth, winHeight);

    // Title bar
    const titleBarHeight = 26;
    const titleGradient = ctx.createLinearGradient(winX, winY, winX, winY + titleBarHeight);
    titleGradient.addColorStop(0, '#313244');
    titleGradient.addColorStop(1, '#1e1e2e');
    ctx.fillStyle = titleGradient;
    ctx.fillRect(winX, winY, winWidth, titleBarHeight);

    ctx.strokeStyle = '#45475a';
    ctx.beginPath();
    ctx.moveTo(winX, winY + titleBarHeight);
    ctx.lineTo(winX + winWidth, winY + titleBarHeight);
    ctx.stroke();

    ctx.fillStyle = '#cdd6f4';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('◆ ' + (laptop.userData.editorFileName || 'notes.md'), winX + 10, winY + 17);

    // Window control buttons
    const btnY = winY + 7;
    const btnSize = 12;
    ctx.fillStyle = '#f38ba8';
    ctx.beginPath();
    ctx.arc(winX + winWidth - 14, btnY + btnSize/2, btnSize/2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#a6e3a1';
    ctx.beginPath();
    ctx.arc(winX + winWidth - 32, btnY + btnSize/2, btnSize/2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f9e2af';
    ctx.beginPath();
    ctx.arc(winX + winWidth - 50, btnY + btnSize/2, btnSize/2, 0, Math.PI * 2);
    ctx.fill();

    // Content
    const contentY = winY + titleBarHeight + 8;
    const contentX = winX + 12;
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = '#cdd6f4';
    ctx.textAlign = 'left';

    const lines = laptop.userData.editorContent.split('\n').slice(0, 16);
    lines.forEach((line, i) => {
      let displayLine = line;
      if (line.includes('- [ ]')) displayLine = line.replace('- [ ]', '☐');
      else if (line.includes('- [x]') || line.includes('- [X]')) displayLine = line.replace(/- \[[xX]\]/, '☑');
      const truncated = displayLine.length > 48 ? displayLine.substring(0, 48) + '...' : displayLine;
      ctx.fillText(truncated, contentX, contentY + i * 13);
    });

    // Scrollbar
    ctx.fillStyle = '#45475a';
    ctx.fillRect(winX + winWidth - 8, winY + titleBarHeight + 4, 6, winHeight - titleBarHeight - 8);
    ctx.fillStyle = '#585b70';
    ctx.fillRect(winX + winWidth - 8, winY + titleBarHeight + 8, 6, 40);
  }

  // Windows XP-style Taskbar - blue gradient
  const taskbarGradient = ctx.createLinearGradient(0, canvas.height - 28, 0, canvas.height);
  taskbarGradient.addColorStop(0, '#1c5eba');
  taskbarGradient.addColorStop(0.1, '#3985d8');
  taskbarGradient.addColorStop(0.9, '#1558b0');
  taskbarGradient.addColorStop(1, '#0d3d80');
  ctx.fillStyle = taskbarGradient;
  ctx.fillRect(0, canvas.height - 28, canvas.width, 28);

  // Windows XP-style Start button - green with rounded left side
  const startBtnX = 0;
  const startBtnY = canvas.height - 26;
  const startBtnW = 65;
  const startBtnH = 24;

  // Check if cursor is over start button
  const cursorOverStart = laptopCursorState.x >= startBtnX &&
                          laptopCursorState.x <= startBtnX + startBtnW &&
                          laptopCursorState.y >= startBtnY &&
                          laptopCursorState.y <= startBtnY + startBtnH;

  // Start button background - classic XP green gradient
  const startGradient = ctx.createLinearGradient(startBtnX, startBtnY, startBtnX, startBtnY + startBtnH);
  if (cursorOverStart || (laptopStartMenuState.isOpen && laptopStartMenuState.targetLaptop === laptop)) {
    startGradient.addColorStop(0, '#6ac660');
    startGradient.addColorStop(0.4, '#3ba536');
    startGradient.addColorStop(0.6, '#2a9226');
    startGradient.addColorStop(1, '#1e7a1c');
  } else {
    startGradient.addColorStop(0, '#5bba52');
    startGradient.addColorStop(0.4, '#2f9e2a');
    startGradient.addColorStop(0.6, '#228a1e');
    startGradient.addColorStop(1, '#176c14');
  }

  // Draw rounded start button
  ctx.beginPath();
  ctx.moveTo(startBtnX, startBtnY);
  ctx.lineTo(startBtnX + startBtnW - 12, startBtnY);
  ctx.arcTo(startBtnX + startBtnW, startBtnY, startBtnX + startBtnW, startBtnY + startBtnH / 2, 12);
  ctx.arcTo(startBtnX + startBtnW, startBtnY + startBtnH, startBtnX + startBtnW - 12, startBtnY + startBtnH, 12);
  ctx.lineTo(startBtnX, startBtnY + startBtnH);
  ctx.closePath();
  ctx.fillStyle = startGradient;
  ctx.fill();

  // Windows flag icon (simplified)
  const flagX = startBtnX + 8;
  const flagY = startBtnY + 6;
  const flagSize = 12;

  // Draw 4 colored squares as Windows logo
  ctx.fillStyle = '#f25022'; // Red
  ctx.fillRect(flagX, flagY, flagSize / 2 - 1, flagSize / 2 - 1);
  ctx.fillStyle = '#7fba00'; // Green
  ctx.fillRect(flagX + flagSize / 2, flagY, flagSize / 2 - 1, flagSize / 2 - 1);
  ctx.fillStyle = '#00a4ef'; // Blue
  ctx.fillRect(flagX, flagY + flagSize / 2, flagSize / 2 - 1, flagSize / 2 - 1);
  ctx.fillStyle = '#ffb900'; // Yellow
  ctx.fillRect(flagX + flagSize / 2, flagY + flagSize / 2, flagSize / 2 - 1, flagSize / 2 - 1);

  // Start button text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px Tahoma, Arial';
  ctx.textAlign = 'left';
  ctx.fillText('start', startBtnX + 24, startBtnY + 16);

  // Draw Start Menu if open - Windows XP style
  if (laptopStartMenuState.isOpen && laptopStartMenuState.targetLaptop === laptop) {
    const menuX = 0;
    const menuY = canvas.height - 28 - 160;
    const menuW = 200;
    const menuH = 160;

    // Menu shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(menuX + 4, menuY + 4, menuW, menuH);

    // Main menu background - white/cream color
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(menuX, menuY, menuW, menuH);

    // Blue left sidebar (user section) - XP style gradient
    const sidebarW = 50;
    const sidebarGradient = ctx.createLinearGradient(menuX, menuY, menuX + sidebarW, menuY);
    sidebarGradient.addColorStop(0, '#1257af');
    sidebarGradient.addColorStop(1, '#4a95e0');
    ctx.fillStyle = sidebarGradient;
    ctx.fillRect(menuX, menuY, sidebarW, menuH - 34);

    // User avatar circle
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(menuX + sidebarW / 2, menuY + 30, 16, 0, Math.PI * 2);
    ctx.fill();

    // User icon (simple person silhouette)
    ctx.fillStyle = '#1257af';
    ctx.beginPath();
    ctx.arc(menuX + sidebarW / 2, menuY + 26, 6, 0, Math.PI * 2); // Head
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(menuX + sidebarW / 2, menuY + 40, 10, 7, 0, Math.PI, 0); // Body
    ctx.fill();

    // Username text rotated vertically on sidebar
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px Tahoma, Arial';
    ctx.translate(menuX + sidebarW / 2 + 3, menuY + 60);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'left';
    ctx.fillText('User', 0, 0);
    ctx.restore();

    // Blue header at top
    const headerGradient = ctx.createLinearGradient(menuX + sidebarW, menuY, menuX + menuW, menuY);
    headerGradient.addColorStop(0, '#1257af');
    headerGradient.addColorStop(1, '#5aade0');
    ctx.fillStyle = headerGradient;
    ctx.fillRect(menuX + sidebarW, menuY, menuW - sidebarW, 28);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Tahoma, Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Focus Desktop', menuX + sidebarW + 8, menuY + 18);

    // Programs section - white area
    ctx.fillStyle = '#333333';
    ctx.font = '11px Tahoma, Arial';
    ctx.textAlign = 'left';

    // Sample programs list
    const programs = ['📁 My Documents', '🖥️ My Computer', '⚙️ Control Panel'];
    programs.forEach((prog, i) => {
      const progY = menuY + 40 + i * 22;
      const isHovered = laptopCursorState.x >= menuX + sidebarW + 5 &&
                        laptopCursorState.x <= menuX + menuW - 5 &&
                        laptopCursorState.y >= progY - 8 &&
                        laptopCursorState.y <= progY + 14;

      if (isHovered) {
        ctx.fillStyle = '#316ac5';
        ctx.fillRect(menuX + sidebarW + 2, progY - 8, menuW - sidebarW - 4, 22);
        ctx.fillStyle = '#ffffff';
      } else {
        ctx.fillStyle = '#333333';
      }
      ctx.fillText(prog, menuX + sidebarW + 10, progY + 6);
    });

    // Orange bottom bar for shutdown - XP style
    const bottomBarY = menuY + menuH - 34;
    const bottomGradient = ctx.createLinearGradient(menuX, bottomBarY, menuX, menuY + menuH);
    bottomGradient.addColorStop(0, '#ff9d00');
    bottomGradient.addColorStop(0.5, '#e08600');
    bottomGradient.addColorStop(1, '#cc7800');
    ctx.fillStyle = bottomGradient;
    ctx.fillRect(menuX, bottomBarY, menuW, 34);

    // Shutdown button in orange bar
    const shutdownX = menuX + menuW - 90;
    const shutdownY = bottomBarY + 7;
    const cursorOverShutdown = laptopCursorState.x >= shutdownX &&
                               laptopCursorState.x <= shutdownX + 80 &&
                               laptopCursorState.y >= shutdownY &&
                               laptopCursorState.y <= shutdownY + 20;

    if (cursorOverShutdown) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fillRect(shutdownX - 5, shutdownY - 2, 90, 24);
    }

    // Power icon (red circle with line)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(shutdownX + 8, shutdownY + 10, 6, 0.3 * Math.PI, 2.7 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(shutdownX + 8, shutdownY + 4);
    ctx.lineTo(shutdownX + 8, shutdownY + 10);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '10px Tahoma, Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Turn Off', shutdownX + 20, shutdownY + 14);

    // Menu border
    ctx.strokeStyle = '#1257af';
    ctx.lineWidth = 2;
    ctx.strokeRect(menuX, menuY, menuW, menuH);
  }

  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  ctx.fillStyle = '#ffffff';
  ctx.font = '11px Arial';
  ctx.textAlign = 'right';
  ctx.fillText(timeStr, canvas.width - 10, canvas.height - 10);

  // Draw cursor
  if (laptopCursorState.visible) {
    const cx = laptopCursorState.x;
    const cy = laptopCursorState.y;

    // Arrow cursor shape
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy + 16);
    ctx.lineTo(cx + 4, cy + 12);
    ctx.lineTo(cx + 7, cy + 19);
    ctx.lineTo(cx + 10, cy + 18);
    ctx.lineTo(cx + 7, cy + 11);
    ctx.lineTo(cx + 12, cy + 11);
    ctx.closePath();

    // Cursor shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.save();
    ctx.translate(1, 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy + 16);
    ctx.lineTo(cx + 4, cy + 12);
    ctx.lineTo(cx + 7, cy + 19);
    ctx.lineTo(cx + 10, cy + 18);
    ctx.lineTo(cx + 7, cy + 11);
    ctx.lineTo(cx + 12, cy + 11);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Cursor body
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  screen.material.map = texture;
  screen.material.needsUpdate = true;
  laptop.userData.desktopTexture = texture;
}

// Update laptop desktop with persisted cursor/start menu when exiting zoom mode
function updateLaptopDesktopWithPersistedState(laptop) {
  const screen = laptop.getObjectByName('screen');
  if (!screen) return;

  const hasNote = laptop.userData.editorContent && laptop.userData.editorContent.trim().length > 0;

  // Create base desktop texture content
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');

  // Draw wallpaper or gradient background
  if (laptop.userData.wallpaperImage) {
    ctx.drawImage(laptop.userData.wallpaperImage, 0, 0, canvas.width, canvas.height);
  } else if (laptop.userData.wallpaperDataUrl) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#005a5a');
    gradient.addColorStop(1, '#003838');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#005a5a');
    gradient.addColorStop(1, '#003838');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Get icon position (support draggable in future)
  const iconPos = laptop.userData.iconPositions || { obsidian: { x: 60, y: 60 } };
  const iconX = iconPos.obsidian?.x || 60;
  const iconY = iconPos.obsidian?.y || 60;
  const iconSize = 48;

  // Icon background
  ctx.beginPath();
  ctx.arc(iconX, iconY, iconSize / 2 + 4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fill();

  // Obsidian gem shape
  ctx.beginPath();
  ctx.moveTo(iconX, iconY - iconSize / 2);
  ctx.lineTo(iconX + iconSize / 2, iconY);
  ctx.lineTo(iconX, iconY + iconSize / 2);
  ctx.lineTo(iconX - iconSize / 2, iconY);
  ctx.closePath();

  const gemGradient = ctx.createLinearGradient(iconX - iconSize / 2, iconY - iconSize / 2, iconX + iconSize / 2, iconY + iconSize / 2);
  gemGradient.addColorStop(0, '#9b59b6');
  gemGradient.addColorStop(0.5, '#8b5cf6');
  gemGradient.addColorStop(1, '#6366f1');
  ctx.fillStyle = gemGradient;
  ctx.fill();

  // Gem highlight
  ctx.beginPath();
  ctx.moveTo(iconX, iconY - iconSize / 2);
  ctx.lineTo(iconX + iconSize / 4, iconY - iconSize / 8);
  ctx.lineTo(iconX, iconY);
  ctx.lineTo(iconX - iconSize / 4, iconY - iconSize / 8);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.fill();

  // Icon label
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Obsidian', iconX, iconY + iconSize / 2 + 16);

  // Draw editor window only if editorWasOpen flag is true
  // (This means user exited laptop mode with editor still open)
  const showEditorWindow = laptop.userData.editorWasOpen;
  if (showEditorWindow) {
    const winWidth = 380;
    const winHeight = 260;
    const winX = (canvas.width - winWidth) / 2;
    const winY = 30;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(winX + 4, winY + 4, winWidth, winHeight);
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(winX, winY, winWidth, winHeight);
    ctx.strokeStyle = '#45475a';
    ctx.lineWidth = 1;
    ctx.strokeRect(winX, winY, winWidth, winHeight);

    // Title bar
    const titleBarHeight = 26;
    const titleGradient = ctx.createLinearGradient(winX, winY, winX, winY + titleBarHeight);
    titleGradient.addColorStop(0, '#313244');
    titleGradient.addColorStop(1, '#1e1e2e');
    ctx.fillStyle = titleGradient;
    ctx.fillRect(winX, winY, winWidth, titleBarHeight);

    ctx.fillStyle = '#cdd6f4';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('◆ ' + (laptop.userData.editorFileName || 'notes.md'), winX + 10, winY + 17);

    // Window control buttons
    const btnY = winY + 7;
    const btnSize = 12;
    ctx.fillStyle = '#f38ba8';
    ctx.beginPath();
    ctx.arc(winX + winWidth - 18, btnY + 6, btnSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fab387';
    ctx.beginPath();
    ctx.arc(winX + winWidth - 36, btnY + 6, btnSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#a6e3a1';
    ctx.beginPath();
    ctx.arc(winX + winWidth - 54, btnY + 6, btnSize / 2, 0, Math.PI * 2);
    ctx.fill();

    // Draw note content (or empty editor)
    const editorContent = laptop.userData.editorContent || '';
    const lines = editorContent.split('\n').slice(0, 16);
    ctx.fillStyle = '#cdd6f4';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    lines.forEach((line, i) => {
      const displayLine = line.length > 50 ? line.substring(0, 50) + '...' : line;
      ctx.fillText(displayLine, winX + 10, winY + titleBarHeight + 20 + i * 14);
    });
  }

  // Draw Windows XP taskbar
  const taskbarHeight = 30;
  const taskbarY = canvas.height - taskbarHeight;

  // Blue gradient taskbar
  const taskbarGradient = ctx.createLinearGradient(0, taskbarY, 0, canvas.height);
  taskbarGradient.addColorStop(0, '#245EDC');
  taskbarGradient.addColorStop(0.3, '#3C7CFC');
  taskbarGradient.addColorStop(0.5, '#4C94FF');
  taskbarGradient.addColorStop(1, '#245EDC');
  ctx.fillStyle = taskbarGradient;
  ctx.fillRect(0, taskbarY, canvas.width, taskbarHeight);

  // Start button
  const startBtnW = 70;
  const startBtnH = taskbarHeight - 4;
  const startBtnX = 2;
  const startBtnY = taskbarY + 2;

  // Start button gradient
  const startGradient = ctx.createLinearGradient(startBtnX, startBtnY, startBtnX, startBtnY + startBtnH);
  startGradient.addColorStop(0, '#3A9B34');
  startGradient.addColorStop(0.4, '#2D7D27');
  startGradient.addColorStop(1, '#1A5C15');
  ctx.fillStyle = startGradient;

  ctx.beginPath();
  ctx.moveTo(startBtnX + 10, startBtnY);
  ctx.lineTo(startBtnX + startBtnW - 4, startBtnY);
  ctx.arcTo(startBtnX + startBtnW, startBtnY, startBtnX + startBtnW, startBtnY + startBtnH, 4);
  ctx.arcTo(startBtnX + startBtnW, startBtnY + startBtnH, startBtnX, startBtnY + startBtnH, 4);
  ctx.lineTo(startBtnX + 10, startBtnY + startBtnH);
  ctx.arcTo(startBtnX, startBtnY + startBtnH, startBtnX, startBtnY, 10);
  ctx.arcTo(startBtnX, startBtnY, startBtnX + 10, startBtnY, 10);
  ctx.closePath();
  ctx.fill();

  // Start text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold italic 13px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('start', startBtnX + 22, startBtnY + 18);

  // Clock
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  ctx.font = '11px Arial';
  ctx.textAlign = 'right';
  ctx.fillText(timeStr, canvas.width - 10, canvas.height - 10);

  // Draw persisted start menu if it was open
  if (laptop.userData.lastStartMenuOpen) {
    drawStartMenu(ctx, canvas, laptop);
  }

  // Draw persisted cursor position
  if (laptop.userData.lastCursorX !== undefined) {
    const cx = laptop.userData.lastCursorX;
    const cy = laptop.userData.lastCursorY;

    // Arrow cursor shape
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy + 16);
    ctx.lineTo(cx + 4, cy + 12);
    ctx.lineTo(cx + 7, cy + 19);
    ctx.lineTo(cx + 10, cy + 18);
    ctx.lineTo(cx + 7, cy + 11);
    ctx.lineTo(cx + 12, cy + 11);
    ctx.closePath();

    // Cursor shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.save();
    ctx.translate(1, 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy + 16);
    ctx.lineTo(cx + 4, cy + 12);
    ctx.lineTo(cx + 7, cy + 19);
    ctx.lineTo(cx + 10, cy + 18);
    ctx.lineTo(cx + 7, cy + 11);
    ctx.lineTo(cx + 12, cy + 11);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Cursor body
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  screen.material.map = texture;
  screen.material.needsUpdate = true;
  laptop.userData.desktopTexture = texture;
}

// Helper function to draw start menu on canvas
function drawStartMenu(ctx, canvas, laptop) {
  const taskbarHeight = 30;
  const menuW = 240;
  const menuH = 320;
  const menuX = 2;
  const menuY = canvas.height - taskbarHeight - menuH;

  // Menu shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(menuX + 4, menuY + 4, menuW, menuH);

  // Menu background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(menuX, menuY, menuW, menuH);

  // Blue sidebar
  const sidebarW = 54;
  const sidebarGradient = ctx.createLinearGradient(menuX, menuY, menuX + sidebarW, menuY);
  sidebarGradient.addColorStop(0, '#245EDC');
  sidebarGradient.addColorStop(1, '#1948AA');
  ctx.fillStyle = sidebarGradient;
  ctx.fillRect(menuX, menuY, sidebarW, menuH);

  // User area at top
  ctx.fillStyle = '#245EDC';
  ctx.fillRect(menuX + sidebarW, menuY, menuW - sidebarW, 50);

  // User icon
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(menuX + sidebarW + 25, menuY + 25, 15, 0, Math.PI * 2);
  ctx.fill();

  // User name
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('User', menuX + sidebarW + 48, menuY + 30);

  // Separator line
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(menuX + sidebarW, menuY + 50);
  ctx.lineTo(menuX + menuW, menuY + 50);
  ctx.stroke();

  // Orange shutdown bar at bottom
  const shutdownH = 32;
  const shutdownGradient = ctx.createLinearGradient(menuX, menuY + menuH - shutdownH, menuX, menuY + menuH);
  shutdownGradient.addColorStop(0, '#FF9933');
  shutdownGradient.addColorStop(1, '#CC6600');
  ctx.fillStyle = shutdownGradient;
  ctx.fillRect(menuX + sidebarW, menuY + menuH - shutdownH, menuW - sidebarW, shutdownH);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Turn Off Computer', menuX + sidebarW + (menuW - sidebarW) / 2, menuY + menuH - 10);
}

// Instantly turn on laptop without boot animation (used when returning to laptop zoom mode with editor open)
function instantLaptopPowerOn(object) {
  if (object.userData.isOn) return; // Already on

  const screen = object.getObjectByName('screen');
  const powerLed = object.getObjectByName('powerLed');

  // Set state to on immediately
  object.userData.isOn = true;
  object.userData.isBooting = false;
  object.userData.screenState = 'desktop';

  // Power LED on
  if (powerLed) {
    const ledColor = new THREE.Color(object.userData.powerLedColor || '#00ff00');
    powerLed.material.color.copy(ledColor);
    powerLed.material.emissive.copy(ledColor);
    powerLed.material.emissiveIntensity = 0.5;
  }

  // Update screen to desktop
  updateLaptopDesktop(object);

  // Enable cursor if in zoom mode
  if (object.userData.isZoomedIn) {
    laptopCursorState.visible = true;
    laptopCursorState.targetLaptop = object;
    laptopCursorState.x = object.userData.lastCursorX !== undefined ? object.userData.lastCursorX : 256;
    laptopCursorState.y = object.userData.lastCursorY !== undefined ? object.userData.lastCursorY : 192;
  }
}

function toggleLaptopPower(object) {
  if (object.userData.isBooting) return; // Don't toggle while booting

  const screen = object.getObjectByName('screen');
  const powerLed = object.getObjectByName('powerLed');

  if (object.userData.isOn) {
    // Turn off
    object.userData.isOn = false;
    object.userData.screenState = 'off';
    if (screen) {
      screen.material.color.set(0x000000);
      screen.material.emissive.set(0x000000);
      screen.material.emissiveIntensity = 0;
    }
    if (powerLed) {
      powerLed.material.color.set(0x222222);
      powerLed.material.emissive.set(0x000000);
      powerLed.material.emissiveIntensity = 0;
    }
  } else {
    // Boot sequence
    object.userData.isOn = true;
    object.userData.isBooting = true;
    object.userData.bootProgress = 0;

    // Power LED on
    if (powerLed) {
      const ledColor = new THREE.Color(object.userData.powerLedColor || '#00ff00');
      powerLed.material.color.copy(ledColor);
      powerLed.material.emissive.copy(ledColor);
      powerLed.material.emissiveIntensity = 0.5;
    }

    const bootTime = object.userData.bootTime;
    const startTime = Date.now();

    function animateBoot() {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / bootTime;

      if (progress < 0.3) {
        // BIOS screen (dark with text-like color)
        if (object.userData.screenState !== 'bios') {
          object.userData.screenState = 'bios';
          if (screen) {
            screen.material.color.set(0x000033);
            screen.material.emissive.set(0x000066);
            screen.material.emissiveIntensity = 0.3;
          }
        }
      } else if (progress < 0.8) {
        // Loading screen - use custom boot screen if available
        if (object.userData.screenState !== 'loading') {
          object.userData.screenState = 'loading';
          if (screen) {
            if (object.userData.bootScreenDataUrl && object.userData.bootScreenTexture) {
              // Use custom boot screen image
              screen.material.map = object.userData.bootScreenTexture;
              screen.material.color.set(0xffffff);
              screen.material.emissive.set(0xffffff);
              screen.material.emissiveIntensity = 0.2;
              screen.material.needsUpdate = true;
            } else {
              // Default Windows XP-like blue
              screen.material.map = null;
              screen.material.color.set(0x0052cc);
              screen.material.emissive.set(0x0052cc);
              screen.material.emissiveIntensity = 0.4;
              screen.material.needsUpdate = true;
            }
          }
        }
      } else if (progress < 1) {
        // Desktop loading
        if (object.userData.screenState !== 'desktop') {
          object.userData.screenState = 'desktop';
          // Use desktop texture with Obsidian icon
          updateLaptopDesktop(object);
        }
      }

      if (progress < 1) {
        requestAnimationFrame(animateBoot);
      } else {
        object.userData.isBooting = false;
        object.userData.screenState = 'desktop';
        // Final desktop update to ensure texture is applied
        updateLaptopDesktop(object);
        // Enable cursor if laptop is in zoom mode
        if (object.userData.isZoomedIn) {
          laptopCursorState.visible = true;
          laptopCursorState.targetLaptop = object;
          laptopCursorState.x = 256;
          laptopCursorState.y = 192;
          updateLaptopDesktopWithCursor(object);
        }
      }
    }

    animateBoot();
  }
}

function updateMousePosition(event) {
  if (pointerLockState.isLocked) {
    // When pointer is locked, the cursor is effectively at the center of the screen
    mouse.x = 0;
    mouse.y = 0;
  } else {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }
}

function updateCameraLook() {
  // Calculate new camera direction based on yaw and pitch
  const lookAt = new THREE.Vector3();

  // Convert spherical to Cartesian coordinates
  lookAt.x = camera.position.x + Math.sin(cameraLookState.yaw) * Math.cos(cameraLookState.pitch);
  lookAt.y = camera.position.y + Math.sin(cameraLookState.pitch);
  lookAt.z = camera.position.z + Math.cos(cameraLookState.yaw) * Math.cos(cameraLookState.pitch);

  camera.lookAt(lookAt);

  // Keep examined object centered in front of camera when rotating
  if (examineState.active && examineState.object) {
    const examineDistance = examineState.examineDistance || 2.5;
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    // Update target position to stay in front of camera
    const newTargetPosition = new THREE.Vector3(
      camera.position.x + direction.x * examineDistance,
      camera.position.y + direction.y * examineDistance + 0.3,
      camera.position.z + direction.z * examineDistance
    );

    examineState.object.userData.examineTarget = newTargetPosition;
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Update pixel art render targets if enabled
  if (CONFIG.pixelation.enabled) {
    updatePixelArtRenderTargets();
  }
}

// ============================================================================
// STATE PERSISTENCE
// ============================================================================

// Debounced wrapper for saveState - prevents rapid saves during interactions
function saveState() {
  // Don't save during loading
  if (isLoadingState) return;

  // Clear any pending debounce timer
  if (saveStateDebounceTimer) {
    clearTimeout(saveStateDebounceTimer);
  }

  // Debounce save by 300ms to prevent rapid saves during scroll/drag
  saveStateDebounceTimer = setTimeout(() => {
    saveStateImmediate();
  }, 300);
}

// Immediate save function (used internally)
async function saveStateImmediate() {
  // Don't save during loading or if already saving
  if (isLoadingState || isSavingState) return;

  isSavingState = true;
  const state = {
    objects: deskObjects.map(obj => {
      const data = {
        type: obj.userData.type,
        x: obj.position.x,
        z: obj.position.z,
        rotationY: obj.userData.rotationY || obj.rotation.y,
        scale: obj.userData.scale || obj.scale.x,
        mainColor: obj.userData.mainColor,
        accentColor: obj.userData.accentColor
      };

      // Save per-object collision settings (only if non-default)
      if (obj.userData.objectCollisionRadiusMultiplier !== undefined && obj.userData.objectCollisionRadiusMultiplier !== 1.0) {
        data.objectCollisionRadiusMultiplier = obj.userData.objectCollisionRadiusMultiplier;
      }
      if (obj.userData.objectCollisionHeightMultiplier !== undefined && obj.userData.objectCollisionHeightMultiplier !== 1.0) {
        data.objectCollisionHeightMultiplier = obj.userData.objectCollisionHeightMultiplier;
      }

      // Save type-specific data
      switch (obj.userData.type) {
        case 'photo-frame':
          // Save photo data URL if a photo is loaded
          if (obj.userData.photoDataUrl) {
            data.photoDataUrl = obj.userData.photoDataUrl;
          }
          break;
        case 'books':
          data.bookTitle = obj.userData.bookTitle;
          data.titleColor = obj.userData.titleColor;
          data.pdfPath = obj.userData.pdfPath;
          data.pdfResolution = obj.userData.pdfResolution;
          // PDF and cover data are stored separately to avoid lag during position saves
          // Only store reference flags here, actual data is saved separately
          if (obj.userData.pdfDataUrl) {
            data.hasPdfData = true;
            // Save PDF data separately if dirty
            if (obj.userData.pdfDataDirty) {
              window.electronAPI.saveObjectData(obj.userData.id, 'pdf', obj.userData.pdfDataUrl);
              obj.userData.pdfDataDirty = false;
            }
          }
          if (obj.userData.coverImageDataUrl) {
            data.hasCoverImage = true;
            // Save cover image data separately if dirty
            if (obj.userData.coverImageDirty) {
              window.electronAPI.saveObjectData(obj.userData.id, 'cover', obj.userData.coverImageDataUrl);
              obj.userData.coverImageDirty = false;
            }
          }
          // Save cover fit mode
          if (obj.userData.coverFitMode) {
            data.coverFitMode = obj.userData.coverFitMode;
          }
          // Save first page as cover flag
          if (obj.userData.firstPageAsCover) {
            data.firstPageAsCover = true;
          }
          data.currentPage = obj.userData.currentPage || 0;
          break;
        case 'magazine':
          data.magazineTitle = obj.userData.magazineTitle;
          data.titleColor = obj.userData.titleColor;
          data.pdfPath = obj.userData.pdfPath;
          data.pdfResolution = obj.userData.pdfResolution;
          // PDF and cover data are stored separately to avoid lag during position saves
          if (obj.userData.pdfDataUrl) {
            data.hasPdfData = true;
            if (obj.userData.pdfDataDirty) {
              window.electronAPI.saveObjectData(obj.userData.id, 'pdf', obj.userData.pdfDataUrl);
              obj.userData.pdfDataDirty = false;
            }
          }
          if (obj.userData.coverImageDataUrl) {
            data.hasCoverImage = true;
            if (obj.userData.coverImageDirty) {
              window.electronAPI.saveObjectData(obj.userData.id, 'cover', obj.userData.coverImageDataUrl);
              obj.userData.coverImageDirty = false;
            }
          }
          if (obj.userData.coverFitMode) {
            data.coverFitMode = obj.userData.coverFitMode;
          }
          if (obj.userData.firstPageAsCover) {
            data.firstPageAsCover = true;
          }
          data.currentPage = obj.userData.currentPage || 0;
          break;
        case 'coffee':
          data.drinkType = obj.userData.drinkType;
          data.liquidLevel = obj.userData.liquidLevel;
          data.isHot = obj.userData.isHot;
          break;
        case 'metronome':
          data.bpm = obj.userData.bpm;
          data.volume = obj.userData.volume;
          data.tickSound = obj.userData.tickSound;
          data.tickSoundType = obj.userData.tickSoundType;
          // Save pitch settings
          if (obj.userData.tickPitch !== undefined) {
            data.tickPitch = obj.userData.tickPitch;
          }
          // Save custom sound data URL for persistence
          if (obj.userData.customSoundDataUrl) {
            data.customSoundDataUrl = obj.userData.customSoundDataUrl;
          }
          // Save pitch curve settings
          if (obj.userData.pitchCurveEnabled !== undefined) {
            data.pitchCurveEnabled = obj.userData.pitchCurveEnabled;
          }
          if (obj.userData.pitchCurveType) {
            data.pitchCurveType = obj.userData.pitchCurveType;
          }
          if (obj.userData.pitchCurveStart !== undefined) {
            data.pitchCurveStart = obj.userData.pitchCurveStart;
          }
          if (obj.userData.pitchCurveEnd !== undefined) {
            data.pitchCurveEnd = obj.userData.pitchCurveEnd;
          }
          if (obj.userData.pitchCurveDuration !== undefined) {
            data.pitchCurveDuration = obj.userData.pitchCurveDuration;
          }
          if (obj.userData.pitchCurveLoop !== undefined) {
            data.pitchCurveLoop = obj.userData.pitchCurveLoop;
          }
          // Save tempo curve settings
          if (obj.userData.tempoCurveEnabled !== undefined) {
            data.tempoCurveEnabled = obj.userData.tempoCurveEnabled;
          }
          if (obj.userData.tempoCurveType) {
            data.tempoCurveType = obj.userData.tempoCurveType;
          }
          if (obj.userData.tempoCurveStart !== undefined) {
            data.tempoCurveStart = obj.userData.tempoCurveStart;
          }
          if (obj.userData.tempoCurveEnd !== undefined) {
            data.tempoCurveEnd = obj.userData.tempoCurveEnd;
          }
          if (obj.userData.tempoCurveDuration !== undefined) {
            data.tempoCurveDuration = obj.userData.tempoCurveDuration;
          }
          if (obj.userData.tempoCurveLoop !== undefined) {
            data.tempoCurveLoop = obj.userData.tempoCurveLoop;
          }
          // Save curve points arrays for FL Studio-style automation curves
          if (obj.userData.pitchCurvePoints && obj.userData.pitchCurvePoints.length > 0) {
            data.pitchCurvePoints = obj.userData.pitchCurvePoints;
          }
          if (obj.userData.tempoCurvePoints && obj.userData.tempoCurvePoints.length > 0) {
            data.tempoCurvePoints = obj.userData.tempoCurvePoints;
          }
          // Save running state and pendulum phase for persistence
          if (obj.userData.isRunning !== undefined) {
            data.isRunning = obj.userData.isRunning;
          }
          if (obj.userData.pendulumAngle !== undefined) {
            data.pendulumAngle = obj.userData.pendulumAngle;
          }
          if (obj.userData.pendulumDirection !== undefined) {
            data.pendulumDirection = obj.userData.pendulumDirection;
          }
          if (obj.userData.lastTickTime !== undefined) {
            // Store relative time offset from now for restoration
            data.lastTickTimeOffset = Date.now() - obj.userData.lastTickTime;
          }
          break;
        case 'laptop':
          data.bootTime = obj.userData.bootTime;
          // Save power state
          data.isOn = obj.userData.isOn || false;
          data.screenState = obj.userData.screenState || 'off';
          if (obj.userData.bootScreenDataUrl) {
            data.bootScreenDataUrl = obj.userData.bootScreenDataUrl;
          }
          if (obj.userData.powerLedColor) {
            data.powerLedColor = obj.userData.powerLedColor;
          }
          if (obj.userData.powerButtonColor) {
            data.powerButtonColor = obj.userData.powerButtonColor;
          }
          if (obj.userData.powerButtonGlow !== undefined) {
            data.powerButtonGlow = obj.userData.powerButtonGlow;
          }
          if (obj.userData.powerButtonBrightness !== undefined) {
            data.powerButtonBrightness = obj.userData.powerButtonBrightness;
          }
          // Save markdown editor content
          if (obj.userData.editorContent !== undefined) {
            data.editorContent = obj.userData.editorContent;
          }
          if (obj.userData.editorFileName) {
            data.editorFileName = obj.userData.editorFileName;
          }
          // Save notes folder path
          if (obj.userData.notesFolderPath) {
            data.notesFolderPath = obj.userData.notesFolderPath;
          }
          // Save editor open state
          if (obj.userData.editorWasOpen) {
            data.editorWasOpen = obj.userData.editorWasOpen;
          }
          // Save wallpaper
          if (obj.userData.wallpaperDataUrl) {
            data.wallpaperDataUrl = obj.userData.wallpaperDataUrl;
          }
          // Save start menu state and cursor position for visual persistence
          data.startMenuOpen = laptopStartMenuState.isOpen && laptopStartMenuState.targetLaptop === obj;
          data.cursorX = laptopCursorState.x;
          data.cursorY = laptopCursorState.y;
          // Save icon positions if they exist
          if (obj.userData.iconPositions) {
            data.iconPositions = obj.userData.iconPositions;
          }
          break;
        case 'pen':
          data.penColor = obj.userData.penColor;
          data.inkColor = obj.userData.inkColor;
          data.lineWidth = obj.userData.lineWidth || 2;
          // Save drawings folder path if set
          if (obj.userData.drawingsSaveFolder) {
            data.drawingsSaveFolder = obj.userData.drawingsSaveFolder;
          }
          // Save holder info if pen is in a holder
          if (obj.userData.inHolder) {
            const holderIndex = deskObjects.indexOf(obj.userData.inHolder);
            if (holderIndex >= 0) {
              data.inHolderIndex = holderIndex;
              data.holderSlot = obj.userData.holderSlot;
            }
          }
          break;
        case 'cassette-player':
        case 'big-cassette-player':
          // Save music folder and track info (for both mini and big player)
          if (obj.userData.musicFolderPath) {
            data.musicFolderPath = obj.userData.musicFolderPath;
            data.audioFiles = obj.userData.audioFiles;
            data.currentTrackIndex = obj.userData.currentTrackIndex || 0;
          }
          // Save effect settings
          data.volume = obj.userData.volume;
          data.tapeHissLevel = obj.userData.tapeHissLevel;
          data.wowFlutterLevel = obj.userData.wowFlutterLevel;
          data.saturationLevel = obj.userData.saturationLevel;
          data.lowCutoff = obj.userData.lowCutoff;
          data.highCutoff = obj.userData.highCutoff;
          // Save playback position and state for resume after reload
          // Get current time from player's audio element if playing (per-player audio state)
          if (obj.userData.audioElement) {
            data.currentTime = obj.userData.audioElement.currentTime;
            data.wasPlaying = obj.userData.isPlaying;
          } else {
            data.currentTime = obj.userData.currentTime || 0;
            data.wasPlaying = obj.userData.isPlaying || false;
          }
          break;
        case 'notebook':
        case 'paper':
          // Save drawing data
          if (obj.userData.drawingLines && obj.userData.drawingLines.length > 0) {
            data.drawingLines = obj.userData.drawingLines;
            data.hasDrawingData = true;
          }
          if (obj.userData.drawingFileName) {
            data.drawingFileName = obj.userData.drawingFileName;
          }
          break;
        case 'dictaphone':
          // Save recordings folder path and next recording number
          if (obj.userData.recordingsFolderPath) {
            data.recordingsFolderPath = obj.userData.recordingsFolderPath;
            data.recordingNumber = obj.userData.recordingNumber || 1;
          }
          // Save recording format (wav/mp3)
          if (obj.userData.recordingFormat) {
            data.recordingFormat = obj.userData.recordingFormat;
          }
          // Save recording volume (0-200%)
          if (obj.userData.recordingVolume !== undefined) {
            data.recordingVolume = obj.userData.recordingVolume;
          }
          // Save panoramic recording settings
          data.recordMicrophonePanorama = obj.userData.recordMicrophonePanorama === true;
          data.recordEnvironmentPanorama = obj.userData.recordEnvironmentPanorama !== false;
          break;
      }

      return data;
    }),
    camera: {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      yaw: cameraLookState.yaw,
      pitch: cameraLookState.pitch
    },
    // Save timer/alarm state (for clock objects)
    timerState: {
      alarmEnabled: timerState.alarmEnabled,
      alarmHours: timerState.alarmHours,
      alarmMinutes: timerState.alarmMinutes,
      alertVolume: timerState.alertVolume,
      alertPitch: timerState.alertPitch,
      customSoundDataUrl: timerState.customSoundDataUrl,
      useCustomSound: timerState.useCustomSound
    }
  };

  try {
    await window.electronAPI.saveState(state);
  } catch (error) {
    console.error('Failed to save state:', error);
  } finally {
    isSavingState = false;
  }
}

async function loadState() {
  try {
    isLoadingState = true; // Prevent saveState during loading
    const result = await window.electronAPI.loadState();

    if (result.success && result.state) {
      // Load camera position and look direction if saved
      if (result.state.camera) {
        camera.position.set(
          result.state.camera.x,
          result.state.camera.y,
          result.state.camera.z
        );
        // Load camera look direction
        if (result.state.camera.yaw !== undefined) {
          cameraLookState.yaw = result.state.camera.yaw;
        }
        if (result.state.camera.pitch !== undefined) {
          cameraLookState.pitch = result.state.camera.pitch;
        }
        updateCameraLook();
      }

      // Load timer/alarm state
      if (result.state.timerState) {
        const savedTimer = result.state.timerState;
        if (savedTimer.alarmEnabled !== undefined) timerState.alarmEnabled = savedTimer.alarmEnabled;
        if (savedTimer.alarmHours !== undefined) timerState.alarmHours = savedTimer.alarmHours;
        if (savedTimer.alarmMinutes !== undefined) timerState.alarmMinutes = savedTimer.alarmMinutes;
        if (savedTimer.alertVolume !== undefined) timerState.alertVolume = savedTimer.alertVolume;
        if (savedTimer.alertPitch !== undefined) timerState.alertPitch = savedTimer.alertPitch;
        if (savedTimer.useCustomSound !== undefined) timerState.useCustomSound = savedTimer.useCustomSound;
        if (savedTimer.customSoundDataUrl) {
          timerState.customSoundDataUrl = savedTimer.customSoundDataUrl;
          // Pre-decode the audio from data URL
          preloadTimerCustomSound();
        }
      }

      // Load objects
      if (result.state.objects) {
        result.state.objects.forEach(objData => {
          const obj = addObjectToDesk(objData.type, {
            x: objData.x,
            z: objData.z,
            rotationY: objData.rotationY,
            scale: objData.scale,
            mainColor: objData.mainColor,
            accentColor: objData.accentColor
          });

          // Restore type-specific data
          if (obj) {
            switch (objData.type) {
              case 'photo-frame':
                if (objData.photoDataUrl) {
                  obj.userData.photoDataUrl = objData.photoDataUrl;
                  // Load texture from data URL
                  const textureLoader = new THREE.TextureLoader();
                  textureLoader.load(objData.photoDataUrl, (texture) => {
                    const photoSurface = obj.getObjectByName('photoSurface');
                    if (photoSurface) {
                      photoSurface.material.map = texture;
                      photoSurface.material.color.set(0xffffff);
                      photoSurface.material.needsUpdate = true;
                      obj.userData.photoTexture = texture;
                    }
                  });
                }
                break;
              case 'books':
                // Use hasOwnProperty to preserve empty titles (don't fallback to 'My Book')
                if (objData.hasOwnProperty('bookTitle')) obj.userData.bookTitle = objData.bookTitle;
                if (objData.titleColor) obj.userData.titleColor = objData.titleColor;
                if (objData.pdfPath) obj.userData.pdfPath = objData.pdfPath;
                if (objData.pdfResolution) obj.userData.pdfResolution = objData.pdfResolution;
                if (objData.currentPage !== undefined) obj.userData.currentPage = objData.currentPage;
                // Regenerate title texture with saved title (uses userData.titleColor internally)
                // Also resize geometry for multi-line titles
                // Handle empty titles - hide the coverTitle element
                if (objData.hasOwnProperty('bookTitle') && obj.userData.createTitleTexture) {
                  const title = objData.bookTitle || '';
                  const hasTitle = title.trim().length > 0;

                  obj.traverse(child => {
                    if (child.name === 'coverTitle') {
                      // Set visibility based on whether title is empty
                      child.visible = hasTitle;

                      // Only update texture if title is visible
                      if (hasTitle) {
                        const lines = title.split('\n');
                        // Calculate canvas and geometry height based on line count
                        const baseHeight = 116;
                        const lineAddition = 60;
                        const lineCount = Math.max(1, lines.length);
                        const canvasHeight = baseHeight + (lineCount - 1) * lineAddition;

                        // Calculate geometry height
                        const baseGeoHeight = 0.08;
                        const geoHeight = baseGeoHeight * (canvasHeight / baseHeight);

                        const newCoverTexture = obj.userData.createTitleTexture(
                          title, 320, canvasHeight, 64
                        );
                        // Update geometry for multi-line
                        const newGeometry = new THREE.PlaneGeometry(0.22, geoHeight);
                        child.geometry.dispose();
                        child.geometry = newGeometry;
                        child.position.y = 0.041 + (lineCount - 1) * 0.01;

                        child.material.map = newCoverTexture;
                        child.material.needsUpdate = true;
                      }
                    }
                  });
                }
                // Restore cover fit mode first (needed before loading cover)
                if (objData.coverFitMode) {
                  obj.userData.coverFitMode = objData.coverFitMode;
                }
                // Restore first page as cover flag
                if (objData.firstPageAsCover) {
                  obj.userData.firstPageAsCover = true;
                }
                // Load PDF data from separate storage if flagged
                if (objData.hasPdfData) {
                  obj.userData.isLoadingPdf = true;
                  window.electronAPI.loadObjectData(obj.userData.id, 'pdf').then(result => {
                    if (result.success && result.data) {
                      obj.userData.pdfDataUrl = result.data;
                      loadPDFFromDataUrl(obj, result.data);
                    } else {
                      obj.userData.isLoadingPdf = false;
                    }
                  });
                }
                // Load cover image from separate storage if flagged
                if (objData.hasCoverImage) {
                  window.electronAPI.loadObjectData(obj.userData.id, 'cover').then(result => {
                    if (result.success && result.data) {
                      obj.userData.coverImageDataUrl = result.data;
                      const fitMode = obj.userData.coverFitMode || 'contain';
                      applyCoverImageWithFit(obj, result.data, fitMode);
                    }
                  });
                }
                // Legacy support: load from inline data if present (for old saves)
                if (objData.pdfDataUrl) {
                  obj.userData.pdfDataUrl = objData.pdfDataUrl;
                  obj.userData.pdfDataDirty = true; // Mark dirty to migrate to new storage
                  obj.userData.isLoadingPdf = true;
                  loadPDFFromDataUrl(obj, objData.pdfDataUrl);
                }
                if (objData.coverImageDataUrl) {
                  obj.userData.coverImageDataUrl = objData.coverImageDataUrl;
                  obj.userData.coverImageDirty = true; // Mark dirty to migrate to new storage
                  const fitMode = obj.userData.coverFitMode || 'contain';
                  applyCoverImageWithFit(obj, objData.coverImageDataUrl, fitMode);
                }
                break;
              case 'magazine':
                // Restore magazine-specific data
                if (objData.hasOwnProperty('magazineTitle')) obj.userData.magazineTitle = objData.magazineTitle;
                if (objData.titleColor) obj.userData.titleColor = objData.titleColor;
                if (objData.pdfPath) obj.userData.pdfPath = objData.pdfPath;
                if (objData.pdfResolution) obj.userData.pdfResolution = objData.pdfResolution;
                if (objData.currentPage !== undefined) obj.userData.currentPage = objData.currentPage;
                // Regenerate title texture with saved title
                if (objData.hasOwnProperty('magazineTitle') && obj.userData.createTitleTexture) {
                  const title = objData.magazineTitle || '';
                  const hasTitle = title.trim().length > 0;

                  obj.traverse(child => {
                    if (child.name === 'coverTitle') {
                      child.visible = hasTitle;

                      if (hasTitle) {
                        const lines = title.split('\n');
                        const baseHeight = 124;
                        const lineAddition = 50;
                        const lineCount = Math.max(1, lines.length);
                        const canvasHeight = baseHeight + (lineCount - 1) * lineAddition;

                        const baseGeoHeight = 0.08;
                        const geoHeight = baseGeoHeight * (canvasHeight / baseHeight);

                        const newCoverTexture = obj.userData.createTitleTexture(
                          title, 280, canvasHeight, 48
                        );
                        const newGeometry = new THREE.PlaneGeometry(0.18, geoHeight);
                        child.geometry.dispose();
                        child.geometry = newGeometry;
                        child.position.y = 0.016 + (lineCount - 1) * 0.008;

                        child.material.map = newCoverTexture;
                        child.material.needsUpdate = true;
                      }
                    }
                  });
                }
                // Restore cover fit mode first
                if (objData.coverFitMode) {
                  obj.userData.coverFitMode = objData.coverFitMode;
                }
                // Restore first page as cover flag
                if (objData.firstPageAsCover) {
                  obj.userData.firstPageAsCover = true;
                }
                // Load PDF data from separate storage if flagged
                if (objData.hasPdfData) {
                  obj.userData.isLoadingPdf = true;
                  window.electronAPI.loadObjectData(obj.userData.id, 'pdf').then(result => {
                    if (result.success && result.data) {
                      obj.userData.pdfDataUrl = result.data;
                      loadPDFFromDataUrlToMagazine(obj, result.data);
                    } else {
                      obj.userData.isLoadingPdf = false;
                    }
                  });
                }
                // Load cover image from separate storage if flagged
                if (objData.hasCoverImage) {
                  window.electronAPI.loadObjectData(obj.userData.id, 'cover').then(result => {
                    if (result.success && result.data) {
                      obj.userData.coverImageDataUrl = result.data;
                      const fitMode = obj.userData.coverFitMode || 'cover';
                      applyMagazineCoverImageWithFit(obj, result.data, fitMode);
                    }
                  });
                }
                // Legacy support: load from inline data if present
                if (objData.pdfDataUrl) {
                  obj.userData.pdfDataUrl = objData.pdfDataUrl;
                  obj.userData.pdfDataDirty = true;
                  obj.userData.isLoadingPdf = true;
                  loadPDFFromDataUrlToMagazine(obj, objData.pdfDataUrl);
                }
                if (objData.coverImageDataUrl) {
                  obj.userData.coverImageDataUrl = objData.coverImageDataUrl;
                  obj.userData.coverImageDirty = true;
                  const fitMode = obj.userData.coverFitMode || 'cover';
                  applyMagazineCoverImageWithFit(obj, objData.coverImageDataUrl, fitMode);
                }
                break;
              case 'coffee':
                if (objData.drinkType) {
                  obj.userData.drinkType = objData.drinkType;
                  const liquid = obj.getObjectByName('liquid');
                  const liquidBody = obj.getObjectByName('liquidBody');
                  if (DRINK_COLORS[objData.drinkType]) {
                    if (liquid) {
                      liquid.material.color.set(DRINK_COLORS[objData.drinkType].color);
                    }
                    if (liquidBody) {
                      liquidBody.material.color.set(DRINK_COLORS[objData.drinkType].color);
                    }
                  }
                }
                if (objData.liquidLevel !== undefined) {
                  obj.userData.liquidLevel = objData.liquidLevel;
                  const liquid = obj.getObjectByName('liquid');
                  const liquidBody = obj.getObjectByName('liquidBody');
                  const level = objData.liquidLevel;
                  if (liquid) {
                    liquid.visible = level > 0.05;
                    liquid.position.y = 0.03 + level * 0.14;
                  }
                  if (liquidBody) {
                    liquidBody.visible = level > 0.05;
                    liquidBody.scale.y = Math.max(0.1, level);
                    liquidBody.position.y = 0.015 + level * 0.07;
                  }
                }
                if (objData.isHot !== undefined) obj.userData.isHot = objData.isHot;
                break;
              case 'metronome':
                if (objData.bpm) obj.userData.bpm = objData.bpm;
                if (objData.volume !== undefined) obj.userData.volume = objData.volume;
                if (objData.tickSound !== undefined) obj.userData.tickSound = objData.tickSound;
                if (objData.tickSoundType) obj.userData.tickSoundType = objData.tickSoundType;
                // Restore pitch settings
                if (objData.tickPitch !== undefined) obj.userData.tickPitch = objData.tickPitch;
                // Restore custom sound data URL and pre-decode it
                if (objData.customSoundDataUrl) {
                  obj.userData.customSoundDataUrl = objData.customSoundDataUrl;
                  // Pre-decode the audio from data URL
                  preloadMetronomeCustomSound(obj);
                }
                // Restore pitch curve settings
                if (objData.pitchCurveEnabled !== undefined) obj.userData.pitchCurveEnabled = objData.pitchCurveEnabled;
                if (objData.pitchCurveType) obj.userData.pitchCurveType = objData.pitchCurveType;
                if (objData.pitchCurveStart !== undefined) obj.userData.pitchCurveStart = objData.pitchCurveStart;
                if (objData.pitchCurveEnd !== undefined) obj.userData.pitchCurveEnd = objData.pitchCurveEnd;
                if (objData.pitchCurveDuration !== undefined) obj.userData.pitchCurveDuration = objData.pitchCurveDuration;
                if (objData.pitchCurveLoop !== undefined) obj.userData.pitchCurveLoop = objData.pitchCurveLoop;
                // Restore tempo curve settings
                if (objData.tempoCurveEnabled !== undefined) obj.userData.tempoCurveEnabled = objData.tempoCurveEnabled;
                if (objData.tempoCurveType) obj.userData.tempoCurveType = objData.tempoCurveType;
                if (objData.tempoCurveStart !== undefined) obj.userData.tempoCurveStart = objData.tempoCurveStart;
                if (objData.tempoCurveEnd !== undefined) obj.userData.tempoCurveEnd = objData.tempoCurveEnd;
                if (objData.tempoCurveDuration !== undefined) obj.userData.tempoCurveDuration = objData.tempoCurveDuration;
                if (objData.tempoCurveLoop !== undefined) obj.userData.tempoCurveLoop = objData.tempoCurveLoop;
                // Restore curve points arrays for FL Studio-style automation curves
                if (objData.pitchCurvePoints && objData.pitchCurvePoints.length > 0) {
                  obj.userData.pitchCurvePoints = objData.pitchCurvePoints;
                }
                if (objData.tempoCurvePoints && objData.tempoCurvePoints.length > 0) {
                  obj.userData.tempoCurvePoints = objData.tempoCurvePoints;
                }
                // Restore running state and pendulum phase
                if (objData.isRunning !== undefined) obj.userData.isRunning = objData.isRunning;
                if (objData.pendulumAngle !== undefined) obj.userData.pendulumAngle = objData.pendulumAngle;
                if (objData.pendulumDirection !== undefined) obj.userData.pendulumDirection = objData.pendulumDirection;
                if (objData.lastTickTimeOffset !== undefined) {
                  // Restore lastTickTime relative to current time
                  obj.userData.lastTickTime = Date.now() - objData.lastTickTimeOffset;
                }
                break;
              case 'laptop':
                if (objData.bootTime) obj.userData.bootTime = objData.bootTime;
                if (objData.powerLedColor) obj.userData.powerLedColor = objData.powerLedColor;
                if (objData.powerButtonColor) obj.userData.powerButtonColor = objData.powerButtonColor;
                if (objData.powerButtonGlow !== undefined) obj.userData.powerButtonGlow = objData.powerButtonGlow;
                if (objData.powerButtonBrightness !== undefined) obj.userData.powerButtonBrightness = objData.powerButtonBrightness;
                // Update power button material with restored settings
                const powerButton = obj.getObjectByName('powerButton');
                if (powerButton) {
                  const btnColor = new THREE.Color(obj.userData.powerButtonColor);
                  powerButton.material.color.copy(btnColor);
                  if (obj.userData.powerButtonGlow) {
                    powerButton.material.emissive.copy(btnColor);
                    powerButton.material.emissiveIntensity = obj.userData.powerButtonBrightness / 100;
                  } else {
                    powerButton.material.emissive.setHex(0x000000);
                    powerButton.material.emissiveIntensity = 0;
                  }
                }
                if (objData.bootScreenDataUrl) {
                  obj.userData.bootScreenDataUrl = objData.bootScreenDataUrl;
                  // Load boot screen texture from data URL
                  const textureLoader = new THREE.TextureLoader();
                  textureLoader.load(objData.bootScreenDataUrl, (texture) => {
                    obj.userData.bootScreenTexture = texture;
                  });
                }
                // Restore markdown editor content and state
                if (objData.editorContent !== undefined) obj.userData.editorContent = objData.editorContent;
                if (objData.editorFileName) obj.userData.editorFileName = objData.editorFileName;
                if (objData.notesFolderPath) obj.userData.notesFolderPath = objData.notesFolderPath;
                if (objData.editorWasOpen) obj.userData.editorWasOpen = objData.editorWasOpen;
                // Restore wallpaper and update desktop texture
                if (objData.wallpaperDataUrl) {
                  obj.userData.wallpaperDataUrl = objData.wallpaperDataUrl;
                  // Preload the wallpaper image for cursor mode
                  const wallpaperImg = new Image();
                  wallpaperImg.onload = () => {
                    obj.userData.wallpaperImage = wallpaperImg;
                    // Update desktop texture with wallpaper
                    if (obj.userData.isOn && obj.userData.screenState === 'desktop') {
                      updateLaptopDesktop(obj);
                    }
                  };
                  wallpaperImg.src = objData.wallpaperDataUrl;
                }
                // Restore icon positions for desktop
                if (objData.iconPositions) {
                  obj.userData.iconPositions = objData.iconPositions;
                }
                // Restore power state (laptop was on/off when saved)
                if (objData.isOn) {
                  obj.userData.isOn = true;
                  obj.userData.isBooting = false;
                  obj.userData.screenState = objData.screenState || 'desktop';
                  // Update screen to show desktop with persisted state (icons, taskbar, start menu)
                  const screen = obj.getObjectByName('screen');
                  if (screen) {
                    // Use the persisted state renderer for proper icon positions and taskbar
                    updateLaptopDesktopWithPersistedState(obj);
                  }
                  // Update power LED to show on state
                  const powerLed = obj.getObjectByName('powerLed');
                  if (powerLed) {
                    powerLed.material.emissive.setHex(0x00ff00);
                    powerLed.material.emissiveIntensity = 0.8;
                  }
                }
                break;
              case 'pen':
                if (objData.penColor) obj.userData.penColor = objData.penColor;
                if (objData.inkColor) {
                  obj.userData.inkColor = objData.inkColor;
                }
                if (objData.lineWidth) {
                  obj.userData.lineWidth = objData.lineWidth;
                }
                // Restore drawings save folder
                if (objData.drawingsSaveFolder) {
                  obj.userData.drawingsSaveFolder = objData.drawingsSaveFolder;
                }
                // Update pen body color from mainColor
                if (objData.mainColor) {
                  obj.children.forEach(child => {
                    if (child.isMesh && child.geometry.type === 'CylinderGeometry' && child.position.y > 0.1) {
                      child.material.color.set(objData.mainColor);
                      child.material.needsUpdate = true;
                    }
                  });
                }
                break;
              case 'cassette-player':
              case 'big-cassette-player':
                // Restore music folder and track info (for both mini and big player)
                if (objData.musicFolderPath) {
                  obj.userData.musicFolderPath = objData.musicFolderPath;
                  obj.userData.audioFiles = objData.audioFiles || [];
                  obj.userData.currentTrackIndex = objData.currentTrackIndex || 0;
                  obj.userData.currentTime = objData.currentTime || 0;
                  // Update screen to show current track
                  if (obj.userData.audioFiles.length > 0) {
                    updateCassetteScreen(obj, obj.userData.audioFiles[obj.userData.currentTrackIndex].name);
                  }
                  // Auto-resume playback if it was playing before reload
                  if (objData.wasPlaying && obj.userData.audioFiles.length > 0) {
                    // Delay playback to ensure everything is loaded
                    setTimeout(() => {
                      playCassetteTrack(obj, obj.userData.currentTrackIndex, obj.userData.currentTime);
                    }, 500);
                  }
                }
                // Restore effect settings
                if (objData.volume !== undefined) obj.userData.volume = objData.volume;
                if (objData.tapeHissLevel !== undefined) obj.userData.tapeHissLevel = objData.tapeHissLevel;
                if (objData.wowFlutterLevel !== undefined) obj.userData.wowFlutterLevel = objData.wowFlutterLevel;
                if (objData.saturationLevel !== undefined) obj.userData.saturationLevel = objData.saturationLevel;
                if (objData.lowCutoff !== undefined) obj.userData.lowCutoff = objData.lowCutoff;
                if (objData.highCutoff !== undefined) obj.userData.highCutoff = objData.highCutoff;
                break;
              case 'notebook':
              case 'paper':
                // Restore drawing data
                if (objData.drawingLines && objData.drawingLines.length > 0) {
                  obj.userData.drawingLines = objData.drawingLines;
                  // Redraw all strokes after state is loaded
                  setTimeout(() => {
                    redrawAllStrokes(obj);
                  }, 100);
                }
                if (objData.drawingFileName) {
                  obj.userData.drawingFileName = objData.drawingFileName;
                }
                // Load drawing from file storage if flagged
                if (objData.hasDrawingData) {
                  loadDrawingFromFile(obj);
                }
                break;
              case 'dictaphone':
                // Restore recordings folder path and next recording number
                if (objData.recordingsFolderPath) {
                  obj.userData.recordingsFolderPath = objData.recordingsFolderPath;
                  obj.userData.recordingNumber = objData.recordingNumber || 1;
                }
                // Restore recording format (wav/mp3)
                if (objData.recordingFormat) {
                  obj.userData.recordingFormat = objData.recordingFormat;
                }
                // Restore recording volume (0-200%)
                if (objData.recordingVolume !== undefined) {
                  obj.userData.recordingVolume = objData.recordingVolume;
                }
                // Restore panoramic recording settings
                if (objData.recordMicrophonePanorama !== undefined) {
                  obj.userData.recordMicrophonePanorama = objData.recordMicrophonePanorama;
                }
                if (objData.recordEnvironmentPanorama !== undefined) {
                  obj.userData.recordEnvironmentPanorama = objData.recordEnvironmentPanorama;
                }
                break;
            }

            // Restore per-object collision settings (applies to all object types)
            if (objData.objectCollisionRadiusMultiplier !== undefined) {
              obj.userData.objectCollisionRadiusMultiplier = objData.objectCollisionRadiusMultiplier;
            }
            if (objData.objectCollisionHeightMultiplier !== undefined) {
              obj.userData.objectCollisionHeightMultiplier = objData.objectCollisionHeightMultiplier;
            }
          }
        });

        // Second pass: restore pen holder references
        result.state.objects.forEach((objData, index) => {
          if (objData.type === 'pen' && objData.inHolderIndex !== undefined) {
            const pen = deskObjects[index];
            const holder = deskObjects[objData.inHolderIndex];
            if (pen && holder) {
              pen.userData.inHolder = holder;
              pen.userData.holderSlot = objData.holderSlot;
            }
          }
        });
      } else {
        // Add default objects if no saved objects
        addObjectToDesk('clock', { x: -2, z: -1 });
        addObjectToDesk('lamp', { x: 2, z: -1.2 });
        addObjectToDesk('plant', { x: 2.3, z: 1 });
        addObjectToDesk('coffee', { x: -1.5, z: 0.8 });
      }
    } else {
      // Add default objects if no saved state
      addObjectToDesk('clock', { x: -2, z: -1 });
      addObjectToDesk('lamp', { x: 2, z: -1.2 });
      addObjectToDesk('plant', { x: 2.3, z: 1 });
      addObjectToDesk('coffee', { x: -1.5, z: 0.8 });
    }
  } catch (error) {
    console.error('Failed to load state:', error);
    // Add default objects on error
    addObjectToDesk('clock', { x: -2, z: -1 });
    addObjectToDesk('lamp', { x: 2, z: -1.2 });
  } finally {
    isLoadingState = false; // Re-enable saving
  }
}

// ============================================================================
// ANIMATION LOOP
// ============================================================================
function animate() {
  requestAnimationFrame(animate);

  try {
    // Update physics
    updatePhysics();

    // Update debug collision visualization positions
    updateCollisionDebugPositions();

    // Update camera ray visualization if enabled
    if (debugState.showCameraRay) {
      updateCameraRayHelper();
    }

    // Update spatial audio for all active sound sources
    // This ensures sounds update in real-time as objects move
    updateAllSpatialAudio();
  } catch (error) {
    console.warn('Animation loop physics error:', error);
  }

  // Update object positions (lift/drop animation)
  deskObjects.forEach(obj => {
    try {
    // Handle examine mode animation
    if (obj.userData.examineTarget) {
      const targetPos = obj.userData.examineTarget;
      const speed = 0.12;

      obj.position.x += (targetPos.x - obj.position.x) * speed;
      obj.position.y += (targetPos.y - obj.position.y) * speed;
      obj.position.z += (targetPos.z - obj.position.z) * speed;

      // Scale animation for examine mode
      if (obj.userData.examineScaleTarget !== undefined) {
        const scaleDiff = obj.userData.examineScaleTarget - obj.scale.x;
        if (Math.abs(scaleDiff) > 0.001) {
          const newScale = obj.scale.x + scaleDiff * speed;
          obj.scale.set(newScale, newScale, newScale);
        }
      }

      // Check if animation is complete
      const dist = new THREE.Vector3(
        targetPos.x - obj.position.x,
        targetPos.y - obj.position.y,
        targetPos.z - obj.position.z
      ).length();

      if (dist < 0.01 && !obj.userData.isExamining && obj.userData.isReturning) {
        obj.userData.examineTarget = null;
        obj.userData.examineScaleTarget = undefined;
        obj.userData.isReturning = false;
      }
    }
    // Normal lift/drop animation (only when not examining)
    else if (obj.userData.targetY !== undefined && !obj.userData.isExamining) {
      const diff = obj.userData.targetY - obj.position.y;
      if (Math.abs(diff) > 0.001) {
        const speed = obj.userData.isLifted ? CONFIG.physics.liftSpeed : CONFIG.physics.dropSpeed;
        obj.position.y += diff * speed;
      }
    }

    // Pen animation removed - only procedural physics from collisions

    // Rotate globe
    if (obj.userData.type === 'globe') {
      const globe = obj.getObjectByName('globeSphere');
      const land = obj.getObjectByName('land');
      if (globe) globe.rotation.y += obj.userData.rotationSpeed;
      if (land) land.rotation.y += obj.userData.rotationSpeed;
    }

    // Animate metronome pendulum
    if (obj.userData.type === 'metronome' && obj.userData.isRunning) {
      const pendulum = obj.getObjectByName('pendulum');
      if (pendulum) {
        // Calculate swing timing based on BPM
        // One beat = one swing to the left + one swing to the right, so 2 direction changes per beat
        let bpm = obj.userData.bpm || 120;

        // Apply tempo curve if enabled (using FL Studio-style automation points)
        if (obj.userData.tempoCurveEnabled) {
          const curveStartTime = obj.userData.tempoCurveStartTime || Date.now();
          const elapsed = (Date.now() - curveStartTime) / 1000; // seconds
          const duration = obj.userData.tempoCurveDuration || 60;
          let progress = elapsed / duration;

          // Handle looping
          if (obj.userData.tempoCurveLoop) {
            progress = progress % 1; // Wrap around for looping
          } else {
            progress = Math.min(progress, 1); // Clamp at 1 for non-looping
          }

          // Get BPM from automation curve (supports custom control points)
          bpm = getCurveValueAtProgress(obj, 'tempo', progress);
        }

        const msPerBeat = 60000 / bpm; // Milliseconds per beat
        const msPerSwing = msPerBeat / 2; // Each half-swing (tick) takes half a beat
        const now = Date.now();

        // Initialize last tick time if needed
        if (!obj.userData.lastTickTime) {
          obj.userData.lastTickTime = now;
        }

        const timeSinceLastTick = now - obj.userData.lastTickTime;
        const maxAngle = Math.PI / 6; // ~30 degrees max swing

        // Animate smoothly based on time
        const swingProgress = (timeSinceLastTick % msPerSwing) / msPerSwing;
        const swingAngle = Math.sin(swingProgress * Math.PI) * maxAngle * obj.userData.pendulumDirection;

        // Check if we've completed a half-swing (tick)
        if (timeSinceLastTick >= msPerSwing) {
          obj.userData.lastTickTime = now;
          obj.userData.pendulumDirection *= -1;

          // Play sound at each swing endpoint
          if (obj.userData.tickSound) {
            try {
              const audioCtx = getSharedAudioContext();
              const currentTime = audioCtx.currentTime;
              const volume = obj.userData.volume !== undefined ? obj.userData.volume : 0.5;

              // Calculate pitch multiplier - use pitch curve if enabled
              let pitchMultiplier = (obj.userData.tickPitch || 100) / 100;

              if (obj.userData.pitchCurveEnabled) {
                // Calculate current pitch based on automation curve (FL Studio-style)
                const curveStartTime = obj.userData.pitchCurveStartTime || Date.now();
                const elapsed = (Date.now() - curveStartTime) / 1000; // seconds
                const duration = obj.userData.pitchCurveDuration || 60;
                let progress = elapsed / duration;

                // Handle looping
                if (obj.userData.pitchCurveLoop) {
                  progress = progress % 1; // Wrap around for looping
                } else {
                  progress = Math.min(progress, 1); // Clamp at 1 for non-looping
                }

                // Get pitch from automation curve (supports custom control points)
                // Pitch is stored as percentage (50-200), convert to multiplier
                pitchMultiplier = getCurveValueAtProgress(obj, 'pitch', progress) / 100;
              }

              // Calculate spatial audio parameters for playback (camera-relative)
              const spatial = calculateSpatialAudio(obj);
              const spatialVolume = volume * spatial.volume;

              // Calculate spatial audio for recording (dictaphone-relative) if recording
              let recordingSpatial = { pan: 0, volume: 1 };
              if (dictaphoneState.isRecording &&
                  dictaphoneState.usePanoramicEnvironment &&
                  dictaphoneState.currentRecordingObject) {
                recordingSpatial = calculateSpatialAudio(obj, dictaphoneState.currentRecordingObject);
              }
              const recordingVolume = volume * recordingSpatial.volume;

              if (obj.userData.tickSoundType === 'custom' && obj.userData.customSoundDataUrl) {
                // Play custom sound using HTML5 Audio element with spatial audio
                // We use Web Audio API for spatial panning
                try {
                  const audio = new Audio(obj.userData.customSoundDataUrl);
                  audio.playbackRate = pitchMultiplier; // Pitch adjustment via playback rate

                  // Create media element source for spatial audio processing
                  const source = audioCtx.createMediaElementSource(audio);
                  const panner = audioCtx.createStereoPanner();
                  const gain = audioCtx.createGain();

                  // Playback chain: source -> panner -> gain -> master
                  source.connect(panner);
                  panner.connect(gain);
                  gain.connect(sharedAudioSystem.masterGain);

                  // Connect source to mono recording (no spatial processing)
                  source.connect(sharedAudioSystem.recordingGain);

                  // Recording chain: source -> recordingPanner -> recordingGain -> recordingGainPanorama
                  const recordingPanner = audioCtx.createStereoPanner();
                  const recordingGain = audioCtx.createGain();
                  source.connect(recordingPanner);
                  recordingPanner.connect(recordingGain);
                  recordingGain.connect(sharedAudioSystem.recordingGainPanorama);
                  recordingPanner.pan.value = recordingSpatial.pan;
                  recordingGain.gain.value = recordingVolume;

                  panner.pan.value = spatial.pan;
                  gain.gain.value = spatialVolume;

                  audio.play().catch(err => {
                    console.warn('Failed to play custom metronome sound:', err);
                  });
                } catch (e) {
                  console.warn('Error creating audio element:', e);
                }
              } else if (obj.userData.tickSoundType === 'beep') {
                // Simple beep sound with pitch adjustment and spatial audio
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                const panner = audioCtx.createStereoPanner();

                // Playback chain: osc -> gain -> panner -> master
                osc.connect(gain);
                gain.connect(panner);
                panner.connect(sharedAudioSystem.masterGain);

                // Connect gain to mono recording (no spatial processing)
                gain.connect(sharedAudioSystem.recordingGain);

                // Recording chain: gain -> recordingPanner -> recordingGain -> recordingGainPanorama
                const recordingPanner = audioCtx.createStereoPanner();
                const recordingGain = audioCtx.createGain();
                gain.connect(recordingPanner);
                recordingPanner.connect(recordingGain);
                recordingGain.connect(sharedAudioSystem.recordingGainPanorama);
                recordingPanner.pan.value = recordingSpatial.pan;
                recordingGain.gain.value = recordingSpatial.volume;

                panner.pan.value = spatial.pan;
                osc.frequency.value = 880 * pitchMultiplier; // A5 note with pitch adjustment
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.2 * spatialVolume, currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, currentTime + 0.08);
                osc.start(currentTime);
                osc.stop(currentTime + 0.1);
              } else {
                // Default: Strike/click sound (more percussive/mechanical) with pitch adjustment and spatial audio
                const osc = audioCtx.createOscillator();
                const osc2 = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                const filter = audioCtx.createBiquadFilter();
                const panner = audioCtx.createStereoPanner();

                // Playback chain: filter -> gain -> panner -> master
                osc.connect(filter);
                osc2.connect(filter);
                filter.connect(gain);
                gain.connect(panner);
                panner.connect(sharedAudioSystem.masterGain);

                // Connect gain to mono recording (no spatial processing)
                gain.connect(sharedAudioSystem.recordingGain);

                // Recording chain: gain -> recordingPanner -> recordingGain -> recordingGainPanorama
                const recordingPanner = audioCtx.createStereoPanner();
                const recordingGain = audioCtx.createGain();
                gain.connect(recordingPanner);
                recordingPanner.connect(recordingGain);
                recordingGain.connect(sharedAudioSystem.recordingGainPanorama);
                recordingPanner.pan.value = recordingSpatial.pan;
                recordingGain.gain.value = recordingSpatial.volume;

                panner.pan.value = spatial.pan;

                // Mechanical metronome click sound with pitch adjustment
                // Use lower frequencies for a wooden "click" sound
                osc.frequency.value = 1200 * pitchMultiplier; // Main click frequency
                osc.type = 'sine';
                osc2.frequency.value = 300 * pitchMultiplier; // Low body resonance
                osc2.type = 'sine';

                // Bandpass filter for natural wood resonance (also pitch-adjusted)
                filter.type = 'bandpass';
                filter.frequency.value = 800 * pitchMultiplier;
                filter.Q.value = 2;

                // Very sharp attack, quick exponential decay for percussive "tick"
                // Volume affects the peak gain (with spatial audio attenuation)
                gain.gain.setValueAtTime(0.5 * spatialVolume, currentTime);
                gain.gain.exponentialRampToValueAtTime(0.16 * spatialVolume, currentTime + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.01, currentTime + 0.04);

                osc.start(currentTime);
                osc2.start(currentTime);
                osc.stop(currentTime + 0.05);
                osc2.stop(currentTime + 0.05);
              }
            } catch (e) {}
          }
        }

        pendulum.rotation.z = swingAngle;
        obj.userData.pendulumAngle = swingAngle;
      }
    }

    // Animate cassette player reels when playing (both mini and big player)
    if (obj.userData.type === 'cassette-player' || obj.userData.type === 'big-cassette-player') {
      const reels = obj.getObjectByName('reels');
      if (reels) {
        // Only spin reels when this player is actively playing (per-player audio state)
        if (obj.userData.isPlaying && obj.userData.audioElement && !obj.userData.audioElement.paused) {
          // Rotate both reels (visible through the window)
          obj.userData.reelRotation = (obj.userData.reelRotation || 0) + 0.05;

          // Reels are now wrapped in Groups - rotate the groups around Z axis
          // This works correctly because the cylinder mesh inside is rotated to face user (x = PI/2)
          // and we want the group to spin around its local Z axis (facing the user)
          const leftReel = reels.getObjectByName('leftReel');
          const rightReel = reels.getObjectByName('rightReel');

          if (leftReel) leftReel.rotation.z = obj.userData.reelRotation;
          if (rightReel) rightReel.rotation.z = obj.userData.reelRotation * 1.1; // Slightly different speed

          // Update scrolling text on screen
          if (obj.userData.audioFiles && obj.userData.audioFiles.length > 0) {
            const track = obj.userData.audioFiles[obj.userData.currentTrackIndex];
            if (track) {
              updateCassetteScreen(obj, track.name, true);
            }
          }
        }
      }
    }

    // Animate dictaphone LED when recording (subtle pulsing glow)
    // Also update volume level indicator in the UI
    if (obj.userData.type === 'dictaphone') {
      try {
        if (dictaphoneState.isRecording && dictaphoneState.currentRecorderId === obj.userData.id) {
          const led = obj.getObjectByName('recordingLed');
          const ledLight = obj.getObjectByName('ledLight');

          if (led && ledLight) {
            // Pulsing effect - varies between 0.5 and 1.0
            const pulse = 0.75 + Math.sin(Date.now() * 0.005) * 0.25;

            // Update LED emissive intensity (safely check material properties)
            if (led.material && typeof led.material.emissiveIntensity === 'number') {
              led.material.emissiveIntensity = 0.8 * pulse;
            }

            // Update point light intensity
            if (typeof ledLight.intensity === 'number') {
              ledLight.intensity = 0.3 * pulse;
            }
          }

          // Update volume level indicator in the UI (with volume adjustment)
          const levelBar = document.getElementById('dictaphone-level-bar');
          const levelText = document.getElementById('dictaphone-level-text');
          if (levelBar) {
            // Get the raw audio level (0-100) from the analyser
            const rawLevel = getDictaphoneAudioLevel();
            // Apply volume adjustment to the displayed level
            const volumeMultiplier = (obj.userData.recordingVolume || 100) / 100;
            const adjustedLevel = Math.min(100, rawLevel * volumeMultiplier);
            levelBar.style.width = `${adjustedLevel}%`;

            if (levelText) {
              levelText.textContent = `Recording... ${Math.round(adjustedLevel)}%`;
            }
          }
        } else {
          // Reset level bar when not recording
          const levelBar = document.getElementById('dictaphone-level-bar');
          const levelText = document.getElementById('dictaphone-level-text');
          if (levelBar && levelBar.style.width !== '0%') {
            levelBar.style.width = '0%';
          }
          if (levelText && levelText.textContent !== 'Not recording') {
            levelText.textContent = 'Not recording';
          }
        }
      } catch (error) {
        // Silently ignore animation errors to prevent render loop crash
        console.warn('Dictaphone LED animation error:', error);
      }
    }

    // Animate mug: steam and liquid pouring when tilted
    if (obj.userData.type === 'coffee') {
      // Check if mug is tilted enough to pour liquid
      const tiltAngle = Math.sqrt(obj.rotation.x * obj.rotation.x + obj.rotation.z * obj.rotation.z);
      const pourThreshold = 0.4; // About 23 degrees

      if (tiltAngle > pourThreshold && obj.userData.liquidLevel > 0.05 && !obj.userData.isSipping) {
        // Calculate pour rate based on tilt angle
        const pourRate = Math.min(0.005, (tiltAngle - pourThreshold) * 0.02);
        obj.userData.liquidLevel = Math.max(0, obj.userData.liquidLevel - pourRate);

        // Update liquid visual
        const liquid = obj.getObjectByName('liquid');
        const liquidBody = obj.getObjectByName('liquidBody');
        const level = obj.userData.liquidLevel;
        if (liquid) {
          if (level < 0.05) {
            liquid.visible = false;
          } else {
            liquid.visible = true;
            liquid.position.y = 0.03 + level * 0.14;
          }
        }
        if (liquidBody) {
          if (level < 0.05) {
            liquidBody.visible = false;
          } else {
            liquidBody.visible = true;
            liquidBody.scale.y = Math.max(0.1, level);
            liquidBody.position.y = 0.015 + level * 0.07;
          }
        }

        // Create or update pour effect
        let pourEffect = obj.getObjectByName('pourEffect');
        if (!pourEffect && obj.userData.liquidLevel > 0.05) {
          pourEffect = createPourEffect(obj.userData.drinkType || 'coffee');
          pourEffect.name = 'pourEffect';
          obj.add(pourEffect);
        }
        if (pourEffect) {
          pourEffect.visible = true;
          // Animate pour droplets
          pourEffect.children.forEach((drop, i) => {
            drop.position.y -= 0.03;
            drop.material.opacity -= 0.02;
            if (drop.position.y < -0.5 || drop.material.opacity <= 0) {
              drop.position.y = 0.15;
              drop.material.opacity = 0.8;
            }
          });
        }
      } else {
        // Hide pour effect when not tilted
        const pourEffect = obj.getObjectByName('pourEffect');
        if (pourEffect) pourEffect.visible = false;

        // Add subtle liquid wobble animation when examining or dragging
        if (obj.userData.liquidLevel > 0.05) {
          const liquid = obj.getObjectByName('liquid');
          if (liquid) {
            // Subtle wave effect based on time
            const time = Date.now() * 0.002;
            const wobbleX = Math.sin(time) * 0.02;
            const wobbleZ = Math.cos(time * 0.7) * 0.02;
            // Apply subtle tilt that follows any existing rotation
            liquid.rotation.x = -Math.PI / 2 + wobbleX;
            liquid.rotation.z = wobbleZ;
          }
        }
      }

      // Steam effect for hot mug
      if (obj.userData.isHot && obj.userData.liquidLevel > 0.1 && tiltAngle < pourThreshold) {
        let steam = obj.getObjectByName('steam');
        if (!steam) {
          steam = createSteamEffect();
          steam.name = 'steam';
          obj.add(steam);
        }
        steam.visible = true;

        // Animate steam wisps floating up
        steam.children.forEach((wisp, i) => {
          wisp.position.y += 0.002;
          wisp.material.opacity -= 0.002;

          // Reset when wisp floats too high or fades out
          if (wisp.position.y > 0.4 || wisp.material.opacity <= 0) {
            wisp.position.set(
              (Math.random() - 0.5) * 0.05,
              0.22,
              (Math.random() - 0.5) * 0.05
            );
            wisp.material.opacity = 0.3;
          }
        });
      } else {
        const steam = obj.getObjectByName('steam');
        if (steam) steam.visible = false;
      }
    }

    // Book loading animation - update every 500ms
    if (obj.userData.type === 'books' && obj.userData.isLoadingPdf && obj.userData.isOpen) {
      // Track last update time for animation
      if (!obj.userData.lastLoadingAnimUpdate || Date.now() - obj.userData.lastLoadingAnimUpdate > 500) {
        obj.userData.lastLoadingAnimUpdate = Date.now();
        updateBookPages(obj);
      }
    }

    // Magazine loading animation - update every 500ms
    if (obj.userData.type === 'magazine' && obj.userData.isLoadingPdf && obj.userData.isOpen) {
      // Track last update time for animation
      if (!obj.userData.lastLoadingAnimUpdate || Date.now() - obj.userData.lastLoadingAnimUpdate > 500) {
        obj.userData.lastLoadingAnimUpdate = Date.now();
        updateMagazinePages(obj);
      }
    }
    } catch (objError) {
      // Log error but continue animating other objects
      console.warn('Animation error for object:', obj.userData?.type, objError);
    }
  });

  // Render with pixel art post-processing if enabled
  try {
    if (CONFIG.pixelation.enabled) {
      renderPixelArt();
    } else {
      renderer.render(scene, camera);
    }
  } catch (renderError) {
    console.error('Render error:', renderError);
  }
}

// ============================================================================
// PIXEL ART RENDER PASS
// ============================================================================
function renderPixelArt() {
  try {
    // Validate required objects exist before rendering
    if (!pixelatedMaterial || !pixelatedMaterial.uniforms || !pixelRenderTarget || !normalRenderTarget) {
      // Fall back to regular rendering if pixelation setup is incomplete
      renderer.render(scene, camera);
      return;
    }

    const uniforms = pixelatedMaterial.uniforms;

    // Pass 1: Render scene to low-resolution texture
    renderer.setRenderTarget(pixelRenderTarget);
    renderer.clear();
    renderer.render(scene, camera);

    // Pass 2: Render normals for edge detection
    const overrideMaterial = scene.overrideMaterial;
    renderer.setRenderTarget(normalRenderTarget);
    scene.overrideMaterial = normalMaterial;
    renderer.clear();
    renderer.render(scene, camera);
    scene.overrideMaterial = overrideMaterial;

    // Pass 3: Apply pixelated shader to screen
    uniforms.tDiffuse.value = pixelRenderTarget.texture;
    uniforms.tDepth.value = pixelRenderTarget.depthTexture;
    uniforms.tNormal.value = normalRenderTarget.texture;

    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(fsQuad, fsCamera);
  } catch (error) {
    console.warn('renderPixelArt error, falling back to standard render:', error);
    // Reset render target to default and do a simple render to avoid gray screen
    try {
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(scene, camera);
    } catch (fallbackError) {
      console.error('Fallback render also failed:', fallbackError);
    }
  }
}

// ============================================================================
// START APPLICATION
// ============================================================================
init();
