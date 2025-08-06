const { createClient } = require('redis');
require('dotenv').config({ path: './config.env' });

class RedisClient {
  constructor() {
    this.client = null;
    this.pubClient = null;
    this.subClient = null;
    this.publishers = new Map();
    this.subscribers = new Map();
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

      // Service-specific publishers
      this.publishers.set('notification', createClient({
        socket: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
        password: process.env.REDIS_PASSWORD,
      }));

      this.publishers.set('frappe', createClient({
        socket: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
        password: process.env.REDIS_PASSWORD,
      }));

      this.publishers.set('attendance', createClient({
        socket: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
        password: process.env.REDIS_PASSWORD,
      }));

      // Service-specific subscribers
      this.subscribers.set('notification', createClient({
        socket: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
        password: process.env.REDIS_PASSWORD,
      }));

      this.subscribers.set('frappe', createClient({
        socket: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
        password: process.env.REDIS_PASSWORD,
      }));

      this.subscribers.set('attendance', createClient({
        socket: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT },
        password: process.env.REDIS_PASSWORD,
      }));

      await this.client.connect();
      await this.pubClient.connect();
      await this.subClient.connect();

      // Connect all publishers and subscribers
      for (const [name, client] of this.publishers) {
        await client.connect();
      }

      for (const [name, client] of this.subscribers) {
        await client.connect();
      }

      console.log('✅ [Time Attendance Service] Redis connected successfully');
      
