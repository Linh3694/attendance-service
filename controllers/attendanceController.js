const database = require('../config/database');
const redisClient = require('../config/redis');
const moment = require('moment');

class AttendanceController {
  // Frappe-compatible method to find or create day record
  async findOrCreateDayRecord(req, res) {
    try {
      const { employee_code, date, device_id } = req.body;
      
      if (!employee_code || !date) {
        return res.status(400).json({
          error: 'Missing required parameters',
          message: 'employee_code and date are required'
        });
      }

      // Normalize date to start of day
      const dateObj = moment(date).startOf('day').format('YYYY-MM-DD');
      
      // Check cache first
      let record = await redisClient.getCachedAttendanceRecord(employee_code, dateObj);
      
      if (!record) {
        // Check if record exists in database
        const existing = await database.getAll('ERP Time Attendance', {
          employee_code: employee_code,
          date: dateObj
        });

        if (existing.length > 0) {
          record = existing[0];
        } else {
          // Create new record
          const newRecord = {
            name: `TIME-ATT-${Date.now()}`,
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
          record = newRecord;
        }

        // Cache the record
        await redisClient.cacheAttendanceRecord(employee_code, dateObj, record);
      }

      res.json({
        message: record,
        status: 'success'
      });

    } catch (error) {
      console.error('Error in findOrCreateDayRecord:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Update attendance time with smart check-in/check-out logic
  async updateAttendanceTime(req, res) {
    try {
      const { employee_code, timestamp, device_id } = req.body;
      
      if (!employee_code || !timestamp) {
        return res.status(400).json({
          error: 'Missing required parameters',
          message: 'employee_code and timestamp are required'
        });
      }

      const checkTime = moment(timestamp);
      const dateObj = checkTime.format('YYYY-MM-DD');
      
      // Find or create day record
      let record = await database.getAll('ERP Time Attendance', {
        employee_code: employee_code,
        date: dateObj
      });

      if (record.length === 0) {
        // Create new record
        const newRecord = {
          name: `TIME-ATT-${Date.now()}`,
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
      const isDuplicate = rawData.some(item => {
        const existingTime = moment(item.timestamp);
        const timeDiff = Math.abs(checkTime.diff(existingTime, 'seconds'));
        const sameDevice = item.device_id === device_id;
        return timeDiff < 30 && sameDevice;
      });

      if (isDuplicate) {
        return res.json({
          message: 'Duplicate attendance detected within 30 seconds, skipping',
          status: 'warning'
        });
      }

      // Add to raw data
      rawData.push({
        timestamp: checkTime.toISOString(),
        device_id: device_id || null,
        recorded_at: new Date().toISOString()
      });

      // Update check-in/check-out times using smart logic
      const updatedTimes = this._updateCheckInOutTimes(
        attendanceRecord.check_in_time,
        attendanceRecord.check_out_time,
        checkTime
      );

      // Update record
      const updateData = {
        raw_data: JSON.stringify(rawData),
        total_check_ins: rawData.length,
        check_in_time: updatedTimes.checkIn ? updatedTimes.checkIn.toISOString() : null,
        check_out_time: updatedTimes.checkOut ? updatedTimes.checkOut.toISOString() : null,
        modified: new Date().toISOString(),
        modified_by: 'Administrator'
      };

      await database.update('ERP Time Attendance', attendanceRecord.name, updateData);

      // Invalidate cache
      await redisClient.invalidateAttendanceCache(employee_code, dateObj);

      // Emit real-time update
      const io = req.app.get('io');
      if (io) {
        io.emit('attendance_updated', {
          employee_code,
          date: dateObj,
          check_in_time: updatedTimes.checkIn,
          check_out_time: updatedTimes.checkOut,
          total_check_ins: rawData.length
        });
      }

      res.json({
        message: 'Attendance updated successfully',
        status: 'success',
        data: {
          employee_code,
          date: dateObj,
          check_in_time: updatedTimes.checkIn,
          check_out_time: updatedTimes.checkOut,
          total_check_ins: rawData.length
        }
      });

    } catch (error) {
      console.error('Error in updateAttendanceTime:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get attendance statistics
  async getAttendanceStats(req, res) {
    try {
      const { start_date, end_date, employee_code, limit = 100 } = req.query;
      
      const filters = {};
      
      if (start_date && end_date) {
        filters.date = ['between', start_date, end_date];
      }
      
      if (employee_code) {
        filters.employee_code = employee_code;
      }

      const records = await database.getAll('ERP Time Attendance', 
        filters,
        ['employee_code', 'date', 'total_check_ins', 'check_in_time', 'check_out_time', 'status'],
        'date DESC',
        parseInt(limit)
      );

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
      console.error('Error in getAttendanceStats:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Get attendance records for a specific employee
  async getEmployeeAttendance(req, res) {
    try {
      const { employee_code } = req.params;
      const { start_date, end_date, limit = 50 } = req.query;

      const filters = { employee_code };
      
      if (start_date && end_date) {
        filters.date = ['between', start_date, end_date];
      }

      const records = await database.getAll('ERP Time Attendance',
        filters,
        '*',
        'date DESC',
        parseInt(limit)
      );

      res.json({
        message: records,
        status: 'success',
        employee_code,
        total_records: records.length
      });

    } catch (error) {
      console.error('Error in getEmployeeAttendance:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Process Hikvision attendance event (compatible with existing backend)
  async processHikvisionEvent(req, res) {
    try {
      const eventData = req.body;
      
      // Extract employee code and timestamp from Hikvision event
      const employeeCode = eventData.empCode || eventData.employeeCode;
      const timestamp = eventData.time || eventData.timestamp || new Date().toISOString();
      const deviceId = eventData.deviceId || eventData.sim || 'unknown';

      if (!employeeCode) {
        return res.status(400).json({
          error: 'Missing employee code',
          message: 'empCode or employeeCode is required'
        });
      }

      // Process the attendance
      await this.updateAttendanceTime({
        body: {
          employee_code: employeeCode,
          timestamp: timestamp,
          device_id: deviceId
        },
        app: req.app
      }, res);

    } catch (error) {
      console.error('Error in processHikvisionEvent:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // Smart logic to determine check-in vs check-out
  _updateCheckInOutTimes(currentCheckIn, currentCheckOut, newTime) {
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

module.exports = new AttendanceController();