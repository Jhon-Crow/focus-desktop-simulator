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
