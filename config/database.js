const mysql = require('mysql2/promise');
require('dotenv').config({ path: './config.env' });

class Database {
  constructor() {
    this.pool = null;
  }

  async connect() {
    try {
      this.pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        acquireTimeout: 60000,
        timeout: 60000,
        reconnect: true
      });

      // Test connection
      const connection = await this.pool.getConnection();
      console.log('✅ [Attendance Service] MariaDB connected successfully');
      connection.release();
    } catch (error) {
      console.error('❌ [Attendance Service] MariaDB connection failed:', error.message);
      throw error;
    }
  }

  async query(sql, params = []) {
    try {
      const [rows] = await this.pool.execute(sql, params);
      return rows;
    } catch (error) {
      console.error('Database query error:', error);
      throw error;
    }
  }

  async transaction(callback) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // Frappe-style methods
  async insert(doctype, doc) {
    const fields = Object.keys(doc);
    const values = Object.values(doc);
    const placeholders = fields.map(() => '?').join(',');
    
    const sql = `INSERT INTO \`tab${doctype}\` (${fields.map(f => '`' + f + '`').join(',')}) VALUES (${placeholders})`;
    const result = await this.query(sql, values);
    return result.insertId;
  }

  async update(doctype, name, doc) {
    const fields = Object.keys(doc);
    const values = Object.values(doc);
    const setClause = fields.map(f => '`' + f + '` = ?').join(',');
    
    const sql = `UPDATE \`tab${doctype}\` SET ${setClause} WHERE name = ?`;
    await this.query(sql, [...values, name]);
  }

  async get(doctype, name, fields = '*') {
    const fieldList = Array.isArray(fields) ? fields.map(f => '`' + f + '`').join(',') : fields;
    const sql = `SELECT ${fieldList} FROM \`tab${doctype}\` WHERE name = ?`;
    const rows = await this.query(sql, [name]);
    return rows[0] || null;
  }

  async getAll(doctype, filters = {}, fields = '*', orderBy = 'modified DESC', limit = null) {
    const fieldList = Array.isArray(fields) ? fields.map(f => '`' + f + '`').join(',') : fields;
    let sql = `SELECT ${fieldList} FROM \`tab${doctype}\``;
    const params = [];

    // Build WHERE clause
    if (Object.keys(filters).length > 0) {
      const conditions = [];
      for (const [key, value] of Object.entries(filters)) {
        if (Array.isArray(value) && value[0] === 'between') {
          conditions.push(`\`${key}\` BETWEEN ? AND ?`);
          params.push(value[1], value[2]);
        } else if (Array.isArray(value) && value[0] === 'in') {
          const placeholders = value[1].map(() => '?').join(',');
          conditions.push(`\`${key}\` IN (${placeholders})`);
          params.push(...value[1]);
        } else {
          conditions.push(`\`${key}\` = ?`);
          params.push(value);
        }
      }
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    // Add ORDER BY
    if (orderBy) {
      sql += ` ORDER BY ${orderBy}`;
    }

    // Add LIMIT
    if (limit) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }

    return await this.query(sql, params);
  }

  async delete(doctype, name) {
    const sql = `DELETE FROM \`tab${doctype}\` WHERE name = ?`;
    await this.query(sql, [name]);
  }

  async exists(doctype, filters) {
    const conditions = [];
    const params = [];
    
    for (const [key, value] of Object.entries(filters)) {
      conditions.push(`\`${key}\` = ?`);
      params.push(value);
    }
    
    const sql = `SELECT COUNT(*) as count FROM \`tab${doctype}\` WHERE ${conditions.join(' AND ')}`;
    const result = await this.query(sql, params);
    return result[0].count > 0;
  }
}

module.exports = new Database();