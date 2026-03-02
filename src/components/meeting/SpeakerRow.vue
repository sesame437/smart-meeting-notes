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
      <div class="input-wrapper">
        <input
          ref="inputRef"
          type="text"
          v-model="localName"
          placeholder="真实姓名"
          class="input-name"
          @input="handleInput"
          @focus="showDropdown = true"
          @blur="hideDropdown"
        />
        <div v-if="showDropdown && filteredPersonnel.length > 0" class="dropdown">
          <div
            v-for="item in filteredPersonnel"
            :key="item.termId"
            class="dropdown-item"
            @mousedown.prevent="selectPersonnel(item.term)"
          >
            {{ item.term }}
            <span v-if="item.definition" class="dropdown-detail">{{ item.definition }}</span>
          </div>
        </div>
        <a
          v-if="isNewName"
          href="#"
          class="save-to-glossary"
          @click.prevent="handleSaveToGlossary"
        >
          保存到词汇表
        </a>
      </div>
      <div class="edit-actions">
        <button @click="handleSave" class="btn-save">保存</button>
        <button @click="$emit('cancel')" class="btn-cancel">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { useGlossaryStore } from '@/stores/glossary'

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

const emit = defineEmits(['edit', 'save', 'cancel', 'saveToGlossary'])

const glossaryStore = useGlossaryStore()
const localName = ref(props.realName)
const personnelList = ref([])
const showDropdown = ref(false)
const inputRef = ref(null)

watch(() => props.realName, (newName) => {
  localName.value = newName
})

// 加载人员词条
watch(() => props.isEditing, async (editing) => {
  if (editing && personnelList.value.length === 0) {
    personnelList.value = await glossaryStore.fetchPersonnel()
  }
})

// 实时搜索过滤
const filteredPersonnel = computed(() => {
  if (!localName.value || !showDropdown.value) return []
  const query = localName.value.toLowerCase()
  return personnelList.value.filter(item =>
    item.term.toLowerCase().includes(query)
  ).slice(0, 5)
})

// 是否是新名字（不在词汇表中）
const isNewName = computed(() => {
  if (!localName.value.trim()) return false
  return !personnelList.value.some(item => item.term === localName.value.trim())
})

function handleInput() {
  showDropdown.value = true
}

function hideDropdown() {
  setTimeout(() => {
    showDropdown.value = false
  }, 200)
}

function selectPersonnel(term) {
  localName.value = term
  showDropdown.value = false
}

function handleSave() {
  if (!localName.value.trim()) {
    alert('请输入真实姓名')
    return
  }
  showDropdown.value = false
  emit('save', localName.value.trim())
}

async function handleSaveToGlossary() {
  if (!localName.value.trim()) {
    alert('请输入真实姓名')
    return
  }
  try {
    await glossaryStore.createTerm(localName.value.trim(), '参会人员', '人员')
    alert('已保存到词汇表')
    // 重新加载人员列表
    personnelList.value = await glossaryStore.fetchPersonnel()
  } catch (err) {
    alert('保存失败: ' + err.message)
  }
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

.input-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
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
  width: 100%;
}

.dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  max-height: 200px;
  overflow-y: auto;
  z-index: 10;
  margin-top: 0.25rem;
}

.dropdown-item {
  padding: 0.5rem;
  cursor: pointer;
  border-bottom: 1px solid var(--color-border);
  transition: background 0.2s;
}

.dropdown-item:last-child {
  border-bottom: none;
}

.dropdown-item:hover {
  background: rgba(255, 153, 0, 0.1);
}

.dropdown-detail {
  color: var(--color-muted);
  font-size: 0.75rem;
  margin-left: 0.5rem;
}

.save-to-glossary {
  color: var(--color-orange);
  font-size: 0.75rem;
  text-decoration: none;
}

.save-to-glossary:hover {
  text-decoration: underline;
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
