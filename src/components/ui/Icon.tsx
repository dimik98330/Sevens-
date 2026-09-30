import type { CSSProperties } from "react";
import { SevensMark } from "./SevensLogo";

const paths = {
  globe: "M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0ZM2 12h20M12 2c5 5 5 15 0 20-5-5-5-15 0-20Z",
  mail: "M3 5h18v14H3zM3 5l9 7 9-7",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4M12 15v3",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7ZM9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  "eye-off": "m3 3 18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3 4M6.5 6.5A20 20 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2",
  home: "m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9",
  chevron: "m6 9 6 6 6-6",
  logout: "M10 4H4v16h6M10 12h11m-4-4 4 4-4 4",
  bulb: "M9 18h6M10 21h4M8 14a7 7 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3",
  users: "M8 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0M4 21v-3a7 7 0 0 1 14 0v3M17 5a3 3 0 0 1 0 6M20 14a5 5 0 0 1 3 5v2",
  play: "m7 3 14 9-14 9V3Z",
  arrow: "M4 12h15m-6-6 6 6-6 6",
  plus: "M12 5v14M5 12h14",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  search: "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM16 16l5 5",
  refresh: "M20 7v5h-5M4 17v-5h5M6.3 6.3A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.7 5.7",
  pin: "M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0ZM9 10a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  bus: "M5 4h14v14H5zM5 11h14M8 7h8M7 18v3m10-3v3M8 15h1m6 0h1",
  leaf: "M20 3C6 2 2 9 6 15s15 3 14-12ZM4 21 16 9",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6",
  layers: "m12 3 10 6-10 6L2 9zM2 14l10 6 10-6M2 19l10 5 10-5",
  file: "M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h6",
  check: "m5 12 4 4L19 6",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 3",
  user: "M8 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0M4 22v-3a8 8 0 0 1 16 0v3",
  menu: "M4 6h16M4 12h16M4 18h16",
  atom: "M3 5c4-4 20 8 18 13S0 10 3 5ZM21 5C17 1 1 13 3 18S24 10 21 5ZM12 10v4M10 12h4",
  close: "m6 6 12 12M6 18 18 6",
};
export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 20,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function BrandMark() {
  return (
    <SevensMark width={34} height={38} style={{ "--sevens-logo-accent": "currentColor" } as CSSProperties} />
  );
}
