<template>
  <div class="list-item">
    <div v-if="!isEditing" class="item-display" @click="$emit('edit')">
      <div v-for="field in fields" :key="field.key" class="field-display">
        <span class="field-label">{{ field.label }}:</span>
        <span class="field-value">{{ item[field.key] || '-' }}</span>
      </div>
    </div>

    <div v-else class="item-edit">
      <div v-for="field in fields" :key="field.key" class="field-edit">
        <label>{{ field.label }}:</label>
        <input
          v-if="field.type === 'text'"
          v-model="localData[field.key]"
          type="text"
          :placeholder="field.label"
        />
        <textarea
          v-else
          v-model="localData[field.key]"
          :placeholder="field.label"
          rows="3"
        />
      </div>
      <div class="edit-actions">
        <button @click="handleSave" class="btn-save">保存</button>
        <button @click="$emit('cancel')" class="btn-cancel">取消</button>
        <button @click="$emit('delete')" class="btn-delete">删除</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  item: Object,
  fields: Array,
  isEditing: Boolean
})

const emit = defineEmits(['edit', 'save', 'cancel', 'delete'])

const localData = ref({ ...props.item })

watch(() => props.item, (newItem) => {
  localData.value = { ...newItem }
}, { deep: true })

function handleSave() {
  emit('save', { ...localData.value })
}
</script>

<style scoped>
.list-item {
  margin-bottom: 1rem;
}

.item-display {
  padding: 1rem;
  background: var(--color-surface);
  border-radius: 4px;
  border: 1px solid var(--color-border);
  cursor: pointer;
  transition: all 0.2s;
}

.item-display:hover {
  background: #1f2937;
  border-color: var(--color-orange);
}

.field-display {
  margin-bottom: 0.5rem;
}

.field-display:last-child {
  margin-bottom: 0;
}

.field-label {
  color: var(--color-muted);
  font-size: 0.875rem;
  margin-right: 0.5rem;
}

.field-value {
  color: var(--color-text);
}

.item-edit {
  padding: 1rem;
  background: var(--color-surface);
  border-radius: 4px;
  border: 1px solid var(--color-orange);
}

.field-edit {
  margin-bottom: 1rem;
}

.field-edit label {
  display: block;
  color: var(--color-muted);
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
}

.field-edit input,
.field-edit textarea {
  width: 100%;
  padding: 0.5rem;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.875rem;
}

.field-edit textarea {
  resize: vertical;
}

.edit-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
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

.btn-delete {
  background: var(--color-danger);
  color: white;
}

.btn-delete:hover {
  background: #b71c1c;
}
</style>
