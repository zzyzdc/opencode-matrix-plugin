import * as XLSX from 'xlsx'

/**
 * 支持的文件类型
 */
export const SUPPORTED_FILE_TYPES = {
  excel: ['.xlsx', '.xls', '.xlsm', '.xlsb'],
  csv: ['.csv', '.tsv'],
  text: ['.txt', '.md', '.json', '.xml']
}

/**
 * 检查文件是否为 Excel 类型
 */
export function isExcelFile(filename) {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'))
  return SUPPORTED_FILE_TYPES.excel.includes(ext) || SUPPORTED_FILE_TYPES.csv.includes(ext)
}

/**
 * 检查文件是否为支持的类型
 */
export function isSupportedFile(filename) {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'))
  return Object.values(SUPPORTED_FILE_TYPES).flat().includes(ext)
}

/**
 * 获取文件类型
 */
export function getFileType(filename) {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'))
  if (SUPPORTED_FILE_TYPES.excel.includes(ext)) return 'excel'
  if (SUPPORTED_FILE_TYPES.csv.includes(ext)) return 'csv'
  if (SUPPORTED_FILE_TYPES.text.includes(ext)) return 'text'
  return 'unknown'
}

/**
 * 解析 Excel 文件内容
 * @param {Buffer} buffer - 文件 Buffer
 * @param {string} filename - 文件名（用于判断文件类型）
 * @param {object} options - 解析选项
 * @returns {object} 解析结果
 */
export function parseExcel(buffer, filename, options = {}) {
  const {
    maxRows = 100,          // 最大行数限制
    maxSheets = 5,          // 最大工作表数限制
    includeHeaders = true,  // 是否包含表头
    format = 'text'         // 输出格式: 'text', 'json', 'markdown'
  } = options

  try {
    const workbook = XLSX.read(buffer, { 
      type: 'buffer',
      cellDates: true,
      cellText: true
    })

    const result = {
      filename,
      sheetCount: workbook.SheetNames.length,
      sheets: [],
      summary: ''
    }

    const sheetsToProcess = workbook.SheetNames.slice(0, maxSheets)
    const totalRows = { count: 0, truncated: false }

    for (const sheetName of sheetsToProcess) {
      const sheet = workbook.Sheets[sheetName]
      const jsonData = XLSX.utils.sheet_to_json(sheet, { 
        header: includeHeaders ? undefined : 1,
        defval: '',
        raw: false
      })

      // 限制行数
      let sheetData = jsonData
      if (jsonData.length > maxRows) {
        sheetData = jsonData.slice(0, maxRows)
        totalRows.truncated = true
      }
      totalRows.count += sheetData.length

      // 生成表格预览
      let preview = ''
      if (format === 'markdown' || format === 'text') {
        preview = generateTablePreview(sheetData, sheetName, maxRows, jsonData.length)
      }

      result.sheets.push({
        name: sheetName,
        rowCount: jsonData.length,
        columnCount: sheetData.length > 0 ? Object.keys(sheetData[0] || {}).length : 0,
        data: format === 'json' ? sheetData : undefined,
        preview
      })
    }

    // 生成摘要
    result.summary = generateSummary(result, totalRows.truncated)

    return result

  } catch (error) {
    return {
      filename,
      error: true,
      message: `解析 Excel 文件失败: ${error.message}`,
      sheets: [],
      summary: `无法解析文件 ${filename}: ${error.message}`
    }
  }
}

/**
 * 生成表格预览（Markdown 格式）
 */
function generateTablePreview(data, sheetName, maxRows, totalRows) {
  if (!data || data.length === 0) {
    return `### ${sheetName}\n\n(空工作表)\n`
  }

  let preview = `### ${sheetName}\n\n`
  
  // 获取所有列名
  const allKeys = new Set()
  data.forEach(row => {
    if (typeof row === 'object') {
      Object.keys(row).forEach(key => allKeys.add(key))
    }
  })
  const headers = Array.from(allKeys)

  if (headers.length === 0) {
    // 数组格式（无表头）
    preview += '| 行号 | 内容 |\n|------|------|\n'
    data.slice(0, 10).forEach((row, idx) => {
      const content = Array.isArray(row) ? row.join(' | ') : String(row)
      preview += `| ${idx + 1} | ${escapeMarkdown(content)} |\n`
    })
  } else {
    // 对象格式（有表头）
    preview += '| ' + headers.map(escapeMarkdown).join(' | ') + ' |\n'
    preview += '| ' + headers.map(() => '------').join(' | ') + ' |\n'

    data.slice(0, 20).forEach(row => {
      const values = headers.map(h => {
        const val = row[h]
        if (val === null || val === undefined) return ''
        return escapeMarkdown(String(val).substring(0, 50))
      })
      preview += '| ' + values.join(' | ') + ' |\n'
    })
  }

  if (totalRows > maxRows) {
    preview += `\n*...还有 ${totalRows - maxRows} 行未显示*\n`
  }

  return preview
}

/**
 * 生成文件摘要
 */
function generateSummary(result, truncated) {
  const sheets = result.sheets
  const totalRows = sheets.reduce((sum, s) => sum + s.rowCount, 0)
  const totalCols = Math.max(...sheets.map(s => s.columnCount), 0)

  let summary = `📊 **Excel 文件摘要**\n\n`
  summary += `- 文件名: ${result.filename}\n`
  summary += `- 工作表数: ${result.sheetCount}\n`
  summary += `- 总行数: ${totalRows}${truncated ? ' (已截断)' : ''}\n`
  summary += `- 最大列数: ${totalCols}\n\n`

  if (sheets.length > 0) {
    summary += `**工作表列表:**\n`
    sheets.forEach((s, idx) => {
      summary += `${idx + 1}. ${s.name} (${s.rowCount} 行 × ${s.columnCount} 列)\n`
    })
  }

  return summary
}

/**
 * 转义 Markdown 特殊字符
 */
function escapeMarkdown(text) {
  if (typeof text !== 'string') return ''
  return text
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '')
}

/**
 * 解析 CSV 文件
 */
export function parseCSV(buffer, filename, options = {}) {
  const {
    delimiter = ',',
    maxRows = 100
  } = options

  try {
    const text = buffer.toString('utf-8')
    const lines = text.split(/\r?\n/).filter(line => line.trim())
    
    const data = lines.slice(0, maxRows).map(line => {
      // 简单的 CSV 解析（不处理引号内的分隔符）
      return line.split(delimiter).map(cell => cell.trim())
    })

    return {
      filename,
      rowCount: lines.length,
      columnCount: data.length > 0 ? data[0].length : 0,
      data,
      summary: `CSV 文件: ${filename}, ${lines.length} 行, ${data[0]?.length || 0} 列`
    }

  } catch (error) {
    return {
      filename,
      error: true,
      message: `解析 CSV 文件失败: ${error.message}`,
      summary: `无法解析文件 ${filename}: ${error.message}`
    }
  }
}

/**
 * 格式化 Excel 内容为 AI 可读文本
 */
export function formatExcelForAI(parseResult, options = {}) {
  const { includePreview = true, maxPreviewRows = 50 } = options

  if (parseResult.error) {
    return parseResult.summary
  }

  let text = parseResult.summary + '\n\n'

  if (includePreview) {
    text += '---\n\n**数据预览:**\n\n'
    
    for (const sheet of parseResult.sheets) {
      const lines = sheet.preview.split('\n')
      const limitedPreview = lines.slice(0, 60).join('\n')
      text += limitedPreview + '\n'
    }
  }

  return text.substring(0, 10000)
}
