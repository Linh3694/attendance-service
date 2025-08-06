const { MongoClient } = require('mongodb');
require('dotenv').config({ path: './config.env' });

class Database {
  constructor() {
    this.client = null;
    this.db = null;
  }

  async connect() {
    try {
      this.client = new MongoClient(process.env.MONGODB_URI);

      await this.client.connect();
      this.db = this.client.db(process.env.MONGODB_DB);
      
      console.log('✅ [Time Attendance Service] MongoDB connected successfully');
      
      // Create indexes for better performance
      await this.createIndexes();
      
    } catch (error) {
      console.error('❌ [Time Attendance Service] MongoDB connection failed:', error.message);
      throw error;
    }
  }

  async createIndexes() {
    try {
      const collection = this.db.collection('time_attendance');
      
      // Create indexes for common queries
      await collection.createIndex({ employee_code: 1, date: 1 }, { unique: true });
      await collection.createIndex({ date: 1 });
      await collection.createIndex({ employee_code: 1 });
      await collection.createIndex({ device_id: 1 });
      await collection.createIndex({ created_at: -1 });
      
      console.log('✅ [Time Attendance Service] Database indexes created');
    } catch (error) {
      console.warn('⚠️ [Time Attendance Service] Index creation failed:', error.message);
    }
  }

  async query(collectionName, operation, ...args) {
    try {
      const collection = this.db.collection(collectionName);
      return await operation(collection, ...args);
    } catch (error) {
      console.error('Database operation error:', error);
      throw error;
    }
  }

  // Time Attendance specific methods
  async findOrCreateTimeAttendance(employeeCode, date) {
    return await this.query('time_attendance', async (collection) => {
      const dateStr = typeof date === 'string' ? date : date.format('YYYY-MM-DD');
      
      let record = await collection.findOne({ 
        employee_code: employeeCode, 
        date: dateStr 
      });

      if (!record) {
        record = {
          employee_code: employeeCode,
          date: dateStr,
          device_id: null,
          raw_data: [],
          total_check_ins: 0,
          check_in_time: null,
          check_out_time: null,
          status: 'active',
          created_at: new Date(),
          updated_at: new Date()
        };

        await collection.insertOne(record);
      }

      return record;
    });
  }

  async updateTimeAttendance(employeeCode, date, updateData) {
    return await this.query('time_attendance', async (collection) => {
      const dateStr = typeof date === 'string' ? date : date.format('YYYY-MM-DD');
      
      const result = await collection.updateOne(
        { employee_code: employeeCode, date: dateStr },
        { 
          $set: { 
            ...updateData,
            updated_at: new Date()
          }
        }
      );

      return result;
    });
  }

  async getTimeAttendance(employeeCode, date) {
    return await this.query('time_attendance', async (collection) => {
      const dateStr = typeof date === 'string' ? date : date.format('YYYY-MM-DD');
      
      return await collection.findOne({ 
        employee_code: employeeCode, 
        date: dateStr 
      });
    });
  }

  async getTimeAttendanceByEmployee(employeeCode, startDate = null, endDate = null, limit = 50) {
    return await this.query('time_attendance', async (collection) => {
      const filter = { employee_code: employeeCode };
      
      if (startDate && endDate) {
        filter.date = {
          $gte: startDate,
          $lte: endDate
        };
      }

      return await collection.find(filter)
        .sort({ date: -1 })
        .limit(limit)
        .toArray();
    });
  }

  async getTimeAttendanceStats(startDate = null, endDate = null, employeeCode = null) {
    return await this.query('time_attendance', async (collection) => {
      const filter = {};
      
      if (startDate && endDate) {
        filter.date = {
          $gte: startDate,
          $lte: endDate
        };
      }
      
      if (employeeCode) {
        filter.employee_code = employeeCode;
      }

      return await collection.find(filter)
        .sort({ date: -1 })
        .toArray();
    });
  }

  async close() {
    if (this.client) {
      await this.client.close();
      console.log('✅ [Time Attendance Service] MongoDB connection closed');
    }
  }
}

module.exports = new Database();