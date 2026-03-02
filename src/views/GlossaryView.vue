<template>
  <div class="glossary-view">
    <h1>词汇表</h1>

    <div class="tabs">
      <button
        :class="['tab', { active: activeTab === '术语' }]"
        @click="activeTab = '术语'"
      >
        术语
      </button>
      <button
        :class="['tab', { active: activeTab === '人员' }]"
        @click="activeTab = '人员'"
      >
        人员
      </button>
    </div>

    <GlossaryForm :current-category="activeTab" @add="addTerm" />

    <div v-if="store.loading" class="loading">加载中...</div>
    <div v-else-if="store.error" class="error">{{ store.error }}</div>
    <GlossaryTable
      v-else-if="filteredItems.length > 0"
      :items="filteredItems"
      @update="updateTerm"
      @delete="deleteItem"
    />
    <div v-else class="empty-state">
      <p>暂无词汇</p>
      <p class="muted">请使用上方表单添加术语和定义</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useGlossaryStore } from '@/stores/glossary'
import GlossaryForm from '@/components/glossary/GlossaryForm.vue'
import GlossaryTable from '@/components/glossary/GlossaryTable.vue'

const store = useGlossaryStore()
const activeTab = ref('术语')

const filteredItems = computed(() => {
  if (!activeTab.value) return store.items
  return store.items.filter(item => item.category === activeTab.value)
})

async function addTerm(data) {
  try {
    await store.createTerm(data.term, data.definition, data.category)
  } catch (err) {
    alert('添加失败: ' + err.message)
  }
}

async function updateTerm(data) {
  try {
    await store.updateTerm(data.termId, data.term, data.definition, data.category)
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
  margin-bottom: 1rem;
}

.tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 2rem;
  border-bottom: 1px solid var(--color-border);
}

.tab {
  padding: 0.75rem 1.5rem;
  background: transparent;
  color: var(--color-muted);
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 500;
  transition: all 0.2s;
}

.tab:hover {
  color: var(--color-text);
}

.tab.active {
  color: var(--color-orange);
  border-bottom-color: var(--color-orange);
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
</style>
