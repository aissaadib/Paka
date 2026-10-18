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
