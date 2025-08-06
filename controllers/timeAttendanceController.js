const TimeAttendance = require("../models/TimeAttendance");
const redisClient = require('../config/redis');

// Upload batch dữ liệu chấm công từ máy chấm công HIKVISION
exports.uploadAttendanceBatch = async (req, res) => {
    try {
        const { data, tracker_id } = req.body;

        if (!data || !Array.isArray(data)) {
            return res.status(400).json({
                status: "error",
                message: "Dữ liệu không hợp lệ. Cần array data."
            });
        }

        let recordsProcessed = 0;
        let recordsUpdated = 0;
        let errors = [];

        for (const record of data) {
            try {
                const { fingerprintCode, dateTime, device_id } = record;

                if (!fingerprintCode || !dateTime) {
                    errors.push({ record, error: "fingerprintCode và dateTime là bắt buộc" });
                    continue;
                }

                // Parse datetime
                let timestamp;
                try {
                    timestamp = TimeAttendance.parseAttendanceTimestamp(dateTime);
                } catch (parseError) {
                    errors.push({ record, error: `Format datetime không hợp lệ: ${parseError.message}` });
                    continue;
                }

                // Tìm hoặc tạo record cho ngày này
                const attendanceRecord = await TimeAttendance.findOrCreateDayRecord(
                    fingerprintCode,
                    timestamp,
                    device_id,
                    record.employeeName, // optional
                    record.deviceName    // optional
                );

                // Update tracker_id nếu có
                if (tracker_id) {
                    attendanceRecord.trackerId = tracker_id;
                }

                // Cập nhật thời gian chấm công
                attendanceRecord.updateAttendanceTime(timestamp, device_id);

                // Lưu record
                await attendanceRecord.save();

                if (attendanceRecord.isNew === false) {
                    recordsUpdated++;
                } else {
                    recordsProcessed++;
                }

                // Log batch processing
                const displayDateTime = timestamp.toLocaleString('vi-VN', {
                    timeZone: 'Asia/Ho_Chi_Minh',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
                
                console.log(`✅ Nhân viên ${record.employeeName || fingerprintCode} đã chấm công lúc ${displayDateTime} tại máy ${record.deviceName || 'Unknown Device'}.`);

            } catch (error) {
                console.error(`Lỗi xử lý record:`, error);
                errors.push({ record, error: error.message });
            }
        }

        res.status(200).json({
            status: "success",
            message: `Đã xử lý ${recordsProcessed} record mới, cập nhật ${recordsUpdated} record`,
            recordsProcessed,
            recordsUpdated,
            totalErrors: errors.length,
            errors: errors.slice(0, 10) // Chỉ trả về 10 lỗi đầu tiên
        });

    } catch (error) {
        console.error("Lỗi upload attendance batch:", error);
        res.status(500).json({
            status: "error",
            message: "Lỗi server khi xử lý dữ liệu chấm công",
            error: error.message
        });
    }
};

// Xử lý real-time event từ máy face ID Hikvision
exports.handleHikvisionEvent = async (req, res) => {
    try {
        console.log(`[${new Date().toISOString()}] === HIKVISION EVENT ===`);
        console.log('Headers:', JSON.stringify(req.headers, null, 2));
        console.log('Body:', JSON.stringify(req.body, null, 2));
        console.log('='.repeat(40));
        
        const eventData = req.body;
        
        // Nếu body rỗng, có thể là heartbeat
        if (!eventData || Object.keys(eventData).length === 0) {
            console.log('📡 Received heartbeat from Hikvision device');
            return res.status(200).json({
                status: "success",
                message: "Heartbeat received",
                timestamp: new Date().toISOString()
            });
        }
        
        // Extract thông tin từ event notification
        let eventType = null;
        let eventState = null;
        let dateTime = null;
        let activePost = null;
        let accessControllerEvent = null;
        
        if (eventData.EventNotificationAlert) {
            const alert = eventData.EventNotificationAlert;
            eventType = alert.eventType;
            eventState = alert.eventState;
            dateTime = alert.dateTime;
            activePost = alert.ActivePost;
            accessControllerEvent = alert.AccessControllerEvent;
        } else {
            eventType = eventData.eventType;
            eventState = eventData.eventState;
            dateTime = eventData.dateTime;
            activePost = eventData.ActivePost || eventData.activePost;
            accessControllerEvent = eventData.AccessControllerEvent;
        }

        // Kiểm tra eventType có hợp lệ không
        if (!eventType) {
            console.log('⚠️ No valid eventType found in event data');
            return res.status(200).json({
                status: "success", 
                message: "No valid eventType found",
                timestamp: new Date().toISOString()
            });
        }

        // Chỉ xử lý face recognition events
        const validEventTypes = ['faceSnapMatch', 'faceMatch', 'faceRecognition', 'accessControllerEvent', 'AccessControllerEvent'];
        if (!validEventTypes.includes(eventType)) {
            console.log(`Bỏ qua event type không liên quan: ${eventType}`);
            return res.status(200).json({
                status: "success",
                message: `Event type '${eventType}' không được xử lý`,
                eventType
            });
        }

        // Chỉ xử lý active events
        if (eventState !== 'active') {
            console.log(`Bỏ qua event state: ${eventState}`);
            return res.status(200).json({
                status: "success",
                message: `Event state '${eventState}' không được xử lý`,
                eventState
            });
        }

        let recordsProcessed = 0;
        let errors = [];

        // Xử lý ActivePost hoặc AccessControllerEvent data
        const postsToProcess = [];
        
        // Ưu tiên AccessControllerEvent nếu có (định dạng mới)
        if (accessControllerEvent) {
            postsToProcess.push(accessControllerEvent);
        } else if (activePost && Array.isArray(activePost)) {
            postsToProcess.push(...activePost);
        } else if (activePost) {
            postsToProcess.push(activePost);
        } else {
            // Fallback: parse từ root level
            postsToProcess.push(eventData);
        }

        for (const post of postsToProcess) {
            try {
                // Trích xuất thông tin nhân viên - ưu tiên employeeNoString
                const employeeCode = post.employeeNoString || post.FPID || post.cardNo || post.employeeCode || post.userID;
                const employeeName = post.name || null; // Tên nhân viên
                const timestamp = post.dateTime || dateTime;
                const deviceId = post.ipAddress || eventData.ipAddress || post.deviceID;
                const deviceName = post.deviceName || eventData.deviceName || 'Unknown Device'; // Tên thiết bị

                if (!employeeCode || !timestamp) {
                    errors.push({
                        post,
                        error: "Thiếu employeeCode hoặc timestamp"
                    });
                    continue;
                }

                // Parse timestamp
                let parsedTimestamp;
                try {
                    parsedTimestamp = TimeAttendance.parseAttendanceTimestamp(timestamp);
                } catch (parseError) {
                    errors.push({
                        post,
                        error: `Format datetime không hợp lệ: ${parseError.message}`
                    });
                    continue;
                }

                // Tìm hoặc tạo attendance record với employeeName và deviceName
                const attendanceRecord = await TimeAttendance.findOrCreateDayRecord(
                    employeeCode,
                    parsedTimestamp,
                    deviceId,
                    employeeName,
                    deviceName
                );

                // Thêm metadata từ Hikvision event
                let notes = attendanceRecord.notes || '';
                if (post.name) {
                    notes += `Face ID: ${post.name}; `;
                }
                if (post.similarity) {
                    notes += `Similarity: ${post.similarity}%; `;
                }
                if (eventType) {
                    notes += `Event: ${eventType}; `;
                }
                attendanceRecord.notes = notes;

                // Cập nhật thời gian chấm công
                attendanceRecord.updateAttendanceTime(parsedTimestamp, deviceId);

                // Lưu record vào database
                await attendanceRecord.save();
                recordsProcessed++;

                // Log message theo format yêu cầu
                const displayDateTime = parsedTimestamp.toLocaleString('vi-VN', {
                    timeZone: 'Asia/Ho_Chi_Minh',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
                
                console.log(`✅ Nhân viên ${employeeName || employeeCode} đã chấm công lúc ${displayDateTime} tại máy ${deviceName}.`);

                // TODO: Publish event to Redis for future Frappe/Notification integration
                try {
                    await publishAttendanceEvent({
                        employeeCode,
                        employeeName,
                        timestamp: parsedTimestamp.toISOString(),
                        deviceId,
                        deviceName,
                        eventType,
                        checkInTime: attendanceRecord.checkInTime,
                        checkOutTime: attendanceRecord.checkOutTime
                    });
                } catch (redisError) {
                    console.warn('⚠️ Redis publish failed:', redisError.message);
                    // Don't fail the main operation if Redis fails
                }

            } catch (error) {
                console.error(`❌ Error processing post:`, error);
                errors.push({
                    post,
                    error: error.message
                });
            }
        }

        const response = {
            status: "success",
            message: `Processed ${recordsProcessed} attendance events`,
            timestamp: new Date().toISOString(),
            eventType: eventType || 'unknown',
            eventState: eventState || 'unknown',
            recordsProcessed,
            totalErrors: errors.length
        };

        if (errors.length > 0) {
            response.errors = errors.slice(0, 5);
        }

        console.log(`📊 Hikvision event result: ${recordsProcessed} success, ${errors.length} errors`);

        res.status(200).json(response);

    } catch (error) {
        console.error("❌ Error processing Hikvision event:", error);
        res.status(500).json({
            status: "error",
            message: "Server error processing Hikvision event",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

// Helper function để publish attendance event tới Redis (cho tương lai)
async function publishAttendanceEvent(eventData) {
    try {
        if (redisClient && redisClient.publishAttendanceEvent) {
            await redisClient.publishAttendanceEvent('attendance_recorded', eventData);
        }
    } catch (error) {
        console.warn('⚠️ Failed to publish attendance event to Redis:', error.message);
        throw error;
    }
}