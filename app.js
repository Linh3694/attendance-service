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
    console.log('🔗 [Attendance Service] Setting up Redis adapter...');
    await redisClient.connect();
    
    io.adapter(createAdapter(redisClient.getPubClient(), redisClient.getSubClient()));
    console.log('✅ [Attendance Service] Redis adapter setup complete');
  } catch (error) {
    console.warn('⚠️ [Attendance Service] Redis adapter setup failed:', error.message);
    console.warn('⚠️ [Attendance Service] Continuing without Redis adapter (single instance)');
  }
})();

// Connect to MariaDB
const connectDB = async () => {
  try {
    await database.connect();
  } catch (error) {
    console.error('❌ [Attendance Service] Database connection failed:', error.message);
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
  res.setHeader('X-Service', 'attendance-service');
  res.setHeader('X-Service-Version', '1.0.0');
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    service: 'attendance-service',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    database: 'connected',
    redis: 'connected'
  });
});

// Import routes
const attendanceRoutes = require('./routes/attendanceRoutes');
const timeAttendanceRoutes = require('./routes/timeAttendanceRoutes');

// Use routes
app.use("/api/attendance", attendanceRoutes);
app.use("/api/time-attendance", timeAttendanceRoutes);

// Frappe-compatible API endpoints
app.use("/api/method", attendanceRoutes); // For Frappe method calls
app.use("/api/resource", attendanceRoutes); // For Frappe resource API

// Socket.IO event handlers
io.on('connection', (socket) => {
  console.log('🔌 [Attendance Service] Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('🔌 [Attendance Service] Client disconnected:', socket.id);
  });
  
  // Handle attendance events
  socket.on('attendance_update', async (data) => {
    console.log('📊 [Attendance Service] Attendance update:', data);
    
    try {
      // Process attendance data
      const { employeeCode, timestamp, deviceId } = data;
      
      // Broadcast to all connected clients
      io.emit('attendance_updated', {
        employeeCode,
        timestamp,
        deviceId,
        processed: true,
        service: 'attendance-service'
      });
      
      // Cache the event
      await redisClient.publish('attendance:updates', data);
      
    } catch (error) {
      console.error('❌ [Attendance Service] Error processing attendance update:', error);
      socket.emit('attendance_error', { error: error.message });
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ [Attendance Service] Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
    service: 'attendance-service'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    service: 'attendance-service',
    path: req.originalUrl
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 [Attendance Service] Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('🛑 [Attendance Service] HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('🛑 [Attendance Service] Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('🛑 [Attendance Service] HTTP server closed');
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 5002;
server.listen(PORT, () => {
  console.log(`🚀 [Attendance Service] Server running on port ${PORT}`);
  console.log(`🌐 [Attendance Service] Health check: http://localhost:${PORT}/health`);
});

// Connect to database
connectDB();

// Expose app and io for testing
module.exports = { app, io, server };