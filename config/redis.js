const { createClient } = require('redis');
require('dotenv').config({ path: './config.env' });

class RedisClient {
  constructor() {
    this.client = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000; // 3 seconds
  }

  async connect(isRetry = false) {
    try {
      const attempt = isRetry ? this.reconnectAttempts + 1 : 1;
      this.client = createClient({
        socket: {
          host: process.env.REDIS_HOST || 'localhost',
          port: process.env.REDIS_PORT || 6379,
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.warn('❌ [Attendance Service] Redis: Max reconnect attempts reached');
              return new Error('Max reconnect attempts');
            }
            return Math.min(retries * 50, 500);
          }
        },
        password: process.env.REDIS_PASSWORD || undefined,
      });

      // Thêm event listeners
      this.client.on('error', (err) => {
        console.error('❌ [Attendance Service] Redis error:', err.message);
        this.connected = false;
      });

      this.client.on('connect', () => {
        console.log('✅ [Attendance Service] Redis client connected');
      });

      this.client.on('ready', () => {
        console.log('✅ [Attendance Service] Redis ready');
        this.connected = true;
        this.reconnectAttempts = 0;
      });

      await this.client.connect();
      this.connected = true;
      this.reconnectAttempts = 0;
      
      console.log(`✅ [Attendance Service] Redis connected successfully (attempt ${attempt})`);

    } catch (error) {
      console.warn(`⚠️ [Attendance Service] Redis connection failed (attempt ${isRetry ? this.reconnectAttempts + 1 : 1}):`, error.message);
      this.connected = false;
      
      // Thử kết nối lại nếu chưa vượt quá max attempts
      if (isRetry && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`⏳ [Attendance Service] Retrying Redis connection in ${this.reconnectDelay}ms... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        setTimeout(() => this.connect(true), this.reconnectDelay);
      } else if (!isRetry) {
        // First attempt - thử lại 1 lần
        console.log(`⏳ [Attendance Service] Scheduling Redis reconnect in ${this.reconnectDelay}ms...`);
        setTimeout(() => this.connect(true), this.reconnectDelay);
      }
      
      throw error;
    }
  }

  /**
   * Kiểm tra và kết nối lại Redis nếu bị mất kết nối
   */
  async ensureConnected() {
    if (!this.connected || !this.client) {
      console.warn('⚠️ [Attendance Service] Redis not connected, attempting to reconnect...');
      try {
        await this.connect(false);
      } catch (error) {
        console.error('❌ [Attendance Service] Failed to reconnect to Redis:', error.message);
        return false;
      }
    }
    return true;
  }

  // Publish attendance events to Redis for future Frappe/Notification integration
  async publishAttendanceEvent(eventType, data) {
    // Thử kết nối lại nếu mất kết nối
    const connected = await this.ensureConnected();
    
    if (!connected) {
      console.warn('⚠️ [Attendance Service] Redis not connected, skipping event publish');
      // Không throw error, tiếp tục xử lý attendance record
      return false;
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
      return true;
    } catch (error) {
      console.error('❌ [Attendance Service] Failed to publish to Redis:', error.message);
      this.connected = false;
      return false;
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