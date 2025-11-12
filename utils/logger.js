/**
 * Winston Logger for Attendance Service
 * Structured JSON logging cho attendance check-in/out operations
 */

const winston = require('winston');

// Custom JSON formatter
const jsonFormat = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  const logObject = {
    timestamp,
    level,
    service: 'attendance',
    message,
  };

  // Add metadata fields if present
  if (meta.user_email) logObject.user_email = meta.user_email;
  if (meta.user_name) logObject.user_name = meta.user_name;
  if (meta.action) logObject.action = meta.action;
  if (meta.student_id) logObject.student_id = meta.student_id;
  if (meta.check_time) logObject.check_time = meta.check_time;
  if (meta.location) logObject.location = meta.location;
  if (meta.is_late) logObject.is_late = meta.is_late;
  if (meta.late_minutes) logObject.late_minutes = meta.late_minutes;
  if (meta.duration_ms) logObject.duration_ms = meta.duration_ms;
  if (meta.http_status) logObject.http_status = meta.http_status;
  if (meta.ip) logObject.ip = meta.ip;
  if (meta.details) logObject.details = meta.details;

  return JSON.stringify(logObject, null, 0);
});

// Create logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss Z' }),
    jsonFormat
  ),
  defaultMeta: { service: 'attendance' },
  transports: [
    // Console transport for PM2 capture
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss Z' }),
        jsonFormat
      ),
    }),
  ],
});

/**
 * Log check-in
 */
function logCheckIn(student_id, student_email, student_name, check_time, location = 'unknown', method = 'mobile') {
  logger.info(`Check-in học sinh`, {
    user_email: student_email,
    user_name: student_name,
    action: 'check_in',
    student_id,
    check_time,
    location,
    details: {
      method,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Log check-out
 */
function logCheckOut(student_id, student_email, student_name, check_time, location = 'unknown', method = 'mobile') {
  logger.info(`Check-out học sinh`, {
    user_email: student_email,
    user_name: student_name,
    action: 'check_out',
    student_id,
    check_time,
    location,
    details: {
      method,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Log late arrival
 */
function logLateArrival(student_id, student_email, student_name, scheduled_time, actual_time, late_minutes) {
  logger.warn(`Học sinh đến muộn`, {
    user_email: student_email,
    user_name: student_name,
    action: 'late_arrival',
    student_id,
    is_late: true,
    late_minutes,
    details: {
      scheduled_time,
      actual_time,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Log early departure
 */
function logEarlyDeparture(student_id, student_email, student_name, scheduled_time, actual_time, early_minutes) {
  logger.info(`Học sinh về sớm`, {
    user_email: student_email,
    user_name: student_name,
    action: 'early_departure',
    student_id,
    details: {
      scheduled_time,
      actual_time,
      early_minutes,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Log manual attendance correction
 */
function logManualCorrection(corrected_by_email, corrected_by_name, student_id, student_email, old_time, new_time, reason = '') {
  logger.info(`Chỉnh sửa điểm danh`, {
    user_email: corrected_by_email,
    user_name: corrected_by_name,
    action: 'manual_correction',
    student_id,
    details: {
      student_email,
      old_time,
      new_time,
      reason,
      corrected_at: new Date().toISOString(),
    },
  });
}

/**
 * Log API call with response time
 */
function logAPICall(user_email, method, endpoint, response_time_ms, http_status, ip = '') {
  const level = http_status >= 400 ? 'warn' : 'info';
  const slow_marker = response_time_ms > 2000 ? ' [CHẬM]' : '';

  logger[level](`API${slow_marker}: ${method} ${endpoint}`, {
    user_email,
    action: `api_${method.toLowerCase()}`,
    duration_ms: response_time_ms,
    http_status,
    ip,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Log error
 */
function logError(user_email, action, error_message, student_id = '', details = {}) {
  logger.error(`Lỗi: ${action}`, {
    user_email,
    action,
    student_id,
    error_message,
    details,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Log cache operation
 */
function logCacheOperation(operation, key, hit = null) {
  const action = hit ? 'cache_hit' : hit === false ? 'cache_miss' : 'cache_invalidate';
  logger.info(`Cache ${operation}`, {
    action,
    key,
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  logger,
  logCheckIn,
  logCheckOut,
  logLateArrival,
  logEarlyDeparture,
  logManualCorrection,
  logAPICall,
  logError,
  logCacheOperation,
};

