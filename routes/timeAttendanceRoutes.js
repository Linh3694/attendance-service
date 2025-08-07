const express = require('express');
const router = express.Router();
const multer = require('multer');
const timeAttendanceController = require('../controllers/timeAttendanceController');
const { authenticateToken } = require('../middleware/auth');

// Cấu hình multer để handle multipart/form-data từ máy Hikvision
const upload = multer();

// Middleware để handle multipart form data từ Hikvision
const parseHikvisionData = (req, res, next) => {
    if (req.path.includes('hikvision')) {
        // Parse JSON data từ form fields nếu có
        if (req.body && Object.keys(req.body).length > 0) {
            try {
                // Hikvision có thể gửi JSON trong một field cụ thể
                for (let key in req.body) {
                    try {
                        const parsed = JSON.parse(req.body[key]);
                        req.body = parsed;
                        break;
                    } catch (e) {
                        // Không phải JSON, giữ nguyên
                        continue;
                    }
                }
            } catch (error) {
                // Silent fail, giữ body nguyên
            }
        }
    }
    next();
};

// Apply global middleware cho parsing

/**
 * POST /api/attendance/hikvision-event
 * Xử lý real-time event từ máy face ID Hikvision
 * Body: Hikvision Event Notification JSON format
 * Không cần authentication để máy face ID có thể gửi trực tiếp
 */
router.post("/hikvision-event", 
    upload.any(), // Parse multipart/form-data
    parseHikvisionData, // Parse Hikvision data format
    timeAttendanceController.handleHikvisionEvent
);

/**
 * GET /api/attendance/employee/:employeeCode
 * Lấy dữ liệu chấm công của nhân viên theo employeeCode
 * Query params: date, startDate, endDate, includeRawData, page, limit
 * Requires authentication
 */
router.get("/employee/:employeeCode", authenticateToken, timeAttendanceController.getEmployeeAttendance);

/**
 * GET /api/attendance/debug/:employeeCode
 * Debug attendance data - show all rawData timestamps
 * Query params: date (required)
 */
