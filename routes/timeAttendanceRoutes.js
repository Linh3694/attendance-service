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
    if (req.path.includes('hikvision-event')) {
        console.log('📦 Parsing Hikvision multipart data...');
        console.log('Fields received:', req.body);
        console.log('Files received:', req.files);
        
        // Nếu có dữ liệu trong form fields, parse thành JSON
        if (req.body && Object.keys(req.body).length > 0) {
            try {
                // Hikvision có thể gửi JSON trong một field cụ thể
                for (let key in req.body) {
                    console.log(`Field "${key}":`, req.body[key]);
                    try {
                        // Thử parse field như JSON
                        const parsed = JSON.parse(req.body[key]);
                        req.body = parsed; // Replace body với parsed JSON
                        console.log('✅ Successfully parsed JSON from field:', key);
                        break;
                    } catch (e) {
                        // Không phải JSON, giữ nguyên
                        console.log(`Field "${key}" is not JSON:`, req.body[key]);
                    }
                }
            } catch (error) {
                console.log('❌ Error parsing multipart data:', error.message);
            }
        }
    }
    next();
};

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

// Apply middleware
router.use(logRequest);

// Routes cho upload dữ liệu từ máy chấm công (không cần auth để máy chấm công có thể gửi)
/**
 * POST /api/attendance/upload
 * Upload batch dữ liệu chấm công từ máy chấm công HIKVISION
 * Body: { data: [{ fingerprintCode, dateTime, device_id }], tracker_id }
 */
router.post("/upload", timeAttendanceController.uploadAttendanceBatch);

/**
 * POST /api/attendance/hikvision-event
 * Xử lý real-time event notification từ máy face ID Hikvision
 * Body: Hikvision Event Notification JSON format
 * Không cần authentication để máy face ID có thể gửi trực tiếp
 */
router.post("/hikvision-event", 
    upload.any(), // Parse multipart/form-data
    parseHikvisionData, // Parse Hikvision data format
    timeAttendanceController.handleHikvisionEvent
);

/**
 * POST /api/attendance/test-hikvision-event
 * Test endpoint để simulate Hikvision event (chỉ dùng development)
 * Body: { employeeCode?: string, employeeName?: string, similarity?: number }
 */
router.post("/test-hikvision-event", timeAttendanceController.testHikvisionEvent);

// Legacy endpoints for compatibility
router.post("/hikvision/event", 
    logRequest,
    upload.any(), // Parse multipart/form-data
    parseHikvisionData, // Parse Hikvision data format
    timeAttendanceController.processHikvisionEvent
);

router.post("/hikvision/batch", timeAttendanceController.uploadAttendanceBatch);

router.post("/hikvision", 
    logRequest,
    upload.any(), // Parse multipart/form-data
    parseHikvisionData, // Parse Hikvision data format
    timeAttendanceController.processHikvisionEvent
);

router.post("/process", timeAttendanceController.processHikvisionEvent);

// Routes cần authentication (cho admin/user interface)
// Uncomment dòng dưới nếu muốn bảo vệ các routes này
// router.use(authenticate);

/**
 * GET /api/attendance/records
 * Lấy danh sách records chấm công với filter và pagination
 * Query params: startDate, endDate, employeeCode, page, limit, sortBy, sortOrder
 */
router.get("/records", timeAttendanceController.getAttendanceRecords);

/**
 * GET /api/attendance/stats
 * Lấy thống kê tổng quan về dữ liệu chấm công
 * Query params: startDate, endDate, employeeCode
 */
router.get("/stats", timeAttendanceController.getAttendanceStats);

/**
 * GET /api/attendance/employee/:employeeCode
 * Lấy chi tiết chấm công của một nhân viên cụ thể
 * Params: employeeCode
 * Query params: startDate, endDate, includeRawData
 */
router.get("/employee/:employeeCode", timeAttendanceController.getEmployeeAttendance);

/**
 * PUT /api/attendance/record/:recordId/notes
 * Cập nhật ghi chú cho một record chấm công
 * Params: recordId
 * Body: { notes, status }
 */
router.put("/record/:recordId/notes", timeAttendanceController.updateAttendanceNotes);

/**
 * DELETE /api/attendance/records
 * Xóa dữ liệu chấm công theo điều kiện
 * Body: { startDate, endDate, employeeCode, confirmDelete: true }
 */
router.delete("/records", timeAttendanceController.deleteAttendanceRecords);

/**
 * POST /api/attendance/sync-users
 * Đồng bộ employeeCode với Users collection
 */
router.post("/sync-users", timeAttendanceController.syncWithUsers);

/**
 * POST /api/attendance/cleanup-raw-data
 * Cleanup rawData cũ hơn 7 ngày để tiết kiệm storage
 */
router.post("/cleanup-raw-data", timeAttendanceController.cleanupOldRawData);

/**
 * POST /api/attendance/cleanup-duplicates
 * Cleanup duplicate rawData records để tránh hiển thị trùng lặp
 */
router.post("/cleanup-duplicates", timeAttendanceController.cleanupDuplicateRawData);

/**
 * POST /api/attendance/configure-filtering
 * Admin endpoint để cấu hình event filtering (ignore old events)
 * Body: { ignoreOlderThanMinutes?: number, resetServerStartTime?: boolean }
 */
router.post("/configure-filtering", timeAttendanceController.configureEventFiltering);

/**
 * GET /api/attendance/filtering-status
 * Lấy trạng thái hiện tại của event filtering
 */
router.get("/filtering-status", timeAttendanceController.getEventFilteringStatus);

/**
 * POST /api/attendance/reset-start-time
 * ADMIN ONLY: Reset server start time để bỏ qua tất cả events cũ
 */
router.post("/reset-start-time", timeAttendanceController.resetServerStartTime);

/**
 * GET /api/attendance/hikvision/stats
 * Lấy thống kê xử lý events từ Hikvision
 */
router.get("/hikvision/stats", timeAttendanceController.getProcessingStats);

// Health check endpoint
router.get("/health", (req, res) => {
    res.status(200).json({
        status: "success",
        message: "Time Attendance API is running",
        timestamp: new Date().toISOString()
    });
});

module.exports = router;