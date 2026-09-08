import type { Locale } from '../site.config';

/**
 * UI 字符串双语字典。文章内容不走这里，只管界面文案。
 */
const ui = {
  zh: {
    'nav.posts': '写字',
    'nav.archive': '归档',
    'nav.tags': '标签',
    'nav.about': '关于',
    'nav.search': '搜索',
    'nav.account': '账号',
    'nav.skipToContent': '跳到正文',

    'home.featured': '最近在想的事',
    'home.recent': '全部记录',
    'home.allPosts': '看全部',
    'home.empty': '还没有写下任何东西。',

    'post.readingTime': '{n} 分钟',
    'post.published': '写于',
    'post.updated': '修订于',
    'post.page': '第 {n} / {total} 页',
    'post.remaining': '还剩 {n} 分钟',
    'post.toc': '这一页写了什么',
    'post.prev': '上一篇',
    'post.next': '下一篇',
    'post.comments': '留几句',

    // 单语文章的回退提示。语气要坦白，不要假装有译文。
    'fallback.notice': '这篇还没有中文版，以下是英文原文。',

    'kind.tech': '技术',
    'kind.life': '生活',
    'kind.read': '读书',
    'kind.project': '项目',

    'search.placeholder': '搜点什么，或直接问一句',
    'search.results': '{n} 条结果',
    'search.noResults': '什么都没搜到。',
    'search.askAI': '问 AI：{q}',
    'search.asking': '正在翻这本笔记本…',
    'search.aiSources': '这个回答参考了',
    'search.aiFailed': 'AI 暂时答不了，下面是搜索结果。',

    'data.writingHeatmap': '写作记录',
    'data.githubHeatmap': 'GitHub 提交',
    'data.codingTime': '累计编码',
    'data.visits': '访问量',
    'data.legendLess': '少',
    'data.legendMore': '多',
    'data.tableView': '看表格',
    'data.chartView': '看格子',
    'data.contributions': '{n} 次',
    'data.noData': '暂无数据',

    'theme.toggle': '切换深浅',
    'lang.switch': 'English',
    'archive.count': '共 {n} 篇',
    '404.title': '这一页是空白的',
    '404.body': '你要找的东西不在这本笔记本里。',
    '404.home': '回到第一页',
  },

  en: {
    'nav.posts': 'Writing',
    'nav.archive': 'Archive',
    'nav.tags': 'Tags',
    'nav.account': 'Account',
    'nav.about': 'About',
    'nav.search': 'Search',
    'nav.skipToContent': 'Skip to content',

    'home.featured': 'On my mind',
    'home.recent': 'All entries',
    'home.allPosts': 'See all',
    'home.empty': 'Nothing written yet.',

    'post.readingTime': '{n} min',
    'post.published': 'Written',
    'post.updated': 'Revised',
    'post.page': 'Page {n} / {total}',
    'post.remaining': '{n} min left',
    'post.toc': 'On this page',
    'post.prev': 'Previous',
    'post.next': 'Next',
    'post.comments': 'Leave a note',

    'fallback.notice': 'No English version yet — the Chinese original follows.',

    'kind.tech': 'Tech',
    'kind.life': 'Life',
    'kind.read': 'Reading',
    'kind.project': 'Projects',

    'search.placeholder': 'Search, or just ask',
    'search.results': '{n} results',
    'search.noResults': 'Nothing found.',
    'search.askAI': 'Ask AI: {q}',
    'search.asking': 'Leafing through the notebook…',
    'search.aiSources': 'Based on',
    'search.aiFailed': "AI can't answer right now. Search results below.",

    'data.writingHeatmap': 'Writing',
    'data.githubHeatmap': 'GitHub commits',
    'data.codingTime': 'Time coding',
    'data.visits': 'Visits',
    'data.legendLess': 'Less',
    'data.legendMore': 'More',
    'data.tableView': 'Table',
    'data.chartView': 'Grid',
    'data.contributions': '{n}',
    'data.noData': 'No data',

    'theme.toggle': 'Toggle theme',
    'lang.switch': '中文',
    'archive.count': '{n} entries',
    '404.title': 'This page is blank',
    '404.body': "What you're looking for isn't in this notebook.",
    '404.home': 'Back to page one',
  },
} as const;

export type UIKey = keyof (typeof ui)['zh'];

/**
 * 取一条 UI 文案，支持 {name} 占位符插值。
 * 缺 key 时回退到 zh 而不是抛错——界面少一个字比整页 500 好。
 */
export function t(locale: Locale, key: UIKey, vars?: Record<string, string | number>): string {
  const table = ui[locale] ?? ui.zh;
  let out: string = table[key] ?? ui.zh[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, String(v));
    }
  }
  return out;
}

/** 给组件用的柯里化版本，省得每处都传 locale。 */
export function useT(locale: Locale) {
  return (key: UIKey, vars?: Record<string, string | number>) => t(locale, key, vars);
}
