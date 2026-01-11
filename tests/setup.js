// Jest setup file for global test configuration

// Mock console methods to reduce noise during tests (optional)
// Uncomment to silence console output during tests:
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
// };

// Mock Web Audio API
global.AudioContext = jest.fn().mockImplementation(() => ({
  createOscillator: jest.fn(() => ({
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    frequency: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
    type: 'sine'
  })),
  createGain: jest.fn(() => ({
    connect: jest.fn(),
    gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn(), setTargetAtTime: jest.fn(), value: 1 }
  })),
  createBuffer: jest.fn((channels, length, sampleRate) => ({
    numberOfChannels: channels,
    length: length,
    sampleRate: sampleRate,
    duration: length / sampleRate,
    getChannelData: jest.fn(() => new Float32Array(length))
  })),
  createBufferSource: jest.fn(() => ({
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    buffer: null,
    loop: false
  })),
  createBiquadFilter: jest.fn(() => ({
    connect: jest.fn(),
    frequency: { value: 1000 },
    Q: { value: 1 },
    type: 'lowpass'
  })),
  createStereoPanner: jest.fn(() => ({
    connect: jest.fn(),
    pan: { value: 0 }
  })),
  decodeAudioData: jest.fn((buffer, success, error) => {
    const mockAudioBuffer = {
      duration: 1.0,
      numberOfChannels: 2,
      sampleRate: 44100,
      length: 44100,
      getChannelData: jest.fn(() => new Float32Array(44100))
    };
    if (success) success(mockAudioBuffer);
    return Promise.resolve(mockAudioBuffer);
  }),
  destination: {},
  currentTime: 0,
  state: 'running',
  resume: jest.fn(() => Promise.resolve()),
  suspend: jest.fn(() => Promise.resolve()),
  close: jest.fn(() => Promise.resolve())
}));

global.webkitAudioContext = global.AudioContext;

// Mock Audio element
global.Audio = jest.fn().mockImplementation(() => ({
  play: jest.fn(() => Promise.resolve()),
  pause: jest.fn(),
  load: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  volume: 1,
  src: '',
  currentTime: 0,
  duration: 0
}));

// Mock URL
global.URL = {
  createObjectURL: jest.fn(() => 'blob:test-url'),
  revokeObjectURL: jest.fn()
};

// Mock performance
global.performance = {
  now: jest.fn(() => Date.now()),
  memory: {
    jsHeapSizeLimit: 2147483648,
    totalJSHeapSize: 104857600,
    usedJSHeapSize: 52428800
  }
};

// Mock requestAnimationFrame
global.requestAnimationFrame = jest.fn((callback) => setTimeout(callback, 16));
global.cancelAnimationFrame = jest.fn((id) => clearTimeout(id));

// Mock FileReader
global.FileReader = jest.fn().mockImplementation(() => ({
  readAsDataURL: jest.fn(function() {
    this.result = 'data:audio/wav;base64,test';
    if (this.onload) this.onload();
  }),
  readAsArrayBuffer: jest.fn(function() {
    this.result = new ArrayBuffer(1000);
    if (this.onload) this.onload();
  }),
  onload: null,
  onerror: null,
  result: null
}));

// Mock fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(1000)),
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
    ok: true,
    status: 200
  })
);

// Mock window properties used in renderer
global.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  screen: {
    width: 1920,
    height: 1080
  },
  location: {
    search: ''
  },
  addEventListener: jest.fn(),
  removeEventListener: jest.fn()
};

// Mock document
global.document = {
  getElementById: jest.fn(() => ({
    classList: {
      add: jest.fn(),
      remove: jest.fn(),
      contains: jest.fn(() => false)
    },
    appendChild: jest.fn(),
    removeChild: jest.fn(),
    innerHTML: '',
    style: {},
    querySelector: jest.fn(() => null),
    querySelectorAll: jest.fn(() => [])
  })),
  createElement: jest.fn(() => ({
    classList: { add: jest.fn(), remove: jest.fn() },
    appendChild: jest.fn(),
    style: {},
    addEventListener: jest.fn()
  })),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn()
};

// Mock navigator
global.navigator = {
  userAgent: 'jest-test-environment',
  platform: 'test'
};

// Mock btoa and atob for base64 encoding/decoding
global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
global.atob = (str) => Buffer.from(str, 'base64').toString('binary');

// Clean up after all tests
afterAll(() => {
  jest.clearAllMocks();
});
