import * as React from 'react';
import './PreviewDeviceFrame.css';
import { attachPreviewDragScroll } from './previewDragScroll';

/** Dimensions are CSS pixels; only the visual frame is scaled to the available space. */
const SCREEN_HEIGHT: Record<string, number> = { Phone: 844, Tablet: 768, Desktop: 900 };
const FRAME_HORIZONTAL_PADDING = 24;

export default function PreviewDeviceFrame({ device, width, height, layoutVariant, children }: {
  device: string;
  width: number;
  height: number;
  layoutVariant?: string;
  children: React.ReactNode;
}) {
  const screen = React.useRef<HTMLDivElement>(null);
  const frame = React.useRef<HTMLDivElement>(null);
  const screenWidth = Math.max(320, Math.round(width || 390));
  const kind = layoutVariant === 'Custom' ? 'Custom' : device;
  const border = kind === 'Phone' ? 10 : 2;
  const idealHeight = kind === 'Custom'
    ? Math.max(320, Math.round(height || 900))
    : SCREEN_HEIGHT[kind] ?? SCREEN_HEIGHT.Desktop;
  const [space, setSpace] = React.useState({ width: screenWidth + border * 2 + FRAME_HORIZONTAL_PADDING, height: 650 });

  React.useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const nextWidth = node.clientWidth;
      const nextHeight = Math.max(240, window.innerHeight - Math.max(0, rect.top) - 24);
      setSpace(prev => prev.width === nextWidth && prev.height === nextHeight
        ? prev : { width: nextWidth, height: nextHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [screenWidth, kind]);

  React.useEffect(() => {
    const root = screen.current;
    return root ? attachPreviewDragScroll(root) : undefined;
  }, [kind]);

  // A wide authored canvas stays at its intended CSS width. Only its on-screen
  // presentation is scaled: responsive breakpoints, fixed bars and popups all
  // continue to use the authored dimensions inside the device viewport.
  const scale = Math.min(1, Math.max(0.02,
    (space.width - FRAME_HORIZONTAL_PADDING) / (screenWidth + border * 2)));
  const viewportHeight = Math.max(240, Math.min(idealHeight,
    Math.floor(space.height / scale) - border * 2));

  return <div ref={frame} className="preview-device-frame" data-device={kind}>
    <div className="preview-device-stage" style={{
      width: Math.ceil((screenWidth + border * 2) * scale),
      height: Math.ceil((viewportHeight + border * 2) * scale),
    }}>
      <div ref={screen} className="preview-device-viewport" data-device={kind}
        data-formula-screen-host="true"
        style={{ width: screenWidth, height: viewportHeight,
          transform: scale < 1 ? `scale(${scale})` : undefined }}>
        <div className="preview-device-scroll">{children}</div>
      </div>
    </div>
  </div>;
}
