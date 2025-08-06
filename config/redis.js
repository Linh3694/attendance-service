const { createClient } = require('redis');
require('dotenv').config({ path: './config.env' });

class RedisClient {
  constructor() {
    this.client = null;
    this.connected = false;
  }

  async connect() {
    try {
      this.client = createClient({
        socket: {
          host: process.env.REDIS_HOST,
          port: process.env.REDIS_PORT,
        },
        password: process.env.REDIS_PASSWORD,
      });

      await this.client.connect();
      this.connected = true;
      
      console.log('✅ [Attendance Service] Redis connected successfully');

    } catch (error) {
      console.warn('⚠️ [Attendance Service] Redis connection failed:', error.message);
      this.connected = false;
      throw error;
    }
  }

  // Publish attendance events to Redis for future Frappe/Notification integration
  async publishAttendanceEvent(eventType, data) {
    if (!this.connected || !this.client) {
      console.warn('⚠️ Redis not connected, skipping event publish');
      return;
    }

    try {
      const message = {
        service: 'attendance-service',
        type: eventType,
        data: data,
        timestamp: new Date().toISOString()
      };

      // Publish to notification service channel
      const notificationChannel = process.env.REDIS_NOTIFICATION_CHANNEL || 'notification_events';
      await this.client.publish(notificationChannel, JSON.stringify(message));
      
      // Publish to frappe service channel
      const frappeChannel = process.env.REDIS_FRAPPE_CHANNEL || 'frappe_events';
      await this.client.publish(frappeChannel, JSON.stringify(message));
      
      console.log(`📤 [Attendance Service] Published ${eventType} to Redis channels`);
    } catch (error) {
      console.error('❌ [Attendance Service] Failed to publish to Redis:', error);
      throw error;
    }
  }

  // Basic Redis operations for caching (if needed in future)
  async set(key, value, ttl = null) {
    if (!this.connected) return;
    
    try {
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : value;
      if (ttl) {
        await this.client.setEx(key, ttl, stringValue);
      } else {
        await this.client.set(key, stringValue);
      }
    } catch (error) {
      console.error('❌ Redis SET error:', error);
    }
  }

  async get(key) {
    if (!this.connected) return null;
    
    try {
      const value = await this.client.get(key);
      if (!value) return null;
      
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      console.error('❌ Redis GET error:', error);
      return null;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
      this.connected = false;
      console.log('✅ [Attendance Service] Redis disconnected');
    }
  }
}

module.exports = new RedisClient();