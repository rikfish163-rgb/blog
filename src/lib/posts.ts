/**
 * 双语文章的解析与列表回退。
 *
 * 列表可以展示另一语言的文章并标记原文语言，但详情页只为真实译文生成路由。
 * 这样英文列表能提示 “Chinese original” 并直接链接中文原文，而不会制造一个
 * URL 看似英文、正文却是中文的假翻译页。
 *
 * 这里全部是纯函数，不 import astro:content，方便直接跑单测。
 */

export type Lang = 'zh' | 'en';
export const LANGS: readonly Lang[] = ['zh', 'en'] as const;

export function otherLang(lang: Lang): Lang {
  return lang === 'zh' ? 'en' : 'zh';
}

/**
 * 排序用的固定 collator。
 *
 * 必须显式指定 locale：`localeCompare()` 不带参数时用的是构建机器的默认 locale，
 * 本机是 zh_CN.UTF-8（中文排在拉丁字母前），而 Cloudflare Pages 构建容器是
 * LANG=C / en_US（拉丁字母排在中文前）。不钉死就会出现「本地和线上标签顺序不一样」
 * 这种极难查的问题。本站中文为主，因此钉 zh-Hans-CN。
 */
const COLLATOR = new Intl.Collator('zh-Hans-CN', { numeric: true });

/** 只约束解析逻辑真正读到的字段，方便测试时构造最小对象。 */
export interface PostLike {
  id: string;
  data: {
    slug: string;
    pubDate: Date;
    draft: boolean;
    featured: boolean;
    tags: string[];
  };
}

export interface Resolved<T extends PostLike> {
  slug: string;
  /** 请求的语言，决定界面语言与 <html lang> */
  lang: Lang;
  /** 实际渲染的条目 */
  entry: T;
  /** 该条目本身的语言 */
  entryLang: Lang;
  /** entryLang !== lang，即这是一次回退，需要显示提示 */
  isFallback: boolean;
}

export class DuplicateSlugError extends Error {
  constructor(lang: Lang, slug: string, ids: string[]) {
    super(`[${lang}] slug "${slug}" 被多个文件使用：${ids.join(', ')}。slug 在同一语言内必须唯一。`);
    this.name = 'DuplicateSlugError';
  }
}

/**
 * 按 slug 建索引，同时把同语言内的 slug 冲突暴露成构建期错误。
 * 静默取最后一个会让人以后花很久 debug「我改的文章怎么不生效」。
 */
export function indexBySlug<T extends PostLike>(posts: T[], lang: Lang): Map<string, T> {
  const seen = new Map<string, T[]>();
  for (const p of posts) {
    const list = seen.get(p.data.slug);
    if (list) list.push(p);
    else seen.set(p.data.slug, [p]);
  }

  const out = new Map<string, T>();
  for (const [slug, list] of seen) {
    if (list.length > 1) {
      throw new DuplicateSlugError(lang, slug, list.map((p) => p.id));
    }
    out.set(slug, list[0]!);
  }
  return out;
}

export interface ResolveOptions {
  /** 开发时通常要看草稿；生产构建必须为 false */
  includeDrafts?: boolean;
}

/**
 * 为每种语言 × 每个 slug 产出一条可渲染的记录。
 * 结果已按 pubDate 倒序排好——Astro 文档明确集合顺序不确定，必须自己排。
 */
export function resolvePosts<T extends PostLike>(
  byLang: Record<Lang, T[]>,
  opts: ResolveOptions = {},
): Resolved<T>[] {
  const { includeDrafts = false } = opts;

  const keep = (p: T) => includeDrafts || !p.data.draft;
  const idx: Record<Lang, Map<string, T>> = {
    zh: indexBySlug(byLang.zh.filter(keep), 'zh'),
    en: indexBySlug(byLang.en.filter(keep), 'en'),
  };

  // 所有语言里出现过的 slug 全集
  const allSlugs = new Set<string>([...idx.zh.keys(), ...idx.en.keys()]);

  const out: Resolved<T>[] = [];
  for (const lang of LANGS) {
    const fb = otherLang(lang);
    for (const slug of allSlugs) {
      const own = idx[lang].get(slug);
      const entry = own ?? idx[fb].get(slug);
      if (!entry) continue; // 两种语言都被草稿过滤掉了
      out.push({
        slug,
        lang,
        entry,
        entryLang: own ? lang : fb,
        isFallback: !own,
      });
    }
  }

  return sortByDate(out);
}

