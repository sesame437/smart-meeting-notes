<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api'
import { useUIStore } from '@/stores/ui'

const router = useRouter()
const uiStore = useUIStore()

const dragging = ref(false)
const uploading = ref(false)
const selectedFiles = ref([])
const showMetadataDialog = ref(false)
const meetingType = ref('general')
const meetingTitle = ref('')

const meetingTypes = [
  { value: 'general', label: '一般会议' },
  { value: 'weekly', label: '周会' },
  { value: 'tech', label: '技术讨论' },
  { value: 'customer', label: '客户会议' }
]

function handleFileSelect(event) {
  const files = Array.from(event.target.files)
  if (files.length > 0) {
    selectedFiles.value = files
    showMetadataDialog.value = true
  }
}

function handleDrop(event) {
  dragging.value = false
  const files = Array.from(event.dataTransfer.files).filter(file => {
    const ext = file.name.split('.').pop().toLowerCase()
    return ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'mp4'].includes(ext)
  })
  if (files.length > 0) {
    selectedFiles.value = files
    showMetadataDialog.value = true
  } else {
    uiStore.showToast('请上传音频文件', 'error')
  }
}

function cancelUpload() {
  selectedFiles.value = []
  meetingTitle.value = ''
  meetingType.value = 'general'
  showMetadataDialog.value = false
}

async function startUpload() {
  if (!meetingTitle.value.trim()) {
    uiStore.showToast('请输入会议名称', 'error')
    return
  }

  uploading.value = true
  try {
    const formData = new FormData()
    selectedFiles.value.forEach((file, index) => {
      formData.append('file', file)
    })
    formData.append('meetingType', meetingType.value)
    formData.append('title', meetingTitle.value.trim())

    const result = await api.uploadFile('/meetings/upload', formData)
    uiStore.showToast('上传成功，正在处理...', 'success')
    showMetadataDialog.value = false
    selectedFiles.value = []
    meetingTitle.value = ''
    meetingType.value = 'general'

    if (result.meetingId) {
      router.push(`/meetings/${result.meetingId}`)
    }
  } catch (err) {
    uiStore.showToast('上传失败: ' + err.message, 'error')
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="upload-container">
    <div
      class="upload-area"
      :class="{ dragging }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="handleDrop"
    >
      <div class="upload-icon">🎤</div>
      <p class="upload-text">拖拽音频文件到此处，或点击选择文件</p>
      <p class="upload-hint">支持格式：MP3、WAV、M4A、OGG、WEBM、MP4</p>
      <input
        type="file"
        ref="fileInput"
        accept=".mp3,.wav,.m4a,.ogg,.webm,.mp4"
        multiple
        @change="handleFileSelect"
        style="display: none"
      />
      <button class="btn-upload" @click="$refs.fileInput.click()">选择文件</button>
    </div>

    <!-- 元数据弹窗 -->
    <Transition name="fade">
      <div v-if="showMetadataDialog" class="dialog-overlay" @click="cancelUpload">
        <div class="dialog" @click.stop>
          <div class="dialog-header">
            <h3>上传会议录音</h3>
          </div>
          <div class="dialog-body">
            <div class="form-group">
              <label>会议名称</label>
              <input
                v-model="meetingTitle"
                type="text"
                placeholder="请输入会议名称"
                class="form-input"
              />
            </div>
            <div class="form-group">
              <label>会议类型</label>
              <select v-model="meetingType" class="form-select">
                <option v-for="type in meetingTypes" :key="type.value" :value="type.value">
                  {{ type.label }}
                </option>
              </select>
            </div>
            <div class="form-group">
              <label>选择的文件</label>
              <ul class="file-list">
                <li v-for="(file, index) in selectedFiles" :key="index">{{ file.name }}</li>
              </ul>
            </div>
          </div>
          <div class="dialog-actions">
            <button class="btn btn-secondary" @click="cancelUpload" :disabled="uploading">
              取消
            </button>
            <button class="btn btn-primary" @click="startUpload" :disabled="uploading">
              {{ uploading ? '上传中...' : '开始上传' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.upload-container {
  margin: 2rem 0;
}

.upload-area {
  border: 2px dashed var(--color-border);
  border-radius: 8px;
  padding: 3rem 2rem;
  text-align: center;
  background: var(--color-surface);
  transition: all 0.3s;
  cursor: pointer;
}

.upload-area.dragging {
  border-color: var(--color-orange);
  background: rgba(255, 153, 0, 0.05);
}

.upload-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.upload-text {
  color: var(--color-text);
  font-size: 1.125rem;
  margin-bottom: 0.5rem;
}

.upload-hint {
  color: var(--color-muted);
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
}

.btn-upload {
  padding: 0.75rem 2rem;
  background: var(--color-orange);
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-upload:hover {
  background: #e68900;
}

.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.dialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  min-width: 500px;
  max-width: 600px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.dialog-header {
  padding: 1.5rem;
  border-bottom: 1px solid var(--color-border);
}

.dialog-header h3 {
  margin: 0;
  color: var(--color-text);
  font-size: 1.25rem;
}

.dialog-body {
  padding: 1.5rem;
}

.form-group {
  margin-bottom: 1.5rem;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  color: var(--color-text);
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.form-input,
.form-select {
  width: 100%;
  padding: 0.75rem;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
}

.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: var(--color-orange);
}

.file-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 150px;
  overflow-y: auto;
}

.file-list li {
  padding: 0.5rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  margin-bottom: 0.5rem;
  color: var(--color-text);
  font-size: 0.875rem;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
}

.btn {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: transparent;
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
}

.btn-primary {
  background: var(--color-orange);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #e68900;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
