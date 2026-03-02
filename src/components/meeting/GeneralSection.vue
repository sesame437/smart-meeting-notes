<template>
  <div class="general-section">
    <section class="section">
      <h2>会议摘要</h2>
      <div class="static-content">{{ report.summary || '暂无摘要' }}</div>
    </section>

    <section class="section">
      <h2>参会人员</h2>
      <EditableList
        :items="report.participants || []"
        :fields="[{ key: 'name', label: '姓名', type: 'text', required: true }]"
        section="participants"
        :meeting-id="meetingId"
        empty-text="暂无参会人员"
        add-label="+ 添加参会人"
      />
    </section>

    <section class="section">
      <h2>亮点</h2>
      <EditableList
        :items="report.highlights || []"
        :fields="[{ key: 'point', label: '标题', type: 'text' }, { key: 'detail', label: '详情', type: 'textarea' }]"
        section="highlights"
        :meeting-id="meetingId"
        empty-text="暂无亮点"
        add-label="+ 添加亮点"
      />
    </section>

    <section class="section">
      <h2>问题</h2>
      <EditableList
        :items="report.lowlights || []"
        :fields="[{ key: 'point', label: '标题', type: 'text' }, { key: 'detail', label: '详情', type: 'textarea' }]"
        section="lowlights"
        :meeting-id="meetingId"
        empty-text="暂无问题"
        add-label="+ 添加问题"
      />
    </section>

    <section class="section">
      <h2>行动项</h2>
      <EditableList
        :items="report.actions || []"
        :fields="[
          { key: 'task', label: '任务', type: 'text' },
          { key: 'owner', label: '负责人', type: 'text' },
          { key: 'deadline', label: '截止日期', type: 'text' },
          { key: 'priority', label: '优先级', type: 'text' }
        ]"
        section="actions"
        :meeting-id="meetingId"
        empty-text="暂无行动项"
        add-label="+ 添加行动项"
      />
    </section>

    <section class="section">
      <h2>决策</h2>
      <EditableList
        :items="report.decisions || []"
        :fields="[{ key: 'decision', label: '决策', type: 'text' }, { key: 'rationale', label: '原因', type: 'textarea' }]"
        section="decisions"
        :meeting-id="meetingId"
        empty-text="暂无决策"
        add-label="+ 添加决策"
      />
    </section>

    <section v-if="meetingType === 'tech' || meetingType === 'general'" class="section">
      <h2>议题</h2>
      <EditableList
        :items="report.topics || []"
        :fields="[
          { key: 'topic', label: '议题', type: 'text' },
          { key: 'discussion', label: '讨论要点', type: 'textarea' },
          { key: 'conclusion', label: '结论', type: 'textarea' }
        ]"
        section="topics"
        :meeting-id="meetingId"
        empty-text="暂无议题"
        add-label="+ 添加议题"
      />
    </section>
  </div>
</template>

<script setup>
import EditableList from '@/components/common/EditableList.vue'

defineProps({
  report: {
    type: Object,
    required: true
  },
  meetingId: {
    type: String,
    required: true
  },
  meetingType: {
    type: String,
    default: 'general'
  }
})
</script>

<style scoped>
.section {
  margin-bottom: 2rem;
}

.section h2 {
  color: var(--color-orange);
  font-size: 1.2rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.5rem;
}

.static-content {
  padding: 1rem;
  background: var(--color-surface);
  border-radius: 4px;
  border: 1px solid var(--color-border);
  white-space: pre-wrap;
}

.muted {
  color: var(--color-muted);
  font-style: italic;
}
</style>
