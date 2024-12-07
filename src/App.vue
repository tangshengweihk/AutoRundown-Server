<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import * as XLSX from 'xlsx'
import { API_CONFIG } from './config'

const fileInput = ref(null)
const tableData = ref([])
const tableHeaders = ref([])
const sheets = ref([])
const currentSheet = ref('')
const currentRole = ref('无')
const roles = ['无', '字幕', '音控', '放像']
const selectedRowIndex = ref(null)
const timer = ref(null)
const currentTime = ref(0)
const countdownDisplay = ref('')
const isTimerRunning = ref(false)
const isAutoMode = ref(true)

// 添加节流控制
const lastRequestTime = ref(0)
const THROTTLE_DELAY = 300 // 300毫秒的节流延迟

// 添加服务器状态监控
const serverStatus = ref({})

const triggerFileInput = () => {
  fileInput.value.click()
}

const roleColumns = {
  '字幕': 6,
  '音控': 7,
  '放像': 8,
  '无': null
}

const loadSheet = (workbook, sheetName) => {
  const sheet = workbook.Sheets[sheetName]
  const options = {
    header: 1,
    raw: false,
    dateNF: 'HH:mm:ss',
    defval: ''
  }
  
  const rawData = XLSX.utils.sheet_to_json(sheet, options)
  
  if (rawData.length > 0) {
    tableHeaders.value = [
      '序号',
      '开始时间',
      '结束时间',
      '时长',
      '副标题',
      '内容',
      '字幕包装',
      '音控',
      '放像',
      '备注'
    ]
    
    tableData.value = rawData.slice(1).map(row => {
      const limitedRow = row.slice(0, 10)
      return {
        data: limitedRow.map((cell, index) => cell || '')
      }
    })
  }
}

const handleSheetChange = (event) => {
  const selectedSheet = event.target.value
  currentSheet.value = selectedSheet
  loadSheet(window.currentWorkbook, selectedSheet)
}

const handleFileChange = (event) => {
  const file = event.target.files[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (e) => {
    const data = new Uint8Array(e.target.result)
    const workbook = XLSX.read(data, { type: 'array' })
    
    // 保存workbook引用以便切换sheet时使用
    window.currentWorkbook = workbook
    
    // 获取所有工作表名称
    sheets.value = workbook.SheetNames
    
    // 默认选择第一个工作表
    if (sheets.value.length > 0) {
      currentSheet.value = sheets.value[0]
      loadSheet(workbook, currentSheet.value)
    }
  }
  
  reader.readAsArrayBuffer(file)
}

// 修改解析时间函数,支持时:分:秒格式
const parseTime = (timeStr) => {
  if (!timeStr) return 0
  const parts = timeStr.split(':').map(Number)
  if (parts.length === 3) {
    // 时:分:秒 格式
    const [hours, minutes, seconds] = parts
    return hours * 3600 + minutes * 60 + seconds
  } else if (parts.length === 2) {
    // 分:秒 格式
    const [minutes, seconds] = parts
    return minutes * 60 + seconds
  }
  return 0
}

// 修改格式化函数,支持时:分:秒格式
const formatTime = (totalSeconds) => {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

// 修改处理行点击事件
const handleRowClick = async (index) => {
  // 如果点击的是同一行,则不重复处理
  if (selectedRowIndex.value === index) {
    return
  }

  // 添加节流控制
  const now = Date.now()
  if (now - lastRequestTime.value < THROTTLE_DELAY) {
    console.log('请求太频繁，已跳过')
    return
  }
  lastRequestTime.value = now

  if (timer.value) {
    clearInterval(timer.value)
  }
  
  selectedRowIndex.value = index
  const duration = parseTime(tableData.value[index].data[3])
  
  // 添加调试日志
  console.log('正在发送同步请求多个目标')
  
  // 向所有目标发送高亮同步请求
  try {
    const requests = API_CONFIG.targets.map(target => {
      if (!serverStatus.value[target]) {
        console.log(`${target} 服务器不可用，跳过请求`)
        return null
      }
      
      return fetch(`${target}/highlight`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_CONFIG.apiKey
        },
        body: JSON.stringify({ rowIndex: index }),
        signal: AbortSignal.timeout(2000)
      }).catch(err => {
        console.error(`发送到 ${target} 失败:`, err)
        return null
      })
    })
    
    // 并行发送所有请求，但不等待结果
    Promise.allSettled(requests).then(responses => {
      responses.forEach((response, i) => {
        if (response.status === 'fulfilled' && response.value) {
          console.log(`${API_CONFIG.targets[i]} 同步成功`)
        }
      })
    })
    
  } catch (error) {
    console.error('同步高亮失败:', error)
  }

  // 处理计时器逻辑
  if (duration > 0) {
    currentTime.value = duration
    countdownDisplay.value = formatTime(currentTime.value)
    isTimerRunning.value = true
    
    // 添加调试日志
    console.log('计时器状态:', {
      duration,
      currentTime: currentTime.value,
      isTimerRunning: isTimerRunning.value,
      countdownDisplay: countdownDisplay.value
    })
    
    if (timer.value) {
      clearInterval(timer.value)  // 清除旧的计时器
    }
    
    timer.value = setInterval(() => {
      currentTime.value--
      countdownDisplay.value = formatTime(currentTime.value)
      console.log('计时更新:', countdownDisplay.value)  // 添加调试日志
      
      if (currentTime.value <= 0) {
        clearInterval(timer.value)
        isTimerRunning.value = false
        // 只在自动模式下自动跳转到下一行
        if (isAutoMode.value && selectedRowIndex.value < tableData.value.length - 1) {
          handleRowClick(selectedRowIndex.value + 1)
        }
      }
    }, 1000)
  } else {
    // 只在自动模式下自动跳转到下一行
    if (isAutoMode.value && index < tableData.value.length - 1) {
      handleRowClick(index + 1)
    }
  }
}

