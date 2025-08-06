const database = require('../config/database');
const redisClient = require('../config/redis');
const moment = require('moment');

// Timestamp khi server start - chỉ nhận events sau thời điểm này
const SERVER_START_TIME = new Date();
console.log(`🚀 Server started at: ${SERVER_START_TIME.toISOString()}`);
console.log(`📅 Only processing events newer than: ${SERVER_START_TIME.toISOString()}`);

// Cấu hình: ignore events cũ hơn X phút (tính từ lúc nhận)
const IGNORE_EVENTS_OLDER_THAN_MINUTES = 1440; // 24 giờ = 1440 phút

// Helper function để kiểm tra event có quá cũ không
const isEventTooOld = (eventTimestamp) => {
    if (!eventTimestamp) return false;
    
    try {
        const eventTime = new Date(eventTimestamp);
        const now = new Date();
        
        // Sử dụng global variables nếu có, fallback về constants
        const serverStartTime = global.SERVER_START_TIME || SERVER_START_TIME;
        const ignoreMinutes = global.IGNORE_EVENTS_OLDER_THAN_MINUTES || IGNORE_EVENTS_OLDER_THAN_MINUTES;
        
        // Kiểm tra event có trước khi server start không
        if (eventTime < serverStartTime) {
            console.log(`⏰ Event from ${eventTime.toISOString()} is before server start time (${serverStartTime.toISOString()}), skipping`);
            return true;
        }
        
        // Kiểm tra event có quá cũ không (hơn X phút)
        const diffInMinutes = (now - eventTime) / (1000 * 60);
        if (diffInMinutes > ignoreMinutes) {
            console.log(`⏰ Event from ${eventTime.toISOString()} is ${diffInMinutes.toFixed(1)} minutes old (limit: ${ignoreMinutes}min), skipping`);
            return true;
        }
        
        console.log(`✅ Event from ${eventTime.toISOString()} is fresh (${diffInMinutes.toFixed(1)} minutes old, limit: ${ignoreMinutes}min)`);
        return false;
        
    } catch (error) {
        console.log(`❌ Invalid timestamp format: ${eventTimestamp}`);
        return false; // Nếu không parse được timestamp, vẫn xử lý
    }
};

