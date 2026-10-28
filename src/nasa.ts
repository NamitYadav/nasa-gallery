import { useEffect, useEffectEvent, useRef, useState } from 'react';

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

// Filters live in the query string (?q=mars&media=video&since=2010) so a search can be shared.
// Anything unrecognised falls back to the default.
export function filtersFromSearch(search: string): Filters {
  const params = new URLSearchParams(search);
  const media = params.get('media') ?? '';
  const since = params.get('since') ?? '';
  return {
    q: params.get('q') ?? 'apollo',
    media: Object.hasOwn(MEDIA, media) ? (media as Filters['media']) : 'image,video',
    since: (YEARS as readonly string[]).includes(since) ? (since as Filters['since']) : '',
  };
}

export function filtersToSearch({ q, media, since }: Filters): string {
  const params = new URLSearchParams({ q });
  if (media !== 'image,video') params.set('media', media);
  if (since) params.set('since', since);
  return `?${params}`;
}

// The few fields of a search result this app reads.
interface ApiLink {
  href: string;
  rel: string;
  render?: string;
  width?: number;
}
interface ApiItem {
  href: string; // the item's asset list (collection.json)
  data: { nasa_id: string; title?: string; description?: string; media_type: string; date_created?: string; center?: string }[];
  links?: ApiLink[];
}
interface ApiSearch {
  collection: { items: ApiItem[]; links?: { rel: string }[]; metadata?: { total_hits?: number } };
}

export interface Post {
  id: string; // nasa_id; may contain spaces
  title: string;
  description: string | null;
  date: string;
  center: string | null;
  thumbnail: string;
  srcSet: string; // every preview rendition the API lists, for sharp cards on dense screens
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
    srcSet: (item.links ?? [])
      .filter((l) => l.render === 'image' && l.width)
      .map((l) => `${asUrl(l.href)} ${l.width}w`)
      .join(', '),
    assets: asUrl(item.href),
    video: data.media_type === 'video',
  };
}

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    // Errors carry a human-readable `reason`; fall back to the status when they don't.
    const reason = await res.json().then((body) => body?.reason, () => null);
    throw new Error(reason || `NASA returned ${res.status}.`);
  }
  return res.json();
}

// The best file to show full size: a web-sized rendition before the original, which can be huge.
const PREFERRED = {
  image: [/~large\.(jpe?g|png)$/i, /~medium\.(jpe?g|png)$/i, /~orig\.(jpe?g|png|gif)$/i],
  video: [/~mobile\.mp4$/i, /~medium\.mp4$/i, /~large\.mp4$/i, /~orig\.mp4$/i],
  wideVideo: [/~medium\.mp4$/i, /~large\.mp4$/i, /~mobile\.mp4$/i, /~orig\.mp4$/i],
};

export async function fetchMedia(post: Post, wide: boolean, signal?: AbortSignal): Promise<string> {
  const files = await get<string[]>(post.assets, signal);
  for (const pattern of PREFERRED[!post.video ? 'image' : wide ? 'wideVideo' : 'video']) {
    const file = files.find((f) => pattern.test(f));
    if (file) return asUrl(file);
  }
  if (post.video) throw new Error('No playable video for this item.');
  return post.thumbnail;
}

export async function fetchPost(id: string, signal?: AbortSignal): Promise<Post> {
  const { collection } = await get<ApiSearch>(`${API}/search?nasa_id=${encodeURIComponent(id)}`, signal);
  // nasa_id search is fuzzy (`as11` matches dozens of items), so insist on the exact id.
  const item = collection.items.find((i) => i.data[0]?.nasa_id === id);
  const post = item && toPost(item);
  if (!post) throw new Error('Item not found.');
  return post;
}

const PAGE_SIZE = 50;
// The API refuses any page that reaches past its 10,000th result (400, "Maximum number of search results").
const MAX_RESULTS = 10_000;

// After loading `page`: is there nothing more to load, and if so, is that only the API's limit?
export function endOfFeed(page: number, hasNext: boolean) {
  const capped = hasNext && (page + 1) * PAGE_SIZE > MAX_RESULTS;
  return { done: !hasNext || capped, capped };
}

function fetchPage({ q, media, since }: Filters, page: number, signal: AbortSignal) {
  const params = new URLSearchParams({ media_type: media, page: String(page), page_size: String(PAGE_SIZE) });
  if (q.trim()) params.set('q', q.trim());
  if (since) params.set('year_start', since);
  return get<ApiSearch>(`${API}/search?${params}`, signal);
}

interface GalleryState {
  key: string; // the filters these results belong to
  posts: Post[];
  total: number | null;
  page: number; // the next page to load; NASA pages are 1-based
  loading: boolean;
  error: string | null;
  done: boolean;
  capped: boolean; // stopped at the API's result limit, not the end of the results
}
const fresh = (key: string): GalleryState => ({ key, posts: [], total: null, page: 1, loading: true, error: null, done: false, capped: false });

// Paged search feed. A filter change aborts whatever is in flight and starts again from page 1;
// later pages append, skipping any item an earlier page already returned.
export function useGallery(filters: Filters) {
  const key = filtersToSearch(filters);
  const [state, setState] = useState(() => fresh(key));
  const inFlight = useRef<AbortController>(undefined);

  // New filters: reset during render rather than in the effect, so stale results never paint.
  if (state.key !== key) setState(fresh(key));

  // Fetch a page into state. Only callbacks set state here, so the effect below can call it.
  const fetchInto = (page: number) => {
    inFlight.current?.abort();
    const controller = (inFlight.current = new AbortController());
    fetchPage(filters, page, controller.signal).then(
      ({ collection }) => {
        if (controller.signal.aborted) return;
        setState((s) => {
          const seen = new Set(s.posts.map((p) => p.id));
          const posts = collection.items.map(toPost).filter((p): p is Post => !!p && !seen.has(p.id) && !!seen.add(p.id));
          return {
            ...s,
            ...endOfFeed(page, !!collection.links?.some((l) => l.rel === 'next')),
            posts: [...s.posts, ...posts],
            total: collection.metadata?.total_hits ?? s.total,
            page: page + 1,
            loading: false,
            error: null,
          };
        });
      },
      (error: Error) => {
        if (!controller.signal.aborted) setState((s) => ({ ...s, loading: false, error: error.message }));
      },
    );
  };
  const load = (page: number) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchInto(page);
  };

  const fetchFirstPage = useEffectEvent(() => fetchInto(1));
  useEffect(() => {
    fetchFirstPage();
    return () => inFlight.current?.abort();
  }, [key]);

  return {
    ...state,
    loadMore: () => {
      if (!state.loading && !state.done && !state.error) load(state.page);
    },
    retry: () => load(state.page),
  };
}
