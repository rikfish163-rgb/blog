/**
 * astro:content 与纯逻辑层之间的一层薄适配。
 * 所有页面都从这里取数据，保证草稿过滤、回退、排序只有一处实现。
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import { resolvePosts, type Lang, type Resolved } from './posts';

export type Entry = CollectionEntry<'zh'> | CollectionEntry<'en'>;

let cache: Resolved<Entry>[] | null = null;

/**
 * 取全部已解析文章（两种语言 × 全部 slug，含回退项），按日期倒序。
 *
 * 开发时包含草稿，生产构建排除 —— 用 import.meta.env.PROD 判断，
 * 这样不必在每个页面各写一遍过滤条件。
 */
export async function allPosts(): Promise<Resolved<Entry>[]> {
  if (cache) return cache;

  const [zh, en] = await Promise.all([getCollection('zh'), getCollection('en')]);

  cache = resolvePosts<Entry>(
    { zh: zh as Entry[], en: en as Entry[] },
    { includeDrafts: !import.meta.env.PROD },
  );
  return cache;
}

/** 某种语言下的文章列表 */
export async function postsFor(lang: Lang): Promise<Resolved<Entry>[]> {
  return (await allPosts()).filter((p) => p.lang === lang);
}

/** getStaticPaths 用：两种语言各一条 */
export function langPaths() {
  return [{ params: { lang: 'zh' } }, { params: { lang: 'en' } }];
}

/**
 * 把 URL 里的 lang 参数收窄成 Lang 类型。
 * 非法值直接抛错而不是静默当成中文 —— 静默兜底会掩盖路由配置错误。
 */
export function assertLang(v: string | undefined): Lang {
  if (v === 'zh' || v === 'en') return v;
  throw new Error(`非法的语言参数：${v}`);
}