class TimeAttendanceController {
  // Process Hikvision attendance event
  async processHikvisionEvent(req, res) {
    try {
      const eventData = req.body;
      
      console.log('📡 [Time Attendance Service] Received Hikvision event:', JSON.stringify(eventData, null, 2));

      let recordsProcessed = 0;
      let recordsSkipped = 0;
      let errors = [];

      // Extract basic event info
      const eventType = eventData.eventType || eventData.type || 'unknown';
      const eventState = eventData.eventState || eventData.state || 'active';
      const dateTime = eventData.dateTime || eventData.timestamp;
      const deviceId = eventData.ipAddress || eventData.deviceId || eventData.sim;

      // Process ActivePost array (face recognition events)
      if (eventData.ActivePost && Array.isArray(eventData.ActivePost)) {
        for (const post of eventData.ActivePost) {
          try {
            const employeeCode = post.FPID || post.cardNo || post.employeeCode || post.userID;
            const timestamp = post.dateTime || dateTime;
            const postDeviceId = post.ipAddress || deviceId || post.deviceID;

            // Skip old events
            if (isEventTooOld(timestamp)) {
              console.log(`⏰ Skipping old event for employee ${employeeCode} at ${timestamp}`);
              recordsSkipped++;
              continue;
            }

            if (employeeCode && timestamp) {
              const parsedTimestamp = this.parseHikvisionTimestamp(timestamp);
              
              await this.processTimeAttendanceEvent({
                employee_code: employeeCode,
                timestamp: parsedTimestamp.toISOString(),
                device_id: postDeviceId,
                metadata: {
                  face_id: post.name,
                  similarity: post.similarity,
                  event_type: eventType,
                  event_state: eventState,
                  hikvision_data: post
                }
              });

              recordsProcessed++;
              console.log(`✅ Processed event for employee ${employeeCode} at ${parsedTimestamp.toISOString()}`);
            } else {
              errors.push({
                post,
                error: 'Missing employeeCode or timestamp in ActivePost'
              });
            }
          } catch (error) {
            console.error(`❌ Error processing ActivePost:`, error);
            errors.push({
              post,
              error: error.message
            });
          }
        }
      }
      // Process single ActivePost object
      else if (eventData.ActivePost && !Array.isArray(eventData.ActivePost)) {
        try {
          const activePost = eventData.ActivePost;
          const employeeCode = activePost.FPID || activePost.cardNo || activePost.employeeCode || activePost.userID;
          const timestamp = activePost.dateTime || dateTime;
          const postDeviceId = activePost.ipAddress || deviceId || activePost.deviceID;

          if (isEventTooOld(timestamp)) {
            console.log(`⏰ Skipping old single post for employee ${employeeCode} at ${timestamp}`);
            recordsSkipped++;
          } else if (employeeCode && timestamp) {
            const parsedTimestamp = this.parseHikvisionTimestamp(timestamp);
            
            await this.processTimeAttendanceEvent({
              employee_code: employeeCode,
              timestamp: parsedTimestamp.toISOString(),
              device_id: postDeviceId,
              metadata: {
                face_id: activePost.name,
                similarity: activePost.similarity,
                event_type: eventType,
                event_state: eventState,
                hikvision_data: activePost
              }
            });

            recordsProcessed++;
            console.log(`✅ Processed single event for employee ${employeeCode} at ${parsedTimestamp.toISOString()}`);
          } else {
            errors.push({
              activePost,
              error: 'Missing employeeCode or timestamp in single ActivePost'
            });
          }
        } catch (error) {
          console.error(`❌ Error processing single ActivePost:`, error);
          errors.push({
            activePost: eventData.ActivePost,
            error: error.message
          });
        }
      }
      // Process root level event data
      else {
        try {
          const employeeCode = eventData.employeeCode || eventData.FPID || eventData.cardNo || eventData.userID;
          const timestamp = dateTime;
          
          if (isEventTooOld(timestamp)) {
            console.log(`⏰ Skipping old root level event for employee ${employeeCode} at ${timestamp}`);
            recordsSkipped++;
          } else if (employeeCode && timestamp) {
            const parsedTimestamp = this.parseHikvisionTimestamp(timestamp);
            
            await this.processTimeAttendanceEvent({
              employee_code: employeeCode,
              timestamp: parsedTimestamp.toISOString(),
              device_id: deviceId,
              metadata: {
                face_id: eventData.name,
                event_type: eventType,
                event_state: eventState,
                hikvision_data: eventData
              }
            });

            recordsProcessed++;
            console.log(`✅ Processed root level event for employee ${employeeCode} at ${parsedTimestamp.toISOString()}`);
          } else {
            errors.push({
              eventData,
              error: 'Missing employeeCode or timestamp at root level'
            });
          }
        } catch (error) {
          console.error(`❌ Error processing root level event:`, error);
          errors.push({
            eventData,
            error: error.message
          });
        }
      }

      // Response
      const response = {
        status: 'success',
        message: `Processed ${recordsProcessed} time attendance events from Hikvision`,
        timestamp: new Date().toISOString(),
        eventType,
        eventState,
        recordsProcessed,
        recordsSkipped,
        totalErrors: errors.length
      };

      if (errors.length > 0) {
        response.errors = errors.slice(0, 5); // Show first 5 errors
        response.message += ` with ${errors.length} errors`;
      }

      console.log(`📊 [Time Attendance Service] ${response.message}`);
      
      res.json(response);

    } catch (error) {
      console.error('❌ [Time Attendance Service] Error handling Hikvision event:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to process Hikvision event',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Handle Hikvision event (alias for processHikvisionEvent)
  async handleHikvisionEvent(req, res) {
    return this.processHikvisionEvent(req, res);
  }

  // Upload batch attendance data from Hikvision device
  async uploadAttendanceBatch(req, res) {
    try {
      const { data, tracker_id } = req.body;

      if (!data || !Array.isArray(data)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid data format. Array expected.'
        });
      }

      let recordsProcessed = 0;
      let recordsUpdated = 0;
      let errors = [];

      for (const record of data) {
        try {
          const { fingerprintCode, dateTime, device_id } = record;

          if (!fingerprintCode || !dateTime) {
            errors.push({ 
              record, 
              error: 'fingerprintCode and dateTime are required' 
            });
            continue;
          }

          // Parse timestamp
          let parsedTimestamp;
          try {
            parsedTimestamp = this.parseHikvisionTimestamp(dateTime);
          } catch (parseError) {
            errors.push({ 
              record, 
              error: `Invalid datetime format: ${parseError.message}` 
            });
            continue;
          }

          // Skip old events
          if (isEventTooOld(parsedTimestamp)) {
            console.log(`⏰ Skipping old batch record for ${fingerprintCode} at ${dateTime}`);
            continue;
          }

          // Process time attendance event
          await this.processTimeAttendanceEvent({
            employee_code: fingerprintCode,
            timestamp: parsedTimestamp.toISOString(),
            device_id: device_id,
            metadata: {
              tracker_id: tracker_id,
              batch_upload: true,
              source: 'hikvision_batch'
            }
          });

          recordsProcessed++;
          
        } catch (error) {
          console.error('Error processing batch record:', error);
          errors.push({
            record,
            error: error.message
          });
        }
      }

      const response = {
        status: 'success',
        message: `Processed ${recordsProcessed} records from batch upload`,
        timestamp: new Date().toISOString(),
        recordsProcessed,
        recordsUpdated,
        totalErrors: errors.length,
        tracker_id
      };

      if (errors.length > 0) {
        response.errors = errors.slice(0, 10); // Show first 10 errors
      }

      res.json(response);

    } catch (error) {
      console.error('Error in uploadAttendanceBatch:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to process batch upload',
        error: error.message
      });
    }
  }

