// Consistent inline SVG icon set (replaces platform-dependent emoji).
// 24x24 grid, 2px strokes, currentColor — renders identically everywhere.
import type { SVGProps } from 'react';

const S = (p: SVGProps<SVGSVGElement>) => ({ width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p });

export const IconCoin = (p: SVGProps<SVGSVGElement>) => (
  <svg {...S(p)} fill="#ffc93c" stroke="#a86b00"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v9M9.5 9.5h3.75a1.75 1.75 0 0 1 0 3.5H10.5a1.75 1.75 0 0 0 0 3.5H14.5" stroke="#a86b00" /></svg>
);
export const IconPause = (p: SVGProps<SVGSVGElement>) => (<svg {...S(p)}><path d="M9 5v14M15 5v14" /></svg>);
export const IconPlay = (p: SVGProps<SVGSVGElement>) => (<svg {...S(p)} fill="currentColor"><path d="M8 5.5v13l10.5-6.5z" /></svg>);
export const IconRetry = (p: SVGProps<SVGSVGElement>) => (<svg {...S(p)}><path d="M4 12a8 8 0 1 0 2.6-5.9" /><path d="M4 4v5h5" /></svg>);
export const IconHome = (p: SVGProps<SVGSVGElement>) => (<svg {...S(p)}><path d="M4 11.5 12 5l8 6.5" /><path d="M6.5 10v9h11v-9" /></svg>);
export const IconGear = (p: SVGProps<SVGSVGElement>) => (<svg {...S(p)}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5" /></svg>);
export const IconHelp = (p: SVGProps<SVGSVGElement>) => (<svg {...S(p)}><circle cx="12" cy="12" r="9" /><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.6M12 17.2v.1" /></svg>);
export const IconTrophy = (p: SVGProps<SVGSVGElement>) => (<svg {...S(p)}><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4" /></svg>);
export const IconMagnet = (p: SVGProps<SVGSVGElement>) => (<svg {...S(p)}><path d="M6 4v8a6 6 0 0 0 12 0V4" /><path d="M6 8h3M15 8h3" /><path d="M9 4v8a3 3 0 0 0 6 0V4" /></svg>);
export const IconJet = (p: SVGProps<SVGSVGElement>) => (<svg {...S(p)}><rect x="6" y="4" width="4" height="10" rx="2" /><rect x="14" y="4" width="4" height="10" rx="2" /><path d="M8 17l-1 3M16 17l1 3M10 8h4" /></svg>);
export const IconShield = (p: SVGProps<SVGSVGElement>) => (<svg {...S(p)}><path d="M12 3.5 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6z" /></svg>);
export const IconX2 = (p: SVGProps<SVGSVGElement>) => (<svg {...S(p)}><path d="M5 8l6 8M11 8l-6 8" /><path d="M14.5 9.5a2.5 2.5 0 0 1 4.6 1.3c0 1.9-4.6 3.6-4.6 5.2h5" /></svg>);
export const IconSpeaker = ({ muted, ...p }: SVGProps<SVGSVGElement> & { muted?: boolean }) => (
  <svg {...S(p)}><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />{muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}</svg>
);
export const IconArrow = ({ dir, ...p }: SVGProps<SVGSVGElement> & { dir: 'up' | 'down' | 'left' | 'right' }) => {
  const r = { up: 0, right: 90, down: 180, left: 270 }[dir];
  return (<svg {...S(p)} style={{ transform: `rotate(${r}deg)` }}><path d="M12 19V5M6 11l6-6 6 6" /></svg>);
};

export const POWER_ICON: Record<string, (p: SVGProps<SVGSVGElement>) => JSX.Element> = {
  magnet: IconMagnet, jetpack: IconJet, shield: IconShield, multiplier: IconX2,
};
export const POWER_NAME: Record<string, string> = { magnet: 'Magnet', jetpack: 'Jetpack', shield: 'Hoverboard', multiplier: 'Double score' };
export const POWER_COLOR: Record<string, string> = { magnet: '#38c6ff', jetpack: '#ff7a45', shield: '#5fe6c8', multiplier: '#ffc93c' };
