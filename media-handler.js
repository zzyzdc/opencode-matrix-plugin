import fs from 'node:fs'
import path from 'node:path'
import { parseExcel, formatExcelForAI, getFileType } from './excel-parser.js'

const MATRIX_MEDIA_DOWNLOAD_PATH = process.env.MATRIX_MEDIA_PATH || '/tmp/matrix-media'

function ensureMediaDir() {
  if (!fs.existsSync(MATRIX_MEDIA_DOWNLOAD_PATH)) {
    fs.mkdirSync(MATRIX_MEDIA_DOWNLOAD_PATH, { recursive: true })
  }
}

async function downloadMatrixMedia(client, mxcUrl, filename) {
  ensureMediaDir()
  
  console.log('📥 开始下载媒体文件...')
  console.log('   MXC URL:', mxcUrl)
  console.log('   文件名:', filename)
  
  const accessToken = process.env.MATRIX_ACCESS_TOKEN
  
  const mxcMatch = mxcUrl.match(/mxc:\/\/([^\/]+)\/(.+)/)
  if (!mxcMatch) {
    throw new Error(`Invalid MXC URL: ${mxcUrl}`)
  }
  
  const [, mediaServer, mediaId] = mxcMatch
  console.log('   媒体服务器:', mediaServer)
  console.log('   媒体ID:', mediaId)
  
  const homeserverUrl = process.env.MATRIX_HOMESERVER || 'https://matrix.sendshock.top'
  
  const urls = [
    `${homeserverUrl}/_matrix/client/v1/media/download/${mediaServer}/${mediaId}?allow_remote=true`,
    `${homeserverUrl}/_matrix/media/v3/download/${mediaServer}/${mediaId}?allow_remote=true`,
    `${homeserverUrl}/_matrix/media/r0/download/${mediaServer}/${mediaId}?allow_remote=true`,
  ]
  
  for (const downloadUrl of urls) {
    console.log('   尝试 URL:', downloadUrl.replace(/\?.*/, ''))
    
    try {
      const response = await fetch(downloadUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })
      
      console.log('   状态:', response.status, response.statusText)
      
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer())
        const filePath = path.join(MATRIX_MEDIA_DOWNLOAD_PATH, filename || mediaId)
        fs.writeFileSync(filePath, buffer)
        
        console.log('   ✅ 下载成功! 大小:', buffer.length, 'bytes')
        return { buffer, filePath, size: buffer.length }
      } else {
        const errorText = await response.text()
        console.log('   错误响应:', errorText.substring(0, 200))
      }
    } catch (e) {
      console.log('   异常:', e.message)
    }
  }
  
  throw new Error('All download attempts failed')
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function handleFileMessage(client, event, options = {}) {
  const { maxFileSize = 10 * 1024 * 1024 } = options
  
  const content = event.content || {}
  console.log('\n📋 文件消息完整内容:')
  console.log(JSON.stringify(content, null, 2))
  
  const filename = content.filename || content.body || 'unknown'
  const fileInfo = content.info || {}
  const fileSize = fileInfo.size || 0
  const mimeType = fileInfo.mimetype || 'application/octet-stream'
  
  console.log('\n文件信息:')
  console.log('  文件名:', filename)
  console.log('  大小:', formatFileSize(fileSize))
  console.log('  MIME:', mimeType)
  
  let mxcUrl = content.url
  let isEncrypted = false
  
  if (!mxcUrl && content.file) {
    mxcUrl = content.file.url
    isEncrypted = true
    console.log('  类型: 加密文件')
  } else {
    console.log('  类型: 普通文件')
  }
  
  if (!mxcUrl) {
    return { error: true, message: 'No media URL found in message' }
  }
  
  if (fileSize > maxFileSize) {
    return { 
      error: true, 
      message: `File too large: ${formatFileSize(fileSize)} (max: ${formatFileSize(maxFileSize)})` 
    }
  }
  
  try {
    let buffer
    
    if (isEncrypted) {
      console.log('\n🔐 处理加密文件...')
      
      try {
        if (client.crypto && client.crypto.decryptMedia) {
          console.log('   使用 crypto.decryptMedia 解密...')
          buffer = await client.crypto.decryptMedia(content.file)
          console.log('   ✅ 解密成功! 大小:', buffer?.length, 'bytes')
        } else {
          console.log('   ❌ crypto 客户端不可用')
          throw new Error('Crypto client not available')
        }
      } catch (sdkError) {
        console.log('   ❌ 解密失败:', sdkError.message)
        throw new Error(`Encrypted file download failed: ${sdkError.message}`)
      }
    } else {
      const result = await downloadMatrixMedia(client, mxcUrl, filename)
      buffer = result.buffer
    }
    
    const filePath = path.join(MATRIX_MEDIA_DOWNLOAD_PATH, filename)
    fs.writeFileSync(filePath, buffer)
    console.log('   保存到:', filePath)
    
    const fileType = getFileType(filename)
    console.log('   文件类型:', fileType)
    
    if (fileType === 'excel' || fileType === 'csv') {
      const parseResult = parseExcel(buffer, filename, {
        maxRows: 100,
        maxSheets: 3,
        format: 'markdown'
      })
      
      return {
        type: 'excel',
        filename,
        size: formatFileSize(buffer.length),
        mimeType,
        filePath,
        parseResult,
        aiContent: formatExcelForAI(parseResult, { maxPreviewRows: 50 })
      }
    }
    
    if (fileType === 'text') {
      const textContent = buffer.toString('utf-8')
      const preview = textContent.length > 10000 
        ? textContent.substring(0, 10000) + '\n... (内容已截断)'
        : textContent
      
      return {
        type: 'text',
        filename,
        size: formatFileSize(buffer.length),
        mimeType,
        filePath,
        textContent: preview,
        aiContent: `📄 **文件内容: ${filename}**\n\n\`\`\`\n${preview}\n\`\`\``
      }
    }
    
    return {
      type: 'unsupported',
      filename,
      size: formatFileSize(buffer.length),
      mimeType,
      filePath,
      aiContent: `📎 收到文件: ${filename} (${formatFileSize(buffer.length)})\n此文件类型暂不支持直接读取内容。`
    }
    
  } catch (error) {
    console.error('   ❌ 处理失败:', error.message)
    return { 
      error: true, 
      message: error.message,
      filename 
    }
  }
}