// 添加服务器状态检查
const checkServerStatus = async (url) => {
  try {
    const response = await fetch(`${url}/api/status`, {
      method: 'GET',
      headers: {
        'X-API-Key': API_CONFIG.apiKey
      },
      timeout: 2000  // 2秒超时
    })
    return response.ok
  } catch {
    return false
  }
}

const updateServerStatus = async () => {
  for (const target of API_CONFIG.targets) {
    serverStatus.value[target] = await checkServerStatus(target)
  }
}

// 定期检查服务器状态
onMounted(() => {
  updateServerStatus()
  setInterval(updateServerStatus, 30000)  // 每30秒检查一次
})

// 组件卸载时清理计时器
onUnmounted(() => {
  if (timer.value) {
    clearInterval(timer.value)
  }
})
</script>

<template>
  <div>
    <div v-if="isTimerRunning" 
         class="countdown"
         :class="{ 'countdown-warning': currentTime <= 10, 'countdown-normal': currentTime > 10 }"
         style="display: block !important;">
      {{ countdownDisplay }}
    </div>
    
    <div class="controls">
      <select 
        v-if="sheets.length" 
        v-model="currentSheet" 
        @change="handleSheetChange"
        class="sheet-select"
      >
        <option v-for="sheet in sheets" :key="sheet" :value="sheet">
          {{ sheet }}
        </option>
      </select>
      <select 
        v-if="tableData.length"
        v-model="currentRole"
        class="role-select"
      >
        <option v-for="role in roles" :key="role" :value="role">
          {{ role }}
        </option>
      </select>
      
      <div class="mode-switch">
        <label class="switch">
          <input type="checkbox" v-model="isAutoMode">
          <span class="slider round"></span>
        </label>
        <span class="mode-label">{{ isAutoMode ? '自动' : '手动' }}</span>
      </div>

      <button @click="triggerFileInput">选择 Excel 文件</button>
    </div>

    <input 
      type="file" 
      ref="fileInput" 
      style="display: none" 
      accept=".xlsx, .xls" 
      @change="handleFileChange"
    >

    <div v-if="tableData.length" 
         class="table-container"
         ref="tableContainer">
      <table>
        <thead>
          <tr>
            <th>序号</th>
            <th>开始时间</th>
            <th>结束时间</th>
            <th>时长</th>
            <th>副标题</th>
            <th>内容</th>
            <th>字幕包装</th>
            <th>音控</th>
            <th>放像</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in tableData" 
              :key="rowIndex"
              :class="{ 'active-row': rowIndex === selectedRowIndex }"
              @click="handleRowClick(rowIndex)">
            <td v-for="(cell, cellIndex) in row.data" 
                :key="cellIndex"
                :class="{
                  'highlight-cell': currentRole !== '无' && 
                                   cellIndex === roleColumns[currentRole] &&
                                   rowIndex === selectedRowIndex
                }">
              {{ cell }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  gap: 20px;
  align-items: center;
  justify-content: center;
  background: rgba(40, 40, 40, 0.4);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  padding: 16px;
  border-radius: 12px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
  min-height: 60px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  max-width: 500px;
  margin: 0 auto;
}

