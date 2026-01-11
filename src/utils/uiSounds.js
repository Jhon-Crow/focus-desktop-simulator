// UI Sound utilities for the Focus Desktop Simulator

/**
 * Sound effect types
 */
const SOUND_TYPES = {
  CLICK: 'click',
  HOVER: 'hover',
  DRAG_START: 'drag_start',
  DRAG_END: 'drag_end',
  CARD_FLIP: 'card_flip',
  SUCCESS: 'success',
  ERROR: 'error',
  NOTIFICATION: 'notification',
  TOGGLE: 'toggle'
};

/**
 * Default volume levels for different sound types
 */
const DEFAULT_VOLUMES = {
  [SOUND_TYPES.CLICK]: 0.3,
  [SOUND_TYPES.HOVER]: 0.1,
  [SOUND_TYPES.DRAG_START]: 0.2,
  [SOUND_TYPES.DRAG_END]: 0.25,
  [SOUND_TYPES.CARD_FLIP]: 0.4,
  [SOUND_TYPES.SUCCESS]: 0.5,
  [SOUND_TYPES.ERROR]: 0.5,
  [SOUND_TYPES.NOTIFICATION]: 0.4,
  [SOUND_TYPES.TOGGLE]: 0.2
};

/**
 * Sound parameters for generating synthesized sounds
 */
const SOUND_PARAMS = {
  [SOUND_TYPES.CLICK]: {
    frequency: 800,
    duration: 0.05,
    type: 'sine',
    attack: 0.001,
    decay: 0.05
  },
  [SOUND_TYPES.HOVER]: {
    frequency: 600,
    duration: 0.03,
    type: 'sine',
    attack: 0.001,
    decay: 0.03
  },
  [SOUND_TYPES.DRAG_START]: {
    frequency: 400,
    duration: 0.1,
    type: 'triangle',
    attack: 0.01,
    decay: 0.1
  },
  [SOUND_TYPES.DRAG_END]: {
    frequency: 500,
    duration: 0.08,
    type: 'triangle',
    attack: 0.005,
    decay: 0.08
  },
  [SOUND_TYPES.CARD_FLIP]: {
    frequency: 300,
    endFrequency: 600,
    duration: 0.15,
    type: 'sawtooth',
    attack: 0.01,
    decay: 0.15
  },
  [SOUND_TYPES.SUCCESS]: {
    frequency: 523,
    endFrequency: 784,
    duration: 0.3,
    type: 'sine',
    attack: 0.01,
    decay: 0.3
  },
  [SOUND_TYPES.ERROR]: {
    frequency: 200,
    duration: 0.4,
    type: 'square',
    attack: 0.01,
    decay: 0.4
  },
  [SOUND_TYPES.NOTIFICATION]: {
    frequency: 880,
    duration: 0.2,
    type: 'sine',
    attack: 0.01,
    decay: 0.2
  },
  [SOUND_TYPES.TOGGLE]: {
    frequency: 700,
    duration: 0.06,
    type: 'sine',
    attack: 0.001,
    decay: 0.06
  }
};

/**
 * Get volume for a sound type
 * @param {string} soundType - Sound type from SOUND_TYPES
 * @param {number} masterVolume - Master volume multiplier (0.0 to 1.0)
 * @returns {number} Calculated volume
 */
function getSoundVolume(soundType, masterVolume = 1.0) {
  const defaultVolume = DEFAULT_VOLUMES[soundType] || 0.3;
  return Math.max(0, Math.min(1, defaultVolume * masterVolume));
}

/**
 * Get sound parameters for a sound type
 * @param {string} soundType - Sound type from SOUND_TYPES
 * @returns {Object|null} Sound parameters or null if not found
 */
function getSoundParams(soundType) {
  return SOUND_PARAMS[soundType] || null;
}

/**
 * Calculate envelope value at time t
 * @param {number} t - Time in seconds
 * @param {number} attack - Attack time in seconds
 * @param {number} decay - Decay time in seconds
 * @param {number} duration - Total duration in seconds
 * @returns {number} Envelope value (0.0 to 1.0)
 */
function calculateEnvelope(t, attack, decay, duration) {
  if (t < 0 || t > duration) return 0;

  if (t < attack) {
    // Attack phase - linear ramp up
    return t / attack;
  } else {
    // Decay phase - exponential decay
    const decayStart = attack;
    const decayTime = t - decayStart;
    const decayDuration = duration - attack;
    return Math.exp(-3 * decayTime / decayDuration);
  }
}

