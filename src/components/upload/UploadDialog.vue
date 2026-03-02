<template>
  <Transition name="fade">
    <div v-if="visible" class="dialog-overlay" @click="$emit('cancel')">
      <div class="dialog" @click.stop>
        <div class="dialog-header">
          <h3>上传会议录音</h3>
        </div>
        <div class="dialog-body">
          <div class="form-group">
            <label>会议名称</label>
            <input
              v-model="localTitle"
              type="text"
              placeholder="请输入会议名称"
              class="form-input"
            />
          </div>
          <div class="form-group">
            <label>会议类型</label>
            <select v-model="localType" class="form-select">
              <option v-for="type in meetingTypes" :key="type.value" :value="type.value">
                {{ type.label }}
              </option>
            </select>
          </div>
          <div class="form-group">
            <label>选择的文件</label>
            <ul class="file-list">
              <li v-for="(file, index) in files" :key="index">{{ file.name }}</li>
            </ul>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn btn-secondary" @click="$emit('cancel')" :disabled="uploading">
            取消
          </button>
          <button class="btn btn-primary" @click="handleUpload" :disabled="uploading || !canUpload">
            {{ uploading ? '上传中...' : '开始上传' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  visible: Boolean,
  files: Array,
  uploading: Boolean
})

const emit = defineEmits(['upload', 'cancel'])

const localTitle = ref('')
const localType = ref('general')

const meetingTypes = [
  { value: 'general', label: '一般会议' },
  { value: 'weekly', label: '周会' },
  { value: 'tech', label: '技术讨论' },
  { value: 'customer', label: '客户会议' }
]

const canUpload = computed(() => {
  return localTitle.value.trim().length > 0
})

watch(() => props.visible, (visible) => {
  if (!visible) {
    localTitle.value = ''
    localType.value = 'general'
  }
})

function handleUpload() {
  if (!canUpload.value) return
  emit('upload', {
    title: localTitle.value.trim(),
    type: localType.value
  })
}
</script>

<style scoped>
.dialog-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.6); display: flex; align-items: center; justify-content: center; z-index: 10000; }
.dialog { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; min-width: 500px; max-width: 600px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); }
.dialog-header { padding: 1.5rem; border-bottom: 1px solid var(--color-border); }
.dialog-header h3 { margin: 0; color: var(--color-text); font-size: 1.25rem; }
.dialog-body { padding: 1.5rem; }
.form-group { margin-bottom: 1.5rem; }
.form-group:last-child { margin-bottom: 0; }
.form-group label { display: block; color: var(--color-text); font-size: 0.875rem; margin-bottom: 0.5rem; font-weight: 500; }
.form-input, .form-select { width: 100%; padding: 0.75rem; background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 4px; font-family: inherit; font-size: 1rem; }
.form-input:focus, .form-select:focus { outline: none; border-color: var(--color-orange); }
.file-list { list-style: none; padding: 0; margin: 0; max-height: 150px; overflow-y: auto; }
.file-list li { padding: 0.5rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 4px; margin-bottom: 0.5rem; color: var(--color-text); font-size: 0.875rem; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 0.75rem; padding: 1rem 1.5rem; border-top: 1px solid var(--color-border); }
.btn { padding: 0.75rem 1.5rem; border: none; border-radius: 4px; font-size: 0.875rem; font-weight: 500; cursor: pointer; transition: all 0.2s; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { background: transparent; color: var(--color-text); border: 1px solid var(--color-border); }
.btn-secondary:hover:not(:disabled) { background: rgba(255, 255, 255, 0.05); }
.btn-primary { background: var(--color-orange); color: white; }
.btn-primary:hover:not(:disabled) { background: #e68900; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
