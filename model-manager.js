import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import Database from 'bun:sqlite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * 模型管理器 - 负责管理LLM模型切换和偏好设置
 */
export class ModelManager {
  constructor(opencodeContext = null) {
    this.currentModel = 'cc-oaicomp/Kimi-K2.5'  // 默认模型
    this.modelCache = new Map()                 // 模型实例缓存
    this.userPreferences = new Map()            // 用户->模型映射（内存）
    this.roomPreferences = new Map()            // 房间->模型映射（内存）
    this.availableModels = []                   // 可用模型列表
    this.opencodeContext = opencodeContext      // OpenCode上下文
    
    // 初始化
    this.initialize()
  }
  
  /**
   * 初始化模型管理器
   */
  async initialize() {
    try {
      // 加载可用模型列表
      await this.loadAvailableModels()
      
      // 初始化数据库
      await this.initDatabase()
      
      // 加载持久化的偏好设置
      await this.loadPreferences()
      
      console.log('✅ 模型管理器初始化完成')
    } catch (error) {
      console.error('❌ 模型管理器初始化失败:', error.message)
    }
  }
  
  /**
   * 加载可用模型列表
   */
  async loadAvailableModels() {
    try {
      // 方法1: 通过OpenCode客户端获取（如果可用）
      if (this.opencodeContext?.client) {
        try {
          const models = await this.opencodeContext.client.models.list()
          if (models && models.length > 0) {
            this.availableModels = models
            console.log(`✅ 通过OpenCode客户端加载 ${models.length} 个可用模型`)
            return
          }
        } catch (error) {
          console.log('通过OpenCode客户端获取模型失败，尝试配置文件方式:', error.message)
        }
      }
      
      // 方法2: 直接从OpenCode配置文件读取
      const configPath = join(__dirname, '../../opencode.json')
      try {
        const configData = await readFile(configPath, 'utf8')
        const config = JSON.parse(configData)
        
        const models = []
        
        // 解析provider配置
        if (config.provider) {
          for (const [providerName, providerConfig] of Object.entries(config.provider)) {
            if (providerConfig.models) {
              for (const [modelId, modelConfig] of Object.entries(providerConfig.models)) {
                const fullModelId = `${providerName}/${modelId}`
                models.push({
                  id: fullModelId,
                  name: modelConfig.name || modelId,
                  provider: providerName,
                  contextWindow: modelConfig.limit?.context || 128000,
                   maxTokens: modelConfig.limit?.output || 8000,
                  reasoning: modelConfig.reasoning || false,
                  input: modelConfig.modalities?.input || ['text'],
                  output: modelConfig.modalities?.output || ['text']
                })
              }
            }
          }
        }
        
        this.availableModels = models
        console.log(`✅ 从配置文件加载 ${models.length} 个可用模型`)
        
      } catch (error) {
        console.error('❌ 读取配置文件失败:', error.message)
        // 方法3: 使用默认模型列表
        this.availableModels = this.getDefaultModels()
        console.log(`✅ 使用默认模型列表 (${this.availableModels.length} 个模型)`)
      }
      
    } catch (error) {
      console.error('❌ 加载可用模型列表失败:', error.message)
      this.availableModels = this.getDefaultModels()
    }
  }
  
  /**
   * 获取默认模型列表（备选方案）
   */
  getDefaultModels() {
    return [
      {
        id: 'cc-oaicomp/Kimi-K2.5',
        name: 'Kimi K2.5',
        provider: 'cc-oaicomp',
        contextWindow: 256000,
        maxTokens: 32000,
        reasoning: false,
        input: ['text', 'image'],
        output: ['text']
      },
      {
        id: 'cc-oaicomp/DeepSeek-V3.2',
        name: 'DeepSeek V3.2',
        provider: 'cc-oaicomp',
        contextWindow: 128000,
        maxTokens: 8000,
        reasoning: false,
        input: ['text'],
        output: ['text']
      },
      {
        id: 'cc-openai/gpt-5.3-codex',
        name: 'GPT 5.3 Codex',
        provider: 'cc-openai',
        contextWindow: 272000,
        maxTokens: 128000,
        reasoning: false,
        input: ['text', 'image'],
        output: ['text']
      },
      {
        id: 'cc-claude/claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        provider: 'cc-claude',
        contextWindow: 200000,
        maxTokens: 128000,
        reasoning: false,
        input: ['text', 'image'],
        output: ['text']
      },
      {
        id: 'cc-gemini/gemini-3-flash-preview',
        name: 'Gemini 3 Flash Preview',
        provider: 'cc-gemini',
        contextWindow: 1048576,
        maxTokens: 65536,
        reasoning: false,
        input: ['text', 'image', 'pdf'],
        output: ['text']
      }
    ]
  }
  
