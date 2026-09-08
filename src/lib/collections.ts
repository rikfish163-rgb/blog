/**
 * Pure collection helpers shared by the Astro adapters and pages.
 *
 * Nothing in this module imports Astro, so the filtering, ordering, and
 * translation rules can be exercised with plain objects.
 */

export type Lang = 'zh' | 'en';
export const LANGS: readonly Lang[] = ['zh', 'en'] as const;

export function otherLang(lang: Lang): Lang {
  return lang === 'zh' ? 'en' : 'zh';
}

/** A minimal Astro content entry shape used by the generic helpers. */
export interface ContentEntry<Data extends object = object> {
  readonly id: string;
  readonly data: Data;
}

export interface DraftData {
  readonly draft: boolean;
}

export type DraftEntry<Data extends DraftData = DraftData> = ContentEntry<Data>;

export interface LocalizedData extends DraftData {
  readonly lang: Lang;
}

export type LocalizedEntry<Data extends LocalizedData = LocalizedData> = ContentEntry<Data>;

export interface LocalizedSlugData extends LocalizedData {
  readonly slug: string;
}

export type LocalizedSlugEntry<Data extends LocalizedSlugData = LocalizedSlugData> =
  ContentEntry<Data>;

/**
 * One item as seen from a requested language. `entryLang` is the language of
 * the source entry, while `lang` remains the language requested by the page.
 */
export interface ResolvedLocalized<T extends LocalizedSlugEntry = LocalizedSlugEntry> {
  readonly slug: string;
  readonly lang: Lang;
  readonly entry: T;
  readonly entryLang: Lang;
  readonly isFallback: boolean;
  readonly href: string;
}

export const STABLE_LOCALE = 'zh-Hans-CN';
const COLLATOR = new Intl.Collator(STABLE_LOCALE, {
  numeric: true,
  sensitivity: 'variant',
});

/**
 * Compare text with a pinned locale rather than the build machine's locale.
 * The code-point tie-breaker handles strings the collator considers equal and
 * therefore makes the comparator a total ordering for reproducible builds.
 */
