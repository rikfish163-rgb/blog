import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import type { infer as ZodInfer } from 'astro/zod';
import { glob } from 'astro/loaders';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug 只能是小写字母、数字和连字符');
const lang = z.enum(['zh', 'en']);
const image = z.object({
  src: z.string().min(1),
  alt: z.string().min(1),
  caption: z.string().optional(),
});
const externalLink = z.object({
  label: z.string().min(1),
  url: z.string().url(),
});

/**
 * 双语内容：zh 与 en 各自一个集合，靠 frontmatter 的 `slug` 串联译文。
 * 拆成两个集合（而不是一个集合 + lang 字段）的好处是查询时天然按语言隔离，
 * 不必每次 getCollection 都过滤。
 */

const postSchema = z.object({
  title: z.string(),
  description: z.string().max(160),

  /**
   * 跨语言共享的标识符，用来把 zh 与 en 的同一篇文章配对。
   * 也是 URL 里的那一段：/zh/posts/<slug>。
   */
  slug,

  pubDate: z.coerce.date(),
  updatedDate: z.coerce.date().optional(),

  /**
   * 决定文章渲染成哪种"纸型"：
   * tech/project → 实验记录页（带编号、数据、结论）
   * life/read    → 日记页
   * 这是让视觉承担内容分类的关键字段，避免把博客在信息架构上劈成两半。
   */
  kind: z.enum(['tech', 'life', 'read', 'project']).default('tech'),

  tags: z.array(z.string()).default([]),

  /** 首页策展区置顶 */
  featured: z.boolean().default(false),

  draft: z.boolean().default(false),

  /** 只有为 true 的页面才加载 KaTeX CSS，避免全站无谓开销 */
  math: z.boolean().default(false),
});

const projectSchema = z.object({
  slug,
  lang,
  title: z.string().min(1),
  summary: z.string().max(240),
  role: z.string().min(1),
  period: z.string().min(1),
  status: z.string().min(1),
  stack: z.array(z.string()).default([]),
  links: z.array(externalLink).default([]),
  cover: z.string().min(1).optional(),
  featured: z.boolean().default(false),
  draft: z.boolean().default(true),
});

const momentSchema = z.object({
  lang,
  pubDate: z.coerce.date(),
  tags: z.array(z.string()).default([]),
  images: z.array(image).default([]),
  draft: z.boolean().default(true),
});

const albumSchema = z.object({
  slug,
  lang,
  title: z.string().min(1),
  description: z.string().max(240),
  cover: z.string().min(1),
  date: z.coerce.date(),
  images: z.array(image).min(1),
  draft: z.boolean().default(true),
});

const mediaSchema = z.object({
  slug,
  lang,
  type: z.enum(['book', 'film', 'music']),
  title: z.string().min(1),
  creator: z.string().min(1),
  status: z.enum(['planned', 'current', 'finished']),
  cover: z.string().min(1).optional(),
  externalUrl: z.string().url().optional(),
  draft: z.boolean().default(true),
});

const friendSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  description: z.string().max(240),
  avatar: z.string().min(1).optional(),
  draft: z.boolean().default(true),
});

const faqSchema = z.object({
  lang,
  question: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  draft: z.boolean().default(true),
});

export type ProjectData = ZodInfer<typeof projectSchema>;
export type MomentData = ZodInfer<typeof momentSchema>;
export type AlbumData = ZodInfer<typeof albumSchema>;
export type MediaData = ZodInfer<typeof mediaSchema>;
export type FriendData = ZodInfer<typeof friendSchema>;
export type FaqData = ZodInfer<typeof faqSchema>;

export type PostData = ZodInfer<typeof postSchema>;

const zh = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts/zh' }),
  schema: postSchema,
});

const en = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts/en' }),
  schema: postSchema,
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: projectSchema,
});

const moments = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/moments' }),
  schema: momentSchema,
});

const albums = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/albums' }),
  schema: albumSchema,
});

const media = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/media' }),
  schema: mediaSchema,
});

const friends = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/friends' }),
  schema: friendSchema,
});

const faq = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/faq' }),
  schema: faqSchema,
});

export const collections = { zh, en, projects, moments, albums, media, friends, faq };
