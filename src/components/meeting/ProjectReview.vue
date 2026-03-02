<template>
  <div class="project-review">
    <!-- 项目名和进展 -->
    <div class="header">
      <h3 class="project-name">{{ review.project || '未命名项目' }}</h3>
    </div>

    <div class="progress-section">
      <h4>本周进展</h4>
      <div class="static-content">{{ review.progress || '暂无进展' }}</div>
    </div>

    <!-- Highlights -->
    <div class="subsection">
      <h4>项目亮点</h4>
      <EditableList
        :items="review.highlights || []"
        :fields="[
          { key: 'point', label: '标题', type: 'text' },
          { key: 'detail', label: '详情', type: 'textarea' }
        ]"
        section="highlights"
        :meeting-id="meetingId"
        :pr-index="index"
        empty-text="暂无亮点"
        add-label="+ 添加亮点"
      />
    </div>

    <!-- Lowlights -->
    <div class="subsection">
      <h4>项目问题</h4>
      <EditableList
        :items="review.lowlights || []"
        :fields="[
          { key: 'point', label: '标题', type: 'text' },
          { key: 'detail', label: '详情', type: 'textarea' }
        ]"
        section="lowlights"
        :meeting-id="meetingId"
        :pr-index="index"
        empty-text="暂无问题"
        add-label="+ 添加问题"
      />
    </div>

    <!-- Risks -->
    <div class="subsection">
      <h4>风险</h4>
      <EditableList
        :items="review.risks || []"
        :fields="[
          { key: 'risk', label: '风险', type: 'text' },
          { key: 'mitigation', label: '应对措施', type: 'textarea' },
          { key: 'impact', label: '影响', type: 'text' }
        ]"
        section="risks"
        :meeting-id="meetingId"
        :pr-index="index"
        empty-text="暂无风险"
        add-label="+ 添加风险"
      />
    </div>

    <!-- Follow-ups -->
    <div class="subsection">
      <h4>跟进事项</h4>
      <EditableList
        :items="review.followUps || []"
        :fields="[
          { key: 'task', label: '任务', type: 'text' },
          { key: 'owner', label: '负责人', type: 'text' },
          { key: 'deadline', label: '截止日期', type: 'text' },
          { key: 'status', label: '状态', type: 'text' }
        ]"
        section="followUps"
        :meeting-id="meetingId"
        :pr-index="index"
        empty-text="暂无跟进事项"
        add-label="+ 添加跟进事项"
      />
    </div>

    <!-- Challenges (read-only) -->
    <div v-if="review.challenges && review.challenges.length > 0" class="subsection">
      <h4>挑战（只读）</h4>
      <div v-for="(challenge, i) in review.challenges" :key="i" class="static-item">
        <p><strong>{{ challenge.challenge }}</strong></p>
        <p class="detail">{{ challenge.detail }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import EditableList from '@/components/common/EditableList.vue'

defineProps({
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
</script>

<style scoped>
.project-review {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: var(--color-surface);
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.header {
  margin-bottom: 1rem;
}

.project-name {
  margin: 0;
  color: var(--color-orange);
  font-size: 1.2rem;
}

.progress-section {
  margin-bottom: 1.5rem;
}

.subsection {
  margin-bottom: 1.5rem;
}

.subsection:last-child {
  margin-bottom: 0;
}

h4 {
  color: var(--color-text);
  font-size: 1rem;
  margin: 0 0 0.75rem 0;
  font-weight: 600;
}

.static-content {
  padding: 1rem;
  background: var(--color-bg);
  border-radius: 4px;
  border: 1px solid var(--color-border);
  white-space: pre-wrap;
  color: var(--color-text);
}

.static-item {
  padding: 1rem;
  background: var(--color-bg);
  border-radius: 4px;
  border: 1px solid var(--color-border);
  margin-bottom: 0.5rem;
}

.static-item:last-child {
  margin-bottom: 0;
}

.static-item p {
  margin: 0.25rem 0;
}

.static-item strong {
  color: var(--color-orange);
}

.detail {
  color: var(--color-muted);
  font-size: 0.875rem;
}
</style>
