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
 * POST /api/attendance/test/fake-attendance
 * Test endpoint để gửi fake attendance và trigger notification
 * Body: { employeeCode, employeeName, deviceName }
 */
router.post("/test/fake-attendance", async (req, res) => {
    try {
        const { employeeCode, employeeName, deviceName } = req.body;
        
        if (!employeeCode) {
            return res.status(400).json({
                status: "error",
                message: "employeeCode là bắt buộc"
            });
        }

        // Tạo fake attendance data
        const currentTime = new Date();
        const fakeAttendanceData = {
            employeeCode: employeeCode || 'TEST001',
            employeeName: employeeName || 'Test User',
            timestamp: currentTime.toISOString(),
            deviceId: 'TEST_DEVICE',
            deviceName: deviceName || 'Test Face ID Device',
            eventType: 'test_attendance',
            displayTime: currentTime.toLocaleString('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            })
        };

        // Publish fake attendance event để trigger notification
        const redisClient = require('../config/redis');
        if (redisClient && redisClient.publishAttendanceEvent) {
            await redisClient.publishAttendanceEvent('test_attendance_recorded', fakeAttendanceData);
            console.log(`✅ [Test] Published fake attendance event for ${employeeCode}`);
        } else {
            console.warn('⚠️ [Test] Redis client không khả dụng, không thể gửi notification');
        }

        // Log message
        console.log(`🧪 [Test] Fake attendance: Nhân viên ${employeeName || employeeCode} đã chấm công lúc ${fakeAttendanceData.displayTime} tại máy ${deviceName || 'Test Device'}.`);

        res.status(200).json({
            status: "success",
            message: "Fake attendance event đã được tạo và gửi",
            data: fakeAttendanceData
        });

    } catch (error) {
        console.error("❌ Error creating fake attendance:", error);
        res.status(500).json({
            status: "error",
            message: "Lỗi khi tạo fake attendance event",
            error: error.message
        });
    }
});

module.exports = router;