router.get("/debug/:employeeCode", async (req, res) => {
    try {
        const { employeeCode } = req.params;
        const { date } = req.query;
        
        if (!employeeCode || !date) {
            return res.status(400).json({
                status: "error",
                message: "employeeCode and date are required"
            });
        }
        
        const TimeAttendance = require('../models/TimeAttendance');
        
        // Get attendance record for specific date
        const targetDate = new Date(date);
        const dayStart = new Date(targetDate);
        dayStart.setHours(0, 0, 0, 0);
        
        const record = await TimeAttendance.findOne({
            employeeCode: employeeCode,
            date: dayStart
        });
        
        if (!record) {
            return res.status(404).json({
                status: "error",
                message: "No attendance record found for this date"
            });
        }
        
        // Process and sort all timestamps
        const allTimestamps = record.rawData.map(item => ({
            timestamp: item.timestamp,
            deviceId: item.deviceId,
            recordedAt: item.recordedAt,
            // Format for VN timezone display
            vnTime: new Date(item.timestamp).toLocaleString('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            })
        })).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        // Calculate check-in/check-out
        const checkInTime = allTimestamps[0];
        const checkOutTime = allTimestamps[allTimestamps.length - 1];
        
        const response = {
            status: "success",
            employeeCode,
            date: record.date.toISOString().split('T')[0],
            summary: {
                totalCheckIns: allTimestamps.length,
                checkInTime: checkInTime ? {
                    utc: checkInTime.timestamp,
                    vnTime: checkInTime.vnTime
                } : null,
                checkOutTime: checkOutTime ? {
                    utc: checkOutTime.timestamp,
                    vnTime: checkOutTime.vnTime
                } : null,
                storedCheckIn: record.checkInTime,
                storedCheckOut: record.checkOutTime
            },
            allTimestamps: allTimestamps,
            duplicateAnalysis: {
                uniqueTimestamps: [...new Set(allTimestamps.map(t => t.timestamp))].length,
                hasDuplicates: allTimestamps.length > [...new Set(allTimestamps.map(t => t.timestamp))].length
            }
        };
        
        console.log(`🔍 [Debug] Attendance data for ${employeeCode} on ${date}:`, {
            total: allTimestamps.length,
            earliest: checkInTime?.vnTime,
            latest: checkOutTime?.vnTime
        });
        
        res.status(200).json(response);
        
    } catch (error) {
        console.error('Debug endpoint error:', error);
        res.status(500).json({
            status: "error",
            message: "Failed to debug attendance data",
            error: error.message
        });
    }
});

/**
 * POST /api/attendance/upload
 * Upload batch dữ liệu chấm công từ máy chấm công HIKVISION
 * Body: { data: [{ fingerprintCode, dateTime, device_id }], tracker_id }
 */
router.post("/upload", timeAttendanceController.uploadAttendanceBatch);

// Legacy endpoints for compatibility
router.post("/hikvision/event", 
    upload.any(),
    parseHikvisionData,
    timeAttendanceController.handleHikvisionEvent
);

router.post("/hikvision/batch", timeAttendanceController.uploadAttendanceBatch);

router.post("/hikvision", 
    upload.any(),
    parseHikvisionData,
    timeAttendanceController.handleHikvisionEvent
);

router.post("/process", timeAttendanceController.handleHikvisionEvent);

// Health check endpoint
router.get("/health", (req, res) => {
    res.status(200).json({
        status: "success",
        message: "Time Attendance Service is running",
        timestamp: new Date().toISOString(),
        service: "attendance-service",
        version: "1.0.0-simplified"
    });
});

/**
 * POST /api/attendance/fix-employee/:employeeCode
 * Fix and recalculate all attendance records for an employee
 * Fixes check-out time calculation issues
 */
router.post("/fix-employee/:employeeCode", async (req, res) => {
    try {
        const { employeeCode } = req.params;
        
        if (!employeeCode) {
            return res.status(400).json({
                status: "error",
                message: "employeeCode is required"
            });
        }
        
        const TimeAttendance = require('../models/TimeAttendance');
        const result = await TimeAttendance.fixAllAttendanceForEmployee(employeeCode);
        
        res.status(200).json({
            status: "success",
            message: `Fixed attendance records for ${employeeCode}`,
            data: {
                employeeCode,
                fixedRecords: result.fixedCount,
                totalRecords: result.totalRecords,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error fixing attendance:', error);
        res.status(500).json({
            status: "error",
            message: "Failed to fix attendance records",
            error: error.message
        });
    }
});

/**
 * POST /api/attendance/fix-all
 * Fix all attendance records in the system (use with caution)
 */
router.post("/fix-all", async (req, res) => {
    try {
        const { confirm } = req.body;
        
        if (confirm !== "YES_I_WANT_TO_FIX_ALL_RECORDS") {
            return res.status(400).json({
                status: "error",
                message: "Please confirm by sending { confirm: 'YES_I_WANT_TO_FIX_ALL_RECORDS' }"
            });
        }
        
        const TimeAttendance = require('../models/TimeAttendance');
        
        // Get all unique employee codes
        const employeeCodes = await TimeAttendance.distinct('employeeCode');
        let totalFixed = 0;
        let totalRecords = 0;
        
        console.log(`🔧 Starting mass fix for ${employeeCodes.length} employees...`);
        
        for (const employeeCode of employeeCodes) {
            try {
                const result = await TimeAttendance.fixAllAttendanceForEmployee(employeeCode);
                totalFixed += result.fixedCount;
                totalRecords += result.totalRecords;
            } catch (error) {
                console.error(`❌ Failed to fix records for ${employeeCode}:`, error);
            }
        }
        
        res.status(200).json({
            status: "success",
            message: "Mass fix completed",
            data: {
                employeesProcessed: employeeCodes.length,
                totalRecordsFixed: totalFixed,
                totalRecordsProcessed: totalRecords,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error in mass fix:', error);
        res.status(500).json({
            status: "error",
            message: "Failed to perform mass fix",
            error: error.message
        });
    }
});

module.exports = router;