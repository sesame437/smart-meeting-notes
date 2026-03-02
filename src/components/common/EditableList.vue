<template>
  <div class="editable-list">
    <div v-if="!items || items.length === 0" class="empty-state">
      {{ emptyText || '暂无内容' }}
    </div>

    <!-- stringMode: 简单 string 数组展示和编辑 -->
    <template v-if="stringMode">
      <div
        v-for="(item, index) in items"
        :key="index"
        class="string-item"
      >
        <template v-if="editingIndex === index">
          <input
            v-model="editingStringValue"
            type="text"
            :placeholder="fields[0].label"
            class="string-input"
          />
          <div class="edit-actions">
            <button @click="saveStringEdit(index)" class="btn-save">保存</button>
            <button @click="cancelEdit" class="btn-cancel">取消</button>
          </div>
        </template>
        <template v-else>
          <span class="string-value">{{ item }}</span>
          <div class="item-actions">
            <button @click="startEdit(index)" class="btn-edit">编辑</button>
            <button @click="deleteItem(index)" class="btn-delete">删除</button>
          </div>
        </template>
      </div>
    </template>

    <!-- 非 stringMode: object 数组用 EditableRow -->
    <EditableRow
      v-else
      v-for="(item, index) in items"
      :key="index"
      :item="item"
      :fields="fields"
      :is-editing="editingIndex === index"
      @edit="startEdit(index)"
      @save="(data) => saveEdit(index, data)"
      @cancel="cancelEdit"
      @delete="deleteItem(index)"
    />

    <!-- 新增表单 -->
    <div v-if="showAddForm" class="item-edit add-form">
      <!-- stringMode: 单个 input -->
      <div v-if="stringMode" class="field-edit">
        <label>{{ fields[0].label }}:</label>
        <input
          v-model="newStringValue"
          type="text"
          :placeholder="fields[0].label"
        />
      </div>
      <!-- 非 stringMode: 多字段表单 -->
      <div v-else v-for="field in fields" :key="field.key" class="field-edit">
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
import { ref, computed } from 'vue'
import { useMeetingStore } from '@/stores/meeting'
import EditableRow from './EditableRow.vue'
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

// string 数组模式：fields.length === 1 且 items[0] 是 string（或 items 为空）
const stringMode = computed(() => {
  return props.fields?.length === 1 && (
    !props.items ||
    props.items.length === 0 ||
    typeof props.items[0] === 'string'
  )
})

const editingIndex = ref(null)
const showAddForm = ref(false)
const newItemData = ref({})
const showConfirmDialog = ref(false)
const pendingDeleteIndex = ref(null)

// stringMode 专用状态
const editingStringValue = ref('')
const newStringValue = ref('')

function startEdit(index) {
  editingIndex.value = index
  if (stringMode.value) {
    editingStringValue.value = props.items[index]
  }
}

function cancelEdit() {
  editingIndex.value = null
}

async function saveEdit(index, data) {
  try {
    const updatedItems = [...props.items]
    updatedItems[index] = { ...data }

    if (props.prIndex !== undefined) {
      const projectReviews = [...store.report.projectReviews]
      projectReviews[props.prIndex] = { ...projectReviews[props.prIndex], [props.section]: updatedItems }
      await store.patchSection(props.meetingId, 'projectReviews', projectReviews)
    } else {
      await store.patchSection(props.meetingId, props.section, updatedItems)
    }

    emit('save')
    editingIndex.value = null
  } catch (err) {
    alert('保存失败: ' + err.message)
  }
}

async function saveStringEdit(index) {
  try {
    const updatedItems = [...props.items]
    updatedItems[index] = editingStringValue.value

    if (props.prIndex !== undefined) {
      const projectReviews = [...store.report.projectReviews]
      projectReviews[props.prIndex] = { ...projectReviews[props.prIndex], [props.section]: updatedItems }
      await store.patchSection(props.meetingId, 'projectReviews', projectReviews)
    } else {
      await store.patchSection(props.meetingId, props.section, updatedItems)
    }

    emit('save')
    editingIndex.value = null
    editingStringValue.value = ''
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
  if (stringMode.value) {
    newStringValue.value = ''
  } else {
    newItemData.value = {}
  }
}

function cancelAdd() {
  showAddForm.value = false
  newItemData.value = {}
  newStringValue.value = ''
}

async function saveNew() {
  try {
    let updatedItems
    if (stringMode.value) {
      updatedItems = [...(props.items || []), newStringValue.value]
    } else {
      updatedItems = [...(props.items || []), { ...newItemData.value }]
    }

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
    newStringValue.value = ''
  } catch (err) {
    alert('保存失败: ' + err.message)
  }
}
</script>

<style scoped>
.editable-list { margin: 1rem 0; }
.empty-state { padding: 2rem; text-align: center; color: var(--color-muted); background: var(--color-surface); border-radius: 4px; border: 1px dashed var(--color-border); }
.add-form { padding: 1rem; background: var(--color-surface); border-radius: 4px; border: 1px solid var(--color-orange); }
.field-edit { margin-bottom: 1rem; }
.field-edit label { display: block; color: var(--color-muted); font-size: 0.875rem; margin-bottom: 0.25rem; }
.field-edit input, .field-edit textarea { width: 100%; padding: 0.5rem; background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 4px; font-family: inherit; font-size: 0.875rem; }
.field-edit textarea { resize: vertical; }
.edit-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
button { padding: 0.5rem 1rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.875rem; font-weight: 500; transition: all 0.2s; }
.btn-save { background: var(--color-orange); color: var(--color-bg); }
.btn-save:hover { background: #e68a00; }
.btn-cancel { background: var(--color-muted); color: var(--color-bg); }
.btn-cancel:hover { background: #6e7d7e; }
.btn-add { width: 100%; padding: 0.75rem; background: rgba(255, 153, 0, 0.1); color: var(--color-orange); border: 1px dashed var(--color-orange); }
.btn-add:hover { background: rgba(255, 153, 0, 0.2); }

/* stringMode 样式 */
.string-item { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 1rem; background: var(--color-surface); border-radius: 4px; border: 1px solid var(--color-border); margin-bottom: 0.5rem; }
.string-value { flex: 1; color: var(--color-text); }
.string-input { flex: 1; padding: 0.5rem; background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 4px; font-family: inherit; font-size: 0.875rem; }
.item-actions { display: flex; gap: 0.5rem; }
.btn-edit { background: rgba(255, 153, 0, 0.2); color: var(--color-orange); }
.btn-edit:hover { background: rgba(255, 153, 0, 0.3); }
.btn-delete { background: rgba(211, 47, 47, 0.2); color: #ff6b6b; }
.btn-delete:hover { background: rgba(211, 47, 47, 0.3); }
</style>
