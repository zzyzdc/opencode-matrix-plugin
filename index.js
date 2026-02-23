import { config } from 'dotenv'
import { createMatrixClient } from './matrix-client.js'
import { setupMatrixHandlers } from './matrix-handlers.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// 加载 .env 文件
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: join(__dirname, '.env') })

/**
 * OpenCode Matrix Plugin
 * 
 * This plugin integrates Matrix messaging with OpenCode.
 * It allows OpenCode to send notifications and receive commands via Matrix.
 */
export const MatrixPlugin = async ({ project, client, $, directory, worktree, serverUrl }) => {
  console.log('Matrix插件初始化...')
  
  let matrixClient = null
  let matrixConfig = null
  
  // 加载Matrix配置
  function loadMatrixConfig() {
    return {
      homeserver: process.env.MATRIX_HOMESERVER || 'https://matrix.org',
      userId: process.env.MATRIX_USER_ID,
      accessToken: process.env.MATRIX_ACCESS_TOKEN,
      password: process.env.MATRIX_PASSWORD,
      deviceName: process.env.MATRIX_DEVICE_NAME || 'OpenCode Bot',
      initialSyncLimit: parseInt(process.env.MATRIX_INITIAL_SYNC_LIMIT || '10'),
      notificationRoom: process.env.MATRIX_NOTIFICATION_ROOM,
      allowedRooms: process.env.MATRIX_ALLOWED_ROOMS 
        ? process.env.MATRIX_ALLOWED_ROOMS.split(',') 
        : [],
      allowedUsers: process.env.MATRIX_ALLOWED_USERS 

        ? process.env.MATRIX_ALLOWED_USERS.split(',') 
        : [],
      encryption: false // process.env.MATRIX_ENCRYPTION !== 'false'
    }
  }
  
  // 初始化Matrix客户端
  async function initializeMatrix() {
    try {
      matrixConfig = loadMatrixConfig()
      
      if (!matrixConfig.userId) {
        console.log('警告: MATRIX_USER_ID未设置，Matrix插件将禁用')
        return false
      }
      
      if (!matrixConfig.accessToken && !matrixConfig.password) {
        console.log('警告: MATRIX_ACCESS_TOKEN或MATRIX_PASSWORD未设置，Matrix插件将禁用')
        return false
      }
      
      matrixClient = await createMatrixClient(matrixConfig)
      
      if (matrixClient) {
        console.log(`Matrix客户端已连接到 ${matrixConfig.homeserver} (用户: ${matrixConfig.userId})`)
        
        // 设置消息处理器
        setupMatrixHandlers(matrixClient, {
          project,
          client,
          $,
          directory,
          worktree,
          serverUrl
        })
        
        return true
      }
    } catch (error) {
      console.error('Matrix客户端初始化失败:', error.message)
      return false
    }
  }
  
  // 发送Matrix通知
  async function sendMatrixNotification(message, options = {}) {
    if (!matrixClient || !matrixConfig.notificationRoom) {
      return false
    }
    
    try {
      await matrixClient.sendMessage(matrixConfig.notificationRoom, {
        msgtype: 'm.text',
        body: message
      })
      return true
    } catch (error) {
      console.error('发送Matrix通知失败:', error.message)
      return false
    }
  }
  
  // 发送消息到指定房间
  async function sendMatrixMessage(roomId, message, options = {}) {
    if (!matrixClient) {
      throw new Error('Matrix客户端未初始化')
    }
    
    try {
      await matrixClient.sendMessage(roomId, {
        msgtype: options.msgtype || 'm.text',
        body: message,
        format: options.format || undefined,
        formatted_body: options.formatted_body || undefined
      })
      return true
    } catch (error) {
      console.error(`发送Matrix消息到房间 ${roomId} 失败:`, error.message)
      throw error
    }
  }
  
  // 主初始化函数
  const initialized = await initializeMatrix()
  
  if (!initialized) {
    console.log('Matrix插件初始化失败，插件将禁用')
    return {}
  }
  
  return {
    // 插件信息
    name: 'matrix-plugin',
    version: '1.0.0',
    
    // OpenCode生命周期钩子

    'server.connected': async () => {
      console.log('OpenCode服务器已连接，Matrix插件准备就绪')
      
      // 发送启动通知
      if (matrixConfig.notificationRoom) {
        await sendMatrixNotification(
          `OpenCode已启动\n项目: ${project.name}\n时间: ${new Date().toLocaleString()}`
        )
      }
    },
    
    'session.created': async ({ session }) => {
      console.log(`新会话创建: ${session.id}`)
      
      if (matrixConfig.notificationRoom) {
        await sendMatrixNotification(
          `新的OpenCode会话已创建\n会话ID: ${session.id}\n项目: ${project.name}\n时间: ${new Date().toLocaleString()}`
        )
      }
    },
    
    'session.idle': async ({ session }) => {
      console.log(`会话完成: ${session.id}`)
      
      if (matrixConfig.notificationRoom) {
        await sendMatrixNotification(
          `OpenCode会话已完成\n会话ID: ${session.id}\n状态: ${session.status || 'idle'}\n时间: ${new Date().toLocaleString()}`
        )
      }
    },
    
    'session.error': async ({ session, error }) => {
      console.log(`会话错误: ${session.id}`, error)
      
      if (matrixConfig.notificationRoom) {
        await sendMatrixNotification(
          `OpenCode会话发生错误\n会话ID: ${session.id}\n错误: ${error.message || error}\n时间: ${new Date().toLocaleString()}`
        )
      }
    },
    
    // 自定义工具
    tool: {
      // 发送Matrix消息工具
      sendMatrixMessage: {
        description: '向Matrix房间发送消息',
        args: {
          roomId: { type: 'string', description: 'Matrix房间ID或别名' },
          message: { type: 'string', description: '要发送的消息内容' },
          msgtype: { type: 'string', description: '消息类型 (默认: m.text)', optional: true }
        },
        async execute(args, context) {
          return await sendMatrixMessage(args.roomId, args.message, {
            msgtype: args.msgtype
          })
        }
      },
      
      // 获取Matrix房间列表工具
      getMatrixRooms: {
        description: '获取Matrix客户端加入的房间列表',
        args: {},
        async execute(args, context) {
          if (!matrixClient) {
            throw new Error('Matrix客户端未初始化')
          }
          
          const rooms = matrixClient.getRooms()
          return {
            roomCount: rooms.length,
            rooms: rooms.map(room => ({
              id: room.roomId,
              name: room.name,
              canonicalAlias: room.getCanonicalAlias(),
              memberCount: room.getJoinedMemberCount(),
              unreadNotifications: room.getUnreadNotificationCount()
            }))
          }
        }
      },
      
       // Matrix状态工具
      matrixStatus: {
        description: '获取Matrix插件状态',
        args: {},
        async execute(args, context) {
          let connected = false
          if (matrixClient) {
            try {
              const userId = await matrixClient.getUserId()
              connected = !!userId
            } catch {
              connected = false
            }
          }
          return {
            initialized: !!matrixClient,
            connected,
            config: {
              ...matrixConfig,
              accessToken: matrixConfig.accessToken ? '***设置***' : '未设置',
              password: matrixConfig.password ? '***设置***' : '未设置'
            },
            notificationRoom: matrixConfig.notificationRoom || '未设置',
            allowedRooms: matrixConfig.allowedRooms.length,
            allowedUsers: matrixConfig.allowedUsers.length
          }
        }
      }
    },
    
    // 插件提供的公共API
    matrix: {
      sendMessage: sendMatrixMessage,
      sendNotification: sendMatrixNotification,
      getClient: () => matrixClient,
      getConfig: () => ({ ...matrixConfig })
    }
  }
}
export default MatrixPlugin;