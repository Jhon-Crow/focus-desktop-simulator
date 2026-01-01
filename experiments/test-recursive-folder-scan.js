/**
 * Test script to verify recursive folder scanning for audio files
 * This tests the findAudioFilesRecursively function logic
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Supported audio extensions (same as in main.js)
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.webm', '.opus'];

// Recursive function to find audio files (same logic as in main.js)
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

// Create test directory structure
const testDir = path.join(os.tmpdir(), 'audio-test-' + Date.now());

console.log('Creating test directory structure at:', testDir);

// Create directories
fs.mkdirSync(testDir, { recursive: true });
fs.mkdirSync(path.join(testDir, 'subfolder1'), { recursive: true });
fs.mkdirSync(path.join(testDir, 'subfolder1', 'nested'), { recursive: true });
fs.mkdirSync(path.join(testDir, 'subfolder2'), { recursive: true });

// Create dummy audio files (just empty files with correct extensions)
const testFiles = [
  'song1.mp3',
  'song2.wav',
  'subfolder1/album1-track1.mp3',
  'subfolder1/album1-track2.flac',
  'subfolder1/nested/deep-track.ogg',
  'subfolder2/album2-track1.m4a',
  'not-audio.txt',  // This should NOT be included
  'subfolder1/readme.md'  // This should NOT be included
];

console.log('\nCreating test files:');
for (const file of testFiles) {
  const fullPath = path.join(testDir, file);
  fs.writeFileSync(fullPath, '');  // Empty file
  console.log('  Created:', file);
}

// Test the recursive function
console.log('\n--- Testing recursive folder scan ---\n');

const foundFiles = findAudioFilesRecursively(testDir)
  .sort((a, b) => a.name.localeCompare(b.name));

console.log('Found', foundFiles.length, 'audio files:\n');
for (const file of foundFiles) {
  console.log('  name:', file.name);
  console.log('  fullName:', file.fullName);
  console.log('  path:', file.path);
  console.log('');
}

// Verify results
const expectedFiles = [
  'song1',
  'song2',
  'subfolder1/album1-track1',
  'subfolder1/album1-track2',
  'subfolder1/nested/deep-track',
  'subfolder2/album2-track1'
];

console.log('--- Verification ---\n');

let passed = true;

if (foundFiles.length !== expectedFiles.length) {
  console.log('FAIL: Expected', expectedFiles.length, 'files, but found', foundFiles.length);
  passed = false;
} else {
  console.log('PASS: Found correct number of audio files (' + expectedFiles.length + ')');
}

// Check each expected file is present
for (const expected of expectedFiles) {
  const found = foundFiles.find(f => f.name === expected);
  if (found) {
    console.log('PASS: Found expected file:', expected);
  } else {
    console.log('FAIL: Missing expected file:', expected);
    passed = false;
  }
}

// Check no non-audio files were included
const nonAudioFound = foundFiles.find(f => f.fullName === 'not-audio.txt' || f.fullName === 'readme.md');
if (nonAudioFound) {
  console.log('FAIL: Non-audio file was incorrectly included:', nonAudioFound.fullName);
  passed = false;
} else {
  console.log('PASS: Non-audio files correctly excluded');
}

// Cleanup
console.log('\nCleaning up test directory...');
fs.rmSync(testDir, { recursive: true, force: true });

console.log('\n' + (passed ? '✓ All tests passed!' : '✗ Some tests failed!'));
process.exit(passed ? 0 : 1);
