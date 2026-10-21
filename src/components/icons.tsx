/**
 * Inline icon set.
 *
 * Hand-written single-path SVG icons keep the UI dependency-free and small.
 * All icons inherit `currentColor` and the shared 16px viewBox stroke style.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconBrush(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 2.5 13 6l-5 5H5.5L4 12.5 3 14l-1-1 1.5-1L4.5 10V7.5z" />
      <path d="M2 14s1.5-.2 2-2" />
    </Icon>
  );
}

export function IconEraser(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 13.5h7.5" />
      <path d="M9.6 2.9 3.4 9.1a1.4 1.4 0 0 0 0 2l1.5 1.5a1.4 1.4 0 0 0 2 0l6.2-6.2a1.4 1.4 0 0 0 0-2l-1.5-1.5a1.4 1.4 0 0 0-2 0z" />
      <path d="M7.5 5 11 8.5" />
    </Icon>
  );
}

export function IconPicker(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11.5 2.5a1.8 1.8 0 0 0-2.6 0L7.4 4l-.9-.9-1.3 1.3 5.4 5.4 1.3-1.3-.9-.9 1.5-1.5a1.8 1.8 0 0 0 0-2.6z" />
      <path d="M8.2 5.6 3.1 10.7 2.4 13.6l2.9-.7 5.1-5.1z" />
    </Icon>
  );
}

export function IconBucket(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.1 2.9 2.8 6.2a1 1 0 0 0 0 1.4l4.1 4.1a1 1 0 0 0 1.4 0l3.3-3.3a1 1 0 0 0 0-1.4L7.5 2.9a1 1 0 0 0-1.4 0z" />
      <path d="M3.9 7.4 10 13.5" />
      <path d="M13 9.2c.7 1 1.2 1.9 1.2 2.5a1.2 1.2 0 0 1-2.4 0c0-.6.5-1.5 1.2-2.5z" />
    </Icon>
  );
}

export function IconGradient(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.2" />
      <path d="M4.2 11.8 11.8 4.2" />
      <path d="M4.2 8.4 8.4 4.2M7.6 11.8 11.8 7.6" opacity="0.55" />
    </Icon>
  );
}

export function IconSelect(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.6 5.5v-3h3M10.4 2.5h3v3M13.4 10.5v3h-3M5.6 13.5h-3v-3" />
      <path d="M6.4 6.4 12 8.6l-2.2.9-.9 2.2z" />
    </Icon>
  );
}

export function IconLine(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 13 13 3" />
      <path d="M2.4 13.6h1.2v-1.2M12.4 2.4h1.2v1.2" />
    </Icon>
  );
}

export function IconRectangle(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.8" y="4" width="10.4" height="8" rx="0.6" />
    </Icon>
  );
}

export function IconEllipse(props: IconProps) {
  return (
    <Icon {...props}>
      <ellipse cx="8" cy="8" rx="5.4" ry="4" />
    </Icon>
  );
}

export function IconPolygon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.6 13.1 6.4 11.2 12.4H4.8L2.9 6.4z" />
    </Icon>
  );
}

export function IconStar(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.4 9.9 6.3 14.2 6.9 11.1 9.8 11.9 14.1 8 12 4.1 14.1 4.9 9.8 1.8 6.9 6.1 6.3z" />
    </Icon>
  );
}

export function IconHand(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.5 8V4.2a1 1 0 0 1 2 0V7" />
      <path d="M7.5 6.6V3.4a1 1 0 0 1 2 0v3.2" />
      <path d="M9.5 6.9V4.6a1 1 0 0 1 2 0v5.1a4 4 0 0 1-4 4H7a3.5 3.5 0 0 1-3.5-3.5V8.4a1 1 0 0 1 2 0v.9" />
    </Icon>
  );
}

export function IconUndo(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7h6.5a3.5 3.5 0 0 1 0 7H6" />
      <path d="M5.5 4.5 3 7l2.5 2.5" />
    </Icon>
  );
}

export function IconRedo(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 7H6.5a3.5 3.5 0 0 0 0 7H10" />
      <path d="M10.5 4.5 13 7l-2.5 2.5" />
    </Icon>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3v10M3 8h10" />
    </Icon>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.5 5.5h7v7h-7z" />
      <path d="M10.5 5.5V3.5h-7v7h2" />
    </Icon>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5" />
    </Icon>
  );
}

export function IconArrowUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 13V3M4.5 6.5 8 3l3.5 3.5" />
    </Icon>
  );
}

export function IconArrowDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3v10M4.5 9.5 8 13l3.5-3.5" />
    </Icon>
  );
}

export function IconEye(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.5 8S3.8 4 8 4s6.5 4 6.5 4-2.3 4-6.5 4-6.5-4-6.5-4z" />
      <circle cx="8" cy="8" r="1.6" />
    </Icon>
  );
}

export function IconEyeOff(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 3.5l11 9" />
      <path d="M6.2 6.4A1.6 1.6 0 0 0 8 9.6c.4 0 .8-.1 1-.4" />
      <path d="M1.5 8s2.3-4 6.5-4c.8 0 1.5.2 2.2.5M14.5 8s-1 1.7-2.8 3" />
    </Icon>
  );
}

export function IconZoomIn(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14M7 5.2v3.6M5.2 7h3.6" />
    </Icon>
  );
}

export function IconZoomOut(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14M5.2 7h3.6" />
    </Icon>
  );
}

export function IconFit(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </Icon>
  );
}

export function IconActualSize(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 4.5h11v7h-11z" />
      <path d="M5 6.5v3M5 6.5h.9a1 1 0 0 1 0 2H5M7.6 6.5v3M11 6.5H9.4v3" />
    </Icon>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6.5 8 10l4-3.5" />
    </Icon>
  );
}

export function IconFile(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 2.5h5l3 3v8H4z" />
      <path d="M9 2.5v3h3" />
    </Icon>
  );
}
