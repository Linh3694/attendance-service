const { createClient } = require('redis');
require('dotenv').config({ path: './config.env' });

class RedisClient {
  constructor() {
    this.client = null;
    this.pubClient = null;
    this.subClient = null;
  }

  async connect() {
    try {
      // Main Redis client
      this.client = createClient({
        socket: {
          host: process.env.REDIS_HOST,
          port: process.env.REDIS_PORT,
        },
        password: process.env.REDIS_PASSWORD,
      });

      // Pub/Sub clients for Socket.IO
      this.pubClient = createClient({
        socket: {
          host: process.env.REDIS_HOST,
          port: process.env.REDIS_PORT,
        },
        password: process.env.REDIS_PASSWORD,
      });

      this.subClient = this.pubClient.duplicate();

      await this.client.connect();
      await this.pubClient.connect();
      await this.subClient.connect();

      console.log('✅ [Attendance Service] Redis connected successfully');
    } catch (error) {
      console.error('❌ [Attendance Service] Redis connection failed:', error.message);
      throw error;
    }
  }

  async set(key, value, ttl = null) {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : value;
    if (ttl) {
      await this.client.setEx(key, ttl, stringValue);
    } else {
      await this.client.set(key, stringValue);
    }
  }

  async get(key) {
    const value = await this.client.get(key);
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  async del(key) {
    await this.client.del(key);
  }

  async exists(key) {
    return await this.client.exists(key);
  }

  async expire(key, ttl) {
    await this.client.expire(key, ttl);
  }

  async hSet(key, field, value) {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : value;
    await this.client.hSet(key, field, stringValue);
  }

  async hGet(key, field) {
    const value = await this.client.hGet(key, field);
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  async hGetAll(key) {
    const hash = await this.client.hGetAll(key);
    const result = {};
    for (const [field, value] of Object.entries(hash)) {
      try {
        result[field] = JSON.parse(value);
      } catch {
        result[field] = value;
      }
    }
    return result;
  }

  async hDel(key, field) {
    await this.client.hDel(key, field);
  }

  async publish(channel, message) {
    const stringMessage = typeof message === 'object' ? JSON.stringify(message) : message;
    await this.pubClient.publish(channel, stringMessage);
  }

  async subscribe(channel, callback) {
    await this.subClient.subscribe(channel, (message) => {
      try {
        const parsedMessage = JSON.parse(message);
        callback(parsedMessage);
      } catch {
        callback(message);
      }
    });
  }

  // Cache methods for attendance data
  async cacheAttendanceRecord(employeeCode, date, record) {
    const key = `attendance:${employeeCode}:${date}`;
    await this.set(key, record, 3600); // Cache for 1 hour
  }

  async getCachedAttendanceRecord(employeeCode, date) {
    const key = `attendance:${employeeCode}:${date}`;
    return await this.get(key);
  }

  async invalidateAttendanceCache(employeeCode, date) {
    const key = `attendance:${employeeCode}:${date}`;
    await this.del(key);
  }

  // Real-time attendance tracking
  async setUserOnlineStatus(userId, isOnline) {
    const key = `user:online:${userId}`;
    if (isOnline) {
      await this.set(key, { status: 'online', lastSeen: new Date().toISOString() }, 300); // 5 minutes TTL
    } else {
      await this.del(key);
    }
  }

  async getUserOnlineStatus(userId) {
    const key = `user:online:${userId}`;
    return await this.get(key);
  }

  getPubClient() {
    return this.pubClient;
  }

  getSubClient() {
    return this.subClient;
  }
}

module.exports = new RedisClient();