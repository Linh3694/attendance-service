/**
 * TimeAttendance Controller
 * 
 * ⚠️ TIMEZONE FIXES APPLIED:
 * 
 * 1. ✅ Unified timezone handling:
 *    - All date strings (YYYY-MM-DD) are normalized using TimeAttendance.parseAndNormalizeDateString()
 *    - Ensures consistent date handling regardless of server timezone
 * 
 * 2. ✅ Consistent query logic:
 *    - API Day (/students/day): Uses parseAndNormalizeDateString() for exact date match
 *    - API Range (/employee/:code): Uses parseAndNormalizeDateString() for $gte/$lte query
 *    - Both APIs now use same normalization logic
 * 
 * 3. ✅ Data integrity:
 *    - Dates are normalized to VN timezone (+7) before querying
 *    - Prevents race condition issues from timezone inconsistencies
 * 
 * Note: All dates in DB are stored as UTC but represent VN timezone dates.
 * Example: VN 2025-01-15 00:00:00+07:00 = UTC 2025-01-14T17:00:00Z
 */
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

                // Publish notification for batch attendance 
                try {
                    await publishAttendanceEvent({
                        employeeCode: fingerprintCode,
                        employeeName: record.employeeName,
                        timestamp: timestamp.toISOString(),
                        deviceId: device_id,
                        deviceName: record.deviceName || 'Unknown Device',
                        eventType: 'batch_upload',
                        checkInTime: attendanceRecord.checkInTime ? attendanceRecord.checkInTime.toISOString() : null,
                        checkOutTime: attendanceRecord.checkOutTime ? attendanceRecord.checkOutTime.toISOString() : null,
                        totalCheckIns: attendanceRecord.totalCheckIns,
                        date: attendanceRecord.date.toISOString().split('T')[0],
                        displayTime: displayDateTime,
                        trackerId: tracker_id
                    });
                } catch (redisError) {
                    console.warn('⚠️ Redis publish failed for batch:', redisError.message);
                }

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
        const eventData = req.body;
        
        // 🔍 LOG RAW DATA - DEBUGGING
        console.log('\n' + '='.repeat(80));
        console.log('🔍 [HIKVISION RAW DATA] Received at:', new Date().toISOString());
        console.log('Request Headers:', JSON.stringify(req.headers, null, 2));
        console.log('Request Body (Raw):', JSON.stringify(eventData, null, 2));
        console.log('Request Body (String):', JSON.stringify(eventData));
        console.log('='.repeat(80) + '\n');
        
        // Nếu body rỗng, có thể là heartbeat
        if (!eventData || Object.keys(eventData).length === 0) {
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
            return res.status(200).json({
                status: "success", 
                message: "No valid eventType found",
                timestamp: new Date().toISOString()
            });
        }

        // Chỉ xử lý face recognition events
        const validEventTypes = ['faceSnapMatch', 'faceMatch', 'faceRecognition', 'accessControllerEvent', 'AccessControllerEvent'];
        if (!validEventTypes.includes(eventType)) {
            return res.status(200).json({
                status: "success",
                message: `Event type '${eventType}' không được xử lý`,
                eventType
            });
        }

        // Chỉ xử lý active events
        if (eventState !== 'active') {
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

                // Bỏ qua events không có employee data (device status events, heartbeat)
                if (!employeeCode || !timestamp) {
                    // Không coi đây là lỗi, chỉ là device status event
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

                // Publish event to Redis for Frappe/Notification integration
                try {
                    await publishAttendanceEvent({
                        employeeCode,
                        employeeName,
                        timestamp: parsedTimestamp.toISOString(),
                        deviceId,
                        deviceName,
                        eventType,
                        checkInTime: attendanceRecord.checkInTime ? attendanceRecord.checkInTime.toISOString() : null,
                        checkOutTime: attendanceRecord.checkOutTime ? attendanceRecord.checkOutTime.toISOString() : null,
                        totalCheckIns: attendanceRecord.totalCheckIns,
                        date: attendanceRecord.date.toISOString().split('T')[0], // YYYY-MM-DD
                        displayTime: parsedTimestamp.toLocaleString('vi-VN', {
                            timeZone: 'Asia/Ho_Chi_Minh',
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                        })
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

        // Chỉ log nếu có attendance được xử lý hoặc có lỗi thật sự
        if (recordsProcessed > 0 || errors.length > 0) {
            console.log(`📊 Processed: ${recordsProcessed} attendance events, ${errors.length} errors`);
        }

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

// Lấy dữ liệu attendance của nhân viên theo employeeCode
exports.getEmployeeAttendance = async (req, res) => {
    try {
        const { employeeCode } = req.params;
        const { 
            date, 
            startDate, 
            endDate, 
            includeRawData = 'false',
            page = 1,
            limit = 100
        } = req.query;

        if (!employeeCode) {
            return res.status(400).json({
                status: "error",
                message: "employeeCode là bắt buộc"
            });
        }

        // Xây dựng query
        const query = { employeeCode };

        // FIXED: Use unified timezone normalization for consistent query logic
        // Xử lý filter theo ngày
        if (date) {
            // Lấy dữ liệu cho một ngày cụ thể
            try {
                const dayStart = TimeAttendance.parseAndNormalizeDateString(date);
                query.date = dayStart;
            } catch (dateError) {
                return res.status(400).json({
                    status: "error",
                    message: `Định dạng ngày không hợp lệ: ${dateError.message}`
                });
            }
        } else if (startDate || endDate) {
            // Lấy dữ liệu theo khoảng thời gian
            query.date = {};
            
            if (startDate) {
                try {
                    // Start of day in VN timezone
                    const start = TimeAttendance.parseAndNormalizeDateString(startDate);
                    query.date.$gte = start;
                } catch (dateError) {
                    return res.status(400).json({
                        status: "error",
                        message: `Định dạng ngày bắt đầu không hợp lệ: ${dateError.message}`
                    });
                }
            }
            
            if (endDate) {
                try {
                    // End of day in VN timezone
                    // Parse date string and add 23:59:59.999 in VN timezone
                    const endDayStart = TimeAttendance.parseAndNormalizeDateString(endDate);
                    // Add 1 day and subtract 1ms to get end of day
                    const end = new Date(endDayStart.getTime() + (24 * 60 * 60 * 1000) - 1);
                    query.date.$lte = end;
                } catch (dateError) {
                    return res.status(400).json({
                        status: "error",
                        message: `Định dạng ngày kết thúc không hợp lệ: ${dateError.message}`
                    });
                }
            }
        }

        // Pagination
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.max(1, Math.min(parseInt(limit), 500)); // Max 500 records
        const skip = (pageNum - 1) * limitNum;

        // Thực hiện query với pagination
        // ALWAYS include rawData for recalculation, but only return it if requested
        let attendanceQuery = TimeAttendance.find(query)
            .sort({ date: -1 }) // Sắp xếp theo ngày mới nhất
            .skip(skip)
            .limit(limitNum);

        // Always fetch rawData for accurate recalculation
        const records = await attendanceQuery.exec();

        // Đếm tổng số records để phân trang
        const totalRecords = await TimeAttendance.countDocuments(query);
        const totalPages = Math.ceil(totalRecords / limitNum);
        const hasMore = pageNum < totalPages;

        // Format response theo cấu trúc mà mobile app mong đợi
        const response = {
            status: "success",
            data: {
                records: records.map(record => {
                    // RECALCULATE check-in and check-out times from rawData for accuracy
                    let checkInTime = record.checkInTime;
                    let checkOutTime = record.checkOutTime;
                    let totalCheckIns = record.totalCheckIns;
                    
                    if (record.rawData && record.rawData.length > 0) {
                        // Sort all timestamps to get earliest and latest
                        const allTimes = record.rawData
                            .map(item => new Date(item.timestamp))
                            .sort((a, b) => a.getTime() - b.getTime());
                        
                        checkInTime = allTimes[0]; // Earliest time = check-in
                        checkOutTime = allTimes[allTimes.length - 1]; // Latest time = check-out
                        totalCheckIns = allTimes.length;
                        
                        console.log(`📊 [getEmployeeAttendance] Recalculated times for ${record.employeeCode} on ${record.date.toISOString().split('T')[0]}:`, {
                            checkIn: checkInTime.toISOString(),
                            checkOut: checkOutTime.toISOString(),
                            totalTimes: totalCheckIns,
                            vnDateString: TimeAttendance.formatDateToVNString(record.date)
                        });
                    }
                    
                    // FIXED: Format date correctly - convert UTC date to VN timezone string
                    // Date in DB is UTC but represents VN timezone date, so we need to convert it back
                    const vnDateString = TimeAttendance.formatDateToVNString(record.date);
                    
                    return {
                        _id: record._id,
                        employeeCode: record.employeeCode,
                        date: vnDateString, // YYYY-MM-DD format in VN timezone
                        checkInTime: checkInTime,
                        checkOutTime: checkOutTime,
                        totalCheckIns: totalCheckIns,
                        status: record.status,
                        user: record.employeeName ? {
                            fullname: record.employeeName,
                            employeeCode: record.employeeCode
                        } : undefined,
                        rawData: includeRawData.toLowerCase() === 'true' ? record.rawData : undefined
                    };
                }).filter(r => r.user !== undefined || includeRawData.toLowerCase() === 'true' || r.checkInTime || r.checkOutTime), // Chỉ trả records có data
                pagination: {
                    currentPage: pageNum,
                    totalPages: totalPages,
                    totalRecords: totalRecords,
                    hasMore: hasMore
                }
            },
            timestamp: new Date().toISOString()
        };

        console.log(`📊 Retrieved ${records.length} attendance records for employee ${employeeCode}`);

        res.status(200).json(response);

    } catch (error) {
        console.error("❌ Error retrieving employee attendance:", error);
        res.status(500).json({
            status: "error",
            message: "Lỗi server khi lấy dữ liệu chấm công",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

// Batch: lấy giờ vào/ra theo danh sách mã trong 1 ngày
// Body: { date: 'YYYY-MM-DD', codes: string[] }
exports.getStudentsAttendanceByDay = async (req, res) => {
    try {
        const { date, codes } = req.body || {};

        console.log(`📥 [Attendance Batch] /students/day request`, {
            date,
            codesCount: Array.isArray(codes) ? codes.length : 0,
            sampleCodes: Array.isArray(codes) ? codes.slice(0, 5) : []
        });

        if (!date || !Array.isArray(codes)) {
            return res.status(400).json({
                status: "error",
                message: "Thiếu tham số. Cần { date: 'YYYY-MM-DD', codes: string[] }"
            });
        }

        if (codes.length === 0) {
            return res.status(200).json({
                status: "success",
                data: {},
                timestamp: new Date().toISOString()
            });
        }

        // Giới hạn kích thước batch để tránh quá tải
        const MAX_BATCH = 500;
        if (codes.length > MAX_BATCH) {
            return res.status(400).json({
                status: "error",
                message: `Số lượng mã vượt quá giới hạn ${MAX_BATCH}`
            });
        }

        // FIXED: Use unified timezone normalization
        // Parse YYYY-MM-DD string and normalize to VN timezone day start
        let dayStart;
        try {
            dayStart = TimeAttendance.parseAndNormalizeDateString(date);
        } catch (dateError) {
            return res.status(400).json({
                status: "error",
                message: `Định dạng ngày không hợp lệ: ${dateError.message}`
            });
        }

        // Truy vấn 1 lần cho tất cả mã
        const records = await TimeAttendance.find({
            employeeCode: { $in: codes },
            date: dayStart
        }).lean(false); // cần document để có thể gọi methods nếu cần

        console.log(`📊 [Attendance Batch] Found records`, {
            date: dayStart.toISOString().split('T')[0],
            requestedCodes: codes.length,
            foundRecords: records.length
        });

        // Map kết quả theo code
        const result = {};
        for (const code of codes) {
            result[code] = {
                checkInTime: null,
                checkOutTime: null,
                totalCheckIns: 0,
                employeeName: undefined
            };
        }

        for (const rec of records) {
            // Đảm bảo tính đúng bằng cách tính lại từ rawData khi có
            let checkInTime = rec.checkInTime;
            let checkOutTime = rec.checkOutTime;
            let totalCheckIns = rec.totalCheckIns || 0;

            if (Array.isArray(rec.rawData) && rec.rawData.length > 0) {
                const allTimes = rec.rawData
                    .map(item => new Date(item.timestamp))
                    .sort((a, b) => a.getTime() - b.getTime());
                checkInTime = allTimes[0];
                checkOutTime = allTimes[allTimes.length - 1];
                totalCheckIns = allTimes.length;
            }

            result[rec.employeeCode] = {
                checkInTime,
                checkOutTime,
                totalCheckIns,
                employeeName: rec.employeeName || undefined
            };
        }

        const keys = Object.keys(result);
        console.log(`📤 [Attendance Batch] Responding result map`, {
            keys: keys.length,
            sample: keys.slice(0, 3).reduce((acc, k) => { acc[k] = result[k]; return acc; }, {})
        });

        return res.status(200).json({
            status: "success",
            data: result,
            date: date, // Return the original requested date, not the normalized one
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error in getStudentsAttendanceByDay:', error);
        return res.status(500).json({
            status: "error",
            message: "Lỗi server khi lấy dữ liệu chấm công theo danh sách",
            error: error.message
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