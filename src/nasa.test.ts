import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchMedia, toPost, useGallery, type Filters } from './nasa';

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
  expect(await fetchMedia(toPost(item('v', 'video'))!)).toBe('https://a/v~mobile.mp4');
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
