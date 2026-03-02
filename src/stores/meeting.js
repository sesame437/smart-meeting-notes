import { defineStore } from 'pinia'
import { api } from '@/api'

export const useMeetingStore = defineStore('meeting', {
  state: () => ({
    list: [],
    current: null,
    loading: false,
    error: null
  }),

  getters: {
    // 当前会议的 report 内容
    report: (state) => state.current?.content || {},

    // 按状态分组
    meetingsByStatus: (state) => {
      const grouped = {}
      state.list.forEach(meeting => {
        const status = meeting.status || 'unknown'
        if (!grouped[status]) grouped[status] = []
        grouped[status].push(meeting)
      })
      return grouped
    }
  },

  actions: {
    // 获取会议列表
    async fetchList(params = {}) {
      this.loading = true
      this.error = null
      try {
        const query = new URLSearchParams(params).toString()
        const data = await api.get(`/meetings${query ? '?' + query : ''}`)
        this.list = data.items || data || []
        return data
      } catch (err) {
        this.error = err.message
        throw err
      } finally {
        this.loading = false
      }
    },

    // 获取单个会议详情
    async fetchMeeting(id) {
      this.loading = true
      this.error = null
      try {
        const data = await api.get(`/meetings/${id}`)
        this.current = data
        return data
      } catch (err) {
        this.error = err.message
        throw err
      } finally {
        this.loading = false
      }
    },

    // 修改 report 某个 section
    async patchSection(id, section, data) {
      try {
        await api.patch(`/meetings/${id}/report`, { section, data })

        // 乐观更新本地 state
        if (this.current?.meetingId === id && this.current.content) {
          this.current.content[section] = data
        }
      } catch (err) {
        this.error = err.message
        throw err
      }
    },

    // 删除会议
    async deleteMeeting(id) {
      try {
        await api.delete(`/meetings/${id}`)

        // 从列表中移除
        this.list = this.list.filter(m => m.meetingId !== id)

        // 如果是当前会议，清空
        if (this.current?.meetingId === id) {
          this.current = null
        }
      } catch (err) {
        this.error = err.message
        throw err
      }
    }
  }
})
