import { isUserAllowed, isRoomAllowed, getMatrixRoomInfo, getMatrixUserInfo } from './matrix-client.js'
import { handleFileMessage, handleImageMessage } from './media-handler.js'
import { ModelManager } from './model-manager.js'
import { PreferenceStore } from './preference-store.js'

/**
 * 直接调用AI API处理消息
 */
async function callAIApi(message, userId, roomId) {
  try {
    const apiUrl = process.env.AI_API_URL || 'https://cc-api.sendshock.top/v1';
    const apiKey = process.env.AI_API_KEY;
    const model = process.env.AI_MODEL || 'gpt-5.2';

    if (!apiKey) {
      throw new Error('AI_API_KEY未配置');
    }

    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: `你是集成在Matrix聊天中的AI助手。当前用户: ${userId}，当前房间: ${roomId}。请用友好的方式回复用户。如果用户需要执行代码或命令，请告诉他们可以使用 !opencode 命令。`
          },
          {
            role: 'user',
            content: message
          }
        ],
        max_tokens: 1000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI API调用失败: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '未收到AI回复';
  } catch (error) {
    console.error('直接AI API调用失败:', error.message);
    throw error;
  }
}

export function setupMatrixHandlers(client, opencodeContext) {
  const { project, client: opencodeClient, $, directory, worktree, serverUrl } = opencodeContext
  
  client.on('room.message', async (roomId, event) => {
    try {
      if (event.type !== 'm.room.message') {
        return
      }
      
      const content = event.content
      const sender = event.sender
      const eventId = event.event_id
      const msgtype = content.msgtype
      
      if (sender === await client.getUserId()) {
        return
      }
      
      const config = {
        allowedUsers: process.env.MATRIX_ALLOWED_USERS 
          ? process.env.MATRIX_ALLOWED_USERS.split(',') 
          : [],
        allowedRooms: process.env.MATRIX_ALLOWED_ROOMS 
          ? process.env.MATRIX_ALLOWED_ROOMS.split(',') 
          : []
      }
      
      if (!isUserAllowed(sender, config) || !isRoomAllowed(roomId, config)) {
        console.log(`忽略来自未授权用户/房间的消息: ${sender} in ${roomId}`)
        return
      }
      
      if (msgtype === 'm.file') {
        await handleFileEvent({
          client,
          opencodeContext,
          roomId,
          sender,
          eventId,
          event
        })
        return
      }
      
      if (msgtype === 'm.image') {
        await handleImageEvent({
          client,
          opencodeContext,
          roomId,
          sender,
          eventId,
          event
        })
        return
      }
      
      const messageBody = content.body || ''
      
      if (messageBody.startsWith('!opencode')) {
        await handleMatrixCommand({
          client,
          opencodeContext,
          roomId,
          sender,
          message: messageBody,
          eventId,
          event
        })
      } else if (messageBody.startsWith('!help')) {
        await sendHelpMessage(client, roomId)
      } else if (messageBody.startsWith('!status')) {
        await sendStatusMessage(client, roomId, opencodeContext)
      } else {
        await handleNaturalLanguage({
          client,
          opencodeContext,
          roomId,
          sender,
          message: messageBody,
          eventId,
          event
        })
      }
      
    } catch (error) {
      console.error('处理Matrix消息失败:', error.message)
    }
  })
  
  // 处理连接状态变化
  client.on('Session.logged_out', () => {
    console.log('Matrix会话已登出')
  })
  
  client.on('sync', (state) => {
    if (state === 'SYNCING') {
      console.log('Matrix同步中...')
    } else if (state === 'ERROR') {
      console.log('Matrix同步错误')
    }
  })
  
  console.log('Matrix消息处理器已设置')
}

/**
 * 处理Matrix命令
 */
