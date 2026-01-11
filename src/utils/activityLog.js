// Activity logging utilities

/**
 * Activity log entry types
 */
const LOG_ENTRY_TYPES = {
  ACTIVITY_START: 'activity_start',
  ACTIVITY_END: 'activity_end',
  OBJECT_CREATE: 'object_create',
  OBJECT_DELETE: 'object_delete',
  OBJECT_MOVE: 'object_move',
  OBJECT_RESIZE: 'object_resize',
  SETTING_CHANGE: 'setting_change',
  AUDIO_PLAY: 'audio_play',
  AUDIO_STOP: 'audio_stop',
  RECORDING_START: 'recording_start',
  RECORDING_STOP: 'recording_stop',
  NOTE_SAVE: 'note_save',
  DRAWING_SAVE: 'drawing_save'
};

/**
 * Format a timestamp for log display
 * @param {Date} date - Date to format (defaults to now)
 * @returns {string} Formatted timestamp
 */
function formatLogTimestamp(date = new Date()) {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Create a log entry object
 * @param {string} type - Entry type from LOG_ENTRY_TYPES
 * @param {string} message - Human-readable message
 * @param {Object} data - Additional data
 * @returns {Object} Log entry object
 */
function createLogEntry(type, message, data = {}) {
  return {
    timestamp: new Date().toISOString(),
    type,
    message,
    data
  };
}

/**
 * Format a log entry for text output
 * @param {Object} entry - Log entry object
 * @returns {string} Formatted log entry string
 */
function formatLogEntry(entry) {
  const timestamp = formatLogTimestamp(new Date(entry.timestamp));
  const typeLabel = entry.type.replace(/_/g, ' ').toUpperCase();
  let output = `[${timestamp}] ${typeLabel}: ${entry.message}`;

  if (entry.data && Object.keys(entry.data).length > 0) {
    const dataStr = Object.entries(entry.data)
      .map(([key, value]) => `  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
      .join('\n');
    output += '\n' + dataStr;
  }

  return output;
}

/**
 * Create session header for log file
 * @param {string} sessionName - Name of the session
 * @param {Object} settings - Current settings
 * @returns {string} Formatted header
 */
function createSessionHeader(sessionName = 'Activity Log Session', settings = {}) {
  const startTime = formatLogTimestamp();
  const separator = '='.repeat(80);

  let header = `${separator}\n`;
  header += `${sessionName}\n`;
  header += `${separator}\n\n`;
  header += `Session started: ${startTime}\n`;

  if (Object.keys(settings).length > 0) {
    header += '\nSettings:\n';
    for (const [key, value] of Object.entries(settings)) {
      header += `  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}\n`;
    }
  }

  return header;
}

/**
 * Create session footer for log file
 * @param {Object} stats - Session statistics
 * @returns {string} Formatted footer
 */
function createSessionFooter(stats = {}) {
  const endTime = formatLogTimestamp();
  const separator = '='.repeat(80);

  let footer = `\n${separator}\n`;
  footer += `Session ended: ${endTime}\n`;

  if (Object.keys(stats).length > 0) {
    footer += '\nSession Statistics:\n';
    for (const [key, value] of Object.entries(stats)) {
      footer += `  ${key}: ${value}\n`;
    }
  }

  footer += separator;

  return footer;
}

/**
 * Parse a log file content into entries
 * @param {string} content - Raw log file content
 * @returns {Array} Array of log entry objects
 */
function parseLogFile(content) {
  const entries = [];
  const lines = content.split('\n');
  let currentEntry = null;

  for (const line of lines) {
    // Check for timestamp line (new entry)
    const timestampMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] ([A-Z_ ]+): (.+)$/);

    if (timestampMatch) {
      // Save previous entry if exists
      if (currentEntry) {
        entries.push(currentEntry);
      }

      const [, timestamp, type, message] = timestampMatch;
      currentEntry = {
        timestamp: parseLogTimestamp(timestamp),
        type: type.toLowerCase().replace(/ /g, '_'),
        message,
        data: {}
      };
    } else if (currentEntry && line.trim().startsWith(':')) {
      // Data line
      const dataMatch = line.match(/^\s+(\w+): (.+)$/);
      if (dataMatch) {
        const [, key, value] = dataMatch;
        try {
          currentEntry.data[key] = JSON.parse(value);
        } catch {
          currentEntry.data[key] = value;
        }
      }
    }
  }

  // Don't forget last entry
  if (currentEntry) {
    entries.push(currentEntry);
  }

  return entries;
}

/**
 * Parse log timestamp string to ISO format
 * @param {string} timestamp - Timestamp in "YYYY-MM-DD HH:MM:SS" format
 * @returns {string} ISO timestamp
 */
function parseLogTimestamp(timestamp) {
  const [date, time] = timestamp.split(' ');
  return `${date}T${time}.000Z`;
}

/**
 * Calculate statistics from log entries
 * @param {Array} entries - Array of log entry objects
 * @returns {Object} Statistics object
 */
function calculateLogStats(entries) {
  const stats = {
    totalEntries: entries.length,
    byType: {},
    duration: null,
    firstEntry: null,
    lastEntry: null
  };

  if (entries.length === 0) {
    return stats;
  }

  // Count by type
  for (const entry of entries) {
    if (!stats.byType[entry.type]) {
      stats.byType[entry.type] = 0;
    }
    stats.byType[entry.type]++;
  }

  // Calculate duration
  stats.firstEntry = entries[0].timestamp;
  stats.lastEntry = entries[entries.length - 1].timestamp;

  const startTime = new Date(stats.firstEntry);
  const endTime = new Date(stats.lastEntry);
  const durationMs = endTime - startTime;

  const hours = Math.floor(durationMs / 3600000);
  const minutes = Math.floor((durationMs % 3600000) / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);

  stats.duration = `${hours}h ${minutes}m ${seconds}s`;
  stats.durationMs = durationMs;

  return stats;
}

/**
 * Filter log entries by type
 * @param {Array} entries - Array of log entry objects
 * @param {string|string[]} types - Type or array of types to include
 * @returns {Array} Filtered entries
 */
function filterEntriesByType(entries, types) {
  const typeArray = Array.isArray(types) ? types : [types];
  return entries.filter(entry => typeArray.includes(entry.type));
}

/**
 * Filter log entries by time range
 * @param {Array} entries - Array of log entry objects
 * @param {Date|string} startTime - Start time (inclusive)
 * @param {Date|string} endTime - End time (inclusive)
 * @returns {Array} Filtered entries
 */
function filterEntriesByTimeRange(entries, startTime, endTime) {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  return entries.filter(entry => {
    const entryTime = new Date(entry.timestamp).getTime();
    return entryTime >= start && entryTime <= end;
  });
}

/**
 * Search log entries by message content
 * @param {Array} entries - Array of log entry objects
 * @param {string} query - Search query (case-insensitive)
 * @returns {Array} Matching entries
 */
function searchEntries(entries, query) {
  const lowerQuery = query.toLowerCase();
  return entries.filter(entry =>
    entry.message.toLowerCase().includes(lowerQuery) ||
    JSON.stringify(entry.data).toLowerCase().includes(lowerQuery)
  );
}

module.exports = {
  LOG_ENTRY_TYPES,
  formatLogTimestamp,
  createLogEntry,
  formatLogEntry,
  createSessionHeader,
  createSessionFooter,
  parseLogFile,
  parseLogTimestamp,
  calculateLogStats,
  filterEntriesByType,
  filterEntriesByTimeRange,
  searchEntries
};