  /**
   * 初始化SQLite数据库
   */
  async initDatabase() {
    try {
      const dbPath = join(__dirname, '../data/model-preferences.db')
      
      // 确保data目录存在
      const fs = await import('fs/promises')
      try {
        await fs.mkdir(join(__dirname, '../data'), { recursive: true })
      } catch (error) {
        // 目录可能已存在
      }
      
      this.db = new Database(dbPath)
      
      // 创建用户偏好表
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
      
      // 创建房间偏好表
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
      
      // 创建模型使用统计表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS model_usage_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model_id TEXT NOT NULL,
          user_id TEXT,
          room_id TEXT,
          tokens_used INTEGER,
          response_time_ms INTEGER,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `)
      
      console.log('✅ 模型偏好数据库初始化完成')
      
    } catch (error) {
      console.error('❌ 数据库初始化失败:', error.message)
    }
  }
  
  /**
   * 从数据库加载偏好设置
   */
  async loadPreferences() {
    try {
      if (!this.db) return
      
      // 加载用户偏好
      const userStmt = this.db.prepare('SELECT user_id, model_id FROM user_model_preferences')
      const userRows = userStmt.all()
      userRows.forEach(row => {
        this.userPreferences.set(row.user_id, row.model_id)
      })
      
      // 加载房间偏好
      const roomStmt = this.db.prepare('SELECT room_id, model_id FROM room_model_preferences')
      const roomRows = roomStmt.all()
      roomRows.forEach(row => {
        this.roomPreferences.set(row.room_id, row.model_id)
      })
      
      console.log(`✅ 加载 ${userRows.length} 个用户偏好和 ${roomRows.length} 个房间偏好`)
      
    } catch (error) {
      console.error('❌ 加载偏好设置失败:', error.message)
    }
  }
  
  /**
   * 验证模型ID格式和可用性
   */
  validateModelIdFormat(modelId) {
    // 验证格式如: provider/model-name
    return /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(modelId)
  }
  
  /**
   * 检查模型是否可用
   */
  isModelAvailable(modelId) {
    return this.availableModels.some(model => model.id === modelId)
  }
  
  /**
   * 获取当前应该使用的模型
   */
  async getCurrentModel(context = {}) {
    const { userId, roomId } = context
    
    // 优先级: 用户偏好 > 房间偏好 > 全局默认
    if (userId && this.userPreferences.has(userId)) {
      return this.userPreferences.get(userId)
    }
    if (roomId && this.roomPreferences.has(roomId)) {
      return this.roomPreferences.get(roomId)
    }
    return this.currentModel
  }
  
  /**
   * 切换模型
   */
  async switchModel(modelId, options = {}) {
    const { userId, roomId, scope = 'session' } = options
    
    // 验证模型ID格式
    if (!this.validateModelIdFormat(modelId)) {
      throw new Error(`无效的模型ID格式: ${modelId}。正确格式: provider/model-name`)
    }
    
    // 验证模型可用性
    if (!this.isModelAvailable(modelId)) {
      throw new Error(`模型不可用: ${modelId}。使用 !opencode models 查看可用模型`)
    }
    
    try {
      let result = { success: true, previous: null, current: modelId }
      
      // 根据作用域更新模型
      if (scope.includes('session') || scope.includes('all')) {
        result.previous = this.currentModel
        this.currentModel = modelId
      }
      
      if (scope.includes('user') && userId) {
        this.userPreferences.set(userId, modelId)
        
        // 持久化到数据库
        if (this.db) {
          const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO user_model_preferences (user_id, model_id, updated_at)
            VALUES (?, ?, datetime('now'))
          `)
          stmt.run(userId, modelId)
        }
      }
      
      if (scope.includes('room') && roomId) {
        this.roomPreferences.set(roomId, modelId)
        
        // 持久化到数据库
        if (this.db) {
          const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO room_model_preferences (room_id, model_id, set_by_user, set_at)
            VALUES (?, ?, ?, datetime('now'))
          `)
          stmt.run(roomId, modelId, userId || 'system')
        }
      }
      
      // 记录使用统计
      await this.recordModelUsage(modelId, { userId, roomId })
      
      console.log(`✅ 模型切换成功: ${result.previous} -> ${result.current} (作用域: ${scope})`)
      return result
      
    } catch (error) {
      console.error('❌ 模型切换失败:', error.message)
      throw error
    }
  }
  
  /**
   * 记录模型使用统计
   */
  async recordModelUsage(modelId, context = {}) {
    try {
      if (!this.db) return
      
      const { userId, roomId, tokensUsed = 0, responseTimeMs = 0 } = context
      
      const stmt = this.db.prepare(`
        INSERT INTO model_usage_stats (model_id, user_id, room_id, tokens_used, response_time_ms, timestamp)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `)
      
      stmt.run(modelId, userId || null, roomId || null, tokensUsed, responseTimeMs)
      
    } catch (error) {
      console.error('❌ 记录模型使用统计失败:', error.message)
    }
  }
  
  /**
   * 获取可用模型列表
   */
  getAvailableModels(filter = '') {
    if (!filter) {
      return this.availableModels
    }
    
    return this.availableModels.filter(model => 
      model.id.toLowerCase().includes(filter.toLowerCase()) ||
      model.name.toLowerCase().includes(filter.toLowerCase()) ||
      model.provider.toLowerCase().includes(filter.toLowerCase())
    )
  }
  
  /**
   * 获取模型配置信息
   */
  getModelConfig(modelId) {
    const model = this.availableModels.find(m => m.id === modelId)
    if (!model) {
      throw new Error(`模型配置未找到: ${modelId}`)
    }
    return model
  }
  
  /**
   * 获取模型别名映射
   */
  getModelAliases() {
    return {
      'fast': 'cc-oaicomp/DeepSeek-V3.2',
      'smart': 'cc-openai/gpt-5.3-codex',
      'code': 'cc-openai/gpt-5.3-codex',
      'chat': 'cc-oaicomp/Kimi-K2.5',
      'default': 'cc-oaicomp/Kimi-K2.5'
    }
  }
  
  /**
   * 解析模型ID（支持别名）
   */
  resolveModelId(modelIdOrAlias) {
    const aliases = this.getModelAliases()
    
    // 如果是别名，转换为实际模型ID
    if (aliases[modelIdOrAlias]) {
      return aliases[modelIdOrAlias]
    }
    
    // 否则认为是标准模型ID
    return modelIdOrAlias
  }
  
  /**
   * 获取系统状态
   */
  getStatus() {
    return {
      currentModel: this.currentModel,
      userPreferences: Object.fromEntries(this.userPreferences),
      roomPreferences: Object.fromEntries(this.roomPreferences),
      availableModelsCount: this.availableModels.length,
      databaseConnected: !!this.db
    }
  }
  
  /**
   * 清理缓存
   */
  clearCache() {
    this.modelCache.clear()
    console.log('✅ 模型缓存已清理')
  }
  
  /**
   * 检测自然语言中的模型切换意图
   */
  detectSwitchIntent(message) {
    const lowerMessage = message.toLowerCase()
    
    // 扩展切换关键词：中英文混合
    const switchKeywords = [
      '切换', '换成', '使用', '改用', '改为', '换到', '切到', '用', '切换到',
      'switch', 'use', 'change', 'set', 'select', 'choose',
      '保存', '偏好', '设置', '设为', '指定', '选取'
    ]
    const scopeKeywords = {
      'session': ['会话', '临时', '本次', '这次', '当前', 'session', 'temporary'],
      'user': ['用户', '个人', '我的', '自己', '为我', 'user', 'personal', 'my', 'me'],
      'room': ['房间', '群聊', '这里', '本房间', 'room', 'chat', 'group'],
      'global': ['全局', '全部', '所有', '系统', 'global', 'all', 'system']
    }
    
    const hasSwitchIntent = switchKeywords.some(keyword => lowerMessage.includes(keyword))
    if (!hasSwitchIntent) {
      return null
    }
    
    const availableModels = this.getAvailableModels()
    const modelKeywords = {}
    
    // 为每个模型构建关键词列表，同时记录关键词的"特异性分数"
    availableModels.forEach(model => {
      const keywords = []
      const modelName = model.id.split('/')[1]?.toLowerCase() || ''
      if (modelName) keywords.push(modelName)
      
      const displayName = model.name.toLowerCase()
      keywords.push(displayName)
      
      // 品牌关键词
      if (displayName.includes('deepseek')) keywords.push('deepseek', '深度求索')
      if (displayName.includes('kimi')) keywords.push('kimi', '月之暗面')
      if (displayName.includes('gpt')) keywords.push('gpt', 'openai', 'chatgpt')
      if (displayName.includes('claude')) keywords.push('claude', 'anthropic')
      if (displayName.includes('gemini')) keywords.push('gemini', '谷歌')
      
      // 提取版本号（如 5.3）作为独立关键词
      const versionMatch = displayName.match(/(\d+\.\d+)/)
      if (versionMatch) {
        keywords.push(versionMatch[1])
      }
      
      modelKeywords[model.id] = [...new Set(keywords)]
    })
    
    // 添加别名关键词
    const aliases = this.getModelAliases()
    Object.entries(aliases).forEach(([alias, modelId]) => {
      if (!modelKeywords[modelId]) return
      modelKeywords[modelId].push(alias.toLowerCase())
    })
    
    // 改进的模型匹配：考虑关键词特异性
    let matchedModelId = null
    let matchedModelKeywords = []
    let bestScore = -1
    
    for (const [modelId, keywords] of Object.entries(modelKeywords)) {
      let modelScore = 0
      let matchedKeywords = []
      
      for (const keyword of keywords) {
        if (lowerMessage.includes(keyword)) {
          matchedKeywords.push(keyword)
          // 给特异性关键词更高分数：版本号 > 完整模型名 > 品牌名 > 别名
          if (keyword.match(/^\d+\.\d+$/)) {
            modelScore += 10  // 版本号最具体
          } else if (keyword.includes('/')) {
            modelScore += 8   // 完整模型ID
          } else if (keyword === modelId.split('/')[1]?.toLowerCase()) {
            modelScore += 6   // 模型名称部分
          } else if (['deepseek', 'kimi', 'gpt', 'openai', 'claude', 'gemini', '深度求索', '月之暗面', '谷歌'].includes(keyword)) {
            modelScore += 4   // 品牌名
          } else {
            modelScore += 2   // 别名
          }
        }
      }
      
      if (modelScore > 0 && modelScore > bestScore) {
        bestScore = modelScore
        matchedModelId = modelId
        matchedModelKeywords = matchedKeywords
      }
    }
    
    if (!matchedModelId) {
      return null
    }
    
    // 作用域检测
    let detectedScope = 'session'
    for (const [scope, scopeWords] of Object.entries(scopeKeywords)) {
      for (const word of scopeWords) {
        if (lowerMessage.includes(word)) {
          detectedScope = scope
          break
        }
      }
      if (detectedScope !== 'session') break
    }
    
    // 永久保存关键词
    if (lowerMessage.includes('永久') || lowerMessage.includes('保存') || lowerMessage.includes('偏好') ||
        lowerMessage.includes('persistent') || lowerMessage.includes('preference')) {
      detectedScope = 'user'
    }
    
    // 置信度计算：基于匹配关键词的数量和特异性
    const confidence = bestScore >= 10 ? 'high' : (bestScore >= 5 ? 'medium' : 'low')
    
    return {
      intent: 'switch_model',
      modelId: matchedModelId,
      scope: detectedScope,
      confidence: confidence,
      matchedKeywords: matchedModelKeywords
    }
  }
  
  /**
   * 获取API兼容的模型ID（去除provider前缀）
   * @param {string} fullModelId - 完整模型ID (如: cc-oaicomp/Kimi-K2.5)
   * @returns {string} API兼容的模型ID (如: Kimi-K2.5)
   */
  getApiModelId(fullModelId) {
    // 如果模型ID已经不含斜杠，直接返回
    if (!fullModelId.includes('/')) {
      return fullModelId
    }
    
    // 提取模型名称部分（去除provider前缀）
    const parts = fullModelId.split('/')
    if (parts.length >= 2) {
      return parts[1]
    }
    
    // 如果格式异常，返回原值
    return fullModelId
  }
  
  /**
   * 关闭数据库连接
   */
  close() {
    if (this.db) {
      this.db.close()
      console.log('✅ 数据库连接已关闭')
    }
  }
}