async function handleImageMessage(client, event) {
  const content = event.content || {}
  const filename = content.filename || content.body || 'image'
  const mxcUrl = content.url
  const encryptedFile = content.file
  const fileInfo = content.info || {}
  
  console.log('\n📋 图片消息完整内容:')
  console.log(JSON.stringify(content, null, 2))
  
  if (!mxcUrl && !encryptedFile) {
    return { error: true, message: 'No media URL found in image message' }
  }
  
  try {
    let buffer
    
    if (encryptedFile) {
      console.log('\n🔐 处理加密图片...')
      if (client.crypto && client.crypto.decryptMedia) {
        buffer = await client.crypto.decryptMedia(encryptedFile)
        console.log('   ✅ 解密成功! 大小:', buffer.length, 'bytes')
      } else {
        throw new Error('Crypto client not available')
      }
    } else {
      const result = await downloadMatrixMedia(client, mxcUrl, filename)
      buffer = result.buffer
    }
    
    ensureMediaDir()
    const filePath = path.join(MATRIX_MEDIA_DOWNLOAD_PATH, filename)
    fs.writeFileSync(filePath, buffer)
    console.log('   保存到:', filePath)
    
    const base64 = buffer.toString('base64')
    const mimeType = fileInfo.mimetype || 'image/png'
    
    return {
      type: 'image',
      filename,
      size: formatFileSize(buffer.length),
      mimeType,
      width: fileInfo.w,
      height: fileInfo.h,
      filePath,
      base64,
      imageData: `data:${mimeType};base64,${base64}`,
      aiContent: `🖼️ 收到图片: ${filename} (${fileInfo.w || '?'}x${fileInfo.h || '?'})\n\n图片已保存，大小: ${formatFileSize(buffer.length)}`
    }
    
  } catch (error) {
    console.error('   ❌ 图片处理失败:', error.message)
    return { 
      error: true, 
      message: error.message,
      filename,
      aiContent: `❌ 图片处理失败: ${error.message}`
    }
  }
}

export {
  downloadMatrixMedia,
  handleFileMessage,
  handleImageMessage,
  formatFileSize
}