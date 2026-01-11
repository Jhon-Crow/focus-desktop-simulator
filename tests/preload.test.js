// Tests for preload.js API bridge

// Store reference to electron mocks before any resets
let contextBridge;
let ipcRenderer;
let api;

describe('Preload API Bridge', () => {
  beforeAll(() => {
    // Get references to the mocks
    const electron = require('electron');
    contextBridge = electron.contextBridge;
    ipcRenderer = electron.ipcRenderer;

    // Load preload script once to capture the API
    require('../src/preload.js');

    // Capture the API object
    api = contextBridge.exposeInMainWorld.mock.calls[0][1];
  });

  beforeEach(() => {
    // Clear mock call history but keep the API reference
    jest.clearAllMocks();
  });

  describe('contextBridge.exposeInMainWorld', () => {
    test('exposes electronAPI to main world', () => {
      // Load preload script again to verify it was called
      jest.resetModules();
      const freshElectron = require('electron');
      require('../src/preload.js');

      // Verify exposeInMainWorld was called with 'electronAPI'
      expect(freshElectron.contextBridge.exposeInMainWorld).toHaveBeenCalledWith(
        'electronAPI',
        expect.any(Object)
      );
    });

    test('electronAPI contains all required methods', () => {
      // Use the captured api from beforeAll

      // State management
      expect(typeof api.saveState).toBe('function');
      expect(typeof api.loadState).toBe('function');
      expect(typeof api.saveObjectData).toBe('function');
      expect(typeof api.loadObjectData).toBe('function');

      // FFmpeg
      expect(typeof api.getFfmpegStatus).toBe('function');
      expect(typeof api.onFfmpegStatus).toBe('function');
      expect(typeof api.transcodeAudio).toBe('function');

      // Cassette player
      expect(typeof api.selectMusicFolder).toBe('function');
      expect(typeof api.selectMusicFile).toBe('function');
      expect(typeof api.readAudioFile).toBe('function');
      expect(typeof api.refreshMusicFolder).toBe('function');

      // Sound selection
      expect(typeof api.selectSoundFile).toBe('function');

      // Dictaphone
      expect(typeof api.selectRecordingsFolder).toBe('function');
      expect(typeof api.saveRecording).toBe('function');
      expect(typeof api.getNextRecordingNumber).toBe('function');

      // Markdown editor
      expect(typeof api.getDefaultNotesFolder).toBe('function');
      expect(typeof api.selectNotesFolder).toBe('function');
      expect(typeof api.saveMarkdownFile).toBe('function');

      // Pen drawing
      expect(typeof api.getDefaultDrawingsFolder).toBe('function');
      expect(typeof api.selectDrawingsFolder).toBe('function');
      expect(typeof api.saveDrawingFile).toBe('function');
      expect(typeof api.deleteDrawingFile).toBe('function');

      // Activity log
      expect(typeof api.startLogRecording).toBe('function');
      expect(typeof api.appendLogEntry).toBe('function');
      expect(typeof api.stopLogRecording).toBe('function');
      expect(typeof api.isLogRecording).toBe('function');

      // Window settings
      expect(typeof api.setFullscreenBorderless).toBe('function');
      expect(typeof api.setIgnoreShortcuts).toBe('function');
      expect(typeof api.setMuteOtherApps).toBe('function');

      // Application control
      expect(typeof api.quitApplication).toBe('function');

      // Extensibility - Models
      expect(typeof api.extSelectModelFile).toBe('function');
      expect(typeof api.extSelectModelFolder).toBe('function');
      expect(typeof api.extLoadModels).toBe('function');
      expect(typeof api.extDeleteModel).toBe('function');
      expect(typeof api.extSaveModel).toBe('function');
      expect(typeof api.extExportModel).toBe('function');

      // Extensibility - Programs
      expect(typeof api.extSelectProgram).toBe('function');
      expect(typeof api.extSelectProgramFolder).toBe('function');
      expect(typeof api.extLoadPrograms).toBe('function');
      expect(typeof api.extDeleteProgram).toBe('function');
    });
  });

  describe('API method calls', () => {
    // Use the api captured in beforeAll
    beforeEach(() => {
      // Clear mock call counts but keep the api reference
      ipcRenderer.invoke.mockClear();
      ipcRenderer.on.mockClear();
    });

    describe('State Management', () => {
      test('saveState invokes correct IPC channel', async () => {
        const testState = { test: 'data' };
        await api.saveState(testState);
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('save-state', testState);
      });

      test('loadState invokes correct IPC channel', async () => {
        await api.loadState();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('load-state');
      });

      test('saveObjectData invokes correct IPC channel with args', async () => {
        await api.saveObjectData('obj1', 'pdf', 'data:...');
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('save-object-data', 'obj1', 'pdf', 'data:...');
      });

      test('loadObjectData invokes correct IPC channel with args', async () => {
        await api.loadObjectData('obj1', 'pdf');
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('load-object-data', 'obj1', 'pdf');
      });
    });

    describe('FFmpeg', () => {
      test('getFfmpegStatus invokes correct IPC channel', async () => {
        await api.getFfmpegStatus();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-ffmpeg-status');
      });

      test('onFfmpegStatus registers callback on channel', () => {
        const callback = jest.fn();
        api.onFfmpegStatus(callback);
        expect(ipcRenderer.on).toHaveBeenCalledWith('ffmpeg-status', expect.any(Function));
      });

      test('transcodeAudio invokes correct IPC channel with args', async () => {
        await api.transcodeAudio('base64data', 'test.flac');
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('transcode-audio', 'base64data', 'test.flac');
      });
    });

    describe('Cassette Player', () => {
      test('selectMusicFolder invokes correct IPC channel', async () => {
        await api.selectMusicFolder();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('select-music-folder');
      });

      test('selectMusicFile invokes correct IPC channel', async () => {
        await api.selectMusicFile();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('select-music-file');
      });

      test('readAudioFile invokes correct IPC channel with path', async () => {
        await api.readAudioFile('/path/to/audio.mp3');
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('read-audio-file', '/path/to/audio.mp3');
      });

      test('refreshMusicFolder invokes correct IPC channel with path', async () => {
        await api.refreshMusicFolder('/path/to/music');
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('refresh-music-folder', '/path/to/music');
      });
    });

    describe('Sound Selection', () => {
      test('selectSoundFile invokes correct IPC channel', async () => {
        await api.selectSoundFile();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('select-sound-file');
      });
    });

    describe('Dictaphone', () => {
      test('selectRecordingsFolder invokes correct IPC channel with format', async () => {
        await api.selectRecordingsFolder('wav');
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('select-recordings-folder', 'wav');
      });

      test('saveRecording invokes correct IPC channel with all args', async () => {
        await api.saveRecording('/path', 1, 'base64data', 'wav', 'webm');
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('save-recording', '/path', 1, 'base64data', 'wav', 'webm');
      });

      test('getNextRecordingNumber invokes correct IPC channel with path', async () => {
        await api.getNextRecordingNumber('/path');
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-next-recording-number', '/path');
      });
    });

    describe('Markdown Editor', () => {
      test('getDefaultNotesFolder invokes correct IPC channel', async () => {
        await api.getDefaultNotesFolder();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-default-notes-folder');
      });

      test('selectNotesFolder invokes correct IPC channel', async () => {
        await api.selectNotesFolder();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('select-notes-folder');
      });

      test('saveMarkdownFile invokes correct IPC channel with args', async () => {
        await api.saveMarkdownFile('/path', 'note.md', '# Hello');
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('save-markdown-file', '/path', 'note.md', '# Hello');
      });
    });

    describe('Pen Drawing', () => {
      test('getDefaultDrawingsFolder invokes correct IPC channel', async () => {
        await api.getDefaultDrawingsFolder();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-default-drawings-folder');
      });

      test('selectDrawingsFolder invokes correct IPC channel', async () => {
        await api.selectDrawingsFolder();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('select-drawings-folder');
      });

      test('saveDrawingFile invokes correct IPC channel with args', async () => {
        await api.saveDrawingFile('/path', 'drawing.png', 'data:image/png;base64,...');
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('save-drawing-file', '/path', 'drawing.png', 'data:image/png;base64,...');
      });

      test('deleteDrawingFile invokes correct IPC channel with path', async () => {
        await api.deleteDrawingFile('/path/to/drawing.png');
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('delete-drawing-file', '/path/to/drawing.png');
      });
    });

    describe('Activity Log', () => {
      test('startLogRecording invokes correct IPC channel with header', async () => {
        await api.startLogRecording('Session Header');
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('start-log-recording', 'Session Header');
      });

      test('appendLogEntry invokes correct IPC channel with entry', async () => {
        await api.appendLogEntry('Log entry text');
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('append-log-entry', 'Log entry text');
      });

      test('stopLogRecording invokes correct IPC channel', async () => {
        await api.stopLogRecording();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('stop-log-recording');
      });

      test('isLogRecording invokes correct IPC channel', async () => {
        await api.isLogRecording();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('is-log-recording');
      });
    });

    describe('Window Settings', () => {
      test('setFullscreenBorderless invokes correct IPC channel', async () => {
        await api.setFullscreenBorderless(true);
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('set-fullscreen-borderless', true);
      });

      test('setIgnoreShortcuts invokes correct IPC channel', async () => {
        await api.setIgnoreShortcuts(true);
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('set-ignore-shortcuts', true);
      });

      test('setMuteOtherApps invokes correct IPC channel', async () => {
        await api.setMuteOtherApps(true);
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('set-mute-other-apps', true);
      });
    });

    describe('Application Control', () => {
      test('quitApplication invokes correct IPC channel', async () => {
        await api.quitApplication();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('quit-application');
      });
    });

    describe('Extensibility - Models', () => {
      test('extSelectModelFile invokes correct IPC channel', async () => {
        await api.extSelectModelFile();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('ext-select-model-file');
      });

      test('extSelectModelFolder invokes correct IPC channel', async () => {
        await api.extSelectModelFolder();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('ext-select-model-folder');
      });

      test('extLoadModels invokes correct IPC channel', async () => {
        await api.extLoadModels();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('ext-load-models');
      });

      test('extDeleteModel invokes correct IPC channel with modelId', async () => {
        await api.extDeleteModel('test-model');
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('ext-delete-model', 'test-model');
      });

      test('extSaveModel invokes correct IPC channel with modelData', async () => {
        const modelData = { id: 'test', name: 'Test' };
        await api.extSaveModel(modelData);
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('ext-save-model', modelData);
      });

      test('extExportModel invokes correct IPC channel with modelData', async () => {
        const modelData = { id: 'test', name: 'Test' };
        await api.extExportModel(modelData);
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('ext-export-model', modelData);
      });
    });

    describe('Extensibility - Programs', () => {
      test('extSelectProgram invokes correct IPC channel', async () => {
        await api.extSelectProgram();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('ext-select-program');
      });

      test('extSelectProgramFolder invokes correct IPC channel', async () => {
        await api.extSelectProgramFolder();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('ext-select-program-folder');
      });

      test('extLoadPrograms invokes correct IPC channel', async () => {
        await api.extLoadPrograms();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('ext-load-programs');
      });

      test('extDeleteProgram invokes correct IPC channel with programId', async () => {
        await api.extDeleteProgram('test-program');
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('ext-delete-program', 'test-program');
      });
    });
  });
});
