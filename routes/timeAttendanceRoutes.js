const express = require('express');
const router = express.Router();
const timeAttendanceController = require('../controllers/timeAttendanceController');

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

// Time attendance routes
router.post('/find-or-create', timeAttendanceController.findOrCreateTimeAttendance.bind(timeAttendanceController));
router.post('/update', timeAttendanceController.updateTimeAttendance.bind(timeAttendanceController));
router.get('/stats', timeAttendanceController.getTimeAttendanceStats.bind(timeAttendanceController));
router.get('/employee/:employee_code', timeAttendanceController.getEmployeeTimeAttendance.bind(timeAttendanceController));

// Hikvision integration routes
router.post('/hikvision/event', 
  logRequest,
  parseRawBody,
  timeAttendanceController.processHikvisionEvent.bind(timeAttendanceController)
);

router.post('/hikvision/batch',
  timeAttendanceController.uploadAttendanceBatch.bind(timeAttendanceController)
);

router.get('/hikvision/stats',
  timeAttendanceController.getProcessingStats.bind(timeAttendanceController)
);

// Legacy Hikvision endpoint for compatibility
router.post('/hikvision', 
  logRequest,
  parseRawBody,
  timeAttendanceController.processHikvisionEvent.bind(timeAttendanceController)
);

// Legacy process endpoint
router.post('/process', timeAttendanceController.processHikvisionEvent.bind(timeAttendanceController));

module.exports = router;