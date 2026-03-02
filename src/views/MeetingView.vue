<template>
  <div class="meeting-view">
    <h1>会议详情</h1>
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else class="placeholder">
      <p>会议详情页开发中</p>
      <p class="muted">会议 ID: {{ meetingId }}</p>
      <p class="muted">即将支持：查看会议信息、编辑纪要内容、导出 PDF</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const meetingId = computed(() => route.params.id)

const loading = ref(true)
const error = ref(null)

onMounted(() => {
  // 模拟加载
  setTimeout(() => {
    loading.value = false
  }, 500)
})
</script>

<style scoped>
.meeting-view {
  padding: 2rem 0;
}

h1 {
  color: var(--color-orange);
  margin-bottom: 2rem;
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

.placeholder {
  text-align: center;
  padding: 4rem 2rem;
  background: var(--color-surface);
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.placeholder p {
  margin: 1rem 0;
}

.muted {
  color: var(--color-muted);
  font-size: 0.9rem;
}
</style>
