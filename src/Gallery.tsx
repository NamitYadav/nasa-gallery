import { useEffect, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { MEDIA, YEARS, useGallery, type Filters } from './nasa';
import { Viewer } from './Viewer';

const CARD_MIN_WIDTH = 280;
const MAX_WIDTH = 1400;
const ROW_HEIGHT = 316; // card height + row gap

function useColumns() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return Math.max(1, Math.floor((Math.min(width, MAX_WIDTH) - 32) / CARD_MIN_WIDTH));
}

// The open item lives in the URL hash (#/item/<id>), so it can be linked to and Back closes it.
// NASA ids can hold spaces and punctuation, hence the encoding.
const itemInHash = () => {
  const id = /^#\/item\/(.+)$/.exec(window.location.hash)?.[1];
  return id ? decodeURIComponent(id) : null;
};

function useOpenItem() {
  const [id, setId] = useState(itemInHash);
  const pushed = useRef(false);
  useEffect(() => {
    const onHashChange = () => setId(itemInHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const open = (next: string) => {
    pushed.current = true;
    window.location.hash = `/item/${encodeURIComponent(next)}`;
  };
  const close = () => {
    if (pushed.current) {
      pushed.current = false;
      history.back();
    } else {
      // Arrived on a deep link: there is no gallery entry to go back to, so replace this one.
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setId(null);
    }
  };
  return [id, open, close] as const;
}

export function Gallery() {
  const [filters, setFilters] = useState<Filters>({ q: 'apollo', media: 'image,video', since: '' });
  const { posts, loading, error, done, loadMore, retry } = useGallery(filters);
  const [openId, open, close] = useOpenItem();
  const columns = useColumns();
  const rows = Math.ceil(posts.length / columns);

  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useWindowVirtualizer({
    count: rows,
    estimateSize: () => ROW_HEIGHT,
    overscan: 2,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });
  const visible = virtualizer.getVirtualItems();
  const lastVisible = visible.at(-1)?.index ?? -1;

  useEffect(() => {
    if (lastVisible >= rows - 2) loadMore();
    // loadMore is rebuilt every render, so it is not a dependency.
  }, [lastVisible, rows]);


  return (
    <>
      <header>
        <h1>NASA Media Gallery</h1>
        {/* The search runs on Enter; the selects apply as soon as they change. */}
        <form
          className="filters"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setFilters({ ...filters, q: String(new FormData(e.currentTarget).get('q')) });
          }}
        >
          <input type="search" name="q" defaultValue={filters.q} placeholder="Search, e.g. apollo" aria-label="Search" />
          <select aria-label="Media type" value={filters.media} onChange={(e) => setFilters({ ...filters, media: e.target.value as Filters['media'] })}>
            {Object.entries(MEDIA).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select aria-label="From year" value={filters.since} onChange={(e) => setFilters({ ...filters, since: e.target.value as Filters['since'] })}>
            {YEARS.map((y) => (
              <option key={y} value={y}>{y ? `Since ${y}` : 'Any year'}</option>
            ))}
          </select>
        </form>
      </header>

      <main>
        <div ref={listRef} className="list" style={{ height: virtualizer.getTotalSize() }}>
          {visible.map((row) => (
            <div
              key={row.key}
              className="row"
              style={{
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              {posts.slice(row.index * columns, (row.index + 1) * columns).map((post) => (
                <button key={post.id} type="button" className="card" onClick={() => open(post.id)}>
                  <img src={post.thumbnail} alt="" loading="lazy" />
                  {post.video && <span className="badge" aria-label="Video">▶</span>}
                  <span className="title">{post.title || 'Untitled'}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <p className="status" aria-live="polite">
          {error ? (
            <>
              {error} <button type="button" onClick={retry}>Retry</button>
            </>
          ) : loading ? (
            'Loading…'
          ) : done && posts.length === 0 ? (
            'Nothing to see here.'
          ) : done ? (
            "That's everything."
          ) : null}
        </p>
      </main>

      {openId && <Viewer id={openId} post={posts.find((p) => p.id === openId)} onClose={close} />}
    </>
  );
}
