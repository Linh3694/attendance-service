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
                    device_id
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

                console.log(`✅ Processed batch attendance for ${fingerprintCode} at ${timestamp.toISOString()}`);

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
        let eventType, eventState, dateTime, activePost;
        
        if (eventData.EventNotificationAlert) {
            const alert = eventData.EventNotificationAlert;
            eventType = alert.eventType;
            eventState = alert.eventState;
            dateTime = alert.dateTime;
            activePost = alert.ActivePost;
        } else {
            eventType = eventData.eventType;
            eventState = eventData.eventState;
            dateTime = eventData.dateTime;
            activePost = eventData.ActivePost || eventData.activePost;
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

        // Xử lý ActivePost data
        const postsToProcess = [];
        if (activePost && Array.isArray(activePost)) {
            postsToProcess.push(...activePost);
        } else if (activePost) {
            postsToProcess.push(activePost);
        } else {
            // Fallback: parse từ root level
            postsToProcess.push(eventData);
        }

        for (const post of postsToProcess) {
            try {
                // Trích xuất thông tin nhân viên
                const employeeCode = post.FPID || post.cardNo || post.employeeCode || post.userID;
                const timestamp = post.dateTime || dateTime;
                const deviceId = post.ipAddress || eventData.ipAddress || post.deviceID;

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

                // Tìm hoặc tạo attendance record
                const attendanceRecord = await TimeAttendance.findOrCreateDayRecord(
                    employeeCode,
                    parsedTimestamp,
                    deviceId
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

                // Lưu record
                await attendanceRecord.save();
                recordsProcessed++;

                console.log(`✅ Processed event for employee ${employeeCode} at ${parsedTimestamp.toISOString()}`);

                // TODO: Publish event to Redis for future Frappe/Notification integration
                try {
                    await publishAttendanceEvent({
                        employeeCode,
                        timestamp: parsedTimestamp.toISOString(),
                        deviceId,
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
            eventType,
            eventState,
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