async function handleMatrixCommand(context) {
  const { client, roomId, sender, message, opencodeContext } = context
  const commandText = message.slice('!opencode'.length).trim()
  
  // 记录命令
  console.log(`Matrix命令: ${sender} -> ${commandText}`)
  
  if (!commandText) {
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: '用法: !opencode [命令]\n可用命令: help, status, run [代码], exec [shell命令]'
    })
    return
  }
  
  const [command, ...args] = commandText.split(' ')
  
  switch (command.toLowerCase()) {
    case 'help':
      await sendHelpMessage(client, roomId)
      break
      
    case 'status':
      await sendStatusMessage(client, roomId, opencodeContext)
      break
      
    case 'run':
      await handleRunCommand(client, roomId, args.join(' '), opencodeContext)
      break
      
    case 'exec':
    case 'shell':
      await handleShellCommand(client, roomId, args.join(' '), opencodeContext)
      break
      
    case 'projects':
      await listProjects(client, roomId, opencodeContext)
      break
      
    case 'models':
      await listModels(client, roomId, opencodeContext)
      break
      
    case 'switch':
    case 'model':
      await handleModelSwitch(client, roomId, sender, args, opencodeContext)
      break
      
    case 'current':
      await handleModelCurrent(client, roomId, sender, args, opencodeContext)
      break
      
    case 'version':
      await sendVersionInfo(client, roomId, opencodeContext)
      break
      
    default:
      await client.sendMessage(roomId, {
        msgtype: 'm.text',
        body: `未知命令: ${command}\n使用 !opencode help 查看可用命令`
      })
  }
}

/**
 * 发送帮助信息
 */
async function sendHelpMessage(client, roomId) {
  const helpText = `OpenCode Matrix Bot 命令:

!opencode help - 显示此帮助信息
!opencode status - 显示OpenCode状态
!opencode run [代码] - 运行JavaScript代码
!opencode exec [命令] - 执行Shell命令
!opencode projects - 列出项目
!opencode models - 列出可用模型
!opencode switch [模型ID] [作用域] - 切换LLM模型
!opencode current - 显示当前使用的模型
!opencode version - 显示版本信息

!help - 显示此帮助信息
!status - 显示OpenCode状态

模型切换作用域:
- session: 仅当前会话有效
- user: 为用户永久保存偏好
- room: 为房间永久保存偏好  
- global: 全局切换（所有用户和房间）

环境变量:
- MATRIX_HOMESERVER: Matrix服务器地址
- MATRIX_USER_ID: Matrix用户ID
- MATRIX_ACCESS_TOKEN:  Matrix访问令牌
- MATRIX_PASSWORD: Matrix密码（备选）
- MATRIX_NOTIFICATION_ROOM: 通知房间ID
- MATRIX_ALLOWED_ROOMS: 允许的房间列表（逗号分隔）
- MATRIX_ALLOWED_USERS: 允许的用户列表（逗号分隔）`
  
  await client.sendMessage(roomId, {
    msgtype: 'm.text',
    body: helpText
  })
}

async function sendStatusMessage(client, roomId, opencodeContext) {
  const { project, client: opencodeClient } = opencodeContext
  
  try {
    const projectInfo = {
      name: project.name || '未知',
      directory: project.directory || '未设置',
      worktree: project.worktree || '未设置'
    }
    
    const userId = await client.getUserId()
    const matrixStatus = {
      loggedIn: !!userId,
      syncState: client.syncingPresence || 'unknown',
      userId,
      roomCount: (await client.getJoinedRooms()).length
    }
    
    const statusText = `OpenCode 状态:

项目信息:
- 名称: ${projectInfo.name}
- 目录: ${projectInfo.directory}
- 工作树: ${projectInfo.worktree}

Matrix连接:
- 用户: ${matrixStatus.userId}
- 登录状态: ${matrixStatus.loggedIn ? '已登录' : '未登录'}
- 同步状态: ${matrixStatus.syncState}
- 房间数量: ${matrixStatus.roomCount}

服务器: ${opencodeContext.serverUrl}`

    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: statusText
    })
  } catch (error) {
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `获取状态失败: ${error.message}`
    })
  }
}

/**
 * 处理运行代码命令
 */
async function handleRunCommand(client, roomId, code, opencodeContext) {
  if (!code) {
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: '用法: !opencode run [JavaScript代码]'
    })
    return
  }
  
  try {
    // 在安全环境中运行代码
    const result = await evalInSandbox(code)
    
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `执行结果:\n\`\`\`javascript\n${code}\n\`\`\`\n结果: ${JSON.stringify(result, null, 2)}`
    })
  } catch (error) {
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `执行失败: ${error.message}`
    })
  }
}

