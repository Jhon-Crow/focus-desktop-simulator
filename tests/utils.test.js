// Tests for utility functions

const {
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
} = require('../src/utils');

describe('Audio Constants', () => {
  test('AUDIO_EXTENSIONS contains expected formats', () => {
    expect(AUDIO_EXTENSIONS).toContain('.mp3');
    expect(AUDIO_EXTENSIONS).toContain('.wav');
    expect(AUDIO_EXTENSIONS).toContain('.ogg');
    expect(AUDIO_EXTENSIONS).toContain('.flac');
    expect(AUDIO_EXTENSIONS).toContain('.aac');
    expect(AUDIO_EXTENSIONS).toContain('.m4a');
    expect(AUDIO_EXTENSIONS).toContain('.webm');
    expect(AUDIO_EXTENSIONS).toContain('.opus');
    expect(AUDIO_EXTENSIONS.length).toBe(8);
  });

  test('UNSUPPORTED_AUDIO_FORMATS contains expected formats', () => {
    expect(UNSUPPORTED_AUDIO_FORMATS).toContain('wma');
    expect(UNSUPPORTED_AUDIO_FORMATS).toContain('mid');
    expect(UNSUPPORTED_AUDIO_FORMATS).toContain('midi');
  });

  test('SUPPORTED_AUDIO_FORMATS matches AUDIO_EXTENSIONS', () => {
    SUPPORTED_AUDIO_FORMATS.forEach(format => {
      expect(AUDIO_EXTENSIONS).toContain('.' + format);
    });
  });

  test('MIME_TYPES has correct mappings', () => {
    expect(MIME_TYPES['mp3']).toBe('audio/mpeg');
    expect(MIME_TYPES['wav']).toBe('audio/wav');
    expect(MIME_TYPES['ogg']).toBe('audio/ogg');
    expect(MIME_TYPES['flac']).toBe('audio/flac');
    expect(MIME_TYPES['aac']).toBe('audio/aac');
    expect(MIME_TYPES['m4a']).toBe('audio/mp4');
    expect(MIME_TYPES['webm']).toBe('audio/webm');
    expect(MIME_TYPES['opus']).toBe('audio/opus');
  });
});

describe('getMimeType', () => {
  test('returns correct MIME type for known extensions', () => {
    expect(getMimeType('mp3')).toBe('audio/mpeg');
    expect(getMimeType('.mp3')).toBe('audio/mpeg');
    expect(getMimeType('WAV')).toBe('audio/wav');
    expect(getMimeType('.OGG')).toBe('audio/ogg');
    expect(getMimeType('flac')).toBe('audio/flac');
    expect(getMimeType('m4a')).toBe('audio/mp4');
  });

  test('returns default MIME type for unknown extensions', () => {
    expect(getMimeType('xyz')).toBe('audio/mpeg');
    expect(getMimeType('')).toBe('audio/mpeg');
    expect(getMimeType('.unknown')).toBe('audio/mpeg');
  });
});

describe('isSupportedAudioFormat', () => {
  test('returns true for supported formats', () => {
    expect(isSupportedAudioFormat('mp3')).toBe(true);
    expect(isSupportedAudioFormat('.wav')).toBe(true);
    expect(isSupportedAudioFormat('OGG')).toBe(true);
    expect(isSupportedAudioFormat('.FLAC')).toBe(true);
  });

  test('returns false for unsupported formats', () => {
    expect(isSupportedAudioFormat('wma')).toBe(false);
    expect(isSupportedAudioFormat('.mid')).toBe(false);
    expect(isSupportedAudioFormat('xyz')).toBe(false);
  });
});

describe('isUnsupportedAudioFormat', () => {
  test('returns true for unsupported formats', () => {
    expect(isUnsupportedAudioFormat('wma')).toBe(true);
    expect(isUnsupportedAudioFormat('.mid')).toBe(true);
    expect(isUnsupportedAudioFormat('MIDI')).toBe(true);
    expect(isUnsupportedAudioFormat('ape')).toBe(true);
  });

  test('returns false for supported formats', () => {
    expect(isUnsupportedAudioFormat('mp3')).toBe(false);
    expect(isUnsupportedAudioFormat('.wav')).toBe(false);
  });
});

