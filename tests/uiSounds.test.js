// Tests for UI sound utilities

const {
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
} = require('../src/utils/uiSounds');

describe('UI Sound Utilities', () => {
  describe('Constants', () => {
    test('SOUND_TYPES has all expected types', () => {
      expect(SOUND_TYPES.CLICK).toBe('click');
      expect(SOUND_TYPES.HOVER).toBe('hover');
      expect(SOUND_TYPES.DRAG_START).toBe('drag_start');
      expect(SOUND_TYPES.DRAG_END).toBe('drag_end');
      expect(SOUND_TYPES.CARD_FLIP).toBe('card_flip');
      expect(SOUND_TYPES.SUCCESS).toBe('success');
      expect(SOUND_TYPES.ERROR).toBe('error');
      expect(SOUND_TYPES.NOTIFICATION).toBe('notification');
      expect(SOUND_TYPES.TOGGLE).toBe('toggle');
    });

    test('DEFAULT_VOLUMES has values for all sound types', () => {
      for (const type of Object.values(SOUND_TYPES)) {
        expect(DEFAULT_VOLUMES[type]).toBeDefined();
        expect(DEFAULT_VOLUMES[type]).toBeGreaterThan(0);
        expect(DEFAULT_VOLUMES[type]).toBeLessThanOrEqual(1);
      }
    });

    test('SOUND_PARAMS has parameters for all sound types', () => {
      for (const type of Object.values(SOUND_TYPES)) {
        expect(SOUND_PARAMS[type]).toBeDefined();
        expect(SOUND_PARAMS[type].frequency).toBeDefined();
        expect(SOUND_PARAMS[type].duration).toBeDefined();
      }
    });
  });

  describe('getSoundVolume', () => {
    test('returns default volume for sound type', () => {
      const volume = getSoundVolume(SOUND_TYPES.CLICK);
      expect(volume).toBe(DEFAULT_VOLUMES[SOUND_TYPES.CLICK]);
    });

    test('applies master volume', () => {
      const volume = getSoundVolume(SOUND_TYPES.CLICK, 0.5);
      expect(volume).toBe(DEFAULT_VOLUMES[SOUND_TYPES.CLICK] * 0.5);
    });

    test('clamps volume to 0-1 range', () => {
      expect(getSoundVolume(SOUND_TYPES.CLICK, 2.0)).toBeLessThanOrEqual(1);
      expect(getSoundVolume(SOUND_TYPES.CLICK, -1)).toBeGreaterThanOrEqual(0);
    });

    test('returns default for unknown sound type', () => {
      const volume = getSoundVolume('unknown');
      expect(volume).toBe(0.3); // Default fallback
    });
  });

  describe('getSoundParams', () => {
    test('returns params for valid sound type', () => {
      const params = getSoundParams(SOUND_TYPES.CLICK);
      expect(params).toBeDefined();
      expect(params.frequency).toBe(800);
      expect(params.duration).toBe(0.05);
    });

    test('returns null for unknown sound type', () => {
      const params = getSoundParams('unknown');
      expect(params).toBeNull();
    });
  });

  describe('calculateEnvelope', () => {
    test('returns 0 at start (t=0) with attack', () => {
      // At t=0 in attack phase, should be at start of ramp
      expect(calculateEnvelope(0, 0.01, 0.1, 0.2)).toBe(0);
    });

    test('returns 1 at end of attack', () => {
      const attack = 0.01;
      expect(calculateEnvelope(attack, attack, 0.1, 0.2)).toBeCloseTo(1, 2);
    });

    test('decays after attack', () => {
      const envelope1 = calculateEnvelope(0.05, 0.01, 0.1, 0.2);
      const envelope2 = calculateEnvelope(0.1, 0.01, 0.1, 0.2);
      expect(envelope1).toBeGreaterThan(envelope2);
    });

    test('returns 0 outside duration', () => {
      expect(calculateEnvelope(-1, 0.01, 0.1, 0.2)).toBe(0);
      expect(calculateEnvelope(0.5, 0.01, 0.1, 0.2)).toBe(0);
    });
  });

  describe('calculateFrequency', () => {
    test('returns start frequency at t=0', () => {
      expect(calculateFrequency(0, 400, 800, 1.0)).toBe(400);
    });

    test('returns end frequency at t=duration', () => {
      expect(calculateFrequency(1.0, 400, 800, 1.0)).toBe(800);
    });

    test('returns midpoint at t=duration/2', () => {
      expect(calculateFrequency(0.5, 400, 800, 1.0)).toBe(600);
    });

    test('handles zero duration', () => {
      expect(calculateFrequency(0, 400, 800, 0)).toBe(400);
    });

    test('clamps t to valid range', () => {
      expect(calculateFrequency(2.0, 400, 800, 1.0)).toBe(800);
      expect(calculateFrequency(-1, 400, 800, 1.0)).toBe(400);
    });
  });

  describe('generateSoundSamples', () => {
    test('generates correct number of samples', () => {
      const params = { frequency: 440, duration: 0.1, type: 'sine' };
      const samples = generateSoundSamples(params, 44100);
      expect(samples.length).toBe(4410); // 0.1 * 44100
    });

    test('generates sine wave', () => {
      const params = { frequency: 440, duration: 0.1, type: 'sine', attack: 0.001, decay: 0.1 };
      const samples = generateSoundSamples(params, 44100);

      // Check that samples are in valid range
      for (const sample of samples) {
        expect(sample).toBeGreaterThanOrEqual(-1);
        expect(sample).toBeLessThanOrEqual(1);
      }
    });

    test('generates square wave', () => {
      const params = { frequency: 440, duration: 0.01, type: 'square', attack: 0.001 };
      const samples = generateSoundSamples(params, 44100);

      // Square wave should have samples close to +1 or -1 (before envelope)
      let hasPositive = false;
      let hasNegative = false;
      for (const sample of samples) {
        if (sample > 0.5) hasPositive = true;
        if (sample < -0.5) hasNegative = true;
      }
      expect(hasPositive || hasNegative).toBe(true);
    });

    test('generates sawtooth wave', () => {
      const params = { frequency: 440, duration: 0.1, type: 'sawtooth', attack: 0.001 };
      const samples = generateSoundSamples(params, 44100);
      expect(samples).toBeInstanceOf(Float32Array);
    });

    test('generates triangle wave', () => {
      const params = { frequency: 440, duration: 0.1, type: 'triangle', attack: 0.001 };
      const samples = generateSoundSamples(params, 44100);
      expect(samples).toBeInstanceOf(Float32Array);
    });

    test('applies frequency sweep', () => {
      const params = {
        frequency: 200,
        endFrequency: 800,
        duration: 0.1,
        type: 'sine',
        attack: 0.001
      };
      const samples = generateSoundSamples(params, 44100);
      expect(samples).toBeInstanceOf(Float32Array);
      expect(samples.length).toBe(4410);
    });
  });

  describe('applyLowPassFilter', () => {
    test('filters high frequencies', () => {
      // Create a signal with high-frequency content
      const samples = new Float32Array(100);
      for (let i = 0; i < 100; i++) {
        samples[i] = Math.sin(i * Math.PI); // Alternating +1/-1
      }

      const filtered = applyLowPassFilter(samples, 0.1);

      // Filtered signal should have reduced amplitude
      let maxFiltered = 0;
      for (const s of filtered) {
        if (Math.abs(s) > maxFiltered) maxFiltered = Math.abs(s);
      }
      expect(maxFiltered).toBeLessThan(1);
    });

    test('preserves signal length', () => {
      const samples = new Float32Array(100).fill(0.5);
      const filtered = applyLowPassFilter(samples);
      expect(filtered.length).toBe(100);
    });
  });

  describe('Sound generators', () => {
    test('createClickSound generates samples', () => {
      const samples = createClickSound();
      expect(samples).toBeInstanceOf(Float32Array);
      expect(samples.length).toBeGreaterThan(0);
    });

    test('createCardFlipSound generates samples', () => {
      const samples = createCardFlipSound();
      expect(samples).toBeInstanceOf(Float32Array);
      expect(samples.length).toBeGreaterThan(0);
    });

    test('createSuccessSound generates samples', () => {
      const samples = createSuccessSound();
      expect(samples).toBeInstanceOf(Float32Array);
      expect(samples.length).toBeGreaterThan(0);
    });

    test('createErrorSound generates samples', () => {
      const samples = createErrorSound();
      expect(samples).toBeInstanceOf(Float32Array);
      expect(samples.length).toBeGreaterThan(0);
    });

    test('sounds have correct duration', () => {
      const sampleRate = 44100;

      const click = createClickSound(sampleRate);
      expect(click.length).toBe(Math.round(0.05 * sampleRate));

      const cardFlip = createCardFlipSound(sampleRate);
      expect(cardFlip.length).toBe(Math.round(0.15 * sampleRate));

      const success = createSuccessSound(sampleRate);
      expect(success.length).toBe(Math.round(0.3 * sampleRate));

      const error = createErrorSound(sampleRate);
      expect(error.length).toBe(Math.round(0.4 * sampleRate));
    });
  });

  describe('isValidSoundType', () => {
    test('returns true for valid sound types', () => {
      expect(isValidSoundType(SOUND_TYPES.CLICK)).toBe(true);
      expect(isValidSoundType(SOUND_TYPES.SUCCESS)).toBe(true);
      expect(isValidSoundType(SOUND_TYPES.ERROR)).toBe(true);
    });

    test('returns false for invalid sound types', () => {
      expect(isValidSoundType('invalid')).toBe(false);
      expect(isValidSoundType('')).toBe(false);
      expect(isValidSoundType(null)).toBe(false);
    });
  });

  describe('getAvailableSoundTypes', () => {
    test('returns all sound types', () => {
      const types = getAvailableSoundTypes();

      expect(types).toContain(SOUND_TYPES.CLICK);
      expect(types).toContain(SOUND_TYPES.HOVER);
      expect(types).toContain(SOUND_TYPES.SUCCESS);
      expect(types).toContain(SOUND_TYPES.ERROR);
      expect(types.length).toBe(Object.keys(SOUND_TYPES).length);
    });
  });
});
