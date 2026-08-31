"use client";

// ─────────────────────────────────────────────────────────────────────────────
// WHICH FLOOR THIS SYSTEM IS STANDING ON.
//
// Per system, deliberately. The founder's ask was that a person can dress each
// of the six differently — ConnectDesk in one skin, Ledgerly in another — so the
// storage key carries the system id and there is no shared "the" skin to
// accidentally overwrite from the wrong screen.
//
// It reads the same way useTheme does, and for the same reason: localStorage is
// an EXTERNAL STORE, and mirroring it into state gives you one render with the
// wrong wallpaper followed by a second with the right one. That flash is the
// whole thing worth avoiding on a full-screen background layer.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useSyncExternalStore } from "react";
import { defaultSkinFor, skinFor, skinStorageKey, type Skin } from "./skins";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Where the choice lives when a browser is set to block site data — access
 *  itself throws there, not only writes, and without this the picker would move
 *  and then snap back. Lasts the session, which is all that setting allows. */
const memory = new Map<string, string>();

export function useSkin(systemId: string): { skin: Skin; skinId: string; setSkin: (id: string) => void } {
  const key = skinStorageKey(systemId);
  const fallback = defaultSkinFor(systemId);

  // The snapshot has to be a PRIMITIVE. Returning skinFor(...) here hands React
  // a fresh object every call and it re-renders forever comparing them.
  const read = useCallback(() => {
    try {
      const v = localStorage.getItem(key);
      if (v) return v;
    } catch {
      /* fall through to memory */
    }
    return memory.get(key) ?? fallback;
  }, [key, fallback]);

  // The server has no storage. The default is the only answer that is never
  // wrong, and it is also what the first client render will agree with unless
  // somebody has chosen — which is exactly when a repaint is acceptable.
  const skinId = useSyncExternalStore(subscribe, read, () => fallback);

  const setSkin = useCallback(
    (id: string) => {
      memory.set(key, id);
      try {
        localStorage.setItem(key, id);
      } catch {
        /* a preference is a convenience, never a requirement */
      }
      emit();
    },
    [key],
  );

  return { skin: skinFor(skinId), skinId, setSkin };
}
