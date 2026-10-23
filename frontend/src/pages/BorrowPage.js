// 借还门户：保留运行时模板、页面私有状态、批量结算及展示动效。
import * as Vue from 'vue';
import { useReducedMotion } from 'motion-v';
import { borrowMotionComponents } from '../components/borrow-motion.js';
import MotionDeviceCard from '../components/MotionDeviceCard.tsx';
import { useDevicePresentation } from '../composables/use-device-presentation.js';
import { useBorrowCart } from '../composables/use-borrow-cart.js';
import { loadBorrowFireworks } from '../services/borrow-fireworks.js';
import { apiCall } from '../services/api.js';
import { useSiteFooter } from '../composables/use-site-footer.js';
import { formatDate } from '../utils/date.js';

// 瀑布流列数与页面断点保持一致，避免 CSS 多列自动平衡造成空列。
function getWaterfallColumnCount() {
  if (window.matchMedia?.('(max-width: 700px)').matches) return 2;
  if (window.matchMedia?.('(max-width: 960px)').matches) return 3;
  return 4;
}

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

              <!-- Motion 只为设备详情补充轻量入场，不改变移动端详情层与返回滚动逻辑。 -->
              <MotionArticle v-else-if="device" class="portal-detail"
                :initial="prefersReducedMotion ? false : { opacity: 0, y: 12 }"
                :animate="prefersReducedMotion ? {} : { opacity: 1, y: 0 }"
                :transition="{ duration: 0.22, ease: 'easeOut' }">
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
                    <span class="portal-status" :class="deviceStatusClass(device)"><span class="portal-status__dot" aria-hidden="true"></span>{{ deviceStatusText(device) }}</span>
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

                  <template v-else>
                    <!-- 操作按钮沿用 Motion 示例的明显悬停/按压比例，方便直接观察交互效果。 -->
                    <MotionButton type="button" class="btn btn--primary btn--full btn--lg" @click="showBorrowForm = true"
                      :whileHover="prefersReducedMotion ? {} : { scale: 1.03 }"
                      :whilePress="prefersReducedMotion ? {} : { scale: 0.98 }"
                      :transition="{ duration: 0.28, scale: { type: 'spring', visualDuration: 0.28, bounce: 0.35 } }">填写信息并借用</MotionButton>
                    <MotionButton type="button" class="btn btn--ghost btn--full btn--lg portal-detail__cart" :class="{ 'portal-detail__cart--active': isInCart(device.id) }" @click="toggleCartDevice(device)"
                      :whileHover="prefersReducedMotion ? {} : { scale: 1.03 }"
                      :whilePress="prefersReducedMotion ? {} : { scale: 0.98 }"
                      :transition="{ duration: 0.28, scale: { type: 'spring', visualDuration: 0.28, bounce: 0.35 } }">
                      {{ isInCart(device.id) ? '已加入借用清单（点击移除）' : '加入借用清单' }}
                    </MotionButton>
                  </template>
                </div>
              </MotionArticle>
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
                  <!-- 卡片滚动结构抽到 TSX，保留现有数据和图片事件，只改变动效表达方式。 -->
                  <MotionDeviceCard
                    v-for="entry in column.items"
                    :key="entry.item.id"
                    :entry="entry"
                    :in-cart="isInCart(entry.item.id)"
                    :prefers-reduced-motion="prefersReducedMotion"
                    :presentation="getDeviceCardPresentation(entry.item)"
                    @open-device="openDevice"
                    @toggle-cart="toggleCartDevice"
                    @image-load="handleCardImageLoad"
                    @image-error="handleCardImageError"
                  />
                </div>
              </div>
            </div>
            <!-- 其他设备入口：库存未录入时也直接创建普通借用记录。 -->
            <section v-if="!selectedDeviceId" class="portal-other-device-entry" aria-labelledby="other-device-entry-title">
              <div>
                <p class="portal-other-device-entry__eyebrow">没找到要借的设备？</p>
                <h2 id="other-device-entry-title">借用其他设备</h2>
                <p>管理员还没来得及录入的设备，也可以先填写名称借用。</p>
              </div>
              <button class="btn btn--ghost btn--sm" type="button" @click="showOtherBorrowForm = true">填写设备名称</button>
            </section>
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

          <transition-group v-else-if="returnResults.length" name="portal-return" tag="div" class="portal-return-list">
            <!-- 批量归还：备注一致时勾选多台统一归还；备注不同请各自单独填写归还。 -->
            <div class="portal-return-batch">
              <div class="portal-return-batch__head">
                <label class="portal-check">
                  <input type="checkbox" :checked="returnSelectedCount === returnResults.length && returnResults.length > 0" @change="toggleSelectAllReturns" />
                  <span>全选</span>
                </label>
                <span class="portal-return-batch__count">已选 {{ returnSelectedCount }} 台</span>
              </div>
              <div v-if="returnSelectedCount" class="form-group">
                <label>统一归还备注（可选）</label>
                <input v-model.trim="batchReturnNotes" class="input" placeholder="所选设备共用此备注；各台备注不同请单独归还" />
              </div>
              <button v-if="returnSelectedCount" class="btn btn--success btn--full btn--lg" :disabled="submitting || !returnToken" @click="doBatchReturn">
                {{ submitting ? '归还中…' : '批量归还所选 ' + returnSelectedCount + ' 台' }}
              </button>
            </div>

            <article v-for="record in returnResults" :key="record.recordId" class="portal-return-card" :class="{ 'portal-return-card--selected': returnSelected[record.recordId] }">
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
                <label class="portal-return-card__check">
                  <input type="checkbox" :checked="!!returnSelected[record.recordId]" @change="toggleReturnSelect(record.recordId)" :aria-label="'选择归还 ' + record.deviceName" />
                </label>
              </div>
              <div class="form-group">
                <label>归还备注（可选）</label>
                <textarea v-model="returnNotes[record.recordId]" class="input textarea" rows="2" placeholder="可填写设备当前状况" :disabled="!!returnSelected[record.recordId]" :class="{ 'input--disabled': returnSelected[record.recordId] }"></textarea>
              </div>
              <button class="btn btn--success btn--full btn--lg" :disabled="returningRecordId === record.recordId || !!returnSelected[record.recordId]" @click="doReturn(record)">
                {{ returningRecordId === record.recordId ? '归还中…' : (returnSelected[record.recordId] ? '已加入批量归还' : '确认归还') }}
              </button>
            </article>
          </transition-group>
        </section>
      </main>

      <!-- 外层固定水平居中，内层 Motion 只负责进出场，避免覆盖定位 transform。 -->
      <div class="portal-feedback-host">
        <AnimatePresence>
          <MotionDiv v-if="actionFeedback" class="portal-feedback" :class="'portal-feedback--' + actionFeedback.type" role="status" aria-live="polite"
            :initial="prefersReducedMotion ? false : { opacity: 0, y: -12 }"
            :animate="prefersReducedMotion ? {} : { opacity: 1, y: 0 }"
            :exit="prefersReducedMotion ? {} : { opacity: 0, y: -8 }"
            :transition="{ duration: 0.18, ease: 'easeOut' }">
            <span class="portal-feedback__mark" aria-hidden="true">{{ actionFeedback.type === 'success' ? '✓' : actionFeedback.type === 'warning' ? '!' : '×' }}</span>
            <span class="portal-feedback__copy">
              <strong>{{ actionFeedback.title }}</strong>
              <small v-if="actionFeedback.detail">{{ actionFeedback.detail }}</small>
            </span>
            <a v-if="actionFeedback.action" class="portal-feedback__action" :href="actionFeedback.action.href">{{ actionFeedback.action.label }}</a>
            <button class="portal-feedback__close" type="button" aria-label="关闭提示" @click="clearActionFeedback">×</button>
          </MotionDiv>
        </AnimatePresence>
      </div>

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

      <!-- 批量借用弹窗：多台设备共用一份借用信息，只填一次表单。 -->
      <div v-if="showBatchBorrowForm && borrowCart.length" class="modal-overlay portal-batch-modal" @click.self="showBatchBorrowForm = false">
        <div class="modal">
          <div class="modal-header">
            <div><h2>批量借用 {{ borrowCart.length }} 台设备</h2><p class="modal-tip">以下设备将使用同一份借用信息，请填写真实信息。</p></div>
            <button class="modal-close" aria-label="关闭" @click="showBatchBorrowForm = false">✕</button>
          </div>
          <div class="modal-body">
            <div class="portal-batch-list">
              <span v-for="item in borrowCart" :key="item.id" class="portal-batch-chip">{{ item.name }}<small>{{ item.model }}</small></span>
            </div>
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
            <button class="btn btn--ghost btn--lg" @click="showBatchBorrowForm = false">取消</button>
            <button class="btn btn--primary btn--lg" :disabled="submitting" @click="doBatchBorrow">{{ submitting ? '提交中…' : '确认借用' }}</button>
          </div>
        </div>
      </div>

      <!-- 其他设备借用弹窗：沿用普通借用信息，并把设备名称一并写入 records.json。 -->
      <div v-if="showOtherBorrowForm" class="modal-overlay" @click.self="showOtherBorrowForm = false">
        <div class="modal">
          <div class="modal-header">
            <div><h2>借用其他设备</h2><p class="modal-tip">请填写设备名称和真实借用信息，管理员会看到这条普通借用记录。</p></div>
            <button class="modal-close" type="button" aria-label="关闭" @click="showOtherBorrowForm = false">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>设备名称 <span class="required">*</span></label>
              <input v-model.trim="form.otherDeviceName" class="input" maxlength="100" placeholder="如：无线领夹麦克风" />
            </div>
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
            <button class="btn btn--ghost btn--lg" type="button" @click="showOtherBorrowForm = false">取消</button>
            <button class="btn btn--primary btn--lg" type="button" :disabled="submitting" @click="doOtherBorrow">{{ submitting ? '提交中…' : '确认借用' }}</button>
          </div>
        </div>
      </div>

      <!-- 借用清单浮层：选中多台设备后统一填写借用信息。 -->
      <div v-if="borrowCart.length" class="portal-cart">
        <div v-if="showBorrowCart" class="portal-cart__panel">
          <div class="portal-cart__panel-header">
            <strong>借用清单（{{ borrowCart.length }}/{{ MAX_BATCH_BORROW }}）</strong>
            <button class="portal-cart__clear" @click="clearBorrowCart">清空</button>
          </div>
          <ul class="portal-cart__items">
            <li v-for="item in borrowCart" :key="item.id">
              <span class="portal-cart__name">{{ item.name }}<small v-if="item.model">{{ item.model }}</small></span>
              <button class="portal-cart__remove" :aria-label="'移除 ' + item.name" @click="toggleCartDevice(item)">✕</button>
            </li>
          </ul>
          <button class="btn btn--primary btn--full btn--lg" @click="openBatchBorrowForm">统一填写信息并借用</button>
        </div>
        <button class="portal-cart__bar" @click="showBorrowCart = !showBorrowCart" :aria-expanded="showBorrowCart ? 'true' : 'false'">
          <span><transition name="portal-cart-count" mode="out-in"><span :key="borrowCart.length">已选 {{ borrowCart.length }} 台设备待借用</span></transition></span>
          <strong>{{ showBorrowCart ? '收起' : '统一填写借用 ›' }}</strong>
        </button>
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
    const { siteRuntime, hitokotoText, hitokotoUrl, isHitokotoTyping } = useSiteFooter();
    // Motion 自动读取系统减少动态效果设置，所有新增动效在该模式下保持静态。
    const prefersReducedMotion = useReducedMotion();
    const initialDeviceId = new URLSearchParams(window.location.search).get('id');
    const activeMode = Vue.ref('borrow');
    const availableDevices = Vue.ref([]);
    const searchQuery = Vue.ref('');
    const activeCategory = Vue.ref('');
    const categories = Vue.ref([]);
    const devicePresentation = useDevicePresentation(categories);
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
    const showOtherBorrowForm = Vue.ref(false);
    const submitting = Vue.ref(false);
    const returningRecordId = Vue.ref('');
    const returnSearched = Vue.ref(false);
    const returnResults = Vue.ref([]);
    const returnToken = Vue.ref('');
    const returnNotes = Vue.reactive({});
    // 批量归还：勾选多台 + 统一备注一次归还；备注不同走单台各自归还。
    const returnSelected = Vue.reactive({});
    const batchReturnNotes = Vue.ref('');
    const returnSelectedCount = Vue.computed(() => Object.keys(returnSelected).filter(id => returnSelected[id]).length);
    const form = Vue.reactive({
      otherDeviceName: '', borrowerName: '', borrowerId: '', borrowerPhone: '', major: '', purpose: ''
    });
    const returnLookup = Vue.reactive({ borrowerName: '', borrowerPhone: '' });
    // 清单只管理设备摘要与开关，借用人表单和接口调用仍由页面负责。
    const borrowCartState = useBorrowCart();
    const {
      MAX_BATCH_BORROW, borrowCart, showBorrowCart, showBatchBorrowForm,
      isInCart, clearBorrowCart, openBatchBorrowForm
    } = borrowCartState;
    // 借还成功提示只保存在当前页面，并在组件卸载时清理自动消失计时器。
    const actionFeedback = Vue.ref(null);
    let feedbackTimerId = null;

    // 统一管理借还结果反馈，避免使用阻塞式系统弹窗打断用户浏览。
    function clearActionFeedback() {
      if (feedbackTimerId !== null) window.clearTimeout(feedbackTimerId);
      feedbackTimerId = null;
      actionFeedback.value = null;
    }

    function showActionFeedback(title, detail = '', type = 'success', action = null) {
      clearActionFeedback();
      actionFeedback.value = { title, detail, type, action };
      feedbackTimerId = window.setTimeout(clearActionFeedback, 4200);
    }

    function toggleCartDevice(device) {
      if (borrowCartState.toggleCartDevice(device) === 'limit') {
        alert('单次最多批量借用 ' + MAX_BATCH_BORROW + ' 台设备');
      }
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
      showOtherBorrowForm.value = false;
      if (leavesDetailImmediately) finishCloseDevice();
      if (mode === 'borrow' && !selectedDeviceId.value) loadAvailableDevices();
    }

    function resetBorrowForm() {
      form.otherDeviceName = '';
      form.borrowerName = '';
      form.borrowerId = '';
      form.borrowerPhone = '';
      form.major = '';
      form.purpose = '';
    }

    async function doBatchBorrow() {
      if (submitting.value || !borrowCart.length) return;
      if (!form.borrowerName || !/^1\d{10}$/.test(form.borrowerPhone) || !form.major || !form.purpose) {
        alert('请完整填写姓名、11 位手机号、专业和用途');
        return;
      }
      const submittedDeviceIds = borrowCartState.snapshotBorrowCart().map(item => item.id);
      const submittedForm = { ...form };
      submitting.value = true;
      try {
        const res = await apiCall('POST', '/api/records/borrow-batch', {
          deviceIds: submittedDeviceIds,
          ...submittedForm
        });
        const borrowedCount = res.data?.borrowed?.length || 0;
        const conflictNames = (res.data?.conflicts || []).map(item => item.deviceName).filter(Boolean);
        if (res.success) {
          // 部分失败或请求期间新加的设备保留；只在清单全部处理完后清空个人表单。
          const borrowedDeviceIds = (res.data?.borrowed || []).map(item => item.deviceId);
          borrowCartState.settleBatchBorrow(submittedDeviceIds, borrowedDeviceIds);
          const formUnchanged = Object.keys(submittedForm).every(field => form[field] === submittedForm[field]);
          if (!borrowCart.length && formUnchanged) resetBorrowForm();
          showActionFeedback(
            borrowedCount + ' 台设备已出舱',
            conflictNames.length ? '暂时无法借用：' + conflictNames.join('、') : '请按约定时间归还设备。',
            conflictNames.length ? 'warning' : 'success'
          );
        } else {
          showActionFeedback('批量借用暂未完成', conflictNames.length ? '无法借用：' + conflictNames.join('、') : (res.message || '请稍后重试'), 'error');
        }
        if (selectedDeviceId.value) await loadDevice(selectedDeviceId.value);
        await loadAvailableDevices();
      } catch (e) {
        alert('网络错误，请重试');
      } finally {
        submitting.value = false;
      }
    }

    async function doBorrow() {
      const submittedDeviceId = device.value?.id;
      if (submitting.value || !submittedDeviceId) return;
      if (!form.borrowerName || !/^1\d{10}$/.test(form.borrowerPhone) || !form.major || !form.purpose) {
        alert('请完整填写姓名、11 位手机号、专业和用途');
        return;
      }
      submitting.value = true;
      try {
        const res = await apiCall('POST', '/api/records/borrow', {
          deviceId: submittedDeviceId,
          ...form
        });
        if (res.success) {
          borrowCartState.removeCartDevices([submittedDeviceId]);
          showBorrowForm.value = false;
          resetBorrowForm();
          showActionFeedback('设备已出舱', '请按约定时间归还设备。');
          await loadDevice(selectedDeviceId.value);
          await loadAvailableDevices();
        } else {
          showActionFeedback('借用暂未完成', res.message || '请稍后重试', 'error');
        }
      } catch (e) {
        showActionFeedback('借用暂未完成', '网络错误，请重试。', 'error');
      } finally {
        submitting.value = false;
      }
    }

    // 其他设备仍走普通借还记录，只跳过库存设备状态更新。
    async function doOtherBorrow() {
      if (!form.otherDeviceName || !form.borrowerName || !/^1\d{10}$/.test(form.borrowerPhone) || !form.major || !form.purpose) {
        alert('请完整填写设备名称、姓名、11 位手机号、专业和用途');
        return;
      }
      submitting.value = true;
      try {
        const res = await apiCall('POST', '/api/records/borrow-other', { ...form });
        if (res.success) {
          showOtherBorrowForm.value = false;
          resetBorrowForm();
          showActionFeedback('设备借用成功', '借用记录已保存；管理员会尽快上线这台设备。');
        } else {
          showActionFeedback('借用暂未完成', res.message || '请稍后重试', 'error');
        }
      } catch (e) {
        showActionFeedback('借用暂未完成', '网络错误，请重试。', 'error');
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
          // 新查询后清理失效的勾选和统一备注，避免残留选择作用于其他记录。
          const activeIds = new Set(returnResults.value.map(record => record.recordId));
          for (const id of Object.keys(returnSelected)) {
            if (!activeIds.has(id)) delete returnSelected[id];
          }
          if (!returnSelectedCount.value) batchReturnNotes.value = '';
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
          delete returnSelected[record.recordId];
          returnSearched.value = true;
          await loadAvailableDevices();
          showActionFeedback('设备已归舱', '谢谢配合。', 'success', { label: '打开答案之书', href: '/answers' });
        } else {
          showActionFeedback('归还暂未完成', res.message || '请稍后重试', 'error');
        }
      } catch (e) {
        showActionFeedback('归还暂未完成', '网络错误，请重试。', 'error');
      } finally {
        returningRecordId.value = '';
      }
    }

    function toggleReturnSelect(recordId) {
      returnSelected[recordId] = !returnSelected[recordId];
    }

    function toggleSelectAllReturns() {
      const allSelected = returnSelectedCount.value === returnResults.value.length && returnResults.value.length > 0;
      for (const record of returnResults.value) {
        returnSelected[record.recordId] = !allSelected;
      }
    }

    async function doBatchReturn() {
      const ids = returnResults.value.filter(record => returnSelected[record.recordId]).map(record => record.recordId);
      if (!ids.length || !returnToken.value) return;
      submitting.value = true;
      try {
        const res = await apiCall('POST', '/api/records/return-batch', {
          recordIds: ids,
          returnToken: returnToken.value,
          notes: batchReturnNotes.value
        });
        const returnedCount = res.data?.returned?.length || 0;
        const conflictNames = (res.data?.conflicts || []).map(item => item.deviceName).filter(Boolean);
        if (res.success) {
          showActionFeedback(
            returnedCount + ' 台设备已归舱',
            conflictNames.length ? '暂时无法归还：' + conflictNames.join('、') : '归还记录已更新。',
            conflictNames.length ? 'warning' : 'success',
            conflictNames.length ? null : { label: '打开答案之书', href: '/answers' }
          );
        } else {
          showActionFeedback('批量归还暂未完成', conflictNames.length ? '无法归还：' + conflictNames.join('、') : (res.message || '请稍后重试'), 'error');
        }
        // 清空选择与统一备注，并重新查询待归还列表。
        for (const record of returnResults.value) {
          if (returnSelected[record.recordId]) {
            delete returnSelected[record.recordId];
            delete returnNotes[record.recordId];
          }
        }
        batchReturnNotes.value = '';
        await lookupReturns();
      } catch (e) {
        showActionFeedback('归还暂未完成', '网络错误，请重试。', 'error');
      } finally {
        submitting.value = false;
      }
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
      clearActionFeedback();
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('resize', updateWaterfallColumnCount);
    });

    return {
      activeMode, availableDevices, filteredDevices, deviceColumns, searchQuery, activeCategory, categories, loadingDevices, selectedDeviceId, device, currentBorrower,
       detailLoading, noDevice, showBorrowForm, showOtherBorrowForm, submitting, returningRecordId, returnSearched,
      returnResults, returnToken, returnNotes, form, returnLookup,
      ...devicePresentation,
       deviceStatusText, deviceStatusClass, isMobileDetailLayout, openDevice, closeDevice, finishCloseDevice, switchMode, doBorrow, doOtherBorrow,
      lookupReturns, doReturn, formatDate, siteRuntime, hitokotoText, hitokotoUrl, isHitokotoTyping,
      MAX_BATCH_BORROW, borrowCart, showBorrowCart, showBatchBorrowForm, isInCart, toggleCartDevice, clearBorrowCart, openBatchBorrowForm, doBatchBorrow,
      returnSelected, batchReturnNotes, returnSelectedCount, toggleReturnSelect, toggleSelectAllReturns, doBatchReturn,
      actionFeedback, clearActionFeedback, prefersReducedMotion
    };
  },

  components: { ...borrowMotionComponents, MotionDeviceCard }
};

export default BorrowPage;
