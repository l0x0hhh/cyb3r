// 应用入口仅装配页面、选择现有路径并挂载 Vue 运行时模板。
import * as Vue from 'vue';
import BorrowPage from './pages/BorrowPage.js';
import AdminPage from './pages/AdminPage.js';
import AnswersPage from './pages/AnswersPage.js';
const { createApp } = Vue;

// ==================== 路由 ====================
const path = window.location.pathname;
const isBorrowPage = path === '/borrow' || path === '/borrow/';
const isAdminPage = path === '/admin' || path === '/admin/';
const isAnswersPage = path === '/answers' || path === '/answers/';

// ==================== 创建应用 ====================
const app = createApp({
  setup() {
    const isAdmin = Vue.ref(isAdminPage);
    const isBorrow = Vue.ref(isBorrowPage);
    const isAnswers = Vue.ref(isAnswersPage);

    // 监听 popstate 处理浏览器前进后退
    Vue.onMounted(() => {
      window.addEventListener('popstate', () => {
        const p = window.location.pathname;
        isBorrow.value = p === '/borrow' || p === '/borrow/';
        isAdmin.value = p === '/admin' || p === '/admin/';
        isAnswers.value = p === '/answers' || p === '/answers/';
      });
    });

    return { isAdmin, isBorrow, isAnswers };
  },

  template: `
    <BorrowPage v-if="isBorrow" />
    <AdminPage v-else-if="isAdmin" />
    <AnswersPage v-else-if="isAnswers" />
    <div v-else class="redirect-page">
      <div class="redirect-content">
        <picture><source srcset="/assets/jnu-cyber-security-emblem.webp" type="image/webp" /><img class="redirect-emblem" src="/assets/jnu-cyber-security-emblem.png" width="76" height="76" alt="暨南大学网络空间安全学院院徽" loading="eager" decoding="async" /></picture>
        <h1>设备管理系统</h1>
        <p class="redirect-affiliation">暨南大学网络空间安全学院</p>
        <p class="redirect-status">正在跳转...</p>
      </div>
    </div>
  `,

  components: { BorrowPage, AdminPage, AnswersPage }
});

app.mount('#app');