/**
 * 处理Shell命令
 */
async function handleShellCommand(client, roomId, command, opencodeContext) {
  const { $ } = opencodeContext
  
  if (!command) {
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: '用法: !opencode exec [shell命令]'
    })
    return
  }
  
  try {
    const result = await $(command)
    
    // 限制输出长度
    const output = result.stdout || result.stderr || '无输出'
    const truncatedOutput = output.length > 2000 
      ? output.substring(0, 2000) + '... (输出已截断)' 
      : output
    
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `命令: ${command}\n\n输出:\n\`\`\`\n${truncatedOutput}\n\`\`\``
    })
  } catch (error) {
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `执行失败: ${error.message}`
    })
  }
}

/**
 * 列出项目
 */
async function listProjects(client, roomId, opencodeContext) {
  const { project } = opencodeContext
  
  await client.sendMessage(roomId, {
    msgtype: 'm.text',
    body: `当前项目: ${project.name || '未命名'}\n目录: ${project.directory || '未设置'}`
  })
}

/**
 * 列出模型
 */
async function listModels(client, roomId, opencodeContext) {
  const { client: opencodeClient } = opencodeContext
  
  try {
    // 尝试获取模型列表
    const models = await opencodeClient.models.list()
    
    if (!models || models.length === 0) {
      await client.sendMessage(roomId, {
        msgtype: 'm.text',
        body: '没有可用的模型'
      })
      return
    }
    
    const modelText = models.slice(0, 10).map(model => 
      `- ${model.provider || '未知'}/${model.id || '未知'}: ${model.name || '未命名'}`
    ).join('\n')
    
    const moreText = models.length > 10 ? `\n... 还有 ${models.length - 10} 个模型` : ''
    
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `可用模型 (${models.length}):\n${modelText}${moreText}`
    })
  } catch (error) {
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `获取模型列表失败: ${error.message}`
    })
  }
}

/**
 * 发送版本信息
 */
async function sendVersionInfo(client, roomId, opencodeContext) {
  const { client: opencodeClient } = opencodeContext
  
  try {
    // 获取OpenCode版本
    const version = await opencodeClient.version()
    
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `OpenCode版本: ${version.version || '未知'}\nMatrix插件版本: 1.0.0`
    })
  } catch (error) {
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `OpenCode版本: 未知\nMatrix插件版本: 1.0.0`
    })
  }
}

/**
 * 在沙箱环境中运行JavaScript代码
 */
async function evalInSandbox(code) {
  // 简单的沙箱环境
  const sandbox = {
    console: {
      log: (...args) => console.log('Sandbox:', ...args)
    },
    Date,
    Math,
    JSON,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer
  }
  
  try {
    // 使用Function构造函数创建安全函数
    const fn = new Function(...Object.keys(sandbox), `
      "use strict";
      return (${code});
    `)
    
    return fn(...Object.values(sandbox))
  } catch (error) {
    throw error
  }
}

/**
 * 检测自然语言中的模型切换意图
 */
