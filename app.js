const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config({ path: './config.env' });

// Import Redis client for future integrations
const redisClient = require('./config/redis');

const app = express();

// Connect to MongoDB with Mongoose
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      dbName: process.env.MONGODB_DB
    });
    console.log('✅ [Attendance Service] MongoDB connected successfully');
  } catch (error) {
    console.error('❌ [Attendance Service] MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

// Connect to Redis for future integrations (optional)
const connectRedis = async () => {
  try {
    console.log('🔄 [Attendance Service] Attempting to connect to Redis...');
    console.log(`   Host: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`);
    await redisClient.connect();
    if (redisClient.isRedisAvailable()) {
      console.log('✅ [Attendance Service] Redis connected for future integrations');
    } else {
      console.log('⚠️ [Attendance Service] Redis connection failed, continuing without Redis');
      console.log('⚠️ [Attendance Service] Attendance records will still be saved, notifications will be skipped');
    }
  } catch (error) {
    console.warn('⚠️ [Attendance Service] Redis connection failed, continuing without Redis:', error.message);
    console.warn('⚠️ [Attendance Service] Attendance records will still be saved, notifications will be skipped');
  }
};

// CORS Configuration
// Hỗ trợ: WIS frontend, Parent Portal, Workspace Mobile (via nginx proxy)
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean) || [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://wis.wellspring.edu.vn',
    'https://wis-staging.wellspring.edu.vn',
    'https://parentportal.wellspring.edu.vn',
    'https://parentportal-staging.wellspring.edu.vn',
    'https://admin.sis.wellspring.edu.vn'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'X-Requested-With',
    'X-Frappe-Token',
    'x-frappe-token'
  ],
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// Explicitly handle preflight to include custom headers
app.options('*', cors(corsOptions));

// Add service info to responses
app.use((req, res, next) => {
  res.setHeader('X-Service', 'attendance-service');
  res.setHeader('X-Service-Version', '1.0.0-simplified');
  next();
});

// Request logging middleware - chỉ log những request quan trọng
app.use((req, res, next) => {
  // Chỉ log health check và errors
  if (req.url === '/health' || req.method !== 'POST') {
    console.log(`📥 [Attendance Service] ${req.method} ${req.url}`);
  }
  
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  const healthStatus = {
    service: 'attendance-service',
    version: '1.0.0-simplified',
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  };

  // Check Redis status (optional)
  if (redisClient && redisClient.isRedisAvailable()) {
    healthStatus.redis = 'connected';
    healthStatus.redis_note = 'Redis available for notifications and caching';
  } else {
    healthStatus.redis = 'unavailable';
    healthStatus.redis_note = 'Redis is optional, service continues to work without caching/notifications';
  }

  // Determine overall status - only MongoDB is critical
  if (mongoose.connection.readyState !== 1) {
    healthStatus.status = 'error';
    res.status(503).json(healthStatus);
  } else if (healthStatus.redis === 'unavailable') {
    healthStatus.status = 'degraded';
    res.status(200).json(healthStatus); // Redis unavailable is not a critical error
  } else {
    healthStatus.status = 'ok';
    res.status(200).json(healthStatus);
  }
});

// Import and use routes
const timeAttendanceRoutes = require('./routes/timeAttendanceRoutes');
app.use("/api/attendance", timeAttendanceRoutes);

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
const gracefulShutdown = async () => {
  console.log('🛑 [Attendance Service] Shutting down gracefully...');
  try {
    await mongoose.connection.close();
    if (redisClient) {
      await redisClient.disconnect();
    }
    console.log('🛑 [Attendance Service] Connections closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ [Attendance Service] Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const PORT = process.env.PORT || 5002;
app.listen(PORT, async () => {
  console.log(`🚀 [Attendance Service] Server running on port ${PORT}`);
  console.log(`🌐 [Attendance Service] Health check: http://localhost:${PORT}/health`);
  
  // Connect to databases
  await connectDB();
  await connectRedis();
});

module.exports = app;