describe('isAudioFile', () => {
  test('returns true for audio files', () => {
    expect(isAudioFile('mp3')).toBe(true);
    expect(isAudioFile('.wav')).toBe(true);
    expect(isAudioFile('OGG')).toBe(true);
    expect(isAudioFile('flac')).toBe(true);
  });

  test('returns false for non-audio files', () => {
    expect(isAudioFile('txt')).toBe(false);
    expect(isAudioFile('.pdf')).toBe(false);
    expect(isAudioFile('jpg')).toBe(false);
  });
});

describe('arrayBufferToBase64 and base64ToArrayBuffer', () => {
  test('converts ArrayBuffer to base64 and back', () => {
    const originalData = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const buffer = originalData.buffer;

    const base64 = arrayBufferToBase64(buffer);
    expect(typeof base64).toBe('string');
    expect(base64).toBe('SGVsbG8=');

    const convertedBack = base64ToArrayBuffer(base64);
    const result = new Uint8Array(convertedBack);
    expect(result).toEqual(originalData);
  });

  test('handles empty buffer', () => {
    const buffer = new ArrayBuffer(0);
    const base64 = arrayBufferToBase64(buffer);
    expect(base64).toBe('');

    const convertedBack = base64ToArrayBuffer('');
    expect(convertedBack.byteLength).toBe(0);
  });

  test('handles binary data', () => {
    const binaryData = new Uint8Array([0, 128, 255, 1, 127]);
    const buffer = binaryData.buffer;

    const base64 = arrayBufferToBase64(buffer);
    const convertedBack = base64ToArrayBuffer(base64);
    const result = new Uint8Array(convertedBack);

    expect(result).toEqual(binaryData);
  });
});

describe('arrayBufferToDataUrl', () => {
  test('creates correct data URL with default MIME type', () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]);
    const dataUrl = arrayBufferToDataUrl(data.buffer);

    expect(dataUrl).toMatch(/^data:audio\/wav;base64,/);
    expect(dataUrl).toContain('SGVsbG8=');
  });

  test('creates correct data URL with custom MIME type', () => {
    const data = new Uint8Array([1, 2, 3]);
    const dataUrl = arrayBufferToDataUrl(data.buffer, 'audio/mpeg');

    expect(dataUrl).toMatch(/^data:audio\/mpeg;base64,/);
  });
});

describe('parseRecordingNumber', () => {
  test('parses valid recording filenames', () => {
    expect(parseRecordingNumber('Запись 1.wav')).toBe(1);
    expect(parseRecordingNumber('Запись 42.mp3')).toBe(42);
    expect(parseRecordingNumber('Запись 100.webm')).toBe(100);
    expect(parseRecordingNumber('Запись 999.wav')).toBe(999);
  });

  test('returns null for invalid filenames', () => {
    expect(parseRecordingNumber('recording.wav')).toBeNull();
    expect(parseRecordingNumber('Запись.wav')).toBeNull();
    expect(parseRecordingNumber('Запись 1.txt')).toBeNull();
    expect(parseRecordingNumber('Запись abc.wav')).toBeNull();
    expect(parseRecordingNumber('')).toBeNull();
    expect(parseRecordingNumber('random file.wav')).toBeNull();
  });
});

describe('getNextRecordingNumber', () => {
  test('returns 1 for empty array', () => {
    expect(getNextRecordingNumber([])).toBe(1);
  });

  test('returns next number after highest existing', () => {
    const filenames = ['Запись 1.wav', 'Запись 3.wav', 'Запись 2.wav'];
    expect(getNextRecordingNumber(filenames)).toBe(4);
  });

  test('ignores non-matching filenames', () => {
    const filenames = ['Запись 5.wav', 'other.txt', 'file.mp3', 'Запись 2.mp3'];
    expect(getNextRecordingNumber(filenames)).toBe(6);
  });

  test('handles mixed formats', () => {
    const filenames = ['Запись 1.wav', 'Запись 2.mp3', 'Запись 3.webm'];
    expect(getNextRecordingNumber(filenames)).toBe(4);
  });
});