function detectModelSwitchIntent(message, modelManager) {
  const lowerMessage = message.toLowerCase()
  
  const switchKeywords = ['切换', '换成', '使用', '改用', '改为', '换到', '切到', '用', '切换到']
  const scopeKeywords = {
    'session': ['会话', '临时', '本次', '这次', '当前'],
    'user': ['用户', '个人', '我的', '自己', '为我'],
    'room': ['房间', '群聊', '这里', '本房间'],
    'global': ['全局', '全部', '所有', '系统']
  }
  
  const hasSwitchIntent = switchKeywords.some(keyword => lowerMessage.includes(keyword))
  if (!hasSwitchIntent) {
    return null
  }
  
  const availableModels = modelManager.getAvailableModels()
  const modelKeywords = {}
  
  availableModels.forEach(model => {
    const keywords = []
    const modelName = model.id.split('/')[1]?.toLowerCase() || ''
    if (modelName) keywords.push(modelName)
    
    const displayName = model.name.toLowerCase()
    keywords.push(displayName)
    
    if (displayName.includes('deepseek')) keywords.push('deepseek', '深度求索')
    if (displayName.includes('kimi')) keywords.push('kimi', '月之暗面')
    if (displayName.includes('gpt')) keywords.push('gpt', 'openai', 'chatgpt')
    if (displayName.includes('claude')) keywords.push('claude', 'anthropic')
    if (displayName.includes('gemini')) keywords.push('gemini', '谷歌')
    
    modelKeywords[model.id] = [...new Set(keywords)]
  })
  
  const aliases = modelManager.getModelAliases()
  Object.entries(aliases).forEach(([alias, modelId]) => {
    if (!modelKeywords[modelId]) return
    modelKeywords[modelId].push(alias.toLowerCase())
  })
  
  let matchedModelId = null
  let matchedModelKeywords = []
  
  for (const [modelId, keywords] of Object.entries(modelKeywords)) {
    for (const keyword of keywords) {
      if (lowerMessage.includes(keyword)) {
        matchedModelId = modelId
        matchedModelKeywords = keywords
        break
      }
    }
    if (matchedModelId) break
  }
  
  if (!matchedModelId) {
    return null
  }
  
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
  
  if (lowerMessage.includes('永久') || lowerMessage.includes('保存') || lowerMessage.includes('偏好')) {
    detectedScope = 'user'
  }
  
  return {
    intent: 'switch_model',
    modelId: matchedModelId,
    scope: detectedScope,
    confidence: matchedModelKeywords.some(kw => lowerMessage.includes(kw)) ? 'high' : 'medium'
  }
}

/**
 * 处理自然语言消息 - 像OpenClaw一样
 */