/** pubDate 倒序；同日则按 slug 稳定排序，避免构建产物顺序抖动。 */
export function sortByDate<T extends PostLike>(items: Resolved<T>[]): Resolved<T>[] {
  return [...items].sort((a, b) => {
    const d = b.entry.data.pubDate.valueOf() - a.entry.data.pubDate.valueOf();
    return d !== 0 ? d : COLLATOR.compare(a.slug, b.slug);
  });
}

export function forLang<T extends PostLike>(items: Resolved<T>[], lang: Lang): Resolved<T>[] {
  return items.filter((i) => i.lang === lang);
}

/** 详情路由只接收真实语言条目，不为列表回退项生成假翻译页。 */
export function withoutFallback<T extends PostLike>(items: Resolved<T>[]): Resolved<T>[] {
  return items.filter((item) => !item.isFallback);
}

/**
 * 某个 slug 在目标语言里是否有真正的译文（而非回退）。
 * LangSwitch 用它决定要不要提示「切过去只有原文」。
 */
export function hasRealTranslation<T extends PostLike>(
  items: Resolved<T>[],
  slug: string,
  lang: Lang,
): boolean {
  return items.some((i) => i.slug === slug && i.lang === lang && !i.isFallback);
}

export function featured<T extends PostLike>(items: Resolved<T>[], lang: Lang, n: number): Resolved<T>[] {
  return forLang(items, lang)
    .filter((i) => i.entry.data.featured)
    .slice(0, n);
}

export function recent<T extends PostLike>(items: Resolved<T>[], lang: Lang, n: number): Resolved<T>[] {
  return forLang(items, lang).slice(0, n);
}

/** 归档页用：按年分组，年份倒序。 */
export function groupByYear<T extends PostLike>(items: Resolved<T>[]): [number, Resolved<T>[]][] {
  const map = new Map<number, Resolved<T>[]>();
  for (const i of items) {
    const y = i.entry.data.pubDate.getFullYear();
    const list = map.get(y);
    if (list) list.push(i);
    else map.set(y, [i]);
  }
  return [...map.entries()].sort((a, b) => b[0] - a[0]);
}

/**
 * 标签及其篇数，按篇数倒序、同数按钉死的 collator 排序。
 *
 * 默认跳过回退项（`isFallback`）。原因：一篇只有中文版的文章带的是中文标签，
 * 若把它计入英文标签页，/en/tags/ 就会混进「大二」「月度总结」这类中文标签，
 * 对英文读者毫无意义。这些文章在英文站仍可通过列表和搜索访问，只是不贡献标签。
 *
 * 传 includeFallback: true 可以要回全部（暂无使用场景，留作显式开关）。
 */
export function collectTags<T extends PostLike>(
  items: Resolved<T>[],
  opts: { includeFallback?: boolean } = {},
): { tag: string; count: number }[] {
  const { includeFallback = false } = opts;
  const counts = new Map<string, number>();
  for (const i of items) {
    if (!includeFallback && i.isFallback) continue;
    for (const tag of i.entry.data.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || COLLATOR.compare(a.tag, b.tag));
}

/** 上一篇 / 下一篇。items 必须已是同语言且按日期倒序。 */
export function adjacent<T extends PostLike>(
  items: Resolved<T>[],
  slug: string,
): { prev: Resolved<T> | null; next: Resolved<T> | null } {
  const i = items.findIndex((x) => x.slug === slug);
  if (i === -1) return { prev: null, next: null };
  // 倒序数组里，下标更大的是更旧的文章
  return {
    prev: items[i + 1] ?? null,
    next: items[i - 1] ?? null,
  };
}
