import { useEffect, useRef, useState } from 'react';
import { fetchMedia, fetchPost, type Post } from './nasa';

interface Props {
  id: string;
  post?: Post; // already loaded by the gallery; absent when opened from a link
  onClose: () => void;
}

export function Viewer({ id, post, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [fetched, setFetched] = useState<Post | null>(null);
  const [media, setMedia] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = post ?? fetched;

  useEffect(() => dialog.current?.showModal(), []);

  // A deep link knows only the id: look the item up first.
  useEffect(() => {
    if (post) return;
    const controller = new AbortController();
    fetchPost(id, controller.signal).then(setFetched, (e: Error) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [id, post]);

  // Search results carry only a thumbnail; the full-size file is in the item's asset list.
  useEffect(() => {
    if (!shown) return;
    const controller = new AbortController();
    fetchMedia(shown, controller.signal).then(setMedia, (e: Error) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [shown]);

  return (
    // Esc fires `close`; a click on the backdrop lands on the dialog itself.
    <dialog
      ref={dialog}
      className="viewer"
      aria-label={shown?.title || 'Item'}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
    >
      <div className="viewer-body">
        <button type="button" className="close" onClick={onClose} aria-label="Close">×</button>
        {error ? (
          <p>{error}</p>
        ) : !shown ? (
          <p>Loading…</p>
        ) : (
          <>
            {!media ? (
              <img src={shown.thumbnail} alt={shown.title} />
            ) : shown.video ? (
              <video src={media} poster={shown.thumbnail} controls autoPlay muted playsInline />
            ) : (
              <img src={media} alt={shown.title} />
            )}
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
