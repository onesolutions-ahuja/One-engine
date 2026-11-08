import { useEffect, useState } from 'react';

/** The four layout widths describe available space, not a device or operating system.
 * Keep Phone/Tablet/Desktop as compatibility identities for published page metadata.
 */
export type SizeClass = 'Compact' | 'RegularNarrow' | 'Regular' | 'Wide';
export type FormFactor = 'Phone' | 'Tablet' | 'Desktop';
// Landscape-phone dimensions must remain Compact even when a test browser or attached pointer reports fine input.
const PHONE_QUERY = '(max-width: 599px), (max-width: 1023px) and (max-height: 500px)';
const NARROW_QUERY = '(max-width: 1023px)';
const REGULAR_QUERY = '(max-width: 1439px)';

export function currentSizeClass(): SizeClass {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'Regular';
  if (window.matchMedia(PHONE_QUERY).matches) return 'Compact';
  if (window.matchMedia(NARROW_QUERY).matches) return 'RegularNarrow';
  if (window.matchMedia(REGULAR_QUERY).matches) return 'Regular';
  return 'Wide';
}

export function currentFormFactor(): FormFactor {
  const size = currentSizeClass();
  return size === 'Compact' ? 'Phone' : size === 'RegularNarrow' ? 'Tablet' : 'Desktop';
}

/** A single resize subscription serves all callers without assuming that iPads use touch only. */
export function useSizeClass(): SizeClass {
  const [value, setValue] = useState<SizeClass>(currentSizeClass);
  useEffect(() => {
    const media = [PHONE_QUERY, NARROW_QUERY, REGULAR_QUERY].map(query => window.matchMedia(query));
    const refresh = () => setValue(currentSizeClass());
    refresh();
    for (const query of media) query.addEventListener('change', refresh);
    // WebKit can defer MediaQueryList.change during viewport rotation. Window
    // resize is the authoritative fallback for iPad split view and Playwright.
    window.addEventListener('resize', refresh);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', refresh);
    // In iPad WebKit the matchMedia event can precede the layout viewport
    // settling; observing the root gives us the final resize signal.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh);
    observer?.observe(document.documentElement);
    return () => {
      for (const query of media) query.removeEventListener('change', refresh);
      window.removeEventListener('resize', refresh);
      viewport?.removeEventListener('resize', refresh);
      observer?.disconnect();
    };
  }, []);
  return value;
}

export function useFormFactor(): FormFactor {
  const size = useSizeClass();
  return size === 'Compact' ? 'Phone' : size === 'RegularNarrow' ? 'Tablet' : 'Desktop';
}

/** Tablet is now first-class, instead of silently requesting the Desktop runtime binding.
 * The Page Runtime still retains its existing fallback for unassigned tablet layouts.
 */
export function useRuntimeFormFactor(): FormFactor {
  return useFormFactor();
}
