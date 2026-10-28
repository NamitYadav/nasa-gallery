import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { endOfFeed, fetchMedia, fetchPost, filtersFromSearch, filtersToSearch, toPost, useGallery, type Filters } from './nasa';

const item = (id: string, media_type = 'image') => ({
  href: `http://images-assets.nasa.gov/${media_type}/${id}/collection.json`,
  data: [{ nasa_id: id, title: id, media_type }],
  links: [{ rel: 'preview', href: `https://images-assets.nasa.gov/${media_type}/${id}/${id}~thumb.jpg` }],
});
const page = (items: unknown[], next = true) =>
  new Response(JSON.stringify({ collection: { items, links: next ? [{ rel: 'next' }] : [] } }));
const filters: Filters = { q: 'apollo', media: 'image,video', since: '' };
const urls = (fetch: { mock: { calls: unknown[][] } }) => fetch.mock.calls.map(([url]) => String(url));

afterEach(() => vi.restoreAllMocks());

it('builds https, space-safe URLs and drops items without a thumbnail', () => {
  expect(toPost(item('Apollo 14 Launch', 'video'))).toMatchObject({
    video: true,
    assets: 'https://images-assets.nasa.gov/video/Apollo%2014%20Launch/collection.json',
  });
  expect(toPost({ ...item('x'), links: [] })).toBeNull();
});

it('prefers a web-sized rendition over the original', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(['http://a/v~orig.mp4', 'http://a/v~mobile.mp4', 'http://a/v.srt'])),
  );
  expect(await fetchMedia(toPost(item('v', 'video'))!, false)).toBe('https://a/v~mobile.mp4');
});

it('picks a larger video on wide screens', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(['http://a/v~orig.mp4', 'http://a/v~mobile.mp4', 'http://a/v~medium.mp4'])),
  );
  expect(await fetchMedia(toPost(item('v', 'video'))!, true)).toBe('https://a/v~medium.mp4');
});

it('looks an item up by its exact id, not the fuzzy match', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => page([item('as11-43-6412'), item('as11')]));
  expect((await fetchPost('as11')).id).toBe('as11');
  await expect(fetchPost('as1')).rejects.toThrow('Item not found.');
});

it('round-trips filters through the query string and ignores junk', () => {
  const filters: Filters = { q: 'mars rover', media: 'video', since: '2010' };
  expect(filtersFromSearch(filtersToSearch(filters))).toEqual(filters);
  expect(filtersFromSearch('?media=toString&since=1234')).toEqual({ q: 'apollo', media: 'image,video', since: '' });
});

it('appends later pages, skips repeats, and stops when there is no next page', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(page([item('a'), item('b')]))
    .mockResolvedValueOnce(page([item('b'), item('c')], false));
  const { result } = renderHook(() => useGallery(filters));
  await waitFor(() => expect(result.current.loading).toBe(false));

  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.posts.map((p) => p.id)).toEqual(['a', 'b', 'c']));
  expect(result.current.done).toBe(true);
  expect(urls(fetch)[0]).toContain('page=1&');
  expect(urls(fetch)[1]).toContain('page=2&');
});

it('restarts from page 1 when a filter changes, even mid-fetch', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockImplementationOnce(() => new Promise(() => {})) // never settles
    .mockResolvedValueOnce(page([item('mars')]));
  const { result, rerender } = renderHook((f: Filters) => useGallery(f), { initialProps: filters });

  rerender({ ...filters, q: 'mars', since: '2010' });
  await waitFor(() => expect(result.current.posts.map((p) => p.id)).toEqual(['mars']));
  expect(urls(fetch)[1]).toMatch(/page=1&.*q=mars&year_start=2010/);
  expect((fetch.mock.calls[0]![1] as RequestInit).signal!.aborted).toBe(true);
});

it("stops at the API's 10,000-result limit instead of requesting a page it refuses", () => {
  // 50 per page: page 200 ends at result 10,000 (allowed), page 201 would pass it (400).
  expect(endOfFeed(199, true)).toEqual({ done: false, capped: false });
  expect(endOfFeed(200, true)).toEqual({ done: true, capped: true });
  expect(endOfFeed(3, false)).toEqual({ done: true, capped: false });
});

it('shows the reason the API gives for an error', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ reason: 'Bad query.' }), { status: 400 }));
  const { result } = renderHook(() => useGallery(filters));
  await waitFor(() => expect(result.current.error).toBe('Bad query.'));
});

it('surfaces errors instead of loading forever, and retries', async () => {
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(page([item('a')]));
  const { result } = renderHook(() => useGallery(filters));
  await waitFor(() => expect(result.current.error).toBe('NASA returned 503.'));
  expect(result.current.loading).toBe(false);

  act(() => result.current.retry());
  await waitFor(() => expect(result.current.posts).toHaveLength(1));
  expect(result.current.error).toBeNull();
});