/**
 * Calculate frequency at time t (for frequency sweep)
 * @param {number} t - Time in seconds
 * @param {number} startFreq - Start frequency in Hz
 * @param {number} endFreq - End frequency in Hz
 * @param {number} duration - Total duration in seconds
 * @returns {number} Frequency at time t
 */
function calculateFrequency(t, startFreq, endFreq, duration) {
  if (duration <= 0) return startFreq;
  const progress = Math.min(1, Math.max(0, t / duration));
  return startFreq + (endFreq - startFreq) * progress;
}

/**
 * Generate audio samples for a UI sound effect
 * @param {Object} params - Sound parameters
 * @param {number} sampleRate - Sample rate in Hz
 * @returns {Float32Array} Generated samples
 */
function generateSoundSamples(params, sampleRate = 44100) {
  const {
    frequency,
    endFrequency = frequency,
    duration,
    type = 'sine',
    attack = 0.01,
    decay = duration
  } = params;

  const numSamples = Math.round(duration * sampleRate);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const freq = calculateFrequency(t, frequency, endFrequency, duration);
    const envelope = calculateEnvelope(t, attack, decay, duration);
    const phase = 2 * Math.PI * freq * t;

    let sample;
    switch (type) {
      case 'sine':
        sample = Math.sin(phase);
        break;
      case 'square':
        sample = Math.sin(phase) >= 0 ? 1 : -1;
        break;
      case 'sawtooth':
        sample = 2 * ((freq * t) % 1) - 1;
        break;
      case 'triangle':
        sample = 2 * Math.abs(2 * ((freq * t) % 1) - 1) - 1;
        break;
      default:
        sample = Math.sin(phase);
    }

    samples[i] = sample * envelope;
  }

  return samples;
}

/**
 * Apply a simple low-pass filter to samples
 * @param {Float32Array} samples - Input samples
 * @param {number} cutoff - Cutoff frequency ratio (0.0 to 1.0)
 * @returns {Float32Array} Filtered samples
 */
function applyLowPassFilter(samples, cutoff = 0.5) {
  const alpha = cutoff;
  const filtered = new Float32Array(samples.length);

  filtered[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    filtered[i] = filtered[i - 1] + alpha * (samples[i] - filtered[i - 1]);
  }

  return filtered;
}

/**
 * Create a click sound effect
 * @param {number} sampleRate - Sample rate
 * @returns {Float32Array} Audio samples
 */
function createClickSound(sampleRate = 44100) {
  const params = getSoundParams(SOUND_TYPES.CLICK);
  return generateSoundSamples(params, sampleRate);
}

/**
 * Create a card flip sound effect
 * @param {number} sampleRate - Sample rate
 * @returns {Float32Array} Audio samples
 */
function createCardFlipSound(sampleRate = 44100) {
  const params = getSoundParams(SOUND_TYPES.CARD_FLIP);
  return generateSoundSamples(params, sampleRate);
}

/**
 * Create a success sound effect
 * @param {number} sampleRate - Sample rate
 * @returns {Float32Array} Audio samples
 */
function createSuccessSound(sampleRate = 44100) {
  const params = getSoundParams(SOUND_TYPES.SUCCESS);
  return generateSoundSamples(params, sampleRate);
}

/**
 * Create an error sound effect
 * @param {number} sampleRate - Sample rate
 * @returns {Float32Array} Audio samples
 */
function createErrorSound(sampleRate = 44100) {
  const params = getSoundParams(SOUND_TYPES.ERROR);
  const samples = generateSoundSamples(params, sampleRate);
  return applyLowPassFilter(samples, 0.3); // Make it sound duller
}

/**
 * Validate sound type
 * @param {string} soundType - Sound type to validate
 * @returns {boolean} True if valid
 */
function isValidSoundType(soundType) {
  return Object.values(SOUND_TYPES).includes(soundType);
}

/**
 * Get all available sound types
 * @returns {string[]} Array of sound type strings
 */
function getAvailableSoundTypes() {
  return Object.values(SOUND_TYPES);
}

module.exports = {
  SOUND_TYPES,
  DEFAULT_VOLUMES,
  SOUND_PARAMS,
  getSoundVolume,
  getSoundParams,
  calculateEnvelope,
  calculateFrequency,
  generateSoundSamples,
  applyLowPassFilter,
  createClickSound,
  createCardFlipSound,
  createSuccessSound,
  createErrorSound,
  isValidSoundType,
  getAvailableSoundTypes
};
