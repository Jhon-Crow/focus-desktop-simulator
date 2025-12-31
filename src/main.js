const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

let mainWindow;

function createWindow() {
  // Get primary display dimensions for fullscreen window mode
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    minWidth: 800,
    minHeight: 600,
    title: 'Focus Desktop Simulator',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#1a1a2e',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Show window when ready to prevent visual flash
  // Maximize the window for fullscreen mode
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Open DevTools in development mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers for saving/loading state
ipcMain.handle('save-state', async (event, state) => {
  const userDataPath = app.getPath('userData');
  const statePath = path.join(userDataPath, 'desk-state.json');

  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-state', async () => {
  const userDataPath = app.getPath('userData');
  const statePath = path.join(userDataPath, 'desk-state.json');

  try {
    if (fs.existsSync(statePath)) {
      const data = fs.readFileSync(statePath, 'utf8');
      return { success: true, state: JSON.parse(data) };
    }
    return { success: true, state: null };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Separate handler for large data (PDF, cover images) to avoid lag during position saves
ipcMain.handle('save-object-data', async (event, objectId, dataType, dataUrl) => {
  const userDataPath = app.getPath('userData');
  const dataDir = path.join(userDataPath, 'object-data');

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dataPath = path.join(dataDir, `${objectId}-${dataType}.data`);

  try {
    if (dataUrl) {
      fs.writeFileSync(dataPath, dataUrl);
    } else {
      // Delete the file if dataUrl is null
      if (fs.existsSync(dataPath)) {
        fs.unlinkSync(dataPath);
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-object-data', async (event, objectId, dataType) => {
  const userDataPath = app.getPath('userData');
  const dataPath = path.join(userDataPath, 'object-data', `${objectId}-${dataType}.data`);

  try {
    if (fs.existsSync(dataPath)) {
      const data = fs.readFileSync(dataPath, 'utf8');
      return { success: true, data };
    }
    return { success: true, data: null };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============================================================================
// AUDIO TRANSCODING
// ============================================================================
// This handler transcodes audio files to WAV PCM format using FFmpeg.
// If FFmpeg is not available on the system, it returns an error telling
// the user to install FFmpeg or convert the file manually.

// Check if FFmpeg is available on the system
function checkFfmpegAvailable() {
  return new Promise((resolve) => {
    const ffmpegCmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    exec(ffmpegCmd, (error) => {
      resolve(!error);
    });
  });
}

// Transcode audio file to WAV PCM format using FFmpeg
function transcodeToWavWithFfmpeg(inputPath, outputPath, maxDurationSeconds = 10) {
  return new Promise((resolve, reject) => {
    // FFmpeg command to convert to 16-bit PCM WAV, mono, 44100Hz
    // -t limits duration, -ac 1 makes mono, -ar 44100 sets sample rate
    const args = [
      '-i', inputPath,
      '-t', String(maxDurationSeconds),
      '-acodec', 'pcm_s16le',  // 16-bit PCM
      '-ar', '44100',          // 44.1kHz sample rate
      '-ac', '1',              // Mono (to reduce file size)
      '-y',                    // Overwrite output file
      outputPath
    ];

    console.log('FFmpeg transcoding:', args.join(' '));

    const ffmpeg = spawn('ffmpeg', args);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log('FFmpeg transcoding successful');
        resolve();
      } else {
        console.error('FFmpeg error:', stderr);
        reject(new Error(`FFmpeg failed with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`FFmpeg not found or failed to start: ${err.message}`));
    });
  });
}

// IPC handler for transcoding audio files
ipcMain.handle('transcode-audio', async (event, audioDataBase64, fileName) => {
  console.log('transcode-audio called for:', fileName);

  try {
    // Check if FFmpeg is available
    const ffmpegAvailable = await checkFfmpegAvailable();

    if (!ffmpegAvailable) {
      return {
        success: false,
        error: 'FFmpeg not found. Please install FFmpeg to enable audio transcoding. ' +
               'Alternatively, convert your audio file to WAV (16-bit PCM) or MP3 format manually.',
        ffmpegMissing: true
      };
    }

    // Create temp files for input and output
    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const ext = path.extname(fileName) || '.audio';
    const inputPath = path.join(tempDir, `audio-input-${timestamp}${ext}`);
    const outputPath = path.join(tempDir, `audio-output-${timestamp}.wav`);

    // Write input file from base64
    const inputBuffer = Buffer.from(audioDataBase64, 'base64');
    fs.writeFileSync(inputPath, inputBuffer);
    console.log('Wrote input file:', inputPath, 'size:', inputBuffer.length);

    // Transcode to WAV
    await transcodeToWavWithFfmpeg(inputPath, outputPath);

    // Read output file
    const outputBuffer = fs.readFileSync(outputPath);
    const outputBase64 = outputBuffer.toString('base64');
    console.log('Transcoded output size:', outputBuffer.length, 'bytes');

    // Clean up temp files
    try {
      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputPath);
    } catch (e) {
      console.warn('Failed to clean up temp files:', e.message);
    }

    return {
      success: true,
      wavDataBase64: outputBase64,
      originalFileName: fileName
    };

  } catch (error) {
    console.error('Audio transcoding error:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// ============================================================================
// CASSETTE PLAYER - Music Folder Selection and Audio File Reading
// ============================================================================

// Supported audio extensions for the cassette player
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.webm', '.opus'];

// Open folder selection dialog and return audio files in the folder
ipcMain.handle('select-music-folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Music Folder'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, canceled: true };
    }

    const folderPath = result.filePaths[0];

    // Read all audio files from the folder
    const files = fs.readdirSync(folderPath);
    const audioFiles = files
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return AUDIO_EXTENSIONS.includes(ext);
      })
      .map(file => ({
        name: path.basename(file, path.extname(file)), // Name without extension
        fullName: file,
        path: path.join(folderPath, file)
      }))
      .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically

    return {
      success: true,
      folderPath: folderPath,
      audioFiles: audioFiles
    };
  } catch (error) {
    console.error('Error selecting music folder:', error);
    return { success: false, error: error.message };
  }
});

// Read audio file and return as base64 data URL
ipcMain.handle('read-audio-file', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }

    const ext = path.extname(filePath).toLowerCase();
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');

    // Determine MIME type
    const mimeTypes = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.aac': 'audio/aac',
      '.m4a': 'audio/mp4',
      '.webm': 'audio/webm',
      '.opus': 'audio/opus'
    };

    const mimeType = mimeTypes[ext] || 'audio/mpeg';
    const dataUrl = `data:${mimeType};base64,${base64}`;

    return {
      success: true,
      dataUrl: dataUrl,
      fileName: path.basename(filePath)
    };
  } catch (error) {
    console.error('Error reading audio file:', error);
    return { success: false, error: error.message };
  }
});

// Refresh music folder - re-scan for audio files
ipcMain.handle('refresh-music-folder', async (event, folderPath) => {
  try {
    if (!fs.existsSync(folderPath)) {
      return { success: false, error: 'Folder not found' };
    }

    const files = fs.readdirSync(folderPath);
    const audioFiles = files
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return AUDIO_EXTENSIONS.includes(ext);
      })
      .map(file => ({
        name: path.basename(file, path.extname(file)),
        fullName: file,
        path: path.join(folderPath, file)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      success: true,
      audioFiles: audioFiles
    };
  } catch (error) {
    console.error('Error refreshing music folder:', error);
    return { success: false, error: error.message };
  }
});
