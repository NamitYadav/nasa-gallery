import { useEffect, useRef, useState } from 'react';
import { fetchMedia, fetchPost, type Post } from './nasa';

interface Props {
  id: string;
  post?: Post; // already loaded by the gallery; absent when opened from a link
  onClose: () => void;
}

// Keyed by id in the gallery, so every item starts from fresh state.
export function Viewer({ id, post, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressStartedOnBackdrop = useRef(false);
  const [fetched, setFetched] = useState<Post | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [media, setMedia] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const shown = post ?? fetched;

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  // A link knows only the id: look the item up first.
  useEffect(() => {
    if (post) return;
    const controller = new AbortController();
    fetchPost(id, controller.signal).then(setFetched, (e: Error) => {
      if (!controller.signal.aborted) setLookupError(e.message);
    });
    return () => controller.abort();
  }, [id, post]);

  // Search results carry only previews; the full-size file is in the item's asset list.
  useEffect(() => {
    if (!shown) return;
    const controller = new AbortController();
    fetchMedia(shown, window.matchMedia('(min-width: 48rem)').matches, controller.signal).then(setMedia, (e: Error) => {
      if (!controller.signal.aborted) setMediaError(e.message);
    });
    return () => controller.abort();
  }, [shown]);

  return (
    // Esc fires `close`. A click on the backdrop lands on the dialog itself; it only closes when the
    // press started there too, so a text selection dragged out of the content doesn't close it.
    // Esc is the keyboard equivalent, built into <dialog>, which jsx-a11y can't see.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialog}
      className="viewer"
      aria-label={shown?.title || 'Item'}
      onClose={onClose}
      onPointerDown={(e) => {
        pressStartedOnBackdrop.current = e.target === dialog.current;
      }}
      onClick={(e) => {
        if (pressStartedOnBackdrop.current && e.target === dialog.current) onClose();
      }}
    >
      <div className="viewer-body">
        <button type="button" className="close" onClick={onClose} aria-label="Close">×</button>
        {lookupError ? (
          <p>{lookupError}</p>
        ) : !shown ? (
          <p>Loading…</p>
        ) : (
          <>
            {media && shown.video ? (
              <video src={media} poster={shown.thumbnail} controls autoPlay muted playsInline />
            ) : (
              <img src={media ?? shown.thumbnail} alt={shown.title} />
            )}
            {mediaError && <p role="alert">Couldn't load the full-size file. {mediaError}</p>}
            <div className="viewer-info">
              <h2>{shown.title || 'Untitled'}</h2>
              <span>{[shown.date, shown.center].filter(Boolean).join(' · ')}</span>
            </div>
            {shown.description && <p className="description">{shown.description}</p>}
          </>
        )}
      </div>
    </dialog>
  );
}