  // Test endpoint để simulate Hikvision event
  async testHikvisionEvent(req, res) {
    try {
      // Sample Hikvision event data để test
      const sampleEvent = {
        ipAddress: "192.168.1.100",
        portNo: 80,
        protocol: "HTTP",
        macAddress: "00:12:34:56:78:90",
        channelID: 1,
        dateTime: new Date().toISOString(),
        activePostCount: 1,
        eventType: "faceSnapMatch",
        eventState: "active",
        EventNotificationAlert: {
          eventType: "faceSnapMatch",
          eventState: "active",
          eventDescription: "Face match successful",
          dateTime: new Date().toISOString(),
          ActivePost: [{
            channelID: 1,
            ipAddress: "192.168.1.100",
            portNo: 80,
            protocol: "HTTP",
            macAddress: "00:12:34:56:78:90",
            dynChannelID: 1,
            UniversalUniqueID: "550e8400-e29b-41d4-a716-446655440000",
            faceLibType: "blackFD",
            FDID: "1",
            FPID: req.body.employeeCode || "123456",
            name: req.body.employeeName || "Test Employee",
            type: "faceMatch",
            similarity: req.body.similarity || 85,
            templateID: "template123",
            dateTime: new Date().toISOString()
          }]
        }
      };

      // Gọi handler thật để test
      const mockReq = {
        body: sampleEvent
      };

      const mockRes = {
        status: (code) => ({
          json: (data) => {
            res.status(200).json({
              status: "success",
              message: "Test event đã được gửi và xử lý",
              testData: sampleEvent,
              result: data
            });
          }
        })
      };

      // Gọi handler
      await this.processHikvisionEvent(mockReq, mockRes);

    } catch (error) {
      console.error("Lỗi test Hikvision event:", error);
      res.status(500).json({
        status: "error",
        message: "Lỗi khi test event",
        error: error.message
      });
    }
  }

  // Get attendance records with filtering and pagination
  async getAttendanceRecords(req, res) {
    try {
      const {
        startDate,
        endDate,
        employeeCode,
        page = 1,
        limit = 100,
        sortBy = "date",
        sortOrder = "desc"
      } = req.query;

      const records = await database.getTimeAttendanceRecords(
        startDate,
        endDate,
        employeeCode,
        parseInt(page),
        parseInt(limit),
        sortBy,
        sortOrder
      );

      res.status(200).json({
        status: "success",
        data: records
      });

    } catch (error) {
      console.error("Lỗi lấy attendance records:", error);
      res.status(500).json({
        status: "error",
        message: "Lỗi server khi lấy dữ liệu chấm công",
        error: error.message
      });
    }
  }

