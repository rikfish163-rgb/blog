import { getCollection, type CollectionEntry } from 'astro:content';
import {
  filterByLang,
  filterDrafts,
  resolveLocalizedBySlug,
  sortByDate,
  sortDeterministically,
  type Lang,
  type ResolvedLocalized,
} from './collections';

export type ProjectEntry = CollectionEntry<'projects'>;
export type MomentEntry = CollectionEntry<'moments'>;
export type AlbumEntry = CollectionEntry<'albums'>;
export type MediaEntry = CollectionEntry<'media'>;
export type FriendEntry = CollectionEntry<'friends'>;
export type FaqEntry = CollectionEntry<'faq'>;

export type ResolvedProject = ResolvedLocalized<ProjectEntry>;
export type ResolvedAlbum = ResolvedLocalized<AlbumEntry>;
export type ResolvedMedia = ResolvedLocalized<MediaEntry>;

function draftsAreVisible(): boolean {
  return !import.meta.env.PROD;
}

async function visibleProjects(): Promise<ProjectEntry[]> {
  const entries = await getCollection('projects');
  return filterDrafts(entries, { includeDrafts: draftsAreVisible() });
}

async function visibleMoments(): Promise<MomentEntry[]> {
  const entries = await getCollection('moments');
  return filterDrafts(entries, { includeDrafts: draftsAreVisible() });
}

async function visibleAlbums(): Promise<AlbumEntry[]> {
  const entries = await getCollection('albums');
  return filterDrafts(entries, { includeDrafts: draftsAreVisible() });
}

async function visibleMedia(): Promise<MediaEntry[]> {
  const entries = await getCollection('media');
  return filterDrafts(entries, { includeDrafts: draftsAreVisible() });
}

async function visibleFriends(): Promise<FriendEntry[]> {
  const entries = await getCollection('friends');
  return filterDrafts(entries, { includeDrafts: draftsAreVisible() });
}

async function visibleFaq(): Promise<FaqEntry[]> {
  const entries = await getCollection('faq');
  return filterDrafts(entries, { includeDrafts: draftsAreVisible() });
}

export function loadProjects(): Promise<ProjectEntry[]>;
export function loadProjects(lang: Lang): Promise<ResolvedProject[]>;
export async function loadProjects(
  lang?: Lang,
): Promise<ProjectEntry[] | ResolvedProject[]> {
  const entries = await visibleProjects();
  if (lang === undefined) {
    return sortDeterministically(
      entries,
      (entry) => `${entry.data.lang}:${entry.data.slug}`,
    );
  }
  return resolveLocalizedBySlug(entries, lang, {
    section: 'projects',
    includeDrafts: true,
    sort: 'slug',
  });
}

export async function allProjects(): Promise<ProjectEntry[]> {
  return loadProjects();
}

export async function projectsFor(lang: Lang): Promise<ResolvedProject[]> {
  return loadProjects(lang);
}

export async function loadMoments(lang?: Lang): Promise<MomentEntry[]> {
  let entries = await visibleMoments();
  if (lang !== undefined) entries = filterByLang(entries, lang);
  return sortByDate(
    entries,
    (entry) => entry.data.pubDate,
    (entry) => `${entry.data.lang}:${entry.id}`,
  );
}

export async function allMoments(): Promise<MomentEntry[]> {
  return loadMoments();
}

export async function momentsFor(lang: Lang): Promise<MomentEntry[]> {
  return loadMoments(lang);
}

export function loadAlbums(): Promise<AlbumEntry[]>;
export function loadAlbums(lang: Lang): Promise<ResolvedAlbum[]>;
export async function loadAlbums(
  lang?: Lang,
): Promise<AlbumEntry[] | ResolvedAlbum[]> {
  const entries = await visibleAlbums();
  if (lang === undefined) {
    return sortByDate(
      entries,
      (entry) => entry.data.date,
      (entry) => `${entry.data.lang}:${entry.data.slug}`,
    );
  }
  return resolveLocalizedBySlug(entries, lang, {
    section: 'albums',
    includeDrafts: true,
    date: 'date',
    sort: 'slug',
  });
}

export async function allAlbums(): Promise<AlbumEntry[]> {
  return loadAlbums();
}

export async function albumsFor(lang: Lang): Promise<ResolvedAlbum[]> {
  return loadAlbums(lang);
}

export function loadMedia(): Promise<MediaEntry[]>;
export function loadMedia(lang: Lang): Promise<ResolvedMedia[]>;
export async function loadMedia(
  lang?: Lang,
): Promise<MediaEntry[] | ResolvedMedia[]> {
  const entries = await visibleMedia();
  if (lang === undefined) {
    return sortDeterministically(
      entries,
      (entry) => `${entry.data.lang}:${entry.data.title}`,
      (entry) => entry.data.slug,
    );
  }
  return resolveLocalizedBySlug(entries, lang, {
    section: 'media',
    includeDrafts: true,
    sort: 'title',
  });
}

export async function allMedia(): Promise<MediaEntry[]> {
  return loadMedia();
}

export async function mediaFor(lang: Lang): Promise<ResolvedMedia[]> {
  return loadMedia(lang);
}

export async function loadFriends(): Promise<FriendEntry[]> {
  const entries = await visibleFriends();
  return sortDeterministically(
    entries,
    (entry) => entry.data.name,
    (entry) => entry.data.url,
  );
}

export async function allFriends(): Promise<FriendEntry[]> {
  return loadFriends();
}

export async function loadFaq(lang?: Lang): Promise<FaqEntry[]> {
  let entries = await visibleFaq();
  if (lang !== undefined) entries = filterByLang(entries, lang);
  return sortDeterministically(
    entries,
    (entry) => entry.data.question,
    (entry) => entry.data.sourceUrl ?? '',
  );
}

export async function loadFAQ(lang?: Lang): Promise<FaqEntry[]> {
  return loadFaq(lang);
}

export async function allFaq(): Promise<FaqEntry[]> {
  return loadFaq();
}

export async function faqFor(lang: Lang): Promise<FaqEntry[]> {
  return loadFaq(lang);
}
