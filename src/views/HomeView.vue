<template>
  <div class="home-view">
    <div class="page-header">
      <h1>会议列表</h1>
      <button class="upload-btn" @click="showUpload = !showUpload">
        <span class="btn-icon">{{ showUpload ? '−' : '+' }}</span>
        {{ showUpload ? '收起' : '上传录音' }}
      </button>
    </div>

    <!-- 上传区域 -->
    <UploadArea v-if="showUpload" />

    <!-- Loading 骨架屏 -->
    <div v-if="store.loading" class="meeting-list">
      <div v-for="i in 3" :key="i" class="skeleton-card"></div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="!store.list.length" class="empty-state">
      <div class="empty-icon">📝</div>
      <p class="empty-title">暂无会议</p>
      <p class="empty-hint">点击上传录音开始</p>
    </div>

    <!-- 会议列表 -->
    <div v-else class="meeting-list">
      <MeetingCard
        v-for="meeting in store.list"
        :key="meeting.meetingId"
        :meeting="meeting"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useMeetingStore } from '@/stores/meeting'
import MeetingCard from '@/components/meeting/MeetingCard.vue'
import UploadArea from '@/components/upload/UploadArea.vue'

const store = useMeetingStore()
const showUpload = ref(false)

onMounted(async () => {
  try {
    await store.fetchList()
  } catch (err) {
    console.error('Failed to fetch meetings:', err)
  }
})
</script>

<style scoped>
.home-view {
  padding: 2rem 0;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  gap: 1rem;
}

h1 {
  color: var(--color-orange);
  margin: 0;
  font-size: 2rem;
  font-weight: 700;
}

.upload-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  background: var(--color-orange);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.upload-btn:not(:disabled):hover {
  background: #ff8800;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(255, 153, 0, 0.3);
}

.upload-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 1.5rem;
  line-height: 1;
}

/* Loading 骨架屏 */
.meeting-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.skeleton-card {
  background: linear-gradient(90deg, #e8edf2 25%, #f5f5f5 50%, #e8edf2 75%);
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s ease-in-out infinite;
  border-radius: 8px;
  height: 100px;
}

@keyframes skeleton-loading {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  background: var(--color-surface);
  border-radius: 12px;
  border: 1px solid var(--color-border);
  min-height: 400px;
}

.empty-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
  opacity: 0.5;
}

.empty-title {
  color: var(--color-text);
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0 0 0.5rem 0;
}

.empty-hint {
  color: var(--color-muted);
  font-size: 1rem;
  margin: 0;
}

/* 响应式 */
@media (max-width: 768px) {
  .home-view {
    padding: 1rem;
  }

  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  h1 {
    font-size: 1.5rem;
  }

  .upload-btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
