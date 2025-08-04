const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');
const hikvisionController = require('../controllers/hikvisionController');

// Parse raw body for Hikvision webhooks
const parseRawBody = (req, res, next) => {
  if (req.headers['content-type'] === 'application/json') {
    let rawData = '';
    req.on('data', chunk => {
      rawData += chunk.toString();
    });
    req.on('end', () => {
      try {
        req.body = JSON.parse(rawData);
        next();
      } catch (error) {
        console.error('Error parsing JSON:', error);
        req.body = {};
        next();
      }
    });
  } else {
    next();
  }
};

const logRequest = (req, res, next) => {
  console.log(`📥 [Time Attendance] ${req.method} ${req.url}`, {
    headers: req.headers,
    body: req.body,
    query: req.query
  });
  next();
};

// Basic time attendance routes
router.post('/find-or-create', attendanceController.findOrCreateDayRecord.bind(attendanceController));
router.post('/update', attendanceController.updateAttendanceTime.bind(attendanceController));
router.get('/stats', attendanceController.getAttendanceStats.bind(attendanceController));
router.get('/employee/:employee_code', attendanceController.getEmployeeAttendance.bind(attendanceController));

// Hikvision integration routes
router.post('/hikvision/event', 
  logRequest,
  parseRawBody,
  hikvisionController.handleHikvisionEvent.bind(hikvisionController)
);

router.post('/hikvision/batch',
  hikvisionController.uploadAttendanceBatch.bind(hikvisionController)
);

router.get('/hikvision/stats',
  hikvisionController.getProcessingStats.bind(hikvisionController)
);

// Legacy Hikvision endpoint for compatibility
router.post('/hikvision', 
  logRequest,
  parseRawBody,
  hikvisionController.handleHikvisionEvent.bind(hikvisionController)
);

// Legacy process endpoint
router.post('/process', attendanceController.processHikvisionEvent.bind(attendanceController));

// Frappe-compatible API endpoints
router.post('/erp.it.doctype.erp_time_attendance.erp_time_attendance.find_or_create_day_record',
  attendanceController.findOrCreateDayRecord.bind(attendanceController));

router.post('/erp.it.doctype.erp_time_attendance.erp_time_attendance.update_attendance_time',
  attendanceController.updateAttendanceTime.bind(attendanceController));

router.post('/erp.it.doctype.erp_time_attendance.erp_time_attendance.handle_hikvision_event',
  logRequest,
  parseRawBody,
  hikvisionController.handleHikvisionEvent.bind(hikvisionController)
);

module.exports = router;