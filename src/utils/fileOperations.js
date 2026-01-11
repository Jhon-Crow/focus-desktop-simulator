// File operation utilities extracted from main.js for testing

const fs = require('fs');
const path = require('path');

/**
 * Supported audio extensions for the cassette player
 */
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.webm', '.opus'];

/**
 * Recursively find all audio files in a folder and its subfolders
 * @param {string} folderPath - Path to search
 * @param {string|null} basePath - Base path for relative path calculation
 * @returns {Array} Array of audio file objects {name, fullName, path}
 */
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

/**
 * Get MIME type from file extension
 * @param {string} ext - File extension (with dot)
 * @returns {string} MIME type
 */
function getMimeTypeFromExtension(ext) {
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
  return mimeTypes[ext] || 'audio/mpeg';
}

/**
 * Read audio file and return as data URL
 * @param {string} filePath - Path to audio file
 * @returns {Object} Result object {success, dataUrl?, fileName?, error?}
 */
function readAudioFileAsDataUrl(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }

    const ext = path.extname(filePath).toLowerCase();
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    const mimeType = getMimeTypeFromExtension(ext);
    const dataUrl = `data:${mimeType};base64,${base64}`;

    return {
      success: true,
      dataUrl: dataUrl,
      fileName: path.basename(filePath)
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get next recording number from a folder
 * @param {string} folderPath - Path to recordings folder
 * @returns {Object} Result object {success, nextNumber?, error?}
 */
function getNextRecordingNumber(folderPath) {
  try {
    if (!fs.existsSync(folderPath)) {
      return { success: false, error: 'Folder not found' };
    }

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
      nextNumber: maxNumber + 1
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Save state to file
 * @param {string} userDataPath - User data directory path
 * @param {Object} state - State object to save
 * @returns {Object} Result object {success, error?}
 */
function saveState(userDataPath, state) {
  const statePath = path.join(userDataPath, 'desk-state.json');

  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Load state from file
 * @param {string} userDataPath - User data directory path
 * @returns {Object} Result object {success, state?, error?}
 */
function loadState(userDataPath) {
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
}

/**
 * Save object data (large data like PDFs)
 * @param {string} userDataPath - User data directory path
 * @param {string} objectId - Object ID
 * @param {string} dataType - Data type (e.g., 'pdf', 'cover')
 * @param {string|null} dataUrl - Data URL or null to delete
 * @returns {Object} Result object {success, error?}
 */
function saveObjectData(userDataPath, objectId, dataType, dataUrl) {
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
}

/**
 * Load object data
 * @param {string} userDataPath - User data directory path
 * @param {string} objectId - Object ID
 * @param {string} dataType - Data type
 * @returns {Object} Result object {success, data?, error?}
 */
function loadObjectData(userDataPath, objectId, dataType) {
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
}

/**
 * Save markdown file
 * @param {string} folderPath - Folder path
 * @param {string} fileName - File name
 * @param {string} content - Markdown content
 * @returns {Object} Result object {success, filePath?, error?}
 */
function saveMarkdownFile(folderPath, fileName, content) {
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
    return { success: false, error: error.message };
  }
}

/**
 * Save drawing file (PNG)
 * @param {string} folderPath - Folder path
 * @param {string} fileName - File name
 * @param {string} dataUrl - PNG data URL
 * @returns {Object} Result object {success, filePath?, error?}
 */
function saveDrawingFile(folderPath, fileName, dataUrl) {
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
    return { success: false, error: error.message };
  }
}

/**
 * Delete drawing file
 * @param {string} filePath - File path to delete
 * @returns {Object} Result object {success, error?}
 */
function deleteDrawingFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Validate model data structure
 * @param {Object} modelData - Model data to validate
 * @returns {Object} Validation result {valid, error?}
 */
function validateModelData(modelData) {
  if (!modelData) {
    return { valid: false, error: 'Model data is required' };
  }
  if (!modelData.id) {
    return { valid: false, error: 'Model must have an "id" field' };
  }
  if (!modelData.name) {
    return { valid: false, error: 'Model must have a "name" field' };
  }
  return { valid: true };
}

/**
 * Validate manifest structure for programs
 * @param {Object} manifest - Manifest to validate
 * @returns {Object} Validation result {valid, error?}
 */
function validateManifest(manifest) {
  if (!manifest) {
    return { valid: false, error: 'Manifest is required' };
  }
  if (!manifest.id) {
    return { valid: false, error: 'Manifest must have an "id" field' };
  }
  if (!manifest.name) {
    return { valid: false, error: 'Manifest must have a "name" field' };
  }
  return { valid: true };
}

/**
 * Get extensibility directories
 * @param {string} userDataPath - User data directory path
 * @returns {Object} Directory paths {base, models, programs}
 */
function getExtensibilityDir(userDataPath) {
  const extDir = path.join(userDataPath, 'extensibility');
  const modelsDir = path.join(extDir, 'models');
  const programsDir = path.join(extDir, 'programs');

  // Ensure directories exist
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }
  if (!fs.existsSync(programsDir)) {
    fs.mkdirSync(programsDir, { recursive: true });
  }

  return {
    base: extDir,
    models: modelsDir,
    programs: programsDir
  };
}

module.exports = {
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
};
