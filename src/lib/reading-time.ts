/**
 * 中文阅读时长。
 *
 * 这里是最容易写错的地方：中文不用空格分词，`text.split(/\s+/).length` 对一篇
 * 三千字的中文文章会返回 1，算出「1 分钟」。必须按字符数算 CJK，按空格算拉丁词。
 */

/** CJK 统一汉字 + 扩展 A + 兼容表意文字 + 日文假名 + 中日韩标点 */
const CJK_RE =
  /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ　-〿]/gu;

/** 中文阅读速度（字/分钟）。400 是中文技术文的常见经验值。 */
const CJK_PER_MIN = 400;
/** 英文阅读速度（词/分钟） */
const WORD_PER_MIN = 200;

export interface ReadingStats {
  /** 向上取整的分钟数，至少 1 */
  minutes: number;
  cjkChars: number;
  latinWords: number;
}

/**
 * 去掉 Markdown 里不该计入阅读量的部分：代码块、行内代码、图片、链接 URL、
 * frontmatter、HTML 标签。保留链接文字，因为那是要读的。
 */
export function stripMarkdown(md: string): string {
  return (
    md
      // frontmatter
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
      // 围栏代码块（含 ``` 与 ~~~）
      .replace(/^[ \t]*(`{3,}|~{3,})[\s\S]*?^[ \t]*\1[ \t]*$/gm, '')
      // 行内代码
      .replace(/`[^`\n]*`/g, '')
      // 图片（整体丢弃，alt 不算阅读量）
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      // 链接：留文字，丢 URL
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // HTML / JSX 标签
      .replace(/<[^>]+>/g, '')
      // KaTeX 块级与行内公式
      .replace(/\$\$[\s\S]*?\$\$/g, '')
      .replace(/\$[^$\n]*\$/g, '')
  );
}

export function readingTime(markdown: string): ReadingStats {
  const text = stripMarkdown(markdown);

  const cjkChars = text.match(CJK_RE)?.length ?? 0;

  // 把 CJK 字符剔掉后再按空白分词，否则一整段中文会被当成一个"词"。
  const latinWords = text
    .replace(CJK_RE, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  const minutes = Math.max(1, Math.ceil(cjkChars / CJK_PER_MIN + latinWords / WORD_PER_MIN));

  return { minutes, cjkChars, latinWords };
}
