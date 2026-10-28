import { useEffect, useRef, useState } from 'react';

// NASA Image and Video Library: https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf
// No key, CORS open to any origin.
const API = 'https://images-api.nasa.gov';

export const MEDIA = { 'image,video': 'Images & videos', image: 'Images', video: 'Videos' } as const;
export const YEARS = ['', '2020', '2010', '2000', '1990', '1980', '1970', '1960'] as const;

export interface Filters {
  q: string;
  media: keyof typeof MEDIA;
  since: (typeof YEARS)[number];
}

// The few fields of a search result this app reads.
interface ApiItem {
  href: string; // the item's asset list (collection.json)
  data: { nasa_id: string; title?: string; description?: string; media_type: string; date_created?: string; center?: string }[];
  links?: { href: string; rel: string }[];
}
interface ApiSearch {
  collection: { items: ApiItem[]; links?: { rel: string }[] };
}

export interface Post {
  id: string; // nasa_id; may contain spaces
  title: string;
  description: string | null;
  date: string;
  center: string | null;
  thumbnail: string;
  assets: string;
  video: boolean;
}

// Asset URLs come back as http:// with raw spaces; the page is https.
const asUrl = (href: string) => encodeURI(href.replace(/^http:/, 'https:'));

export function toPost(item: ApiItem): Post | null {
  const data = item.data[0];
  const preview = item.links?.find((l) => l.rel === 'preview');
  if (!data || !preview) return null;
  return {
    id: data.nasa_id,
    title: data.title || '',
    description: data.description || null,
    date: data.date_created?.slice(0, 10) ?? '',
    center: data.center ?? null,
    thumbnail: asUrl(preview.href),
    assets: asUrl(item.href),
    video: data.media_type === 'video',
  };
}

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`NASA returned ${res.status}.`);
  return res.json();
}

// The best file to show full size: a web-sized rendition before the original, which can be huge.
const PREFERRED = {
  image: [/~large\.(jpe?g|png)$/i, /~medium\.(jpe?g|png)$/i, /~orig\.(jpe?g|png|gif)$/i],
  video: [/~mobile\.mp4$/i, /~medium\.mp4$/i, /~large\.mp4$/i, /~orig\.mp4$/i],
};

export async function fetchMedia(post: Post, signal?: AbortSignal): Promise<string> {
  const files = await get<string[]>(post.assets, signal);
  for (const pattern of PREFERRED[post.video ? 'video' : 'image']) {
    const file = files.find((f) => pattern.test(f));
    if (file) return asUrl(file);
  }
  if (post.video) throw new Error('No playable video for this item.');
  return post.thumbnail;
}

export async function fetchPost(id: string, signal?: AbortSignal): Promise<Post> {
  const { collection } = await get<ApiSearch>(`${API}/search?nasa_id=${encodeURIComponent(id)}`, signal);
  const post = collection.items[0] && toPost(collection.items[0]);
  if (!post) throw new Error('Item not found.');
  return post;
}

const PAGE_SIZE = 60;

function fetchPage({ q, media, since }: Filters, page: number, signal: AbortSignal) {
  const params = new URLSearchParams({ media_type: media, page: String(page), page_size: String(PAGE_SIZE) });
  if (q.trim()) params.set('q', q.trim());
  if (since) params.set('year_start', since);
  return get<ApiSearch>(`${API}/search?${params}`, signal);
}

interface GalleryState {
  posts: Post[];
  page: number; // the next page to load; NASA pages are 1-based
  loading: boolean;
  error: string | null;
  done: boolean;
}
const fresh: GalleryState = { posts: [], page: 1, loading: true, error: null, done: false };

// Paged search feed. A filter change aborts whatever is in flight and starts again from page 1;
// later pages append, skipping any item an earlier page already returned.
export function useGallery(filters: Filters) {
  const [state, setState] = useState(fresh);
  const inFlight = useRef<AbortController>(undefined);

  const load = (page: number) => {
    inFlight.current?.abort();
    const controller = (inFlight.current = new AbortController());
    setState((s) => (page === 1 ? fresh : { ...s, loading: true, error: null }));
    fetchPage(filters, page, controller.signal).then(
      ({ collection }) =>
        setState((s) => {
          const seen = new Set(s.posts.map((p) => p.id));
          const posts = collection.items.map(toPost).filter((p): p is Post => !!p && !seen.has(p.id) && !!seen.add(p.id));
          const done = !collection.links?.some((l) => l.rel === 'next');
          return { posts: [...s.posts, ...posts], page: page + 1, loading: false, error: null, done };
        }),
      (error: Error) => {
        if (!controller.signal.aborted) setState((s) => ({ ...s, loading: false, error: error.message }));
      },
    );
  };

  useEffect(() => {
    load(1);
    return () => inFlight.current?.abort();
    // Reload exactly when a filter value changes.
  }, [filters.q, filters.media, filters.since]);

  return {
    ...state,
    loadMore: () => {
      if (!state.loading && !state.done && !state.error) load(state.page);
    },
    retry: () => load(state.page),
  };
}
