// Tests for audio processing utilities

const {
  encodeWAV,
  floatTo16BitPCM,
  interleave,
  downsample,
  calculateRMS,
  calculatePeak,
  amplitudeToDb,
  dbToAmplitude,
  applyGain,
  normalize,
  generateSineWave,
  generateWhiteNoise,
  fadeIn,
  fadeOut,
  mixBuffers,
  isSilent,
  trimSilence
} = require('../src/utils/audioProcessing');

describe('Audio Processing Utilities', () => {
  describe('encodeWAV', () => {
    test('encodes mono audio buffer to WAV', () => {
      const mockAudioBuffer = {
        numberOfChannels: 1,
        sampleRate: 44100,
        length: 100,
        getChannelData: jest.fn(() => new Float32Array(100).fill(0.5))
      };

      const wav = encodeWAV(mockAudioBuffer);

      expect(wav).toBeInstanceOf(ArrayBuffer);
      expect(wav.byteLength).toBe(44 + 100 * 2); // header + 100 samples * 2 bytes

      // Check RIFF header
      const view = new DataView(wav);
      const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
      expect(riff).toBe('RIFF');
    });

    test('encodes stereo audio buffer to WAV', () => {
      const leftChannel = new Float32Array(100).fill(0.5);
      const rightChannel = new Float32Array(100).fill(-0.5);

      const mockAudioBuffer = {
        numberOfChannels: 2,
        sampleRate: 48000,
        length: 100,
        getChannelData: jest.fn((ch) => ch === 0 ? leftChannel : rightChannel)
      };

      const wav = encodeWAV(mockAudioBuffer);

      expect(wav).toBeInstanceOf(ArrayBuffer);
      expect(wav.byteLength).toBe(44 + 100 * 4); // header + 100 samples * 2 channels * 2 bytes

      // Check format
      const view = new DataView(wav);
      expect(view.getUint16(22, true)).toBe(2); // numChannels
      expect(view.getUint32(24, true)).toBe(48000); // sampleRate
    });

    test('clamps samples to valid range', () => {
      const samples = new Float32Array([2.0, -2.0, 0.5, -0.5]);
      const mockAudioBuffer = {
        numberOfChannels: 1,
        sampleRate: 44100,
        length: 4,
        getChannelData: jest.fn(() => samples)
      };

      const wav = encodeWAV(mockAudioBuffer);
      const view = new DataView(wav);

      // First sample should be clamped to max
      expect(view.getInt16(44, true)).toBe(32767);
      // Second sample should be clamped to min
      expect(view.getInt16(46, true)).toBe(-32768);
    });
  });

  describe('floatTo16BitPCM', () => {
    test('converts float samples to 16-bit PCM', () => {
      const floatSamples = new Float32Array([1.0, -1.0, 0.5, -0.5, 0.0]);
      const pcm = floatTo16BitPCM(floatSamples);

      expect(pcm).toBeInstanceOf(Int16Array);
      expect(pcm.length).toBe(5);
      expect(pcm[0]).toBe(32767);  // max positive
      expect(pcm[1]).toBe(-32768); // max negative
      expect(pcm[4]).toBe(0);      // zero
    });

    test('clamps values outside -1 to 1', () => {
      const floatSamples = new Float32Array([2.0, -2.0]);
      const pcm = floatTo16BitPCM(floatSamples);

      expect(pcm[0]).toBe(32767);
      expect(pcm[1]).toBe(-32768);
    });
  });

  describe('interleave', () => {
    test('interleaves left and right channels', () => {
      const left = new Float32Array([1, 2, 3]);
      const right = new Float32Array([4, 5, 6]);

      const interleaved = interleave(left, right);

      expect(interleaved).toEqual(new Float32Array([1, 4, 2, 5, 3, 6]));
    });

    test('handles single sample', () => {
      const left = new Float32Array([1]);
      const right = new Float32Array([2]);

      const interleaved = interleave(left, right);

      expect(interleaved).toEqual(new Float32Array([1, 2]));
    });
  });

  describe('downsample', () => {
    test('downsamples audio by 2x', () => {
      const samples = new Float32Array([0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5]);
      const downsampled = downsample(samples, 44100, 22050);

      expect(downsampled.length).toBe(4);
    });

    test('returns original if target rate >= source rate', () => {
      const samples = new Float32Array([1, 2, 3, 4]);
      const result = downsample(samples, 44100, 44100);

      expect(result).toBe(samples);
    });

    test('returns original if target rate higher', () => {
      const samples = new Float32Array([1, 2, 3, 4]);
      const result = downsample(samples, 22050, 44100);

      expect(result).toBe(samples);
    });
  });

  describe('calculateRMS', () => {
    test('calculates RMS of constant signal', () => {
      const samples = new Float32Array([0.5, 0.5, 0.5, 0.5]);
      const rms = calculateRMS(samples);

      expect(rms).toBeCloseTo(0.5, 5);
    });

    test('calculates RMS of sine wave', () => {
      // Full sine wave cycle
      const samples = generateSineWave(1, 1, 1000);
      const rms = calculateRMS(samples);

      // RMS of sine wave is amplitude / sqrt(2)
      expect(rms).toBeCloseTo(1 / Math.sqrt(2), 1);
    });

    test('returns 0 for empty array', () => {
      expect(calculateRMS(new Float32Array(0))).toBe(0);
      expect(calculateRMS(null)).toBe(0);
    });

    test('returns 0 for silent signal', () => {
      const samples = new Float32Array(100).fill(0);
      expect(calculateRMS(samples)).toBe(0);
    });
  });

  describe('calculatePeak', () => {
    test('finds positive peak', () => {
      const samples = new Float32Array([0.1, 0.5, 0.9, 0.3]);
      expect(calculatePeak(samples)).toBeCloseTo(0.9, 5);
    });

    test('finds negative peak', () => {
      const samples = new Float32Array([0.1, -0.8, 0.3]);
      expect(calculatePeak(samples)).toBeCloseTo(0.8, 5);
    });

    test('returns 0 for empty array', () => {
      expect(calculatePeak(new Float32Array(0))).toBe(0);
      expect(calculatePeak(null)).toBe(0);
    });
  });

  describe('amplitudeToDb and dbToAmplitude', () => {
    test('converts amplitude to dB correctly', () => {
      expect(amplitudeToDb(1.0)).toBeCloseTo(0, 5);
      expect(amplitudeToDb(0.5)).toBeCloseTo(-6.02, 1);
      expect(amplitudeToDb(0.1)).toBeCloseTo(-20, 1);
    });

    test('returns -Infinity for zero amplitude', () => {
      expect(amplitudeToDb(0)).toBe(-Infinity);
      expect(amplitudeToDb(-1)).toBe(-Infinity);
    });

    test('converts dB to amplitude correctly', () => {
      expect(dbToAmplitude(0)).toBeCloseTo(1.0, 5);
      expect(dbToAmplitude(-6)).toBeCloseTo(0.5, 1);
      expect(dbToAmplitude(-20)).toBeCloseTo(0.1, 2);
    });

    test('round-trips correctly', () => {
      const amplitudes = [0.1, 0.5, 1.0];
      for (const amp of amplitudes) {
        const db = amplitudeToDb(amp);
        const backToAmp = dbToAmplitude(db);
        expect(backToAmp).toBeCloseTo(amp, 5);
      }
    });
  });

  describe('applyGain', () => {
    test('applies gain to samples', () => {
      const samples = new Float32Array([0.5, -0.5, 0.25]);
      applyGain(samples, 2);

      expect(samples[0]).toBeCloseTo(1.0, 5);
      expect(samples[1]).toBeCloseTo(-1.0, 5);
      expect(samples[2]).toBeCloseTo(0.5, 5);
    });

    test('applies unity gain (no change)', () => {
      const samples = new Float32Array([0.5, -0.5]);
      applyGain(samples, 1);

      expect(samples[0]).toBeCloseTo(0.5, 5);
      expect(samples[1]).toBeCloseTo(-0.5, 5);
    });
  });

  describe('normalize', () => {
    test('normalizes to default peak', () => {
      const samples = new Float32Array([0.25, -0.5, 0.1]);
      normalize(samples);

      expect(calculatePeak(samples)).toBeCloseTo(0.99, 5);
    });

    test('normalizes to custom peak', () => {
      const samples = new Float32Array([0.25, -0.5, 0.1]);
      normalize(samples, 0.8);

      expect(calculatePeak(samples)).toBeCloseTo(0.8, 5);
    });

    test('handles already normalized audio', () => {
      const samples = new Float32Array([0.99, -0.5]);
      normalize(samples, 0.99);

      expect(calculatePeak(samples)).toBeCloseTo(0.99, 5);
    });

    test('handles silent audio', () => {
      const samples = new Float32Array([0, 0, 0]);
      normalize(samples);

      expect(samples[0]).toBe(0);
      expect(samples[1]).toBe(0);
      expect(samples[2]).toBe(0);
    });
  });

  describe('generateSineWave', () => {
    test('generates correct number of samples', () => {
      const samples = generateSineWave(440, 0.1, 44100);
      expect(samples.length).toBe(4410);
    });

    test('generates with correct amplitude', () => {
      const samples = generateSineWave(440, 0.1, 44100, 0.5);
      const peak = calculatePeak(samples);
      expect(peak).toBeCloseTo(0.5, 2);
    });

    test('starts at zero', () => {
      const samples = generateSineWave(440, 0.1, 44100);
      expect(samples[0]).toBeCloseTo(0, 5);
    });
  });

  describe('generateWhiteNoise', () => {
    test('generates correct number of samples', () => {
      const samples = generateWhiteNoise(0.1, 44100);
      expect(samples.length).toBe(4410);
    });

    test('generates values in range', () => {
      const samples = generateWhiteNoise(0.1, 44100, 0.5);
      const peak = calculatePeak(samples);
      expect(peak).toBeLessThanOrEqual(0.5);
    });

    test('generates non-zero values', () => {
      const samples = generateWhiteNoise(0.1, 44100);
      const rms = calculateRMS(samples);
      expect(rms).toBeGreaterThan(0);
    });
  });

  describe('fadeIn', () => {
    test('applies fade in', () => {
      const samples = new Float32Array([1, 1, 1, 1, 1]);
      fadeIn(samples, 3);

      expect(samples[0]).toBe(0);
      expect(samples[1]).toBeCloseTo(1/3, 5);
      expect(samples[2]).toBeCloseTo(2/3, 5);
      expect(samples[3]).toBe(1);
      expect(samples[4]).toBe(1);
    });

    test('handles fade longer than audio', () => {
      const samples = new Float32Array([1, 1, 1]);
      fadeIn(samples, 10);

      expect(samples[0]).toBe(0);
      expect(samples[2]).toBeCloseTo(2/3, 5);
    });
  });

  describe('fadeOut', () => {
    test('applies fade out', () => {
      const samples = new Float32Array([1, 1, 1, 1, 1]);
      fadeOut(samples, 3);

      expect(samples[0]).toBe(1);
      expect(samples[1]).toBe(1);
      expect(samples[2]).toBeCloseTo(1, 5);
      expect(samples[3]).toBeCloseTo(2/3, 5);
      expect(samples[4]).toBeCloseTo(1/3, 5);
    });

    test('handles fade longer than audio', () => {
      const samples = new Float32Array([1, 1, 1]);
      fadeOut(samples, 10);

      expect(samples[0]).toBeCloseTo(1, 5);
      expect(samples[2]).toBeCloseTo(1/3, 5);
    });
  });

  describe('mixBuffers', () => {
    test('mixes buffers with equal ratio', () => {
      const a = new Float32Array([1, 1, 1]);
      const b = new Float32Array([0, 0, 0]);
      const mixed = mixBuffers(a, b, 0.5);

      expect(mixed[0]).toBeCloseTo(0.5, 5);
      expect(mixed[1]).toBeCloseTo(0.5, 5);
      expect(mixed[2]).toBeCloseTo(0.5, 5);
    });

    test('favors first buffer with low ratio', () => {
      const a = new Float32Array([1, 1]);
      const b = new Float32Array([0, 0]);
      const mixed = mixBuffers(a, b, 0);

      expect(mixed[0]).toBe(1);
      expect(mixed[1]).toBe(1);
    });

    test('favors second buffer with high ratio', () => {
      const a = new Float32Array([1, 1]);
      const b = new Float32Array([0, 0]);
      const mixed = mixBuffers(a, b, 1);

      expect(mixed[0]).toBe(0);
      expect(mixed[1]).toBe(0);
    });

    test('handles different length buffers', () => {
      const a = new Float32Array([1, 1, 1, 1]);
      const b = new Float32Array([0, 0]);
      const mixed = mixBuffers(a, b, 0.5);

      expect(mixed.length).toBe(4);
      expect(mixed[2]).toBeCloseTo(0.5, 5); // b padded with 0
      expect(mixed[3]).toBeCloseTo(0.5, 5);
    });
  });

  describe('isSilent', () => {
    test('returns true for silent audio', () => {
      const samples = new Float32Array(100).fill(0);
      expect(isSilent(samples)).toBe(true);
    });

    test('returns false for non-silent audio', () => {
      const samples = new Float32Array([0.5, 0.5, 0.5]);
      expect(isSilent(samples)).toBe(false);
    });

    test('returns true for very quiet audio', () => {
      const samples = new Float32Array([0.0001, 0.0001]);
      expect(isSilent(samples, 0.001)).toBe(true);
    });

    test('respects custom threshold', () => {
      const samples = new Float32Array([0.05, 0.05]);
      expect(isSilent(samples, 0.1)).toBe(true);
      expect(isSilent(samples, 0.01)).toBe(false);
    });
  });

  describe('trimSilence', () => {
    test('trims silence from start and end', () => {
      const samples = new Float32Array([0, 0, 0.5, 1, 0.5, 0, 0]);
      const trimmed = trimSilence(samples, 0.01);

      expect(trimmed.length).toBe(3);
      expect(trimmed[0]).toBe(0.5);
      expect(trimmed[1]).toBe(1);
      expect(trimmed[2]).toBe(0.5);
    });

    test('returns empty for all-silent audio', () => {
      const samples = new Float32Array([0, 0, 0]);
      const trimmed = trimSilence(samples);

      expect(trimmed.length).toBe(0);
    });

    test('preserves audio with no silence', () => {
      const samples = new Float32Array([0.5, 1, 0.5]);
      const trimmed = trimSilence(samples, 0.01);

      expect(trimmed).toEqual(samples);
    });
  });
});