async function handleNaturalLanguage(context) {
  const { client, roomId, sender, message, opencodeContext } = context
  const { client: opencodeClient } = opencodeContext
  
  console.log(`处理自然语言消息: ${sender} -> "${message}"`)
  
  try {
    await client.setTyping(roomId, true)
    

    try {
      const modelManager = new ModelManager(opencodeContext)
      await modelManager.initialize()
      
      const switchIntent = detectModelSwitchIntent(message, modelManager)
      
      if (switchIntent && switchIntent.intent === 'switch_model') {

        const result = await modelManager.switchModel(switchIntent.modelId, {
          userId: sender,
          roomId,
          scope: switchIntent.scope
        })
        
        const responseText = `✅ 模型切换成功！\n` +
                             `从: ${result.previous || '默认'}\n` +
                             `到: ${result.current}\n` +
                             `作用域: ${switchIntent.scope}\n` +
                             `用户: ${sender}\n` +
                             `房间: ${roomId}\n\n` +
                             `(检测到您的自然语言请求: "${message}")`
        
        await client.sendMessage(roomId, {
          msgtype: 'm.text',
          body: responseText
        })
        
        await client.setTyping(roomId, false)
        console.log(`✅ 通过自然语言切换模型: ${sender} -> ${result.current}`)
        return
      }
    } catch (modelSwitchError) {
      console.log(`自然语言模型切换检测失败，继续常规处理: ${modelSwitchError.message}`)

    }
    

    // 使用OpenCode AI处理自然语言消息
    try {
      console.log(`调用OpenCode AI处理消息: \"${message}\"`)

      // 调用OpenCode AI处理消息
      const aiResponse = await opencodeClient.session.prompt({
        message: message
      })

      // 提取AI回复内容
      let aiText = ''
      if (aiResponse && aiResponse.text) {
        aiText = aiResponse.text
      } else if (aiResponse && aiResponse.message && aiResponse.message.content) {
        aiText = aiResponse.message.content
      } else if (aiResponse && typeof aiResponse === 'string') {
        aiText = aiResponse
      } else if (aiResponse && aiResponse.content) {
        aiText = aiResponse.content
      } else {
        aiText = JSON.stringify(aiResponse, null, 2)
      }

      // 确保回复不为空
      if (!aiText.trim()) {
        aiText = `我收到了你的消息: \"${message}\"。我还在学习如何更好地回复。`
      }

      // 限制消息长度（Matrix消息有长度限制）
      const maxLength = 2000
      let finalResponse = aiText
      if (aiText.length > maxLength) {
        finalResponse = aiText.substring(0, maxLength) + '\\n... (回复过长，已截断)'
      }

      await client.sendMessage(roomId, {
        msgtype: 'm.text',
        body: finalResponse
      })

      console.log(`✅ AI回复成功: ${finalResponse.substring(0, 100)}...`)

    } catch (aiError) {
      console.error(`AI处理失败: ${aiError.message}`)

      // 尝试备用AI API调用
      try {
        console.log(`尝试备用AI API调用...`)
        const aiText = await callAIApi(message, sender, roomId)
        
        // 确保回复不为空
        let finalResponse = aiText
        if (!aiText.trim()) {
          finalResponse = `我收到了你的消息: \"${message}\"。我还在学习如何更好地回复。`
        }
        
        // 限制消息长度（Matrix消息有长度限制）
        const maxLength = 2000
        if (aiText.length > maxLength) {
          finalResponse = aiText.substring(0, maxLength) + '\\n... (回复过长，已截断)'
        }
        
        await client.sendMessage(roomId, {
          msgtype: 'm.text',
          body: finalResponse
        })
        
        console.log(`✅ 备用AI API回复成功: ${finalResponse.substring(0, 100)}...`)
        
      } catch (fallbackError) {
        console.error(`备用AI API调用失败: ${fallbackError.message}`)

        // 降级到模板消息
        const responses = [
          `我收到了你的消息: \"${message}\"。我正在学习如何更好地与Matrix集成。`,
          `你好！我是通过Matrix集成的OpenCode AI。你说了: \"${message}\"`,
          `消息已接收。我正在使用OpenCode AI处理你的消息，但遇到了技术问题。`,
          `我在听。你的消息是: \"${message}\"。我会尽快改进回复质量。`
        ]

        const randomResponse = responses[Math.floor(Math.random() * responses.length)]

        await client.sendMessage(roomId, {
          msgtype: 'm.text',
          body: randomResponse
        })
      }
    }
    
    await client.setTyping(roomId, false)
    
    console.log(`自然语言消息处理完成`)
    
  } catch (error) {
    console.error('处理自然语言消息失败:', error.message)
    
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `处理消息时出错: ${error.message}`
    })
  }
}

async function handleFileEvent(context) {
  const { client, roomId, sender, event } = context
  
  console.log(`\n${'='.repeat(60)}`)
  console.log(`📎 [${new Date().toLocaleTimeString()}] 收到文件消息`)
  console.log('='.repeat(60))
  console.log('发送者:', sender)
  console.log('文件名:', event.content.filename || event.content.body)
  
  try {
    await client.setTyping(roomId, true)
    
    const result = await handleFileMessage(client, event, {
      maxFileSize: 10 * 1024 * 1024
    })
    
    if (result.error) {
      await client.sendMessage(roomId, {
        msgtype: 'm.text',
        body: `❌ 文件处理失败: ${result.message}`
      })
    } else if (result.type === 'excel') {
      console.log('✅ Excel 文件解析成功')
      
      await client.sendMessage(roomId, {
        msgtype: 'm.text',
        body: result.aiContent
      })
      
      if (result.parseResult && result.parseResult.sheets) {
        for (const sheet of result.parseResult.sheets) {
          if (sheet.preview && sheet.preview.length > 100) {
            const previewLines = sheet.preview.split('\n').slice(0, 30).join('\n')
            if (previewLines.length > 3000) {
              await client.sendMessage(roomId, {
                msgtype: 'm.text',
                body: previewLines.substring(0, 3000) + '\n... (内容已截断)'
              })
              break
            }
          }
        }
      }
    } else if (result.type === 'text') {
      console.log('✅ 文本文件解析成功')
      
      const maxLen = 3500
      const content = result.aiContent.length > maxLen 
        ? result.aiContent.substring(0, maxLen) + '\n... (内容已截断)'
        : result.aiContent
        
      await client.sendMessage(roomId, {
        msgtype: 'm.text',
        body: content
      })
    } else {
      await client.sendMessage(roomId, {
        msgtype: 'm.text',
        body: result.aiContent
      })
    }
    
    await client.setTyping(roomId, false)
    
  } catch (error) {
    console.error('处理文件消息失败:', error.message)
    await client.setTyping(roomId, false)
    
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `处理文件时出错: ${error.message}`
    })
  }
}

