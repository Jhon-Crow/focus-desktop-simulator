const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

let mainWindow;
let ffmpegAvailable = false; // Global FFmpeg availability status

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

// ============================================================================
// FFMPEG INSTALLATION
// ============================================================================

// Try to install FFmpeg automatically based on platform
async function tryInstallFfmpeg() {
  return new Promise((resolve) => {
    const platform = process.platform;
    console.log('Attempting to auto-install FFmpeg on platform:', platform);

    let installCommand = null;

    if (platform === 'win32') {
      // Windows: Try winget first, then choco
      // Note: winget requires admin rights, so this may not work
      installCommand = 'winget install --id=Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements';
    } else if (platform === 'darwin') {
      // macOS: Try brew
      installCommand = 'brew install ffmpeg';
    } else if (platform === 'linux') {
      // Linux: Try apt-get (works for Debian/Ubuntu)
      // Use sudo with DEBIAN_FRONTEND=noninteractive for non-interactive install
      installCommand = 'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg';
    }

    if (!installCommand) {
      console.log('No auto-install method available for platform:', platform);
      resolve(false);
      return;
    }

    console.log('Running FFmpeg install command:', installCommand);

    exec(installCommand, { timeout: 300000 }, (error, stdout, stderr) => {
      if (error) {
        console.log('FFmpeg auto-install failed:', error.message);
        console.log('stderr:', stderr);
        resolve(false);
      } else {
        console.log('FFmpeg auto-install completed');
        console.log('stdout:', stdout);
        resolve(true);
      }
    });
  });
}

// Initialize FFmpeg status at app startup
async function initializeFfmpeg() {
  console.log('Checking FFmpeg availability at startup...');
  ffmpegAvailable = await checkFfmpegAvailable();
  console.log('Initial FFmpeg status:', ffmpegAvailable ? 'available' : 'not available');

  if (!ffmpegAvailable) {
    console.log('FFmpeg not found, attempting auto-installation...');
    const installSuccess = await tryInstallFfmpeg();

    if (installSuccess) {
      // Re-check after installation
      ffmpegAvailable = await checkFfmpegAvailable();
      console.log('FFmpeg status after install attempt:', ffmpegAvailable ? 'available' : 'still not available');
    }
  }

  // Send status to renderer when window is ready
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('ffmpeg-status', ffmpegAvailable);
    });
  }
}

app.whenReady().then(async () => {
  createWindow();
  await initializeFfmpeg();
});

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
// Uses 'ffmpeg -version' directly for more reliable cross-platform detection
function checkFfmpegAvailable() {
  return new Promise((resolve) => {
    // Try running ffmpeg directly - more reliable than 'where' or 'which'
    const ffmpeg = spawn('ffmpeg', ['-version']);

    ffmpeg.on('error', () => {
      // ffmpeg not found or not executable
      console.log('FFmpeg check: not available (spawn error)');
      resolve(false);
    });

    ffmpeg.on('close', (code) => {
      const available = code === 0;
      console.log('FFmpeg check:', available ? 'available' : 'not available', '(exit code:', code + ')');
      resolve(available);
    });

    // Kill the process after a short timeout if it hangs
    setTimeout(() => {
      ffmpeg.kill();
    }, 3000);
  });
}

// IPC handler to get current FFmpeg status
ipcMain.handle('get-ffmpeg-status', async () => {
  // Re-check in case FFmpeg was installed after app start
  ffmpegAvailable = await checkFfmpegAvailable();
  return { available: ffmpegAvailable };
});

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

// Recursively find all audio files in a folder and its subfolders
function findAudioFilesRecursively(folderPath, basePath = null) {
  if (!basePath) basePath = folderPath;

  const audioFiles = [];

  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subFiles = findAudioFilesRecursively(fullPath, basePath);
        audioFiles.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.includes(ext)) {
          // Calculate relative path from base folder for display
          const relativePath = path.relative(basePath, folderPath);
          const displayName = relativePath
            ? `${relativePath}/${path.basename(entry.name, ext)}`
            : path.basename(entry.name, ext);

          audioFiles.push({
            name: displayName,
            fullName: entry.name,
            path: fullPath
          });
        }
      }
    }
  } catch (err) {
    console.error('Error reading folder:', folderPath, err.message);
  }

  return audioFiles;
}

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

    // Read all audio files from the folder and its subfolders recursively
    const audioFiles = findAudioFilesRecursively(folderPath)
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

// Open file selection dialog to select a single audio file
ipcMain.handle('select-music-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Select Audio File',
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'webm', 'opus'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, canceled: true };
    }

    const filePath = result.filePaths[0];
    const fileName = path.basename(filePath);
    const nameWithoutExt = path.basename(filePath, path.extname(filePath));
    const folderPath = path.dirname(filePath);

    // Return single file as array with one element to match folder selection format
    const audioFiles = [{
      name: nameWithoutExt,
      fullName: fileName,
      path: filePath
    }];

    return {
      success: true,
      folderPath: folderPath,
      audioFiles: audioFiles,
      isSingleFile: true
    };
  } catch (error) {
    console.error('Error selecting music file:', error);
    return { success: false, error: error.message };
  }
});

