import { describe, it, expect } from 'vitest';
import {
  resolvePosts,
  indexBySlug,
  hasRealTranslation,
  DuplicateSlugError,
  groupByYear,
  collectTags,
  adjacent,
  forLang,
  featured,
  otherLang,
  withoutFallback,
  type PostLike,
} from '../src/lib/posts';

/** 造一个满足 PostLike 的最小对象 */
function post(
  slug: string,
  date: string,
  extra: Partial<PostLike['data']> & { id?: string } = {},
): PostLike {
  const { id, ...data } = extra;
  return {
    id: id ?? `${slug}.md`,
    data: {
      slug,
      pubDate: new Date(date),
      draft: false,
      featured: false,
      tags: [],
      ...data,
    },
  };
}

describe('otherLang', () => {
  it('两种语言互换', () => {
    expect(otherLang('zh')).toBe('en');
    expect(otherLang('en')).toBe('zh');
  });
});

describe('indexBySlug', () => {
  it('按 slug 建索引', () => {
    const idx = indexBySlug([post('a', '2026-01-01'), post('b', '2026-01-02')], 'zh');
    expect(idx.size).toBe(2);
    expect(idx.get('a')?.id).toBe('a.md');
  });

  it('同语言内 slug 重复必须抛错，不能静默取最后一个', () => {
    const dup = [
      post('same', '2026-01-01', { id: 'first.md' }),
      post('same', '2026-01-02', { id: 'second.md' }),
    ];
    expect(() => indexBySlug(dup, 'zh')).toThrow(DuplicateSlugError);
    // 报错信息要能定位到具体文件
    expect(() => indexBySlug(dup, 'zh')).toThrow(/first\.md/);
    expect(() => indexBySlug(dup, 'zh')).toThrow(/second\.md/);
  });

  it('不同语言用同一个 slug 是正常的（那是译文）', () => {
    expect(() => indexBySlug([post('shared', '2026-01-01')], 'zh')).not.toThrow();
    expect(() => indexBySlug([post('shared', '2026-01-01')], 'en')).not.toThrow();
  });
});

