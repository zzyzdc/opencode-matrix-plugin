import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * 偏好存储管理器 - 负责用户和房间模型偏好的持久化存储
 */
export class PreferenceStore {
  constructor(dbPath = null) {
    this.db = null
    this.dbPath = dbPath || join(__dirname, '../data/model-preferences.db')
    this.initialized = false
  }
  
  /**
   * 初始化数据库连接和表结构
   */
  async initialize() {
    if (this.initialized) return
    
    try {
      // 确保data目录存在
      const fs = await import('fs/promises')
      try {
        await fs.mkdir(join(__dirname, '../data'), { recursive: true })
      } catch (error) {
        // 目录可能已存在
      }
      
      // 打开数据库连接
      this.db = new Database(this.dbPath)
      
      // 设置数据库优化参数
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')
      this.db.pragma('cache_size = 2000')
      
      // 创建表结构
      await this.createTables()
      
      this.initialized = true
      console.log('✅ 偏好存储管理器初始化完成')
      
    } catch (error) {
      console.error('❌ 偏好存储管理器初始化失败:', error.message)
      throw error
    }
  }
  
  /**
   * 创建数据库表
   */
  async createTables() {
    if (!this.db) {
      throw new Error('数据库未初始化')
    }
    
    // 用户模型偏好表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_model_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        usage_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      )
    `)
    
    // 房间模型偏好表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS room_model_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        set_by_user TEXT,
        set_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(room_id)
      )
    `)
    
