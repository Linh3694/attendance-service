# Time Attendance Service

Microservice quản lý chấm công từ máy Hikvision với MongoDB và Redis pub/sub.

## Tính năng

- ✅ Xử lý events từ Hikvision devices
- ✅ Lưu trữ dữ liệu trong MongoDB local
- ✅ Redis caching và real-time updates
- ✅ Socket.IO cho real-time attendance tracking
- ✅ Smart check-in/check-out logic
- ✅ Liên kết với Notification service qua Redis pub/sub
- ✅ Liên kết với Frappe service qua Redis pub/sub
- ✅ RESTful API cho time attendance
- ✅ Bulk processing cho nhiều events
- ✅ Analytics và reporting

## Cài đặt

```bash
cd attendance-service
npm install
```

## Cấu hình

Sao chép và chỉnh sửa file `config.env`:

```bash
cp config.env.example config.env
```

Cấu hình các thông số:

- MongoDB: Local connection (mongodb://localhost:27017)
- Redis: Valkey connection (172.16.20.120)
- Notification Service URL
- Frappe API URL

## Chạy service

```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

### Time Attendance API

- `POST /api/time-attendance/hikvision/event` - Xử lý event từ Hikvision
- `POST /api/time-attendance/hikvision/batch` - Xử lý nhiều events
- `GET /api/time-attendance/stats` - Thống kê chấm công
- `GET /api/time-attendance/employee/:employee_code` - Lấy chấm công của nhân viên
- `GET /api/time-attendance/hikvision/stats` - Thống kê xử lý events

#### Batch endpoints

- `POST /api/attendance/students/day` (JWT) - Lấy giờ vào/ra theo danh sách mã trong 1 ngày

Request body:

```json
{
  "date": "2025-09-07",
  "codes": ["WS000123", "WS000456"]
}
```

Response body:

```json
{
  "status": "success",
  "date": "2025-09-07",
  "data": {
    "WS000123": {
      "checkInTime": "2025-09-07T00:20:15.000Z",
      "checkOutTime": "2025-09-07T10:22:41.000Z",
      "totalCheckIns": 3,
      "employeeName": "Nguyen Van A"
    },
    "WS000456": { "checkInTime": null, "checkOutTime": null, "totalCheckIns": 0 }
  }
}
```

### Legacy Endpoints (for compatibility)

- `POST /api/time-attendance/hikvision` - Legacy Hikvision endpoint
- `POST /api/time-attendance/process` - Legacy process endpoint

## Socket.IO Events

### Client to Server

- `time_attendance_update` - Cập nhật chấm công
- `user_online` - User online
- `user_offline` - User offline

### Server to Client

- `time_attendance_updated` - Chấm công đã cập nhật
- `user_status_changed` - Trạng thái user thay đổi
- `time_attendance_error` - Lỗi xử lý chấm công

## Cấu trúc Database (MongoDB)

Service sử dụng collection `time_attendance` với các fields:

```javascript
{
  employee_code: String,        // Mã nhân viên (required)
  date: String,                 // Ngày chấm công YYYY-MM-DD (required)
  device_id: String,            // ID thiết bị
  raw_data: Array,              // Dữ liệu thô từ Hikvision
  total_check_ins: Number,      // Tổng số lần chấm
  check_in_time: String,        // Thời gian vào (ISO)
  check_out_time: String,       // Thời gian ra (ISO)
  notes: String,                // Ghi chú
  status: String,               // Trạng thái (active/processed/error)
  created_at: Date,             // Thời gian tạo
  updated_at: Date              // Thời gian cập nhật
}
```

## Redis Pub/Sub Channels

### Publishing to External Services

- `notification:events` - Gửi events đến Notification service
- `frappe:events` - Gửi events đến Frappe service

### Subscribing to External Services

- `frappe:employee_data` - Nhận dữ liệu nhân viên từ Frappe
- `notification:status` - Nhận trạng thái từ Notification service

## Caching Strategy

- Redis cache cho time attendance records (TTL: 1 hour)
- Real-time user status tracking
- Pub/Sub cho real-time updates

## Health Check

```bash
curl http://localhost:5002/health
```

## Logs

Service ghi logs chi tiết cho:

- MongoDB connections
- Redis operations
- Hikvision event processing
- Socket.IO events
- External service communication
- Errors và warnings

## Docker Support (Optional)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 5002
CMD ["npm", "start"]
```

## Liên kết với Services khác

### Notification Service
- Nhận events từ time attendance
- Gửi thông báo real-time
- Channel: `notification:events`

### Frappe Service
- Nhận employee data updates
- Sync attendance data
- Channel: `frappe:events`