describe('resolvePosts —— 双语列表回退', () => {
  it('两种语言都有译文时，各自用自己的，都不是回退', () => {
    const out = resolvePosts({
      zh: [post('both', '2026-01-01', { id: 'zh.md' })],
      en: [post('both', '2026-01-01', { id: 'en.md' })],
    });
    expect(out).toHaveLength(2);
    for (const r of out) {
      expect(r.isFallback).toBe(false);
      expect(r.entryLang).toBe(r.lang);
    }
    expect(out.find((r) => r.lang === 'zh')!.entry.id).toBe('zh.md');
    expect(out.find((r) => r.lang === 'en')!.entry.id).toBe('en.md');
  });

  it('只有中文时，英文列表回退到中文条目并标记 isFallback', () => {
    const out = resolvePosts({
      zh: [post('zh-only', '2026-01-01', { id: 'zh.md' })],
      en: [],
    });
    expect(out).toHaveLength(2); // 两种语言列表都展示，但详情路由会过滤回退项

    const zh = out.find((r) => r.lang === 'zh')!;
    expect(zh.isFallback).toBe(false);
    expect(zh.entryLang).toBe('zh');

    const en = out.find((r) => r.lang === 'en')!;
    expect(en.isFallback).toBe(true);
    expect(en.entryLang).toBe('zh');
    expect(en.entry.id).toBe('zh.md');
  });

  it('只有英文时，中文列表反向回退', () => {
    const out = resolvePosts({ zh: [], en: [post('en-only', '2026-01-01', { id: 'en.md' })] });
    const zh = out.find((r) => r.lang === 'zh')!;
    expect(zh.isFallback).toBe(true);
    expect(zh.entryLang).toBe('en');
  });

  it('详情路由过滤列表回退项，不生成假翻译页面', () => {
    const out = resolvePosts({
      zh: [post('zh-only', '2026-01-01', { id: 'zh.md' })],
      en: [],
    });
    const routes = withoutFallback(out);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.lang).toBe('zh');
    expect(routes[0]?.entryLang).toBe('zh');
  });

  it('生产构建默认排除草稿', () => {
    const out = resolvePosts({
      zh: [post('draft', '2026-01-01', { draft: true }), post('live', '2026-01-02')],
      en: [],
    });
    expect(out.map((r) => r.slug)).not.toContain('draft');
    expect(out.map((r) => r.slug)).toContain('live');
  });

  it('includeDrafts 打开时草稿参与解析', () => {
    const out = resolvePosts(
      { zh: [post('draft', '2026-01-01', { draft: true })], en: [] },
      { includeDrafts: true },
    );
    expect(out.map((r) => r.slug)).toContain('draft');
  });

  it('中文是草稿而英文不是时，中文列表展示英文原文', () => {
    const out = resolvePosts({
      zh: [post('x', '2026-01-01', { draft: true, id: 'zh.md' })],
      en: [post('x', '2026-01-01', { id: 'en.md' })],
    });
    const zh = out.find((r) => r.lang === 'zh')!;
    expect(zh.isFallback).toBe(true);
    expect(zh.entry.id).toBe('en.md');
  });

  it('两种语言都是草稿时该 slug 完全不出现', () => {
    const out = resolvePosts({
      zh: [post('gone', '2026-01-01', { draft: true })],
      en: [post('gone', '2026-01-01', { draft: true })],
    });
    expect(out).toHaveLength(0);
  });

  it('结果按 pubDate 倒序，且同日按 slug 稳定排序', () => {
    const out = forLang(
      resolvePosts({
        zh: [
          post('old', '2026-01-01'),
          post('newest', '2026-03-01'),
          post('b-same', '2026-02-01'),
          post('a-same', '2026-02-01'),
        ],
        en: [],
      }),
      'zh',
    );
    expect(out.map((r) => r.slug)).toEqual(['newest', 'a-same', 'b-same', 'old']);
  });
});

describe('hasRealTranslation', () => {
  const items = resolvePosts({
    zh: [post('both', '2026-01-02'), post('zh-only', '2026-01-01')],
    en: [post('both', '2026-01-02')],
  });

  it('有真译文时为 true', () => {
    expect(hasRealTranslation(items, 'both', 'en')).toBe(true);
  });

  it('只是回退时为 false —— LangSwitch 靠这个提示用户', () => {
    expect(hasRealTranslation(items, 'zh-only', 'en')).toBe(false);
  });

  it('原语言自身为 true', () => {
    expect(hasRealTranslation(items, 'zh-only', 'zh')).toBe(true);
  });
});

describe('groupByYear', () => {
  it('按年分组并倒序', () => {
    const items = forLang(
      resolvePosts({
        zh: [post('a', '2025-05-01'), post('b', '2026-01-01'), post('c', '2026-07-01')],
        en: [],
      }),
      'zh',
    );
    const grouped = groupByYear(items);
    expect(grouped.map(([y]) => y)).toEqual([2026, 2025]);
    expect(grouped[0]![1].map((r) => r.slug)).toEqual(['c', 'b']);
  });

  it('跨年边界：12-31 与 01-01 分到不同年', () => {
    const items = forLang(
      resolvePosts({
        zh: [post('last', '2025-12-31'), post('first', '2026-01-01')],
        en: [],
      }),
      'zh',
    );
    expect(groupByYear(items).map(([y]) => y)).toEqual([2026, 2025]);
  });
});

