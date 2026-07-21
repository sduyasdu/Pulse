import { useEffect, useRef, useState } from "react";

/** Local-first text input: reflects every keystroke immediately, but only
 * commits upstream (a Firestore write) after a short pause — avoids a
 * write-per-keystroke on free-text fields like titles/names. */
export function useDebouncedText(value: string, commit: (v: string) => void, delayMs = 500) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committing = useRef(false);

  useEffect(() => {
    if (!committing.current) setLocal(value);
    committing.current = false;
  }, [value]);

  const onChange = (v: string) => {
    setLocal(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      committing.current = true;
      commit(v);
    }, delayMs);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return [local, onChange] as const;
}
