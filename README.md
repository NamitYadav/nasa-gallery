# NASA Media Gallery

Browse NASA's Image and Video Library: search, filter by media type and year, scroll forever, and open any image or video in a viewer you can link to.

**Live:** https://namityadav.github.io/nasa-gallery/

## How it's built

- React 19 and TypeScript, built with Vite. Plain CSS and native form controls, no UI kit.
- **Windowed grid.** Only the rows on screen exist in the DOM (`@tanstack/react-virtual`), so a long infinite-scroll session stays fast. The column count follows the viewport width.
- **Paged feed with no races** (`useGallery` in `src/nasa.ts`). A filter change aborts the request in flight and starts again from page 1. Later pages append, items an earlier page already returned are skipped, and the feed stops when the API stops returning a next page. Errors show a Retry button instead of a stuck spinner.
- **Light grid.** Cards load NASA's small preview images lazily. The viewer then reads the item's asset list and picks a web-sized rendition (a mobile-sized MP4 or a large JPEG) instead of the original, which can run to hundreds of megabytes.
- **Linkable viewer.** The open item lives in the URL hash (`#/item/<id>`) and shows in a native `<dialog>`, so Back closes it, Esc works, and the gallery keeps its scroll position.
- The tests cover the feed logic and the asset handling: paging, de-duplication, restarting on a filter change mid-fetch, error recovery, and building https URLs from NASA's `http://` paths, which contain spaces.

Data: [NASA Image and Video Library API](https://images.nasa.gov/). No key needed.

## Run it

```bash
npm install
npm run dev
npm test
```

## History

Started in 2020 as an Imgur gallery viewer on Create React App and Material UI. Rebuilt in 2026 on NASA's open API.