describe('collectTags', () => {
  it('按篇数倒序，同数按钉死的 zh-Hans-CN 排序（中文在拉丁字母前）', () => {
    const items = forLang(
      resolvePosts({
        zh: [
          post('a', '2026-01-01', { tags: ['ROS', '机器人'] }),
          post('b', '2026-01-02', { tags: ['ROS'] }),
          post('c', '2026-01-03', { tags: ['Agent'] }),
        ],
        en: [],
      }),
      'zh',
    );
    expect(collectTags(items)).toEqual([
      { tag: 'ROS', count: 2 },
      { tag: '机器人', count: 1 },
      { tag: 'Agent', count: 1 },
    ]);
  });

  it('排序不依赖构建机器的默认 locale', () => {
    // 回归测试：曾用裸 localeCompare()，本机 zh_CN 与 CF 构建容器 LANG=C
    // 会得出相反的标签顺序。这里断言结果与 zh-Hans-CN collator 一致，
    // 而不是与「当前环境恰好的默认值」一致。
    const items = forLang(
      resolvePosts({
        zh: [post('x', '2026-01-01', { tags: ['zig', '阿里', 'ROS', '读书'] })],
        en: [],
      }),
      'zh',
    );
    const got = collectTags(items).map((t) => t.tag);
    const want = ['zig', '阿里', 'ROS', '读书'].sort(
      new Intl.Collator('zh-Hans-CN', { numeric: true }).compare,
    );
    expect(got).toEqual(want);
  });

  it('无标签时返回空数组', () => {
    expect(collectTags([])).toEqual([]);
  });

  it('默认排除回退项，避免中文标签混进英文标签页', () => {
    // zh 独有的一篇带中文标签；它会以回退项出现在 en 里
    const items = resolvePosts({
      zh: [
        post('zh-only', '2026-01-02', { tags: ['月度总结', '大二'] }),
        post('both', '2026-01-01', { tags: ['ROS'] }),
      ],
      en: [post('both', '2026-01-01', { tags: ['ROS'] })],
    });

    const zhTags = collectTags(forLang(items, 'zh')).map((t) => t.tag);
    const enTags = collectTags(forLang(items, 'en')).map((t) => t.tag);

    expect(zhTags).toContain('月度总结');
    expect(zhTags).toContain('ROS');

    // 英文站不该出现只属于中文原文的标签
    expect(enTags).not.toContain('月度总结');
    expect(enTags).not.toContain('大二');
    expect(enTags).toEqual(['ROS']);
  });

  it('includeFallback 打开时把回退项的标签也算进来', () => {
    const items = resolvePosts({
      zh: [post('zh-only', '2026-01-01', { tags: ['月度总结'] })],
      en: [],
    });
    const enTags = collectTags(forLang(items, 'en'), { includeFallback: true }).map((t) => t.tag);
    expect(enTags).toEqual(['月度总结']);
  });
});

describe('adjacent', () => {
  const items = forLang(
    resolvePosts({
      zh: [post('old', '2026-01-01'), post('mid', '2026-02-01'), post('new', '2026-03-01')],
      en: [],
    }),
    'zh',
  );

  it('倒序数组里 prev 是更旧的一篇', () => {
    const { prev, next } = adjacent(items, 'mid');
    expect(prev?.slug).toBe('old');
    expect(next?.slug).toBe('new');
  });

  it('最新一篇没有 next', () => {
    expect(adjacent(items, 'new').next).toBeNull();
  });

  it('最旧一篇没有 prev', () => {
    expect(adjacent(items, 'old').prev).toBeNull();
  });

  it('slug 不存在时两侧都是 null', () => {
    expect(adjacent(items, 'nope')).toEqual({ prev: null, next: null });
  });
});

describe('featured', () => {
  it('只取标了 featured 的，并受数量上限约束', () => {
    const items = resolvePosts({
      zh: [
        post('f1', '2026-01-03', { featured: true }),
        post('f2', '2026-01-02', { featured: true }),
        post('plain', '2026-01-01'),
      ],
      en: [],
    });
    const out = featured(items, 'zh', 1);
    expect(out).toHaveLength(1);
    expect(out[0]!.slug).toBe('f1');
  });
});
