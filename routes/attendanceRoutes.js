const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');

// Standard REST API routes
router.post('/find-or-create-day-record', attendanceController.findOrCreateDayRecord.bind(attendanceController));
router.post('/update-attendance-time', attendanceController.updateAttendanceTime.bind(attendanceController));
router.get('/stats', attendanceController.getAttendanceStats.bind(attendanceController));
router.get('/employee/:employee_code', attendanceController.getEmployeeAttendance.bind(attendanceController));

// Hikvision event processing (compatible with existing backend)
router.post('/hikvision-event', attendanceController.processHikvisionEvent.bind(attendanceController));

// Frappe-compatible API routes
// These routes mimic Frappe's API structure for seamless integration

// Frappe method calls
router.post('/erp.common.doctype.erp_time_attendance.erp_time_attendance.find_or_create_day_record', 
  attendanceController.findOrCreateDayRecord.bind(attendanceController));

router.post('/erp.common.doctype.erp_time_attendance.erp_time_attendance.get_attendance_stats', 
  attendanceController.getAttendanceStats.bind(attendanceController));

// Frappe resource API
router.get('/ERP%20Time%20Attendance', async (req, res) => {
  // Convert Frappe filters to our format
  const { filters, fields, limit_start, limit_page_length, order_by } = req.query;
  
  let parsedFilters = {};
  if (filters) {
    try {
      parsedFilters = JSON.parse(filters);
    } catch (e) {
      // Handle simple filters
      parsedFilters = req.query;
    }
  }

  // Convert to our controller format
  req.query = {
    ...parsedFilters,
    limit: limit_page_length || 50,
    start_date: parsedFilters.date?.[1],
    end_date: parsedFilters.date?.[2],
    employee_code: parsedFilters.employee_code
  };

  await attendanceController.getAttendanceStats(req, res);
});

router.get('/ERP%20Time%20Attendance/:name', async (req, res) => {
  try {
    const database = require('../config/database');
    const record = await database.get('ERP Time Attendance', req.params.name);
    
    if (!record) {
      return res.status(404).json({
        error: 'Record not found',
        message: `ERP Time Attendance ${req.params.name} not found`
      });
    }

    res.json({
      message: record,
      status: 'success'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

router.post('/ERP%20Time%20Attendance', async (req, res) => {
  try {
    const database = require('../config/database');
    const data = req.body;
    
    // Add required Frappe fields
    data.name = data.name || `TIME-ATT-${Date.now()}`;
    data.creation = new Date().toISOString();
    data.modified = new Date().toISOString();
    data.owner = 'Administrator';
    data.modified_by = 'Administrator';
    data.docstatus = 0;
    data.idx = 0;

    await database.insert('ERP Time Attendance', data);

    res.json({
      message: data,
      status: 'success'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

router.put('/ERP%20Time%20Attendance/:name', async (req, res) => {
  try {
    const database = require('../config/database');
    const data = req.body;
    
    // Update modified timestamp
    data.modified = new Date().toISOString();
    data.modified_by = 'Administrator';

    await database.update('ERP Time Attendance', req.params.name, data);

    // Get updated record
    const updated = await database.get('ERP Time Attendance', req.params.name);

    res.json({
      message: updated,
      status: 'success'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

router.delete('/ERP%20Time%20Attendance/:name', async (req, res) => {
  try {
    const database = require('../config/database');
    await database.delete('ERP Time Attendance', req.params.name);

    res.json({
      message: 'Record deleted successfully',
      status: 'success'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Health check for this service
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'attendance-routes',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;