// Open file selection dialog to select a sound file for custom sounds
ipcMain.handle('select-sound-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Select Sound File',
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'webm', 'opus'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, canceled: true };
    }

    const filePath = result.filePaths[0];
    const fileName = path.basename(filePath);

    // Read the file and return as base64 data URL
    const fileBuffer = fs.readFileSync(filePath);
    const base64 = fileBuffer.toString('base64');
    const ext = path.extname(filePath).toLowerCase().replace('.', '');

    // Map extension to MIME type
    const mimeTypes = {
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'ogg': 'audio/ogg',
      'flac': 'audio/flac',
      'aac': 'audio/aac',
      'm4a': 'audio/mp4',
      'webm': 'audio/webm',
      'opus': 'audio/opus'
    };

    const mimeType = mimeTypes[ext] || 'audio/mpeg';
    const dataUrl = `data:${mimeType};base64,${base64}`;

    return {
      success: true,
      fileName: fileName,
      dataUrl: dataUrl
    };
  } catch (error) {
    console.error('Error selecting sound file:', error);
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

// Refresh music folder - re-scan for audio files (including subfolders)
ipcMain.handle('refresh-music-folder', async (event, folderPath) => {
  try {
    if (!fs.existsSync(folderPath)) {
      return { success: false, error: 'Folder not found' };
    }

    // Read all audio files from the folder and its subfolders recursively
    const audioFiles = findAudioFilesRecursively(folderPath)
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

// ============================================================================
// DICTAPHONE - Recording folder selection and audio saving
// ============================================================================

// Select folder for saving recordings
ipcMain.handle('select-recordings-folder', async (event, format = 'wav') => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Recordings Folder'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, canceled: true };
    }

    const folderPath = result.filePaths[0];

    // Count existing recordings to determine next number
    // Check for .wav, .mp3, and .webm files
    const files = fs.readdirSync(folderPath);
    const recordingPattern = /^Запись (\d+)\.(wav|mp3|webm)$/;
    let maxNumber = 0;

    files.forEach(file => {
      const match = file.match(recordingPattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNumber) maxNumber = num;
      }
    });

    return {
      success: true,
      folderPath: folderPath,
      nextRecordingNumber: maxNumber + 1
    };
  } catch (error) {
    console.error('Error selecting recordings folder:', error);
    return { success: false, error: error.message };
  }
});

// Convert webm audio to WAV format using FFmpeg
async function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-acodec', 'pcm_s16le',  // 16-bit PCM
      '-ar', '44100',          // 44.1kHz sample rate
      '-ac', '2',              // Stereo
      '-y',                    // Overwrite output file
      outputPath
    ];

    console.log('FFmpeg converting to WAV:', args.join(' '));

    const ffmpeg = spawn('ffmpeg', args);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log('FFmpeg WAV conversion successful');
        resolve();
      } else {
        console.error('FFmpeg WAV conversion error:', stderr);
        reject(new Error(`FFmpeg failed with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`FFmpeg not found or failed to start: ${err.message}`));
    });
  });
}

// Convert audio (WAV or webm) to MP3 format using FFmpeg
async function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-acodec', 'libmp3lame',
      '-b:a', '192k',          // 192kbps bitrate
      '-ar', '44100',          // 44.1kHz sample rate
      '-ac', '2',              // Stereo
      '-y',                    // Overwrite output file
      outputPath
    ];

    console.log('FFmpeg converting to MP3:', args.join(' '));

    const ffmpeg = spawn('ffmpeg', args);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log('FFmpeg MP3 conversion successful');
        resolve();
      } else {
        console.error('FFmpeg MP3 conversion error:', stderr);
        reject(new Error(`FFmpeg failed with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`FFmpeg not found or failed to start: ${err.message}`));
    });
  });
}

