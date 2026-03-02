import { defineStore } from 'pinia'

export const useUIStore = defineStore('ui', {
  state: () => ({
    toast: null
  }),
  actions: {
    showToast(message, type = 'info', duration = 3000) {
      this.toast = {
        message,
        type,
        duration,
        id: Date.now()
      }
    },
    clearToast() {
      this.toast = null
    }
  }
})
