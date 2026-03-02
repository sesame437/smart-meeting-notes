<template>
  <div class="project-accordion">
    <!-- 标题行 -->
    <div class="accordion-header" @click="toggleExpand">
      <div class="header-left">
        <span :class="['status-dot', getStatusClass()]"></span>
        <h3 class="project-name">{{ review.project || '未命名项目' }}</h3>
      </div>
      <div class="expand-icon">{{ isExpanded ? '▼' : '▶' }}</div>
    </div>

    <!-- 展开内容 -->
    <div v-if="isExpanded" class="accordion-content">
      <!-- 本周进展 -->
      <div class="progress-section">
        <h4>本周进展</h4>
        <div class="static-content">{{ review.progress || '暂无进展' }}</div>
      </div>

      <!-- 4 个 Tab -->
      <div class="tabs">
        <div class="tab-headers">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :class="['tab-button', { active: activeTab === tab.key }]"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>

        <div class="tab-content">
          <EditableList
            :items="review[activeTab] || []"
            :fields="tabFields[activeTab]"
            :section="activeTab"
            :meeting-id="meetingId"
            :pr-index="index"
            :empty-text="tabConfig[activeTab].empty"
            :add-label="tabConfig[activeTab].add"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import EditableList from '@/components/common/EditableList.vue'

const props = defineProps({
  review: {
    type: Object,
    required: true
  },
  index: {
    type: Number,
    required: true
  },
  meetingId: {
    type: String,
    required: true
  }
})

const isExpanded = ref(false)
const activeTab = ref('highlights')

const tabs = [
  { key: 'highlights', label: '亮点' },
  { key: 'lowlights', label: '低光' },
  { key: 'risks', label: '风险' },
  { key: 'followUps', label: '跟进' }
]

const tabFields = {
  highlights: [{ key: 'point', label: '标题', type: 'text' }, { key: 'detail', label: '详情', type: 'textarea' }],
  lowlights: [{ key: 'point', label: '标题', type: 'text' }, { key: 'detail', label: '详情', type: 'textarea' }],
  risks: [{ key: 'risk', label: '风险', type: 'text' }, { key: 'mitigation', label: '应对措施', type: 'textarea' }, { key: 'impact', label: '影响', type: 'text' }],
  followUps: [{ key: 'task', label: '任务', type: 'text' }, { key: 'owner', label: '负责人', type: 'text' }, { key: 'deadline', label: '截止日期', type: 'text' }, { key: 'status', label: '状态', type: 'text' }]
}

const tabConfig = {
  highlights: { empty: '暂无亮点', add: '+ 添加亮点' },
  lowlights: { empty: '暂无问题', add: '+ 添加问题' },
  risks: { empty: '暂无风险', add: '+ 添加风险' },
  followUps: { empty: '暂无跟进事项', add: '+ 添加跟进事项' }
}

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

function getStatusClass() {
  return 'status-on-track'
}
</script>

<style scoped>
.project-accordion { margin-bottom: 1.5rem; background: var(--color-surface); border-radius: 8px; border: 1px solid var(--color-border); overflow: hidden; }
.accordion-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; cursor: pointer; transition: background 0.2s; }
.accordion-header:hover { background: rgba(255, 153, 0, 0.05); }
.header-left { display: flex; align-items: center; gap: 0.75rem; }
.status-dot { width: 12px; height: 12px; border-radius: 50%; }
.status-on-track { background: #2e7d32; }
.status-at-risk { background: var(--color-orange); }
.status-completed { background: #6e7d7e; }
.project-name { margin: 0; color: var(--color-orange); font-size: 1.1rem; }
.expand-icon { color: var(--color-muted); font-size: 0.875rem; }
.accordion-content { padding: 0 1.5rem 1.5rem 1.5rem; border-top: 1px solid var(--color-border); }
.progress-section { margin: 1rem 0 1.5rem 0; }
.progress-section h4 { color: var(--color-text); font-size: 1rem; margin: 0 0 0.75rem 0; font-weight: 600; }
.static-content { padding: 1rem; background: var(--color-bg); border-radius: 4px; border: 1px solid var(--color-border); white-space: pre-wrap; color: var(--color-text); }
.tabs { margin-top: 1rem; }
.tab-headers { display: flex; gap: 0.5rem; border-bottom: 2px solid var(--color-border); margin-bottom: 1rem; }
.tab-button { padding: 0.75rem 1.5rem; background: none; color: var(--color-muted); border: none; border-bottom: 2px solid transparent; cursor: pointer; font-size: 0.875rem; font-weight: 500; transition: all 0.2s; margin-bottom: -2px; }
.tab-button:hover { color: var(--color-text); }
.tab-button.active { color: var(--color-orange); border-bottom-color: var(--color-orange); }
.tab-content { min-height: 150px; }
</style>
