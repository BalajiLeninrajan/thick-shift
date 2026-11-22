// Lookups for elements the page or a screen's own HTML is known to have. Each checks what it found, so the type
// is what is really there rather than a cast, and a missing element (a renamed id, a selector out of step with its
// template) throws an Error that names it, where the code that needs it starts, instead of a TypeError later on.
//
//   const name = byId('rc', HTMLInputElement);         // an <input id="rc">, typed as one
//   const bar = query(power, 'i');                      // any HTMLElement inside power
//   const c = context2d(canvas);                        // the canvas's 2D context
//
// For an element that may well be absent, use querySelector and handle null.

// HTMLInputElement, HTMLCanvasElement, SVGSVGElement and the like.
type ElementClass<T extends Element> = abstract new (...args: never[]) => T;

export function byId(id: string): HTMLElement;
export function byId<T extends Element>(id: string, type: ElementClass<T>): T;
export function byId(id: string, type: ElementClass<Element> = HTMLElement): Element {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing`);
  if (!(el instanceof type)) throw new Error(`#${id} is not a ${type.name}`);
  return el;
}

export function query(root: ParentNode, selector: string): HTMLElement;
export function query<T extends Element>(root: ParentNode, selector: string, type: ElementClass<T>): T;
export function query(root: ParentNode, selector: string, type: ElementClass<Element> = HTMLElement): Element {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`${selector} is missing`);
  if (!(el instanceof type)) throw new Error(`${selector} is not a ${type.name}`);
  return el;
}

// getContext('2d') gives null only when the canvas already has another kind of context or the browser cannot make
// one; neither is something the game can draw round.
export function context2d(canvas: HTMLCanvasElement, settings?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D {
  const c = canvas.getContext('2d', settings);
  if (!c) throw new Error('no 2D context for a canvas');
  return c;
}

// The event came from something the player types into, so its keys are text and not controls.
export const typing = (e: Event): boolean => e.target instanceof Element && !!e.target.closest('input, textarea, select, [contenteditable]');

// What to show for something thrown or rejected, which need not be an Error.
export const errorText = (err: unknown): string => (err instanceof Error && err.message ? err.message : String(err));