  // Get attendance statistics
  async getAttendanceStats(req, res) {
    try {
      const { startDate, endDate, employeeCode } = req.query;
      
      const stats = await database.getTimeAttendanceStats(startDate, endDate, employeeCode);

      res.status(200).json({
        status: "success",
        data: stats
      });

    } catch (error) {
      console.error("Lỗi lấy attendance stats:", error);
      res.status(500).json({
        status: "error",
        message: "Lỗi server khi lấy thống kê chấm công",
        error: error.message
      });
    }
  }

  // Get employee attendance details
  async getEmployeeAttendance(req, res) {
    try {
      const { employeeCode } = req.params;
      const { startDate, endDate, includeRawData = false } = req.query;

      const records = await database.getTimeAttendanceByEmployee(
        employeeCode,
        startDate,
        endDate,
        includeRawData === 'true'
      );

      res.status(200).json({
        status: "success",
        data: {
          employeeCode,
          records
        }
      });

    } catch (error) {
      console.error("Lỗi lấy employee attendance:", error);
      res.status(500).json({
        status: "error",
        message: "Lỗi server khi lấy dữ liệu chấm công nhân viên",
        error: error.message
      });
    }
  }

  // Update attendance notes
  async updateAttendanceNotes(req, res) {
    try {
      const { recordId } = req.params;
      const { notes, status } = req.body;

      const result = await database.updateTimeAttendanceNotes(recordId, notes, status);

      if (!result) {
        return res.status(404).json({
          status: "error",
          message: "Không tìm thấy record chấm công"
        });
      }

      res.status(200).json({
        status: "success",
        message: "Đã cập nhật thành công",
        data: result
      });

    } catch (error) {
      console.error("Lỗi cập nhật attendance notes:", error);
      res.status(500).json({
        status: "error",
        message: "Lỗi server khi cập nhật ghi chú",
        error: error.message
      });
    }
  }

  // Delete attendance records
  async deleteAttendanceRecords(req, res) {
    try {
      const { startDate, endDate, employeeCode, confirmDelete } = req.body;

      if (!confirmDelete) {
        return res.status(400).json({
          status: "error",
          message: "Cần xác nhận xóa dữ liệu bằng confirmDelete: true"
        });
      }

      const result = await database.deleteTimeAttendanceRecords(startDate, endDate, employeeCode);

      res.status(200).json({
        status: "success",
        message: `Đã xóa ${result.deletedCount} record chấm công`,
        deletedCount: result.deletedCount
      });

    } catch (error) {
      console.error("Lỗi xóa attendance records:", error);
      res.status(500).json({
        status: "error",
        message: "Lỗi server khi xóa dữ liệu chấm công",
        error: error.message
      });
    }
  }

  // Sync with users
  async syncWithUsers(req, res) {
    try {
      const result = await database.syncTimeAttendanceWithUsers();

      res.status(200).json({
        status: "success",
        message: `Đã đồng bộ ${result.syncedCount} record với Users`,
        syncedCount: result.syncedCount,
        totalProcessed: result.totalProcessed,
        errors: result.errors
      });

    } catch (error) {
      console.error("Lỗi sync with users:", error);
      res.status(500).json({
        status: "error",
        message: "Lỗi server khi đồng bộ với Users",
        error: error.message
      });
    }
  }

