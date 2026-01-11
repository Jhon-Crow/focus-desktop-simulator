// Tests for memory monitoring utilities

const {
  MEMORY_THRESHOLDS,
  MEMORY_STATUS,
  formatBytes,
  parseBytes,
  getMemoryStatus,
  calculateMemoryPercentage,
  createMemorySnapshot,
  analyzeMemoryTrend,
  calculateAverageMemory,
  detectMemoryLeak,
  createMemoryReport
} = require('../src/utils/memoryMonitor');

describe('Memory Monitor Utilities', () => {
  describe('Constants', () => {
    test('MEMORY_THRESHOLDS has correct values', () => {
      expect(MEMORY_THRESHOLDS.LOW).toBe(50 * 1024 * 1024);
      expect(MEMORY_THRESHOLDS.MEDIUM).toBe(100 * 1024 * 1024);
      expect(MEMORY_THRESHOLDS.HIGH).toBe(200 * 1024 * 1024);
      expect(MEMORY_THRESHOLDS.CRITICAL).toBe(500 * 1024 * 1024);
    });

    test('MEMORY_STATUS has correct values', () => {
      expect(MEMORY_STATUS.GOOD).toBe('good');
      expect(MEMORY_STATUS.WARNING).toBe('warning');
      expect(MEMORY_STATUS.HIGH).toBe('high');
      expect(MEMORY_STATUS.CRITICAL).toBe('critical');
    });
  });

  describe('formatBytes', () => {
    test('formats bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 Bytes');
      expect(formatBytes(500)).toBe('500 Bytes');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(1048576)).toBe('1 MB');
      expect(formatBytes(1073741824)).toBe('1 GB');
    });

    test('respects decimal places', () => {
      expect(formatBytes(1536, 0)).toBe('2 KB');
      expect(formatBytes(1536, 1)).toBe('1.5 KB');
      expect(formatBytes(1536, 3)).toBe('1.5 KB');
    });

    test('handles negative numbers', () => {
      expect(formatBytes(-100)).toBe('Invalid');
    });

    test('handles large numbers', () => {
      expect(formatBytes(1099511627776)).toBe('1 TB');
    });
  });

  describe('parseBytes', () => {
    test('parses byte strings correctly', () => {
      expect(parseBytes('100 Bytes')).toBe(100);
      expect(parseBytes('1 KB')).toBe(1024);
      expect(parseBytes('1.5 KB')).toBe(1536);
      expect(parseBytes('1 MB')).toBe(1048576);
      expect(parseBytes('1 GB')).toBe(1073741824);
      expect(parseBytes('1 TB')).toBe(1099511627776);
    });

    test('handles case insensitivity', () => {
      expect(parseBytes('100 mb')).toBe(104857600);
      expect(parseBytes('100 MB')).toBe(104857600);
    });

    test('returns NaN for invalid strings', () => {
      expect(parseBytes('invalid')).toBeNaN();
      expect(parseBytes('')).toBeNaN();
      expect(parseBytes('100')).toBeNaN();
    });
  });

  describe('getMemoryStatus', () => {
    test('returns correct status based on usage', () => {
      expect(getMemoryStatus(10 * 1024 * 1024)).toBe(MEMORY_STATUS.GOOD);
      expect(getMemoryStatus(75 * 1024 * 1024)).toBe(MEMORY_STATUS.GOOD);
      expect(getMemoryStatus(150 * 1024 * 1024)).toBe(MEMORY_STATUS.WARNING);
      expect(getMemoryStatus(300 * 1024 * 1024)).toBe(MEMORY_STATUS.HIGH);
      expect(getMemoryStatus(600 * 1024 * 1024)).toBe(MEMORY_STATUS.CRITICAL);
    });

    test('handles boundary values', () => {
      expect(getMemoryStatus(MEMORY_THRESHOLDS.MEDIUM - 1)).toBe(MEMORY_STATUS.GOOD);
      expect(getMemoryStatus(MEMORY_THRESHOLDS.MEDIUM)).toBe(MEMORY_STATUS.WARNING);
      expect(getMemoryStatus(MEMORY_THRESHOLDS.HIGH)).toBe(MEMORY_STATUS.HIGH);
      expect(getMemoryStatus(MEMORY_THRESHOLDS.CRITICAL)).toBe(MEMORY_STATUS.CRITICAL);
    });
  });

  describe('calculateMemoryPercentage', () => {
    test('calculates percentage correctly', () => {
      expect(calculateMemoryPercentage(50, 100)).toBe(50);
      expect(calculateMemoryPercentage(25, 100)).toBe(25);
      expect(calculateMemoryPercentage(100, 100)).toBe(100);
    });

    test('handles edge cases', () => {
      expect(calculateMemoryPercentage(0, 100)).toBe(0);
      expect(calculateMemoryPercentage(150, 100)).toBe(100); // Clamped
      expect(calculateMemoryPercentage(50, 0)).toBe(0);
      expect(calculateMemoryPercentage(50, -10)).toBe(0);
    });
  });

  describe('createMemorySnapshot', () => {
    test('creates snapshot from memory info', () => {
      const memoryInfo = {
        usedJSHeapSize: 50 * 1024 * 1024,
        totalJSHeapSize: 100 * 1024 * 1024,
        jsHeapSizeLimit: 2048 * 1024 * 1024
      };

      const snapshot = createMemorySnapshot(memoryInfo);

      expect(snapshot.used).toBe(50 * 1024 * 1024);
      expect(snapshot.total).toBe(100 * 1024 * 1024);
      expect(snapshot.limit).toBe(2048 * 1024 * 1024);
      expect(snapshot.usedFormatted).toBe('50 MB');
      expect(snapshot.percentage).toBeCloseTo(2.44, 1);
      expect(snapshot.status).toBe(MEMORY_STATUS.GOOD);
      expect(snapshot.timestamp).toBeDefined();
    });

    test('handles null memory info', () => {
      const snapshot = createMemorySnapshot(null);

      expect(snapshot.used).toBe(0);
      expect(snapshot.total).toBe(0);
      expect(snapshot.limit).toBe(0);
    });

    test('handles partial memory info', () => {
      const snapshot = createMemorySnapshot({ usedJSHeapSize: 1024 });

      expect(snapshot.used).toBe(1024);
      expect(snapshot.total).toBe(0);
      expect(snapshot.limit).toBe(0);
    });
  });

  describe('analyzeMemoryTrend', () => {
    test('detects increasing trend', () => {
      const snapshots = [
        { timestamp: '2024-01-15T10:00:00.000Z', used: 50 * 1024 * 1024 },
        { timestamp: '2024-01-15T10:00:01.000Z', used: 60 * 1024 * 1024 }
      ];

      const trend = analyzeMemoryTrend(snapshots);

      expect(trend.trend).toBe('increasing');
      expect(trend.change).toBe(10 * 1024 * 1024);
    });

    test('detects decreasing trend', () => {
      const snapshots = [
        { timestamp: '2024-01-15T10:00:00.000Z', used: 60 * 1024 * 1024 },
        { timestamp: '2024-01-15T10:00:01.000Z', used: 50 * 1024 * 1024 }
      ];

      const trend = analyzeMemoryTrend(snapshots);

      expect(trend.trend).toBe('decreasing');
      expect(trend.change).toBe(-10 * 1024 * 1024);
    });

    test('detects stable trend', () => {
      const snapshots = [
        { timestamp: '2024-01-15T10:00:00.000Z', used: 50 * 1024 * 1024 },
        { timestamp: '2024-01-15T10:00:01.000Z', used: 50 * 1024 * 1024 + 100 }
      ];

      const trend = analyzeMemoryTrend(snapshots);

      expect(trend.trend).toBe('stable');
    });

    test('handles insufficient data', () => {
      const trend = analyzeMemoryTrend([{ timestamp: '2024-01-15T10:00:00.000Z', used: 50 }]);

      expect(trend.trend).toBe('stable');
      expect(trend.change).toBe(0);
    });
  });

  describe('calculateAverageMemory', () => {
    test('calculates average, min, and max', () => {
      const snapshots = [
        { used: 50 * 1024 * 1024 },
        { used: 100 * 1024 * 1024 },
        { used: 75 * 1024 * 1024 }
      ];

      const result = calculateAverageMemory(snapshots);

      expect(result.average).toBe(75 * 1024 * 1024);
      expect(result.min).toBe(50 * 1024 * 1024);
      expect(result.max).toBe(100 * 1024 * 1024);
    });

    test('handles empty array', () => {
      const result = calculateAverageMemory([]);

      expect(result.average).toBe(0);
      expect(result.min).toBe(0);
      expect(result.max).toBe(0);
    });

    test('handles single snapshot', () => {
      const result = calculateAverageMemory([{ used: 50 * 1024 * 1024 }]);

      expect(result.average).toBe(50 * 1024 * 1024);
      expect(result.min).toBe(50 * 1024 * 1024);
      expect(result.max).toBe(50 * 1024 * 1024);
    });
  });

  describe('detectMemoryLeak', () => {
    test('detects potential memory leak', () => {
      const snapshots = [];
      for (let i = 0; i < 10; i++) {
        snapshots.push({
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          used: 50 * 1024 * 1024 + i * 10 * 1024 // Increasing by 10KB each second
        });
      }

      const result = detectMemoryLeak(snapshots);

      expect(result.detected).toBe(true);
      expect(result.confidence).toBe('high');
    });

    test('does not detect leak for stable memory', () => {
      const snapshots = [];
      for (let i = 0; i < 10; i++) {
        snapshots.push({
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          used: 50 * 1024 * 1024 + (Math.random() * 100 - 50) // Small random variation
        });
      }

      const result = detectMemoryLeak(snapshots);

      expect(result.detected).toBe(false);
    });

    test('handles insufficient data', () => {
      const result = detectMemoryLeak([{ used: 50 }]);

      expect(result.detected).toBe(false);
      expect(result.confidence).toBe('low');
      expect(result.message).toContain('Insufficient data');
    });
  });

  describe('createMemoryReport', () => {
    test('creates formatted report', () => {
      const snapshots = [
        {
          timestamp: '2024-01-15T10:00:00.000Z',
          used: 50 * 1024 * 1024,
          usedFormatted: '50 MB',
          total: 100 * 1024 * 1024,
          totalFormatted: '100 MB',
          limit: 2048 * 1024 * 1024,
          limitFormatted: '2 GB',
          status: 'good'
        },
        {
          timestamp: '2024-01-15T10:00:01.000Z',
          used: 52 * 1024 * 1024,
          usedFormatted: '52 MB',
          total: 100 * 1024 * 1024,
          totalFormatted: '100 MB',
          limit: 2048 * 1024 * 1024,
          limitFormatted: '2 GB',
          status: 'good'
        }
      ];

      const report = createMemoryReport(snapshots);

      expect(report).toContain('Memory Report');
      expect(report).toContain('Current Status');
      expect(report).toContain('Statistics');
      expect(report).toContain('Trend');
      expect(report).toContain('Leak Detection');
    });

    test('handles empty snapshots', () => {
      const report = createMemoryReport([]);

      expect(report).toBe('No memory data available');
    });
  });
});