describe('calculateCameraAnglesFromLookAt', () => {
  test('calculates angles for looking along positive Z', () => {
    const camera = { x: 0, y: 0, z: 0 };
    const lookAt = { x: 0, y: 0, z: 10 };
    const { yaw, pitch } = calculateCameraAnglesFromLookAt(camera, lookAt);

    expect(yaw).toBeCloseTo(0);
    expect(pitch).toBeCloseTo(0);
  });

  test('calculates angles for looking along positive X', () => {
    const camera = { x: 0, y: 0, z: 0 };
    const lookAt = { x: 10, y: 0, z: 0 };
    const { yaw, pitch } = calculateCameraAnglesFromLookAt(camera, lookAt);

    expect(yaw).toBeCloseTo(Math.PI / 2);
    expect(pitch).toBeCloseTo(0);
  });

  test('calculates angles for looking up', () => {
    const camera = { x: 0, y: 0, z: 0 };
    const lookAt = { x: 0, y: 10, z: 0 };
    const { yaw, pitch } = calculateCameraAnglesFromLookAt(camera, lookAt);

    expect(pitch).toBeCloseTo(Math.PI / 2);
  });

  test('calculates angles for diagonal look', () => {
    const camera = { x: 0, y: 0, z: 0 };
    const lookAt = { x: 1, y: 1, z: 1 };
    const { yaw, pitch } = calculateCameraAnglesFromLookAt(camera, lookAt);

    expect(yaw).toBeCloseTo(Math.PI / 4); // 45 degrees
    const expectedPitch = Math.asin(1 / Math.sqrt(3));
    expect(pitch).toBeCloseTo(expectedPitch);
  });
});

describe('clamp', () => {
  test('clamps values below minimum', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(-100, -50, 50)).toBe(-50);
  });

  test('clamps values above maximum', () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(100, -50, 50)).toBe(50);
  });

  test('keeps values within range unchanged', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe('lerp', () => {
  test('returns start value at t=0', () => {
    expect(lerp(0, 100, 0)).toBe(0);
    expect(lerp(-10, 10, 0)).toBe(-10);
  });

  test('returns end value at t=1', () => {
    expect(lerp(0, 100, 1)).toBe(100);
    expect(lerp(-10, 10, 1)).toBe(10);
  });

  test('returns midpoint at t=0.5', () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });

  test('interpolates correctly for other values', () => {
    expect(lerp(0, 100, 0.25)).toBe(25);
    expect(lerp(0, 100, 0.75)).toBe(75);
  });

  test('handles extrapolation', () => {
    expect(lerp(0, 100, 2)).toBe(200);
    expect(lerp(0, 100, -1)).toBe(-100);
  });
});

describe('smoothstep', () => {
  test('returns 0 at t=0', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(0, 0.5)).toBe(0);
  });

  test('returns 1 at t=1', () => {
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(1, 0.5)).toBe(1);
  });

  test('returns approximately 0.5 at t=0.5', () => {
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 5);
    expect(smoothstep(0.5, 0.5)).toBeCloseTo(0.5, 5);
  });

  test('produces smooth curve', () => {
    const t1 = smoothstep(0.25);
    const t2 = smoothstep(0.5);
    const t3 = smoothstep(0.75);

    // Should be monotonically increasing
    expect(t1).toBeLessThan(t2);
    expect(t2).toBeLessThan(t3);

    // Should be symmetric around 0.5
    expect(t1 + smoothstep(0.75)).toBeCloseTo(1, 5);
  });
});

describe('interpolateCurveValue', () => {
  test('linear interpolation works correctly', () => {
    expect(interpolateCurveValue(0, 100, 0, 'linear')).toBe(0);
    expect(interpolateCurveValue(0, 100, 0.5, 'linear')).toBe(50);
    expect(interpolateCurveValue(0, 100, 1, 'linear')).toBe(100);
  });

  test('step interpolation works correctly', () => {
    expect(interpolateCurveValue(0, 100, 0.49, 'step')).toBe(0);
    expect(interpolateCurveValue(0, 100, 0.5, 'step')).toBe(100);
    expect(interpolateCurveValue(0, 100, 0.51, 'step')).toBe(100);
  });

  test('smooth interpolation works correctly', () => {
    const result = interpolateCurveValue(0, 100, 0.5, 'smooth');
    expect(result).toBeCloseTo(50, 1);

    const start = interpolateCurveValue(0, 100, 0, 'smooth');
    const end = interpolateCurveValue(0, 100, 1, 'smooth');
    expect(start).toBe(0);
    expect(end).toBe(100);
  });

  test('sine interpolation works correctly', () => {
    const mid = interpolateCurveValue(0, 100, 0.5, 'sine');
    expect(mid).toBeCloseTo(50, 1);

    const start = interpolateCurveValue(0, 100, 0, 'sine');
    const end = interpolateCurveValue(0, 100, 1, 'sine');
    expect(start).toBe(0);
    expect(end).toBe(100);
  });

  test('unknown curve type defaults to linear', () => {
    expect(interpolateCurveValue(0, 100, 0.5, 'unknown')).toBe(50);
  });
});

