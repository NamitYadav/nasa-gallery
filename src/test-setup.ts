import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

// jsdom has no layout or dialog APIs; just enough for the components to mount.
// Like a browser, showModal moves focus into the dialog.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
  this.querySelector<HTMLElement>('button, [href], input')?.focus();
};
globalThis.ResizeObserver ??= class {
  constructor(private callback: ResizeObserverCallback) {}
  observe() {
    this.callback([], this);
  }
  unobserve() {}
  disconnect() {}
};
window.matchMedia ??= (query: string) => ({ matches: false, media: query }) as MediaQueryList;
