import { create } from "zustand";

// A tiny imperative confirmation dialog. Replaces window.confirm() so the
// prompt can be styled and anchored next to the click that triggered it,
// instead of the browser's centred OS box. Call confirmAt(event, opts) and
// await the boolean.

export interface ConfirmOptions {
  message: string;
  detail?: string;
  confirmLabel?: string;
}

interface ConfirmRequest extends ConfirmOptions {
  x: number;
  y: number;
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  request: ConfirmRequest | null;
  open: (req: ConfirmRequest) => void;
  close: (ok: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  open: (req) => {
    // If one is already open, resolve it false before replacing.
    get().request?.resolve(false);
    set({ request: req });
  },
  close: (ok) => {
    const req = get().request;
    set({ request: null });
    req?.resolve(ok);
  },
}));

/** Show a styled confirmation popover anchored at the click position.
 * Resolves true if confirmed, false if cancelled/dismissed. */
export function confirmAt(e: { clientX: number; clientY: number }, opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().open({ ...opts, x: e.clientX, y: e.clientY, resolve });
  });
}
