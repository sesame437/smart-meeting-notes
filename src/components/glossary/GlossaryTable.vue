<template>
  <div class="glossary-table">
    <table>
      <thead>
        <tr>
          <th>术语</th>
          <th>定义</th>
          <th>分类</th>
          <th class="actions-col">操作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="item in items" :key="item.termId">
          <tr v-if="editingId !== item.termId" class="row-display">
            <td>{{ item.term }}</td>
            <td>{{ item.definition }}</td>
            <td>{{ item.category || '-' }}</td>
            <td class="actions-col">
              <button @click="startEdit(item)" class="btn-icon btn-edit" title="编辑">✏️</button>
              <button @click="$emit('delete', item)" class="btn-icon btn-delete" title="删除">🗑️</button>
            </td>
          </tr>

          <tr v-else class="row-edit">
            <td colspan="4">
              <div class="edit-form">
                <div class="edit-fields">
                  <input v-model="editingData.term" type="text" placeholder="术语" class="input-field" />
                  <input v-model="editingData.definition" type="text" placeholder="定义" class="input-field" />
                  <input v-model="editingData.category" type="text" placeholder="分类" class="input-field" />
                </div>
                <div class="edit-actions">
                  <button @click="saveEdit" class="btn-save">保存</button>
                  <button @click="cancelEdit" class="btn-cancel">取消</button>
                </div>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  items: {
    type: Array,
    required: true
  }
})

const emit = defineEmits(['update', 'delete'])

const editingId = ref(null)
const editingData = ref({ term: '', definition: '', category: '' })

function startEdit(item) {
  editingId.value = item.termId
  editingData.value = { term: item.term, definition: item.definition, category: item.category || '' }
}

function cancelEdit() {
  editingId.value = null
  editingData.value = { term: '', definition: '', category: '' }
}

function saveEdit() {
  if (!editingData.value.term.trim() || !editingData.value.definition.trim()) {
    alert('术语和定义不能为空')
    return
  }

  emit('update', {
    termId: editingId.value,
    term: editingData.value.term.trim(),
    definition: editingData.value.definition.trim(),
    category: editingData.value.category.trim() || undefined
  })

  cancelEdit()
}
</script>

<style scoped>
.glossary-table { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; background: var(--color-surface); border-radius: 8px; overflow: hidden; }
thead { background: rgba(255, 153, 0, 0.1); }
th { padding: 1rem; text-align: left; color: var(--color-orange); font-weight: 600; font-size: 0.875rem; border-bottom: 2px solid var(--color-border); }
td { padding: 1rem; border-bottom: 1px solid var(--color-border); color: var(--color-text); font-size: 0.875rem; }
.actions-col { width: 100px; text-align: center; }
.row-display:hover { background: rgba(255, 153, 0, 0.05); }
tbody tr:last-child td { border-bottom: none; }
.btn-icon { padding: 0.25rem 0.5rem; background: transparent; border: none; cursor: pointer; font-size: 1rem; transition: transform 0.2s; }
.btn-icon:hover { transform: scale(1.2); }
.row-edit { background: rgba(255, 153, 0, 0.05); }
.edit-form { padding: 1rem; }
.edit-fields { display: flex; gap: 1rem; margin-bottom: 1rem; }
.edit-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
.input-field { flex: 1; padding: 0.5rem; background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 4px; font-size: 0.875rem; }
button { padding: 0.5rem 1rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.875rem; font-weight: 500; transition: all 0.2s; }
.btn-save { background: var(--color-orange); color: var(--color-bg); }
.btn-save:hover { background: #e68a00; }
.btn-cancel { background: var(--color-muted); color: var(--color-bg); }
.btn-cancel:hover { background: #6e7d7e; }
</style>
