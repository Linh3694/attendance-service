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

// Connect to Redis for future integrations
const connectRedis = async () => {
  try {
    await redisClient.connect();
    console.log('✅ [Attendance Service] Redis connected for future integrations');
  } catch (error) {
    console.warn('⚠️ [Attendance Service] Redis connection failed:', error.message);
    console.warn('⚠️ [Attendance Service] Continuing without Redis (basic functionality)');
  }
};

// CORS Configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

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
  res.status(200).json({ 
    status: 'ok', 
    service: 'attendance-service',
    version: '1.0.0-simplified',
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    redis: redisClient ? 'available' : 'unavailable'
  });
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