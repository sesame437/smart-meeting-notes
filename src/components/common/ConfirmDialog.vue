<script setup>
defineProps({
  message: {
    type: String,
    required: true
  },
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['confirm', 'cancel'])

function handleConfirm() {
  emit('confirm')
}

function handleCancel() {
  emit('cancel')
}
</script>

<template>
  <Transition name="fade">
    <div v-if="visible" class="dialog-overlay" @click="handleCancel">
      <div class="dialog" @click.stop>
        <div class="dialog-body">
          <p class="dialog-message">{{ message }}</p>
        </div>
        <div class="dialog-actions">
          <button class="btn btn-secondary" @click="handleCancel">取消</button>
          <button class="btn btn-primary" @click="handleConfirm">确认</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.dialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  min-width: 400px;
  max-width: 500px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.dialog-body {
  padding: 24px;
}

.dialog-message {
  color: var(--color-text);
  font-size: 16px;
  line-height: 1.5;
  margin: 0;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--color-border);
}

.btn {
  padding: 8px 20px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary {
  background: transparent;
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.05);
}

.btn-primary {
  background: var(--color-orange);
  color: white;
}

.btn-primary:hover {
  background: #e68900;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
