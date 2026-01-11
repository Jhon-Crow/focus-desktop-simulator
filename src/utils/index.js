// Utility functions extracted from the main codebase for testing and reuse

/**
 * Supported audio extensions for the cassette player
 */
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.webm', '.opus'];

/**
 * List of audio formats NOT supported by Chromium/Electron's Web Audio API
 */
const UNSUPPORTED_AUDIO_FORMATS = ['wma', 'wv', 'ape', 'ra', 'ram', 'mid', 'midi', 'amr', 'mka'];

/**
 * List of audio formats that are known to work well with Web Audio API
 */
const SUPPORTED_AUDIO_FORMATS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'webm', 'opus'];

/**
 * Map file extension to MIME type
 */
const MIME_TYPES = {
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'ogg': 'audio/ogg',
  'flac': 'audio/flac',
  'aac': 'audio/aac',
  'm4a': 'audio/mp4',
  'webm': 'audio/webm',
  'opus': 'audio/opus'
};

/**
 * Get MIME type from file extension
 * @param {string} extension - File extension (with or without dot)
 * @returns {string} MIME type
 */
function getMimeType(extension) {
  const ext = extension.replace(/^\./, '').toLowerCase();
  return MIME_TYPES[ext] || 'audio/mpeg';
}

/**
 * Check if a file extension is a supported audio format
 * @param {string} extension - File extension (with or without dot)
 * @returns {boolean} True if supported
 */
function isSupportedAudioFormat(extension) {
  const ext = extension.replace(/^\./, '').toLowerCase();
  return SUPPORTED_AUDIO_FORMATS.includes(ext);
}

/**
 * Check if a file extension is an unsupported audio format
 * @param {string} extension - File extension (with or without dot)
 * @returns {boolean} True if unsupported
 */
function isUnsupportedAudioFormat(extension) {
  const ext = extension.replace(/^\./, '').toLowerCase();
  return UNSUPPORTED_AUDIO_FORMATS.includes(ext);
}

/**
 * Check if a file extension is a valid audio file
 * @param {string} extension - File extension (with or without dot)
 * @returns {boolean} True if valid audio
 */
function isAudioFile(extension) {
  const ext = extension.replace(/^\./, '').toLowerCase();
  return AUDIO_EXTENSIONS.includes('.' + ext);
}

/**
 * Convert ArrayBuffer to base64 string
 * @param {ArrayBuffer} buffer - The buffer to convert
 * @returns {string} Base64 string
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}

/**
 * Convert base64 string to ArrayBuffer
 * @param {string} base64 - Base64 string
 * @returns {ArrayBuffer} Converted buffer
 */
