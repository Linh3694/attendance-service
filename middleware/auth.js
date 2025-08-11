const jwt = require("jsonwebtoken");

// Middleware xác thực token cho Attendance Service
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ 
      status: "error",
      message: "Authorization header missing or invalid",
      code: 'MISSING_TOKEN',
      timestamp: new Date().toISOString()
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const secret = process.env.JWT_SECRET || "default_secret";
    const decoded = jwt.verify(token, secret);

    // Support multiple token formats: 
    // - Web app uses 'id' field
    // - Parent portal uses 'userId' field  
    // - Frappe JWT uses 'user' field (email)
    const userId = decoded.id || decoded.userId || decoded.user;
    
    if (!userId) {
      return res.status(401).json({ 
        status: "error",
        message: "Invalid token structure",
        timestamp: new Date().toISOString()
      });
    }

    // Store user info from token (không cần database lookup)
    req.user = {
      _id: userId,
      email: decoded.email || decoded.user || null, // Support Frappe JWT where 'user' is email
      role: decoded.role || null,
      employeeCode: decoded.employeeCode || null,
      fullname: decoded.fullname || decoded.name || null
    };
    
    next();
  } catch (error) {
    console.warn('❌ Token verification failed:', error.message);
    const code = error.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    return res.status(401).json({ 
      status: "error",
      message: code === 'TOKEN_EXPIRED' ? 'Token expired' : 'Invalid token',
      code,
      timestamp: new Date().toISOString()
    });
  }
};

// Middleware kiểm tra quyền admin (optional cho attendance service)
const isAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      status: "error",
      message: "Unauthorized",
      timestamp: new Date().toISOString()
    });
  }
  
  if (req.user.role !== "admin" && req.user.role !== "superadmin") {
    return res.status(403).json({ 
      status: "error",
      message: "Access denied. Admin role required.",
      timestamp: new Date().toISOString()
    });
  }
  
  next();
};

module.exports = {
  authenticateToken,
  isAdmin
};
