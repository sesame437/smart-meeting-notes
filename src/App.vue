<template>
  <div id="app">
    <nav class="navbar">
      <div class="container">
        <router-link to="/" class="logo">会议纪要</router-link>
        <div class="nav-links">
          <router-link to="/" class="nav-link">首页</router-link>
          <router-link to="/glossary" class="nav-link">词汇表</router-link>
        </div>
      </div>
    </nav>
    <main class="main-content">
      <router-view />
    </main>
    <Toast />
  </div>
</template>

<script setup>
import Toast from '@/components/common/Toast.vue'
</script>

<style scoped>
.navbar {
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  padding: 1rem 0;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo {
  font-size: 1.5rem;
  font-weight: bold;
  color: var(--color-orange);
  text-decoration: none;
}

.nav-links {
  display: flex;
  gap: 1.5rem;
}

.nav-link {
  color: var(--color-text);
  text-decoration: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  transition: background 0.2s;
}

.nav-link:hover {
  background: rgba(255, 153, 0, 0.1);
}

.nav-link.router-link-active {
  background: rgba(255, 153, 0, 0.2);
  color: var(--color-orange);
}

.main-content {
  max-width: 1200px;
  margin: 2rem auto;
  padding: 0 1rem;
}
</style>
