import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Gallery } from './Gallery';

const item = (id: string) => ({
  href: `https://images-assets.nasa.gov/image/${id}/collection.json`,
  data: [{ nasa_id: id, title: `Title ${id}`, media_type: 'image' }],
  links: [{ rel: 'preview', render: 'image', href: `https://images-assets.nasa.gov/image/${id}/${id}~thumb.jpg` }],
});
const json = (body: unknown) => new Response(JSON.stringify(body));

// A tiny fake of the API: a two-item gallery, plus id lookups and asset lists for those two items.
function fakeApi(url: string) {
  const id = new URL(url).searchParams.get('nasa_id');
  if (id !== null) return json({ collection: { items: ['a', 'b'].includes(id) ? [item(id)] : [] } });
  if (url.endsWith('collection.json')) return json([url.replace('collection.json', 'large~large.jpg')]);
  return json({ collection: { items: [item('a'), item('b')], links: [], metadata: { total_hits: 2 } } });
}

const navigate = (url: string) =>
  act(() => {
    history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

beforeEach(() => {
  history.replaceState(null, '', '/');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => fakeApi(String(url)));
});
afterEach(() => vi.restoreAllMocks());

it('returns focus to the card that opened the viewer, however it closes', async () => {
  render(<Gallery />);
  const card = await screen.findByRole('button', { name: 'Title a' });

  fireEvent.click(card);
  expect(await screen.findByRole('button', { name: 'Close' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(card).toHaveFocus();

  fireEvent.click(card);
  await screen.findByRole('dialog');
  act(() => history.back());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(card).toHaveFocus();
});

it('starts fresh when the linked item changes, even after an error', async () => {
  render(<Gallery />);
  navigate('/#/item/missing');
  expect(await screen.findByText('Item not found.')).toBeInTheDocument();

  navigate('/#/item/b');
  expect(await screen.findByRole('heading', { name: 'Title b' })).toBeInTheDocument();
  expect(screen.queryByText('Item not found.')).toBeNull();
});

it('ignores a malformed item link instead of crashing', async () => {
  history.replaceState(null, '', '/#/item/%E0%A4%A');
  render(<Gallery />);
  expect(await screen.findByRole('button', { name: 'Title a' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('reads filters from the URL and writes changes back', async () => {
  history.replaceState(null, '', '/?q=mars&media=video');
  render(<Gallery />);
  await screen.findByText('2 results');
  expect(String(vi.mocked(fetch).mock.calls[0]![0])).toMatch(/media_type=video.*q=mars/);

  fireEvent.change(screen.getByLabelText('From year'), { target: { value: '2010' } });
  expect(window.location.search).toBe('?q=mars&media=video&since=2010');
});