export function compareLocale(a: string, b: string): number {
  const compared = COLLATOR.compare(a, b);
  if (compared !== 0) return compared;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Alias named for callers that want to emphasize reproducible ordering. */
export const compareStable = compareLocale;

export interface DraftFilterOptions {
  readonly includeDrafts?: boolean;
}

/** Return a new array, optionally retaining draft entries. */
export function filterDrafts<T extends DraftEntry>(
  entries: readonly T[],
  options: boolean | DraftFilterOptions = false,
): T[] {
  const includeDrafts =
    typeof options === 'boolean' ? options : (options.includeDrafts ?? false);
  return includeDrafts ? [...entries] : entries.filter((entry) => !entry.data.draft);
}

/** Keep only entries written for the requested language. */
export function filterByLang<T extends LocalizedEntry>(entries: readonly T[], lang: Lang): T[] {
  return entries.filter((entry) => entry.data.lang === lang);
}

/** Existing page code often calls this operation `forLang`. */
export function forLang<T extends LocalizedEntry>(entries: readonly T[], lang: Lang): T[] {
  return filterByLang(entries, lang);
}

export class DuplicateLocalizedSlugError extends Error {
  readonly lang: Lang;
  readonly slug: string;
  readonly sourceIds: readonly string[];

  constructor(lang: Lang, slug: string, sourceIds: readonly string[]) {
    const ids = [...sourceIds].sort(compareLocale);
    super(
      `Localized slug "${slug}" is duplicated in ${lang}; source ids: ${ids.join(', ')}`,
    );
    this.name = 'DuplicateLocalizedSlugError';
    this.lang = lang;
    this.slug = slug;
    this.sourceIds = ids;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Compatibility name for code that uses the shorter post-helper terminology. */
export const DuplicateSlugError = DuplicateLocalizedSlugError;

/** Build a language-local slug index and report every conflicting source id. */
export function indexLocalizedBySlug<T extends LocalizedSlugEntry>(
  entries: readonly T[],
  lang: Lang,
): Map<string, T> {
  const grouped = new Map<string, T[]>();
  for (const entry of entries) {
    if (entry.data.lang !== lang) continue;
    const existing = grouped.get(entry.data.slug);
    if (existing) existing.push(entry);
    else grouped.set(entry.data.slug, [entry]);
  }

  const index = new Map<string, T>();
  for (const [slug, matches] of grouped) {
    if (matches.length > 1) {
      throw new DuplicateLocalizedSlugError(
        lang,
        slug,
        matches.map((entry) => entry.id),
      );
    }
    index.set(slug, matches[0]!);
  }
  return index;
}

export type SortSelector<T extends ContentEntry> =
  | keyof T['data']
  | ((entry: T) => unknown);
export type DateSelector<T extends ContentEntry> =
  | keyof T['data']
  | ((entry: T) => Date | string | number | null | undefined);

function selectedValue<T extends ContentEntry>(entry: T, selector: SortSelector<T>): unknown {
  if (typeof selector === 'function') return selector(entry);
  return Reflect.get(entry.data, selector);
}

function defaultSortValue(entry: ContentEntry): string {
  const slug = Reflect.get(entry.data, 'slug');
  return typeof slug === 'string' ? slug : entry.id;
}

function defaultDateValue(entry: ContentEntry): unknown {
  const pubDate = Reflect.get(entry.data, 'pubDate');
  return pubDate ?? Reflect.get(entry.data, 'date');
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  return '';
}

function timestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const result = value.valueOf();
    return Number.isNaN(result) ? null : result;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const result = Date.parse(value);
    return Number.isNaN(result) ? null : result;
  }
  return null;
}

function compareDateDescending(a: unknown, b: unknown): number {
  const aTime = timestamp(a);
  const bTime = timestamp(b);
  if (aTime === null && bTime === null) return 0;
  if (aTime === null) return 1;
  if (bTime === null) return -1;
  return bTime - aTime;
}

/**
 * Sort newest first. Missing/invalid dates come last; ties use a pinned
 * locale and then the source id, so collection-loader order cannot leak in.
 */
export function sortByDate<T extends ContentEntry>(
  entries: readonly T[],
  selector?: DateSelector<T>,
  tieBreaker?: SortSelector<T>,
): T[] {
  return [...entries].sort((a, b) => {
    const dateResult = compareDateDescending(
      selector ? selectedValue(a, selector) : defaultDateValue(a),
      selector ? selectedValue(b, selector) : defaultDateValue(b),
    );
    if (dateResult !== 0) return dateResult;

    const aTie = textValue(tieBreaker ? selectedValue(a, tieBreaker) : defaultSortValue(a));
    const bTie = textValue(tieBreaker ? selectedValue(b, tieBreaker) : defaultSortValue(b));
    return compareLocale(aTie, bTie) || compareLocale(a.id, b.id);
  });
}

/** Sort by a deterministic textual key, then source id. */
export function sortDeterministically<T extends ContentEntry>(
  entries: readonly T[],
  selector?: SortSelector<T>,
  tieBreaker?: SortSelector<T>,
): T[] {
  return [...entries].sort((a, b) => {
    const aKey = textValue(selector ? selectedValue(a, selector) : defaultSortValue(a));
    const bKey = textValue(selector ? selectedValue(b, selector) : defaultSortValue(b));
    return (
      compareLocale(aKey, bKey) ||
      (tieBreaker
        ? compareLocale(
            textValue(selectedValue(a, tieBreaker)),
            textValue(selectedValue(b, tieBreaker)),
          )
        : 0) ||
      compareLocale(a.id, b.id)
    );
  });
}

export interface ResolveLocalizedOptions<T extends LocalizedSlugEntry> {
  readonly section: string;
  readonly includeDrafts?: boolean;
  readonly date?: DateSelector<T>;
  readonly sort?: SortSelector<T>;
}

type ResolveSectionOptions<T extends LocalizedSlugEntry> = Omit<
  ResolveLocalizedOptions<T>,
  'section'
>;

/** Build a language-aware route without ever putting a fallback under /en/. */
export function localizedHref(lang: Lang, section: string, slug: string): string {
  const path = section
    .split('/')
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `/${lang}/${path}/${encodeURIComponent(slug)}/`;
}

function sortResolved<T extends LocalizedSlugEntry>(
  entries: ResolvedLocalized<T>[],
  options: ResolveSectionOptions<T>,
): ResolvedLocalized<T>[] {
  return entries.sort((a, b) => {
    if (options.date) {
      const dateResult = compareDateDescending(
        selectedValue(a.entry, options.date),
        selectedValue(b.entry, options.date),
      );
      if (dateResult !== 0) return dateResult;
    }

    const aKey = textValue(
      options.sort ? selectedValue(a.entry, options.sort) : a.slug,
    );
    const bKey = textValue(
      options.sort ? selectedValue(b.entry, options.sort) : b.slug,
    );
    return compareLocale(aKey, bKey) || compareLocale(a.entry.id, b.entry.id);
  });
}

export function resolveLocalizedBySlug<T extends LocalizedSlugEntry>(
  entries: readonly T[],
  requestedLang: Lang,
  section: string,
  options?: ResolveSectionOptions<T>,
): ResolvedLocalized<T>[];
export function resolveLocalizedBySlug<T extends LocalizedSlugEntry>(
  entries: readonly T[],
  requestedLang: Lang,
  options: ResolveLocalizedOptions<T>,
): ResolvedLocalized<T>[];
export function resolveLocalizedBySlug<T extends LocalizedSlugEntry>(
  entries: readonly T[],
  requestedLang: Lang,
  sectionOrOptions: string | ResolveLocalizedOptions<T>,
  sectionOptions: ResolveSectionOptions<T> = {},
): ResolvedLocalized<T>[] {
  const section =
    typeof sectionOrOptions === 'string' ? sectionOrOptions : sectionOrOptions.section;
  const options =
    typeof sectionOrOptions === 'string' ? sectionOptions : sectionOrOptions;
  const visible = filterDrafts(entries, { includeDrafts: options.includeDrafts });
  const indexes: Record<Lang, Map<string, T>> = {
    zh: indexLocalizedBySlug(visible, 'zh'),
    en: indexLocalizedBySlug(visible, 'en'),
  };
  const slugs = [
    ...new Set<string>([...indexes.zh.keys(), ...indexes.en.keys()]),
  ].sort(compareLocale);
  const fallbackLang = otherLang(requestedLang);
  const resolved: ResolvedLocalized<T>[] = [];

  for (const slug of slugs) {
    const own = indexes[requestedLang].get(slug);
    const entry = own ?? indexes[fallbackLang].get(slug);
    if (!entry) continue;
    const entryLang = entry.data.lang;
    const isFallback = own === undefined;
    resolved.push({
      slug,
      lang: requestedLang,
      entry,
      entryLang,
      isFallback,
      href: localizedHref(entryLang, section, entry.data.slug),
    });
  }

  return sortResolved(resolved, options);
}

/** Short alias for pages that already know the collection is localized. */
export const resolveLocalized = resolveLocalizedBySlug;
