import { useEffect, useState } from 'react';
import { shouldLoadAnimatedBrand, type BrandConnection } from './uneBrandConnection';
import './uneBrandLogo.css';

// One cached identity for marketing, login and the platform header.
export const UNE_BRAND_LOGO_URL = `${import.meta.env.BASE_URL}une-solutions-logo.webp`;
export const UNE_ANIMATED_LOGO_URL = `${import.meta.env.BASE_URL}une-solutions-animated.webp`;

// Share one preload among all independently mounted brand instances.
// The animation is optional: a slow link, load error or unsupported browser
// must never delay or hide the static logo.
let animationPreload: Promise<boolean> | undefined;
function preloadAnimation(): Promise<boolean> {
  animationPreload ??= new Promise<boolean>((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = UNE_ANIMATED_LOGO_URL;
  });
  return animationPreload;
}

type UneBrandLogoProps = {
  className?: string;
  src?: string;
  decorative?: boolean;
};

export function UneBrandLogo({ className = '', src = UNE_BRAND_LOGO_URL, decorative = false }: UneBrandLogoProps) {
  const [animated, setAnimated] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    // Never replace a configured logo with the platform artwork.
    if (src !== UNE_BRAND_LOGO_URL) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = (navigator as Navigator & { connection?: BrandConnection }).connection;
    let mounted = true;
    let generation = 0;

    const update = () => {
      const requested = ++generation;
      const eligible = shouldLoadAnimatedBrand(media.matches, connection);
      setAllowed(eligible);
      if (!eligible) {
        setAnimated(false);
        return;
      }
      void preloadAnimation().then(loaded => {
        if (mounted && requested === generation) setAnimated(loaded);
      });
    };

    update();
    media.addEventListener('change', update);
    connection?.addEventListener?.('change', update);
    return () => {
      mounted = false;
      ++generation;
      media.removeEventListener('change', update);
      connection?.removeEventListener?.('change', update);
    };
  }, [src]);

  return (
    <span className={`une-brand-logo${className ? ` ${className}` : ''}${allowed && !animated ? ' une-brand-logo--interim' : ''}`}>
      <img className="une-brand-logo-image une-brand-logo-image--static" src={src}
        alt={decorative ? '' : 'UNE Solutions'} aria-hidden={decorative ? true : undefined} />
      {animated && (
        <img className="une-brand-logo-image une-brand-logo-image--animated"
          src={UNE_ANIMATED_LOGO_URL} alt="" aria-hidden="true" />
      )}
    </span>
  );
}