      // Setup service subscriptions
      await this.setupServiceSubscriptions();

    } catch (error) {
      console.error('❌ [Time Attendance Service] Redis connection failed:', error.message);
      throw error;
    }
  }

  async setupServiceSubscriptions() {
    try {
      // Subscribe to Frappe employee data updates
      const frappeSubscriber = this.subscribers.get('frappe');
      if (frappeSubscriber) {
        await frappeSubscriber.subscribe(process.env.REDIS_FRAPPE_CHANNEL || 'frappe_events', (message) => {
          this.handleFrappeEvent(message);
        });
      }

      // Subscribe to notification service status
      const notificationSubscriber = this.subscribers.get('notification');
      if (notificationSubscriber) {
        await notificationSubscriber.subscribe(process.env.REDIS_NOTIFICATION_CHANNEL || 'notification_events', (message) => {
          this.handleNotificationEvent(message);
        });
      }

      console.log('✅ [Time Attendance Service] Service subscriptions setup complete');
    } catch (error) {
      console.error('❌ [Time Attendance Service] Failed to setup service subscriptions:', error);
      // Don't throw error, continue without subscriptions
    }
  }

  async handleFrappeEvent(message) {
    try {
      const data = JSON.parse(message);
      console.log('📥 [Time Attendance Service] Received Frappe event:', data);

      // Handle different Frappe event types
      switch (data.type) {
        case 'employee_created':
          await this.handleEmployeeCreated(data);
          break;
        case 'employee_updated':
          await this.handleEmployeeUpdated(data);
          break;
        case 'employee_deleted':
          await this.handleEmployeeDeleted(data);
          break;
        default:
          console.log('📥 [Time Attendance Service] Unknown Frappe event type:', data.type);
      }
    } catch (error) {
      console.error('❌ [Time Attendance Service] Error handling Frappe event:', error);
    }
  }

  async handleNotificationEvent(message) {
    try {
      const data = JSON.parse(message);
      console.log('📢 [Time Attendance Service] Received notification event:', data);

      // Handle different notification types
      switch (data.type) {
        case 'notification_sent':
          await this.handleNotificationSent(data);
          break;
        case 'notification_failed':
          await this.handleNotificationFailed(data);
          break;
        default:
          console.log('📢 [Time Attendance Service] Unknown notification type:', data.type);
      }
    } catch (error) {
      console.error('❌ [Time Attendance Service] Error handling notification event:', error);
    }
  }

  async handleEmployeeCreated(data) {
    console.log('👤 [Time Attendance Service] Employee created:', data.employee_code);
  }

  async handleEmployeeUpdated(data) {
    console.log('👤 [Time Attendance Service] Employee updated:', data.employee_code);
  }

  async handleEmployeeDeleted(data) {
    console.log('👤 [Time Attendance Service] Employee deleted:', data.employee_code);
  }

  async handleNotificationSent(data) {
    console.log('📢 [Time Attendance Service] Notification sent:', data);
  }

  async handleNotificationFailed(data) {
    console.log('❌ [Time Attendance Service] Notification failed:', data);
  }

  // Publish events to other services
  async publishToService(service, eventType, data) {
    try {
      const publisher = this.publishers.get(service);
      if (!publisher) {
        throw new Error(`Publisher not found for service: ${service}`);
      }

      const message = {
        service: 'time-attendance-service',
        type: eventType,
        data: data,
        timestamp: new Date().toISOString()
      };

      const channel = this.getChannelForService(service);
      await publisher.publish(channel, JSON.stringify(message));
      
      console.log(`📤 [Time Attendance Service] Published ${eventType} to ${service}`);
    } catch (error) {
      console.error(`❌ [Time Attendance Service] Failed to publish to ${service}:`, error);
    }
  }

  getChannelForService(service) {
    const channels = {
      'notification': process.env.REDIS_NOTIFICATION_CHANNEL,
      'frappe': process.env.REDIS_FRAPPE_CHANNEL,
      'attendance': process.env.REDIS_ATTENDANCE_CHANNEL
    };
    return channels[service] || process.env.REDIS_ATTENDANCE_CHANNEL;
  }

  // Enhanced attendance event publishing
  async publishAttendanceEvent(eventType, data) {
    await this.publishToService('notification', eventType, {
      ...data,
      source: 'time-attendance-service'
    });
  }

  async publishFrappeEvent(eventType, data) {
    await this.publishToService('frappe', eventType, {
      ...data,
      source: 'time-attendance-service'
    });
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

  // Cache methods for time attendance data
  async cacheTimeAttendanceRecord(employeeCode, date, record) {
    const key = `time_attendance:${employeeCode}:${date}`;
    await this.set(key, record, 3600); // Cache for 1 hour
  }

  async getCachedTimeAttendanceRecord(employeeCode, date) {
    const key = `time_attendance:${employeeCode}:${date}`;
    return await this.get(key);
  }

  async invalidateTimeAttendanceCache(employeeCode, date) {
    const key = `time_attendance:${employeeCode}:${date}`;
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

  // Inter-service communication methods
  async publishToNotificationService(eventData) {
    const message = {
      service: 'time-attendance-service',
      event: 'time_attendance_recorded',
      timestamp: new Date().toISOString(),
      data: eventData
    };
    
    await this.publish('notification:events', message);
    console.log('📤 [Time Attendance Service] Published to notification service:', message);
  }

  async publishToFrappeService(eventData) {
    const message = {
      service: 'time-attendance-service',
      event: 'employee_attendance_update',
      timestamp: new Date().toISOString(),
      data: eventData
    };
    
    await this.publish('frappe:events', message);
    console.log('📤 [Time Attendance Service] Published to Frappe service:', message);
  }

  // Subscribe to external service events
  async subscribeToFrappeEvents(callback) {
    await this.subscribe('frappe:employee_data', (message) => {
      console.log('📥 [Time Attendance Service] Received Frappe employee data:', message);
      callback(message);
    });
  }

  async subscribeToNotificationEvents(callback) {
    await this.subscribe('notification:status', (message) => {
      console.log('📥 [Time Attendance Service] Received notification status:', message);
      callback(message);
    });
  }

  getPubClient() {
    return this.pubClient;
  }

  getSubClient() {
    return this.subClient;
  }

  async disconnect() {
    if (this.client) await this.client.disconnect();
    if (this.pubClient) await this.pubClient.disconnect();
    if (this.subClient) await this.subClient.disconnect();
    
    // Disconnect all publishers and subscribers
    for (const [name, client] of this.publishers) {
      await client.disconnect();
    }
    
    for (const [name, client] of this.subscribers) {
      await client.disconnect();
    }
  }
}

module.exports = new RedisClient();