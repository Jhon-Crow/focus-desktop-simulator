// Tests for activity logging utilities

const {
  LOG_ENTRY_TYPES,
  formatLogTimestamp,
  createLogEntry,
  formatLogEntry,
  createSessionHeader,
  createSessionFooter,
  parseLogTimestamp,
  calculateLogStats,
  filterEntriesByType,
  filterEntriesByTimeRange,
  searchEntries
} = require('../src/utils/activityLog');

describe('Activity Log Utilities', () => {
  describe('LOG_ENTRY_TYPES', () => {
    test('contains all expected entry types', () => {
      expect(LOG_ENTRY_TYPES.ACTIVITY_START).toBe('activity_start');
      expect(LOG_ENTRY_TYPES.ACTIVITY_END).toBe('activity_end');
      expect(LOG_ENTRY_TYPES.OBJECT_CREATE).toBe('object_create');
      expect(LOG_ENTRY_TYPES.OBJECT_DELETE).toBe('object_delete');
      expect(LOG_ENTRY_TYPES.OBJECT_MOVE).toBe('object_move');
      expect(LOG_ENTRY_TYPES.OBJECT_RESIZE).toBe('object_resize');
      expect(LOG_ENTRY_TYPES.SETTING_CHANGE).toBe('setting_change');
      expect(LOG_ENTRY_TYPES.AUDIO_PLAY).toBe('audio_play');
      expect(LOG_ENTRY_TYPES.AUDIO_STOP).toBe('audio_stop');
      expect(LOG_ENTRY_TYPES.RECORDING_START).toBe('recording_start');
      expect(LOG_ENTRY_TYPES.RECORDING_STOP).toBe('recording_stop');
      expect(LOG_ENTRY_TYPES.NOTE_SAVE).toBe('note_save');
      expect(LOG_ENTRY_TYPES.DRAWING_SAVE).toBe('drawing_save');
    });
  });

  describe('formatLogTimestamp', () => {
    test('formats date correctly', () => {
      const date = new Date('2024-01-15T10:30:45.000Z');
      const result = formatLogTimestamp(date);

      // Account for timezone - check format
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    test('uses current date when no argument provided', () => {
      const before = new Date();
      const result = formatLogTimestamp();
      const after = new Date();

      // Should match format
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    test('pads single digits correctly', () => {
      const date = new Date('2024-01-05T09:05:05.000Z');
      const result = formatLogTimestamp(date);

      // Should have padded zeros
      expect(result).toMatch(/\d{4}-01-0\d \d{2}:\d{2}:\d{2}/);
    });
  });

  describe('createLogEntry', () => {
    test('creates entry with all fields', () => {
      const entry = createLogEntry(
        LOG_ENTRY_TYPES.OBJECT_CREATE,
        'Created new card',
        { objectId: 'card-1', type: 'playing-card' }
      );

      expect(entry.type).toBe('object_create');
      expect(entry.message).toBe('Created new card');
      expect(entry.data.objectId).toBe('card-1');
      expect(entry.data.type).toBe('playing-card');
      expect(entry.timestamp).toBeDefined();
    });

    test('creates entry with empty data', () => {
      const entry = createLogEntry(LOG_ENTRY_TYPES.ACTIVITY_START, 'Session started');

      expect(entry.type).toBe('activity_start');
      expect(entry.message).toBe('Session started');
      expect(entry.data).toEqual({});
    });

    test('generates valid ISO timestamp', () => {
      const entry = createLogEntry(LOG_ENTRY_TYPES.ACTIVITY_START, 'Test');

      // Should be valid ISO date
      expect(() => new Date(entry.timestamp)).not.toThrow();
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
    });
  });

  describe('formatLogEntry', () => {
    test('formats entry without data', () => {
      const entry = {
        timestamp: '2024-01-15T10:30:00.000Z',
        type: 'activity_start',
        message: 'Session started',
        data: {}
      };

      const result = formatLogEntry(entry);

      expect(result).toContain('ACTIVITY START');
      expect(result).toContain('Session started');
    });

    test('formats entry with data', () => {
      const entry = {
        timestamp: '2024-01-15T10:30:00.000Z',
        type: 'object_create',
        message: 'Created card',
        data: { objectId: 'card-1', x: 100, y: 200 }
      };

      const result = formatLogEntry(entry);

      expect(result).toContain('OBJECT CREATE');
      expect(result).toContain('Created card');
      expect(result).toContain('objectId: card-1');
      expect(result).toContain('x: 100');
      expect(result).toContain('y: 200');
    });

    test('handles nested data objects', () => {
      const entry = {
        timestamp: '2024-01-15T10:30:00.000Z',
        type: 'setting_change',
        message: 'Settings updated',
        data: { settings: { theme: 'dark', volume: 0.8 } }
      };

      const result = formatLogEntry(entry);

      expect(result).toContain('settings:');
      expect(result).toContain('theme');
      expect(result).toContain('dark');
    });
  });

  describe('createSessionHeader', () => {
    test('creates header with default name', () => {
      const header = createSessionHeader();

      expect(header).toContain('Activity Log Session');
      expect(header).toContain('Session started:');
      expect(header).toContain('='.repeat(80));
    });

    test('creates header with custom name', () => {
      const header = createSessionHeader('My Custom Session');

      expect(header).toContain('My Custom Session');
    });

    test('includes settings when provided', () => {
      const settings = { theme: 'dark', volume: 0.8 };
      const header = createSessionHeader('Test Session', settings);

      expect(header).toContain('Settings:');
      expect(header).toContain('theme: dark');
      expect(header).toContain('volume: 0.8');
    });
  });

  describe('createSessionFooter', () => {
    test('creates footer with end time', () => {
      const footer = createSessionFooter();

      expect(footer).toContain('Session ended:');
      expect(footer).toContain('='.repeat(80));
    });

    test('includes statistics when provided', () => {
      const stats = { totalEntries: 50, duration: '1h 30m 0s' };
      const footer = createSessionFooter(stats);

      expect(footer).toContain('Session Statistics:');
      expect(footer).toContain('totalEntries: 50');
      expect(footer).toContain('duration: 1h 30m 0s');
    });
  });

  describe('parseLogTimestamp', () => {
    test('converts log timestamp to ISO format', () => {
      const result = parseLogTimestamp('2024-01-15 10:30:45');

      expect(result).toBe('2024-01-15T10:30:45.000Z');
    });
  });

  describe('calculateLogStats', () => {
    test('calculates stats for multiple entries', () => {
      const entries = [
        { timestamp: '2024-01-15T10:00:00.000Z', type: 'activity_start', message: 'Start' },
        { timestamp: '2024-01-15T10:30:00.000Z', type: 'object_create', message: 'Create' },
        { timestamp: '2024-01-15T10:45:00.000Z', type: 'object_create', message: 'Create 2' },
        { timestamp: '2024-01-15T11:00:00.000Z', type: 'activity_end', message: 'End' }
      ];

      const stats = calculateLogStats(entries);

      expect(stats.totalEntries).toBe(4);
      expect(stats.byType['activity_start']).toBe(1);
      expect(stats.byType['object_create']).toBe(2);
      expect(stats.byType['activity_end']).toBe(1);
      expect(stats.duration).toBe('1h 0m 0s');
      expect(stats.durationMs).toBe(3600000);
    });

    test('handles empty entries', () => {
      const stats = calculateLogStats([]);

      expect(stats.totalEntries).toBe(0);
      expect(stats.byType).toEqual({});
      expect(stats.duration).toBeNull();
    });

    test('handles single entry', () => {
      const entries = [
        { timestamp: '2024-01-15T10:00:00.000Z', type: 'activity_start', message: 'Start' }
      ];

      const stats = calculateLogStats(entries);

      expect(stats.totalEntries).toBe(1);
      expect(stats.duration).toBe('0h 0m 0s');
    });
  });

  describe('filterEntriesByType', () => {
    const entries = [
      { type: 'activity_start', message: '1' },
      { type: 'object_create', message: '2' },
      { type: 'object_create', message: '3' },
      { type: 'object_delete', message: '4' },
      { type: 'activity_end', message: '5' }
    ];

    test('filters by single type', () => {
      const result = filterEntriesByType(entries, 'object_create');

      expect(result.length).toBe(2);
      expect(result.every(e => e.type === 'object_create')).toBe(true);
    });

    test('filters by multiple types', () => {
      const result = filterEntriesByType(entries, ['activity_start', 'activity_end']);

      expect(result.length).toBe(2);
      expect(result[0].type).toBe('activity_start');
      expect(result[1].type).toBe('activity_end');
    });

    test('returns empty array for non-matching type', () => {
      const result = filterEntriesByType(entries, 'non_existent');

      expect(result).toEqual([]);
    });
  });

  describe('filterEntriesByTimeRange', () => {
    const entries = [
      { timestamp: '2024-01-15T10:00:00.000Z', message: '1' },
      { timestamp: '2024-01-15T10:30:00.000Z', message: '2' },
      { timestamp: '2024-01-15T11:00:00.000Z', message: '3' },
      { timestamp: '2024-01-15T11:30:00.000Z', message: '4' }
    ];

    test('filters by time range', () => {
      const result = filterEntriesByTimeRange(
        entries,
        '2024-01-15T10:15:00.000Z',
        '2024-01-15T11:15:00.000Z'
      );

      expect(result.length).toBe(2);
      expect(result[0].message).toBe('2');
      expect(result[1].message).toBe('3');
    });

    test('includes boundary entries', () => {
      const result = filterEntriesByTimeRange(
        entries,
        '2024-01-15T10:00:00.000Z',
        '2024-01-15T10:30:00.000Z'
      );

      expect(result.length).toBe(2);
      expect(result[0].message).toBe('1');
      expect(result[1].message).toBe('2');
    });

    test('returns empty for non-matching range', () => {
      const result = filterEntriesByTimeRange(
        entries,
        '2024-01-16T00:00:00.000Z',
        '2024-01-16T12:00:00.000Z'
      );

      expect(result).toEqual([]);
    });
  });

  describe('searchEntries', () => {
    const entries = [
      { message: 'Created playing card', data: { type: 'card', color: 'red' } },
      { message: 'Moved object', data: { x: 100, y: 200 } },
      { message: 'Deleted card', data: { type: 'card' } },
      { message: 'Changed settings', data: { theme: 'dark' } }
    ];

    test('searches in message', () => {
      const result = searchEntries(entries, 'card');

      expect(result.length).toBe(2);
    });

    test('searches case-insensitively', () => {
      const result = searchEntries(entries, 'CARD');

      expect(result.length).toBe(2);
    });

    test('searches in data', () => {
      const result = searchEntries(entries, 'dark');

      expect(result.length).toBe(1);
      expect(result[0].message).toBe('Changed settings');
    });

    test('returns empty for non-matching query', () => {
      const result = searchEntries(entries, 'nonexistent');

      expect(result).toEqual([]);
    });

    test('handles partial matches', () => {
      const result = searchEntries(entries, 'play');

      expect(result.length).toBe(1);
      expect(result[0].message).toContain('playing');
    });
  });
});
