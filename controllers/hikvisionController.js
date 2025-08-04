const database = require('../config/database');
const redisClient = require('../config/redis');
const moment = require('moment');
const attendanceController = require('./attendanceController');

class HikvisionController {
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

  // Handle Hikvision event webhook
  async handleHikvisionEvent(req, res) {
    try {
      const eventData = req.body;
      
      console.log('📡 [Attendance Service] Received Hikvision event:', JSON.stringify(eventData, null, 2));

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
            if (this.isEventTooOld(timestamp)) {
              console.log(`⏰ Skipping old event for employee ${employeeCode} at ${timestamp}`);
              recordsSkipped++;
              continue;
            }

            if (employeeCode && timestamp) {
              const parsedTimestamp = this.parseHikvisionTimestamp(timestamp);
              
              // Use existing attendance controller logic
              await this.processAttendanceEvent({
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

          if (this.isEventTooOld(timestamp)) {
            console.log(`⏰ Skipping old single post for employee ${employeeCode} at ${timestamp}`);
            recordsSkipped++;
          } else if (employeeCode && timestamp) {
            const parsedTimestamp = this.parseHikvisionTimestamp(timestamp);
            
            await this.processAttendanceEvent({
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
          
          if (this.isEventTooOld(timestamp)) {
            console.log(`⏰ Skipping old root level event for employee ${employeeCode} at ${timestamp}`);
            recordsSkipped++;
          } else if (employeeCode && timestamp) {
            const parsedTimestamp = this.parseHikvisionTimestamp(timestamp);
            
            await this.processAttendanceEvent({
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
        message: `Processed ${recordsProcessed} attendance events from Hikvision`,
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

      console.log(`📊 [Attendance Service] ${response.message}`);
      
      res.json(response);

    } catch (error) {
      console.error('❌ [Attendance Service] Error handling Hikvision event:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to process Hikvision event',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
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
          if (this.isEventTooOld(parsedTimestamp)) {
            console.log(`⏰ Skipping old batch record for ${fingerprintCode} at ${dateTime}`);
            continue;
          }

          // Process attendance event
          await this.processAttendanceEvent({
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

  // Process individual attendance event (shared logic)
  async processAttendanceEvent(eventData) {
    const { employee_code, timestamp, device_id, metadata = null } = eventData;

    // Find or create day record
    const dateObj = moment(timestamp).format('YYYY-MM-DD');
    
    let record = await database.getAll('ERP Time Attendance', {
      employee_code: employee_code,
      date: dateObj
    });

    if (record.length === 0) {
      // Create new record
      const newRecord = {
        name: `TIME-ATT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        employee_code: employee_code,
        date: dateObj,
        device_id: device_id || null,
        raw_data: JSON.stringify([]),
        total_check_ins: 0,
        status: 'active',
        creation: new Date().toISOString(),
        modified: new Date().toISOString(),
        owner: 'Administrator',
        modified_by: 'Administrator'
      };

      await database.insert('ERP Time Attendance', newRecord);
      record = [newRecord];
    }

    const attendanceRecord = record[0];
    
    // Parse raw_data
    let rawData = [];
    try {
      rawData = JSON.parse(attendanceRecord.raw_data || '[]');
    } catch (e) {
      rawData = [];
    }

    // Check for duplicates within 30 seconds
    const checkTime = moment(timestamp);
    const isDuplicate = rawData.some(item => {
      const existingTime = moment(item.timestamp);
      const timeDiff = Math.abs(checkTime.diff(existingTime, 'seconds'));
      const sameDevice = item.device_id === device_id;
      return timeDiff < 30 && sameDevice;
    });

    if (isDuplicate) {
      console.log(`⚠️ Duplicate attendance detected for ${employee_code} within 30 seconds, skipping`);
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
      attendanceRecord.check_in_time,
      attendanceRecord.check_out_time,
      checkTime
    );

    // Build notes from metadata
    let notes = attendanceRecord.notes || '';
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
      raw_data: JSON.stringify(rawData),
      total_check_ins: rawData.length,
      check_in_time: updatedTimes.checkIn ? updatedTimes.checkIn.toISOString() : attendanceRecord.check_in_time,
      check_out_time: updatedTimes.checkOut ? updatedTimes.checkOut.toISOString() : attendanceRecord.check_out_time,
      notes: notes.trim(),
      modified: new Date().toISOString(),
      modified_by: 'Administrator'
    };

    await database.update('ERP Time Attendance', attendanceRecord.name, updateData);

    // Invalidate cache
    await redisClient.invalidateAttendanceCache(employee_code, dateObj);

    console.log(`✅ Updated attendance record for ${employee_code} on ${dateObj}`);
  }

  // Smart logic to determine check-in vs check-out (from workspace-backend)
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

  // Get event processing statistics
  async getProcessingStats(req, res) {
    try {
      const { start_date, end_date } = req.query;
      
      // Get processing stats from Redis
      const stats = await redisClient.hGetAll('hikvision:stats');
      
      // Get recent events from database
      const filters = {};
      if (start_date && end_date) {
        filters.modified = ['between', start_date, end_date];
      }
      
      const recentRecords = await database.getAll('ERP Time Attendance', 
        filters, 
        ['employee_code', 'date', 'total_check_ins', 'device_id', 'modified'],
        'modified DESC',
        100
      );

      res.json({
        status: 'success',
        message: {
          processing_stats: stats,
          recent_records: recentRecords,
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
}

module.exports = new HikvisionController();