button {
  padding: 10px 20px;
  background: linear-gradient(145deg, #4CAF50, #45a049);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.3s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

button:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.sheet-select, .role-select {
  padding: 10px 16px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(40, 40, 40, 0.6);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s ease;
  min-width: 120px;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.sheet-select:hover, .role-select:hover {
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(50, 50, 50, 0.7);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

body {
  background-color: #000 !important;
}

.table-container {
  width: 100%;
  max-width: 1600px;
  margin: 1rem auto;
  overflow-x: auto;
  overflow-y: scroll;
  height: calc(100vh - 200px);
  position: relative;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 0;
}

tbody tr {
  height: 50px;
}

thead {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #2c5282;
}

th:nth-child(1) { width: 5%; }
th:nth-child(2) { width: 8%; }
th:nth-child(3) { width: 8%; }
th:nth-child(4) { width: 6%; }
th:nth-child(5) { width: 10%; }
th:nth-child(6) { width: 22%; }
th:nth-child(7) { width: 13%; }
th:nth-child(8) { width: 11%; }
th:nth-child(9) { width: 11%; }
th:nth-child(10) { width: 6%; }

thead th {
  padding: 15px 8px;
  color: #fff;
  font-weight: 600;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

tbody tr:nth-child(odd) {
  background-color: rgba(60, 60, 60, 0.6);
}

tbody tr:nth-child(even) {
  background-color: rgba(50, 50, 50, 0.6);
}

td {
  padding: 12px 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.9);
  text-align: center;
  white-space: normal;
  word-break: break-word;
  min-height: 40px;
  max-height: none;
  vertical-align: middle;
}

.active-row {
  background: rgba(146, 45, 35, 0.8) !important;
}

.highlight-cell {
  background: rgba(255, 69, 58, 1) !important;
  color: #ffffff !important;
  font-weight: bold;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  box-shadow: 
    inset 0 0 20px rgba(255, 255, 255, 0.2), 
    0 0 15px rgba(255, 69, 58, 0.6);
  border: 2px solid rgba(255, 255, 255, 0.3);
  transform: scale(1.05);
  transition: all 0.3s ease;
}

tbody tr:not(.active-row):hover {
  background-color: rgba(70, 70, 70, 0.8);
}

@keyframes highlight {
  0% { 
    background: linear-gradient(90deg, rgba(231, 76, 60, 0.4), rgba(192, 57, 43, 0.3));
  }
  50% { 
    background: linear-gradient(90deg, rgba(231, 76, 60, 0.5), rgba(192, 57, 43, 0.4));
  }
  100% { 
    background: linear-gradient(90deg, rgba(231, 76, 60, 0.4), rgba(192, 57, 43, 0.3));
  }
}

@keyframes cell-highlight {
  0% { 
    background: linear-gradient(145deg, #1890ff, #096dd9);
  }
  50% { 
    background: linear-gradient(145deg, #096dd9, #1890ff);
  }
  100% { 
    background: linear-gradient(145deg, #1890ff, #096dd9);
  }
}

@media (max-width: 768px) {
  .controls {
    flex-direction: column;
    padding: 12px;
  }
  
  .sheet-select, .role-select {
    width: 100%;
  }
  
  .table-container {
    padding: 8px;
    height: calc(100vh - 180px);
  }
}

.file-select {
  padding: 16px;
}

.centered {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 90vh;
}

/* 修改第一行第一个单元格为直角 */
tr:first-child td:first-child {
  border-top-left-radius: 0;
}

/* 修改最后一行第一个单元格为直角 */
tr:last-child td:first-child {
  border-bottom-left-radius: 0;
}

/* 确保所有角都是直角 */
tr:first-child td:first-child,
tr:first-child td:last-child,
tr:last-child td:first-child,
tr:last-child td:last-child {
  border-radius: 0;
}

/* 移除单元格的圆角 */
td {
  border-radius: 0 !important;
}

/* 如果需要显示省略号，可以使用这个样式 */
td.truncate {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 确保合并的单元格样式正确 */
th[colspan] {
  text-align: center;
}

.countdown {
  position: fixed;
  top: 85%;
  left: 50%;
  transform: translateX(-50%);
  font-size: 48px;
  font-weight: bold;
  color: #fff;
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
  background: rgba(0, 0, 0, 0.5);
  padding: 20px 40px;
  border-radius: 15px;
  z-index: 1000;
  backdrop-filter: blur(5px);
  border: 2px solid rgba(255, 255, 255, 0.2);
  display: block !important;
  opacity: 1 !important;
}

.countdown-normal {
  transform: translateX(-50%) scale(1);
}

.countdown-warning {
  color: #ff3b30;
  animation: warning-pulse 1s infinite;
}

@keyframes warning-pulse {
  0% {
    transform: translateX(-50%) scale(1);
    text-shadow: 0 0 10px rgba(255, 59, 48, 0.5);
  }
  50% {
    transform: translateX(-50%) scale(1.05);
    text-shadow: 0 0 20px rgba(255, 59, 48, 0.8);
  }
  100% {
    transform: translateX(-50%) scale(1);
    text-shadow: 0 0 10px rgba(255, 59, 48, 0.5);
  }
}

/* 确保高亮格子的动画效果 */
.active-row td {
  transition: all 0.3s ease;
}

/* 添加开关样式 */
.mode-switch {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mode-label {
  color: #fff;
  font-size: 14px;
}

.switch {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: .4s;
  border-radius: 24px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .4s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: #4CAF50;
}

input:checked + .slider:before {
  transform: translateX(26px);
}
</style>
