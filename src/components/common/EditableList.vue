<template>
  <div class="editable-list">
    <div v-if="!items || items.length === 0" class="empty-state">
      {{ emptyText || '暂无内容' }}
    </div>

    <div v-for="(item, index) in items" :key="index" class="list-item">
      <div v-if="editingIndex !== index" class="item-display" @click="startEdit(index)">
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
            v-model="editingData[field.key]"
            type="text"
            :placeholder="field.label"
          />
          <textarea
            v-else
            v-model="editingData[field.key]"
            :placeholder="field.label"
            rows="3"
          />
        </div>
        <div class="edit-actions">
          <button @click="saveEdit(index)" class="btn-save">保存</button>
          <button @click="cancelEdit" class="btn-cancel">取消</button>
          <button @click="deleteItem(index)" class="btn-delete">删除</button>
        </div>
      </div>
    </div>

    <div v-if="showAddForm" class="item-edit add-form">
      <div v-for="field in fields" :key="field.key" class="field-edit">
        <label>{{ field.label }}:</label>
        <input
          v-if="field.type === 'text'"
          v-model="newItemData[field.key]"
          type="text"
          :placeholder="field.label"
        />
        <textarea
          v-else
          v-model="newItemData[field.key]"
          :placeholder="field.label"
          rows="3"
        />
      </div>
      <div class="edit-actions">
        <button @click="saveNew" class="btn-save">保存</button>
        <button @click="cancelAdd" class="btn-cancel">取消</button>
      </div>
    </div>

    <button v-if="!showAddForm && editingIndex === null" @click="startAdd" class="btn-add">
      {{ addLabel || '添加' }}
    </button>

    <ConfirmDialog
      message="确定删除这条记录吗？"
      :visible="showConfirmDialog"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useMeetingStore } from '@/stores/meeting'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps({
  items: Array,
  fields: Array,
  section: String,
  meetingId: String,
  prIndex: Number,
  emptyText: String,
  addLabel: String
})

const emit = defineEmits(['save'])
const store = useMeetingStore()

const editingIndex = ref(null)
const editingData = ref({})
const showAddForm = ref(false)
const newItemData = ref({})
const showConfirmDialog = ref(false)
const pendingDeleteIndex = ref(null)

function startEdit(index) {
  editingIndex.value = index
  editingData.value = { ...props.items[index] }
}

function cancelEdit() {
  editingIndex.value = null
  editingData.value = {}
}

async function saveEdit(index) {
  try {
    const updatedItems = [...props.items]
    updatedItems[index] = { ...editingData.value }

    if (props.prIndex !== undefined) {
      // 嵌套编辑：更新 projectReviews[prIndex][section]
      const projectReviews = [...store.report.projectReviews]
      projectReviews[props.prIndex] = { ...projectReviews[props.prIndex], [props.section]: updatedItems }
      await store.patchSection(props.meetingId, 'projectReviews', projectReviews)
    } else {
      await store.patchSection(props.meetingId, props.section, updatedItems)
    }

    emit('save')
    editingIndex.value = null
    editingData.value = {}
  } catch (err) {
    alert('保存失败: ' + err.message)
  }
}

function deleteItem(index) {
  pendingDeleteIndex.value = index
  showConfirmDialog.value = true
}

async function confirmDelete() {
  try {
    const index = pendingDeleteIndex.value
    const updatedItems = props.items.filter((_, i) => i !== index)

    if (props.prIndex !== undefined) {
      const projectReviews = [...store.report.projectReviews]
      projectReviews[props.prIndex] = { ...projectReviews[props.prIndex], [props.section]: updatedItems }
      await store.patchSection(props.meetingId, 'projectReviews', projectReviews)
    } else {
      await store.patchSection(props.meetingId, props.section, updatedItems)
    }

    emit('save')
    editingIndex.value = null
    editingData.value = {}
    showConfirmDialog.value = false
    pendingDeleteIndex.value = null
  } catch (err) {
    alert('删除失败: ' + err.message)
  }
}

function cancelDelete() {
  showConfirmDialog.value = false
  pendingDeleteIndex.value = null
}

function startAdd() {
  showAddForm.value = true
  newItemData.value = {}
}

function cancelAdd() {
  showAddForm.value = false
  newItemData.value = {}
}

async function saveNew() {
  try {
    const updatedItems = [...(props.items || []), { ...newItemData.value }]

    if (props.prIndex !== undefined) {
      const projectReviews = [...store.report.projectReviews]
      projectReviews[props.prIndex] = { ...projectReviews[props.prIndex], [props.section]: updatedItems }
      await store.patchSection(props.meetingId, 'projectReviews', projectReviews)
    } else {
      await store.patchSection(props.meetingId, props.section, updatedItems)
    }

    emit('save')
    showAddForm.value = false
    newItemData.value = {}
  } catch (err) {
    alert('保存失败: ' + err.message)
  }
}
</script>

<style scoped>
.editable-list {
  margin: 1rem 0;
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--color-muted);
  background: var(--color-surface);
  border-radius: 4px;
  border: 1px dashed var(--color-border);
}

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

.item-edit, .add-form {
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

.btn-add {
  width: 100%;
  padding: 0.75rem;
  background: rgba(255, 153, 0, 0.1);
  color: var(--color-orange);
  border: 1px dashed var(--color-orange);
}

.btn-add:hover {
  background: rgba(255, 153, 0, 0.2);
}
</style>
