// Memory monitoring utilities

/**
 * Memory thresholds in bytes
 */
const MEMORY_THRESHOLDS = {
  LOW: 50 * 1024 * 1024,      // 50 MB
  MEDIUM: 100 * 1024 * 1024,  // 100 MB
  HIGH: 200 * 1024 * 1024,    // 200 MB
  CRITICAL: 500 * 1024 * 1024 // 500 MB
};

/**
 * Memory status levels
 */
const MEMORY_STATUS = {
  GOOD: 'good',
  WARNING: 'warning',
  HIGH: 'high',
  CRITICAL: 'critical'
};

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Number of bytes
 * @param {number} decimals - Decimal places (default 2)
 * @returns {string} Formatted string
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  if (bytes < 0) return 'Invalid';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);

  return parseFloat((bytes / Math.pow(k, index)).toFixed(dm)) + ' ' + sizes[index];
}

/**
 * Parse bytes from human-readable string
 * @param {string} str - String like "100 MB" or "1.5 GB"
 * @returns {number} Number of bytes
 */
function parseBytes(str) {
  const match = str.match(/^([\d.]+)\s*(Bytes?|KB|MB|GB|TB)$/i);
  if (!match) return NaN;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  const multipliers = {
    'BYTE': 1,
    'BYTES': 1,
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024,
    'TB': 1024 * 1024 * 1024 * 1024
  };

  return value * (multipliers[unit] || 1);
}

/**
 * Get memory status based on usage
 * @param {number} usedBytes - Used memory in bytes
 * @returns {string} Status from MEMORY_STATUS
 */
function getMemoryStatus(usedBytes) {
  if (usedBytes >= MEMORY_THRESHOLDS.CRITICAL) {
    return MEMORY_STATUS.CRITICAL;
  }
  if (usedBytes >= MEMORY_THRESHOLDS.HIGH) {
    return MEMORY_STATUS.HIGH;
  }
  if (usedBytes >= MEMORY_THRESHOLDS.MEDIUM) {
    return MEMORY_STATUS.WARNING;
  }
  return MEMORY_STATUS.GOOD;
}

/**
 * Calculate memory usage percentage
 * @param {number} used - Used memory
 * @param {number} total - Total memory
 * @returns {number} Percentage (0-100)
 */
function calculateMemoryPercentage(used, total) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

/**
 * Create a memory snapshot object
 * @param {Object} memoryInfo - Memory info from performance.memory or similar
 * @returns {Object} Snapshot object
 */
function createMemorySnapshot(memoryInfo) {
  const {
    usedJSHeapSize = 0,
    totalJSHeapSize = 0,
    jsHeapSizeLimit = 0
  } = memoryInfo || {};

  return {
    timestamp: new Date().toISOString(),
    used: usedJSHeapSize,
    total: totalJSHeapSize,
    limit: jsHeapSizeLimit,
    usedFormatted: formatBytes(usedJSHeapSize),
    totalFormatted: formatBytes(totalJSHeapSize),
    limitFormatted: formatBytes(jsHeapSizeLimit),
    percentage: calculateMemoryPercentage(usedJSHeapSize, jsHeapSizeLimit),
    status: getMemoryStatus(usedJSHeapSize)
  };
}

/**
 * Analyze memory trend from snapshots
 * @param {Array} snapshots - Array of memory snapshots
 * @returns {Object} Trend analysis
 */
function analyzeMemoryTrend(snapshots) {
  if (!snapshots || snapshots.length < 2) {
    return {
      trend: 'stable',
      change: 0,
      changePerSecond: 0
    };
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];

  const change = last.used - first.used;
  const timeSpan = new Date(last.timestamp) - new Date(first.timestamp);
  const changePerSecond = timeSpan > 0 ? (change / timeSpan) * 1000 : 0;

  let trend;
  if (changePerSecond > 1024 * 10) { // >10 KB/s increase
    trend = 'increasing';
  } else if (changePerSecond < -1024 * 10) { // >10 KB/s decrease
    trend = 'decreasing';
  } else {
    trend = 'stable';
  }

  return {
    trend,
    change,
    changeFormatted: formatBytes(Math.abs(change)) + (change >= 0 ? ' increase' : ' decrease'),
    changePerSecond,
    changePerSecondFormatted: formatBytes(Math.abs(changePerSecond)) + '/s'
  };
}

