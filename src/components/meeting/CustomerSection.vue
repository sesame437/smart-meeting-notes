<template>
  <div class="customer-section">
    <section class="section">
      <h2>客户信息</h2>
      <div class="static-content">
        <p><strong>公司:</strong> {{ report.customerInfo?.company || '-' }}</p>
        <p><strong>客户参会人:</strong> {{ (report.customerInfo?.attendees || []).join(', ') || '-' }}</p>
        <p><strong>AWS参会人:</strong> {{ (report.awsAttendees || []).join(', ') || '-' }}</p>
      </div>
    </section>

    <section class="section">
      <h2>客户需求</h2>
      <div v-for="(need, i) in report.customerNeeds" :key="i" class="static-item">
        <p><strong>需求:</strong> {{ need.need }}</p>
        <p><strong>优先级:</strong> {{ need.priority }}</p>
        <p v-if="need.background"><strong>背景:</strong> {{ need.background }}</p>
      </div>
      <div v-if="!report.customerNeeds || report.customerNeeds.length === 0" class="muted">暂无客户需求</div>
    </section>

    <section class="section">
      <h2>痛点</h2>
      <div v-for="(pain, i) in report.painPoints" :key="i" class="static-item">
        <p><strong>{{ pain.point }}:</strong> {{ pain.detail }}</p>
      </div>
      <div v-if="!report.painPoints || report.painPoints.length === 0" class="muted">暂无痛点</div>
    </section>

    <section class="section">
      <h2>解决方案</h2>
      <div v-for="(sol, i) in report.solutionsDiscussed" :key="i" class="static-item">
        <p><strong>方案:</strong> {{ sol.solution }}</p>
        <p><strong>AWS服务:</strong> {{ (sol.awsServices || []).join(', ') }}</p>
        <p v-if="sol.customerFeedback"><strong>客户反馈:</strong> {{ sol.customerFeedback }}</p>
      </div>
      <div v-if="!report.solutionsDiscussed || report.solutionsDiscussed.length === 0" class="muted">暂无解决方案</div>
    </section>

    <section class="section">
      <h2>承诺</h2>
      <div v-for="(commit, i) in report.commitments" :key="i" class="static-item">
        <p><strong>{{ commit.party }}:</strong> {{ commit.commitment }}</p>
        <p><strong>负责人:</strong> {{ commit.owner }} | <strong>截止:</strong> {{ commit.deadline }}</p>
      </div>
      <div v-if="!report.commitments || report.commitments.length === 0" class="muted">暂无承诺</div>
    </section>

    <section class="section">
      <h2>后续步骤</h2>
      <div v-for="(step, i) in report.nextSteps" :key="i" class="static-item">
        <p><strong>{{ step.task }}</strong> ({{ step.priority }})</p>
        <p><strong>负责人:</strong> {{ step.owner }} | <strong>截止:</strong> {{ step.deadline }}</p>
      </div>
      <div v-if="!report.nextSteps || report.nextSteps.length === 0" class="muted">暂无后续步骤</div>
    </section>
  </div>
</template>

<script setup>
defineProps({
  report: {
    type: Object,
    required: true
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

.static-content p {
  margin: 0.5rem 0;
}

.static-item {
  padding: 1rem;
  background: var(--color-surface);
  border-radius: 4px;
  border: 1px solid var(--color-border);
  margin-bottom: 0.5rem;
}

.static-item p {
  margin: 0.25rem 0;
}

.muted {
  color: var(--color-muted);
  font-style: italic;
}
</style>
