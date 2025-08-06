const express = require('express');
const router = express.Router();
const multer = require('multer');
const timeAttendanceController = require('../controllers/timeAttendanceController');

// Cấu hình multer để handle multipart/form-data từ máy Hikvision
const upload = multer();

// Middleware để log requests
const logRequest = (req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
};

// Middleware để handle multipart form data từ Hikvision
const parseHikvisionData = (req, res, next) => {
    if (req.path.includes('hikvision')) {
        console.log('📦 Parsing Hikvision multipart data...');
        console.log('Fields received:', req.body);
        
        // Nếu có dữ liệu trong form fields, parse thành JSON
        if (req.body && Object.keys(req.body).length > 0) {
            try {
                // Hikvision có thể gửi JSON trong một field cụ thể
                for (let key in req.body) {
                    try {
                        const parsed = JSON.parse(req.body[key]);
                        req.body = parsed;
                        console.log('✅ Successfully parsed JSON from field:', key);
                        break;
                    } catch (e) {
                        // Không phải JSON, giữ nguyên
                        continue;
                    }
                }
            } catch (error) {
                console.log('❌ Error parsing multipart data:', error.message);
            }
        }
    }
    next();
};

// Apply global middleware
router.use(logRequest);

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

module.exports = router;