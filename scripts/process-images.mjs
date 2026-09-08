import { access, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const DEFAULT_WIDTHS = [480, 960, 1440];
const IMAGE_REFERENCE = /\/images\/[A-Za-z0-9_./-]+\.(?:avif|webp|png|jpe?g|gif)/g;

function safeSegment(value, label) {
  if (!value || value.includes('..') || path.isAbsolute(value)) {
    throw new Error(`[images] unsafe ${label}: ${value}`);
  }
  return value;
}

async function walk(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(resolved)));
    else out.push(resolved);
  }
  return out;
}

export async function validateContentImages({ contentRoot, publicRoot }) {
  const files = (await walk(contentRoot)).filter((file) => /\.(?:md|mdx)$/.test(file));
  const missing = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const reference of new Set(text.match(IMAGE_REFERENCE) ?? [])) {
      const target = path.join(publicRoot, reference.replace(/^\//, ''));
      try {
        await access(target);
      } catch {
        missing.push(`${path.relative(process.cwd(), file)}: ${reference}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`[images] referenced files are missing:\n${missing.join('\n')}`);
  }
}

export async function processImage(entry, { manifestDir, publicRoot, widths = DEFAULT_WIDTHS }) {
  const context = entry.contentFile ? ` (${entry.contentFile})` : '';
  const source = path.resolve(manifestDir, entry.source);
  const outputDir = path.resolve(publicRoot, safeSegment(entry.outputDir ?? 'images/processed', 'outputDir'));
  const relative = path.relative(publicRoot, outputDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`[images] output escapes public directory${context}: ${entry.outputDir}`);
  }

  try {
    await access(source);
  } catch {
    throw new Error(`[images] source is missing${context}: ${entry.source}`);
  }

  await mkdir(outputDir, { recursive: true });
  const parsed = path.parse(source);
  const name = safeSegment(entry.name ?? parsed.name, 'name');
  const metadata = await sharp(source).metadata();
  const sourceWidth = metadata.autoOrient?.width ?? metadata.width;
  const selected = [...new Set(widths)]
    .filter((width) => Number.isInteger(width) && width > 0 && (!sourceWidth || width <= sourceWidth))
    .sort((a, b) => a - b);
  if (selected.length === 0 && sourceWidth) selected.push(sourceWidth);

  const generated = [];
  for (const width of selected) {
    for (const format of ['avif', 'webp']) {
      const destination = path.join(outputDir, `${name}-${width}.${format}`);
      let pipeline = sharp(source).rotate().resize({ width, withoutEnlargement: true });
      pipeline = format === 'avif' ? pipeline.avif({ quality: 55 }) : pipeline.webp({ quality: 78 });
      await pipeline.toFile(destination);
      const resultMetadata = await sharp(destination).metadata();
      if (resultMetadata.exif || resultMetadata.xmp) {
        throw new Error(`[images] metadata stripping failed${context}: ${destination}`);
      }
      generated.push(`/${path.relative(publicRoot, destination).split(path.sep).join('/')}`);
    }
  }
  return generated;
}

export async function runManifest(manifestPath, roots) {
  const absolute = path.resolve(manifestPath);
  const manifest = JSON.parse(await readFile(absolute, 'utf8'));
  if (!Array.isArray(manifest.images)) throw new Error('[images] manifest must contain an images array');
  const generated = [];
  for (const entry of manifest.images) {
    try {
      generated.push(...(await processImage(entry, { ...roots, manifestDir: path.dirname(absolute) })));
    } catch (error) {
      const context = entry.contentFile ? ` in ${entry.contentFile}` : '';
      throw new Error(`[images] failed${context}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return generated;
}

async function main() {
  const root = process.cwd();
  const publicRoot = path.join(root, 'public');
  const contentRoot = path.join(root, 'src/content');
  const manifestIndex = process.argv.indexOf('--manifest');
  if (manifestIndex >= 0) {
    const manifestPath = process.argv[manifestIndex + 1];
    if (!manifestPath) throw new Error('[images] --manifest requires a path');
    const generated = await runManifest(manifestPath, { publicRoot });
    console.log(`[images] generated ${generated.length} privacy-safe responsive files`);
  }
  await validateContentImages({ contentRoot, publicRoot });
  console.log('[images] content image references verified');
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