describe('formatTimestamp', () => {
  test('formats date as ISO string', () => {
    const date = new Date('2024-01-15T10:30:00.000Z');
    const result = formatTimestamp(date);
    expect(result).toBe('2024-01-15T10:30:00.000Z');
  });

  test('uses current date when no argument provided', () => {
    const before = new Date();
    const result = formatTimestamp();
    const after = new Date();

    const resultDate = new Date(result);
    expect(resultDate.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(resultDate.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

describe('formatElapsedTime', () => {
  test('formats elapsed time correctly', () => {
    const startTime = 1000;
    const currentTime = 3500;
    const result = formatElapsedTime(startTime, currentTime);
    expect(result).toBe('2.50s');
  });

  test('handles zero elapsed time', () => {
    const result = formatElapsedTime(1000, 1000);
    expect(result).toBe('0.00s');
  });

  test('handles fractional seconds', () => {
    const result = formatElapsedTime(0, 1234);
    expect(result).toBe('1.23s');
  });
});

describe('validateModelData', () => {
  test('returns valid for complete model data', () => {
    const modelData = { id: 'test-model', name: 'Test Model' };
    const result = validateModelData(modelData);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('returns error for missing model data', () => {
    const result = validateModelData(null);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Model data is required');
  });

  test('returns error for missing id', () => {
    const modelData = { name: 'Test Model' };
    const result = validateModelData(modelData);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Model must have an "id" field');
  });

  test('returns error for missing name', () => {
    const modelData = { id: 'test-model' };
    const result = validateModelData(modelData);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Model must have a "name" field');
  });
});

describe('validateManifest', () => {
  test('returns valid for complete manifest', () => {
    const manifest = { id: 'test-program', name: 'Test Program' };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('returns error for missing manifest', () => {
    const result = validateManifest(null);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Manifest is required');
  });

  test('returns error for missing id', () => {
    const manifest = { name: 'Test Program' };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Manifest must have an "id" field');
  });

  test('returns error for missing name', () => {
    const manifest = { id: 'test-program' };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Manifest must have a "name" field');
  });
});

describe('createWavHeader', () => {
  test('creates valid WAV header', () => {
    const header = createWavHeader(2, 44100, 44100, 16);

    expect(header.byteLength).toBe(44);

    // Check RIFF header
    expect(String.fromCharCode(header.getUint8(0))).toBe('R');
    expect(String.fromCharCode(header.getUint8(1))).toBe('I');
    expect(String.fromCharCode(header.getUint8(2))).toBe('F');
    expect(String.fromCharCode(header.getUint8(3))).toBe('F');

    // Check WAVE format
    expect(String.fromCharCode(header.getUint8(8))).toBe('W');
    expect(String.fromCharCode(header.getUint8(9))).toBe('A');
    expect(String.fromCharCode(header.getUint8(10))).toBe('V');
    expect(String.fromCharCode(header.getUint8(11))).toBe('E');

    // Check format chunk
    expect(String.fromCharCode(header.getUint8(12))).toBe('f');
    expect(String.fromCharCode(header.getUint8(13))).toBe('m');
    expect(String.fromCharCode(header.getUint8(14))).toBe('t');
    expect(String.fromCharCode(header.getUint8(15))).toBe(' ');

    // Check data chunk
    expect(String.fromCharCode(header.getUint8(36))).toBe('d');
    expect(String.fromCharCode(header.getUint8(37))).toBe('a');
    expect(String.fromCharCode(header.getUint8(38))).toBe('t');
    expect(String.fromCharCode(header.getUint8(39))).toBe('a');

    // Check format values
    expect(header.getUint16(20, true)).toBe(1); // PCM format
    expect(header.getUint16(22, true)).toBe(2); // numChannels
    expect(header.getUint32(24, true)).toBe(44100); // sampleRate
    expect(header.getUint16(34, true)).toBe(16); // bitsPerSample
  });

  test('creates correct header for mono audio', () => {
    const header = createWavHeader(1, 22050, 22050, 16);

    expect(header.getUint16(22, true)).toBe(1); // numChannels
    expect(header.getUint32(24, true)).toBe(22050); // sampleRate
    expect(header.getUint16(32, true)).toBe(2); // blockAlign (1 channel * 2 bytes)
  });

  test('creates correct header for different sample rates', () => {
    const header = createWavHeader(2, 48000, 48000, 16);

    expect(header.getUint32(24, true)).toBe(48000); // sampleRate
  });
});
