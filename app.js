const express = require("express");
const cors = require("cors");
const { createClient } = require('redis');
const { Server } = require('socket.io');
const http = require('http');
const { createAdapter } = require('@socket.io/redis-adapter');
require("dotenv").config({ path: './config.env' });

// Import configurations
const database = require('./config/database');
const redisClient = require('./config/redis');

const app = express();
const server = http.createServer(app);

// Socket.IO setup with Redis adapter
const io = new Server(server, {
  cors: { origin: "*" },
  allowRequest: (req, callback) => {
    // Basic authentication for socket connections
    callback(null, true);
  },
});

// Setup Redis adapter for Socket.IO clustering
(async () => {
  try {
    console.log('🔗 [Time Attendance Service] Setting up Redis adapter...');
    await redisClient.connect();
    
    // Create Redis adapter with proper clients
    const pubClient = redisClient.getPubClient();
    const subClient = redisClient.getSubClient();
    
    if (pubClient && subClient) {
      io.adapter(createAdapter(pubClient, subClient));
      console.log('✅ [Time Attendance Service] Redis adapter setup complete');
    } else {
      console.warn('⚠️ [Time Attendance Service] Redis clients not available, continuing without adapter');
    }
  } catch (error) {
    console.warn('⚠️ [Time Attendance Service] Redis adapter setup failed:', error.message);
    console.warn('⚠️ [Time Attendance Service] Continuing without Redis adapter (single instance)');
  }
})();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await database.connect();
  } catch (error) {
    console.error('❌ [Time Attendance Service] Database connection failed:', error.message);
    process.exit(1);
  }
};

// Middleware
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Add service info to all responses
app.use((req, res, next) => {
  res.setHeader('X-Service', 'time-attendance-service');
  res.setHeader('X-Service-Version', '1.0.0');
  next();
});

// Detailed request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  console.log(`📥 [Time Attendance Service] ${req.method} ${req.url}`);
  console.log(`📥 [Time Attendance Service] Headers:`, {
    'user-agent': req.headers['user-agent'],
    'content-type': req.headers['content-type'],
    'content-length': req.headers['content-length'],
    'x-forwarded-for': req.headers['x-forwarded-for'],
    'x-real-ip': req.headers['x-real-ip']
  });
  
  // Log request body for POST requests
  if (req.method === 'POST' && req.body) {
    console.log(`📥 [Time Attendance Service] Request Body:`, JSON.stringify(req.body, null, 2));
  }
  
  // Log response
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - start;
    console.log(`📤 [Time Attendance Service] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
    if (data) {
      console.log(`📤 [Time Attendance Service] Response:`, JSON.stringify(data, null, 2));
    }
    originalSend.call(this, data);
  };
  
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    service: 'time-attendance-service',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    database: 'connected',
    redis: 'connected'
  });
});

// Test endpoint for Hikvision connectivity
app.post('/test-hikvision', (req, res) => {
  console.log('🧪 [Time Attendance Service] Test endpoint hit!');
  console.log('🧪 [Time Attendance Service] Headers:', req.headers);
  console.log('🧪 [Time Attendance Service] Body:', req.body);
  
  res.status(200).json({
    status: 'success',
    message: 'Test endpoint working!',
    timestamp: new Date().toISOString(),
    received_data: {
      headers: req.headers,
      body: req.body,
      method: req.method,
      url: req.url
    }
  });
});

// Test GET endpoint
app.get('/test', (req, res) => {
  console.log('🧪 [Time Attendance Service] GET test endpoint hit!');
  res.status(200).json({
    status: 'success',
    message: 'GET test endpoint working!',
    timestamp: new Date().toISOString(),
    service: 'time-attendance-service'
  });
});

// Import routes
const timeAttendanceRoutes = require('./routes/timeAttendanceRoutes');

// Use routes
app.use("/api/attendance", timeAttendanceRoutes);

// Socket.IO event handlers
io.on('connection', (socket) => {
  console.log('🔌 [Time Attendance Service] Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('🔌 [Time Attendance Service] Client disconnected:', socket.id);
  });
  
  // Handle time attendance events
  socket.on('time_attendance_update', async (data) => {
    console.log('📊 [Time Attendance Service] Time attendance update:', data);
    
    try {
      // Process time attendance data
      const { employeeCode, timestamp, deviceId } = data;
      
      // Broadcast to all connected clients
      io.emit('time_attendance_updated', {
        employeeCode,
        timestamp,
        deviceId,
        processed: true,
        service: 'time-attendance-service'
      });
      
      // Cache the event
      await redisClient.publish('time_attendance:updates', data);
      
    } catch (error) {
      console.error('❌ [Time Attendance Service] Error processing time attendance update:', error);
      socket.emit('time_attendance_error', { error: error.message });
    }
  });
  
  // Handle real-time attendance tracking
  socket.on('user_online', async (data) => {
    const { userId } = data;
    await redisClient.setUserOnlineStatus(userId, true);
    socket.broadcast.emit('user_status_changed', { userId, status: 'online' });
  });
  
  socket.on('user_offline', async (data) => {
    const { userId } = data;
    await redisClient.setUserOnlineStatus(userId, false);
    socket.broadcast.emit('user_status_changed', { userId, status: 'offline' });
  });
});

// Subscribe to external service events
(async () => {
  try {
    // Subscribe to Frappe employee data updates
    await redisClient.subscribeToFrappeEvents((message) => {
      console.log('📥 [Time Attendance Service] Received Frappe employee data:', message);
      // Handle employee data updates from Frappe
    });

    // Subscribe to notification service status
    await redisClient.subscribeToNotificationEvents((message) => {
      console.log('📥 [Time Attendance Service] Received notification status:', message);
      // Handle notification service status updates
    });

    console.log('✅ [Time Attendance Service] Subscribed to external service events');
  } catch (error) {
    console.warn('⚠️ [Time Attendance Service] Failed to subscribe to external events:', error.message);
  }
})();

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ [Time Attendance Service] Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
    service: 'time-attendance-service'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    service: 'time-attendance-service',
    path: req.originalUrl
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 [Time Attendance Service] Received SIGTERM, shutting down gracefully...');
  server.close(async () => {
    await database.close();
    console.log('🛑 [Time Attendance Service] HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('🛑 [Time Attendance Service] Received SIGINT, shutting down gracefully...');
  server.close(async () => {
    await database.close();
    console.log('🛑 [Time Attendance Service] HTTP server closed');
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 5002;
server.listen(PORT, () => {
  console.log(`🚀 [Time Attendance Service] Server running on port ${PORT}`);
  console.log(`🌐 [Time Attendance Service] Health check: http://localhost:${PORT}/health`);
});

// Connect to database
connectDB();

// Expose app and io for testing
module.exports = { app, io, server };