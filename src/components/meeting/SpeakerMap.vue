<template>
  <div class="speaker-map">
    <h3>说话人映射</h3>
    <p class="description">将转录中的说话人标签映射为真实姓名</p>

    <div v-if="!speakerMap || Object.keys(speakerMap).length === 0" class="empty-state">
      暂无说话人映射
    </div>

    <div v-else class="mapping-list">
      <div v-for="(realName, rawLabel) in localMap" :key="rawLabel" class="speaker-card">
        <div class="keypoints-column">
          <h4>{{ rawLabel }} 发言要点</h4>
          <ul v-if="getKeypoints(rawLabel).length > 0" class="keypoints-list">
            <li v-for="(point, idx) in getKeypoints(rawLabel)" :key="idx">{{ point }}</li>
          </ul>
          <p v-else class="no-keypoints">暂无发言摘要</p>
        </div>
        <div class="mapping-column">
          <SpeakerRow
            :raw-label="rawLabel"
            :real-name="realName"
            :is-editing="editingKey === rawLabel"
            @edit="startEdit(rawLabel)"
            @save="(name) => saveEdit(rawLabel, name)"
            @cancel="cancelEdit"
          />
        </div>
      </div>
    </div>

    <div v-if="saving" class="saving-indicator">保存中...</div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { api } from '@/api'
import SpeakerRow from './SpeakerRow.vue'

const props = defineProps({
  meetingId: {
    type: String,
    required: true
  },
  speakerMap: {
    type: Object,
    default: () => ({})
  },
  meeting: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update'])

const localMap = ref({ ...props.speakerMap })
const editingKey = ref(null)
const saving = ref(false)

watch(() => props.speakerMap, (newMap) => {
  localMap.value = { ...newMap }
}, { deep: true })

function getKeypoints(rawLabel) {
  const keypoints = props.meeting?.content?.speakerKeypoints
  if (!keypoints || !keypoints[rawLabel]) return []
  return keypoints[rawLabel].slice(0, 3)
}

function startEdit(rawLabel) {
  editingKey.value = rawLabel
}

function cancelEdit() {
  editingKey.value = null
}

async function saveEdit(rawLabel, newName) {
  saving.value = true
  try {
    const updatedMap = { ...localMap.value }
    updatedMap[rawLabel] = newName

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
  gap: 1.5rem;
}

.speaker-card {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  padding: 1rem;
  background: var(--color-bg);
  border-radius: 4px;
  border: 1px solid var(--color-border);
}

.keypoints-column h4 {
  margin: 0 0 0.75rem 0;
  color: var(--color-orange);
  font-size: 0.9rem;
}

.keypoints-list {
  list-style: disc inside;
  margin: 0;
  padding: 0;
  color: var(--color-text);
  font-size: 0.875rem;
  line-height: 1.6;
}

.keypoints-list li {
  margin-bottom: 0.5rem;
}

.no-keypoints {
  margin: 0;
  color: var(--color-muted);
  font-size: 0.875rem;
  font-style: italic;
}

.mapping-column {
  display: flex;
  align-items: center;
}

.saving-indicator {
  margin-top: 1rem;
  padding: 0.5rem;
  text-align: center;
  color: var(--color-orange);
  font-size: 0.875rem;
}
</style>