function base64ToArrayBuffer(base64) {
  const binary = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Convert ArrayBuffer to data URL
 * @param {ArrayBuffer} arrayBuffer - The data
 * @param {string} mimeType - MIME type for the data URL
 * @returns {string} Data URL
 */
function arrayBufferToDataUrl(arrayBuffer, mimeType = 'audio/wav') {
  const base64 = arrayBufferToBase64(arrayBuffer);
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Parse recording filename to extract the recording number
 * Pattern: "Запись {number}.{ext}"
 * @param {string} filename - The filename to parse
 * @returns {number|null} The recording number or null if not matching
 */
function parseRecordingNumber(filename) {
  const match = filename.match(/^Запись (\d+)\.(wav|mp3|webm)$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Get the next recording number from a list of filenames
 * @param {string[]} filenames - Array of filenames
 * @returns {number} The next available recording number
 */
function getNextRecordingNumber(filenames) {
  let maxNumber = 0;
  for (const filename of filenames) {
    const num = parseRecordingNumber(filename);
    if (num !== null && num > maxNumber) {
      maxNumber = num;
    }
  }
  return maxNumber + 1;
}

/**
 * Calculate camera angles from look-at position
 * @param {Object} cameraPos - Camera position {x, y, z}
 * @param {Object} lookAtPos - Look-at position {x, y, z}
 * @returns {Object} Object containing {yaw, pitch} in radians
 */
function calculateCameraAnglesFromLookAt(cameraPos, lookAtPos) {
  const dx = lookAtPos.x - cameraPos.x;
  const dy = lookAtPos.y - cameraPos.y;
  const dz = lookAtPos.z - cameraPos.z;

  const totalLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.asin(dy / totalLen);

  return { yaw, pitch };
}

/**
 * Clamp a value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation between two values
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Smoothstep function with tension control
 * @param {number} t - Value to smooth (0-1)
 * @param {number} tension - Tension factor (0-1)
 * @returns {number} Smoothed value
 */
function smoothstep(t, tension = 0.5) {
  const power = 1 + tension * 3;
  if (t < 0.5) {
    return Math.pow(2 * t, power) / 2;
  } else {
    return 1 - Math.pow(2 * (1 - t), power) / 2;
  }
}

/**
 * Interpolate between two values based on curve type
 * @param {number} v1 - Start value
 * @param {number} v2 - End value
 * @param {number} t - Interpolation factor (0-1)
 * @param {string} curveType - Type of curve: 'linear', 'step', 'smooth', 'sine'
 * @param {number} tension - Tension for smooth curves (0-1)
 * @returns {number} Interpolated value
 */
function interpolateCurveValue(v1, v2, t, curveType = 'linear', tension = 0.5) {
  switch (curveType) {
    case 'linear':
      return v1 + (v2 - v1) * t;

    case 'step':
      return t < 0.5 ? v1 : v2;

    case 'smooth':
      const smoothT = smoothstep(t, tension);
      return v1 + (v2 - v1) * smoothT;

    case 'sine':
      const sineT = (1 - Math.cos(t * Math.PI)) / 2;
      return v1 + (v2 - v1) * sineT;

    default:
      return v1 + (v2 - v1) * t;
  }
}

/**
 * Format timestamp for logging
 * @param {Date} date - Date to format (defaults to now)
 * @returns {string} ISO formatted timestamp
 */
function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

/**
 * Format elapsed time in seconds
 * @param {number} startTime - Start time in milliseconds
 * @param {number} currentTime - Current time in milliseconds (defaults to now)
 * @returns {string} Formatted elapsed time with 's' suffix
 */
function formatElapsedTime(startTime, currentTime = Date.now()) {
  const elapsed = (currentTime - startTime) / 1000;
  return `${elapsed.toFixed(2)}s`;
}

/**
 * Validate model data structure
 * @param {Object} modelData - Model data to validate
 * @returns {Object} Validation result {valid: boolean, error?: string}
 */
function validateModelData(modelData) {
  if (!modelData) {
    return { valid: false, error: 'Model data is required' };
  }
  if (!modelData.id) {
    return { valid: false, error: 'Model must have an "id" field' };
  }
  if (!modelData.name) {
    return { valid: false, error: 'Model must have a "name" field' };
  }
  return { valid: true };
}

/**
 * Validate manifest data structure for programs
 * @param {Object} manifest - Manifest data to validate
 * @returns {Object} Validation result {valid: boolean, error?: string}
 */
function validateManifest(manifest) {
  if (!manifest) {
    return { valid: false, error: 'Manifest is required' };
  }
  if (!manifest.id) {
    return { valid: false, error: 'Manifest must have an "id" field' };
  }
  if (!manifest.name) {
    return { valid: false, error: 'Manifest must have a "name" field' };
  }
  return { valid: true };
}

/**
 * Encode an AudioBuffer to WAV format header (creates WAV header only)
 * @param {number} numChannels - Number of channels (1 or 2)
 * @param {number} sampleRate - Sample rate in Hz
 * @param {number} numSamples - Number of samples
 * @param {number} bitsPerSample - Bits per sample (usually 16)
 * @returns {DataView} WAV header as DataView
 */
function createWavHeader(numChannels, sampleRate, numSamples, bitsPerSample = 16) {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numSamples * blockAlign;
  const fileSize = 44 + dataSize;

  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  return view;
}

module.exports = {
  AUDIO_EXTENSIONS,
  UNSUPPORTED_AUDIO_FORMATS,
  SUPPORTED_AUDIO_FORMATS,
  MIME_TYPES,
  getMimeType,
  isSupportedAudioFormat,
  isUnsupportedAudioFormat,
  isAudioFile,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  arrayBufferToDataUrl,
  parseRecordingNumber,
  getNextRecordingNumber,
  calculateCameraAnglesFromLookAt,
  clamp,
  lerp,
  smoothstep,
  interpolateCurveValue,
  formatTimestamp,
  formatElapsedTime,
  validateModelData,
  validateManifest,
  createWavHeader
};
