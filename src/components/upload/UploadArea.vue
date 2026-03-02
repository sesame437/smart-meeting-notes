<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api'
import { useUIStore } from '@/stores/ui'
import UploadDialog from './UploadDialog.vue'

const router = useRouter()
const uiStore = useUIStore()

const dragging = ref(false)
const uploading = ref(false)
const selectedFiles = ref([])
const showMetadataDialog = ref(false)

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
  showMetadataDialog.value = false
}

async function startUpload(metadata) {
  uploading.value = true
  try {
    const formData = new FormData()
    selectedFiles.value.forEach((file) => {
      formData.append('file', file)
    })
    formData.append('meetingType', metadata.type)
    formData.append('title', metadata.title)

    const result = await api.uploadFile('/meetings/upload', formData)
    uiStore.showToast('上传成功，正在处理...', 'success')
    showMetadataDialog.value = false
    selectedFiles.value = []

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

    <UploadDialog
      :visible="showMetadataDialog"
      :files="selectedFiles"
      :uploading="uploading"
      @upload="startUpload"
      @cancel="cancelUpload"
    />
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
</style>
