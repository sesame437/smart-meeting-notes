<template>
  <div class="search-wrapper">
    <input
      ref="inputRef"
      type="text"
      :value="modelValue"
      placeholder="真实姓名"
      class="search-input"
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
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { useGlossaryStore } from '@/stores/glossary'

const props = defineProps({
  modelValue: {
    type: String,
    required: true
  },
  rawLabel: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['update:modelValue', 'save-to-glossary'])

const glossaryStore = useGlossaryStore()
const personnelList = ref([])
const showDropdown = ref(false)
const inputRef = ref(null)

// 加载人员词条
async function loadPersonnel() {
  if (personnelList.value.length === 0) {
    personnelList.value = await glossaryStore.fetchPersonnel()
  }
}

// 实时搜索过滤
const filteredPersonnel = computed(() => {
  if (!props.modelValue || !showDropdown.value) return []
  const query = props.modelValue.toLowerCase()
  return personnelList.value.filter(item =>
    item.term.toLowerCase().includes(query)
  ).slice(0, 5)
})

// 是否是新名字（不在词汇表中）
const isNewName = computed(() => {
  if (!props.modelValue.trim()) return false
  return !personnelList.value.some(item => item.term === props.modelValue.trim())
})

function handleInput(event) {
  emit('update:modelValue', event.target.value)
  showDropdown.value = true
  loadPersonnel()
}

function hideDropdown() {
  setTimeout(() => {
    showDropdown.value = false
  }, 200)
}

function selectPersonnel(term) {
  emit('update:modelValue', term)
  showDropdown.value = false
}

async function handleSaveToGlossary() {
  if (!props.modelValue.trim()) {
    alert('请输入真实姓名')
    return
  }
  try {
    await glossaryStore.createTerm(props.modelValue.trim(), '参会人员', '人员')
    alert('已保存到词汇表')
    personnelList.value = await glossaryStore.fetchPersonnel()
    emit('save-to-glossary')
  } catch (err) {
    alert('保存失败: ' + err.message)
  }
}

// 初始加载人员列表
loadPersonnel()
</script>

<style scoped>
.search-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
}

.search-input {
  width: 100%;
  padding: 0.5rem;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 0.875rem;
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
</style>
