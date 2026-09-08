import { describe, it, expect } from 'vitest';
import { readingTime, stripMarkdown } from '../src/lib/reading-time';

describe('stripMarkdown', () => {
  it('剥掉 frontmatter', () => {
    const out = stripMarkdown('---\ntitle: x\ntags: [a]\n---\n正文在这里');
    expect(out).not.toContain('title:');
    expect(out).toContain('正文在这里');
  });

  it('剥掉围栏代码块，含 ``` 与 ~~~', () => {
    expect(stripMarkdown('前\n```js\nconst a = 1;\n```\n后')).not.toContain('const');
    expect(stripMarkdown('前\n~~~py\nx = 1\n~~~\n后')).not.toContain('x = 1');
  });

  it('剥掉行内代码', () => {
    expect(stripMarkdown('用 `rostopic echo` 看')).not.toContain('rostopic');
  });

  it('图片整体丢弃，链接保留文字丢掉 URL', () => {
    expect(stripMarkdown('![一张图](/a/b.png)')).not.toContain('b.png');
    const link = stripMarkdown('见[这篇文章](https://example.com/very/long/path)');
    expect(link).toContain('这篇文章');
    expect(link).not.toContain('example.com');
  });

  it('剥掉 HTML 标签与 KaTeX 公式', () => {
    expect(stripMarkdown('<div class="x">内容</div>')).not.toContain('class');
    expect(stripMarkdown('行内 $x^2$ 与块级 $$\\int f$$')).not.toContain('int f');
  });
});

describe('readingTime —— 中文必须按字数而非空格分词', () => {
  it('三千字中文不能被算成 1 分钟（这是最经典的错法）', () => {
    // 一整段没有空格的中文。用 split(/\s+/) 会得到长度 1 → 「1 分钟」
    const text = '这是一段测试文本用来验证中文阅读时长的计算是否正确'.repeat(120);
    const { minutes, cjkChars } = readingTime(text);
    expect(cjkChars).toBeGreaterThan(2800);
    // 400 字/分钟 → 约 7-8 分钟
    expect(minutes).toBeGreaterThanOrEqual(7);
    expect(minutes).toBeLessThanOrEqual(9);
  });

  it('纯中文按 400 字/分钟', () => {
    expect(readingTime('字'.repeat(400)).minutes).toBe(1);
    expect(readingTime('字'.repeat(800)).minutes).toBe(2);
    expect(readingTime('字'.repeat(1200)).minutes).toBe(3);
  });

  it('纯英文按 200 词/分钟', () => {
    const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const { minutes, latinWords, cjkChars } = readingTime(words);
    expect(cjkChars).toBe(0);
    expect(latinWords).toBe(400);
    expect(minutes).toBe(2);
  });

  it('中英混排时两部分累加，中文不被吞掉', () => {
    const mixed = '中'.repeat(400) + ' ' + Array.from({ length: 200 }, () => 'w').join(' ');
    const { cjkChars, latinWords, minutes } = readingTime(mixed);
    expect(cjkChars).toBe(400);
    expect(latinWords).toBe(200);
    expect(minutes).toBe(2); // 1 分钟中文 + 1 分钟英文
  });

  it('中文标点计入 CJK 而不是被当作分隔符丢掉', () => {
    expect(readingTime('你好，世界。').cjkChars).toBeGreaterThan(4);
  });

  it('至少返回 1 分钟，空输入不返回 0', () => {
    expect(readingTime('').minutes).toBe(1);
    expect(readingTime('   \n\n  ').minutes).toBe(1);
  });

  it('代码块不计入阅读时长', () => {
    const withCode = '短文。\n```js\n' + 'const x = 1;\n'.repeat(500) + '```\n';
    const withoutCode = '短文。\n';
    expect(readingTime(withCode).minutes).toBe(readingTime(withoutCode).minutes);
  });

  it('纯符号不算词', () => {
    expect(readingTime('--- *** ___ +++').latinWords).toBe(0);
  });
});
