<template>
  <div class="add-form">
    <div class="form-fields">
      <input
        v-model="formData.term"
        type="text"
        placeholder="术语（必填）*"
        class="input-field"
        @keyup.enter="handleAdd"
      />
      <input
        v-model="formData.definition"
        type="text"
        placeholder="定义（必填）*"
        class="input-field"
        @keyup.enter="handleAdd"
      />
      <input
        v-model="formData.category"
        type="text"
        placeholder="分类（可选）"
        class="input-field"
        @keyup.enter="handleAdd"
      />
    </div>
    <button @click="handleAdd" class="btn-add" :disabled="!canAdd">+ 添加</button>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  currentCategory: {
    type: String,
    default: ''
  }
})

const formData = ref({ term: '', definition: '', category: props.currentCategory })

const emit = defineEmits(['add'])

// 当 currentCategory 变化时，更新 formData.category（仅在 category 为空时）
watch(() => props.currentCategory, (newCat) => {
  if (!formData.value.category) {
    formData.value.category = newCat
  }
})

const canAdd = computed(() => {
  return formData.value.term.trim() && formData.value.definition.trim()
})

function handleAdd() {
  if (!canAdd.value) return
  emit('add', {
    term: formData.value.term.trim(),
    definition: formData.value.definition.trim(),
    category: formData.value.category.trim() || undefined
  })
  formData.value = { term: '', definition: '', category: props.currentCategory }
}
</script>

<style scoped>
.add-form {
  display: flex;
  gap: 1rem;
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: var(--color-surface);
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.form-fields {
  display: flex;
  gap: 1rem;
  flex: 1;
}

.input-field {
  flex: 1;
  padding: 0.75rem;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 0.875rem;
}

.input-field::placeholder {
  color: var(--color-muted);
}

.btn-add {
  padding: 0.75rem 2rem;
  background: var(--color-orange);
  color: var(--color-bg);
  border: none;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn-add:hover:not(:disabled) {
  background: #e68a00;
}

.btn-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