async function handleImageEvent(context) {
  const { client, roomId, sender, event } = context
  
  console.log(`\n${'='.repeat(60)}`)
  console.log(`🖼️ [${new Date().toLocaleTimeString()}] 收到图片消息`)
  console.log('='.repeat(60))
  console.log('发送者:', sender)
  console.log('文件名:', event.content.filename || event.content.body)
  
  try {
    const result = await handleImageMessage(client, event)
    
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: result.error 
        ? `❌ 图片处理失败: ${result.message}`
        : result.aiContent
    })
    
  } catch (error) {
    console.error('处理图片消息失败:', error.message)
    
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `处理图片时出错: ${error.message}`
    })
  }
}

/**
 * 处理模型切换命令
 */
async function handleModelSwitch(client, roomId, sender, args, opencodeContext) {
  try {
    if (args.length === 0) {
      await client.sendMessage(roomId, {
        msgtype: 'm.text',
        body: '用法: !opencode switch [模型ID] [作用域]\n' +
              '示例: !opencode switch cc-oaicomp/DeepSeek-V3.2 session\n' +
              '作用域: session(会话), user(用户), room(房间), global(全局)\n' +
              '使用 !opencode models 查看可用模型'
      })
      return
    }
    
    const modelId = args[0]
    const scope = args[1] || 'session'
    
    // 初始化模型管理器
    const modelManager = new ModelManager(opencodeContext)
    await modelManager.initialize()
    
    // 执行模型切换
    const result = await modelManager.switchModel(modelId, {
      userId: sender,
      roomId,
      scope
    })
    
    // 发送成功消息
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `✅ 模型切换成功！\n` +
            `从: ${result.previous || '默认'}\n` +
            `到: ${result.current}\n` +
            `作用域: ${scope}\n` +
            `用户: ${sender}\n` +
            `房间: ${roomId}`
    })
    
    console.log(`✅ 用户 ${sender} 在房间 ${roomId} 切换模型到 ${result.current}`)
    
  } catch (error) {
    console.error('❌ 模型切换失败:', error.message)
    
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `❌ 模型切换失败: ${error.message}\n` +
            `使用 !opencode models 查看可用模型`
    })
  }
}

/**
 * 处理当前模型查询命令
 */
async function handleModelCurrent(client, roomId, sender, args, opencodeContext) {
  try {
    // 初始化模型管理器
    const modelManager = new ModelManager(opencodeContext)
    await modelManager.initialize()
    
    // 获取当前模型
    const currentModel = await modelManager.getCurrentModel({
      userId: sender,
      roomId
    })
    
    // 获取模型配置信息
    const modelConfig = modelManager.getModelConfig(currentModel)
    
    // 发送当前模型信息
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `📊 当前模型信息:\n` +
            `模型ID: ${currentModel}\n` +
            `名称: ${modelConfig.name}\n` +
            `提供者: ${modelConfig.provider}\n` +
            `上下文窗口: ${modelConfig.contextWindow?.toLocaleString() || '未知'} tokens\n` +
            `最大输出: ${modelConfig.maxTokens?.toLocaleString() || '未知'} tokens\n` +
            `输入模式: ${modelConfig.input?.join(', ') || 'text'}\n` +
            `输出模式: ${modelConfig.output?.join(', ') || 'text'}\n` +
            `\n使用 !opencode switch [模型ID] 切换模型`
    })
    
  } catch (error) {
    console.error('❌ 获取当前模型失败:', error.message)
    
    await client.sendMessage(roomId, {
      msgtype: 'm.text',
      body: `❌ 获取当前模型失败: ${error.message}`
    })
  }
}

/**
 * 增强的帮助信息（包含模型切换命令）
 */


export { handleFileEvent, handleImageEvent }