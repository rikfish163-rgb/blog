import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_CHUNK_OVERLAP = 120;

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseFrontmatter(source) {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { data: {}, body: source };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!field) continue;
    data[field[1]] = parseScalar(field[2]);
  }
  return { data, body: source.slice(match[0].length) };
}

function cleanMarkdown(source) {
  return source
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?/, '').replace(/```\s*$/, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slugFromFile(filePath, data) {
  if (typeof data.slug === 'string' && data.slug.length > 0) return data.slug;
  return basename(filePath).replace(/\.(?:md|mdx)$/i, '').replace(/\.(?:zh|en)$/i, '');
}

function titleFromData(data, fallback) {
  if (typeof data.title === 'string' && data.title.trim()) return data.title.trim();
  if (typeof data.question === 'string' && data.question.trim()) return data.question.trim();
  return fallback;
}

function isPublished(data, collection) {
  if (typeof data.draft === 'boolean') return data.draft === false;
  // The post schema defaults draft to false; projects and FAQ default to true.
  return collection === 'posts';
}

function inferLang(filePath, data, collection) {
  if (data.lang === 'zh' || data.lang === 'en') return data.lang;
  if (collection === 'posts') {
    const parent = basename(dirname(filePath));
    if (parent === 'zh' || parent === 'en') return parent;
  }
  const suffix = basename(filePath).match(/\.(zh|en)\.(?:md|mdx)$/i)?.[1]?.toLowerCase();
  return suffix === 'en' ? 'en' : suffix === 'zh' ? 'zh' : null;
}

function urlFor(collection, lang, slug, data) {
  if (collection === 'posts') return `/${lang}/posts/${slug}`;
  if (collection === 'projects') return `/${lang}/projects/${slug}`;
  if (collection === 'faq' && typeof data.sourceUrl === 'string' && data.sourceUrl.length > 0) {
    return data.sourceUrl;
  }
  return `/${lang}/${collection}/${slug}`;
}

function chunkText(text, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
  const size = Number.isInteger(chunkSize) && chunkSize > 0 ? chunkSize : DEFAULT_CHUNK_SIZE;
  const requestedOverlap = Number.isInteger(overlap) && overlap >= 0 ? overlap : DEFAULT_CHUNK_OVERLAP;
  const step = Math.max(1, size - Math.min(requestedOverlap, size - 1));
  const chunks = [];
  for (let start = 0; start < text.length; start += step) {
    const chunk = text.slice(start, start + size).trim();
    if (chunk) chunks.push(chunk);
    if (start + size >= text.length) break;
  }
  return chunks;
}

async function markdownFiles(directory) {
  try {
    const names = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const name of names) {
      const path = join(directory, name.name);
      if (name.isDirectory()) files.push(...(await markdownFiles(path)));
      else if (name.isFile() && /\.(?:md|mdx)$/i.test(name.name)) files.push(path);
    }
    return files.sort();
  } catch {
    return [];
  }
}

async function collectDocuments(root = ROOT) {
  const sources = [
    { collection: 'posts', directory: join(root, 'src/content/posts') },
    { collection: 'projects', directory: join(root, 'src/content/projects') },
    { collection: 'faq', directory: join(root, 'src/content/faq') },
  ];
  const documents = [];
  for (const source of sources) {
    const files = await markdownFiles(source.directory);
    for (const filePath of files) {
      const parsed = parseFrontmatter(await readFile(filePath, 'utf8'));
      if (!isPublished(parsed.data, source.collection)) continue;
      const lang = inferLang(filePath, parsed.data, source.collection);
      if (!lang) continue;
      const slug = slugFromFile(filePath, parsed.data);
      const title = titleFromData(parsed.data, slug);
      const description = typeof parsed.data.description === 'string' ? parsed.data.description : '';
      const body = cleanMarkdown(parsed.body);
      const text = [title, description, body].filter(Boolean).join('\n\n').trim();
      if (!text) continue;
      const id = `${source.collection}:${lang}:${slug}`;
      documents.push({
        id,
        lang,
        title,
        url: urlFor(source.collection, lang, slug, parsed.data),
        text,
      });
    }
  }
  return documents.sort((a, b) => a.id.localeCompare(b.id));
}

function chunkDocuments(documents, options = {}) {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_CHUNK_OVERLAP;
  const chunks = [];
  for (const document of documents) {
    const parts = chunkText(document.text, chunkSize, overlap);
    parts.forEach((text, index) => {
      chunks.push({
        id: parts.length === 1 ? document.id : `${document.id}#${index + 1}`,
        lang: document.lang,
        title: document.title,
        url: document.url,
        text,
      });
    });
  }
  return chunks;
}

function embeddingEndpoint(baseUrl) {
  const value = baseUrl.replace(/\/+$/, '');
  return /\/embeddings$/i.test(value) ? value : `${value}/embeddings`;
}

async function embedChunks(chunks, env = process.env, fetchImpl = fetch) {
  const baseUrl = env.AI_BASE_URL?.trim();
  const apiKey = env.AI_API_KEY?.trim();
  const model = env.EMBEDDING_MODEL?.trim();
  if (!baseUrl || !apiKey || !model || chunks.length === 0) return null;
  const response = await fetchImpl(embeddingEndpoint(baseUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, input: chunks.map((chunk) => chunk.text) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`embedding request failed (${response.status})`);
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.data) || payload.data.length !== chunks.length) {
    throw new Error('embedding response has an unexpected shape');
  }
  const ordered = [...payload.data].sort((a, b) => Number(a?.index) - Number(b?.index));
  if (ordered.some((item) => !Array.isArray(item?.embedding))) throw new Error('embedding vector missing');
  return ordered.map((item) => item.embedding);
}

export async function buildIndex(options = {}) {
  const root = options.root ?? ROOT;
  const outputPath = options.outputPath ?? join(root, 'src/generated/ai-index.json');
  const documents = options.documents ?? (await collectDocuments(root));
  const chunks = chunkDocuments(documents, options);
  let publicReady = false;
  let mode = 'keyword';
  let embeddingError;
  if (options.skipEmbedding !== true) {
    try {
      const vectors = await embedChunks(chunks, options.env ?? process.env, options.fetchImpl ?? fetch);
      if (vectors) {
        vectors.forEach((vector, index) => {
          chunks[index].embedding = vector;
        });
        publicReady = true;
        mode = 'embedding';
      }
    } catch (error) {
      embeddingError = error instanceof Error ? error.message : 'embedding failed';
    }
  }
  const output = {
    version: 1,
    publicReady,
    mode,
    generatedAt: new Date().toISOString(),
    ...(embeddingError ? { embeddingError } : {}),
    chunks,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return output;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    const output = await buildIndex();
    const status = output.publicReady ? 'embedding' : 'keyword fallback (publicReady:false)';
    console.log(`AI index: ${output.chunks.length} chunks, ${status}`);
  } catch (error) {
    // An index build must never make a normal site build fail. Write an empty
    // keyword index if collection reading or serialization itself failed.
    const outputPath = join(ROOT, 'src/generated/ai-index.json');
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify({ version: 1, publicReady: false, mode: 'keyword', generatedAt: new Date().toISOString(), chunks: [] }, null, 2)}\n`,
      'utf8',
    );
    console.warn(`AI index unavailable; wrote keyword fallback: ${error instanceof Error ? error.message : String(error)}`);
  }
}
