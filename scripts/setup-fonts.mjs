#!/usr/bin/env node
/**
 * 把字体从 node_modules 搬进 public/fonts/，并按语言拆成三个 CSS。
 *
 * 为什么不直接 import 字体包的 CSS：
 *  1. lxgw-wenkai-screen-webfont 的 style.css 会 @import 全部四个变体（GB/全字集
 *     × 两种字重），加起来约 20MB。只能挑一个，这里挑 GB 简体屏显版。
 *  2. 字体必须按语言分载 —— /en 页面不该下载任何 CJK 字体。用 Vite 的 import
 *     很难精确控制哪个页面注入哪段 CSS，用 public/ 下的固定 URL + 条件 <link>
 *     则完全可控。
 *
 * 毛笔体（马善政楷书）单独处理：fontsource 给的是 2.6MB 单文件，而站点只用它写
 * 两个字（WORDMARK）。整包拉下来纯属浪费，所以用 pyftsubset 切成微型子集。
 * 子集的字符直接从 site.config.ts 读，避免改了站名忘了重切。
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NM = join(ROOT, 'node_modules');
const OUT = join(ROOT, 'public', 'fonts');

const log = (...a) => console.log('[fonts]', ...a);

/* ── 1. 从 site.config.ts 取出 WORDMARK ───────────────────────────── */

function readWordmark() {
  const src = readFileSync(join(ROOT, 'src', 'site.config.ts'), 'utf8');
  const m = src.match(/export const WORDMARK\s*=\s*['"]([^'"]+)['"]/);
  if (!m) {
    throw new Error('在 src/site.config.ts 里找不到 WORDMARK，无法确定毛笔体要切哪些字');
  }
  return m[1];
}

/* ── 2. 复制一份 @font-face CSS 及其引用的字体文件 ─────────────────── */

/**
 * 读取字体包的 CSS，把它引用的每个文件复制到目标目录，并重写 url()。
 *
 * url() 必须整体重建而不是做前缀替换：fontsource 写的是不带引号的
 * `url(./files/x.woff2)`，而 lxgw 写的是带单引号的 `url('./files/x.woff2')`。
 * 用正则只替前缀会得到 `url('./a/files/x.woff2)` —— 引号不配对，整条
 * @font-face 静默失效，字体永远加载不上且没有任何报错。
 *
 * @param rewrite 把包内相对路径映射成最终 CSS 里的 URL
 * @returns 改写后的 CSS 文本
 */
function copyCssWithAssets({ cssPath, pkgDir, destDir, rewrite = (rel) => `./${rel}` }) {
  const css = readFileSync(cssPath, 'utf8');
  mkdirSync(destDir, { recursive: true });

  let copied = 0;

  // 先逐条处理 src:，只保留 woff2 分支。
  // woff 是给 IE / 老 Safari 的回退，体积和 woff2 相当却用不上，纯属浪费。
  const out = css.replace(/src:\s*([^;}]+)/g, (_all, srcVal) => {
    const kept = [];
    for (const part of String(srcVal).split(/,(?![^(]*\))/)) {
      const m = part.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
      if (!m) continue;
      const rel = m[1].replace(/^\.\//, '');
      if (!rel.endsWith('.woff2')) continue;

      const from = join(pkgDir, rel);
      if (!existsSync(from)) throw new Error(`字体文件缺失：${from}`);
      const to = join(destDir, rel);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      copied++;

      kept.push(`url('${rewrite(rel)}') format('woff2')`);
    }
    if (kept.length === 0) throw new Error(`${cssPath} 里有一条 src 没留下任何 woff2`);
    return `src: ${kept.join(', ')}`;
  });

  return { css: out, copied };
}

/* ── 3. 毛笔体微型子集 ────────────────────────────────────────────── */

