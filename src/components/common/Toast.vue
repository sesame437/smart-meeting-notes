<script setup>
import { computed, watch } from 'vue'
import { useUIStore } from '@/stores/ui'

const uiStore = useUIStore()

const toast = computed(() => uiStore.toast)

watch(toast, (newToast) => {
  if (newToast) {
    setTimeout(() => {
      uiStore.clearToast()
    }, newToast.duration)
  }
})

const bgClass = computed(() => {
  if (!toast.value) return ''
  return {
    success: 'bg-success',
    error: 'bg-danger',
    info: 'bg-info'
  }[toast.value.type]
})
</script>

<template>
  <Transition name="slide-fade">
    <div v-if="toast" :class="['toast', bgClass]">
      <span class="toast-icon">
        <template v-if="toast.type === 'success'">✓</template>
        <template v-else-if="toast.type === 'error'">✕</template>
        <template v-else>ⓘ</template>
      </span>
      <span class="toast-message">{{ toast.message }}</span>
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  top: 20px;
  right: 20px;
  padding: 12px 20px;
  border-radius: 4px;
  color: white;
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 9999;
  min-width: 250px;
  max-width: 400px;
}

.bg-success {
  background-color: var(--color-success);
}

.bg-danger {
  background-color: var(--color-danger);
}

.bg-info {
  background-color: var(--color-orange);
}

.toast-icon {
  font-size: 18px;
  font-weight: bold;
}

.toast-message {
  flex: 1;
}

.slide-fade-enter-active {
  transition: all 0.3s ease-out;
}

.slide-fade-leave-active {
  transition: all 0.2s ease-in;
}

.slide-fade-enter-from {
  transform: translateX(100px);
  opacity: 0;
}

.slide-fade-leave-to {
  opacity: 0;
}
</style>
