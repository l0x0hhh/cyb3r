// 图片选区展示：保存标准化比例，让借用卡片和详情页复用同一构图。
import * as Vue from 'vue';
const { createApp } = Vue;

// 用户端点击特效按需加载，管理员后台不创建 Canvas 也不请求特效脚本。
function loadBorrowFireworks(canvasEl) {
  if (!canvasEl) return Promise.resolve(() => {});

  function loadScript(src) {
    const existing = document.querySelector(`script[data-device-effect="${src}"]`);
    if (existing) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.deviceEffect = src;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  return loadScript('/js/anime.min.js')
    .then(() => loadScript('/js/fireworks.js'))
    .then(() => typeof window.initBorrowFireworks === 'function'
      ? window.initBorrowFireworks(canvasEl)
      : () => {})
    .catch(() => () => {});
}

// 批量工作簿共用同一组中文列定义，避免模板、预览和导出字段漂移。
const DEVICE_IMPORT_COLUMNS = [
  { header: '设备名称', key: 'name', required: true, width: 22 },
  { header: '设备型号', key: 'model', required: true, width: 20 },
  { header: '设备分类', key: 'categoryName', required: true, width: 18 },
  { header: '存放位置', key: 'location', required: false, width: 20 },
  { header: '设备说明', key: 'notes', required: false, width: 32 }
];

// 邮件模板编辑器只展示中文字段名，变量语法由按钮代为插入，避免管理员手写占位符。
const EMAIL_TEMPLATE_FIELDS = [
  { key: 'eventLabel', label: '事件名称' },
  { key: 'deviceName', label: '设备名称' },
  { key: 'deviceModel', label: '设备型号' },
  { key: 'deviceId', label: '设备编号' },
  { key: 'borrowerName', label: '借用人' },
  { key: 'borrowerId', label: '学号/工号' },
  { key: 'borrowerPhone', label: '联系电话' },
  { key: 'borrowerNameMasked', label: '借用人（始终脱敏）' },
  { key: 'borrowerIdMasked', label: '学号/工号（始终脱敏）' },
  { key: 'borrowerPhoneMasked', label: '联系电话（始终脱敏）' },
  { key: 'major', label: '专业/部门' },
  { key: 'purpose', label: '借用用途' },
  { key: 'borrowedAt', label: '借用时间' },
  { key: 'eventAt', label: '操作时间' },
  { key: 'returnNotes', label: '归还备注' }
];

const EMAIL_PREVIEW_EVENTS = [
  { key: 'borrow', label: '设备借出' },
  { key: 'return', label: '用户归还' },
  { key: 'adminReturn', label: '管理员归还' }
];

// ==================== 工具函数 ====================
const API_BASE = '';
// 上传前先在浏览器拦截超大文件，服务端仍会执行同样的硬限制。
const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;

// Excel 工作簿只在管理员实际使用导入、导出或模板功能时加载，避免进入普通用户首包。
let excelJsModulePromise = null;
async function loadExcelJS() {
  if (!excelJsModulePromise) excelJsModulePromise = import('exceljs');
  const module = await excelJsModulePromise;
  return module.default || module;
}

// 站点运行时长由浏览器本地计算，避免为页脚引入额外后端请求。
const SITE_LAUNCH_TIMESTAMP = Date.parse('2026-07-21T12:00:00+08:00');
function formatSiteRuntime(now = Date.now()) {
  const elapsedSeconds = Math.max(0, Math.floor((now - SITE_LAUNCH_TIMESTAMP) / 1000));
  const days = Math.floor(elapsedSeconds / 86400);
  const hours = Math.floor((elapsedSeconds % 86400) / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  return `本站已运行 ${days} 天 ${hours} 小时 ${minutes} 分 ${seconds} 秒`;
}

function useSiteRuntime() {
  const siteRuntime = Vue.ref(formatSiteRuntime());
  let timerId = null;
  Vue.onMounted(() => {
    timerId = window.setInterval(() => {
      siteRuntime.value = formatSiteRuntime();
    }, 1000);
  });
  Vue.onBeforeUnmount(() => {
    if (timerId !== null) window.clearInterval(timerId);
  });
  return siteRuntime;
}

// 每次页面装载从诗词和哲学中请求一言，失败时保留本地文案。
function useHitokoto() {
  const fallbackText = '山高水长，行稳致远。';
  const hitokotoText = Vue.ref('');
  const hitokotoUrl = Vue.ref('');
  const isHitokotoTyping = Vue.ref(false);
  let typingTimerId = null;
  let cursorTimerId = null;

  function clearTypewriterTimers() {
    if (typingTimerId !== null) window.clearInterval(typingTimerId);
    if (cursorTimerId !== null) window.clearTimeout(cursorTimerId);
    typingTimerId = null;
    cursorTimerId = null;
  }

  function typeHitokoto(text) {
    clearTypewriterTimers();
    const chars = Array.from(text);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      hitokotoText.value = text;
      isHitokotoTyping.value = false;
      return;
    }

    hitokotoText.value = '';
    isHitokotoTyping.value = true;
    let index = 0;
    typingTimerId = window.setInterval(() => {
      hitokotoText.value += chars[index];
      index += 1;
      if (index >= chars.length) {
        window.clearInterval(typingTimerId);
        typingTimerId = null;
        cursorTimerId = window.setTimeout(() => {
          isHitokotoTyping.value = false;
          cursorTimerId = null;
        }, 1000);
      }
    }, 60);
  }

  async function loadHitokoto() {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch('https://v1.hitokoto.cn/?c=i&c=k&max_length=40&encode=json', {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) return;
      const data = await response.json();
      if (typeof data.hitokoto !== 'string' || !data.hitokoto.trim()) throw new Error('一言内容为空');
      typeHitokoto(data.hitokoto.trim());
      hitokotoUrl.value = typeof data.uuid === 'string' && data.uuid
        ? `https://hitokoto.cn/?uuid=${encodeURIComponent(data.uuid)}`
        : '';
    } catch (error) {
      // 网络失败或超时播放本地文案，底栏无需打断用户操作。
      typeHitokoto(fallbackText);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  Vue.onMounted(loadHitokoto);
  Vue.onBeforeUnmount(() => {
    clearTypewriterTimers();
  });
  return { hitokotoText, hitokotoUrl, isHitokotoTyping };
}

async function apiCall(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  const sessionId = localStorage.getItem('sessionId');
  if (sessionId) opts.headers['x-session-id'] = sessionId;

  if (body && !(body instanceof FormData)) {
    opts.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    delete opts.headers['Content-Type'];
    opts.body = body;
  }

  const res = await fetch(API_BASE + url, opts);
  return res.json();
}

// 瀑布流列数与页面断点保持一致，避免 CSS 多列自动平衡造成空列。
function getWaterfallColumnCount() {
  if (window.matchMedia?.('(max-width: 700px)').matches) return 2;
  if (window.matchMedia?.('(max-width: 960px)').matches) return 3;
  return 4;
}

// 全局样式已迁移到 index.html，此处不再注入

// ==================== 统一借还门户 ====================
const BorrowPage = {
  template: `
    <div class="portal-page" :class="{ 'portal-page--feed': activeMode === 'borrow', 'portal-page--detail': activeMode === 'borrow' && selectedDeviceId }">
      <!-- 借还页面专用点击粒子层，管理后台不渲染此 Canvas。 -->
      <canvas class="fireworks" aria-hidden="true"></canvas>
      <header class="portal-header">
        <div class="portal-header__inner">
          <div class="portal-brand">
            <picture><source srcset="/assets/jnu-cyber-security-emblem.webp" type="image/webp" /><img class="portal-emblem" src="/assets/jnu-cyber-security-emblem.png" width="52" height="52" alt="暨南大学网络空间安全学院院徽" loading="eager" fetchpriority="high" decoding="async" /></picture>
            <div class="portal-brand__copy">
              <h1 class="portal-title">设备借还</h1>
              <p class="portal-affiliation">暨南大学网络空间安全学院</p>
              
            </div>
          </div>
        </div>
      </header>
      <nav class="portal-tabs" aria-label="借还导航">
        <button class="portal-tab" :class="{ 'portal-tab--active': activeMode === 'borrow' }" @click="switchMode('borrow')">借设备</button>
        <button class="portal-tab" :class="{ 'portal-tab--active': activeMode === 'return' }" @click="switchMode('return')">还设备</button>
      </nav>

      <main class="portal-main">
        <section v-if="activeMode === 'borrow'" class="portal-section">
          <!-- 详情固定覆盖列表，根页面滚动位置始终不变，返回时直接揭示原位置。 -->
          <!-- PC 端直接切换详情节点，移动端保留详情层过渡，避免返回时两套内容叠加。 -->
          <transition name="portal-detail-slide" :css="isMobileDetailLayout()" @after-leave="finishCloseDevice">
            <div v-if="selectedDeviceId" key="detail" class="portal-detail-view">
              <button class="portal-back" @click="closeDevice"><span aria-hidden="true">←</span> 返回</button>

              <div v-if="detailLoading && !device" class="portal-loading">正在加载设备信息…</div>
              <div v-else-if="noDevice" class="portal-empty">
                <h2>设备未找到</h2>
                <p>设备可能已被删除，请返回设备列表重新选择。</p>
              </div>

              <article v-else-if="device" class="portal-detail">
                <div class="portal-detail__media" :class="{ 'portal-detail__media--fixed': detailImageAspectRatio(device) || detailImageHeight(device) }" :style="detailMediaStyle(device)">
                  <img v-if="hasImage(device, device.image)" :src="device.image" :srcset="buildSrcset(device)" sizes="(max-width: 560px) 100vw, 720px" :alt="device.name" :width="device.imageWidth || undefined" :height="device.imageHeight || undefined" class="portal-media-image" :class="{ 'is-loaded': isImageLoaded(device.image) }" loading="eager" fetchpriority="high" decoding="async" @load="markImageLoaded(device.image, $event)" @error="markImageFailed(device.image)" />
                  <div v-else class="portal-image-placeholder">暂无设备图片</div>
                </div>
                <div class="portal-detail__body">
                  <div class="portal-detail__heading">
                    <div>
                      <h2>{{ device.name }}</h2>
                      <p>{{ device.model }}</p>
                    </div>
                    <span class="portal-status" :class="deviceStatusClass(device)">{{ deviceStatusText(device) }}</span>
                  </div>

                  <dl class="portal-facts">
                    <div><dt>存放位置</dt><dd>{{ device.location || '未填写' }}</dd></div>
                    <div v-if="device.notes"><dt>设备说明</dt><dd>{{ device.notes }}</dd></div>
                  </dl>

                  <div v-if="device.operationalStatus === 'offline'" class="portal-notice portal-notice--warning">
                    该设备当前已下线，暂时无法借用。
                  </div>

                  <div v-else-if="device.status === 'borrowed'" class="portal-borrower">
                    <p class="portal-borrower__title">当前借用情况</p>
                    <div class="portal-borrower__name">{{ currentBorrower?.name || '借用人信息暂不可用' }}</div>
                    <div class="portal-borrower__meta">
                      <span>专业：{{ currentBorrower?.major || '-' }}</span>
                      <span>手机：{{ currentBorrower?.phone || '-' }}</span>
                      <span>借用时间：{{ formatDate(currentBorrower?.borrowedAt) }}</span>
                    </div>
                    <button class="btn btn--success btn--full btn--lg" @click="switchMode('return')">前往还设备</button>
                  </div>

                  <button v-else class="btn btn--primary btn--full btn--lg" @click="showBorrowForm = true">填写信息并借用</button>
                </div>
              </article>
            </div>
          </transition>

            <div class="portal-device-list-view" :class="{ 'portal-device-list-view--covered': selectedDeviceId }" :aria-hidden="selectedDeviceId ? 'true' : null">
              <div class="portal-search-bar">
                <input class="portal-search" v-model.trim="searchQuery" placeholder="搜索设备名称或型号…" />
              </div>
              <div class="portal-chips">
                <button class="portal-chip" :class="{ 'portal-chip--active': activeCategory === '' }" @click="activeCategory = ''">全部</button>
                <button v-for="cat in categories" :key="cat.id" class="portal-chip" :class="{ 'portal-chip--active': activeCategory === cat.id }" @click="activeCategory = cat.id">{{ cat.name }}</button>
              </div>
              <div class="portal-section__heading">
                <div>
                  <h2>可借设备</h2>
                  <p>仅显示当前在线且无人借用的设备</p>
                </div>
                <transition name="portal-count" mode="out-in">
                  <span v-if="!loadingDevices" :key="filteredDevices.length" class="portal-count">{{ filteredDevices.length }} 台</span>
                </transition>
              </div>

              <div v-if="loadingDevices" class="portal-loading">正在加载可借设备…</div>
              <div v-else-if="filteredDevices.length === 0" class="portal-empty">
                <h2>暂时没有可借设备</h2>
                <p>设备可能正在使用或维修中，请稍后再来看看。</p>
              </div>
              <div v-else class="portal-device-list portal-device-list--waterfall">
                <!-- 按响应式列数轮流分配设备，保证前两台在移动端分别进入左右列。 -->
                <div v-for="column in deviceColumns" :key="'device-column-' + column.id" class="portal-device-list__column">
                  <article v-for="entry in column.items" :key="entry.item.id" class="portal-device-row" :class="'portal-device-row--' + categoryColorClass(entry.item.category)" :style="{ '--card-index': entry.index }">
                    <a :href="'/borrow?id=' + entry.item.id" :data-device-id="entry.item.id" role="button" @click.prevent="openDevice(entry.item.id)" class="portal-device-row__link">
                      <span class="portal-device-row__media" :style="{ aspectRatio: imageDisplayAspectRatio(entry.item) }">
                        <img v-if="hasImage(entry.item, entry.item.imageThumb || entry.item.image)" :src="entry.item.imageThumb || entry.item.image" :alt="entry.item.name" :width="entry.item.imageWidth || undefined" :height="entry.item.imageHeight || undefined" class="portal-media-image" :class="{ 'is-loaded': isImageLoaded(entry.item.imageThumb || entry.item.image) }" :style="{ objectPosition: '50% ' + imageDisplayPositionY(entry.item) + '%' }" :loading="entry.index < 2 ? 'eager' : 'lazy'" :fetchpriority="entry.index < 2 ? 'high' : 'auto'" decoding="async" @load="markImageLoaded(entry.item.imageThumb || entry.item.image, $event)" @error="markImageFailed(entry.item.imageThumb || entry.item.image)" />
                        <span v-else class="portal-image-placeholder portal-image-placeholder--small">暂无图片</span>
                      </span>
                      <span class="portal-device-row__content">
                        <span class="portal-device-row__icon" v-html="categoryIcon(entry.item.category)"></span>
                        <strong>{{ entry.item.name }}</strong>
                        <span>{{ entry.item.model }}</span>
                        <small>{{ entry.item.location || '位置未填写' }}</small>
                      </span>
                    </a>
                  </article>
                </div>
              </div>
            </div>
        </section>

        <section v-else class="portal-section">
          <div class="portal-section__heading portal-section__heading--stack">
            <h2>查询待归还设备</h2>
            <p>请输入借用时填写的完整手机号和姓名，只会显示你的借用记录。</p>
          </div>

          <div class="portal-lookup">
            <div class="form-group">
              <label>姓名 <span class="required">*</span></label>
              <input v-model.trim="returnLookup.borrowerName" class="input" autocomplete="name" placeholder="请输入借用人姓名" />
            </div>
            <div class="form-group">
              <label>完整手机号 <span class="required">*</span></label>
              <input v-model.trim="returnLookup.borrowerPhone" class="input" type="tel" inputmode="numeric" maxlength="11" autocomplete="tel" placeholder="请输入 11 位手机号" @keyup.enter="lookupReturns" />
            </div>
            <button class="btn btn--primary btn--full btn--lg" :disabled="submitting" @click="lookupReturns">
              {{ submitting ? '查询中…' : '查询待归还设备' }}
            </button>
          </div>

          <div v-if="returnSearched && returnResults.length === 0" class="portal-empty portal-empty--compact">
            <h2>你当前没有待归还的设备</h2>
            <p>请核对姓名和手机号是否与借用时填写的一致。</p>
          </div>

          <div v-else-if="returnResults.length" class="portal-return-list">
            <article v-for="record in returnResults" :key="record.recordId" class="portal-return-card">
              <div class="portal-return-card__top">
                <div class="portal-return-card__media">
                  <img v-if="hasImage(record, record.imageThumb || record.image)" :src="record.imageThumb || record.image" :alt="record.deviceName" class="portal-media-image" :class="{ 'is-loaded': isImageLoaded(record.imageThumb || record.image) }" loading="lazy" decoding="async" @load="markImageLoaded(record.imageThumb || record.image, $event)" @error="markImageFailed(record.imageThumb || record.image)" />
                  <div v-else class="portal-image-placeholder portal-image-placeholder--small">暂无图片</div>
                </div>
                <div class="portal-return-card__content">
                  <h3>{{ record.deviceName }}</h3>
                  <p>{{ record.deviceModel }}</p>
                  <small>借用时间：{{ formatDate(record.borrowedAt) }}</small>
                </div>
              </div>
              <div class="form-group">
                <label>归还备注（可选）</label>
                <textarea v-model="returnNotes[record.recordId]" class="input textarea" rows="2" placeholder="可填写设备当前状况"></textarea>
              </div>
              <button class="btn btn--success btn--full btn--lg" :disabled="returningRecordId === record.recordId" @click="doReturn(record)">
                {{ returningRecordId === record.recordId ? '归还中…' : '确认归还' }}
              </button>
            </article>
          </div>
        </section>
      </main>

      <div v-if="showBorrowForm && device" class="modal-overlay" @click.self="showBorrowForm = false">
        <div class="modal">
          <div class="modal-header">
            <div><h2>借用 {{ device.name }}</h2><p class="modal-tip">请填写真实信息，方便管理员联系。</p></div>
            <button class="modal-close" aria-label="关闭" @click="showBorrowForm = false">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>姓名 <span class="required">*</span></label>
              <input v-model.trim="form.borrowerName" class="input" autocomplete="name" placeholder="请输入你的姓名" />
            </div>
            <div class="form-group">
              <label>学号 / 工号</label>
              <input v-model.trim="form.borrowerId" class="input" placeholder="选填" />
            </div>
            <div class="form-group">
              <label>完整手机号 <span class="required">*</span></label>
              <input v-model.trim="form.borrowerPhone" class="input" type="tel" inputmode="numeric" maxlength="11" autocomplete="tel" placeholder="请输入 11 位手机号" />
            </div>
            <div class="form-group">
              <label>专业 <span class="required">*</span></label>
              <input v-model.trim="form.major" class="input" placeholder="如：网络空间安全" />
            </div>
            <div class="form-group">
              <label>用途 <span class="required">*</span></label>
              <textarea v-model.trim="form.purpose" class="input textarea" rows="3" placeholder="请说明本次借用用途"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn--ghost btn--lg" @click="showBorrowForm = false">取消</button>
            <button class="btn btn--primary btn--lg" :disabled="submitting" @click="doBorrow">{{ submitting ? '提交中…' : '确认借用' }}</button>
          </div>
        </div>
      </div>

      <footer class="page-footer">
        <div>暨南大学网络空间安全学院 · 设备借还系统</div>
        <div class="page-footer__hitokoto">
          <a class="page-footer__hitokoto-link" :href="hitokotoUrl || null" target="_blank" rel="noopener noreferrer" :aria-label="hitokotoText">{{ hitokotoText }}<span v-if="isHitokotoTyping" class="page-footer__hitokoto-cursor" aria-hidden="true"></span></a>
        </div>
        <!-- 备案号与运行时长合并为一行底栏元信息，减少页脚视觉占用。 -->
        <div class="page-footer__meta">
          <a class="page-footer__filing-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">豫ICP备2026040615号-1</a>
          <span class="page-footer__meta-separator" aria-hidden="true">·</span>
          <span class="page-footer__runtime">{{ siteRuntime }}</span>
        </div>
      </footer>
    </div>
  `,

  setup() {
    const siteRuntime = useSiteRuntime();
    const { hitokotoText, hitokotoUrl, isHitokotoTyping } = useHitokoto();
    const initialDeviceId = new URLSearchParams(window.location.search).get('id');
    const activeMode = Vue.ref('borrow');
    const availableDevices = Vue.ref([]);
    const searchQuery = Vue.ref('');
    const activeCategory = Vue.ref('');
    const categories = Vue.ref([]);
    const filteredDevices = Vue.computed(() => {
      let list = availableDevices.value;
      if (searchQuery.value) {
        const q = searchQuery.value.toLowerCase();
        list = list.filter(d => d.name.toLowerCase().includes(q) || d.model.toLowerCase().includes(q));
      }
      if (activeCategory.value) {
        list = list.filter(d => (d.category || 'cat-other') === activeCategory.value);
      }
      return list;
    });
    // 按顺序轮流分配到响应式列，少量设备也能横向填充瀑布流。
    const waterfallColumnCount = Vue.ref(getWaterfallColumnCount());
    const updateWaterfallColumnCount = () => {
      const nextColumnCount = getWaterfallColumnCount();
      if (nextColumnCount !== waterfallColumnCount.value) waterfallColumnCount.value = nextColumnCount;
    };
    const deviceColumns = Vue.computed(() => {
      const devices = filteredDevices.value;
      if (!devices.length) return [];
      const columnCount = Math.min(waterfallColumnCount.value, devices.length);
      const columns = Array.from({ length: columnCount }, (_, id) => ({ id, items: [] }));
      devices.forEach((item, index) => {
        const columnIndex = index % columnCount;
        columns[columnIndex].items.push({ item, index });
      });
      return columns;
    });
    function categoryIcon(icon) {
      const svgs = {
        camera: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="6" width="16" height="11" rx="2" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="12" r="3.5" stroke="currentColor" stroke-width="1.4"/><path d="M7 6L8 3h4l1 3" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
        lens: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="currentColor" stroke-width="1.4"/><path d="M13 13l4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
        stabilizer: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v14M3 10h14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M7 6l3-3 3 3M7 14l3 3 3-3M6 7l-3 3 3 3M14 7l3 3-3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        microphone: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="7" y="2" width="6" height="10" rx="3" stroke="currentColor" stroke-width="1.4"/><path d="M5 11a5 5 0 0010 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 17v-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
        other: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2 8h16" stroke="currentColor" stroke-width="1.4"/><path d="M8 8v8" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 1"/></svg>'
      };
      return svgs[icon] || svgs.other;
    }
    function categoryColorClass(catId) {
      const known = ['cat-camera', 'cat-lens', 'cat-stabilizer', 'cat-microphone', 'cat-other'];
      return known.includes(catId) ? catId : 'cat-other';
    }
    const loadingDevices = Vue.ref(false);
    const selectedDeviceId = Vue.ref(initialDeviceId || '');
    // 列表始终保留在原生文档流中，桌面详情关闭后恢复进入前的滚动位置。
    const lastSelectedDeviceId = Vue.ref('');
    const detailScrollY = Vue.ref(null);
    const device = Vue.ref(null);
    const currentBorrower = Vue.ref(null);
    const detailLoading = Vue.ref(false);
    const noDevice = Vue.ref(false);
    const showBorrowForm = Vue.ref(false);
    const submitting = Vue.ref(false);
    const returningRecordId = Vue.ref('');
    const returnSearched = Vue.ref(false);
    const returnResults = Vue.ref([]);
    const returnToken = Vue.ref('');
    const returnNotes = Vue.reactive({});
    const failedImages = Vue.reactive(new Set());
    const loadedImages = Vue.reactive(new Set());
    const imageRatios = Vue.reactive({});
    const form = Vue.reactive({
      borrowerName: '', borrowerId: '', borrowerPhone: '', major: '', purpose: ''
    });
    const returnLookup = Vue.reactive({ borrowerName: '', borrowerPhone: '' });

    function hasImage(item, source = item?.image) {
      return !!source && !failedImages.has(source);
    }

    function markImageFailed(source) {
      failedImages.add(source);
    }

    function markImageLoaded(source, event) {
      if (source) loadedImages.add(source);
      const image = event?.target;
      if (source && image?.naturalWidth > 0 && image?.naturalHeight > 0) {
        imageRatios[source] = `${image.naturalWidth} / ${image.naturalHeight}`;
      }
    }

    function isImageLoaded(source) {
      return !!source && loadedImages.has(source);
    }

    function imageAspectRatio(item) {
      const width = Number(item?.imageWidth);
      const height = Number(item?.imageHeight);
      if (width > 0 && height > 0) return `${width} / ${height}`;
      const sources = [item?.imageThumb, item?.image].filter(Boolean);
      return sources.map(source => imageRatios[source]).find(Boolean) || '4 / 3';
    }

    function imageDisplayAspectRatio(item) {
      const ratio = Number(item?.imageDisplayAspectRatio);
      if (Number.isFinite(ratio) && ratio >= 0.2 && ratio <= 20) return ratio;
      return imageAspectRatio(item);
    }

    function imageDisplayPositionY(item) {
      const position = Number(item?.imageDisplayPositionY);
      return Number.isInteger(position) && position >= 0 && position <= 100 ? position : 50;
    }

    function buildSrcset(item) {
      const thumb = item.imageThumb || item.image;
      const detail = item.image;
      if (thumb === detail) return '';
      return `${thumb} 480w, ${detail} 1280w`;
    }

    function detailImageHeight(item) {
      const height = Number(item?.imageDisplayHeight);
      return Number.isInteger(height) && height >= 120 && height <= 720 ? height : null;
    }

    function detailImageAspectRatio(item) {
      const ratio = Number(item?.imageDisplayAspectRatio);
      return Number.isFinite(ratio) && ratio >= 0.2 && ratio <= 20 ? ratio : null;
    }

    function detailImagePositionY(item) {
      const position = Number(item?.imageDisplayPositionY);
      return Number.isInteger(position) && position >= 0 && position <= 100 ? position : 50;
    }

    function detailMediaStyle(item) {
      const aspectRatio = detailImageAspectRatio(item);
      const height = detailImageHeight(item);
      const style = { '--detail-media-position-y': `${imageDisplayPositionY(item)}%` };
      if (aspectRatio) style['--detail-media-aspect-ratio'] = String(aspectRatio);
      if (!aspectRatio && height) style['--detail-media-height'] = `${height}px`;
      return style;
    }

    function deviceStatusText(item) {
      if (item.operationalStatus === 'offline') return '已下线';
      return item.status === 'borrowed' ? '已借出' : '可借用';
    }

    function deviceStatusClass(item) {
      if (item.operationalStatus === 'offline') return 'portal-status--offline';
      return item.status === 'borrowed' ? 'portal-status--borrowed' : 'portal-status--available';
    }

    async function loadAvailableDevices() {
      loadingDevices.value = true;
      try {
        const res = await apiCall('GET', '/api/devices/available');
        availableDevices.value = res.success ? res.data : [];
      } catch (e) {
        availableDevices.value = [];
      } finally {
        loadingDevices.value = false;
      }
    }

    async function loadDevice(deviceId, previewDevice = null) {
      detailLoading.value = true;
      noDevice.value = false;
      device.value = previewDevice ? { ...previewDevice } : null;
      currentBorrower.value = null;
      try {
        const res = await apiCall('GET', '/api/devices/' + deviceId + '/status');
        if (res.success) {
          device.value = res.data;
          currentBorrower.value = res.data.currentBorrower;
        } else {
          noDevice.value = true;
        }
      } catch (e) {
        noDevice.value = true;
      } finally {
        detailLoading.value = false;
      }
    }

    // 移动端以固定详情层进入，根文档保持原滚动位置不参与转场。
    function isMobileDetailLayout() {
      return window.matchMedia('(max-width: 560px)').matches;
    }

    function openDevice(deviceId) {
      lastSelectedDeviceId.value = deviceId;
      if (!isMobileDetailLayout()) detailScrollY.value = window.scrollY;
      selectedDeviceId.value = deviceId;
      history.pushState({ portalDeviceId: deviceId, portalScrollY: detailScrollY.value }, '', '/borrow?id=' + encodeURIComponent(deviceId));
      loadDevice(deviceId, availableDevices.value.find(item => item.id === deviceId) || null);
      if (!isMobileDetailLayout()) {
        Vue.nextTick(() => window.scrollTo({ top: 0, behavior: 'auto' }));
      }
    }

    function closeDevice() {
      // 列表内打开的详情使用真实历史返回；深链接则原地关闭并修正 URL。
      if (history.state?.portalDeviceId === selectedDeviceId.value) {
        history.back();
        return;
      }
      selectedDeviceId.value = '';
      history.replaceState({}, '', '/borrow');
    }

    // 详情退出后先清理状态，再恢复桌面端进入详情前的文档位置。
    function finishCloseDevice() {
      const savedDetailScrollY = detailScrollY.value;
      detailScrollY.value = null;
      device.value = null;
      currentBorrower.value = null;
      noDevice.value = false;
      Vue.nextTick(() => {
        if (savedDetailScrollY !== null && !isMobileDetailLayout()) {
          window.requestAnimationFrame(() => {
            window.scrollTo({ top: savedDetailScrollY, behavior: 'auto' });
          });
        }
        if (lastSelectedDeviceId.value && window.CSS?.escape) {
          document.querySelector(`[data-device-id="${CSS.escape(lastSelectedDeviceId.value)}"]`)?.focus({ preventScroll: true });
        }
      });
    }

    function switchMode(mode) {
      // 直接切换到还设备不做历史回退，避免异步 popstate 把当前 Tab 改回借设备。
      const leavesDetailImmediately = mode === 'return' && selectedDeviceId.value;
      if (leavesDetailImmediately) {
        selectedDeviceId.value = '';
        history.replaceState({}, '', '/borrow');
      }
      activeMode.value = mode;
      showBorrowForm.value = false;
      if (leavesDetailImmediately) finishCloseDevice();
      if (mode === 'borrow' && !selectedDeviceId.value) loadAvailableDevices();
    }

    function resetBorrowForm() {
      form.borrowerName = '';
      form.borrowerId = '';
      form.borrowerPhone = '';
      form.major = '';
      form.purpose = '';
    }

    async function doBorrow() {
      if (!form.borrowerName || !/^1\d{10}$/.test(form.borrowerPhone) || !form.major || !form.purpose) {
        alert('请完整填写姓名、11 位手机号、专业和用途');
        return;
      }
      submitting.value = true;
      try {
        const res = await apiCall('POST', '/api/records/borrow', {
          deviceId: device.value.id,
          ...form
        });
        if (res.success) {
          showBorrowForm.value = false;
          resetBorrowForm();
          alert('借用成功，请按约定时间归还设备。');
          await loadDevice(selectedDeviceId.value);
          await loadAvailableDevices();
        } else {
          alert(res.message || '借用失败');
        }
      } catch (e) {
        alert('网络错误，请重试');
      } finally {
        submitting.value = false;
      }
    }

    async function lookupReturns() {
      if (!returnLookup.borrowerName || !/^1\d{10}$/.test(returnLookup.borrowerPhone)) {
        alert('请输入借用时填写的姓名和 11 位完整手机号');
        return;
      }
      submitting.value = true;
      returnSearched.value = false;
      try {
        const res = await apiCall('POST', '/api/records/return-lookup', returnLookup);
        if (res.success) {
          returnResults.value = res.data.records || [];
          returnToken.value = res.data.returnToken || '';
          returnSearched.value = true;
        } else {
          alert(res.message || '查询失败');
        }
      } catch (e) {
        alert('网络错误，请重试');
      } finally {
        submitting.value = false;
      }
    }

    async function doReturn(record) {
      if (!confirm(`确定归还「${record.deviceName}」吗？`)) return;
      returningRecordId.value = record.recordId;
      try {
        const res = await apiCall('POST', '/api/records/return', {
          recordId: record.recordId,
          returnToken: returnToken.value,
          notes: returnNotes[record.recordId] || ''
        });
        if (res.success) {
          returnResults.value = returnResults.value.filter(item => item.recordId !== record.recordId);
          delete returnNotes[record.recordId];
          returnSearched.value = true;
          await loadAvailableDevices();
          alert('归还成功，谢谢配合。');
        } else {
          alert(res.message || '归还失败');
        }
      } catch (e) {
        alert('网络错误，请重试');
      } finally {
        returningRecordId.value = '';
      }
    }

    function formatDate(iso) {
      if (!iso) return '-';
      const d = new Date(iso);
      const pad = value => String(value).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function handlePopState() {
      const deviceId = new URLSearchParams(window.location.search).get('id');
      activeMode.value = 'borrow';
      selectedDeviceId.value = deviceId || '';
      if (deviceId) {
        lastSelectedDeviceId.value = deviceId;
        loadDevice(deviceId, availableDevices.value.find(item => item.id === deviceId) || null);
      }
    }

    let destroyBorrowFireworks = () => {};
    let borrowFireworksUnmounted = false;
    Vue.onMounted(async () => {
      const canvasEl = document.querySelector('.fireworks');
      const destroy = await loadBorrowFireworks(canvasEl);
      if (borrowFireworksUnmounted) {
        destroy();
      } else {
        destroyBorrowFireworks = destroy;
      }
      // 深链接详情也预载设备列表，返回时无需再次请求和重建瀑布流。
      loadAvailableDevices();
      if (selectedDeviceId.value) {
        lastSelectedDeviceId.value = selectedDeviceId.value;
        loadDevice(selectedDeviceId.value);
      }
      window.addEventListener('popstate', handlePopState);
      window.addEventListener('resize', updateWaterfallColumnCount);
      apiCall('GET', '/api/categories').then(res => { if (res.success) categories.value = res.data; });
    });
    Vue.onBeforeUnmount(() => {
      borrowFireworksUnmounted = true;
      destroyBorrowFireworks();
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('resize', updateWaterfallColumnCount);
    });

    return {
      activeMode, availableDevices, filteredDevices, deviceColumns, searchQuery, activeCategory, categories, loadingDevices, selectedDeviceId, device, currentBorrower,
      detailLoading, noDevice, showBorrowForm, submitting, returningRecordId, returnSearched,
      returnResults, returnToken, returnNotes, form, returnLookup, hasImage, markImageFailed,
      markImageLoaded, isImageLoaded, imageAspectRatio, imageDisplayAspectRatio, imageDisplayPositionY, buildSrcset, detailImageHeight, detailImageAspectRatio, detailMediaStyle,
      deviceStatusText, deviceStatusClass, isMobileDetailLayout, openDevice, closeDevice, finishCloseDevice, switchMode, doBorrow,
      lookupReturns, doReturn, formatDate, categoryIcon, categoryColorClass, siteRuntime, hitokotoText, hitokotoUrl, isHitokotoTyping
    };
  }
};

// ==================== 管理后台组件 ====================
const AdminPage = {
  template: `
    <div class="admin-page">
      <!-- 顶部导航 -->
      <nav class="admin-nav">
        <div class="nav-brand">
          <picture><source srcset="/assets/jnu-cyber-security-emblem.webp" type="image/webp" /><img class="nav-emblem" src="/assets/jnu-cyber-security-emblem.png" width="38" height="38" alt="暨南大学网络空间安全学院院徽" loading="eager" decoding="async" /></picture>
          <div class="nav-brand__copy">
            <span class="nav-brand__title">设备管理后台</span>
            <small class="nav-affiliation">暨南大学网络空间安全学院</small>
          </div>
        </div>
        <div class="nav-actions">
          <span v-if="isLoggedIn" class="nav-user">👤 {{ adminUser?.username || '管理员' }} · {{ adminUser?.role === 'super_admin' ? '超级管理员' : '管理员' }}</span>
          <button v-if="isLoggedIn" class="btn btn--ghost btn--sm" @click="showPasswordModal = true">修改密码</button>
          <button v-if="isLoggedIn" class="btn btn--ghost btn--sm" @click="doLogout">退出</button>
        </div>
      </nav>

      <!-- 登录 -->
      <div v-if="!isLoggedIn" class="login-card">
        <picture><source srcset="/assets/jnu-cyber-security-emblem.webp" type="image/webp" /><img class="login-emblem" src="/assets/jnu-cyber-security-emblem.png" width="88" height="88" alt="暨南大学网络空间安全学院院徽" loading="eager" decoding="async" /></picture>
        <h2 class="login-title">管理员登录</h2>
        <p class="login-subtitle">暨南大学网络空间安全学院</p>
        <div class="form-group">
          <label>管理员账号</label>
          <input v-model.trim="username" type="text" placeholder="请输入管理员账号" class="input" autocomplete="username" @keyup.enter="doLogin" />
        </div>
        <div class="form-group">
          <label>管理密码</label>
          <input v-model="password" type="password" placeholder="请输入管理密码" class="input" autocomplete="current-password" @keyup.enter="doLogin" />
        </div>
        <button class="btn btn--primary btn--full btn--lg" :disabled="submitting" @click="doLogin">
          {{ submitting ? '验证中...' : '登 录' }}
        </button>
        <p v-if="loginError" class="login-error">{{ loginError }}</p>
      </div>

      <div v-else class="admin-layout">
        <div class="admin-shell">
          <!-- 桌面端分组侧栏，移动端复用为抽屉；菜单仍由服务端权限过滤。 -->
          <aside class="admin-sidebar" :class="{ 'admin-sidebar--collapsed': adminNavigationCollapsed }">
            <div class="admin-sidebar__header">
              <span class="admin-sidebar__eyebrow">工作台</span>
              <button class="admin-sidebar__collapse" type="button" title="收起导航" aria-label="收起导航" @click="toggleAdminNavigation"><span class="admin-sidebar__chevron" aria-hidden="true"></span></button>
            </div>
            <nav class="admin-menu" aria-label="管理后台导航">
              <section v-for="group in visibleNavigationGroups" :key="group.key" class="admin-menu__group">
                <h2>{{ group.label }}</h2>
                <button v-for="item in group.items" :key="item.key" type="button" class="admin-menu__item" :class="{ 'admin-menu__item--active': activeTab === item.key }" @click="selectAdminTab(item.key)">
                  <span class="admin-menu__icon" aria-hidden="true">{{ item.icon }}</span>
                  <span class="admin-menu__label">{{ item.label }}</span>
                  <span v-if="item.key === 'records' && activeRecords.length" class="tab-badge">{{ activeRecords.length }}</span>
                  <span v-if="item.key === 'archived' && archivedRecords.length" class="tab-badge">{{ archivedRecords.length }}</span>
                </button>
              </section>
            </nav>
          </aside>
          <div v-if="adminDrawerOpen" class="admin-drawer__backdrop" @click="toggleAdminDrawer"></div>
          <aside class="admin-drawer" :class="{ 'admin-drawer--open': adminDrawerOpen }" aria-label="移动端导航">
            <div class="admin-drawer__header"><strong>管理导航</strong><button type="button" class="modal-close" aria-label="关闭导航" @click="toggleAdminDrawer">×</button></div>
            <nav class="admin-menu">
              <section v-for="group in visibleNavigationGroups" :key="group.key" class="admin-menu__group">
                <h2>{{ group.label }}</h2>
                <button v-for="item in group.items" :key="item.key" type="button" class="admin-menu__item" :class="{ 'admin-menu__item--active': activeTab === item.key }" @click="selectAdminTab(item.key)"><span class="admin-menu__icon" aria-hidden="true">{{ item.icon }}</span><span class="admin-menu__label">{{ item.label }}</span></button>
              </section>
            </nav>
          </aside>
          <div class="admin-main">
            <button type="button" class="admin-mobile-menu-button" title="打开导航" aria-label="打开导航" @click="toggleAdminDrawer">☰</button>

        <!-- 超级管理员专属账号管理面板：普通管理员不会看到该入口。 -->
        <div v-if="activeTab === 'admin-management' && isSuperAdmin" class="tab-content">
          <div class="section-header">
            <div>
              <h2 class="section-title">管理员管理</h2>
              <p class="operation-log-subtitle">为管理员分配功能权限，超级管理员始终拥有全部权限</p>
            </div>
            <button class="btn btn--primary btn--sm" @click="openAddAdmin">+ 新增管理员</button>
          </div>
          <p v-if="adminManagementMessage" class="email-settings-message" :class="{ 'email-settings-message--error': adminManagementError }">{{ adminManagementMessage }}</p>
          <div v-if="adminUsers.length === 0" class="empty-state"><p>暂无管理员账号</p></div>
          <div v-else class="admin-user-list">
            <article v-for="user in adminUsers" :key="user.id" class="admin-user-item">
              <div class="admin-user-item__identity">
                <strong>{{ user.username }}</strong>
                <span class="tag" :class="user.role === 'super_admin' ? 'tag--success' : ''">{{ user.role === 'super_admin' ? '超级管理员' : '管理员' }}</span>
              </div>
              <div class="admin-user-item__permissions">
                <span v-if="user.role === 'super_admin'">全部功能</span>
                <span v-else>{{ permissionLabelsFor(user.permissions).join('、') || '未分配功能' }}</span>
              </div>
              <div v-if="user.role !== 'super_admin'" class="admin-user-item__actions">
                <button class="btn btn--ghost btn--xs" @click="openEditAdminPermissions(user)">配置权限</button>
                <button class="btn btn--ghost btn--xs btn--danger-text" @click="deleteAdmin(user)">删除管理员</button>
              </div>
            </article>
          </div>
        </div>

        <!-- 设备列表 -->
        <div v-if="activeTab === 'devices'" class="tab-content">
          <!-- 设备工具栏按普通/选择状态切换，窄屏不同时堆叠两类操作。 -->
          <div class="section-header section-header--devices" :class="{ 'section-header--selection': selectedDeviceIds.length }">
            <div class="device-toolbar__heading">
              <h2 class="section-title">设备列表</h2>
              <!-- 设备视图切换仅改变管理端布局，并在本机记住管理员选择。 -->
              <div class="device-view-toggle" role="group" aria-label="设备视图">
                <button class="device-view-toggle__button" :class="{ 'device-view-toggle__button--active': deviceViewMode === 'card' }" type="button" title="卡片视图" aria-label="卡片视图" @click="setDeviceViewMode('card')">▦</button>
                <button class="device-view-toggle__button" :class="{ 'device-view-toggle__button--active': deviceViewMode === 'list' }" type="button" title="列表视图" aria-label="列表视图" @click="setDeviceViewMode('list')">☰</button>
              </div>
            </div>

            <div v-if="!selectedDeviceIds.length" class="device-toolbar__normal">
              <div class="device-toolbar__desktop-actions">
                <!-- 桌面端恢复高频工具栏：数据工具、二维码和新增设备直接可见。 -->
                <button class="btn btn--ghost btn--sm" type="button" @click="downloadDeviceImportTemplate">下载模板</button>
                <button class="btn btn--ghost btn--sm" type="button" @click="openDeviceImport">导入设备</button>
                <button class="btn btn--ghost btn--sm" type="button" :disabled="devices.length === 0" @click="exportDevices">导出设备</button>
                <span class="device-toolbar__separator" aria-hidden="true"></span>
                <button class="btn btn--ghost btn--sm" type="button" @click="generatePortalQR">统一二维码</button>
                <button class="btn btn--primary btn--sm" @click="showAddDevice = true">+ 添加设备</button>
              </div>

              <div class="device-toolbar__mobile-actions">
                <button class="btn btn--primary btn--sm device-toolbar__mobile-add" @click="showAddDevice = true">+ 添加设备</button>
                <details class="mobile-device-more">
                  <summary class="mobile-device-more__trigger" title="更多设备操作" aria-label="更多设备操作">⋯</summary>
                  <div class="mobile-device-more__menu">
                    <button type="button" @click="closeMobileDeviceTools($event); downloadDeviceImportTemplate()">下载模板</button>
                    <button type="button" @click="closeMobileDeviceTools($event); openDeviceImport()">导入设备</button>
                    <button type="button" :disabled="devices.length === 0" @click="closeMobileDeviceTools($event); exportDevices()">导出设备</button>
                    <button type="button" @click="closeMobileDeviceTools($event); generatePortalQR()">统一二维码</button>
                  </div>
                </details>
              </div>
            </div>

            <div v-else class="device-toolbar__selection">
              <span class="batch-selection-count">已选 {{ selectedDeviceIds.length }} 台</span>
              <button class="btn btn--ghost btn--sm device-toolbar__category" @click="openBatchCategory">
                <span class="device-toolbar__desktop-label">批量分类</span>
                <span class="device-toolbar__mobile-label">分类</span>
              </button>
              <span class="device-toolbar__selection-separator" aria-hidden="true"></span>
              <div class="device-toolbar__desktop-status-actions">
                <button class="btn btn--primary btn--sm" @click="openBatchOnline">批量上线</button>
                <button class="btn btn--danger btn--sm" @click="openBatchOffline">批量下线</button>
              </div>
              <details class="mobile-device-more device-toolbar__mobile-batch-more">
                <summary class="mobile-device-more__trigger" title="更多批量操作" aria-label="更多批量操作">⋯</summary>
                <div class="mobile-device-more__menu">
                  <button type="button" @click="closeMobileDeviceTools($event); openBatchOnline()">批量上线</button>
                  <button type="button" class="mobile-device-more__danger" @click="closeMobileDeviceTools($event); openBatchOffline()">批量下线</button>
                </div>
              </details>
              <button class="device-toolbar__clear" type="button" title="清空选择" aria-label="清空选择" @click="clearDeviceSelection">×</button>
            </div>
          </div>

          <div v-if="devices.length === 0" class="empty-state">
            <div class="empty-icon">📭</div>
            <p>还没有设备，点击上方按钮添加吧</p>
          </div>

          <div v-else class="device-grid" :class="{ 'device-grid--list': deviceViewMode === 'list' }">
            <div v-for="dev in devices" :key="dev.id" class="device-card" :class="{ 'device-card--borrowed': dev.status === 'borrowed', 'device-card--offline': dev.operationalStatus === 'offline' }">
              <!-- 选择状态只保存在当前页面，用于批量状态操作，不写入设备数据。 -->
              <label class="device-select" :class="{ 'device-select--checked': selectedDeviceIds.includes(dev.id) }" @click.stop>
                <input type="checkbox" :checked="selectedDeviceIds.includes(dev.id)" @change="toggleDeviceSelection(dev.id)" />
                <span>选择</span>
              </label>
              <div class="device-card-img">
              <img v-if="hasAdminImage(dev)" :src="adminImageSource(dev)" :alt="dev.name" class="device-card-img__image" :class="{ 'is-loaded': isAdminImageLoaded(adminImageSource(dev)) }" loading="lazy" decoding="async" @load="markAdminImageLoaded(adminImageSource(dev))" @error="markAdminImageFailed(adminImageSource(dev))" />
                <div v-else class="device-card-img-placeholder">📷</div>
              </div>
              <div class="device-card-body">
                <div class="device-card-title">{{ dev.name }}</div>
                <div class="device-card-sub">{{ dev.model }}</div>
                <div class="device-card-meta">
                  <span class="tag" :class="dev.status === 'borrowed' ? 'tag--danger' : 'tag--success'">
                    {{ dev.status === 'borrowed' ? '已借出' : '可借' }}
                  </span>
                  <span class="tag" :class="dev.operationalStatus === 'offline' ? 'tag--offline' : 'tag--online'">
                    {{ dev.operationalStatus === 'offline' ? '离线' : '在线' }}
                  </span>
                </div>
                <div v-if="dev.location" class="device-card-location">📍 {{ dev.location }}</div>
                <div v-if="dev.operationalStatus === 'offline' && dev.offlineReason" class="device-card-reason">离线原因：{{ dev.offlineReason }}</div>
              </div>
              <div class="device-card-actions">
                <button class="btn btn--ghost btn--xs" @click="generateDeviceQR(dev)">设备二维码</button>
                <button class="btn btn--ghost btn--xs" :disabled="dev.status === 'borrowed' && dev.operationalStatus !== 'offline'" @click="toggleOperationalStatus(dev)">
                  {{ dev.operationalStatus === 'offline' ? '上线' : '下线' }}
                </button>
                <button class="btn btn--ghost btn--xs" @click="editDevice(dev)">✏️</button>
                <button class="btn btn--ghost btn--xs btn--danger-text" @click="deleteDevice(dev)">🗑️</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 借用统计只展示管理员聚合数据，不在浏览器重复计算历史口径。 -->
        <div v-if="activeTab === 'statistics'" class="tab-content">
          <div class="section-header statistics-header">
            <div>
              <h2 class="section-title">借用记录统计</h2>
              <p class="statistics-subtitle">归档记录仍计入历史统计，永久删除的记录不再计入</p>
            </div>
            <div class="statistics-range" role="group" aria-label="统计时间范围">
              <button type="button" :class="{ 'statistics-range__button--active': statisticsRange === '7d' }" class="statistics-range__button" @click="setStatisticsRange('7d')">近 7 天</button>
              <button type="button" :class="{ 'statistics-range__button--active': statisticsRange === '30d' }" class="statistics-range__button" @click="setStatisticsRange('30d')">近 30 天</button>
              <button type="button" :class="{ 'statistics-range__button--active': statisticsRange === 'all' }" class="statistics-range__button" @click="setStatisticsRange('all')">全部</button>
            </div>
          </div>

          <div v-if="statisticsLoading && !statisticsReady" class="portal-loading">正在汇总借用记录...</div>
          <div v-else-if="statisticsError && !statisticsReady" class="empty-state"><p>{{ statisticsError }}</p></div>
          <template v-else>
            <div class="statistics-panel" :class="{ 'statistics-panel--updating': statisticsLoading }" :aria-busy="statisticsLoading ? 'true' : 'false'">
              <p v-if="statisticsError" class="statistics-update-message statistics-update-message--error">{{ statisticsError }}</p>
              <!-- 概览数字复用借用页的最终值切换，避免小数值逐帧计数时的跳字。 -->
              <div class="statistics-summary">
                <div class="statistics-metric"><span>借用次数</span><transition name="portal-count" mode="out-in"><strong :key="statisticsDisplay.summary.borrowCount">{{ statisticsDisplay.summary.borrowCount }}</strong></transition></div>
                <div class="statistics-metric"><span>已归还</span><transition name="portal-count" mode="out-in"><strong :key="statisticsDisplay.summary.returnedCount">{{ statisticsDisplay.summary.returnedCount }}</strong></transition></div>
                <div class="statistics-metric"><span>当前借出</span><transition name="portal-count" mode="out-in"><strong :key="statisticsDisplay.summary.activeCount">{{ statisticsDisplay.summary.activeCount }}</strong></transition></div>
                <div class="statistics-metric"><span>设备使用率</span><transition name="portal-count" mode="out-in"><strong :key="statisticsDisplay.summary.utilizationRate">{{ statisticsDisplay.summary.utilizationRate }}%</strong></transition><small>{{ statisticsDisplay.summary.usedDeviceCount }}/{{ statisticsDisplay.summary.deviceCount }} 台</small></div>
              </div>

              <div class="statistics-layout">
                <section class="statistics-section">
                  <div class="statistics-section__header"><h3>热门设备</h3><span>按借用次数排序</span></div>
                  <div v-if="statistics.popularDevices.length === 0" class="statistics-empty">所选范围内暂无借用记录</div>
                  <ol v-else class="statistics-popular">
                    <li v-for="(item, index) in statistics.popularDevices" :key="item.deviceId">
                      <span class="statistics-popular__rank">{{ index + 1 }}</span>
                      <span class="statistics-popular__device"><strong>{{ item.deviceName }}</strong><small>{{ item.deviceModel }}</small></span>
                      <span class="statistics-popular__count">{{ item.borrowCount }} 次</span>
                    </li>
                  </ol>
                </section>

                <section class="statistics-section statistics-section--trend">
                  <div class="statistics-section__header"><h3>借用趋势</h3><span>按借用日期统计</span></div>
                  <div v-if="statistics.trend.length === 0" class="statistics-empty">所选范围内暂无趋势数据</div>
                  <div v-else :key="statisticsTrendAnimationKey" class="statistics-trend" :class="{ 'statistics-trend--dense': statistics.trend.length > 14 }" :style="{ '--trend-count': statistics.trend.length }">
                    <div v-for="(point, trendIndex) in statistics.trend" :key="point.date" class="statistics-trend__item" :title="formatTrendDate(point.date) + '：' + point.borrowCount + ' 次'">
                      <span class="statistics-trend__value">{{ point.borrowCount || '' }}</span>
                      <span class="statistics-trend__bar statistics-trend__bar--animated" :class="{ 'statistics-trend__bar--zero': !point.borrowCount }" :style="{ '--trend-height': trendBarHeight(point.borrowCount), '--trend-index': trendIndex }"></span>
                      <small>{{ formatTrendDate(point.date) }}</small>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </template>
        </div>

        <!-- 操作日志只展示后端保存的脱敏管理动作。 -->
        <div v-if="activeTab === 'operation-logs'" class="tab-content">
          <div class="section-header operation-log-header">
            <div>
              <h2 class="section-title">管理员操作日志</h2>
              <p class="operation-log-subtitle">记录设备新增、批量导入、批量状态、编辑、下线和管理员归还</p>
            </div>
            <label class="operation-log-filter">
              <span>操作类型</span>
              <select v-model="operationLogFilter" class="input">
                <option value="all">全部操作</option>
                <option value="device_created">新增设备</option>
                <option value="devices_batch_imported">批量导入</option>
                <option value="devices_batch_categorized">批量分类</option>
                <option value="devices_batch_onlined">批量上线</option>
                <option value="devices_batch_offlined">批量下线</option>
                <option value="device_updated">编辑设备</option>
                <option value="device_offlined">设备下线</option>
                <option value="admin_returned">管理员归还</option>
              </select>
            </label>
          </div>

          <div v-if="filteredOperationLogs.length === 0" class="empty-state">
            <p>{{ operationLogs.length ? '当前筛选下暂无日志' : '暂无管理员操作日志' }}</p>
          </div>
          <div v-else class="operation-log-list">
            <article v-for="log in filteredOperationLogs" :key="log.id" class="operation-log-item">
              <span class="operation-log-item__marker" :class="operationLogActionClass(log.action)" aria-hidden="true"></span>
              <div class="operation-log-item__body">
                <div class="operation-log-item__heading">
                  <span class="operation-log-item__action">{{ operationLogActionLabel(log.action) }}</span>
                  <time :datetime="log.createdAt">{{ formatDate(log.createdAt) }}</time>
                </div>
                <strong>{{ log.targetName }}</strong>
                <p>{{ log.summary }}</p>
                <small>设备 ID：{{ log.targetId }}</small>
              </div>
            </article>
          </div>
        </div>

        <!-- 邮件通知设置只允许管理员访问，SMTP 密码由后端加密保存。 -->
        <div v-if="activeTab === 'email-notifications'" class="tab-content">
          <div class="section-header email-settings-header">
            <div>
              <h2 class="section-title">邮件通知</h2>
              <p class="operation-log-subtitle">配置借还事件提醒和 SMTP 发件账号</p>
            </div>
            <label class="email-settings-switch">
              <input v-model="emailSettings.enabled" type="checkbox" />
              <span>启用通知</span>
            </label>
          </div>

          <p v-if="emailSettingsMessage" class="email-settings-message" :class="{ 'email-settings-message--error': emailSettingsError }">{{ emailSettingsMessage }}</p>

          <div class="email-settings-layout">
            <section class="email-settings-section">
              <div class="statistics-section__header"><h3>通知规则</h3><span>按事件发送</span></div>
              <label class="email-settings-check"><input v-model="emailSettings.notifyBorrow" type="checkbox" /> <span>设备借出</span></label>
              <label class="email-settings-check"><input v-model="emailSettings.notifyReturn" type="checkbox" /> <span>用户归还</span></label>
              <label class="email-settings-check"><input v-model="emailSettings.notifyAdminReturn" type="checkbox" /> <span>管理员归还</span></label>
              <div class="form-group email-settings-field">
                <label>接收邮箱 <span class="required">*</span></label>
                <textarea v-model="emailSettings.recipientsText" class="input textarea" rows="3" placeholder="每行一个邮箱"></textarea>
              </div>
            </section>

            <section class="email-settings-section">
              <div class="statistics-section__header"><h3>SMTP 发件账号</h3><span v-if="emailSettings.smtp.secretConfigured" class="email-settings-status">凭据已保存</span></div>
              <div class="form-group email-settings-field">
                <label>SMTP 服务器 <span class="required">*</span></label>
                <input v-model.trim="emailSettings.smtp.host" class="input" placeholder="例如 smtp.qq.com" autocomplete="off" />
              </div>
              <div class="email-settings-row">
                <div class="form-group email-settings-field">
                  <label>端口 <span class="required">*</span></label>
                  <input v-model.number="emailSettings.smtp.port" class="input" type="number" min="1" max="65535" />
                </div>
                <div class="form-group email-settings-field">
                  <label>加密方式 <span class="required">*</span></label>
                  <select v-model="emailSettings.smtp.security" class="input">
                    <option value="ssl">SSL/TLS（465）</option>
                    <option value="starttls">STARTTLS（587）</option>
                    <option value="none">无加密（仅内网）</option>
                  </select>
                </div>
              </div>
              <div class="form-group email-settings-field">
                <label>发件邮箱 <span class="required">*</span></label>
                <input v-model.trim="emailSettings.smtp.username" class="input" type="email" placeholder="发件邮箱地址" autocomplete="off" />
              </div>
              <div class="form-group email-settings-field">
                <label>邮箱密码 / 授权码 <span class="required">*</span></label>
                <input v-model="emailSettings.smtp.secret" class="input" type="password" placeholder="留空表示保持已保存凭据" autocomplete="new-password" />
              </div>
            </section>
          </div>

          <!-- 模板编辑器把变量、预览和隐私状态放在同一工作区，管理员无需记忆占位符语法。 -->
          <section class="email-settings-section email-settings-templates">
            <div class="statistics-section__header email-template-header">
              <div><h3>邮件内容</h3><span>当前编辑：{{ emailTemplateLabel }}模板，下方预览会同步更新</span></div>
              <label class="email-settings-check email-privacy-toggle">
                <input v-model="emailSettings.maskSensitiveData" type="checkbox" />
                <span>隐藏借用人信息</span>
              </label>
            </div>
            <p v-if="emailSettings.maskSensitiveData" class="email-privacy-note">预览和正式通知会隐藏姓名、学号/工号及手机号。</p>
            <p v-else class="email-privacy-note email-privacy-note--warning">已关闭脱敏：邮件将包含完整借用人信息，请确认接收邮箱范围。</p>

            <div v-if="emailTemplateErrors.length" class="email-template-errors" role="alert">
              <span v-for="error in emailTemplateErrors" :key="error">{{ error }}</span>
            </div>

            <div class="email-template-editor-grid">
              <div class="email-template-editors">
                <div class="form-group email-settings-field">
                  <label for="email-subject-template">邮件主题</label>
                  <input id="email-subject-template" ref="emailSubjectInput" v-model="emailSettings.templates[emailPreviewEvent].subject" class="input" maxlength="160" />
                  <div class="email-variable-toolbar" aria-label="插入主题字段">
                    <span>插入字段</span>
                    <button v-for="field in emailTemplateFields" :key="'subject-' + field.key" type="button" class="email-variable-button" :title="'插入' + field.label" @click="insertEmailVariable(field.key, 'subject')">{{ field.label }}</button>
                  </div>
                </div>
                <div class="form-group email-settings-field">
                  <label for="email-body-template">邮件正文</label>
                  <textarea id="email-body-template" ref="emailBodyInput" v-model="emailSettings.templates[emailPreviewEvent].body" class="input textarea email-body-editor" rows="14"></textarea>
                  <div class="email-variable-toolbar" aria-label="插入正文字段">
                    <span>插入字段</span>
                    <button v-for="field in emailTemplateFields" :key="'body-' + field.key" type="button" class="email-variable-button" :title="'插入' + field.label" @click="insertEmailVariable(field.key, 'body')">{{ field.label }}</button>
                  </div>
                </div>
              </div>

              <aside class="email-template-preview" aria-label="邮件预览">
                <div class="email-template-preview__header">
                  <div><h4>邮件预览</h4><span>使用示例数据</span></div>
                  <select v-model="emailPreviewEvent" class="input email-preview-event" aria-label="预览通知类型">
                    <option v-for="event in emailPreviewEvents" :key="event.key" :value="event.key">{{ event.label }}</option>
                  </select>
                </div>
                <div class="email-template-preview__mail">
                  <strong>{{ emailTemplatePreview.subject || '（未填写主题）' }}</strong>
                  <pre>{{ emailTemplatePreview.body || '（未填写正文）' }}</pre>
                </div>
              </aside>
            </div>
          </section>

          <div class="modal-footer email-settings-actions">
            <button class="btn btn--ghost btn--lg" :disabled="emailSettingsSaving || emailSettingsTesting || emailTemplateErrors.length" @click="sendEmailTest">发送当前模板测试邮件</button>
            <button class="btn btn--primary btn--lg" :disabled="emailSettingsSaving || emailSettingsTesting || emailTemplateErrors.length" @click="saveEmailSettings">
              {{ emailSettingsSaving ? '保存中...' : '保存邮件设置' }}
            </button>
          </div>
        </div>

        <!-- 当前借出 -->
        <div v-if="activeTab === 'records'" class="tab-content">
          <div class="section-header">
            <h2 class="section-title">当前借出情况</h2>
          </div>

          <div v-if="activeRecords.length === 0" class="empty-state">
            <div class="empty-icon">🎉</div>
            <p>所有设备都已归还</p>
          </div>

          <div v-else class="record-list">
            <div v-for="rec in activeRecords" :key="rec.id" class="record-card record-card--active">
              <div class="record-card-header">
                <div class="record-device">
                  <span class="record-device-icon">📋</span>
                  <div>
                    <div class="record-device-name">{{ rec.deviceName }}</div>
                    <div class="record-device-model">{{ rec.deviceModel }}</div>
                  </div>
                </div>
                <span class="tag tag--danger">借出中</span>
              </div>

              <div class="record-card-body">
                <div class="record-person">
                  <span class="record-person-name">{{ rec.borrowerName }}</span>
                  <span v-if="rec.borrowerId" class="record-person-id">{{ rec.borrowerId }}</span>
                </div>
                <div class="record-contact">
                  <a v-if="rec.borrowerPhone" :href="'tel:' + rec.borrowerPhone" class="record-contact-item">
                    📞 {{ rec.borrowerPhone }}
                  </a>
                  <span v-if="rec.major" class="record-contact-item">专业：{{ rec.major }}</span>
                </div>
                <div class="record-time">
                  借用时间：{{ formatDate(rec.createdAt) }}
                </div>
                <div class="record-card-actions">
                  <button class="btn btn--ghost btn--xs" @click="editActiveRecord(rec)">修改借用信息</button>
                  <button class="btn btn--success btn--xs" @click="forceReturnRecord(rec)">管理员归还</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 全部记录 -->
        <div v-if="activeTab === 'all-records'" class="tab-content">
          <div class="section-header">
            <h2 class="section-title">全部借用记录</h2>
          </div>

          <div v-if="records.length === 0" class="empty-state">
            <p>暂无记录</p>
          </div>

          <div v-else class="record-list">
            <div v-for="rec in records" :key="rec.id" class="record-card" :class="rec.returnedAt ? 'record-card--returned' : 'record-card--active'">
              <div class="record-card-header">
                <div class="record-device">
                  <span class="record-device-icon">📋</span>
                  <div>
                    <div class="record-device-name">{{ rec.deviceName }}</div>
                    <div class="record-device-model">{{ rec.deviceModel }}</div>
                  </div>
                </div>
                <span class="tag" :class="rec.returnedAt ? 'tag--success' : 'tag--danger'">
                  {{ rec.returnedAt ? '已归还' : '借出中' }}
                </span>
              </div>
              <div class="record-card-body">
                <div class="record-person">
                  <span class="record-person-name">{{ rec.borrowerName }}</span>
                  <span v-if="rec.borrowerId" class="record-person-id">{{ rec.borrowerId }}</span>
                </div>
                <div class="record-contact">
                  <a v-if="rec.borrowerPhone" :href="'tel:' + rec.borrowerPhone" class="record-contact-item">📞 {{ rec.borrowerPhone }}</a>
                  <span v-if="rec.major" class="record-contact-item">专业：{{ rec.major }}</span>
                </div>
                <div class="record-time">借用：{{ formatDate(rec.createdAt) }}</div>
                <div v-if="rec.returnedAt" class="record-time">归还：{{ formatDate(rec.returnedAt) }}</div>
                <div v-if="rec.purpose" class="notes-box"><span class="notes-label">用途：</span>{{ rec.purpose }}</div>
                <div v-if="rec.returnNotes" class="notes-box"><span class="notes-label">归还备注：</span>{{ rec.returnNotes }}</div>
              </div>
              <div v-if="rec.returnedAt" class="record-card-actions">
                <button class="btn btn--ghost btn--xs btn--danger-text" @click="archiveRecord(rec)">归档记录</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 已归档记录 -->
        <div v-if="activeTab === 'archived'" class="tab-content">
          <div class="section-header">
            <h2 class="section-title">已归档记录</h2>
          </div>

          <div v-if="archivedRecords.length === 0" class="empty-state">
            <p>暂无已归档记录</p>
          </div>

          <div v-else class="record-list">
            <div v-for="rec in archivedRecords" :key="rec.id" class="record-card record-card--archived">
              <div class="record-card-header">
                <div class="record-device">
                  <span class="record-device-icon">🗄️</span>
                  <div>
                    <div class="record-device-name">{{ rec.deviceName }}</div>
                    <div class="record-device-model">{{ rec.deviceModel }}</div>
                  </div>
                </div>
                <span class="tag">已归档</span>
              </div>
              <div class="record-card-body">
                <div class="record-person">
                  <span class="record-person-name">{{ rec.borrowerName }}</span>
                  <span v-if="rec.borrowerId" class="record-person-id">{{ rec.borrowerId }}</span>
                </div>
                <div class="record-contact">
                  <a v-if="rec.borrowerPhone" :href="'tel:' + rec.borrowerPhone" class="record-contact-item">📞 {{ rec.borrowerPhone }}</a>
                  <span v-if="rec.major" class="record-contact-item">专业：{{ rec.major }}</span>
                </div>
                <div class="record-time">借用：{{ formatDate(rec.createdAt) }}</div>
                <div class="record-time">归还：{{ formatDate(rec.returnedAt) }}</div>
                <div class="record-time">归档：{{ formatDate(rec.deletedAt) }}</div>
                <div v-if="rec.purpose" class="notes-box"><span class="notes-label">用途：</span>{{ rec.purpose }}</div>
                <div v-if="rec.returnNotes" class="notes-box"><span class="notes-label">归还备注：</span>{{ rec.returnNotes }}</div>
              </div>
              <div class="record-card-actions">
                <button class="btn btn--ghost btn--xs" @click="restoreRecord(rec)">恢复</button>
                <button class="btn btn--ghost btn--xs btn--danger-text" @click="deleteRecordPermanently(rec)">永久删除</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 分类管理 -->
        <div v-if="activeTab === 'categories'" class="tab-content">
          <div class="section-header">
            <h2 class="section-title">分类标签管理</h2>
            <button class="btn btn--primary btn--sm" @click="showAddCategory = true">+ 添加分类</button>
          </div>

          <!-- 添加分类弹窗 -->
          <div v-if="showAddCategory" class="modal-overlay" @click.self="showAddCategory = false">
            <div class="modal">
              <div class="modal-header"><h2>添加分类</h2></div>
              <div class="modal-body">
                <div class="form-group">
                  <label>名称 <span class="required">*</span></label>
                  <input v-model="newCategoryName" class="input" placeholder="如：无人机" @keyup.enter="addCategory" />
                </div>
              </div>
              <div class="modal-footer">
                <button class="btn btn--ghost btn--lg" @click="showAddCategory = false">取消</button>
                <button class="btn btn--primary btn--lg" :disabled="!newCategoryName.trim()" @click="addCategory">添加</button>
              </div>
            </div>
          </div>

          <div v-if="categories.length === 0" class="empty-state">
            <p>暂无分类</p>
          </div>

          <transition-group v-else name="category-sort" tag="div" class="category-list">
            <div
              v-for="cat in categories"
              :key="cat.id"
              class="category-sort-item"
              :class="{ 'category-sort-item--dragging': categoryDragId === cat.id, 'category-sort-item--over': categoryDragOverId === cat.id }"
              draggable="true"
              @dragstart="startCategoryDrag(cat, $event)"
              @dragover.prevent="dragOverCategory(cat, $event)"
              @drop.prevent="dropCategory(cat, $event)"
              @dragend="finishCategoryDrag"
            >
              <span class="category-drag-handle" aria-hidden="true" title="拖动排序">⋮⋮</span>
              <div class="category-sort-item__body">
                <div class="category-sort-item__name">{{ cat.name }}</div>
                <div class="category-sort-item__meta">ID: {{ cat.id }} · 排序: {{ cat.sortOrder }}</div>
              </div>
              <div class="category-sort-item__actions">
                <button v-if="cat.id !== 'cat-other'" class="btn btn--ghost btn--xs" @click="startEditCategory(cat)">编辑</button>
                <button v-if="cat.id !== 'cat-other'" class="btn btn--ghost btn--xs btn--danger-text" @click="deleteCategory(cat)">删除</button>
                <span v-else class="tag">不可删除</span>
              </div>
            </div>
          </transition-group>

          <!-- 编辑分类弹窗 -->
          <div v-if="editingCategory" class="modal-overlay" @click.self="editingCategory = null">
            <div class="modal">
              <div class="modal-header"><h2>编辑分类</h2></div>
              <div class="modal-body">
                <div class="form-group">
                  <label>名称 <span class="required">*</span></label>
                  <input v-model.trim="editingCategory.name" class="input" @keyup.enter="updateCategory" />
                </div>
              </div>
              <div class="modal-footer">
                <button class="btn btn--ghost btn--lg" @click="editingCategory = null">取消</button>
                <button class="btn btn--primary btn--lg" :disabled="!editingCategory.name.trim()" @click="updateCategory">保存</button>
              </div>
            </div>
          </div>
      </div>

      <!-- 编辑当前借用记录弹窗 -->
      <div v-if="editingRecord" class="modal-overlay" @click.self="closeRecordModal">
        <div class="modal modal--lg">
          <div class="modal-header">
            <h2>修改借用信息</h2>
            <button class="modal-close" @click="closeRecordModal">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>姓名 <span class="required">*</span></label>
              <input v-model="editingRecord.borrowerName" class="input" />
            </div>
            <div class="form-group">
              <label>学号 / 工号</label>
              <input v-model="editingRecord.borrowerId" class="input" />
            </div>
            <div class="form-group">
              <label>联系电话 <span class="required">*</span></label>
              <input v-model="editingRecord.borrowerPhone" class="input" type="tel" />
            </div>
            <div class="form-group">
              <label>专业 <span class="required">*</span></label>
              <input v-model="editingRecord.major" class="input" />
            </div>
            <div class="form-group">
              <label>用途 <span class="required">*</span></label>
              <textarea v-model="editingRecord.purpose" class="input textarea" rows="3"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn--ghost btn--lg" @click="closeRecordModal">取消</button>
            <button class="btn btn--primary btn--lg" :disabled="submitting" @click="saveActiveRecord">保存修改</button>
          </div>
        </div>
      </div>

      <!-- 批量导入只提交已通过前端预检的预览数据，服务端仍会完整复验。 -->
      <div v-if="showDeviceImport" class="modal-overlay" @click.self="closeDeviceImport">
        <div class="modal modal--import">
          <div class="modal-header">
            <h2>批量导入设备</h2>
            <button class="modal-close" @click="closeDeviceImport">✕</button>
          </div>
          <div class="modal-body">
            <input ref="deviceImportInput" type="file" accept=".xlsx" class="hidden" @change="handleDeviceImportFile" />
            <button class="btn btn--ghost" type="button" @click="deviceImportInput?.click()">选择 Excel 文件</button>
            <p class="modal-tip">{{ deviceImportFileName || '请选择由模板填写的 .xlsx 文件，单次最多 500 台设备。' }}</p>
            <div v-if="deviceImportFileError" class="import-message import-message--error">{{ deviceImportFileError }}</div>
            <div v-if="deviceImportPreview.length" class="import-summary">
              共 {{ deviceImportPreview.length }} 行，
              <span :class="{ 'import-summary__error': deviceImportErrorCount }">{{ deviceImportErrorCount }} 行有误</span>
            </div>
            <div v-if="deviceImportPreview.length" class="import-preview-wrap">
              <table class="import-preview-table">
                <thead><tr><th>行号</th><th v-for="column in deviceImportColumns" :key="column.key">{{ column.header }}</th><th>校验结果</th></tr></thead>
                <tbody>
                  <tr v-for="row in deviceImportPreview" :key="row.rowNumber" :class="{ 'import-preview-row--error': row.errors.length }">
                    <td>{{ row.rowNumber }}</td>
                    <td v-for="column in deviceImportColumns" :key="column.key">{{ row[column.key] || '-' }}</td>
                    <td>{{ row.errors.length ? row.errors.join('；') : '通过' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn--ghost btn--lg" @click="closeDeviceImport">取消</button>
            <button class="btn btn--primary btn--lg" :disabled="submitting || !deviceImportPreview.length || deviceImportErrorCount > 0" @click="submitDeviceImport">
              {{ submitting ? '导入中...' : '确认导入' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 批量下线在提交前再次展示数量和统一原因，避免误操作。 -->
      <div v-if="showBatchOffline" class="modal-overlay" @click.self="closeBatchOffline">
        <div class="modal">
          <div class="modal-header">
            <h2>批量{{ batchOperationalStatus === 'offline' ? '下线' : '上线' }}设备</h2>
            <button class="modal-close" @click="closeBatchOffline">✕</button>
          </div>
          <div class="modal-body">
            <p class="modal-tip">
              即将{{ batchOperationalStatus === 'offline' ? '下线' : '上线' }} <strong>{{ selectedDeviceIds.length }}</strong> 台设备。
              <template v-if="batchOperationalStatus === 'offline'">借出中的设备会导致整批操作失败。</template>
              <template v-else>上线后会清空原有离线原因。</template>
            </p>
            <div class="batch-device-summary">{{ selectedDeviceNames.join('、') }}</div>
            <div v-if="batchOperationalStatus === 'offline'" class="form-group">
              <label>统一下线原因</label>
              <input v-model.trim="batchOfflineReason" class="input" placeholder="例如：设备检修" />
            </div>
            <div v-if="batchOfflineError" class="import-message import-message--error">{{ batchOfflineError }}</div>
          </div>
          <div class="modal-footer">
            <button class="btn btn--ghost btn--lg" @click="closeBatchOffline">取消</button>
            <button class="btn btn--lg" :class="batchOperationalStatus === 'offline' ? 'btn--danger' : 'btn--primary'" :disabled="submitting" @click="batchOperationalStatus === 'offline' ? submitBatchOffline() : submitBatchOnline()">
              {{ submitting ? '处理中...' : (batchOperationalStatus === 'offline' ? '确认下线' : '确认上线') }}
            </button>
          </div>
        </div>
      </div>

      <!-- 批量分类提交前展示设备范围和目标分类，确认后整批更新。 -->
      <div v-if="showBatchCategory" class="modal-overlay" @click.self="closeBatchCategory">
        <div class="modal">
          <div class="modal-header">
            <h2>批量分类设备</h2>
            <button class="modal-close" @click="closeBatchCategory">✕</button>
          </div>
          <div class="modal-body">
            <p class="modal-tip">即将修改 <strong>{{ selectedDeviceIds.length }}</strong> 台设备的分类。</p>
            <div class="batch-device-summary">{{ selectedDeviceNames.join('、') }}</div>
            <div class="form-group">
              <label>目标分类 <span class="required">*</span></label>
              <select v-model="batchCategoryId" class="input" required>
                <option value="">请选择分类…</option>
                <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
              </select>
            </div>
            <div v-if="batchCategoryError" class="import-message import-message--error">{{ batchCategoryError }}</div>
          </div>
          <div class="modal-footer">
            <button class="btn btn--ghost btn--lg" @click="closeBatchCategory">取消</button>
            <button class="btn btn--primary btn--lg" :disabled="submitting || !batchCategoryId" @click="submitBatchCategory">
              {{ submitting ? '处理中...' : '确认分类' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 管理员账户弹窗：新增账号和权限编辑共用一套表单。 -->
      <div v-if="showAdminModal" class="modal-overlay" @click.self="closeAdminModal">
        <div class="modal">
          <div class="modal-header">
            <h2>{{ editingAdmin ? '配置管理员权限' : '新增管理员' }}</h2>
            <button class="modal-close" @click="closeAdminModal">✕</button>
          </div>
          <div class="modal-body">
            <div v-if="!editingAdmin" class="form-group">
              <label>管理员账号 <span class="required">*</span></label>
              <input v-model.trim="adminForm.username" class="input" autocomplete="username" placeholder="3-32 位字母、数字或符号" />
            </div>
            <div v-if="!editingAdmin" class="form-group">
              <label>初始密码 <span class="required">*</span></label>
              <input v-model="adminForm.password" type="password" class="input" autocomplete="new-password" placeholder="至少 8 位" />
            </div>
            <div class="form-group">
              <label>功能权限</label>
              <div class="permission-check-list">
                <label v-for="permission in permissionOptions" :key="permission.key" class="email-settings-check">
                  <input v-model="adminForm.permissions" type="checkbox" :value="permission.key" />
                  <span>{{ permission.label }}</span>
                </label>
              </div>
            </div>
            <p v-if="adminFormError" class="login-error">{{ adminFormError }}</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn--ghost btn--lg" @click="closeAdminModal">取消</button>
            <button class="btn btn--primary btn--lg" :disabled="adminSaving" @click="saveAdmin">
              {{ adminSaving ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 所有管理员都可使用修改密码功能，提交后当前会话保持有效。 -->
      <div v-if="showPasswordModal" class="modal-overlay" @click.self="closePasswordModal">
        <div class="modal">
          <div class="modal-header">
            <h2>修改密码</h2>
            <button class="modal-close" @click="closePasswordModal">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group"><label>原密码 <span class="required">*</span></label><input v-model="passwordForm.currentPassword" type="password" class="input" autocomplete="current-password" /></div>
            <div class="form-group"><label>新密码 <span class="required">*</span></label><input v-model="passwordForm.newPassword" type="password" class="input" autocomplete="new-password" placeholder="至少 8 位" /></div>
            <div class="form-group"><label>确认新密码 <span class="required">*</span></label><input v-model="passwordForm.confirmPassword" type="password" class="input" autocomplete="new-password" /></div>
            <p v-if="passwordMessage" class="login-error" :class="{ 'email-settings-message--success': passwordMessageSuccess }">{{ passwordMessage }}</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn--ghost btn--lg" @click="closePasswordModal">取消</button>
            <button class="btn btn--primary btn--lg" :disabled="passwordSaving" @click="changePassword">{{ passwordSaving ? '提交中...' : '确认修改' }}</button>
          </div>
        </div>
      </div>

      <!-- 添加/编辑设备弹窗 -->
      <div v-if="showAddDevice || showEditDevice" class="modal-overlay" @click.self="closeDeviceModal">
        <div class="modal modal--lg">
          <div class="modal-header">
            <h2>{{ editingDevice ? '编辑设备' : '添加设备' }}</h2>
            <button class="modal-close" @click="closeDeviceModal">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>设备名称 <span class="required">*</span></label>
              <input v-model="editingDevice.name" placeholder="如：单反相机" class="input" />
            </div>
            <div class="form-group">
              <label>型号 <span class="required">*</span></label>
              <input v-model="editingDevice.model" placeholder="如：Canon 5D Mark IV" class="input" />
            </div>
            <div class="form-group">
              <label>存放位置</label>
              <input v-model="editingDevice.location" placeholder="如：实验楼 301" class="input" />
            </div>
            <div class="form-group">
              <label>设备分类 <span class="required">*</span></label>
              <select v-model="editingDevice.category" class="input" required>
                <option value="">选择分类…</option>
                <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
              </select>
            </div>
            <div class="form-group">
              <label>设备说明</label>
              <textarea v-model="editingDevice.notes" placeholder="使用注意事项等" class="input textarea" rows="3"></textarea>
            </div>
            <div class="form-group">
              <label>设备照片</label>
              <div class="upload-area" @click="triggerUpload">
                <div v-if="editingDevice.previewImage" ref="cropEditor" class="image-crop-editor" @pointermove="moveCropResize" @pointerup="finishCropResize" @pointercancel="finishCropResize" @click.stop>
                  <img ref="cropPreviewImage" :src="editingDevice.previewImage" class="image-crop-editor__image" @load="onCropImageLoad" />
                  <div class="image-crop-editor__shade image-crop-editor__shade--top" :style="cropShadeTopStyle"></div>
                  <div class="image-crop-editor__selection" :style="cropSelectionStyle" @pointerdown.stop.prevent="startCropMove">
                    <!-- 图片选区信息使用独立玻璃层，不影响原图清晰度。 -->
                    <span class="image-crop-editor__height image-crop-editor__glass">H: {{ cropDisplayHeight }}px</span>
                    <button type="button" class="image-crop-editor__handle" aria-label="调整图片展示高度" @pointerdown.stop.prevent="startCropResize">↕</button>
                  </div>
                  <div class="image-crop-editor__shade image-crop-editor__shade--bottom" :style="cropShadeBottomStyle"></div>
                  <button type="button" class="image-crop-editor__replace btn btn--ghost btn--xs" @click.stop="triggerUpload">更换图片</button>
                </div>
                <div v-else class="upload-placeholder">
                  <span class="upload-icon">📷</span>
                  <span class="upload-text">点击上传设备照片</span>
                </div>
              </div>
              <input ref="imageInput" type="file" accept="image/jpeg,image/png,image/webp" class="hidden" @change="onImageChange" />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn--ghost btn--lg" @click="closeDeviceModal">取消</button>
            <button class="btn btn--primary btn--lg" :disabled="submitting" @click="saveDevice">
              {{ submitting ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>
      </div>

          </div>
        </div>
        <footer class="page-footer admin-footer">
          <div>暨南大学网络空间安全学院 · 设备管理系统</div>
          <div class="page-footer__hitokoto">
            <a class="page-footer__hitokoto-link" :href="hitokotoUrl || null" target="_blank" rel="noopener noreferrer" :aria-label="hitokotoText">{{ hitokotoText }}<span v-if="isHitokotoTyping" class="page-footer__hitokoto-cursor" aria-hidden="true"></span></a>
          </div>
          <!-- 管理端与用户端共用同一底栏元信息层级，保持入口体验一致。 -->
          <div class="page-footer__meta">
            <a class="page-footer__filing-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">豫ICP备2026040615号-1</a>
            <span class="page-footer__meta-separator" aria-hidden="true">·</span>
            <span class="page-footer__runtime">{{ siteRuntime }}</span>
          </div>
        </footer>
      </div>
    </div>
  `,

  setup() {
    const siteRuntime = useSiteRuntime();
    const { hitokotoText, hitokotoUrl, isHitokotoTyping } = useHitokoto();
    const isLoggedIn = Vue.ref(false);
    // 登录身份由服务端返回，前端只据此展示入口，真正权限仍由后端校验。
    const username = Vue.ref('admin');
    const adminUser = Vue.ref(null);
    const password = Vue.ref('');
    const loginError = Vue.ref('');
    const submitting = Vue.ref(false);
      const devices = Vue.ref([]);
      const failedAdminImages = Vue.reactive(new Set());
      const loadedAdminImages = Vue.reactive(new Set());
      const records = Vue.ref([]);
      const activeRecords = Vue.ref([]);
      const archivedRecords = Vue.ref([]);
      const activeTab = Vue.ref('devices');
      const adminUsers = Vue.ref([]);
      const showAdminModal = Vue.ref(false);
      const editingAdmin = Vue.ref(null);
      const adminSaving = Vue.ref(false);
      const adminFormError = Vue.ref('');
      const adminManagementMessage = Vue.ref('');
      const adminManagementError = Vue.ref(false);
      const adminForm = Vue.reactive({ username: '', password: '', permissions: [] });
      const showPasswordModal = Vue.ref(false);
      const passwordSaving = Vue.ref(false);
      const passwordMessage = Vue.ref('');
      const passwordMessageSuccess = Vue.ref(false);
      const passwordForm = Vue.reactive({ currentPassword: '', newPassword: '', confirmPassword: '' });
      // 统计状态由管理员接口统一提供，时间范围变化时只刷新统计面板。
      const statisticsRange = Vue.ref('30d');
      const statisticsLoading = Vue.ref(false);
      const statisticsReady = Vue.ref(false);
      const statisticsError = Vue.ref('');
      const statistics = Vue.ref({
        range: '30d',
        summary: { borrowCount: 0, returnedCount: 0, activeCount: 0, usedDeviceCount: 0, deviceCount: 0, utilizationRate: 0 },
        popularDevices: [],
        trend: []
      });
      const statisticsDisplay = Vue.ref({
        summary: { borrowCount: 0, returnedCount: 0, activeCount: 0, usedDeviceCount: 0, deviceCount: 0, utilizationRate: 0 }
      });
      // 每次范围成功切换都重建趋势绘图区，确保 7 天、30 天和全部具有一致反馈。
      const statisticsTrendAnimationKey = Vue.ref(0);
      let statisticsRequestId = 0;
      // 日志筛选仅作用于已加载的脱敏操作记录，不发起额外查询。
      const operationLogs = Vue.ref([]);
      const operationLogFilter = Vue.ref('all');
      const filteredOperationLogs = Vue.computed(() => operationLogFilter.value === 'all'
        ? operationLogs.value
        : operationLogs.value.filter(log => log.action === operationLogFilter.value));
      // 邮件凭据只作为一次性输入保留在内存，后端返回的设置永远不包含原始密钥。
      const emailSettings = Vue.reactive({
        enabled: false,
        maskSensitiveData: true,
        notifyBorrow: true,
        notifyReturn: false,
        notifyAdminReturn: false,
        recipientsText: '',
        smtp: { host: '', port: 465, security: 'ssl', username: '', secret: '', secretConfigured: false },
        // 三类事件各自独立的主题和正文；事件名写死，其余字段继续使用变量。
        templates: {
          borrow: {
            subject: '【设备管理】设备借出：{{deviceName}}',
            body: [
              '设备借出通知', '', '事件：设备借出', '设备名称：{{deviceName}}', '设备型号：{{deviceModel}}',
              '设备编号：{{deviceId}}', '借用人：{{borrowerName}}', '联系电话：{{borrowerPhoneMasked}}',
              '专业/部门：{{major}}', '借用用途：{{purpose}}', '借用时间：{{borrowedAt}}', '操作时间：{{eventAt}}'
            ].join('\n')
          },
          return: {
            subject: '【设备管理】用户归还：{{deviceName}}',
            body: [
              '用户归还通知', '', '事件：用户归还', '设备名称：{{deviceName}}', '设备型号：{{deviceModel}}',
              '设备编号：{{deviceId}}', '借用人：{{borrowerName}}', '联系电话：{{borrowerPhoneMasked}}',
              '专业/部门：{{major}}', '借用用途：{{purpose}}', '借用时间：{{borrowedAt}}',
              '归还时间：{{eventAt}}', '归还备注：{{returnNotes}}'
            ].join('\n')
          },
          adminReturn: {
            subject: '【设备管理】管理员归还：{{deviceName}}',
            body: [
              '管理员归还通知', '', '事件：管理员归还', '设备名称：{{deviceName}}', '设备型号：{{deviceModel}}',
              '设备编号：{{deviceId}}', '借用人：{{borrowerName}}', '联系电话：{{borrowerPhoneMasked}}',
              '专业/部门：{{major}}', '借用用途：{{purpose}}', '借用时间：{{borrowedAt}}',
              '归还时间：{{eventAt}}', '归还备注：{{returnNotes}}'
            ].join('\n')
          }
        }
      });
      // 模板预览使用固定示例数据，只用于当前浏览器展示，不会写入设备或借用记录。
      const emailTemplateFields = EMAIL_TEMPLATE_FIELDS;
      const emailPreviewEvents = EMAIL_PREVIEW_EVENTS;
      const emailPreviewEvent = Vue.ref('borrow');
      const emailTemplateLabel = Vue.computed(() => emailPreviewEvents.find(item => item.key === emailPreviewEvent.value)?.label || '');
      const emailSubjectInput = Vue.ref(null);
      const emailBodyInput = Vue.ref(null);
      const emailTemplateErrors = Vue.computed(() => {
        const supported = new Set(emailTemplateFields.map(field => field.key));
        const currentTemplate = emailSettings.templates[emailPreviewEvent.value];
        const errors = [];
        for (const [label, value, maxLength, singleLine] of [
          ['邮件主题', currentTemplate.subject, 160, true],
          ['邮件正文', currentTemplate.body, 8000, false]
        ]) {
          const text = String(value || '');
          const placeholders = text.match(/\{\{([^{}]+)\}\}/g) || [];
          const invalid = placeholders
            .map(item => item.slice(2, -2).trim())
            .filter(variable => !supported.has(variable));
          if (invalid.length) errors.push(`${label}包含不支持的字段：${[...new Set(invalid)].join('、')}`);
          if (text.includes('{{') && placeholders.length !== (text.match(/\{\{/g) || []).length) errors.push(`${label}中有未完成的字段`);
          if (text.length > maxLength) errors.push(`${label}不能超过 ${maxLength} 个字符`);
          if (singleLine && /[\r\n]/.test(text)) errors.push('邮件主题不能换行');
        }
        return [...new Set(errors)];
      });
      const emailTemplatePreview = Vue.computed(() => {
        const event = emailPreviewEvents.find(item => item.key === emailPreviewEvent.value) || emailPreviewEvents[0];
        const sampleName = '示例用户';
        const sampleId = '2026000001';
        const samplePhone = '13800138000';
        const values = {
          eventLabel: event.label,
          deviceName: '示例设备',
          deviceModel: 'DEMO-001',
          deviceId: 'DEMO-DEVICE',
          borrowerName: emailSettings.maskSensitiveData ? '示**户' : sampleName,
          borrowerId: emailSettings.maskSensitiveData ? '20******01' : sampleId,
          borrowerPhone: emailSettings.maskSensitiveData ? '138****' : samplePhone,
          borrowerNameMasked: '示**户',
          borrowerIdMasked: '20******01',
          borrowerPhoneMasked: '138****',
          major: '示例部门',
          purpose: '模板预览',
          borrowedAt: '2026-08-14 10:00',
          eventAt: '2026-08-14 10:30',
          returnNotes: '示例备注'
        };
        const render = template => String(template || '').replace(/\{\{([^{}]+)\}\}/g, (_, variable) => String(values[variable.trim()] ?? ''));
        const currentTemplate = emailSettings.templates[event.key];
        return {
          subject: `【测试】${render(currentTemplate.subject)}`,
          body: render(currentTemplate.body)
        };
      });
      const emailSettingsMessage = Vue.ref('');
      const emailSettingsError = Vue.ref(false);
      const emailSettingsSaving = Vue.ref(false);
      const emailSettingsTesting = Vue.ref(false);
      // 设备视图属于当前浏览器偏好，不写入设备数据或服务端配置。
      const deviceViewMode = Vue.ref(localStorage.getItem('adminDeviceViewMode') === 'list' ? 'list' : 'card');
      const showAddDevice = Vue.ref(false);
      const showEditDevice = Vue.ref(false);
      // 批量状态选择是页面临时状态，成功或关闭后清空，不影响设备持久化模型。
      const selectedDeviceIds = Vue.ref([]);
      const selectedDeviceNames = Vue.computed(() => devices.value.filter(device => selectedDeviceIds.value.includes(device.id)).map(device => device.name));
      const showBatchOffline = Vue.ref(false);
      const batchOperationalStatus = Vue.ref('offline');
      const batchOfflineReason = Vue.ref('');
      const batchOfflineError = Vue.ref('');
      // 批量分类弹窗复用已选设备，只保存本次目标分类和错误提示。
      const showBatchCategory = Vue.ref(false);
      const batchCategoryId = Vue.ref('');
      const batchCategoryError = Vue.ref('');
      // 导入状态与单设备编辑隔离，关闭弹窗时完整清理所选文件和预览。
      const showDeviceImport = Vue.ref(false);
      const deviceImportInput = Vue.ref(null);
      const deviceImportFileName = Vue.ref('');
      const deviceImportFileError = Vue.ref('');
      const deviceImportPreview = Vue.ref([]);
      const deviceImportErrorCount = Vue.computed(() => deviceImportPreview.value.filter(row => row.errors.length).length);
      const editingDevice = Vue.reactive({
        id: '', name: '', model: '', location: '', notes: '', category: '', imageDisplayHeight: '', imageDisplayPositionY: '', imageDisplayAspectRatio: '', image: '', previewImage: ''
      });
      const editingRecord = Vue.ref(null);
      const imageInput = Vue.ref(null); // 隐藏文件框的模板引用
      const cropEditor = Vue.ref(null);
      const cropEditorHeight = Vue.ref(0);
      const cropDrag = { active: false, mode: '', startY: 0, startHeight: 0, startTop: 0 };
      const categories = Vue.ref([]);
      const cropDisplayHeight = Vue.computed(() => {
        const editorHeight = cropEditorHeight.value || 720;
        const maxHeight = Math.min(720, editorHeight);
        const minHeight = Math.min(120, maxHeight);
        const current = Number(editingDevice.imageDisplayHeight);
        const fallback = Math.min(360, maxHeight);
        const height = Number.isFinite(current) && current > 0 ? current : fallback;
        return Math.round(Math.min(maxHeight, Math.max(minHeight, height)));
      });
      const cropDisplayPositionY = Vue.computed(() => {
        const position = Number(editingDevice.imageDisplayPositionY);
        return Number.isInteger(position) && position >= 0 && position <= 100 ? position : 50;
      });
      const cropSelectionStyle = Vue.computed(() => {
        const editorHeight = cropEditorHeight.value || cropDisplayHeight.value;
        const visualHeight = Math.min(editorHeight, cropDisplayHeight.value);
        const maxTop = Math.max(0, editorHeight - visualHeight);
        const top = Math.round(maxTop * cropDisplayPositionY.value / 100);
        return { top: `${top}px`, height: `${visualHeight}px` };
      });
      const cropShadeTopStyle = Vue.computed(() => ({ height: cropSelectionStyle.value.top }));
      const cropShadeBottomStyle = Vue.computed(() => ({ top: `calc(${cropSelectionStyle.value.top} + ${cropSelectionStyle.value.height})` }));

    function adminImageSource(device) {
      return device?.imageThumb || device?.image || '';
    }

    function hasAdminImage(device) {
      const source = adminImageSource(device);
      return !!source && !failedAdminImages.has(source);
    }

    function markAdminImageLoaded(source) {
      if (!source) return;
      failedAdminImages.delete(source);
      loadedAdminImages.add(source);
    }

    function markAdminImageFailed(source) {
      if (!source) return;
      loadedAdminImages.delete(source);
      failedAdminImages.add(source);
    }

    function isAdminImageLoaded(source) {
      return !!source && loadedAdminImages.has(source);
    }

    function setDeviceViewMode(mode) {
      if (!['card', 'list'].includes(mode)) return;
      deviceViewMode.value = mode;
      localStorage.setItem('adminDeviceViewMode', mode);
    }

    let pendingImageFile = null;
    let previewObjectUrl = '';

    // 常用管理入口靠前，低频统计和日志统一放在分类管理之后。
    const permissionOptions = [
      { key: 'devices', label: '设备管理' },
      { key: 'records', label: '借用记录' },
      { key: 'categories', label: '分类管理' },
      { key: 'statistics', label: '借用统计' },
      { key: 'operation-logs', label: '操作日志' },
      { key: 'email-settings', label: '邮件通知' }
    ];
    const tabs = [
      { key: 'devices', label: '设备管理', icon: '📋', permission: 'devices' },
      { key: 'records', label: '当前借出', icon: '📤', permission: 'records' },
      { key: 'all-records', label: '全部记录', icon: '📜', permission: 'records' },
      { key: 'archived', label: '已归档', icon: '🗄️', permission: 'records' },
      { key: 'categories', label: '分类管理', icon: '🏷️', permission: 'categories' },
      { key: 'statistics', label: '借用统计', icon: '📊', permission: 'statistics' },
      { key: 'operation-logs', label: '操作日志', icon: '🧾', permission: 'operation-logs' },
      { key: 'email-notifications', label: '邮件通知', icon: '✉️', permission: 'email-settings' },
      { key: 'admin-management', label: '管理员管理', icon: '👥', permission: 'admin-management' }
    ];
    const isSuperAdmin = Vue.computed(() => adminUser.value?.role === 'super_admin');
    const visibleTabs = Vue.computed(() => tabs.filter(tab => isSuperAdmin.value || adminUser.value?.permissions?.includes(tab.permission)));
    // 按管理员权限加载受保护数据，避免普通管理员产生无意义的 403 请求。
    function hasAdminPermission(permission) {
      return isSuperAdmin.value || adminUser.value?.permissions?.includes(permission);
    }
    const navigationGroups = [
      { key: 'operations', label: '运营管理', items: tabs.filter(tab => ['devices', 'records', 'all-records', 'archived'].includes(tab.key)) },
      { key: 'configuration', label: '配置管理', items: tabs.filter(tab => ['categories', 'email-notifications'].includes(tab.key)) },
      { key: 'analytics', label: '数据分析', items: tabs.filter(tab => ['statistics', 'operation-logs'].includes(tab.key)) },
      { key: 'system', label: '系统设置', items: tabs.filter(tab => tab.key === 'admin-management') }
    ];
    const visibleNavigationGroups = Vue.computed(() => navigationGroups
      .map(group => ({ ...group, items: group.items.filter(item => visibleTabs.value.some(tab => tab.key === item.key)) }))
      .filter(group => group.items.length));
    const adminNavigationCollapsed = Vue.ref(localStorage.getItem('adminNavigationCollapsed') === 'true');
    const adminDrawerOpen = Vue.ref(false);
    function toggleAdminNavigation() {
      adminNavigationCollapsed.value = !adminNavigationCollapsed.value;
      localStorage.setItem('adminNavigationCollapsed', String(adminNavigationCollapsed.value));
    }
    function toggleAdminDrawer() { adminDrawerOpen.value = !adminDrawerOpen.value; }
    function selectAdminTab(key) {
      activeTab.value = key;
      adminDrawerOpen.value = false;
    }
    Vue.watch(visibleTabs, nextTabs => {
      if (nextTabs.length && !nextTabs.some(tab => tab.key === activeTab.value)) activeTab.value = nextTabs[0].key;
    }, { immediate: true });
    const showAddCategory = Vue.ref(false);
    const newCategoryName = Vue.ref('');
    const editingCategory = Vue.ref(null);
    const categoryDragId = Vue.ref('');
    const categoryDragOverId = Vue.ref('');
    let categoryDragOriginalIds = null;
    let categoryDragCommitted = false;

    async function doLogin() {
      if (!password.value) { loginError.value = '请输入密码'; return; }
      submitting.value = true;
      try {
        const res = await apiCall('POST', '/api/admin/login', { username: username.value || 'admin', password: password.value });
        if (res.success) {
          localStorage.setItem('sessionId', res.sessionId);
          adminUser.value = res.user || null;
          isLoggedIn.value = true;
          password.value = '';
          loginError.value = '';
          loadData();
        } else {
          loginError.value = res.message || '密码错误';
        }
      } catch (e) {
        loginError.value = '网络错误';
      } finally {
        submitting.value = false;
      }
    }

    async function doLogout() {
      await apiCall('POST', '/api/admin/logout');
      localStorage.removeItem('sessionId');
      isLoggedIn.value = false;
      adminUser.value = null;
    }

    async function loadData() {
      const requests = await Promise.all([
        apiCall('GET', '/api/devices'), apiCall('GET', '/api/records?includeDeleted=true'), apiCall('GET', '/api/records/active'),
        apiCall('GET', '/api/categories'),
        hasAdminPermission('operation-logs') ? apiCall('GET', '/api/operation-logs') : Promise.resolve({ success: false, skipped: true }),
        hasAdminPermission('email-settings') ? apiCall('GET', '/api/admin/email-settings') : Promise.resolve({ success: false, skipped: true })
      ]);
      const [dRes, rRes, aRes, cRes, lRes, eRes] = requests;

      if (dRes.success) devices.value = dRes.data;
      if (rRes.success) {
        records.value = rRes.data.filter(record => !record.deletedAt);
        archivedRecords.value = rRes.data.filter(record => record.deletedAt);
      }
      if (aRes.success) activeRecords.value = aRes.data;
      if (cRes.success) categories.value = cRes.data;
      if (lRes.success) operationLogs.value = lRes.data;
      if (eRes.success) applyEmailSettings(eRes.data);
      if (adminUser.value?.role === 'super_admin') await loadAdminUsers();
      if (adminUser.value?.role === 'super_admin' || adminUser.value?.permissions?.includes('statistics')) await loadStatistics();
    }

    // 管理员管理请求统一在超级管理员界面触发，避免普通管理员无意义地调用接口。
    async function loadAdminUsers() {
      const res = await apiCall('GET', '/api/admin/users');
      if (res.success) adminUsers.value = res.data;
    }

    function permissionLabelsFor(permissions) {
      const selected = new Set(Array.isArray(permissions) ? permissions : []);
      return permissionOptions.filter(item => selected.has(item.key)).map(item => item.label);
    }

    function openAddAdmin() {
      editingAdmin.value = null;
      adminForm.username = '';
      adminForm.password = '';
      adminForm.permissions = [];
      adminFormError.value = '';
      showAdminModal.value = true;
    }

    function openEditAdminPermissions(user) {
      editingAdmin.value = user;
      adminForm.username = user.username;
      adminForm.password = '';
      adminForm.permissions = [...(user.permissions || [])];
      adminFormError.value = '';
      showAdminModal.value = true;
    }

    function closeAdminModal() {
      showAdminModal.value = false;
      editingAdmin.value = null;
      adminFormError.value = '';
    }

    async function saveAdmin() {
      adminFormError.value = '';
      adminSaving.value = true;
      try {
        const res = editingAdmin.value
          ? await apiCall('PUT', `/api/admin/users/${editingAdmin.value.id}/permissions`, { permissions: adminForm.permissions })
          : await apiCall('POST', '/api/admin/users', { username: adminForm.username, password: adminForm.password, permissions: adminForm.permissions });
        if (!res.success) { adminFormError.value = res.message || '保存失败'; return; }
        closeAdminModal();
        adminManagementError.value = false;
        adminManagementMessage.value = res.message || '管理员信息已保存';
        await loadAdminUsers();
      } catch { adminFormError.value = '网络错误，管理员信息未保存'; }
      finally { adminSaving.value = false; }
    }

    async function deleteAdmin(user) {
      if (!window.confirm(`确定删除管理员“${user.username}”吗？`)) return;
      adminManagementMessage.value = '';
      try {
        const res = await apiCall('DELETE', `/api/admin/users/${user.id}`);
        adminManagementError.value = !res.success;
        adminManagementMessage.value = res.message || (res.success ? '管理员已删除' : '删除失败');
        if (res.success) await loadAdminUsers();
      } catch { adminManagementError.value = true; adminManagementMessage.value = '网络错误，管理员未删除'; }
    }

    function closePasswordModal() {
      showPasswordModal.value = false;
      passwordForm.currentPassword = '';
      passwordForm.newPassword = '';
      passwordForm.confirmPassword = '';
      passwordMessage.value = '';
      passwordMessageSuccess.value = false;
    }

    async function changePassword() {
      passwordMessage.value = '';
      passwordMessageSuccess.value = false;
      passwordSaving.value = true;
      try {
        const res = await apiCall('PUT', '/api/admin/password', { ...passwordForm });
        passwordMessage.value = res.message || (res.success ? '密码已修改' : '密码修改失败');
        passwordMessageSuccess.value = Boolean(res.success);
        if (res.success) {
          passwordForm.currentPassword = '';
          passwordForm.newPassword = '';
          passwordForm.confirmPassword = '';
        }
      } catch { passwordMessage.value = '网络错误，密码未修改'; }
      finally { passwordSaving.value = false; }
    }

    function applyEmailSettings(data) {
      if (!data) return;
      emailSettings.enabled = Boolean(data.enabled);
      emailSettings.maskSensitiveData = data.maskSensitiveData !== false;
      emailSettings.notifyBorrow = data.notifyBorrow !== false;
      emailSettings.notifyReturn = Boolean(data.notifyReturn);
      emailSettings.notifyAdminReturn = Boolean(data.notifyAdminReturn);
      emailSettings.recipientsText = Array.isArray(data.recipients) ? data.recipients.join('\n') : '';
      emailSettings.smtp = {
        host: data.smtp?.host || '',
        port: Number(data.smtp?.port) || 465,
        security: data.smtp?.security || 'ssl',
        username: data.smtp?.username || '',
        secret: '',
        secretConfigured: Boolean(data.smtp?.secretConfigured)
      };
      if (data.templates && typeof data.templates === 'object') {
        for (const key of ['borrow', 'return', 'adminReturn']) {
          const event = data.templates[key];
          if (!event) continue;
          if (typeof event.subject === 'string' && event.subject) emailSettings.templates[key].subject = event.subject;
          if (typeof event.body === 'string' && event.body) emailSettings.templates[key].body = event.body;
        }
      }
    }

    // 变量按钮插入当前光标位置，并在 Vue 更新后恢复焦点，连续点击时保持编辑节奏。
    function insertEmailVariable(variable, target) {
      const input = target === 'subject' ? emailSubjectInput.value : emailBodyInput.value;
      if (!input) return;
      const token = `{{${variable}}}`;
      const currentTemplate = emailSettings.templates[emailPreviewEvent.value];
      const value = target === 'subject' ? currentTemplate.subject : currentTemplate.body;
      const start = Number.isInteger(input.selectionStart) ? input.selectionStart : value.length;
      const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
      const nextValue = `${value.slice(0, start)}${token}${value.slice(end)}`;
      if (target === 'subject') currentTemplate.subject = nextValue;
      else currentTemplate.body = nextValue;
      Vue.nextTick(() => {
        input.focus();
        const cursor = start + token.length;
        input.setSelectionRange(cursor, cursor);
      });
    }

    function emailRecipientsFromText() {
      return [...new Set(emailSettings.recipientsText.split(/[\n,;]+/).map(item => item.trim()).filter(Boolean))];
    }

    function emailSettingsPayload() {
      return {
        enabled: emailSettings.enabled,
        maskSensitiveData: emailSettings.maskSensitiveData,
        notifyBorrow: emailSettings.notifyBorrow,
        notifyReturn: emailSettings.notifyReturn,
        notifyAdminReturn: emailSettings.notifyAdminReturn,
        recipients: emailRecipientsFromText(),
        smtp: {
          host: emailSettings.smtp.host,
          port: emailSettings.smtp.port,
          security: emailSettings.smtp.security,
          username: emailSettings.smtp.username,
          secret: emailSettings.smtp.secret
        },
        templates: {
          borrow: { subject: emailSettings.templates.borrow.subject, body: emailSettings.templates.borrow.body },
          return: { subject: emailSettings.templates.return.subject, body: emailSettings.templates.return.body },
          adminReturn: { subject: emailSettings.templates.adminReturn.subject, body: emailSettings.templates.adminReturn.body }
        }
      };
    }

    async function saveEmailSettings() {
      emailSettingsMessage.value = '';
      emailSettingsError.value = false;
      emailSettingsSaving.value = true;
      try {
        const res = await apiCall('PUT', '/api/admin/email-settings', emailSettingsPayload());
        if (!res.success) {
          emailSettingsError.value = true;
          emailSettingsMessage.value = res.message || '邮件设置保存失败';
          return;
        }
        applyEmailSettings(res.data);
        emailSettingsMessage.value = res.message || '邮件通知设置已保存';
      } catch {
        emailSettingsError.value = true;
        emailSettingsMessage.value = '网络错误，邮件设置未保存';
      } finally {
        emailSettingsSaving.value = false;
      }
    }

    async function sendEmailTest() {
      emailSettingsMessage.value = '';
      emailSettingsError.value = false;
      emailSettingsTesting.value = true;
      try {
        const res = await apiCall('POST', '/api/admin/email-settings/test', {
          ...emailSettingsPayload(),
          previewEvent: emailPreviewEvent.value
        });
        emailSettingsError.value = !res.success;
        emailSettingsMessage.value = res.message || (res.success ? '测试邮件已发送' : '测试邮件发送失败');
      } catch {
        emailSettingsError.value = true;
        emailSettingsMessage.value = '网络错误，测试邮件未发送';
      } finally {
        emailSettingsTesting.value = false;
      }
    }

    // 日志文案和颜色只由固定动作枚举决定，未知历史动作保留通用回退。
    function operationLogActionLabel(action) {
      return ({
        device_created: '新增设备',
        device_updated: '编辑设备',
        device_offlined: '设备下线',
        devices_batch_imported: '批量导入',
        devices_batch_categorized: '批量分类',
        devices_batch_onlined: '批量上线',
        devices_batch_offlined: '批量下线',
        admin_returned: '管理员归还'
      })[action] || '管理操作';
    }

    function operationLogActionClass(action) {
      return `operation-log-item__marker--${String(action || 'unknown').replace(/_/g, '-')}`;
    }

    // 概览只切换最终数值，复用 portal-count 过渡而不模拟逐帧计数。
    function updateStatisticsSummary(summary) {
      statisticsDisplay.value = {
        summary: {
        borrowCount: Math.max(0, Math.round(Number(summary?.borrowCount) || 0)),
        returnedCount: Math.max(0, Math.round(Number(summary?.returnedCount) || 0)),
        activeCount: Math.max(0, Math.round(Number(summary?.activeCount) || 0)),
        usedDeviceCount: Math.max(0, Math.round(Number(summary?.usedDeviceCount) || 0)),
        deviceCount: Math.max(0, Math.round(Number(summary?.deviceCount) || 0)),
        utilizationRate: Math.max(0, Math.round(Number(summary?.utilizationRate) || 0))
        }
      };
    }

    // 统计请求与设备、记录明细解耦，切换范围时无需重复加载管理列表。
    async function loadStatistics() {
      const requestId = ++statisticsRequestId;
      const range = statisticsRange.value;
      statisticsLoading.value = true;
      statisticsError.value = '';
      try {
        const res = await apiCall('GET', '/api/statistics/borrowing?range=' + range);
        if (requestId !== statisticsRequestId) return;
        if (res.success) {
          statistics.value = res.data;
          statisticsReady.value = true;
          statisticsTrendAnimationKey.value += 1;
          updateStatisticsSummary(res.data.summary);
        } else {
          statisticsError.value = res.message || '统计数据加载失败';
        }
      } catch (e) {
        if (requestId !== statisticsRequestId) return;
        statisticsError.value = '统计数据加载失败，请稍后重试';
      } finally {
        if (requestId === statisticsRequestId) statisticsLoading.value = false;
      }
    }

    async function setStatisticsRange(range) {
      if (!['7d', '30d', 'all'].includes(range) || statisticsRange.value === range) return;
      statisticsRange.value = range;
      await loadStatistics();
    }

    // 使用真实柱高让数值始终跟随柱顶，范围切换时由 CSS 从基线生长。
    function trendBarHeight(count) {
      const max = Math.max(1, ...statistics.value.trend.map(point => point.borrowCount));
      return `${count ? Math.max(12, Math.round(Number(count) / max * 96)) : 2}px`;
    }

    Vue.onBeforeUnmount(() => {
      statisticsRequestId += 1;
    });

    function formatTrendDate(date) {
      const parts = String(date || '').split('-');
      return parts.length === 3 ? `${parts[1]}/${parts[2]}` : date;
    }

    // 工作簿下载统一使用浏览器 Blob，ExcelJS 仅在管理员触发工作簿功能时加载。
    async function downloadWorkbook(workbook, filename) {
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    function styleWorksheetHeader(worksheet) {
      const header = worksheet.getRow(1);
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF167D92' } };
      header.alignment = { vertical: 'middle', horizontal: 'center' };
      header.height = 24;
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];
      worksheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + worksheet.columnCount)}1` };
    }

    async function downloadDeviceImportTemplate() {
      const ExcelJS = await loadExcelJS();
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('设备导入模板');
      worksheet.columns = DEVICE_IMPORT_COLUMNS.map(column => ({ header: column.header, key: column.key, width: column.width }));
      worksheet.addRow({ name: '示例：单反相机', model: 'Canon EOS R6', categoryName: categories.value[0]?.name || '其他', location: '器材室', notes: '请删除示例行后填写' });
      styleWorksheetHeader(worksheet);

      // 将下载时的现有分类写入独立工作表，并为主表分类列提供 500 行下拉选项。
      const categoryOptions = workbook.addWorksheet('分类选项');
      categoryOptions.columns = [{ header: '可选设备分类', key: 'name', width: 28 }];
      categories.value.forEach(category => categoryOptions.addRow({ name: category.name }));
      styleWorksheetHeader(categoryOptions);
      const categoryRangeEnd = Math.max(2, categories.value.length + 1);
      for (let rowNumber = 2; rowNumber <= 501; rowNumber += 1) {
        worksheet.getCell(`C${rowNumber}`).dataValidation = {
          type: 'list',
          allowBlank: false,
          formulae: [`'分类选项'!$A$2:$A$${categoryRangeEnd}`],
          showErrorMessage: true,
          errorTitle: '分类无效',
          error: '请从下拉列表中选择现有设备分类'
        };
      }
      const guide = workbook.addWorksheet('填写说明');
      guide.columns = [{ width: 18 }, { width: 70 }];
      guide.addRows([
        ['项目', '说明'],
        ['必填列', '设备名称、设备型号、设备分类'],
        ['选填列', '存放位置、设备说明'],
        ['设备分类', `必须填写当前分类名称之一：${categories.value.map(category => category.name).join('、')}`],
        ['导入限制', '单次最多 500 台；任意一行有误时整批不会写入。']
      ]);
      styleWorksheetHeader(guide);
      await downloadWorkbook(workbook, '设备批量导入模板.xlsx');
    }

    function openDeviceImport() {
      closeDeviceImport();
      showDeviceImport.value = true;
    }

    function closeDeviceImport() {
      showDeviceImport.value = false;
      deviceImportFileName.value = '';
      deviceImportFileError.value = '';
      deviceImportPreview.value = [];
      if (deviceImportInput.value) deviceImportInput.value.value = '';
    }

    async function handleDeviceImportFile(event) {
      const file = event.target.files?.[0];
      deviceImportFileName.value = file?.name || '';
      deviceImportFileError.value = '';
      deviceImportPreview.value = [];
      if (!file || !file.name.toLowerCase().endsWith('.xlsx')) {
        deviceImportFileError.value = '请选择 .xlsx 格式的 Excel 文件';
        return;
      }
      try {
        const ExcelJS = await loadExcelJS();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer());
        const worksheet = workbook.worksheets[0];
        if (!worksheet) throw new Error('工作簿中没有可读取的工作表');
        const actualHeaders = DEVICE_IMPORT_COLUMNS.map((_, index) => worksheet.getCell(1, index + 1).text.trim());
        const expectedHeaders = DEVICE_IMPORT_COLUMNS.map(column => column.header);
        if (actualHeaders.some((header, index) => header !== expectedHeaders[index])) {
          throw new Error(`首行列头必须依次为：${expectedHeaders.join('、')}`);
        }
        const categoryNames = categories.value.map(category => category.name);
        const rows = [];
        worksheet.eachRow((excelRow, rowNumber) => {
          if (rowNumber === 1) return;
          const values = Object.fromEntries(DEVICE_IMPORT_COLUMNS.map((column, index) => [column.key, excelRow.getCell(index + 1).text.trim()]));
          if (Object.values(values).every(value => !value)) return;
          const errors = [];
          DEVICE_IMPORT_COLUMNS.filter(column => column.required).forEach(column => {
            if (!values[column.key]) errors.push(`${column.header}不能为空`);
          });
          if (values.categoryName && !categoryNames.includes(values.categoryName)) errors.push(`分类“${values.categoryName}”不存在`);
          rows.push({ rowNumber, ...values, errors });
        });
        if (!rows.length) throw new Error('文件中没有设备数据');
        if (rows.length > 500) throw new Error('单次最多导入 500 台设备');
        deviceImportPreview.value = rows;
      } catch (error) {
        deviceImportFileError.value = error.message || 'Excel 文件读取失败';
      }
    }

    async function submitDeviceImport() {
      if (!deviceImportPreview.value.length || deviceImportErrorCount.value) return;
      submitting.value = true;
      try {
        const payload = deviceImportPreview.value.map(row => Object.fromEntries(DEVICE_IMPORT_COLUMNS.map(column => [column.key, row[column.key]])));
        const res = await apiCall('POST', '/api/devices/batch-import', { devices: payload });
        if (!res.success) {
          deviceImportFileError.value = res.errors?.map(error => `第 ${error.rowNumber} 行：${error.errors.join('；')}`).join('\n') || res.message || '导入失败';
          return;
        }
        alert(`成功导入 ${res.data.count} 台设备`);
        closeDeviceImport();
        await loadData();
      } catch (error) {
        deviceImportFileError.value = '导入失败，请稍后重试';
      } finally {
        submitting.value = false;
      }
    }

    async function exportDevices() {
      const categoryMap = new Map(categories.value.map(category => [category.id, category.name]));
      const ExcelJS = await loadExcelJS();
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('设备列表');
      worksheet.columns = [
        { header: '设备ID', key: 'id', width: 22 }, { header: '设备名称', key: 'name', width: 22 },
        { header: '设备型号', key: 'model', width: 20 }, { header: '设备分类', key: 'categoryName', width: 18 },
        { header: '存放位置', key: 'location', width: 20 }, { header: '设备说明', key: 'notes', width: 32 },
        { header: '借用状态', key: 'borrowStatus', width: 14 }, { header: '运营状态', key: 'operationalStatus', width: 14 },
        { header: '下线原因', key: 'offlineReason', width: 28 }
      ];
      devices.value.forEach(device => worksheet.addRow({
        id: device.id, name: device.name, model: device.model,
        categoryName: categoryMap.get(device.category) || '其他', location: device.location || '', notes: device.notes || '',
        borrowStatus: device.status === 'borrowed' ? '已借出' : '可借',
        operationalStatus: device.operationalStatus === 'offline' ? '已下线' : '在线',
        offlineReason: device.offlineReason || ''
      }));
      styleWorksheetHeader(worksheet);
      const date = new Date().toISOString().slice(0, 10);
      await downloadWorkbook(workbook, `设备列表-${date}.xlsx`);
    }

    function editActiveRecord(record) {
      editingRecord.value = {
        id: record.id,
        borrowerName: record.borrowerName || '',
        borrowerId: record.borrowerId || '',
        borrowerPhone: record.borrowerPhone || '',
        major: record.major || record.department || '',
        purpose: record.purpose || record.notes || ''
      };
    }

    function closeRecordModal() {
      editingRecord.value = null;
    }

    async function saveActiveRecord() {
      if (!editingRecord.value) return;
      submitting.value = true;
      try {
        const res = await apiCall('PUT', '/api/records/' + editingRecord.value.id, editingRecord.value);
        if (res.success) {
          closeRecordModal();
          await loadData();
        } else {
          alert(res.message || '保存失败');
        }
      } catch (e) {
        alert('网络错误，请重试');
      } finally {
        submitting.value = false;
      }
    }

    async function addCategory() {
      if (!newCategoryName.value.trim()) return;
      const res = await apiCall('POST', '/api/categories', {
        name: newCategoryName.value.trim()
      });
      if (res.success) {
        showAddCategory.value = false;
        newCategoryName.value = '';
        await loadData();
      } else {
        alert(res.message || '添加失败');
      }
    }

    function startEditCategory(cat) {
      editingCategory.value = { ...cat };
    }

    async function updateCategory() {
      if (!editingCategory.value || !editingCategory.value.name.trim()) return;
      const res = await apiCall('PUT', '/api/categories/' + editingCategory.value.id, {
        name: editingCategory.value.name.trim()
      });
      if (res.success) {
        editingCategory.value = null;
        await loadData();
      } else {
        alert(res.message || '更新失败');
      }
    }

    async function deleteCategory(cat) {
      if (!confirm(`删除「${cat.name}」分类后，该分类下设备将自动归入「其他」，确认删除？`)) return;
      const res = await apiCall('DELETE', '/api/categories/' + cat.id);
      if (res.success) {
        await loadData();
      } else {
        alert(res.message || '删除失败');
      }
    }

    function startCategoryDrag(cat, event) {
      categoryDragId.value = cat.id;
      categoryDragOverId.value = '';
      categoryDragOriginalIds = categories.value.map(category => category.id);
      categoryDragCommitted = false;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', cat.id);
      }
    }

    function dragOverCategory(cat, event) {
      const sourceId = categoryDragId.value;
      if (!sourceId || sourceId === cat.id) return;
      if (event?.dataTransfer) event.dataTransfer.dropEffect = 'move';

      const reordered = [...categories.value];
      const sourceIndex = reordered.findIndex(category => category.id === sourceId);
      const targetIndex = reordered.findIndex(category => category.id === cat.id);
      if (sourceIndex === -1 || targetIndex === -1) return;

      const targetRect = event?.currentTarget?.getBoundingClientRect?.();
      const insertAfter = targetRect && Number.isFinite(event.clientY)
        ? event.clientY > targetRect.top + targetRect.height / 2
        : sourceIndex > targetIndex;
      const destinationIndex = targetIndex + (insertAfter ? 1 : 0);
      const insertIndex = sourceIndex < destinationIndex ? destinationIndex - 1 : destinationIndex;

      categoryDragOverId.value = cat.id;
      if (insertIndex === sourceIndex) return;

      const [moved] = reordered.splice(sourceIndex, 1);
      reordered.splice(insertIndex, 0, moved);
      categories.value = reordered.map((category, index) => ({ ...category, sortOrder: index + 1 }));
    }

    async function dropCategory(target, event) {
      const sourceId = categoryDragId.value;
      if (!sourceId) return;
      dragOverCategory(target, event);
      categoryDragCommitted = true;
      categoryDragId.value = '';
      categoryDragOverId.value = '';

      const ids = categories.value.map(category => category.id);
      const changed = !categoryDragOriginalIds || ids.some((id, index) => id !== categoryDragOriginalIds[index]);
      categoryDragOriginalIds = null;
      if (!changed) return;

      try {
        const res = await apiCall('PUT', '/api/categories/reorder', {
          ids
        });
        if (!res.success) {
          alert(res.message || '排序保存失败');
          await loadData();
        }
      } catch (e) {
        alert('排序保存失败，请重试');
        await loadData();
      }
    }

    function finishCategoryDrag() {
      if (!categoryDragCommitted && categoryDragOriginalIds) {
        const categoriesById = new Map(categories.value.map(category => [category.id, category]));
        categories.value = categoryDragOriginalIds
          .map(id => categoriesById.get(id))
          .filter(Boolean)
          .map((category, index) => ({ ...category, sortOrder: index + 1 }));
      }
      categoryDragId.value = '';
      categoryDragOverId.value = '';
      categoryDragOriginalIds = null;
      categoryDragCommitted = false;
    }

    async function forceReturnRecord(record) {
      if (!confirm(`确定由管理员归还「${record.deviceName}」吗？`)) return;
      const notes = prompt('可填写归还备注：', '管理员确认归还') ?? '';
      const res = await apiCall('POST', '/api/records/' + record.id + '/force-return', { notes });
      if (res.success) {
        await loadData();
      } else {
        alert(res.message || '归还失败');
      }
    }

    async function archiveRecord(record) {
      if (!confirm(`确定归档「${record.deviceName}」的这条借用记录吗？`)) return;
      const res = await apiCall('DELETE', '/api/records/' + record.id);
      if (res.success) {
        await loadData();
      } else {
        alert(res.message || '归档失败');
      }
    }

    async function restoreRecord(record) {
      const res = await apiCall('POST', '/api/records/' + record.id + '/restore');
      if (res.success) {
        await loadData();
      } else {
        alert(res.message || '恢复失败');
      }
    }

    async function deleteRecordPermanently(record) {
      if (!confirm(`永久删除后无法恢复，确定删除「${record.deviceName}」的这条记录吗？`)) return;
      const res = await apiCall('DELETE', '/api/records/' + record.id + '/permanent');
      if (res.success) {
        await loadData();
      } else {
        alert(res.message || '删除失败');
      }
    }

    function closeDeviceModal() {
      showAddDevice.value = false;
      showEditDevice.value = false;
      editingDevice.id = '';
      editingDevice.name = '';
      editingDevice.model = '';
      editingDevice.location = '';
      editingDevice.notes = '';
      editingDevice.category = '';
      editingDevice.imageDisplayHeight = '';
      editingDevice.imageDisplayPositionY = '';
      editingDevice.imageDisplayAspectRatio = '';
      editingDevice.image = '';
      editingDevice.previewImage = '';
      pendingImageFile = null;
      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = '';
      }
      if (imageInput.value) imageInput.value.value = '';
    }

    function triggerUpload() {
      imageInput.value?.click();
    }

    function onCropImageLoad(event) {
      cropEditorHeight.value = event.target.clientHeight || 0;
      if (!editingDevice.imageDisplayHeight) {
        editingDevice.imageDisplayHeight = cropDisplayHeight.value;
      }
      if (editingDevice.imageDisplayPositionY === '' || editingDevice.imageDisplayPositionY === null || editingDevice.imageDisplayPositionY === undefined) {
        editingDevice.imageDisplayPositionY = 50;
      }
    }

    function startCropMove(event) {
      cropDrag.active = true;
      cropDrag.mode = 'move';
      cropDrag.startY = event.clientY;
      cropDrag.startTop = Number.parseFloat(cropSelectionStyle.value.top) || 0;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    function startCropResize(event) {
      cropDrag.active = true;
      cropDrag.mode = 'resize';
      cropDrag.startY = event.clientY;
      cropDrag.startHeight = cropDisplayHeight.value;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    function moveCropResize(event) {
      if (!cropDrag.active) return;
      const editorHeight = cropEditorHeight.value || 720;
      const visualHeight = Math.min(editorHeight, cropDisplayHeight.value);
      const maxTop = Math.max(0, editorHeight - visualHeight);
      if (cropDrag.mode === 'move') {
        const nextTop = Math.min(maxTop, Math.max(0, cropDrag.startTop + event.clientY - cropDrag.startY));
        editingDevice.imageDisplayPositionY = maxTop ? Math.round(nextTop / maxTop * 100) : 50;
        return;
      }
      const maxHeight = Math.min(720, editorHeight);
      const minHeight = Math.min(120, maxHeight);
      const nextHeight = Math.round(cropDrag.startHeight + event.clientY - cropDrag.startY);
      editingDevice.imageDisplayHeight = Math.min(maxHeight, Math.max(minHeight, nextHeight));
    }

    function finishCropResize() {
      cropDrag.active = false;
      cropDrag.mode = '';
    }

    // 图片选择先在客户端拒绝超过服务端上限的文件，避免上传后才收到失败响应。
    function onImageChange(e) {
      const file = e.target.files[0];
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        alert('仅支持 JPEG、PNG 和 WebP 图片');
        e.target.value = '';
        return;
      }
      if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
        alert('图片不能超过 20 MB');
        e.target.value = '';
        return;
      }
      pendingImageFile = file;
      editingDevice.imageDisplayHeight = '';
      editingDevice.imageDisplayPositionY = '';
      editingDevice.imageDisplayAspectRatio = '';
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = URL.createObjectURL(file);
      editingDevice.previewImage = previewObjectUrl;
    }

    async function saveDevice() {
      if (!editingDevice.name || !editingDevice.model) {
        alert('请填写设备名称和型号');
        return;
      }
      if (!editingDevice.category) {
        alert('请选择设备分类');
        return;
      }
      submitting.value = true;
      try {
        const formData = new FormData();
        formData.append('name', editingDevice.name);
        formData.append('model', editingDevice.model);
        formData.append('location', editingDevice.location);
        formData.append('notes', editingDevice.notes);
        formData.append('category', editingDevice.category);
        formData.append('imageDisplayHeight', editingDevice.previewImage ? String(cropDisplayHeight.value) : '');
        formData.append('imageDisplayPositionY', editingDevice.previewImage ? String(cropDisplayPositionY.value) : '');
        const cropWidth = cropEditor.value?.clientWidth || 0;
        const cropHeight = cropDisplayHeight.value;
        const cropAspectRatio = cropWidth > 0 && cropHeight > 0
          ? (cropWidth / cropHeight).toFixed(4)
          : String(editingDevice.imageDisplayAspectRatio || '');
        formData.append('imageDisplayAspectRatio', editingDevice.previewImage ? cropAspectRatio : '');
        if (pendingImageFile) {
          formData.append('image', pendingImageFile, pendingImageFile.name);
        } else {
          const fileInput = imageInput.value;
          if (fileInput?.files[0]) {
            formData.append('image', fileInput.files[0]);
          }
        }

        // 有 id 走更新（PUT），否则新增（POST）；两者后端都支持 multipart 上传图片
        const method = editingDevice.id ? 'PUT' : 'POST';
        const url = editingDevice.id ? '/api/devices/' + editingDevice.id : '/api/devices';
        const res = await apiCall(method, url, formData);
        if (res.success) {
          loadData();
          closeDeviceModal();
        } else {
          alert(res.message || (editingDevice.id ? '更新失败' : '添加失败'));
        }
      } catch (e) {
        alert('操作失败');
      } finally {
        submitting.value = false;
      }
    }

    function editDevice(dev) {
      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = '';
      }
      pendingImageFile = null;
      showEditDevice.value = true;
      editingDevice.id = dev.id;
      editingDevice.name = dev.name;
      editingDevice.model = dev.model;
      editingDevice.location = dev.location || '';
      editingDevice.notes = dev.notes || '';
      editingDevice.category = dev.category || 'cat-other';
      editingDevice.imageDisplayHeight = dev.imageDisplayHeight || '';
      editingDevice.imageDisplayPositionY = dev.imageDisplayPositionY ?? '';
      editingDevice.imageDisplayAspectRatio = dev.imageDisplayAspectRatio ?? '';
      editingDevice.image = dev.image || '';
      editingDevice.previewImage = dev.image || '';
    }

    async function deleteDevice(dev) {
      if (!confirm(`确定要删除设备「${dev.name}」吗？`)) return;
      let res = await apiCall('DELETE', '/api/devices/' + dev.id);
      if (res.requiresRecordDeletion) {
        const confirmed = confirm(
          `${res.message || '该设备存在借用记录'}。\n\n确认删除设备及其全部借用记录吗？此操作不可恢复。`
        );
        if (!confirmed) return;
        res = await apiCall('DELETE', '/api/devices/' + dev.id + '?deleteRecords=true');
      }
      if (res.success) {
        devices.value = devices.value.filter(d => d.id !== dev.id);
      } else {
        alert(res.message || '删除失败');
      }
    }

    async function toggleOperationalStatus(dev) {
      if (dev.status === 'borrowed' && dev.operationalStatus !== 'offline') {
        alert('设备正在借用中，请归还后再下线');
        return;
      }

      const nextStatus = dev.operationalStatus === 'offline' ? 'online' : 'offline';
      let offlineReason = '';
      if (nextStatus === 'offline') {
        if (!confirm(`确定将「${dev.name}」设为离线吗？离线后普通用户无法借用。`)) return;
        offlineReason = prompt('请填写离线原因（例如：故障维修）：', dev.offlineReason || '') ?? '';
      } else if (!confirm(`确定将「${dev.name}」重新上线吗？`)) {
        return;
      }

      const res = await apiCall('PUT', '/api/devices/' + dev.id + '/operational-status', {
        operationalStatus: nextStatus,
        offlineReason
      });
      if (res.success) {
        await loadData();
      } else {
        alert(res.message || '状态更新失败');
      }
    }

    function toggleDeviceSelection(deviceId) {
      selectedDeviceIds.value = selectedDeviceIds.value.includes(deviceId)
        ? selectedDeviceIds.value.filter(id => id !== deviceId)
        : [...selectedDeviceIds.value, deviceId];
    }

    function clearDeviceSelection() {
      selectedDeviceIds.value = [];
    }

    function closeMobileDeviceTools(event) {
      event.currentTarget.closest('details')?.removeAttribute('open');
    }

    // 批量分类与状态操作共享设备选择，但使用独立弹窗状态和原子接口。
    function openBatchCategory() {
      if (!selectedDeviceIds.value.length) return;
      batchCategoryId.value = '';
      batchCategoryError.value = '';
      showBatchCategory.value = true;
    }

    function closeBatchCategory() {
      showBatchCategory.value = false;
      batchCategoryId.value = '';
      batchCategoryError.value = '';
    }

    async function submitBatchCategory() {
      if (!selectedDeviceIds.value.length || !batchCategoryId.value) return;
      submitting.value = true;
      batchCategoryError.value = '';
      try {
        const res = await apiCall('PUT', '/api/devices/batch-category', {
          deviceIds: selectedDeviceIds.value,
          category: batchCategoryId.value
        });
        if (!res.success) {
          batchCategoryError.value = res.errors?.map(error => `${error.deviceName || error.deviceId}：${error.message}`).join('；') || res.message || '批量分类失败';
          return;
        }
        alert(`成功将 ${res.data.count} 台设备分类至“${res.data.category.name}”`);
        selectedDeviceIds.value = [];
        closeBatchCategory();
        await loadData();
      } catch (error) {
        batchCategoryError.value = '批量分类失败，请稍后重试';
      } finally {
        submitting.value = false;
      }
    }

    // 批量上线和下线共用选择状态、确认弹窗与提交接口。
    function openBatchOffline() {
      if (!selectedDeviceIds.value.length) return;
      batchOperationalStatus.value = 'offline';
      batchOfflineReason.value = '';
      batchOfflineError.value = '';
      showBatchOffline.value = true;
    }

    function openBatchOnline() {
      if (!selectedDeviceIds.value.length) return;
      batchOperationalStatus.value = 'online';
      batchOfflineReason.value = '';
      batchOfflineError.value = '';
      showBatchOffline.value = true;
    }

    function closeBatchOffline() {
      showBatchOffline.value = false;
      batchOfflineReason.value = '';
      batchOfflineError.value = '';
    }

    async function submitBatchStatus(operationalStatus) {
      if (!selectedDeviceIds.value.length) return;
      submitting.value = true;
      batchOfflineError.value = '';
      try {
        const res = await apiCall('PUT', '/api/devices/batch-operational-status', {
          deviceIds: selectedDeviceIds.value,
          operationalStatus,
          offlineReason: batchOfflineReason.value
        });
        if (!res.success) {
          batchOfflineError.value = res.errors?.map(error => `${error.deviceName || error.deviceId}：${error.message}`).join('；') || res.message || `批量${operationalStatus === 'offline' ? '下线' : '上线'}失败`;
          return;
        }
        alert(`成功${operationalStatus === 'offline' ? '下线' : '上线'} ${res.data.count} 台设备`);
        selectedDeviceIds.value = [];
        closeBatchOffline();
        await loadData();
      } catch (error) {
        batchOfflineError.value = `批量${operationalStatus === 'offline' ? '下线' : '上线'}失败，请稍后重试`;
      } finally {
        submitting.value = false;
      }
    }

    function submitBatchOffline() {
      return submitBatchStatus('offline');
    }

    function submitBatchOnline() {
      return submitBatchStatus('online');
    }

    async function generatePortalQR() {
      const res = await apiCall('POST', '/api/qrcode/portal');
      if (!res.success) {
        alert(res.message || '统一二维码生成失败');
        return;
      }

      const qrUrl = res.qrcode;
      const win = window.open(qrUrl, '_blank');
      if (!win) {
        const a = document.createElement('a');
        a.href = qrUrl;
        a.download = '学院设备统一借还二维码.png';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }

    async function generateDeviceQR(dev) {
      const res = await apiCall('POST', '/api/devices/' + dev.id + '/qrcode');
      if (!res.success) {
        alert(res.message || '设备二维码生成失败');
        return;
      }

      const qrUrl = res.qrcode;
      const win = window.open(qrUrl, '_blank');
      if (!win) {
        const safeName = `${dev.name}-${dev.model}`.replace(/[\\/:*?"<>|]+/g, '-');
        const a = document.createElement('a');
        a.href = qrUrl;
        a.download = `${safeName}-二维码.png`;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }

    function formatDate(iso) {
      if (!iso) return '-';
      const d = new Date(iso);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // 页面加载时向后端校验 session 是否仍有效
    Vue.onMounted(async () => {
      const sid = localStorage.getItem('sessionId');
      if (!sid) return;
      try {
        const res = await apiCall('GET', '/api/admin/check');
        if (res.success && res.isAdmin) {
          adminUser.value = res.user || null;
          username.value = res.user?.username || username.value;
          isLoggedIn.value = true;
          loadData();
        } else {
          localStorage.removeItem('sessionId'); // 失效则清掉
        }
      } catch (e) {
        // 网络错误时保持未登录，让用户重新登录
      }
    });

    return {
      isLoggedIn, username, password, adminUser, isSuperAdmin, loginError, submitting, devices, records, activeRecords, archivedRecords, statistics,
          statisticsDisplay, statisticsReady, statisticsTrendAnimationKey,
      operationLogs, operationLogFilter, filteredOperationLogs,
      emailSettings, emailSettingsMessage, emailSettingsError, emailSettingsSaving, emailSettingsTesting,
      emailTemplateFields, emailPreviewEvents, emailPreviewEvent, emailSubjectInput, emailBodyInput,
      emailTemplateErrors, emailTemplatePreview, insertEmailVariable,
      selectedDeviceIds, selectedDeviceNames, showBatchOffline, batchOperationalStatus, batchOfflineReason, batchOfflineError,
      showBatchCategory, batchCategoryId, batchCategoryError,
      deviceImportColumns: DEVICE_IMPORT_COLUMNS, showDeviceImport, deviceImportInput, deviceImportFileName,
      deviceImportFileError, deviceImportPreview, deviceImportErrorCount,
      activeTab, tabs, visibleTabs, visibleNavigationGroups, adminNavigationCollapsed, adminDrawerOpen, categories, deviceViewMode, showAddDevice, showEditDevice, editingDevice, editingRecord, imageInput,
      adminUsers, showAdminModal, editingAdmin, adminSaving, adminForm, adminFormError, permissionOptions, adminManagementMessage, adminManagementError,
      showPasswordModal, passwordForm, passwordSaving, passwordMessage, passwordMessageSuccess,
      cropEditor, cropDisplayHeight, cropDisplayPositionY, cropSelectionStyle, cropShadeTopStyle, cropShadeBottomStyle,
      doLogin, doLogout, loadData, statisticsRange, statisticsLoading, statisticsError, loadStatistics, setStatisticsRange,
      openAddAdmin, openEditAdminPermissions, closeAdminModal, saveAdmin, deleteAdmin, permissionLabelsFor, changePassword, closePasswordModal,
      toggleAdminNavigation, toggleAdminDrawer, selectAdminTab,
      operationLogActionLabel, operationLogActionClass,
      downloadDeviceImportTemplate, openDeviceImport, closeDeviceImport, handleDeviceImportFile, submitDeviceImport, exportDevices,
      toggleDeviceSelection, clearDeviceSelection, closeMobileDeviceTools,
      openBatchCategory, closeBatchCategory, submitBatchCategory,
      openBatchOffline, openBatchOnline, closeBatchOffline, submitBatchOffline, submitBatchOnline,
      trendBarHeight, formatTrendDate, setDeviceViewMode, closeDeviceModal, triggerUpload, onImageChange,
      onCropImageLoad, startCropMove, startCropResize, moveCropResize, finishCropResize,
      saveDevice, editDevice, deleteDevice, toggleOperationalStatus, generatePortalQR, generateDeviceQR, archiveRecord, restoreRecord,
      deleteRecordPermanently, editActiveRecord, closeRecordModal, saveActiveRecord,
      forceReturnRecord, formatDate,
      adminImageSource, hasAdminImage, markAdminImageLoaded, markAdminImageFailed, isAdminImageLoaded,
      showAddCategory, newCategoryName, editingCategory,
      categoryDragId, categoryDragOverId, startCategoryDrag, dragOverCategory, dropCategory, finishCategoryDrag,
      addCategory, updateCategory, deleteCategory, startEditCategory, saveEmailSettings, sendEmailTest,
      siteRuntime, hitokotoText, hitokotoUrl, isHitokotoTyping
    };
  }
};

// ==================== 路由 ====================
const path = window.location.pathname;
const isBorrowPage = path === '/borrow' || path === '/borrow/';
const isAdminPage = path === '/admin' || path === '/admin/';

// ==================== 创建应用 ====================
const app = createApp({
  setup() {
    const isAdmin = Vue.ref(isAdminPage);
    const isBorrow = Vue.ref(isBorrowPage);

    // 监听 popstate 处理浏览器前进后退
    Vue.onMounted(() => {
      window.addEventListener('popstate', () => {
        const p = window.location.pathname;
        isBorrow.value = p === '/borrow' || p === '/borrow/';
        isAdmin.value = p === '/admin' || p === '/admin/';
      });
    });

    return { isAdmin, isBorrow };
  },

  template: `
    <BorrowPage v-if="isBorrow" />
    <AdminPage v-else-if="isAdmin" />
    <div v-else class="redirect-page">
      <div class="redirect-content">
        <picture><source srcset="/assets/jnu-cyber-security-emblem.webp" type="image/webp" /><img class="redirect-emblem" src="/assets/jnu-cyber-security-emblem.png" width="76" height="76" alt="暨南大学网络空间安全学院院徽" loading="eager" decoding="async" /></picture>
        <h1>设备管理系统</h1>
        <p class="redirect-affiliation">暨南大学网络空间安全学院</p>
        <p class="redirect-status">正在跳转...</p>
      </div>
    </div>
  `,

  components: { BorrowPage, AdminPage }
});

app.mount('#app');
