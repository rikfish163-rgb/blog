import type { Lang } from './posts';

/**
 * 日期与数字格式化。
 *
 * 为什么要有这个文件：在 .astro 模板里内联拼日期会踩空白坑。
 * 写成
 *   <span>{month}.{day}</span>
 * 时，`.` 与 `{day}` 之间的换行会被当作空白保留，渲染成 "08. 31"。
 * 一律在 frontmatter 里算好完整字符串再输出，模板里不做拼接。
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** 印章用的短日期：08.31 */
export function sealDate(d: Date): string {
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

/** 文章页完整日期：2026.08.31 */
export function fullDate(d: Date): string {
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

/** ISO 日期，给 <time datetime> 和 RSS 用 */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 人类可读日期。中文用「8月31日」，英文用「Aug 31, 2026」。
 * 显式传 locale，不依赖构建机器的默认值 —— 否则本地与 CI 输出会不一致。
 */
export function readableDate(d: Date, lang: Lang): string {
  if (lang === 'zh') {
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** 千分位。热力图与访问量用，等宽字体下对齐 */
export function thousands(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

/** 秒数转「N 小时 M 分」/「Nh Mm」 */
export function duration(totalSeconds: number, lang: Lang): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (lang === 'zh') {
    return h > 0 ? `${thousands(h)} 小时 ${m} 分` : `${m} 分`;
  }
  return h > 0 ? `${thousands(h)}h ${m}m` : `${m}m`;
}
