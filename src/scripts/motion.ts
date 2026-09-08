/**
 * 动效控制器。
 *
 * 关于 View Transitions 的纪律（这是 Astro SPA 最容易复发的坑）：
 * 打包后的 module script 只执行一次，后续导航全部忽略。所以：
 *   - 全站一次性的东西（document 级监听）在模块顶层直接做
 *   - 每页都要重建的东西挂 astro:page-load，并用 AbortController 拆掉上一页的监听，
 *     否则连续翻五页就有五份 scroll 监听在跑
 */


const REDUCED = (): boolean =>
  document.documentElement.dataset.motion === 'reduced' ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ── 渐变相位续播 ──────────────────────────────────────────── */

/**
 * 导航后把渐变动画拨回"本该在的相位"。
 *
 * InkBackdrop 带 transition:persist，但 Astro 文档明确说明 CSS 动画在导航后仍会重启，
 * persist 也救不了。重启会让缓慢流动的墨突然跳回起点，非常显眼。
 *
 * performance.now() 在同一个 document 内跨 SPA 导航持续累加，所以
 * currentTime = now % duration 正好等于"如果从未重启，此刻应处的相位"。
 * 关键是不重新定义 keyframes —— 直接调已有 CSS 动画的 currentTime，
 * 动画定义留在 motion.css 里，不在 JS 里重复一份。
 */
function reseedBackdrop(): void {
  const now = performance.now();
  for (const el of document.querySelectorAll<HTMLElement>('[data-ink-blob]')) {
    for (const anim of el.getAnimations()) {
      const d = anim.effect?.getTiming().duration;
      if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) continue;
      try {
        anim.currentTime = now % d;
      } catch {
        /* 某些浏览器在动画尚未 ready 时会拒绝赋值，忽略即可 —— 最坏情况是这一次从头播 */
      }
    }
  }
}

/* ── 逐行墨迹揭示 ──────────────────────────────────────────── */

/**
 * 用 IntersectionObserver，不用 CSS 滚动驱动动画。
 * animation-timeline 目前是 "Limited availability"（非 Baseline），
 * 而且它在 animation 简写里是 reset-only、名字拼错还会静默失效，
 * 对一个必须在所有浏览器都能读的博客来说不值得。
 */
function setupReveal(signal: AbortSignal): void {
  const targets = document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-in)');
  if (targets.length === 0) return;

  if (REDUCED()) {
    // 冗余保险：CSS 里已经处理了，但万一样式没加载也要保证内容可见
    for (const el of targets) el.classList.add('is-in');
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        io.unobserve(e.target); // 揭示一次就够，不要滚回去再淡出
      }
    },
    // 提前一点触发，让元素在进入视口时已经完成动画，而不是"看着它才开始动"
    { rootMargin: '0px 0px -12% 0px', threshold: 0.01 },
  );

  for (const el of targets) io.observe(el);
  signal.addEventListener('abort', () => io.disconnect());
}

/* ── 页边阅读进度与章节标注 ────────────────────────────────── */

function setupReadingProgress(signal: AbortSignal): void {
  const bar = document.querySelector<HTMLElement>('[data-progress-bar]');
  const article = document.querySelector<HTMLElement>('[data-article]');
  if (!bar || !article) return;
  const progressBar = bar;
  const readingArticle = article;

  const remainEl = document.querySelector<HTMLElement>('[data-remaining]');
  const sectionEl = document.querySelector<HTMLElement>('[data-current-section]');
  const totalMin = Number(remainEl?.dataset.totalMinutes ?? 0);
  const remainTpl = remainEl?.dataset.tpl ?? '{n}';

  const headings = Array.from(readingArticle.querySelectorAll<HTMLElement>('h2[id]'));

  let ticking = false;

  function update(): void {
    ticking = false;

    const rect = readingArticle.getBoundingClientRect();
    const scrollable = rect.height - window.innerHeight;
    let p: number;
    if (scrollable <= 0) {
      // 文章比视口还短，一屏读完
      p = rect.bottom <= window.innerHeight ? 1 : 0;
    } else {
      p = clamp(-rect.top / scrollable, 0, 1);
    }

    progressBar.style.transform = `scaleY(${p.toFixed(4)})`;

    if (remainEl && totalMin > 0) {
      const left = Math.max(0, Math.ceil(totalMin * (1 - p)));
      remainEl.textContent = remainTpl.replace('{n}', String(left));
    }

    if (sectionEl && headings.length > 0) {
      // 当前章节 = 最后一个已经滚过视口上沿的 h2
      let current = '';
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= 80) current = h.textContent ?? '';
        else break;
      }
      if (sectionEl.textContent !== current) sectionEl.textContent = current;
    }
  }

  function onScroll(): void {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  // passive 让滚动不被监听阻塞；signal 保证导航后自动摘除
  window.addEventListener('scroll', onScroll, { passive: true, signal });
  window.addEventListener('resize', onScroll, { passive: true, signal });
  update();
}

/* ── 每页初始化 ────────────────────────────────────────────── */

let pageAbort: AbortController | null = null;

function onPageLoad(): void {
  // 拆掉上一页留下的监听。不做这步，连续导航会不断叠加 scroll 监听。
  pageAbort?.abort();
  pageAbort = new AbortController();
  const { signal } = pageAbort;

  reseedBackdrop();
  setupReveal(signal);
  setupReadingProgress(signal);
}

/* ── 全站一次性 ────────────────────────────────────────────── */

/**
 * 钢笔尖光标只在真有精细指针时开。
 * 触屏上自定义光标无效，还会让 body 多一层 cursor 计算。
 * 用属性开关而不是直接写 cursor，方便 CSS 里集中管理语义光标的例外。
 */
function enablePenCursor(): void {
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.documentElement.dataset.penCursor = '';
  }
}

enablePenCursor();

// 全局守卫：Astro 会把小脚本内联进每个页面，若在导航后被重新执行，
// 没有守卫就会叠加一份 astro:page-load 监听（每次导航重复初始化）。
const motionWindow = window as Window & { __motionBound?: boolean };
if (!motionWindow.__motionBound) {
  motionWindow.__motionBound = true;

  /*
   * 必须先手动跑一次当前页。
   *
   * ClientRouter 在 <head> 里，初次加载时它派发 astro:page-load 的时机可能早于
   * 本模块执行（module script 是 defer 的），那样监听就永远等不到第一次事件 ——
   * 表现为首屏所有 [data-reveal] 停在 opacity:0，正文整片空白。
   *
   * onPageLoad 是幂等的（进来先 abort 上一轮），所以即使事件随后又触发一次也无害。
   */
  onPageLoad();
  document.addEventListener('astro:page-load', onPageLoad);
}
