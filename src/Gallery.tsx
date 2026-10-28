import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { MEDIA, YEARS, filtersFromSearch, filtersToSearch, useGallery, type Filters } from './nasa';
import { Viewer } from './Viewer';

const CARD_MIN_WIDTH = 280;
const GAP = 16;
const ROW_HEIGHT = 316; // card height + row gap

interface Layout {
  columns: number;
  cardWidth: number; // rounded up to 100px steps: it only feeds `sizes`, so no re-render per pixel
  listTop: number; // the list's offset in the page, which the window virtualizer needs
  headerHeight: number; // how much of the viewport the sticky header covers
}

// Measured, not derived from window.innerWidth: the header wraps and the list has padding,
// so only layout knows the real numbers. Re-measured whenever either element resizes.
function useLayout(header: RefObject<HTMLElement | null>, list: RefObject<HTMLElement | null>) {
  const [layout, setLayout] = useState<Layout>({ columns: 1, cardWidth: CARD_MIN_WIDTH, listTop: 0, headerHeight: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const width = list.current!.clientWidth;
      const columns = Math.max(1, Math.floor((width + GAP) / (CARD_MIN_WIDTH + GAP)));
      const next: Layout = {
        columns,
        cardWidth: Math.ceil((width - GAP * (columns - 1)) / columns / 100) * 100,
        listTop: list.current!.offsetTop,
        // On phones the header scrolls away (styles.css), so it covers nothing.
        headerHeight: getComputedStyle(header.current!).position === 'sticky' ? header.current!.offsetHeight : 0,
      };
      // Keyboard focus scrolls cards into view; scroll-padding keeps them clear of the sticky header.
      document.documentElement.style.scrollPaddingTop = `${next.headerHeight + GAP}px`;
      setLayout((prev) =>
        prev.columns === next.columns && prev.cardWidth === next.cardWidth && prev.listTop === next.listTop && prev.headerHeight === next.headerHeight
          ? prev
          : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header.current!);
    observer.observe(list.current!);
    return () => observer.disconnect();
  }, [header, list]);
  return layout;
}

// The open item lives in the URL hash (#/item/<id>), so it can be linked to and Back closes it.
// NASA ids can hold spaces and punctuation, hence the encoding; a malformed one is ignored.
const itemInHash = () => {
  const encoded = /^#\/item\/(.+)$/.exec(window.location.hash)?.[1];
  try {
    return encoded ? decodeURIComponent(encoded) : null;
  } catch {
    return null;
  }
};

function useOpenItem() {
  const [id, setId] = useState(itemInHash);
  useEffect(() => {
    const sync = () => setId(itemInHash());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);
  const open = (next: string) => {
    // Marked in history.state rather than a ref, so it survives a reload of the open item.
    history.pushState({ viewer: true }, '', `#/item/${encodeURIComponent(next)}`);
    setId(next);
  };
  const close = () => {
    if (history.state?.viewer) {
      history.back();
    } else {
      // Arrived on a link: there is no gallery entry behind this one, so replace it.
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setId(null);
    }
  };
  return [id, open, close] as const;
}

export function Gallery() {
  const [filters, setFilterState] = useState(() => filtersFromSearch(window.location.search));
  const setFilters = (next: Filters) => {
    history.replaceState(history.state, '', filtersToSearch(next) + window.location.hash);
    setFilterState(next);
  };
  const { posts, total, loading, error, done, capped, loadMore, retry } = useGallery(filters);
  const [openId, open, close] = useOpenItem();

  const headerRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { columns, cardWidth, listTop, headerHeight } = useLayout(headerRef, listRef);
  const rows = Math.ceil(posts.length / columns);

  const virtualizer = useWindowVirtualizer({
    count: rows,
    estimateSize: () => ROW_HEIGHT,
    overscan: 2,
    scrollMargin: listTop,
    scrollPaddingStart: headerHeight,
  });
  const visible = virtualizer.getVirtualItems();
  const lastVisible = visible.at(-1)?.index ?? -1;

  // Load the next page when the last rows come into view, and again when a load finishes with the
  // end still in view: a page that adds nothing new (all repeats) must not stall the feed.
  const loadMoreEvent = useEffectEvent(loadMore);
  useEffect(() => {
    if (lastVisible >= rows - 2) loadMoreEvent();
  }, [lastVisible, rows, loading]);

  // A resize that changes the column count remaps every row; keep the first visible card in view.
  const firstVisiblePost = useRef(0);
  useLayoutEffect(() => {
    if (firstVisiblePost.current > 0) virtualizer.scrollToIndex(Math.floor(firstVisiblePost.current / columns), { align: 'start' });
  }, [columns, virtualizer]);
  useEffect(() => {
    firstVisiblePost.current = (virtualizer.range?.startIndex ?? 0) * columns; // in view, not overscan
  });

  // However the viewer closes (×, Esc, backdrop, Back), return focus to the card that opened it.
  const lastOpened = useRef<string | null>(null);
  useEffect(() => {
    if (openId) {
      lastOpened.current = openId;
      return;
    }
    const id = lastOpened.current;
    lastOpened.current = null;
    if (id) [...document.querySelectorAll<HTMLElement>('.card')].find((card) => card.dataset.id === id)?.focus();
  }, [openId]);

  return (
    <>
      <header ref={headerRef}>
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
          <span className="count" aria-live="polite">
            {total !== null && !loading && `${total.toLocaleString()} result${total === 1 ? '' : 's'}`}
          </span>
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
                transform: `translateY(${row.start - listTop}px)`,
              }}
            >
              {posts.slice(row.index * columns, (row.index + 1) * columns).map((post) => (
                <button key={post.id} type="button" className="card" data-id={post.id} onClick={() => open(post.id)}>
                  <img src={post.thumbnail} srcSet={post.srcSet || undefined} sizes={`${cardWidth}px`} alt="" loading="lazy" />
                  {post.video && <span className="badge" aria-hidden="true">▶</span>}
                  <span className="title">
                    {post.title || 'Untitled'}
                    {post.video && <span className="sr-only"> (video)</span>}
                  </span>
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
            'No results. Try another search.'
          ) : capped ? (
            "That's as far as NASA's search goes. Narrow the search to see more."
          ) : done ? (
            "That's everything."
          ) : null}
        </p>
      </main>

      {openId && <Viewer key={openId} id={openId} post={posts.find((p) => p.id === openId)} onClose={close} />}
    </>
  );
}
