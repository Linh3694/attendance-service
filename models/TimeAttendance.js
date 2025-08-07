const mongoose = require("mongoose");

const timeAttendanceSchema = new mongoose.Schema(
    {
        // Mã nhân viên từ máy chấm công
        employeeCode: {
            type: String,
            required: true,
            index: true
        },

        // Tên nhân viên
        employeeName: {
            type: String,
            default: null
        },

        // Ngày chấm công
        date: {
            type: Date,
            required: true,
            index: true
        },

        // Thời gian check-in đầu tiên trong ngày
        checkInTime: {
            type: Date,
            default: null
        },

        // Thời gian check-out cuối cùng trong ngày
        checkOutTime: {
            type: Date,
            default: null
        },

        // Số lần chấm công trong ngày
        totalCheckIns: {
            type: Number,
            default: 0
        },

        // ID thiết bị chấm công
        deviceId: {
            type: String,
            default: null
        },

        // Tên thiết bị chấm công
        deviceName: {
            type: String,
            default: null
        },

        // Ghi chú bổ sung
        notes: {
            type: String,
            default: null
        },

        // Trạng thái record
        status: {
            type: String,
            enum: ["active", "processed"],
            default: "active"
        },

        // Dữ liệu raw từ các lần chấm công
        rawData: [{
            timestamp: Date,
            deviceId: String,
            recordedAt: { type: Date, default: Date.now }
        }]
    },
    {
        timestamps: true
    }
);

// Compound index để đảm bảo unique theo employeeCode và date
timeAttendanceSchema.index({ employeeCode: 1, date: 1 }, { unique: true });

// Index để tìm kiếm nhanh
timeAttendanceSchema.index({ date: -1 });
timeAttendanceSchema.index({ employeeCode: 1 });

// Method đơn giản để cập nhật thời gian chấm công
timeAttendanceSchema.methods.updateAttendanceTime = function (timestamp, deviceId) {
    const checkTime = new Date(timestamp);
    
    // Thêm vào raw data
    this.rawData.push({
        timestamp: checkTime,
        deviceId: deviceId || this.deviceId,
        recordedAt: new Date()
    });

    // Logic đơn giản: lần đầu là check-in, lần cuối là check-out
    if (!this.checkInTime) {
        this.checkInTime = checkTime;
        this.totalCheckIns = 1;
    } else {
        // Nếu thời gian mới sớm hơn check-in hiện tại, cập nhật check-in
        if (checkTime < this.checkInTime) {
            this.checkInTime = checkTime;
        }
        // Nếu thời gian mới muộn hơn check-out hiện tại (hoặc chưa có check-out), cập nhật check-out
        if (!this.checkOutTime || checkTime > this.checkOutTime) {
            this.checkOutTime = checkTime;
        }
        this.totalCheckIns = this.rawData.length;
    }

    return this;
};

// Static method để tìm hoặc tạo record cho một ngày
timeAttendanceSchema.statics.findOrCreateDayRecord = async function (employeeCode, date, deviceId, employeeName = null, deviceName = null) {
    // Lấy ngày bắt đầu (00:00:00) theo VN timezone
    // Chuyển date về VN time trước khi lấy ngày
    const vnDate = new Date(date);
    const dayStart = new Date(vnDate.getFullYear(), vnDate.getMonth(), vnDate.getDate(), 0, 0, 0, 0);

    // Tìm record hiện có
    let record = await this.findOne({
        employeeCode: employeeCode,
        date: dayStart
    });

    // Nếu không có thì tạo mới
    if (!record) {
        record = new this({
            employeeCode: employeeCode,
            employeeName: employeeName,
            date: dayStart,
            deviceId: deviceId,
            deviceName: deviceName,
            rawData: []
        });
    } else {
        // Cập nhật employeeName và deviceName nếu có thông tin mới
        if (employeeName && !record.employeeName) {
            record.employeeName = employeeName;
        }
        if (deviceName && !record.deviceName) {
            record.deviceName = deviceName;
        }
    }

    return record;
};

// Static method để parse timestamp từ Hikvision và chuyển sang VN Time (+7)
timeAttendanceSchema.statics.parseAttendanceTimestamp = function (dateTimeString) {
    if (!dateTimeString) {
        throw new Error('DateTime string is required');
    }

    let timestamp;

    if (typeof dateTimeString === 'string') {
        timestamp = new Date(dateTimeString);
    } else {
        timestamp = new Date(dateTimeString);
    }

    if (isNaN(timestamp.getTime())) {
        throw new Error(`Invalid datetime format: ${dateTimeString}`);
    }

    // FINAL BACKEND FIX: Proper timezone handling for all cases
    const originalString = String(dateTimeString);
    
    // Case 1: Input has +07:00 timezone (VN time)
    if (originalString.includes('+07:00') || originalString.includes('+0700')) {
        // JavaScript Date constructor converts this correctly to UTC
        // Example: 2025-08-07T13:45:12+07:00 → 2025-08-07T06:45:12.000Z (correct UTC)
        console.log(`🕐 VN timezone input: ${originalString} → ${timestamp.toISOString()} (correct UTC)`);
        return timestamp;
    }
    
    // Case 2: Input is UTC or naive time (no timezone)
    else if (originalString.includes('Z') || originalString.includes('+00:00') || 
             (!originalString.includes('+') && !originalString.includes('-'))) {
        // This is UTC or naive, treat as UTC
        console.log(`🕐 UTC/naive input: ${originalString} → ${timestamp.toISOString()} (UTC)`);
        return timestamp;
    }
    
    // Case 3: Other timezone formats
    else {
        // Let JavaScript handle it naturally
        console.log(`🕐 Other timezone format: ${originalString} → ${timestamp.toISOString()} (UTC)`);
        return timestamp;
    }
};

module.exports = mongoose.model("TimeAttendance", timeAttendanceSchema);