// Save recording to file
// Audio data is always in WebM format from MediaRecorder
// format: 'wav', 'mp3', or 'webm' - the desired output format
// dataFormat: 'webm' (default) or 'wav' - indicates what format the input data is in
// - WebM format: saves directly without conversion (no FFmpeg required)
// - WAV/MP3 format: requires FFmpeg for conversion from WebM
ipcMain.handle('save-recording', async (event, folderPath, recordingNumber, audioDataBase64, format = 'wav', dataFormat = 'webm') => {
  console.log('=== save-recording IPC START ===');
  console.log('  folderPath:', folderPath);
  console.log('  recordingNumber:', recordingNumber);
  console.log('  format:', format);
  console.log('  dataFormat:', dataFormat);
  console.log('  audioDataBase64 length:', audioDataBase64?.length || 0);

  try {
    if (!fs.existsSync(folderPath)) {
      console.error('Folder not found:', folderPath);
      return { success: false, error: 'Folder not found: ' + folderPath };
    }
    console.log('Folder exists, creating audio buffer...');

    const audioBuffer = Buffer.from(audioDataBase64, 'base64');
    console.log('Audio buffer created, size:', audioBuffer.length, 'bytes');

    // If data is already WAV (browser-converted), save directly
    if (dataFormat === 'wav' && format === 'wav') {
      const fileName = `Запись ${recordingNumber}.wav`;
      const filePath = path.join(folderPath, fileName);
      fs.writeFileSync(filePath, audioBuffer);
      console.log('WAV file saved directly (browser-converted):', filePath);
      return {
        success: true,
        filePath: filePath,
        fileName: fileName,
        actualFormat: 'wav'
      };
    }

    // If user explicitly selected WebM format, save directly without FFmpeg
    if (format === 'webm') {
      const fileName = `Запись ${recordingNumber}.webm`;
      const filePath = path.join(folderPath, fileName);
      fs.writeFileSync(filePath, audioBuffer);
      console.log('WebM file saved directly (no conversion needed):', filePath);
      return {
        success: true,
        filePath: filePath,
        fileName: fileName,
        actualFormat: 'webm'
      };
    }

    // For WAV or MP3, we need FFmpeg to convert from WebM
    // Write to temp file
    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const inputExt = dataFormat === 'wav' ? 'wav' : 'webm';
    const tempInputPath = path.join(tempDir, `recording-input-${timestamp}.${inputExt}`);
    fs.writeFileSync(tempInputPath, audioBuffer);
    console.log(`Temp ${inputExt.toUpperCase()} file written:`, tempInputPath);

    // Check if FFmpeg is available for conversion
    const ffmpegAvailable = await checkFfmpegAvailable();

    if (ffmpegAvailable) {
      // Determine output format and file name
      const outputFormat = format === 'mp3' ? 'mp3' : 'wav';
      const fileName = `Запись ${recordingNumber}.${outputFormat}`;
      const filePath = path.join(folderPath, fileName);

      console.log('Converting to', outputFormat.toUpperCase(), '...');
      console.log('  Input file size:', audioBuffer.length, 'bytes');
      console.log('  Output path:', filePath);

      // Convert webm to wav or mp3 using FFmpeg
      let ffmpegStderr = '';
      try {
        await new Promise((resolve, reject) => {
          const ffmpegArgs = outputFormat === 'mp3'
            ? ['-i', tempInputPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', '-y', filePath]
            : ['-i', tempInputPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '1', '-y', filePath];

          console.log('Running FFmpeg:', 'ffmpeg', ffmpegArgs.join(' '));

          const ffmpeg = spawn('ffmpeg', ffmpegArgs);

          ffmpeg.stderr.on('data', (data) => {
            ffmpegStderr += data.toString();
          });

          ffmpeg.on('close', (code) => {
            if (code === 0) {
              console.log('FFmpeg conversion finished with code 0');
              resolve();
            } else {
              console.error('FFmpeg conversion failed with code:', code);
              console.error('FFmpeg stderr (last 1000 chars):', ffmpegStderr.slice(-1000));
              reject(new Error(`FFmpeg exited with code ${code}: ${ffmpegStderr.slice(-200)}`));
            }
          });

          ffmpeg.on('error', (err) => {
            console.error('FFmpeg spawn error:', err.message);
            reject(new Error(`Failed to run FFmpeg: ${err.message}`));
          });
        });
      } catch (ffmpegError) {
        // FFmpeg failed - fall back to webm
        console.error('FFmpeg conversion failed:', ffmpegError.message);

        // Save as webm instead
        const webmFileName = `Запись ${recordingNumber}.webm`;
        const webmFilePath = path.join(folderPath, webmFileName);
        fs.copyFileSync(tempInputPath, webmFilePath);

        // Clean up temp file
        try {
          fs.unlinkSync(tempInputPath);
        } catch (e) {
          console.warn('Failed to clean up temp file:', e.message);
        }

        console.log('Saved as WebM (fallback due to FFmpeg error):', webmFilePath);
        return {
          success: true,
          filePath: webmFilePath,
          fileName: webmFileName,
          actualFormat: 'webm',
          message: `Saved as WebM. FFmpeg conversion failed: ${ffmpegError.message}`
        };
      }

      // Verify output file was created
      if (!fs.existsSync(filePath)) {
        console.error('FFmpeg finished but output file not found:', filePath);

        // Save as webm instead
        const webmFileName = `Запись ${recordingNumber}.webm`;
        const webmFilePath = path.join(folderPath, webmFileName);
        fs.copyFileSync(tempInputPath, webmFilePath);

        // Clean up temp file
        try {
          fs.unlinkSync(tempInputPath);
        } catch (e) {
          console.warn('Failed to clean up temp file:', e.message);
        }

        return {
          success: true,
          filePath: webmFilePath,
          fileName: webmFileName,
          actualFormat: 'webm',
          message: 'Saved as WebM. FFmpeg conversion produced no output file.'
        };
      }

      // Check output file size
      const outputStats = fs.statSync(filePath);
      console.log('Output file created, size:', outputStats.size, 'bytes');

      if (outputStats.size === 0) {
        console.error('FFmpeg produced empty output file');

        // Delete empty file and save as webm
        fs.unlinkSync(filePath);
        const webmFileName = `Запись ${recordingNumber}.webm`;
        const webmFilePath = path.join(folderPath, webmFileName);
        fs.copyFileSync(tempInputPath, webmFilePath);

        // Clean up temp file
        try {
          fs.unlinkSync(tempInputPath);
        } catch (e) {
          console.warn('Failed to clean up temp file:', e.message);
        }

        return {
          success: true,
          filePath: webmFilePath,
          fileName: webmFileName,
          actualFormat: 'webm',
          message: 'Saved as WebM. FFmpeg produced empty output file.'
        };
      }

      // Clean up temp file
      try {
        fs.unlinkSync(tempInputPath);
      } catch (e) {
        console.warn('Failed to clean up temp file:', e.message);
      }

      console.log(`Recording saved as ${outputFormat.toUpperCase()}:`, filePath);
      return {
        success: true,
        filePath: filePath,
        fileName: fileName,
        actualFormat: outputFormat
      };
    } else {
      // FFmpeg not available
      // If we have WAV data and need MP3, save as WAV instead
      // If we have WebM data, save as WebM
      let outputExt, message;

      if (dataFormat === 'wav') {
        // We already have WAV data from browser conversion
        outputExt = 'wav';
        message = format === 'mp3'
          ? 'Saved as WAV. Install FFmpeg for MP3 conversion.'
          : null;
      } else {
        // We have WebM data, save as WebM
        outputExt = 'webm';
        message = 'Saved as WebM. Install FFmpeg for WAV/MP3 format.';
      }

      const fileName = `Запись ${recordingNumber}.${outputExt}`;
      const filePath = path.join(folderPath, fileName);

      // Copy temp file to final location (use copy+delete instead of rename for cross-device support)
      fs.copyFileSync(tempInputPath, filePath);
      try {
        fs.unlinkSync(tempInputPath);
      } catch (e) {
        console.warn('Failed to clean up temp file:', e.message);
      }
      console.log(`Recording saved as ${outputExt.toUpperCase()} (FFmpeg not installed):`, filePath);

      return {
        success: true,
        filePath: filePath,
        fileName: fileName,
        actualFormat: outputExt,
        message: message
      };
    }
  } catch (error) {
    console.error('Error saving recording:', error);
    return { success: false, error: error.message };
  }
});

// Get next recording number for a folder
ipcMain.handle('get-next-recording-number', async (event, folderPath) => {
  try {
    if (!fs.existsSync(folderPath)) {
      return { success: false, error: 'Folder not found' };
    }

    const files = fs.readdirSync(folderPath);
    // Check for .wav, .mp3, and .webm files
    const recordingPattern = /^Запись (\d+)\.(wav|mp3|webm)$/;
    let maxNumber = 0;

    files.forEach(file => {
      const match = file.match(recordingPattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNumber) maxNumber = num;
      }
    });

    return {
      success: true,
      nextNumber: maxNumber + 1
    };
  } catch (error) {
    console.error('Error getting next recording number:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// MARKDOWN EDITOR - Notes Folder Selection and Saving
// ============================================================================

// Get default notes folder path (app working directory)
ipcMain.handle('get-default-notes-folder', async () => {
  const userDataPath = app.getPath('userData');
  const notesDir = path.join(userDataPath, 'notes');

  // Ensure default notes directory exists
  if (!fs.existsSync(notesDir)) {
    fs.mkdirSync(notesDir, { recursive: true });
  }

  return { success: true, folderPath: notesDir };
});

// Open folder selection dialog for notes
ipcMain.handle('select-notes-folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Notes Folder'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, canceled: true };
    }

    const folderPath = result.filePaths[0];

    return {
      success: true,
      folderPath: folderPath
    };
  } catch (error) {
    console.error('Error selecting notes folder:', error);
    return { success: false, error: error.message };
  }
});

