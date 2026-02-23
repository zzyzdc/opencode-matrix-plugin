import { MatrixClient, SimpleFsStorageProvider, RustSdkCryptoStorageProvider, MatrixAuth } from '@vector-im/matrix-bot-sdk'
import path from 'node:path'
import fs from 'node:fs'

export async function createMatrixClient(config) {
  try {
    let accessToken = config.accessToken
    const homeserver = config.homeserver
    const userId = config.userId
    
    if (!accessToken && config.password && userId) {
      console.log('使用密码获取Matrix访问令牌...')
      const auth = new MatrixAuth(homeserver)
      const loginResult = await auth.passwordLogin(userId, config.password, config.deviceName || 'OpenCode Bot')
      accessToken = loginResult.access_token
      console.log('Matrix登录成功，访问令牌已获取')
    }
    
    if (!accessToken) {
      throw new Error('需要提供访问令牌或密码进行认证')
    }
    
    const storageDir = path.join(process.env.HOME || '/tmp', '.config', 'opencode', 'matrix-storage')
    fs.mkdirSync(storageDir, { recursive: true })
    const storagePath = path.join(storageDir, `${userId.replace(/[@:]/g, '_')}.json`)
    
    const storage = new SimpleFsStorageProvider(storagePath)
    
    let cryptoStorage = null
    console.log('Matrix加密配置: config.encryption =', config.encryption, 'typeof:', typeof config.encryption)
    const enableEncryption = config.encryption !== false
    
    if (enableEncryption) {
      try {
        const cryptoPath = path.join(storageDir, 'crypto', userId.replace(/[@:]/g, '_'))
        fs.mkdirSync(cryptoPath, { recursive: true })
        
        const { StoreType } = await import('@matrix-org/matrix-sdk-crypto-nodejs')
        cryptoStorage = new RustSdkCryptoStorageProvider(cryptoPath, StoreType.Sqlite)
        console.log('✅ 端到端加密支持已启用')
      } catch (error) {
        console.warn('⚠️  警告: 无法初始化加密存储，E2EE将被禁用:', error.message)
        console.warn('提示: 请运行: node node_modules/@matrix-org/matrix-sdk-crypto-nodejs/download-lib.js')
      }
    }
    
    const client = new MatrixClient(homeserver, accessToken, storage, cryptoStorage)
    
    if (client.crypto) {
      console.log('初始化加密客户端...')
      try {
        const rooms = await client.getJoinedRooms()
        await client.crypto.prepare(rooms)
        console.log('✅ 加密客户端准备完成')
      } catch (cryptoError) {
        console.warn('⚠️  加密客户端初始化失败 (可能是密钥冲突):', cryptoError.message?.substring(0, 100))
        console.warn('   将继续运行，但可能无法解密部分消息')
      }
    }
    
    await client.start()
    
    console.log('Matrix客户端已初始化并启动同步')
    return client
  } catch (error) {
    console.error('创建Matrix客户端失败:', error.message)
    throw error
  }
}

async function waitForInitialSync(client, timeoutMs = 30000) {
  const startTime = Date.now()
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const userId = await client.getUserId()
      if (userId && userId.trim()) {
        return
      }
    } catch {}
    
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  throw new Error('Matrix初始同步超时')
}

export async function getMatrixRoomInfo(client, roomId) {
  try {
    let name = null
    let topic = null
    let canonicalAlias = null
    let memberCount = null
    
    try {
      const nameState = await client.getRoomStateEvent(roomId, 'm.room.name', '')
      name = nameState?.name ?? null
    } catch {}
    
    try {
      const topicState = await client.getRoomStateEvent(roomId, 'm.room.topic', '')
      topic = topicState?.topic ?? null
    } catch {}
    
    try {
      const aliasState = await client.getRoomStateEvent(roomId, 'm.room.canonical_alias', '')
      canonicalAlias = aliasState?.alias ?? null
    } catch {}
    
    try {
      const members = await client.getJoinedRoomMembers(roomId)
      memberCount = members.length
    } catch {}
    
    return {
      id: roomId,
      name,
      canonicalAlias,
      memberCount
    }
  } catch (error) {
    console.error(`获取Matrix房间信息失败 ${roomId}:`, error.message)
    return null
  }
}

export async function getMatrixUserInfo(client, userId) {
  try {
    const profile = await client.getUserProfile(userId)
    return {
      userId,
      displayName: profile?.displayname ?? null,
      avatarUrl: profile?.avatar_url ?? null
    }
  } catch (error) {
    console.error(`获取Matrix用户信息失败 ${userId}:`, error.message)
    return { userId }
  }
}

export function isUserAllowed(userId, config) {
  if (!config.allowedUsers || config.allowedUsers.length === 0) {
    return true
  }
  
  return config.allowedUsers.some(allowed => 
    userId === allowed || 
    userId.toLowerCase() === allowed.toLowerCase()
  )
}

export function isRoomAllowed(roomId, config) {
  if (!config.allowedRooms || config.allowedRooms.length === 0) {
    return true
  }
  
  return config.allowedRooms.some(allowed => 
    roomId === allowed || 
    roomId.toLowerCase() === allowed.toLowerCase()
  )
}