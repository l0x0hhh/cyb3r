// 答案之书：独立维护三态交互，并复用原路径的固定文案与字体预加载。
import * as Vue from 'vue';
import { useReducedMotion } from 'motion-v';
import { preloadAnswerFont } from '../composables/use-answer-font.js';
import ANSWER_BOOK_RESPONSES from '../content/answer-book-responses.json';

// 答案之书页复刻参考站点的三态交互，答案和分享文案始终只在浏览器本地处理。
const AnswersPage = {
  setup() {
    const answer = Vue.ref('');
    const answerIndex = Vue.ref(-1);
    const isLoading = Vue.ref(false);
    const shareToastVisible = Vue.ref(false);
    let answerTimerId = null;
    let shareToastTimerId = null;
    const originalTitle = document.title;
    const prefersReducedMotion = useReducedMotion();

    // 用短暂翻书态还原参考站点的等待节奏，并避免连续两次抽到同一句。
    function drawAnswer() {
      if (isLoading.value) {
        return;
      }
      isLoading.value = true;
      answer.value = '';
      let nextIndex = Math.floor(Math.random() * ANSWER_BOOK_RESPONSES.length);
      while (ANSWER_BOOK_RESPONSES.length > 1 && nextIndex === answerIndex.value) {
        nextIndex = Math.floor(Math.random() * ANSWER_BOOK_RESPONSES.length);
      }
      answerTimerId = window.setTimeout(() => {
        answerIndex.value = nextIndex;
        answer.value = ANSWER_BOOK_RESPONSES[nextIndex];
        isLoading.value = false;
        answerTimerId = null;
      }, 850);
    }

    function showShareToast() {
      shareToastVisible.value = true;
      if (shareToastTimerId) {
        window.clearTimeout(shareToastTimerId);
      }
      shareToastTimerId = window.setTimeout(() => {
        shareToastVisible.value = false;
        shareToastTimerId = null;
      }, 2000);
    }

    function copyWithTextarea(text) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.cssText = 'position:fixed;top:1px;left:1px;width:1px;height:1px;padding:0;border:0;opacity:0;z-index:9999;';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } catch (error) {
        copied = false;
      }
      document.body.removeChild(textarea);
      return copied;
    }

    async function copyAnswer() {
      const shareText = '我刚抽到答案之书：\n「' + answer.value + '」\n\n你也来抽一次\n' + window.location.origin + '/answers';
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

      if (isMobile && navigator.share) {
        try {
          await navigator.share({ text: shareText });
          return;
        } catch (error) {
          if (error && error.name === 'AbortError') {
            return;
          }
        }
      }

      if (!copyWithTextarea(shareText) && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(shareText);
        } catch (error) {
          // 旧浏览器可能禁用剪贴板，但仍给出与参考站点一致的反馈。
        }
      }
      showShareToast();
    }

    Vue.onMounted(() => {
      // 答案页覆盖根滚动条槽位的背景，避免右侧露出借还页米白底色。
      document.documentElement.classList.add('answers-route');
      document.body.classList.add('answers-route');
      document.title = '答案之书在线免费测试 - 在犹豫不决时，找到内心的答案';
      preloadAnswerFont();
      if (!customElements.get('dotlottie-player')) {
        const playerScript = document.createElement('script');
        playerScript.type = 'module';
        playerScript.src = '/assets/dotlottie-player.mjs';
        document.head.appendChild(playerScript);
      }
    });

    Vue.onBeforeUnmount(() => {
      if (answerTimerId) {
        window.clearTimeout(answerTimerId);
      }
      if (shareToastTimerId) {
        window.clearTimeout(shareToastTimerId);
      }
      document.documentElement.classList.remove('answers-route');
      document.body.classList.remove('answers-route');
      document.title = originalTitle;
    });

    return { answer, isLoading, prefersReducedMotion, shareToastVisible, drawAnswer, copyAnswer };
  },
  template: `
    <div class="answers-page">
      <div class="answers-site-title">
        <a href="/borrow" aria-label="返回设备借还">
          <img src="/assets/answer-book-icon.png" alt="答案之书图标" width="36" height="36" />
          <!-- 站点标题使用简洁的答案之书品牌文案。 -->
          <span>答案之书</span>
        </a>
      </div>
      <!-- 右上角提供明确的返回入口，方便彩蛋结束后回到借还页面。 -->
      <a href="/borrow" class="answers-back-link">返回借还</a>

      <main class="answers-stage">
        <section v-if="isLoading" class="answers-loading" role="status" aria-live="polite">
          <dotlottie-player class="answers-loading__animation" src="/assets/answer-book-loading.json" background="transparent" :speed="prefersReducedMotion ? 0 : 1" loop autoplay></dotlottie-player>
          <p>正在翻书...</p>
        </section>

        <section v-else-if="!answer" class="answers-home">
          <h1>在犹豫不决时，找到内心的答案</h1>
          <div class="answers-home__main">
            <img class="answers-book-image" src="/assets/answer-book.png" alt="答案之书在线免费测试" width="300" height="410" decoding="async" fetchpriority="high" @click="drawAnswer" />
            <p>在心中思考一个问题，点击答案之书探索可能的答案</p>
          </div>
        </section>

        <section v-else class="answers-result" aria-live="polite">
          <p class="answers-result__quote">“<span>{{ answer }}</span>”</p>
          <div class="answers-result__actions">
            <button type="button" class="answers-share-button" @click="copyAnswer">发给朋友</button>
            <!-- 再抽一次回到答案之书主页，重新开始彩蛋。 -->
            <a href="/answers" class="answers-retry-button">再抽一次</a>
          </div>
        </section>

        <p v-if="shareToastVisible" class="answers-share-toast" role="status" aria-live="polite">文案已复制，快发给朋友咯</p>
      </main>
    </div>
  `
};

export default AnswersPage;