// Save markdown file to the notes folder
ipcMain.handle('save-markdown-file', async (event, folderPath, fileName, content) => {
  try {
    // Ensure folder exists
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    // Ensure filename has .md extension
    if (!fileName.endsWith('.md')) {
      fileName = fileName + '.md';
    }

    const filePath = path.join(folderPath, fileName);
    fs.writeFileSync(filePath, content, 'utf8');

    return {
      success: true,
      filePath: filePath
    };
  } catch (error) {
    console.error('Error saving markdown file:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// ACTIVITY LOG - Live Log Recording to File
// ============================================================================

// Global log file stream for live logging
let logFileStream = null;
let logFilePath = null;

// Start live log recording - opens file dialog and creates write stream
ipcMain.handle('start-log-recording', async (event, headerContent) => {
  try {
    // If already recording, stop first
    if (logFileStream) {
      logFileStream.end();
      logFileStream = null;
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Select Log File Location',
      defaultPath: `activity-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { success: true, canceled: true };
    }

    logFilePath = result.filePath;

    // Create write stream with append mode
    logFileStream = fs.createWriteStream(logFilePath, { flags: 'w' });

    // Write header
    if (headerContent) {
      logFileStream.write(headerContent + '\n\n');
    }

    console.log('Log recording started:', logFilePath);

    return {
      success: true,
      filePath: logFilePath
    };
  } catch (error) {
    console.error('Error starting log recording:', error);
    return { success: false, error: error.message };
  }
});

// Append log entry to the recording file
ipcMain.handle('append-log-entry', async (event, logEntry) => {
  try {
    if (!logFileStream) {
      return { success: false, error: 'Log recording not started' };
    }

    logFileStream.write(logEntry + '\n\n');

    return { success: true };
  } catch (error) {
    console.error('Error appending log entry:', error);
    return { success: false, error: error.message };
  }
});

// Stop log recording - closes the write stream
ipcMain.handle('stop-log-recording', async () => {
  try {
    if (logFileStream) {
      // Write session end marker
      const endTime = new Date().toISOString();
      logFileStream.write(`\n${'='.repeat(80)}\n\nSession ended: ${endTime}\n`);

      logFileStream.end();

      const filePath = logFilePath;
      logFileStream = null;
      logFilePath = null;

      console.log('Log recording stopped:', filePath);

      return {
        success: true,
        filePath: filePath
      };
    }

    return { success: true };
  } catch (error) {
    console.error('Error stopping log recording:', error);
    return { success: false, error: error.message };
  }
});

// Check if log recording is active
ipcMain.handle('is-log-recording', async () => {
  return {
    success: true,
    isRecording: logFileStream !== null,
    filePath: logFilePath
  };
});

// ============================================================================
// PEN DRAWING - Drawings Folder Selection and Saving
// ============================================================================

// Get default drawings folder path (app working directory)
ipcMain.handle('get-default-drawings-folder', async () => {
  const userDataPath = app.getPath('userData');
  const drawingsDir = path.join(userDataPath, 'drawings');

  // Ensure default drawings directory exists
  if (!fs.existsSync(drawingsDir)) {
    fs.mkdirSync(drawingsDir, { recursive: true });
  }

  return { success: true, folderPath: drawingsDir };
});

// Open folder selection dialog for drawings
ipcMain.handle('select-drawings-folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Drawings Folder'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, canceled: true };
    }

    const folderPath = result.filePaths[0];

    return {
      success: true,
      folderPath: folderPath
    };
  } catch (error) {
    console.error('Error selecting drawings folder:', error);
    return { success: false, error: error.message };
  }
});

// Save drawing file (PNG) to the drawings folder
ipcMain.handle('save-drawing-file', async (event, folderPath, fileName, dataUrl) => {
  try {
    // Ensure folder exists
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    // Ensure filename has .png extension
    if (!fileName.endsWith('.png')) {
      fileName = fileName + '.png';
    }

    const filePath = path.join(folderPath, fileName);

    // Extract base64 data from data URL
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    fs.writeFileSync(filePath, buffer);

    return {
      success: true,
      filePath: filePath
    };
  } catch (error) {
    console.error('Error saving drawing file:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================================
// WINDOW SETTINGS
// ============================================================================

// Toggle fullscreen borderless mode
ipcMain.handle('set-fullscreen-borderless', async (event, enabled) => {
  try {
    if (!mainWindow) {
      return { success: false, error: 'Window not available' };
    }

    if (enabled) {
      // Enter fullscreen borderless mode
      // Hide menu bar first (File, Edit, View, Window, Help)
      mainWindow.setMenuBarVisibility(false);
      mainWindow.setAutoHideMenuBar(true);
      mainWindow.setFullScreen(true);
    } else {
      // Exit fullscreen mode
      mainWindow.setFullScreen(false);
      // Restore menu bar visibility
      mainWindow.setAutoHideMenuBar(false);
      mainWindow.setMenuBarVisibility(true);
    }

    console.log('Fullscreen borderless mode:', enabled);
    return { success: true };
  } catch (error) {
    console.error('Error setting fullscreen borderless:', error);
    return { success: false, error: error.message };
  }
});

// Track if keyboard hook is enabled
let keyboardHookEnabled = false;
let keyboardHookProcess = null;

// PowerShell script for low-level keyboard hook to block system keys
// This uses SetWindowsHookEx with WH_KEYBOARD_LL to intercept keys before Windows processes them
// Uses Application.Run() for proper message loop handling
function getKeyboardHookScript() {
  return `
$ErrorActionPreference = "Stop"

try {
    Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class KeyboardHook {
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;

    // Virtual key codes
    private const int VK_TAB = 0x09;
    private const int VK_ESCAPE = 0x1B;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int VK_F4 = 0x73;
    private const int VK_LMENU = 0xA4; // Left Alt
    private const int VK_RMENU = 0xA5; // Right Alt
    private const int VK_MENU = 0x12;  // Generic Alt key

    private static IntPtr hookId = IntPtr.Zero;
    // Static delegate to prevent garbage collection
    private static LowLevelKeyboardProc procDelegate = HookCallback;

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    // KBDLLHOOKSTRUCT for proper data reading
    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT {
        public int vkCode;
        public int scanCode;
        public int flags;
        public int time;
        public IntPtr dwExtraInfo;
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            // Properly read the KBDLLHOOKSTRUCT
            KBDLLHOOKSTRUCT kbStruct = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            int vkCode = kbStruct.vkCode;
            int msg = wParam.ToInt32();
            bool isKeyDown = (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN);

            // Check if Alt is currently pressed using GetAsyncKeyState
            bool altPressed = (GetAsyncKeyState(VK_LMENU) & 0x8000) != 0 ||
                              (GetAsyncKeyState(VK_RMENU) & 0x8000) != 0 ||
                              (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;

            // Block Windows keys (both left and right) - block all events (down and up)
            if (vkCode == VK_LWIN || vkCode == VK_RWIN) {
                Console.WriteLine("BLOCKED: Windows key (vk=" + vkCode + ")");
                Console.Out.Flush();
                return (IntPtr)1;
            }

            // Block Alt+Tab (task switcher) - only need to block on key down
            if (vkCode == VK_TAB && (altPressed || msg == WM_SYSKEYDOWN)) {
                Console.WriteLine("BLOCKED: Alt+Tab");
                Console.Out.Flush();
                return (IntPtr)1;
            }

            // Block Alt+F4 (close window)
            if (vkCode == VK_F4 && (altPressed || msg == WM_SYSKEYDOWN)) {
                Console.WriteLine("BLOCKED: Alt+F4");
                Console.Out.Flush();
                return (IntPtr)1;
            }

            // Block Alt+Escape (window cycling)
            if (vkCode == VK_ESCAPE && (altPressed || msg == WM_SYSKEYDOWN)) {
                Console.WriteLine("BLOCKED: Alt+Escape");
                Console.Out.Flush();
                return (IntPtr)1;
            }
        }
        return CallNextHookEx(hookId, nCode, wParam, lParam);
    }

    public static void Start() {
        try {
            using (Process curProcess = Process.GetCurrentProcess())
            using (ProcessModule curModule = curProcess.MainModule) {
                IntPtr moduleHandle = GetModuleHandle(curModule.ModuleName);
                hookId = SetWindowsHookEx(WH_KEYBOARD_LL, procDelegate, moduleHandle, 0);
            }

            if (hookId == IntPtr.Zero) {
                int error = Marshal.GetLastWin32Error();
                Console.WriteLine("HOOK_FAILED: Error code " + error);
                Console.Out.Flush();
                return;
            }

            Console.WriteLine("HOOK_STARTED");
            Console.Out.Flush();

            // Use Application.Run() for proper message loop - this is the recommended approach
            // for low-level keyboard hooks in managed code
            Application.Run();

            // Cleanup when Application.Exit() is called
            if (hookId != IntPtr.Zero) {
                UnhookWindowsHookEx(hookId);
                hookId = IntPtr.Zero;
            }
            Console.WriteLine("HOOK_STOPPED");
            Console.Out.Flush();
        } catch (Exception ex) {
            Console.WriteLine("HOOK_ERROR: " + ex.Message);
            Console.Out.Flush();
        }
    }

    public static void Stop() {
        Application.Exit();
    }
}
"@ -ReferencedAssemblies System.Windows.Forms

    Write-Host "Starting keyboard hook..."
    [KeyboardHook]::Start()
} catch {
    Write-Host "HOOK_ERROR: $($_.Exception.Message)"
}
`;
}

// Start the keyboard hook process
function startKeyboardHook() {
  return new Promise((resolve, reject) => {
    if (keyboardHookProcess) {
      console.log('Keyboard hook already running');
      resolve({ success: true, alreadyRunning: true });
      return;
    }

    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const scriptPath = path.join(tempDir, `keyboard-hook-${timestamp}.ps1`);

    try {
      // Write script to temp file with UTF-8 BOM for proper PowerShell encoding
      const scriptContent = getKeyboardHookScript();
      const bom = Buffer.from([0xEF, 0xBB, 0xBF]); // UTF-8 BOM
      const content = Buffer.from(scriptContent, 'utf8');
      fs.writeFileSync(scriptPath, Buffer.concat([bom, content]));
      console.log('Keyboard hook script written to:', scriptPath);

      // Execute the script file - this will run until stopped
      keyboardHookProcess = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath
      ], {
        detached: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      let hookStarted = false;
      let allOutput = '';

      keyboardHookProcess.stdout.on('data', (data) => {
        const output = data.toString();
        allOutput += output;
        console.log('Keyboard hook output:', output.trim());
        if ((output.includes('HOOK_STARTED') || allOutput.includes('HOOK_STARTED')) && !hookStarted) {
          hookStarted = true;
          keyboardHookEnabled = true;
          resolve({ success: true });
        }
        if (output.includes('HOOK_FAILED') || output.includes('HOOK_ERROR')) {
          const errorMatch = output.match(/HOOK_(?:FAILED|ERROR):?\s*(.+)/);
          const errorMsg = errorMatch ? errorMatch[1] : output;
          console.error('Keyboard hook failed:', errorMsg);
          if (!hookStarted) {
            reject(new Error('Keyboard hook failed: ' + errorMsg));
          }
        }
      });

      keyboardHookProcess.stderr.on('data', (data) => {
        const errOutput = data.toString();
        console.error('Keyboard hook stderr:', errOutput);
        // Some PowerShell errors go to stderr
        if (!hookStarted && errOutput.length > 0) {
          allOutput += ' STDERR: ' + errOutput;
        }
      });

      keyboardHookProcess.on('close', (code) => {
        console.log('Keyboard hook process exited with code:', code);
        console.log('Full output was:', allOutput);
        keyboardHookProcess = null;
        keyboardHookEnabled = false;

        // Clean up temp file
        try {
          fs.unlinkSync(scriptPath);
        } catch (e) { }

        if (!hookStarted) {
          reject(new Error('Keyboard hook process ended before starting. Output: ' + allOutput.substring(0, 500)));
        }
      });

      keyboardHookProcess.on('error', (err) => {
        console.error('Keyboard hook process error:', err);
        keyboardHookProcess = null;
        keyboardHookEnabled = false;
        reject(err);
      });

      // Timeout if hook doesn't start in 15 seconds
      setTimeout(() => {
        if (!hookStarted) {
          console.log('Keyboard hook timeout. Output so far:', allOutput);
          if (keyboardHookProcess) {
            keyboardHookProcess.kill();
            keyboardHookProcess = null;
          }
          reject(new Error('Keyboard hook start timeout. Output: ' + allOutput.substring(0, 500)));
        }
      }, 15000);

    } catch (err) {
      // Clean up temp file on error
      try {
        fs.unlinkSync(scriptPath);
      } catch (e) { }
      reject(err);
    }
  });
}

// Stop the keyboard hook process
function stopKeyboardHook() {
  return new Promise((resolve) => {
    if (!keyboardHookProcess) {
      console.log('Keyboard hook not running');
      keyboardHookEnabled = false;
      resolve({ success: true, wasNotRunning: true });
      return;
    }

    try {
      // Kill the PowerShell process
      keyboardHookProcess.kill('SIGTERM');

      // Give it a moment to clean up
      setTimeout(() => {
        if (keyboardHookProcess) {
          keyboardHookProcess.kill('SIGKILL');
        }
        keyboardHookProcess = null;
        keyboardHookEnabled = false;
        console.log('Keyboard hook stopped');
        resolve({ success: true });
      }, 500);
    } catch (err) {
      console.error('Error stopping keyboard hook:', err);
      keyboardHookProcess = null;
      keyboardHookEnabled = false;
      resolve({ success: true, error: err.message });
    }
  });
}

// Toggle ignoring keyboard shortcuts (Alt+F4, Alt+Tab, Windows key, etc.)
// Uses a low-level keyboard hook on Windows to intercept system-level shortcuts
ipcMain.handle('set-ignore-shortcuts', async (event, enabled) => {
  try {
    if (!mainWindow) {
      return { success: false, error: 'Window not available' };
    }

    // On non-Windows platforms, use kiosk mode (limited effectiveness)
    if (process.platform !== 'win32') {
      if (enabled) {
        mainWindow.setKiosk(true);
        mainWindow.webContents.on('before-input-event', handleBeforeInputEvent);
        console.log('Keyboard shortcuts ignored (kiosk mode - limited on non-Windows)');
      } else {
        mainWindow.setKiosk(false);
        mainWindow.webContents.removeListener('before-input-event', handleBeforeInputEvent);
        console.log('Keyboard shortcuts enabled');
      }
      return { success: true };
    }

    // On Windows, use low-level keyboard hook
    if (enabled) {
      try {
        // Also enter fullscreen for better effect
        mainWindow.setFullScreen(true);
        mainWindow.setMenuBarVisibility(false);
        mainWindow.setAutoHideMenuBar(true);

        // Block app-level shortcuts
        mainWindow.webContents.on('before-input-event', handleBeforeInputEvent);

        // Start the keyboard hook to block system shortcuts
        await startKeyboardHook();
        console.log('Keyboard shortcuts ignored (low-level hook enabled)');
        return { success: true };
      } catch (err) {
        console.error('Failed to start keyboard hook:', err);
        // Still return success for partial functionality (fullscreen + app-level blocking)
        return {
          success: true,
          warning: 'System shortcuts (Alt+Tab, Win key) may not be fully blocked: ' + err.message
        };
      }
    } else {
      // Stop the keyboard hook
      await stopKeyboardHook();

      // Remove app-level handler
      mainWindow.webContents.removeListener('before-input-event', handleBeforeInputEvent);

      console.log('Keyboard shortcuts enabled');
      return { success: true };
    }
  } catch (error) {
    console.error('Error setting ignore shortcuts:', error);
    return { success: false, error: error.message };
  }
});

// Handler to block keyboard shortcuts at app level
function handleBeforeInputEvent(event, input) {
  // Block Alt+F4 (close window)
  if (input.alt && input.key === 'F4') {
    event.preventDefault();
    return;
  }

  // Block Alt+Tab at app level (backup)
  if (input.alt && input.key === 'Tab') {
    event.preventDefault();
    return;
  }

  // Block Win+D (show desktop) - Windows specific
  if (input.meta && input.key === 'd') {
    event.preventDefault();
    return;
  }

  // Block other common system shortcuts
  if (input.alt && input.key === 'Escape') {
    event.preventDefault();
    return;
  }

  // Block Escape key while shortcuts are being ignored
  if (input.key === 'Escape' && keyboardHookEnabled) {
    event.preventDefault();
    return;
  }
}

// Clean up keyboard hook when app quits
app.on('before-quit', async () => {
  if (keyboardHookProcess) {
    await stopKeyboardHook();
  }

  // If other apps are muted, unmute them before quitting
  if (otherAppsMuted && process.platform === 'win32') {
    console.log('Unmuting other applications before quit (before-quit handler)...');
    const baseScript = getAudioControlScriptContent();
    const unmuteScript = baseScript + '\n[AudioManager]::UnmuteAllApps()';

    try {
      await executePowerShellScript(unmuteScript);
      console.log('Other applications unmuted successfully (before-quit handler)');
      otherAppsMuted = false;
    } catch (err) {
      console.error('Failed to unmute applications on quit (before-quit handler):', err);
    }
  }
});

// Store muted state for other apps
let otherAppsMuted = false;

// Helper function to generate the PowerShell audio control script content
// Uses proper COM interop with [ComImport] CoClass pattern for MMDeviceEnumerator
function getAudioControlScriptContent() {
  return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

internal enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }
internal enum ERole { eConsole = 0, eMultimedia = 1, eCommunications = 2 }

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator {
    int NotImpl1();
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppDevice);
}

// CoClass for MMDeviceEnumerator - this is the proper way to instantiate COM objects
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumeratorCoClass {
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionManager2 {
    int NotImpl1();
    int NotImpl2();
    int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
}

[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionEnumerator {
    int GetCount(out int SessionCount);
    int GetSession(int SessionCount, out IAudioSessionControl Session);
}

[Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionControl {
    int NotImpl1();
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, [MarshalAs(UnmanagedType.LPStruct)] Guid EventContext);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, [MarshalAs(UnmanagedType.LPStruct)] Guid EventContext);
    int GetGroupingParam(out Guid pRetVal);
    int SetGroupingParam([MarshalAs(UnmanagedType.LPStruct)] Guid Override, [MarshalAs(UnmanagedType.LPStruct)] Guid EventContext);
    int NotImpl2();
    int NotImpl3();
}

[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionControl2 : IAudioSessionControl {
    new int NotImpl1();
    new int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    new int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, [MarshalAs(UnmanagedType.LPStruct)] Guid EventContext);
    new int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    new int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, [MarshalAs(UnmanagedType.LPStruct)] Guid EventContext);
    new int GetGroupingParam(out Guid pRetVal);
    new int SetGroupingParam([MarshalAs(UnmanagedType.LPStruct)] Guid Override, [MarshalAs(UnmanagedType.LPStruct)] Guid EventContext);
    new int NotImpl2();
    new int NotImpl3();
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int GetProcessId(out int pRetVal);
    int IsSystemSoundsSession();
    int SetDuckingPreference(bool optOut);
}

[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ISimpleAudioVolume {
    int SetMasterVolume(float fLevel, ref Guid EventContext);
    int GetMasterVolume(out float pfLevel);
    int SetMute(bool bMute, ref Guid EventContext);
    int GetMute(out bool pbMute);
}

public class AudioManager {
    // Get all PIDs in the process tree starting from the given PID
    private static System.Collections.Generic.HashSet<int> GetProcessTreePIDs(int rootPID) {
        var pids = new System.Collections.Generic.HashSet<int>();
        pids.Add(rootPID);

        try {
            var allProcesses = System.Diagnostics.Process.GetProcesses();
            bool foundNew = true;

            // Keep searching until no new child processes are found
            while (foundNew) {
                foundNew = false;
                foreach (var proc in allProcesses) {
                    try {
                        // Check if this process's parent is in our set
                        var parentId = GetParentProcessId(proc.Id);
                        if (parentId > 0 && pids.Contains(parentId) && !pids.Contains(proc.Id)) {
                            pids.Add(proc.Id);
                            foundNew = true;
                        }
                    } catch {
                        // Ignore processes we can't query
                    }
                }
            }
        } catch (Exception ex) {
            Console.WriteLine("Warning: Could not enumerate all child processes: " + ex.Message);
        }

        return pids;
    }

    // Get parent process ID using WMI
    private static int GetParentProcessId(int processId) {
        try {
            var searcher = new System.Management.ManagementObjectSearcher(
                "SELECT ParentProcessId FROM Win32_Process WHERE ProcessId = " + processId);
            foreach (System.Management.ManagementObject obj in searcher.Get()) {
                return Convert.ToInt32(obj["ParentProcessId"]);
            }
        } catch {
            // WMI query failed
        }
        return 0;
    }

    public static void MuteOtherApps(int excludePID) {
        try {
            // Get all PIDs in the Electron process tree (main, renderer, GPU, etc.)
            var electronPIDs = GetProcessTreePIDs(excludePID);
            Console.WriteLine("Electron process tree PIDs: " + string.Join(", ", electronPIDs));

            // Use proper CoClass instantiation - create instance of CoClass and cast to interface
            IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCoClass());

            IMMDevice device;
            int hr = enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device);
            if (hr != 0) {
                Console.WriteLine("ERROR: GetDefaultAudioEndpoint failed with HRESULT: " + hr);
                return;
            }

            Guid IID_IAudioSessionManager2 = typeof(IAudioSessionManager2).GUID;
            object o;
            hr = device.Activate(ref IID_IAudioSessionManager2, 0, IntPtr.Zero, out o);
            if (hr != 0) {
                Console.WriteLine("ERROR: Activate IAudioSessionManager2 failed with HRESULT: " + hr);
                return;
            }
            var mgr = (IAudioSessionManager2)o;

            IAudioSessionEnumerator sessionEnumerator;
            hr = mgr.GetSessionEnumerator(out sessionEnumerator);
            if (hr != 0) {
                Console.WriteLine("ERROR: GetSessionEnumerator failed with HRESULT: " + hr);
                return;
            }

            int count;
            sessionEnumerator.GetCount(out count);
            Console.WriteLine("Found " + count + " audio sessions");

            Guid guid = Guid.Empty;
            int mutedCount = 0;

            for (int i = 0; i < count; i++) {
                IAudioSessionControl ctl;
                sessionEnumerator.GetSession(i, out ctl);

                var ctl2 = ctl as IAudioSessionControl2;
                if (ctl2 != null) {
                    int pid = 0;
                    try {
                        ctl2.GetProcessId(out pid);
                    } catch {
                        continue;
                    }

                    // Skip if this is the Electron app (main or any child process) or system (PID 0)
                    if (electronPIDs.Contains(pid) || pid == 0) {
                        Console.WriteLine("Skipping PID: " + pid + " (our app or system)");
                        continue;
                    }

                    var vol = ctl as ISimpleAudioVolume;
                    if (vol != null) {
                        try {
                            vol.SetMute(true, ref guid);
                            mutedCount++;
                            Console.WriteLine("Muted PID: " + pid);
                        } catch (Exception ex) {
                            Console.WriteLine("Failed to mute PID " + pid + ": " + ex.Message);
                        }
                    }
                }
            }
            Console.WriteLine("Muted " + mutedCount + " applications");
            Console.WriteLine("SUCCESS");
        } catch (Exception ex) {
            Console.WriteLine("ERROR: " + ex.GetType().Name + " - " + ex.Message);
        }
    }

    public static void UnmuteAllApps() {
        try {
            // Use proper CoClass instantiation
            IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCoClass());

            IMMDevice device;
            int hr = enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device);
            if (hr != 0) {
                Console.WriteLine("ERROR: GetDefaultAudioEndpoint failed with HRESULT: " + hr);
                return;
            }

            Guid IID_IAudioSessionManager2 = typeof(IAudioSessionManager2).GUID;
            object o;
            hr = device.Activate(ref IID_IAudioSessionManager2, 0, IntPtr.Zero, out o);
            if (hr != 0) {
                Console.WriteLine("ERROR: Activate IAudioSessionManager2 failed with HRESULT: " + hr);
                return;
            }
            var mgr = (IAudioSessionManager2)o;

            IAudioSessionEnumerator sessionEnumerator;
            hr = mgr.GetSessionEnumerator(out sessionEnumerator);
            if (hr != 0) {
                Console.WriteLine("ERROR: GetSessionEnumerator failed with HRESULT: " + hr);
                return;
            }

            int count;
            sessionEnumerator.GetCount(out count);

            Guid guid = Guid.Empty;
            int unmutedCount = 0;

            for (int i = 0; i < count; i++) {
                IAudioSessionControl ctl;
                sessionEnumerator.GetSession(i, out ctl);

                var vol = ctl as ISimpleAudioVolume;
                if (vol != null) {
                    try {
                        vol.SetMute(false, ref guid);
                        unmutedCount++;
                    } catch {
                        // Ignore unmute errors
                    }
                }
            }
            Console.WriteLine("Unmuted " + unmutedCount + " applications");
            Console.WriteLine("SUCCESS");
        } catch (Exception ex) {
            Console.WriteLine("ERROR: " + ex.GetType().Name + " - " + ex.Message);
        }
    }
}
"@ -ReferencedAssemblies System.Management
`;
}

// Execute PowerShell script from a temporary file (more reliable than inline command)
function executePowerShellScript(scriptContent) {
  return new Promise((resolve, reject) => {
    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const scriptPath = path.join(tempDir, `audio-control-${timestamp}.ps1`);

    try {
      // Write script to temp file with UTF-8 BOM for proper PowerShell encoding
      const bom = Buffer.from([0xEF, 0xBB, 0xBF]); // UTF-8 BOM
      const content = Buffer.from(scriptContent, 'utf8');
      fs.writeFileSync(scriptPath, Buffer.concat([bom, content]));
      console.log('PowerShell script written to:', scriptPath);

      // Execute the script file
      const psProcess = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath
      ]);

      let stdout = '';
      let stderr = '';

      psProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      psProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      psProcess.on('close', (code) => {
        // Clean up temp file
        try {
          fs.unlinkSync(scriptPath);
        } catch (e) {
          console.warn('Failed to clean up temp script file:', e.message);
        }

        console.log('PowerShell exit code:', code);
        console.log('PowerShell stdout:', stdout);
        if (stderr) console.log('PowerShell stderr:', stderr);

        if (code === 0 || stdout.includes('SUCCESS')) {
          resolve({ success: true, output: stdout.trim() });
        } else {
          resolve({ success: false, output: stdout.trim(), error: stderr || `Exit code: ${code}` });
        }
      });

      psProcess.on('error', (err) => {
        // Clean up temp file
        try {
          fs.unlinkSync(scriptPath);
        } catch (e) { }
        reject(err);
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        psProcess.kill();
        reject(new Error('PowerShell script timed out'));
      }, 30000);

    } catch (err) {
      // Clean up temp file on error
      try {
        fs.unlinkSync(scriptPath);
      } catch (e) { }
      reject(err);
    }
  });
}

// Toggle muting other applications (Windows-specific feature)
// Uses Windows Core Audio API via PowerShell to mute all audio sessions except this app
ipcMain.handle('set-mute-other-apps', async (event, enabled) => {
  try {
    // Note: Muting other applications requires platform-specific implementation
    if (process.platform !== 'win32') {
      console.log('Mute other apps is only supported on Windows');
      return {
        success: false,
        error: 'This feature is only supported on Windows',
        unsupported: true
      };
    }

    const electronPID = process.pid;
    const baseScript = getAudioControlScriptContent();

    if (enabled) {
      console.log('Attempting to mute other applications (PID to exclude:', electronPID, ')');

      const muteScript = baseScript + `\n[AudioManager]::MuteOtherApps(${electronPID})`;

      try {
        const result = await executePowerShellScript(muteScript);

        if (result.success && result.output.includes('SUCCESS')) {
          otherAppsMuted = true;
          return {
            success: true,
            message: 'Other applications muted successfully'
          };
        } else if (result.output.includes('ERROR:')) {
          return {
            success: false,
            error: result.output.replace(/.*ERROR:\s*/, ''),
            details: result.error
          };
        } else {
          // Partial success or unknown state
          otherAppsMuted = true;
          return {
            success: true,
            message: 'Mute command executed'
          };
        }
      } catch (err) {
        console.error('PowerShell execution error:', err);
        return {
          success: false,
          error: 'Failed to mute other applications: ' + err.message
        };
      }
    } else {
      console.log('Unmuting other applications...');

      const unmuteScript = baseScript + '\n[AudioManager]::UnmuteAllApps()';

      try {
        const result = await executePowerShellScript(unmuteScript);

        if (result.success) {
          otherAppsMuted = false;
          return {
            success: true,
            message: 'Other applications unmuted'
          };
        } else {
          return {
            success: false,
            error: 'Failed to unmute applications',
            details: result.error
          };
        }
      } catch (err) {
        console.error('PowerShell execution error:', err);
        return {
          success: false,
          error: 'Failed to unmute applications: ' + err.message
        };
      }
    }
  } catch (error) {
    console.error('Error setting mute other apps:', error);
    return { success: false, error: error.message };
  }
});

// Quit application - ensures proper cleanup before exit
ipcMain.handle('quit-application', async () => {
  try {
    console.log('quit-application IPC handler called');

    // If other apps are muted, unmute them before quitting
    if (otherAppsMuted && process.platform === 'win32') {
      console.log('Unmuting other applications before quit...');
      const baseScript = getAudioControlScriptContent();
      const unmuteScript = baseScript + '\n[AudioManager]::UnmuteAllApps()';

      try {
        await executePowerShellScript(unmuteScript);
        console.log('Other applications unmuted successfully');
      } catch (err) {
        console.error('Failed to unmute applications on quit:', err);
      }
    }

    // Quit the application
    app.quit();

    return { success: true };
  } catch (error) {
    console.error('Error quitting application:', error);
    return { success: false, error: error.message };
  }
});