/**
 * Calculate average memory usage from snapshots
 * @param {Array} snapshots - Array of memory snapshots
 * @returns {Object} Average statistics
 */
function calculateAverageMemory(snapshots) {
  if (!snapshots || snapshots.length === 0) {
    return { average: 0, min: 0, max: 0 };
  }

  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const snapshot of snapshots) {
    sum += snapshot.used;
    if (snapshot.used < min) min = snapshot.used;
    if (snapshot.used > max) max = snapshot.used;
  }

  const average = sum / snapshots.length;

  return {
    average,
    averageFormatted: formatBytes(average),
    min,
    minFormatted: formatBytes(min),
    max,
    maxFormatted: formatBytes(max)
  };
}

/**
 * Detect potential memory leaks from snapshots
 * @param {Array} snapshots - Array of memory snapshots (at least 10 recommended)
 * @returns {Object} Leak detection result
 */
function detectMemoryLeak(snapshots) {
  if (!snapshots || snapshots.length < 5) {
    return {
      detected: false,
      confidence: 'low',
      message: 'Insufficient data for leak detection'
    };
  }

  // Calculate trend
  const trend = analyzeMemoryTrend(snapshots);

  // Check if memory is consistently increasing
  let increasingCount = 0;
  for (let i = 1; i < snapshots.length; i++) {
    if (snapshots[i].used > snapshots[i - 1].used) {
      increasingCount++;
    }
  }

  const increasingRatio = increasingCount / (snapshots.length - 1);

  // Potential leak if >70% of samples show increase and trend is positive
  if (increasingRatio > 0.7 && trend.changePerSecond > 1024) {
    return {
      detected: true,
      confidence: increasingRatio > 0.9 ? 'high' : 'medium',
      message: `Memory consistently increasing (${(increasingRatio * 100).toFixed(0)}% of samples)`,
      rate: trend.changePerSecondFormatted
    };
  }

  return {
    detected: false,
    confidence: 'high',
    message: 'No memory leak detected'
  };
}

/**
 * Create memory report from snapshots
 * @param {Array} snapshots - Array of memory snapshots
 * @returns {string} Formatted report
 */
function createMemoryReport(snapshots) {
  if (!snapshots || snapshots.length === 0) {
    return 'No memory data available';
  }

  const average = calculateAverageMemory(snapshots);
  const trend = analyzeMemoryTrend(snapshots);
  const leak = detectMemoryLeak(snapshots);
  const current = snapshots[snapshots.length - 1];

  let report = '=== Memory Report ===\n\n';

  report += 'Current Status:\n';
  report += `  Used: ${current.usedFormatted}\n`;
  report += `  Total: ${current.totalFormatted}\n`;
  report += `  Limit: ${current.limitFormatted}\n`;
  report += `  Status: ${current.status.toUpperCase()}\n\n`;

  report += 'Statistics:\n';
  report += `  Average: ${average.averageFormatted}\n`;
  report += `  Min: ${average.minFormatted}\n`;
  report += `  Max: ${average.maxFormatted}\n`;
  report += `  Samples: ${snapshots.length}\n\n`;

  report += 'Trend:\n';
  report += `  Direction: ${trend.trend}\n`;
  report += `  Change Rate: ${trend.changePerSecondFormatted}\n\n`;

  report += 'Leak Detection:\n';
  report += `  Leak Detected: ${leak.detected ? 'YES' : 'No'}\n`;
  report += `  Confidence: ${leak.confidence}\n`;
  report += `  Details: ${leak.message}\n`;

  return report;
}

module.exports = {
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
};
