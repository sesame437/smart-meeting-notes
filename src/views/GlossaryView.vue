<template>
  <div class="glossary-view">
    <h1>词汇表</h1>

    <!-- 添加表单 -->
    <div class="add-form">
      <div class="form-fields">
        <input
          v-model="newTerm.term"
          type="text"
          placeholder="术语（必填）*"
          class="input-field"
          @keyup.enter="addTerm"
        />
        <input
          v-model="newTerm.definition"
          type="text"
          placeholder="定义（必填）*"
          class="input-field"
          @keyup.enter="addTerm"
        />
        <input
          v-model="newTerm.category"
          type="text"
          placeholder="分类（可选）"
          class="input-field"
          @keyup.enter="addTerm"
        />
      </div>
      <button @click="addTerm" class="btn-add" :disabled="!canAdd">+ 添加</button>
    </div>

    <!-- 加载状态 -->
    <div v-if="store.loading" class="loading">加载中...</div>

    <!-- 错误状态 -->
    <div v-else-if="store.error" class="error">{{ store.error }}</div>

    <!-- 词汇表列表 -->
    <div v-else-if="store.items.length > 0" class="glossary-table">
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
          <template v-for="item in store.items" :key="item.termId">
            <!-- 显示模式 -->
            <tr v-if="editingId !== item.termId" class="row-display">
              <td>{{ item.term }}</td>
              <td>{{ item.definition }}</td>
              <td>{{ item.category || '-' }}</td>
              <td class="actions-col">
                <button @click="startEdit(item)" class="btn-icon btn-edit" title="编辑">✏️</button>
                <button @click="deleteItem(item)" class="btn-icon btn-delete" title="删除">🗑️</button>
              </td>
            </tr>

            <!-- 编辑模式 -->
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

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <p>暂无词汇</p>
      <p class="muted">请使用上方表单添加术语和定义</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useGlossaryStore } from '@/stores/glossary'

const store = useGlossaryStore()

const newTerm = ref({ term: '', definition: '', category: '' })
const editingId = ref(null)
const editingData = ref({ term: '', definition: '', category: '' })

const canAdd = computed(() => {
  return newTerm.value.term.trim() && newTerm.value.definition.trim()
})

async function addTerm() {
  if (!canAdd.value) return

  try {
    await store.createTerm(
      newTerm.value.term.trim(),
      newTerm.value.definition.trim(),
      newTerm.value.category.trim() || undefined
    )
    newTerm.value = { term: '', definition: '', category: '' }
  } catch (err) {
    alert('添加失败: ' + err.message)
  }
}

function startEdit(item) {
  editingId.value = item.termId
  editingData.value = { term: item.term, definition: item.definition, category: item.category || '' }
}

function cancelEdit() {
  editingId.value = null
  editingData.value = { term: '', definition: '', category: '' }
}

async function saveEdit() {
  if (!editingData.value.term.trim() || !editingData.value.definition.trim()) {
    alert('术语和定义不能为空')
    return
  }

  try {
    await store.updateTerm(
      editingId.value,
      editingData.value.term.trim(),
      editingData.value.definition.trim(),
      editingData.value.category.trim() || undefined
    )
    cancelEdit()
  } catch (err) {
    alert('保存失败: ' + err.message)
  }
}

async function deleteItem(item) {
  if (!window.confirm(`确定删除术语"${item.term}"吗？`)) return

  try {
    await store.deleteTerm(item.termId)
  } catch (err) {
    alert('删除失败: ' + err.message)
  }
}

onMounted(async () => {
  await store.fetchAll()
})
</script>

<style scoped>
.glossary-view {
  padding: 2rem 0;
}

h1 {
  color: var(--color-orange);
  margin-bottom: 2rem;
}

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

.loading {
  text-align: center;
  color: var(--color-muted);
  padding: 2rem;
}

.error {
  color: var(--color-danger);
  padding: 1rem;
  background: rgba(211, 47, 47, 0.1);
  border-radius: 4px;
}

.empty-state {
  text-align: center;
  padding: 4rem 2rem;
  background: var(--color-surface);
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.empty-state p {
  margin: 0.5rem 0;
}

.muted {
  color: var(--color-muted);
  font-size: 0.875rem;
}

.glossary-table {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  background: var(--color-surface);
  border-radius: 8px;
  overflow: hidden;
}

thead {
  background: rgba(255, 153, 0, 0.1);
}

th {
  padding: 1rem;
  text-align: left;
  color: var(--color-orange);
  font-weight: 600;
  font-size: 0.875rem;
  border-bottom: 2px solid var(--color-border);
}

td {
  padding: 1rem;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
  font-size: 0.875rem;
}

.actions-col {
  width: 100px;
  text-align: center;
}

.row-display:hover {
  background: rgba(255, 153, 0, 0.05);
}

tbody tr:last-child td {
  border-bottom: none;
}

.btn-icon {
  padding: 0.25rem 0.5rem;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  transition: transform 0.2s;
}

.btn-icon:hover {
  transform: scale(1.2);
}

.row-edit {
  background: rgba(255, 153, 0, 0.05);
}

.edit-form {
  padding: 1rem;
}

.edit-fields {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
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
</style>