  // Cleanup old raw data
  async cleanupOldRawData(req, res) {
    try {
      const result = await database.cleanupOldTimeAttendanceRawData();

      res.status(200).json({
        status: "success",
        message: `Đã cleanup rawData cũ thành công`,
        modifiedRecords: result.modifiedCount,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error("Lỗi cleanup rawData:", error);
      res.status(500).json({
        status: "error",
        message: "Lỗi server khi cleanup rawData",
        error: error.message
      });
    }
  }

  // Cleanup duplicate raw data
  async cleanupDuplicateRawData(req, res) {
    try {
      const { employeeCode, date } = req.query;

      let result;
      if (employeeCode && date) {
        result = await database.cleanupDuplicateTimeAttendanceRawData(employeeCode, date);
      } else {
        result = await database.cleanupAllDuplicateTimeAttendanceRawData();
      }

      res.status(200).json({
        status: "success",
        message: `Đã cleanup duplicate rawData thành công`,
        data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error("Lỗi cleanup duplicate rawData:", error);
      res.status(500).json({
        status: "error",
        message: "Lỗi server khi cleanup duplicate rawData",
        error: error.message
      });
    }
  }

  // Configure event filtering
  async configureEventFiltering(req, res) {
    try {
      const { ignoreOlderThanMinutes, resetServerStartTime } = req.body;
      
      if (ignoreOlderThanMinutes !== undefined) {
        global.IGNORE_EVENTS_OLDER_THAN_MINUTES = parseInt(ignoreOlderThanMinutes);
        console.log(`📝 Updated event filter to ignore events older than ${ignoreOlderThanMinutes} minutes`);
      }
      
      if (resetServerStartTime === true) {
        global.SERVER_START_TIME = new Date();
        console.log(`🔄 Reset server start time to: ${global.SERVER_START_TIME.toISOString()}`);
      }
      
      res.status(200).json({
        status: "success",
        message: "Cấu hình event filtering đã được cập nhật",
        config: {
          serverStartTime: global.SERVER_START_TIME || SERVER_START_TIME,
          ignoreOlderThanMinutes: global.IGNORE_EVENTS_OLDER_THAN_MINUTES || IGNORE_EVENTS_OLDER_THAN_MINUTES,
          currentTime: new Date().toISOString()
        }
      });
      
    } catch (error) {
      console.error("Lỗi cấu hình event filtering:", error);
      res.status(500).json({
        status: "error",
        message: "Lỗi server khi cấu hình event filtering",
        error: error.message
      });
    }
  }

  // Get event filtering status
  async getEventFilteringStatus(req, res) {
    try {
      const currentTime = new Date();
      const startTime = global.SERVER_START_TIME || SERVER_START_TIME;
      const filterMinutes = global.IGNORE_EVENTS_OLDER_THAN_MINUTES || IGNORE_EVENTS_OLDER_THAN_MINUTES;
      
      const uptime = (currentTime - startTime) / (1000 * 60); // minutes
      
      res.status(200).json({
        status: "success",
        data: {
          serverStartTime: startTime.toISOString(),
          currentTime: currentTime.toISOString(),
          uptimeMinutes: Math.round(uptime * 100) / 100,
          ignoreOlderThanMinutes: filterMinutes,
          eventsAcceptedAfter: startTime.toISOString(),
          eventsIgnoredBefore: new Date(currentTime - filterMinutes * 60 * 1000).toISOString()
        }
      });
      
    } catch (error) {
      console.error("Lỗi lấy event filtering status:", error);
      res.status(500).json({
        status: "error",
        message: "Lỗi server khi lấy trạng thái event filtering",
        error: error.message
      });
    }
  }

  // Reset server start time
  async resetServerStartTime(req, res) {
    try {
      const newStartTime = new Date();
      global.SERVER_START_TIME = newStartTime;
      
      console.log(`🔄 ADMIN RESET: Server start time reset to ${newStartTime.toISOString()}`);
      console.log(`📅 All events before ${newStartTime.toISOString()} will be ignored`);
      
      res.status(200).json({
        status: "success",
        message: "Server start time đã được reset - chỉ nhận events mới từ bây giờ",
        data: {
          newServerStartTime: newStartTime.toISOString(),
          previousStartTime: SERVER_START_TIME.toISOString(),
          ignoreOlderThanMinutes: global.IGNORE_EVENTS_OLDER_THAN_MINUTES || IGNORE_EVENTS_OLDER_THAN_MINUTES
        }
      });
      
    } catch (error) {
      console.error("Lỗi reset server start time:", error);
      res.status(500).json({
        status: "error", 
        message: "Lỗi server khi reset start time",
        error: error.message
      });
    }
  }

  // Get processing statistics
  async getProcessingStats(req, res) {
    try {
      const { start_date, end_date } = req.query;
      
      // Get processing stats from Redis
      const stats = await redisClient.hGetAll('hikvision:stats');
      
      // Get recent records from database
      const recentRecords = await database.getTimeAttendanceStats(start_date, end_date);

      res.json({
        status: 'success',
        message: {
          processing_stats: stats,
          recent_records: recentRecords.slice(0, 100),
          total_recent: recentRecords.length
        }
      });

    } catch (error) {
      console.error('Error in getProcessingStats:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get time attendance statistics (legacy method)
  async getTimeAttendanceStats(req, res) {
    try {
      const { start_date, end_date, employee_code, limit = 100 } = req.query;
      
      const records = await database.getTimeAttendanceStats(start_date, end_date, employee_code);

      // Group by employee for statistics
      const stats = {};
      records.forEach(record => {
        if (!stats[record.employee_code]) {
          stats[record.employee_code] = {
            employee_code: record.employee_code,
            total_days: 0,
            total_check_ins: 0,
            avg_check_ins: 0,
            first_date: null,
            last_date: null,
            records: []
          };
        }

        const stat = stats[record.employee_code];
        stat.total_days++;
        stat.total_check_ins += record.total_check_ins || 0;
        stat.records.push(record);

        if (!stat.first_date || record.date < stat.first_date) {
          stat.first_date = record.date;
        }
        if (!stat.last_date || record.date > stat.last_date) {
          stat.last_date = record.date;
        }
      });

      // Calculate averages
      Object.values(stats).forEach(stat => {
        stat.avg_check_ins = stat.total_days > 0 ? (stat.total_check_ins / stat.total_days).toFixed(2) : 0;
      });

      res.json({
        message: Object.values(stats),
        status: 'success',
        total_employees: Object.keys(stats).length,
        total_records: records.length
      });

    } catch (error) {
      console.error('Error in getTimeAttendanceStats:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get time attendance records for a specific employee (legacy method)
  async getEmployeeTimeAttendance(req, res) {
    try {
      const { employee_code } = req.params;
      const { start_date, end_date, limit = 50 } = req.query;

      const records = await database.getTimeAttendanceByEmployee(
        employee_code, 
        start_date, 
        end_date, 
        parseInt(limit)
      );

      res.json({
        message: records,
        status: 'success',
        employee_code,
        total_records: records.length
      });

    } catch (error) {
      console.error('Error in getEmployeeTimeAttendance:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Process individual time attendance event
  async processTimeAttendanceEvent(eventData) {
    const { employee_code, timestamp, device_id, metadata = null } = eventData;

    // Find or create day record
    const dateObj = moment(timestamp).format('YYYY-MM-DD');
    
    let record = await database.findOrCreateTimeAttendance(employee_code, dateObj);

    // Parse raw_data
    let rawData = record.raw_data || [];

    // Check for duplicates within 30 seconds
    const checkTime = moment(timestamp);
    const isDuplicate = rawData.some(item => {
      const existingTime = moment(item.timestamp);
      const timeDiff = Math.abs(checkTime.diff(existingTime, 'seconds'));
      const sameDevice = item.device_id === device_id;
      return timeDiff < 30 && sameDevice;
    });

    if (isDuplicate) {
      console.log(`⚠️ Duplicate time attendance detected for ${employee_code} within 30 seconds, skipping`);
      return;
    }

    // Add new entry to raw data
    const newEntry = {
      timestamp: checkTime.toISOString(),
      device_id: device_id || null,
      recorded_at: new Date().toISOString()
    };

    // Add metadata if provided
    if (metadata) {
      newEntry.metadata = metadata;
    }

    rawData.push(newEntry);

    // Update check-in/check-out times using smart logic
    const updatedTimes = this.updateCheckInOutTimes(
      record.check_in_time,
      record.check_out_time,
      checkTime
    );

    // Build notes from metadata
    let notes = record.notes || '';
    if (metadata) {
      if (metadata.face_id) {
        notes += `Face ID: ${metadata.face_id}; `;
      }
      if (metadata.similarity) {
        notes += `Similarity: ${metadata.similarity}%; `;
      }
      if (metadata.event_type) {
        notes += `Event: ${metadata.event_type}; `;
      }
    }

    // Update record
    const updateData = {
      raw_data: rawData,
      total_check_ins: rawData.length,
      check_in_time: updatedTimes.checkIn ? updatedTimes.checkIn.toISOString() : record.check_in_time,
      check_out_time: updatedTimes.checkOut ? updatedTimes.checkOut.toISOString() : record.check_out_time,
      device_id: device_id || record.device_id,
      notes: notes.trim(),
      status: 'active'
    };

    await database.updateTimeAttendance(employee_code, dateObj, updateData);

    // Invalidate cache
    await redisClient.invalidateTimeAttendanceCache(employee_code, dateObj);

    // Publish to external services using new Redis pub/sub
    const eventPayload = {
      employee_code,
      date: dateObj,
      check_in_time: updatedTimes.checkIn,
      check_out_time: updatedTimes.checkOut,
      total_check_ins: rawData.length,
      device_id,
      metadata
    };

    // Publish to Notification service
    await redisClient.publishAttendanceEvent('time_attendance_recorded', eventPayload);

    // Publish to Frappe service
    await redisClient.publishFrappeEvent('employee_attendance_update', eventPayload);

    console.log(`✅ Updated time attendance record for ${employee_code} on ${dateObj}`);
  }

  // Check if event is too old (configurable threshold)
  isEventTooOld(timestamp, maxAgeHours = 24) {
    try {
      const eventTime = moment(timestamp);
      const now = moment();
      const hoursDiff = now.diff(eventTime, 'hours');
      
      return hoursDiff > maxAgeHours;
    } catch (error) {
      console.error('Error checking event age:', error);
      return false;
    }
  }

  // Parse Hikvision timestamp with timezone handling
  parseHikvisionTimestamp(timestamp) {
    try {
      // Handle different timestamp formats from Hikvision
      let parsedTime;
      
      if (typeof timestamp === 'string') {
        // Format: "2024-01-15T08:30:00.000Z" or "2024-01-15 08:30:00"
        parsedTime = moment(timestamp);
        
        // If no timezone info, assume local timezone
        if (!timestamp.includes('Z') && !timestamp.includes('+') && !timestamp.includes('-')) {
          parsedTime = moment.tz(timestamp, process.env.TIMEZONE || 'Asia/Ho_Chi_Minh');
        }
      } else {
        parsedTime = moment(timestamp);
      }

      if (!parsedTime.isValid()) {
        throw new Error('Invalid timestamp format');
      }

      return parsedTime;
    } catch (error) {
      console.error('Error parsing timestamp:', timestamp, error);
      throw new Error(`Invalid timestamp format: ${timestamp}`);
    }
  }

  // Smart logic to determine check-in vs check-out
  updateCheckInOutTimes(currentCheckIn, currentCheckOut, newTime) {
    const currentHour = newTime.hour();
    
    // Logic based on time
    const isLikelyCheckIn = currentHour >= 6 && currentHour <= 12;  // 6h-12h: check-in
    const isLikelyCheckOut = currentHour >= 15 && currentHour <= 22; // 15h-22h: check-out
    
    let checkIn = currentCheckIn ? moment(currentCheckIn) : null;
    let checkOut = currentCheckOut ? moment(currentCheckOut) : null;

    // If no check-in or new time is very early
    if (!checkIn || (isLikelyCheckIn && newTime.isBefore(checkIn))) {
      checkIn = newTime;
    }
    // If no check-out or new time is very late
    else if (!checkOut || (isLikelyCheckOut && newTime.isAfter(checkOut))) {
      checkOut = newTime;
    }
    // If both exist, update based on proximity
    else if (checkIn && checkOut) {
      const distanceToCheckIn = Math.abs(newTime.diff(checkIn, 'minutes'));
      const distanceToCheckOut = Math.abs(newTime.diff(checkOut, 'minutes'));
      
      if (isLikelyCheckIn && distanceToCheckIn < distanceToCheckOut) {
        checkIn = newTime;
      } else if (isLikelyCheckOut && distanceToCheckOut < distanceToCheckIn) {
        checkOut = newTime;
      }
    }
    // Fallback: if only check-in exists
    else if (checkIn && !checkOut) {
      if (newTime.isAfter(checkIn)) {
        checkOut = newTime;
      } else {
        checkIn = newTime;
      }
    }
    
    // Ensure check-in is always before check-out
    if (checkIn && checkOut && checkIn.isAfter(checkOut)) {
      [checkIn, checkOut] = [checkOut, checkIn];
    }

    return {
      checkIn: checkIn,
      checkOut: checkOut
    };
  }
}

module.exports = new TimeAttendanceController(); 