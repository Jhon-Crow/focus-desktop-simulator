// Tests for file operations utilities

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  AUDIO_EXTENSIONS,
  findAudioFilesRecursively,
  getMimeTypeFromExtension,
  readAudioFileAsDataUrl,
  getNextRecordingNumber,
  saveState,
  loadState,
  saveObjectData,
  loadObjectData,
  saveMarkdownFile,
  saveDrawingFile,
  deleteDrawingFile,
  validateModelData,
  validateManifest,
  getExtensibilityDir
} = require('../src/utils/fileOperations');

describe('File Operations', () => {
  let testDir;

  beforeEach(() => {
    // Create a unique test directory for each test
    testDir = path.join(os.tmpdir(), `test-fileops-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('AUDIO_EXTENSIONS', () => {
    test('contains all expected audio formats', () => {
      expect(AUDIO_EXTENSIONS).toContain('.mp3');
      expect(AUDIO_EXTENSIONS).toContain('.wav');
      expect(AUDIO_EXTENSIONS).toContain('.ogg');
      expect(AUDIO_EXTENSIONS).toContain('.flac');
      expect(AUDIO_EXTENSIONS).toContain('.aac');
      expect(AUDIO_EXTENSIONS).toContain('.m4a');
      expect(AUDIO_EXTENSIONS).toContain('.webm');
      expect(AUDIO_EXTENSIONS).toContain('.opus');
    });
  });

  describe('getMimeTypeFromExtension', () => {
    test('returns correct MIME types', () => {
      expect(getMimeTypeFromExtension('.mp3')).toBe('audio/mpeg');
      expect(getMimeTypeFromExtension('.wav')).toBe('audio/wav');
      expect(getMimeTypeFromExtension('.ogg')).toBe('audio/ogg');
      expect(getMimeTypeFromExtension('.flac')).toBe('audio/flac');
      expect(getMimeTypeFromExtension('.aac')).toBe('audio/aac');
      expect(getMimeTypeFromExtension('.m4a')).toBe('audio/mp4');
      expect(getMimeTypeFromExtension('.webm')).toBe('audio/webm');
      expect(getMimeTypeFromExtension('.opus')).toBe('audio/opus');
    });

    test('returns default MIME type for unknown extensions', () => {
      expect(getMimeTypeFromExtension('.xyz')).toBe('audio/mpeg');
      expect(getMimeTypeFromExtension('')).toBe('audio/mpeg');
    });
  });

  describe('findAudioFilesRecursively', () => {
    test('finds audio files in a folder', () => {
      // Create test audio files
      fs.writeFileSync(path.join(testDir, 'song1.mp3'), 'test');
      fs.writeFileSync(path.join(testDir, 'song2.wav'), 'test');
      fs.writeFileSync(path.join(testDir, 'not-audio.txt'), 'test');

      const files = findAudioFilesRecursively(testDir);

      expect(files.length).toBe(2);
      expect(files.some(f => f.fullName === 'song1.mp3')).toBe(true);
      expect(files.some(f => f.fullName === 'song2.wav')).toBe(true);
    });

    test('finds audio files in subfolders', () => {
      // Create subfolders
      const subDir = path.join(testDir, 'subfolder');
      fs.mkdirSync(subDir);

      fs.writeFileSync(path.join(testDir, 'root.mp3'), 'test');
      fs.writeFileSync(path.join(subDir, 'nested.ogg'), 'test');

      const files = findAudioFilesRecursively(testDir);

      expect(files.length).toBe(2);
      expect(files.some(f => f.fullName === 'root.mp3')).toBe(true);
      expect(files.some(f => f.fullName === 'nested.ogg')).toBe(true);

      // Check that nested file has proper display name with relative path
      const nestedFile = files.find(f => f.fullName === 'nested.ogg');
      expect(nestedFile.name).toContain('subfolder');
    });

    test('returns empty array for non-existent folder', () => {
      const files = findAudioFilesRecursively('/non/existent/path');
      expect(files).toEqual([]);
    });

    test('handles empty folder', () => {
      const files = findAudioFilesRecursively(testDir);
      expect(files).toEqual([]);
    });
  });

  describe('readAudioFileAsDataUrl', () => {
    test('reads audio file and returns data URL', () => {
      const filePath = path.join(testDir, 'test.mp3');
      const testData = Buffer.from([0x49, 0x44, 0x33]); // ID3 header
      fs.writeFileSync(filePath, testData);

      const result = readAudioFileAsDataUrl(filePath);

      expect(result.success).toBe(true);
      expect(result.dataUrl).toMatch(/^data:audio\/mpeg;base64,/);
      expect(result.fileName).toBe('test.mp3');
    });

    test('returns error for non-existent file', () => {
      const result = readAudioFileAsDataUrl('/non/existent/file.mp3');

      expect(result.success).toBe(false);
      expect(result.error).toBe('File not found');
    });

    test('handles different audio formats', () => {
      const filePath = path.join(testDir, 'test.wav');
      fs.writeFileSync(filePath, 'RIFF');

      const result = readAudioFileAsDataUrl(filePath);

      expect(result.success).toBe(true);
      expect(result.dataUrl).toMatch(/^data:audio\/wav;base64,/);
    });
  });

  describe('getNextRecordingNumber', () => {
    test('returns 1 for empty folder', () => {
      const result = getNextRecordingNumber(testDir);

      expect(result.success).toBe(true);
      expect(result.nextNumber).toBe(1);
    });

    test('returns correct number with existing recordings', () => {
      fs.writeFileSync(path.join(testDir, 'Запись 1.wav'), 'test');
      fs.writeFileSync(path.join(testDir, 'Запись 3.wav'), 'test');
      fs.writeFileSync(path.join(testDir, 'Запись 2.mp3'), 'test');

      const result = getNextRecordingNumber(testDir);

      expect(result.success).toBe(true);
      expect(result.nextNumber).toBe(4);
    });

    test('ignores non-matching files', () => {
      fs.writeFileSync(path.join(testDir, 'Запись 5.wav'), 'test');
      fs.writeFileSync(path.join(testDir, 'other.wav'), 'test');
      fs.writeFileSync(path.join(testDir, 'recording.mp3'), 'test');

      const result = getNextRecordingNumber(testDir);

      expect(result.success).toBe(true);
      expect(result.nextNumber).toBe(6);
    });

    test('returns error for non-existent folder', () => {
      const result = getNextRecordingNumber('/non/existent/path');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Folder not found');
    });
  });

  describe('saveState and loadState', () => {
    test('saves and loads state correctly', () => {
      const testState = {
        objects: [{ id: 1, type: 'card' }],
        settings: { theme: 'dark' }
      };

      const saveResult = saveState(testDir, testState);
      expect(saveResult.success).toBe(true);

      const loadResult = loadState(testDir);
      expect(loadResult.success).toBe(true);
      expect(loadResult.state).toEqual(testState);
    });

    test('loadState returns null for non-existent state', () => {
      const result = loadState(testDir);

      expect(result.success).toBe(true);
      expect(result.state).toBeNull();
    });

    test('loadState handles malformed JSON', () => {
      fs.writeFileSync(path.join(testDir, 'desk-state.json'), 'not valid json');

      const result = loadState(testDir);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('saveObjectData and loadObjectData', () => {
    test('saves and loads object data correctly', () => {
      const objectId = 'test-obj-1';
      const dataType = 'pdf';
      const dataUrl = 'data:application/pdf;base64,JVBERi0...';

      const saveResult = saveObjectData(testDir, objectId, dataType, dataUrl);
      expect(saveResult.success).toBe(true);

      const loadResult = loadObjectData(testDir, objectId, dataType);
      expect(loadResult.success).toBe(true);
      expect(loadResult.data).toBe(dataUrl);
    });

    test('deletes data when null is passed', () => {
      const objectId = 'test-obj-2';
      const dataType = 'cover';
      const dataUrl = 'data:image/png;base64,abc';

      // First save
      saveObjectData(testDir, objectId, dataType, dataUrl);

      // Then delete
      const deleteResult = saveObjectData(testDir, objectId, dataType, null);
      expect(deleteResult.success).toBe(true);

      // Verify deleted
      const loadResult = loadObjectData(testDir, objectId, dataType);
      expect(loadResult.data).toBeNull();
    });

    test('loadObjectData returns null for non-existent data', () => {
      const result = loadObjectData(testDir, 'non-existent', 'type');

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  describe('saveMarkdownFile', () => {
    test('saves markdown file correctly', () => {
      const content = '# Hello World\n\nThis is a test.';
      const result = saveMarkdownFile(testDir, 'test.md', content);

      expect(result.success).toBe(true);
      expect(result.filePath).toContain('test.md');

      const savedContent = fs.readFileSync(result.filePath, 'utf8');
      expect(savedContent).toBe(content);
    });

    test('adds .md extension if missing', () => {
      const result = saveMarkdownFile(testDir, 'note', '# Note');

      expect(result.success).toBe(true);
      expect(result.filePath).toContain('.md');
    });

    test('creates folder if not exists', () => {
      const newFolder = path.join(testDir, 'notes', 'subfolder');
      const result = saveMarkdownFile(newFolder, 'test.md', '# Test');

      expect(result.success).toBe(true);
      expect(fs.existsSync(newFolder)).toBe(true);
    });
  });

  describe('saveDrawingFile', () => {
    test('saves PNG file correctly', () => {
      // Create a minimal valid PNG data URL
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const dataUrl = `data:image/png;base64,${pngBase64}`;

      const result = saveDrawingFile(testDir, 'drawing.png', dataUrl);

      expect(result.success).toBe(true);
      expect(result.filePath).toContain('drawing.png');
      expect(fs.existsSync(result.filePath)).toBe(true);
    });

    test('adds .png extension if missing', () => {
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const dataUrl = `data:image/png;base64,${pngBase64}`;

      const result = saveDrawingFile(testDir, 'drawing', dataUrl);

      expect(result.success).toBe(true);
      expect(result.filePath).toContain('.png');
    });

    test('creates folder if not exists', () => {
      const newFolder = path.join(testDir, 'drawings', 'subfolder');
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const dataUrl = `data:image/png;base64,${pngBase64}`;

      const result = saveDrawingFile(newFolder, 'test.png', dataUrl);

      expect(result.success).toBe(true);
      expect(fs.existsSync(newFolder)).toBe(true);
    });
  });

  describe('deleteDrawingFile', () => {
    test('deletes existing file', () => {
      const filePath = path.join(testDir, 'to-delete.png');
      fs.writeFileSync(filePath, 'test');

      expect(fs.existsSync(filePath)).toBe(true);

      const result = deleteDrawingFile(filePath);

      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    test('succeeds for non-existent file', () => {
      const result = deleteDrawingFile('/non/existent/file.png');

      expect(result.success).toBe(true);
    });
  });

  describe('validateModelData', () => {
    test('validates complete model data', () => {
      const result = validateModelData({ id: 'test', name: 'Test Model' });

      expect(result.valid).toBe(true);
    });

    test('rejects null data', () => {
      const result = validateModelData(null);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Model data is required');
    });

    test('rejects missing id', () => {
      const result = validateModelData({ name: 'Test' });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('id');
    });

    test('rejects missing name', () => {
      const result = validateModelData({ id: 'test' });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('name');
    });
  });

  describe('validateManifest', () => {
    test('validates complete manifest', () => {
      const result = validateManifest({ id: 'test', name: 'Test Program' });

      expect(result.valid).toBe(true);
    });

    test('rejects null manifest', () => {
      const result = validateManifest(null);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Manifest is required');
    });

    test('rejects missing id', () => {
      const result = validateManifest({ name: 'Test' });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('id');
    });

    test('rejects missing name', () => {
      const result = validateManifest({ id: 'test' });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('name');
    });
  });

  describe('getExtensibilityDir', () => {
    test('creates and returns extensibility directories', () => {
      const dirs = getExtensibilityDir(testDir);

      expect(dirs.base).toBe(path.join(testDir, 'extensibility'));
      expect(dirs.models).toBe(path.join(testDir, 'extensibility', 'models'));
      expect(dirs.programs).toBe(path.join(testDir, 'extensibility', 'programs'));

      expect(fs.existsSync(dirs.models)).toBe(true);
      expect(fs.existsSync(dirs.programs)).toBe(true);
    });

    test('does not fail if directories already exist', () => {
      // Create directories first
      const modelsDir = path.join(testDir, 'extensibility', 'models');
      fs.mkdirSync(modelsDir, { recursive: true });

      // Should not throw
      const dirs = getExtensibilityDir(testDir);

      expect(dirs.models).toBe(modelsDir);
    });
  });
});
