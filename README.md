# Attendance Service

Microservice quản lý chấm công tương thích với Frappe Framework.

## Tính năng

- ✅ Tương thích hoàn toàn với Frappe API
- ✅ Kết nối MariaDB (production database)
- ✅ Redis caching và real-time updates
- ✅ Socket.IO cho real-time attendance tracking
- ✅ Smart check-in/check-out logic
- ✅ Hikvision device integration
- ✅ RESTful API và Frappe method calls
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

- Database: MariaDB connection (172.16.20.130)
- Redis: Valkey connection (172.16.20.120)
- JWT Secret
- CORS origins

## Chạy service

```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

### Standard REST API

- `POST /api/attendance/find-or-create-day-record` - Tìm hoặc tạo record cho ngày
- `POST /api/attendance/update-attendance-time` - Cập nhật thời gian chấm công
- `GET /api/attendance/stats` - Thống kê chấm công
- `GET /api/attendance/employee/:employee_code` - Lấy chấm công của nhân viên

### Frappe Compatible API

- `POST /api/method/erp.common.doctype.erp_time_attendance.erp_time_attendance.find_or_create_day_record`
- `GET /api/resource/ERP%20Time%20Attendance` - Lấy danh sách records
- `GET /api/resource/ERP%20Time%20Attendance/:name` - Lấy record cụ thể
- `POST /api/resource/ERP%20Time%20Attendance` - Tạo record mới
- `PUT /api/resource/ERP%20Time%20Attendance/:name` - Cập nhật record
- `DELETE /api/resource/ERP%20Time%20Attendance/:name` - Xóa record

### Time Attendance API

- `POST /api/time-attendance/process-event` - Xử lý event từ Hikvision
- `POST /api/time-attendance/bulk-process` - Xử lý nhiều events
- `GET /api/time-attendance/real-time/:employee_code` - Real-time tracking
- `GET /api/time-attendance/analytics/daily/:date` - Analytics theo ngày
- `GET /api/time-attendance/analytics/employee/:employee_code/summary` - Tóm tắt nhân viên

## Socket.IO Events

### Client to Server

- `attendance_update` - Cập nhật chấm công
- `user_online` - User online
- `user_offline` - User offline

### Server to Client

- `attendance_updated` - Chấm công đã cập nhật
- `user_status_changed` - Trạng thái user thay đổi
- `attendance_error` - Lỗi xử lý chấm công

## Cấu trúc Database

Service sử dụng DocType `ERP Time Attendance` với các fields:

- `employee_code` - Mã nhân viên (required)
- `employee_name` - Tên nhân viên
- `date` - Ngày chấm công (required)
- `check_in_time` - Thời gian vào
- `check_out_time` - Thời gian ra
- `total_check_ins` - Tổng số lần chấm
- `device_id` - ID thiết bị
- `raw_data` - Dữ liệu thô (JSON)
- `status` - Trạng thái (active/processed/error)

## Caching Strategy

- Redis cache cho attendance records (TTL: 1 hour)
- Real-time user status tracking
- Pub/Sub cho real-time updates

## Health Check

```bash
curl http://localhost:5002/health
```

## Logs

Service ghi logs chi tiết cho:

- Database connections
- Redis operations
- Attendance processing
- Socket.IO events
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
