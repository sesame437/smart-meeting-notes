<template>
  <div class="mapping-item">
    <div v-if="!isEditing" class="item-display" @click="$emit('edit')">
      <span class="label">{{ rawLabel }}</span>
      <span class="arrow">→</span>
      <span class="name">{{ realName }}</span>
    </div>

    <div v-else class="item-edit">
      <input type="text" :value="rawLabel" disabled class="input-label" />
      <span class="arrow">→</span>
      <input
        type="text"
        v-model="localName"
        placeholder="真实姓名"
        class="input-name"
      />
      <div class="edit-actions">
        <button @click="handleSave" class="btn-save">保存</button>
        <button @click="$emit('cancel')" class="btn-cancel">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  rawLabel: {
    type: String,
    required: true
  },
  realName: {
    type: String,
    required: true
  },
  isEditing: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['edit', 'save', 'cancel'])

const localName = ref(props.realName)

watch(() => props.realName, (newName) => {
  localName.value = newName
})

function handleSave() {
  if (!localName.value.trim()) {
    alert('请输入真实姓名')
    return
  }
  emit('save', localName.value.trim())
}
</script>

<style scoped>
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
</style>
