import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import expressiveCode from 'astro-expressive-code';
import pagefind from 'astro-pagefind';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import { SITE_URL } from './src/site.config';

export default defineConfig({

  // Keep the site static by default; API and account routes opt into SSR.
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  site: SITE_URL,

  // Astro 7 坑 1：默认变为 'jsx'，会按 JSX 规则吃掉行内元素之间的空格
  // （<span>a</span> <em>b</em> → ab）。中文版式必被咬，显式恢复 v6 行为。
  compressHTML: true,

  i18n: {
    locales: ['zh', 'en'],
    defaultLocale: 'zh',
    routing: {
      // 两种语言都带前缀。注意：这要求 src/pages/index.astro 仍然存在，
      // 我们用它做纯静态的语言落地页。
      prefixDefaultLocale: true,
    },
    // 刻意不配 i18n.fallback：本站文章路由由 getStaticPaths() 动态生成，
    // Astro 的 fallback 语义是围绕 src/pages/ 下文件是否存在，对动态路由不生效。
    // 单语文章的回退在 src/lib/posts.ts 里自己实现，行为可预测。
  },

  markdown: {
    // Astro 7 坑 2：.md/.mdx 默认走新的 Sätteri 管线，
    // @astrojs/markdown-remark 不再默认安装，remark/rehype 插件全部失效。
    // KaTeX 依赖 remark-math + rehype-katex，必须显式退回 unified。
    //
    // 插件要传进 unified()，而不是放在 markdown.remarkPlugins ——
    // 后者虽然还能用但已废弃，会打 deprecation 警告。
    processor: unified({
      remarkPlugins: [remarkMath],
      // output:'html' 只产出 HTML+CSS，不塞 MathML，体积更小且不依赖字体回退。
      rehypePlugins: [[rehypeKatex, { output: 'html' }]],
    }),
  },

  integrations: [
    // expressiveCode 必须排在 mdx 之前，否则 .mdx 里的代码块不会被处理。
    expressiveCode({
      themes: ['github-light', 'github-dark'],
      // 主题跟随我们自己的 data-theme，而不是 expressive-code 的媒体查询。
      themeCssSelector: (theme) => `[data-ec-theme='${theme.name}']`,
      useDarkModeMediaQuery: false,
      styleOverrides: {
        borderRadius: '2px',
        codeFontFamily: 'var(--font-mono)',
        uiFontFamily: 'var(--font-mono)',
      },
    }),
    mdx(),
    sitemap({
      i18n: {
        defaultLocale: 'zh',
        locales: { zh: 'zh-CN', en: 'en' },
      },
    }),
    pagefind(),
  ],
});
