// Audio processing utilities for the Focus Desktop Simulator

/**
 * Encode AudioBuffer to WAV format
 * @param {Object} audioBuffer - Audio buffer object with getChannelData, numberOfChannels, sampleRate, length
 * @returns {ArrayBuffer} WAV file as ArrayBuffer
 */
function encodeWAV(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numSamples * blockAlign;
  const fileSize = 44 + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // Write WAV header
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Write audio data
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = audioBuffer.getChannelData(ch)[i];
      // Convert float to 16-bit int, clamping to range
      const intSample = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return buffer;
}

/**
 * Convert Float32Array audio data to 16-bit PCM
 * @param {Float32Array} float32Array - Audio samples as floats (-1.0 to 1.0)
 * @returns {Int16Array} PCM samples
 */
function floatTo16BitPCM(float32Array) {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    // Convert and clamp to 16-bit range
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16Array;
}

/**
 * Interleave stereo channels
 * @param {Float32Array} left - Left channel
 * @param {Float32Array} right - Right channel
 * @returns {Float32Array} Interleaved samples
 */
function interleave(left, right) {
  const length = left.length + right.length;
  const result = new Float32Array(length);

  let inputIndex = 0;
  for (let i = 0; i < length;) {
    result[i++] = left[inputIndex];
    result[i++] = right[inputIndex];
    inputIndex++;
  }

  return result;
}

/**
 * Downsample audio to target sample rate (simple linear interpolation)
 * @param {Float32Array} samples - Input samples
 * @param {number} sourceSampleRate - Source sample rate
 * @param {number} targetSampleRate - Target sample rate
 * @returns {Float32Array} Downsampled audio
 */
function downsample(samples, sourceSampleRate, targetSampleRate) {
  if (targetSampleRate >= sourceSampleRate) {
    return samples;
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const newLength = Math.round(samples.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, samples.length - 1);
    const t = srcIndex - srcIndexFloor;

    result[i] = samples[srcIndexFloor] * (1 - t) + samples[srcIndexCeil] * t;
  }

  return result;
}

/**
 * Calculate RMS (Root Mean Square) level of audio samples
 * @param {Float32Array} samples - Audio samples
 * @returns {number} RMS level (0.0 to 1.0)
 */
function calculateRMS(samples) {
  if (!samples || samples.length === 0) return 0;

  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Calculate peak level of audio samples
 * @param {Float32Array} samples - Audio samples
 * @returns {number} Peak level (0.0 to 1.0)
 */
function calculatePeak(samples) {
  if (!samples || samples.length === 0) return 0;

  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

/**
 * Convert linear amplitude to decibels
 * @param {number} amplitude - Linear amplitude (0.0 to 1.0)
 * @returns {number} Decibels (negative number, -Infinity for 0)
 */
function amplitudeToDb(amplitude) {
  if (amplitude <= 0) return -Infinity;
  return 20 * Math.log10(amplitude);
}

/**
 * Convert decibels to linear amplitude
 * @param {number} db - Decibels
 * @returns {number} Linear amplitude
 */
function dbToAmplitude(db) {
  return Math.pow(10, db / 20);
}

/**
 * Apply gain to audio samples (in place)
 * @param {Float32Array} samples - Audio samples
 * @param {number} gain - Gain multiplier
 */
function applyGain(samples, gain) {
  for (let i = 0; i < samples.length; i++) {
    samples[i] *= gain;
  }
}

/**
 * Normalize audio samples to target peak level (in place)
 * @param {Float32Array} samples - Audio samples
 * @param {number} targetPeak - Target peak level (default 0.99)
 */
function normalize(samples, targetPeak = 0.99) {
  const currentPeak = calculatePeak(samples);
  if (currentPeak > 0 && currentPeak !== targetPeak) {
    const gain = targetPeak / currentPeak;
    applyGain(samples, gain);
  }
}

/**
 * Generate a sine wave
 * @param {number} frequency - Frequency in Hz
 * @param {number} duration - Duration in seconds
 * @param {number} sampleRate - Sample rate in Hz
 * @param {number} amplitude - Amplitude (0.0 to 1.0)
 * @returns {Float32Array} Generated samples
 */
function generateSineWave(frequency, duration, sampleRate, amplitude = 1.0) {
  const numSamples = Math.round(duration * sampleRate);
  const samples = new Float32Array(numSamples);
  const angularFreq = 2 * Math.PI * frequency / sampleRate;

  for (let i = 0; i < numSamples; i++) {
    samples[i] = amplitude * Math.sin(angularFreq * i);
  }

  return samples;
}

/**
 * Generate white noise
 * @param {number} duration - Duration in seconds
 * @param {number} sampleRate - Sample rate in Hz
 * @param {number} amplitude - Amplitude (0.0 to 1.0)
 * @returns {Float32Array} Generated samples
 */
function generateWhiteNoise(duration, sampleRate, amplitude = 1.0) {
  const numSamples = Math.round(duration * sampleRate);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    samples[i] = amplitude * (Math.random() * 2 - 1);
  }

  return samples;
}

/**
 * Apply fade in to audio samples (in place)
 * @param {Float32Array} samples - Audio samples
 * @param {number} fadeSamples - Number of samples to fade
 */
function fadeIn(samples, fadeSamples) {
  const actualFade = Math.min(fadeSamples, samples.length);
  for (let i = 0; i < actualFade; i++) {
    samples[i] *= i / actualFade;
  }
}

/**
 * Apply fade out to audio samples (in place)
 * @param {Float32Array} samples - Audio samples
 * @param {number} fadeSamples - Number of samples to fade
 */
function fadeOut(samples, fadeSamples) {
  const actualFade = Math.min(fadeSamples, samples.length);
  const startIndex = samples.length - actualFade;
  for (let i = 0; i < actualFade; i++) {
    samples[startIndex + i] *= 1 - (i / actualFade);
  }
}

/**
 * Mix two audio buffers together
 * @param {Float32Array} a - First buffer
 * @param {Float32Array} b - Second buffer
 * @param {number} mixRatio - Ratio of b to a (0.0 = all a, 1.0 = all b)
 * @returns {Float32Array} Mixed audio
 */
function mixBuffers(a, b, mixRatio = 0.5) {
  const length = Math.max(a.length, b.length);
  const result = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const sampleA = i < a.length ? a[i] : 0;
    const sampleB = i < b.length ? b[i] : 0;
    result[i] = sampleA * (1 - mixRatio) + sampleB * mixRatio;
  }

  return result;
}

/**
 * Detect silence in audio
 * @param {Float32Array} samples - Audio samples
 * @param {number} threshold - Silence threshold (default 0.001)
 * @returns {boolean} True if audio is silent
 */
function isSilent(samples, threshold = 0.001) {
  const rms = calculateRMS(samples);
  return rms < threshold;
}

/**
 * Trim silence from start and end of audio
 * @param {Float32Array} samples - Audio samples
 * @param {number} threshold - Silence threshold (default 0.01)
 * @returns {Float32Array} Trimmed audio
 */
function trimSilence(samples, threshold = 0.01) {
  let start = 0;
  let end = samples.length;

  // Find first non-silent sample
  while (start < end && Math.abs(samples[start]) < threshold) {
    start++;
  }

  // Find last non-silent sample
  while (end > start && Math.abs(samples[end - 1]) < threshold) {
    end--;
  }

  if (start >= end) {
    return new Float32Array(0);
  }

  return samples.slice(start, end);
}

module.exports = {
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
};
