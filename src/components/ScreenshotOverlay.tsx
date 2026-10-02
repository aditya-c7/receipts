import type { BBox } from '../../lib/types';

export interface OverlayBox extends BBox {
  label?: string;
}

interface ScreenshotOverlayProps {
  imageUrl: string;
  boxes: OverlayBox[];
  alt?: string;
}

/** Boxes are normalized 0..1 fractions of image width/height. */
export default function ScreenshotOverlay({ imageUrl, boxes, alt }: ScreenshotOverlayProps) {
  return (
    <div data-testid="screenshot-overlay" className="relative inline-block max-w-full">
      <img src={imageUrl} alt={alt ?? 'Uploaded screenshot'} className="max-w-full rounded" />
      {boxes.map((b, i) => (
        <div
          key={i}
          data-testid="overlay-box"
          title={b.label ?? `field ${i + 1}`}
          aria-label={b.label ?? `detected field ${i + 1}`}
          className="pointer-events-none absolute border-2 border-sky-500"
          style={{
            left: `${b.x * 100}%`,
            top: `${b.y * 100}%`,
            width: `${b.w * 100}%`,
            height: `${b.h * 100}%`,
          }}
        />
      ))}
    </div>
  );
}
