<template>
  <div class="speaker-map">
    <h3>说话人映射</h3>
    <p class="description">将转录中的说话人标签映射为真实姓名</p>

    <div v-if="!speakerMap || Object.keys(speakerMap).length === 0" class="empty-state">
      暂无说话人映射
    </div>

    <div v-else class="mapping-list">
      <div v-for="(realName, rawLabel) in localMap" :key="rawLabel" class="mapping-item">
        <div v-if="editingKey !== rawLabel" class="item-display" @click="startEdit(rawLabel)">
          <span class="label">{{ rawLabel }}</span>
          <span class="arrow">→</span>
          <span class="name">{{ realName }}</span>
        </div>

        <div v-else class="item-edit">
          <input type="text" v-model="editingLabel" disabled class="input-label" />
          <span class="arrow">→</span>
          <input type="text" v-model="editingName" placeholder="真实姓名" class="input-name" />
          <div class="edit-actions">
            <button @click="saveEdit" class="btn-save">保存</button>
            <button @click="cancelEdit" class="btn-cancel">取消</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="saving" class="saving-indicator">保存中...</div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { api } from '@/api'

const props = defineProps({
  meetingId: {
    type: String,
    required: true
  },
  speakerMap: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update'])

const localMap = ref({ ...props.speakerMap })
const editingKey = ref(null)
const editingLabel = ref('')
const editingName = ref('')
const saving = ref(false)

watch(() => props.speakerMap, (newMap) => {
  localMap.value = { ...newMap }
}, { deep: true })

function startEdit(rawLabel) {
  editingKey.value = rawLabel
  editingLabel.value = rawLabel
  editingName.value = localMap.value[rawLabel]
}

function cancelEdit() {
  editingKey.value = null
  editingLabel.value = ''
  editingName.value = ''
}

async function saveEdit() {
  if (!editingName.value.trim()) {
    alert('请输入真实姓名')
    return
  }

  saving.value = true
  try {
    const updatedMap = { ...localMap.value }
    updatedMap[editingKey.value] = editingName.value.trim()

    await api.put(`/meetings/${props.meetingId}/speaker-names`, { speakerMap: updatedMap })

    localMap.value = updatedMap
    emit('update', updatedMap)
    cancelEdit()
  } catch (err) {
    alert('保存失败: ' + err.message)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.speaker-map {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: var(--color-surface);
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

h3 {
  margin: 0 0 0.5rem 0;
  color: var(--color-orange);
  font-size: 1.1rem;
}

.description {
  margin: 0 0 1rem 0;
  color: var(--color-muted);
  font-size: 0.875rem;
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--color-muted);
  background: var(--color-bg);
  border-radius: 4px;
  border: 1px dashed var(--color-border);
}

.mapping-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.mapping-item {
  background: var(--color-bg);
  border-radius: 4px;
  border: 1px solid var(--color-border);
}

.item-display {
  display: flex;
  align-items: center;
  padding: 1rem;
  cursor: pointer;
  transition: all 0.2s;
}

.item-display:hover {
  background: rgba(255, 153, 0, 0.05);
  border-color: var(--color-orange);
}

.label {
  flex: 0 0 120px;
  color: var(--color-muted);
  font-family: monospace;
  font-size: 0.875rem;
}

.arrow {
  flex: 0 0 30px;
  text-align: center;
  color: var(--color-muted);
}

.name {
  flex: 1;
  color: var(--color-text);
  font-weight: 500;
}

.item-edit {
  display: flex;
  align-items: center;
  padding: 1rem;
  gap: 0.5rem;
}

.input-label,
.input-name {
  padding: 0.5rem;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 0.875rem;
}

.input-label {
  flex: 0 0 120px;
  font-family: monospace;
  background: rgba(135, 149, 150, 0.1);
}

.input-name {
  flex: 1;
}

.edit-actions {
  display: flex;
  gap: 0.5rem;
}

button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-save {
  background: var(--color-orange);
  color: var(--color-bg);
}

.btn-save:hover {
  background: #e68a00;
}

.btn-cancel {
  background: var(--color-muted);
  color: var(--color-bg);
}

.btn-cancel:hover {
  background: #6e7d7e;
}

.saving-indicator {
  margin-top: 1rem;
  padding: 0.5rem;
  text-align: center;
  color: var(--color-orange);
  font-size: 0.875rem;
}
</style>