    // 模型使用统计表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS model_usage_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_id TEXT NOT NULL,
        user_id TEXT,
        room_id TEXT,
        tokens_used INTEGER DEFAULT 0,
        response_time_ms INTEGER DEFAULT 0,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    // 模型切换历史表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS model_switch_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        room_id TEXT,
        previous_model TEXT,
        new_model TEXT,
        scope TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    // 创建索引以提高查询性能
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_prefs_user ON user_model_preferences(user_id)
    `)
    
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_room_prefs_room ON room_model_preferences(room_id)
    `)
    
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_usage_stats_model ON model_usage_stats(model_id)
    `)
    
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_switch_history_user ON model_switch_history(user_id)
    `)
    
    console.log('✅ 数据库表结构创建完成')
  }
  
  /**
   * 保存用户模型偏好
   */
  async saveUserPreference(userId, modelId) {
    await this.ensureInitialized()
    
    try {
      const now = new Date().toISOString()
      
      // 检查是否已存在偏好设置
      const existingStmt = this.db.prepare(
        'SELECT id FROM user_model_preferences WHERE user_id = ?'
      )
      const existing = existingStmt.get(userId)
      
      if (existing) {
        // 更新现有记录
        const updateStmt = this.db.prepare(`
          UPDATE user_model_preferences 
          SET model_id = ?, last_used = ?, updated_at = ?, usage_count = usage_count + 1
          WHERE user_id = ?
        `)
        updateStmt.run(modelId, now, now, userId)
      } else {
        // 插入新记录
        const insertStmt = this.db.prepare(`
          INSERT INTO user_model_preferences (user_id, model_id, last_used, usage_count, created_at, updated_at)
          VALUES (?, ?, ?, 1, ?, ?)
        `)
        insertStmt.run(userId, modelId, now, now, now)
      }
      
      return { success: true, userId, modelId }
      
    } catch (error) {
      console.error('❌ 保存用户偏好失败:', error.message)
      throw error
    }
  }
  
  /**
   * 保存房间模型偏好
   */
  async saveRoomPreference(roomId, modelId, setByUser = 'system') {
    await this.ensureInitialized()
    
    try {
      const now = new Date().toISOString()
      
      // 检查是否已存在偏好设置
      const existingStmt = this.db.prepare(
        'SELECT id FROM room_model_preferences WHERE room_id = ?'
      )
      const existing = existingStmt.get(roomId)
      
      if (existing) {
        // 更新现有记录
        const updateStmt = this.db.prepare(`
          UPDATE room_model_preferences 
          SET model_id = ?, set_by_user = ?, set_at = ?
          WHERE room_id = ?
        `)
        updateStmt.run(modelId, setByUser, now, roomId)
      } else {
        // 插入新记录
        const insertStmt = this.db.prepare(`
          INSERT INTO room_model_preferences (room_id, model_id, set_by_user, set_at)
          VALUES (?, ?, ?, ?)
        `)
        insertStmt.run(roomId, modelId, setByUser, now)
      }
      
      return { success: true, roomId, modelId }
      
    } catch (error) {
      console.error('❌ 保存房间偏好失败:', error.message)
      throw error
    }
  }
  
  /**
   * 获取用户模型偏好
   */
  async getUserPreference(userId) {
    await this.ensureInitialized()
    
    try {
      const stmt = this.db.prepare(`
        SELECT model_id, last_used, usage_count
        FROM user_model_preferences
        WHERE user_id = ?
      `)
      
      const result = stmt.get(userId)
      return result || null
      
    } catch (error) {
      console.error('❌ 获取用户偏好失败:', error.message)
      throw error
    }
  }
  
  /**
   * 获取房间模型偏好
   */
  async getRoomPreference(roomId) {
    await this.ensureInitialized()
    
    try {
      const stmt = this.db.prepare(`
        SELECT model_id, set_by_user, set_at
        FROM room_model_preferences
        WHERE room_id = ?
      `)
      
      const result = stmt.get(roomId)
      return result || null
      
    } catch (error) {
      console.error('❌ 获取房间偏好失败:', error.message)
      throw error
    }
  }
  
  /**
   * 获取所有用户偏好
   */
  async getAllUserPreferences() {
    await this.ensureInitialized()
    
    try {
      const stmt = this.db.prepare(`
        SELECT user_id, model_id, last_used, usage_count, created_at
        FROM user_model_preferences
        ORDER BY usage_count DESC
      `)
      
      return stmt.all()
      
    } catch (error) {
      console.error('❌ 获取所有用户偏好失败:', error.message)
      throw error
    }
  }
  
  /**
   * 获取所有房间偏好
   */
  async getAllRoomPreferences() {
    await this.ensureInitialized()
    
    try {
      const stmt = this.db.prepare(`
        SELECT room_id, model_id, set_by_user, set_at
        FROM room_model_preferences
        ORDER BY set_at DESC
      `)
      
      return stmt.all()
      
    } catch (error) {
      console.error('❌ 获取所有房间偏好失败:', error.message)
      throw error
    }
  }
  
  /**
   * 记录模型使用统计
   */
  async recordUsage(modelId, options = {}) {
    await this.ensureInitialized()
    
    try {
      const { userId, roomId, tokensUsed = 0, responseTimeMs = 0 } = options
      const now = new Date().toISOString()
      
      const stmt = this.db.prepare(`
        INSERT INTO model_usage_stats (model_id, user_id, room_id, tokens_used, response_time_ms, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      
      stmt.run(modelId, userId, roomId, tokensUsed, responseTimeMs, now)
      
      return { success: true }
      
    } catch (error) {
      console.error('❌ 记录模型使用统计失败:', error.message)
      throw error
    }
  }
  
  /**
   * 记录模型切换历史
   */
  async recordSwitch(userId, roomId, previousModel, newModel, scope) {
    await this.ensureInitialized()
    
    try {
      const now = new Date().toISOString()
      
      const stmt = this.db.prepare(`
        INSERT INTO model_switch_history (user_id, room_id, previous_model, new_model, scope, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      
      stmt.run(userId, roomId, previousModel, newModel, scope, now)
      
      return { success: true }
      
    } catch (error) {
      console.error('❌ 记录模型切换历史失败:', error.message)
      throw error
    }
  }
  
  /**
   * 获取最常用的模型
   */
  async getTopModels(limit = 10) {
    await this.ensureInitialized()
    
    try {
      const stmt = this.db.prepare(`
        SELECT model_id, COUNT(*) as usage_count, SUM(tokens_used) as total_tokens, AVG(response_time_ms) as avg_response_time
        FROM model_usage_stats
        GROUP BY model_id
        ORDER BY usage_count DESC
        LIMIT ?
      `)
      
      return stmt.all(limit)
      
    } catch (error) {
      console.error('❌ 获取最常用模型失败:', error.message)
      throw error
    }
  }
  
  /**
   * 获取用户使用统计
   */
  async getUserStats(userId) {
    await this.ensureInitialized()
    
    try {
      const stmt = this.db.prepare(`
        SELECT 
          model_id,
          COUNT(*) as usage_count,
          SUM(tokens_used) as total_tokens,
          AVG(response_time_ms) as avg_response_time,
          MIN(timestamp) as first_used,
          MAX(timestamp) as last_used

        FROM model_usage_stats
        WHERE user_id = ?
        GROUP BY model_id
        ORDER BY usage_count DESC
      `)
      
      return stmt.all(userId)
      
    } catch (error) {
      console.error('❌ 获取用户使用统计失败:', error.message)
      throw error
    }
  }
  
  /**
   * 清理旧的使用记录（保留最近90天）
   */
  async cleanupOldRecords(daysToKeep = 90) {
    await this.ensureInitialized()
    
    try {
      const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString()
      
      const stmt = this.db.prepare(`
        DELETE FROM model_usage_stats 
        WHERE timestamp < ?
      `)
      
      const result = stmt.run(cutoffDate)
      console.log(`✅ 清理 ${result.changes} 条旧的使用记录`)
      return { success: true, recordsDeleted: result.changes }
      
    } catch (error) {
      console.error('❌ 清理旧记录失败:', error.message)
      throw error
    }
  }
  
  /**
   * 获取数据库状态
   */
  async getDatabaseStatus() {
    await this.ensureInitialized()
    
    try {
      const userCountStmt = this.db.prepare('SELECT COUNT(*) as count FROM user_model_preferences')
      const roomCountStmt = this.db.prepare('SELECT COUNT(*) as count FROM room_model_preferences')
      const usageCountStmt = this.db.prepare('SELECT COUNT(*) as count FROM model_usage_stats')
      const switchCountStmt = this.db.prepare('SELECT COUNT(*) as count FROM model_switch_history')
      
      return {
        userPreferences: userCountStmt.get().count,
        roomPreferences: roomCountStmt.get().count,
        usageRecords: usageCountStmt.get().count,
        switchHistory: switchCountStmt.get().count,
        databaseSize: await this.getDatabaseSize()
      }
      
    } catch (error) {
      console.error('❌ 获取数据库状态失败:', error.message)
      throw error
    }
  }
  
  /**
   * 获取数据库文件大小
   */
  async getDatabaseSize() {
    try {
      const fs = await import('fs/promises')
      const stats = await fs.stat(this.dbPath)
      return stats.size
    } catch (error) {
      return 0
    }
  }
  
  /**
   * 确保数据库已初始化
   */
  async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize()
    }
  }
  
  /**
   * 关闭数据库连接
   */
  async close() {
    if (this.db) {
      this.db.close()
      this.initialized = false
      console.log('✅ 数据库连接已关闭')
    }
  }
}