function subsetWordmark(text) {
  const pkg = join(NM, '@fontsource', 'ma-shan-zheng');
  const src = join(pkg, 'files', 'ma-shan-zheng-chinese-simplified-400-normal.woff2');
  if (!existsSync(src)) throw new Error(`找不到毛笔体源文件：${src}`);

  const dest = join(OUT, 'wordmark.woff2');
  const before = (readFileSync(src).byteLength / 1048576).toFixed(2);

  execFileSync(
    'pyftsubset',
    [
      src,
      `--text=${text}`,
      '--flavor=woff2',
      `--output-file=${dest}`,
      // 站名是纯展示文字，不需要 OpenType 排版特性、hinting 或字距表
      '--layout-features=',
      '--no-hinting',
      '--desubroutinize',
      '--drop-tables+=GSUB,GPOS,GDEF,kern',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  const after = (readFileSync(dest).byteLength / 1024).toFixed(1);
  log(`毛笔体子集「${text}」：${before} MB → ${after} KB`);
  return after;
}

/* ── 主流程 ───────────────────────────────────────────────────────── */

const wordmark = readWordmark();
log(`WORDMARK = 「${wordmark}」`);

// 每次全量重建，避免改了配置后留下上一次的残留文件
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 中文正文：霞鹜文楷 Screen，GB 简体屏显版，97 个 unicode-range 分包
const lxgwPkg = join(NM, 'lxgw-wenkai-screen-webfont');
const lxgw = copyCssWithAssets({
  cssPath: join(lxgwPkg, 'lxgwwenkaigbscreen.css'),
  pkgDir: lxgwPkg,
  destDir: join(OUT, 'lxgw'),
  rewrite: (rel) => `./lxgw/${rel}`,
});
writeFileSync(join(OUT, 'zh.css'), lxgw.css);
log(`中文正文：${lxgw.copied} 个 woff2 分包（浏览器按 unicode-range 只取用到的几个）`);

// 英文正文：iA Writer Quattro，只要 400 与 700 正体，斜体用得少不预载
const iaPkg = join(NM, '@fontsource', 'ia-writer-quattro');
let enCss = '';
for (const w of ['400', '700']) {
  const r = copyCssWithAssets({
    cssPath: join(iaPkg, `${w}.css`),
    pkgDir: iaPkg,
    destDir: join(OUT, 'ia'),
    rewrite: (rel) => `./ia/${rel}`,
  });
  enCss += r.css;
}
writeFileSync(join(OUT, 'en.css'), enCss);
log('英文正文：iA Writer Quattro 400 + 700');

// 两种语言都要的：等宽（代码与数字）+ 毛笔体子集（站名）
const monoPkg = join(NM, '@fontsource', 'ibm-plex-mono');
let baseCss = '';
for (const w of ['400', '600']) {
  const cssPath = join(monoPkg, `latin-${w}.css`);
  if (!existsSync(cssPath)) continue;
  const r = copyCssWithAssets({
    cssPath,
    pkgDir: monoPkg,
    destDir: join(OUT, 'mono'),
    rewrite: (rel) => `./mono/${rel}`,
  });
  baseCss += r.css;
}

const wordmarkKb = subsetWordmark(wordmark);
baseCss += `
/* 站名专用。已用 pyftsubset 切到只含「${wordmark}」，${wordmarkKb} KB。
   font-display: block —— 这两个字是品牌，宁可短暂空白也不要先闪一下别的字体。 */
@font-face {
  font-family: 'Wordmark Brush';
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url('./wordmark.woff2') format('woff2');
}
`;
writeFileSync(join(OUT, 'base.css'), baseCss);
log('等宽：IBM Plex Mono latin');

/* ── KaTeX：只有 math: true 的页面会 <link> 它 ────────────────────── */

function setupKatex() {
  const src = join(NM, 'katex', 'dist');
  const dest = join(ROOT, 'public', 'katex');
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(join(dest, 'fonts'), { recursive: true });

  copyFileSync(join(src, 'katex.min.css'), join(dest, 'katex.min.css'));

  // KaTeX 的 60 个字体文件覆盖各种数学字形变体，单页只会用到几个，
  // 但 CSS 里全都声明了，必须全部复制。60 个文件对 CF Pages 的
  // 20,000 文件上限毫无压力。只要 woff2，丢掉 woff 与 ttf 回退。
  let n = 0;
  for (const f of readdirSync(join(src, 'fonts'))) {
    if (!f.endsWith('.woff2')) continue;
    copyFileSync(join(src, 'fonts', f), join(dest, 'fonts', f));
    n++;
  }

  // 删掉 CSS 里 woff / ttf 的 src 分支，否则浏览器会去请求没复制的文件
  const cssPath = join(dest, 'katex.min.css');
  const css = readFileSync(cssPath, 'utf8').replace(/src:([^;}]+)/g, (all, v) => {
    const kept = String(v)
      .split(/,(?![^(]*\))/)
      .filter((s) => s.includes('.woff2'));
    return kept.length ? `src:${kept.join(',')}` : all;
  });
  writeFileSync(cssPath, css);

  log(`KaTeX：katex.min.css + ${n} 个 woff2 字体`);
}

setupKatex();

log('完成 →', OUT.replace(ROOT + '/', ''));
