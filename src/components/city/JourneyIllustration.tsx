"use client";

import { useId } from "react";

// An original, illustrative neighbourhood. Coordinates describe an invented
// map tile, not real buildings, official routing, or a geographic dataset.
const project = (u: number, v: number, height = 0) => [310 + (u - v) * .91, 40 + (u + v) * .44 - height] as const;
const point = (u: number, v: number, height = 0) => project(u, v, height).join(",");
const plot = (u: number, v: number, width: number, depth: number, height = 0) =>
  [point(u, v, height), point(u + width, v, height), point(u + width, v + depth, height), point(u, v + depth, height)].join(" ");

function Building({ u, v, width, depth, height, accent = false }: {
  u: number; v: number; width: number; depth: number; height: number; accent?: boolean;
}) {
  const levels = Math.max(1, Math.floor(height / 19));
  return <g>
    <polygon points={plot(u + 7, v + 8, width, depth)} fill="#142725" opacity=".11" />
    <polygon points={[point(u + width, v, height), point(u + width, v + depth, height), point(u + width, v + depth), point(u + width, v)].join(" ")} fill={accent ? "#af795b" : "#36554a"} />
    <polygon points={[point(u, v + depth, height), point(u + width, v + depth, height), point(u + width, v + depth), point(u, v + depth)].join(" ")} fill={accent ? "#cf9470" : "#6f8977"} />
    <polygon points={plot(u, v, width, depth, height)} fill={accent ? "#edac83" : "#dce2d3"} stroke={accent ? "#f5c4a5" : "#f4f3ed"} strokeWidth=".8" />
    <polygon points={plot(u + 3, v + 3, width - 6, depth - 6, height + .1)} fill={accent ? "#e3a17a" : "#bac9b6"} />
    <path d={`M${point(u + 3, v + depth - 3, height + .3)} L${point(u + width - 3, v + depth - 3, height + .3)} L${point(u + width - 3, v + 3, height + .3)}`} fill="none" stroke="#142725" strokeOpacity=".12" strokeWidth="1.1" />
    {Array.from({ length: levels }, (_, level) => [0, 1, 2].map((column) => {
      const x = u + 5 + column * (width - 8) / 3;
      const z = 11 + level * 16;
      return <polygon key={`front-${level}-${column}`} points={[point(x, v + depth + .1, z), point(x + 4, v + depth + .1, z), point(x + 4, v + depth + .1, z + 6), point(x, v + depth + .1, z + 6)].join(" ")} fill="#f4f3ed" fillOpacity={accent ? ".76" : ".63"} />;
    }))}
    {Array.from({ length: levels }, (_, level) => [0, 1].map((column) => {
      const y = v + 5 + column * (depth - 8) / 2;
      const z = 11 + level * 16;
      return <polygon key={`side-${level}-${column}`} points={[point(u + width + .1, y, z), point(u + width + .1, y + 4, z), point(u + width + .1, y + 4, z + 6), point(u + width + .1, y, z + 6)].join(" ")} fill="#cdd8c4" fillOpacity=".46" />;
    }))}
  </g>;
}

function Tree({ u, v, canopy }: { u: number; v: number; canopy: string }) {
  const [x, y] = project(u, v);
  return <g>
    <ellipse cx={x + 4} cy={y + 2} rx="8" ry="3" fill="#142725" opacity=".13" />
    <path d={`M${x} ${y} v-13`} stroke="#596c54" strokeWidth="2.4" strokeLinecap="round" />
    <ellipse cx={x} cy={y - 17} rx="8" ry="10" fill={canopy} />
    <ellipse cx={x - 2.5} cy={y - 19} rx="4.5" ry="6.5" fill="#f4f3ed" opacity=".1" />
    <path d={`M${x} ${y - 7} v-9`} stroke="#142725" strokeOpacity=".16" strokeWidth="1" />
  </g>;
}

function Person({ u, v, copper = false }: { u: number; v: number; copper?: boolean }) {
  const [x, y] = project(u, v);
  return <g>
    <ellipse cx={x + 1} cy={y + .6} rx="2.7" ry="1.1" fill="#142725" opacity=".15" />
    <path d={`M${x - 1} ${y} l1-4 1.7 3.6`} fill="none" stroke="#294038" strokeWidth="1" strokeLinecap="round" />
    <path d={`M${x} ${y - 3} v-3`} stroke={copper ? "#b77855" : "#36554a"} strokeWidth="2.7" strokeLinecap="round" />
    <circle cx={x} cy={y - 7.5} r="1.5" fill="#bd926b" />
  </g>;
}

export function JourneyIllustration({ stage }: { stage: number }) {
  const uid = `journey-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const step = Math.max(0, Math.min(3, Math.floor(stage)));
  const [pinX, pinY] = project(114, 142);
  const [officeX, officeY] = project(160, 70);
  const activeOffice = step === 2;
  const path = `M${point(114, 142, 1)} L${point(114, 84, 1)} L${point(160, 84, 1)} L${point(160, 74, 1)}`;
  return <svg className="sevens-journey-illustration" viewBox="0 0 620 300" width="100%" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style={{ display: "block" }}>
    <defs>
      <linearGradient id={`${uid}-land`} x1="0" y1="0" x2="0" y2="1">
        <stop stopColor="#e6eadc" /><stop offset="1" stopColor="#b6c5ad" />
      </linearGradient>
      <linearGradient id={`${uid}-tree`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#577965" /><stop offset="1" stopColor="#36554a" />
      </linearGradient>
      <filter id={`${uid}-shadow`} x="-25%" y="-35%" width="150%" height="180%">
        <feDropShadow dx="0" dy="9" stdDeviation="6" floodColor="#142725" floodOpacity=".12" />
      </filter>
      <filter id={`${uid}-paper`} x="-30%" y="-30%" width="160%" height="180%">
        <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#142725" floodOpacity=".17" />
      </filter>
    </defs>

    {/* Thin extruded tile with a quiet landscaped street grid. */}
    <g filter={`url(#${uid}-shadow)`}>
      <path d={`M${point(0, 240)} L${point(240, 240)} L${point(240, 0)} l0 8 L${point(240, 240, -8)} L${point(0, 240, -8)} Z`} fill="#829b83" />
      <polygon points={plot(0, 0, 240, 240)} fill={`url(#${uid}-land)`} stroke="#e9edde" strokeWidth="1" />
    </g>
    <polygon points={plot(16, 140, 74, 78)} fill="#a0b793" stroke="#dbe3d0" strokeWidth="1" />
    <polygon points={plot(136, 27, 46, 64)} fill="#d7dccd" stroke="#eef0e5" strokeWidth="1" />
    <polygon points={plot(139, 151, 38, 62)} fill="#a9bd9c" />
    <path d={`M${point(53, 140)} L${point(53, 180)} L${point(90, 180)} M${point(53, 180)} L${point(23, 209)}`} fill="none" stroke="#dedfcc" strokeWidth="5" strokeLinejoin="round" />

    {/* The river stays a muted natural green; its banks belong to the tile. */}
    <polygon points={[point(190, 0), point(224, 0), point(215, 70), point(207, 130), point(214, 240), point(180, 240), point(175, 190), point(180, 130), point(185, 70)].join(" ")} fill="#799587" />
    <path d={`M${point(199, 4)} Q${point(207, 54)} ${point(196, 101)} T${point(193, 236)}`} fill="none" stroke="#f4f3ed" strokeOpacity=".23" strokeWidth="1" />
    <path d={`M${point(213, 12)} Q${point(213, 76)} ${point(201, 126)} T${point(205, 223)}`} fill="none" stroke="#36554a" strokeOpacity=".18" strokeWidth="1" />
    <path d={`M${point(190, 0)} L${point(185, 70)} L${point(180, 130)} L${point(175, 190)} L${point(180, 240)}`} fill="none" stroke="#a8c09c" strokeWidth="3" />

    <polygon points={plot(103, 0, 24, 240)} fill="#a6b5a0" stroke="#f4f3ed" strokeOpacity=".8" strokeWidth="1.3" />
    <polygon points={plot(0, 104, 240, 22)} fill="#a6b5a0" stroke="#f4f3ed" strokeOpacity=".8" strokeWidth="1.3" />
    <polygon points={plot(127, 77, 46, 14)} fill="#c0cbb5" />
    <path d={`M${point(115, 8)} L${point(115, 98)} M${point(115, 158)} L${point(115, 232)} M${point(8, 115)} L${point(92, 115)} M${point(135, 115)} L${point(176, 115)}`} stroke="#eff0e5" strokeWidth=".9" strokeDasharray="5 5" fill="none" />
    {Array.from({ length: 5 }, (_, stripe) => <polygon key={stripe} points={plot(104, 133 + stripe * 3.5, 22, 1.8)} fill="#f4f3ed" />)}

    {/* A raised bridge connects both banks, with fine parapets and piers. */}
    <polygon points={plot(176, 104, 47, 22)} fill="#36554a" opacity=".23" transform="translate(4 5)" />
    <polygon points={[point(176, 126, 3), point(223, 126, 3), point(223, 126, -2), point(176, 126, -2)].join(" ")} fill="#8b9c88" />
    <polygon points={plot(176, 104, 47, 22, 3)} fill="#dadfce" />
    <path d={`M${point(176, 105, 6)} L${point(223, 105, 6)} M${point(176, 125, 6)} L${point(223, 125, 6)}`} stroke="#f4f3ed" strokeWidth="1.4" fill="none" />
    {[183, 199, 215].map((u) => <path key={u} d={`M${point(u, 125, 6)} L${point(u, 125, 1)}`} stroke="#9fae98" strokeWidth="1.3" />)}

    <Building u={32} v={26} width={28} depth={29} height={34} />
    <Building u={67} v={40} width={24} depth={27} height={43} />
    <Tree u={22} v={82} canopy={`url(#${uid}-tree)`} />
    <Tree u={44} v={84} canopy={`url(#${uid}-tree)`} />
    <Tree u={76} v={84} canopy={`url(#${uid}-tree)`} />

    {/* A small civic office, with a porch, glazed entrance, and roof lantern. */}
    {activeOffice && <polygon points={plot(137, 33, 47, 49)} fill="#edac83" fillOpacity=".19" stroke="#edac83" strokeWidth="1.1" />}
    <Building u={144} v={40} width={34} depth={32} height={49} accent={activeOffice} />
    <polygon points={plot(155, 47, 11, 10, 52)} fill={activeOffice ? "#f5c7a6" : "#eff0e4"} />
    <polygon points={[point(155, 57, 52), point(166, 57, 52), point(166, 57, 49), point(155, 57, 49)].join(" ")} fill="#96ad92" />
    <polygon points={[point(158, 72.2), point(164, 72.2), point(164, 72.2, 14), point(158, 72.2, 14)].join(" ")} fill="#1d3932" />
    <path d={`M${point(161, 72.3, 1)} L${point(161, 72.3, 13)}`} stroke="#f4f3ed" strokeOpacity=".5" strokeWidth=".6" />
    {[149, 173].map((u) => <path key={u} d={`M${point(u, 78)} L${point(u, 78, 16)}`} stroke="#f4f3ed" strokeWidth="2.4" />)}
    <polygon points={plot(146, 71, 29, 9, 16)} fill={activeOffice ? "#f1bd99" : "#e3e7d7"} stroke="#f4f3ed" strokeWidth=".6" />
    <polygon points={plot(148, 79, 27, 3, 1)} fill="#dbe0ce" />
    <Tree u={170} v={25} canopy={`url(#${uid}-tree)`} />
    <Building u={221} v={38} width={12} depth={32} height={30} />
    <Tree u={228} v={87} canopy={`url(#${uid}-tree)`} />

    <Tree u={27} v={153} canopy={`url(#${uid}-tree)`} />
    <Tree u={73} v={151} canopy={`url(#${uid}-tree)`} />
    <Tree u={33} v={187} canopy={`url(#${uid}-tree)`} />
    <Tree u={77} v={199} canopy={`url(#${uid}-tree)`} />
    <Building u={27} v={213} width={27} depth={19} height={25} />
    <Building u={145} v={157} width={29} depth={32} height={31} />
    <Tree u={157} v={211} canopy={`url(#${uid}-tree)`} />
    <Tree u={226} v={184} canopy={`url(#${uid}-tree)`} />

    {/* Benches, a lamp and walkers make this a place people actually use. */}
    <polygon points={plot(57, 168, 14, 4, 5)} fill="#9a785d" />
    <path d={`M${point(59, 172)} L${point(59, 172, 5)} M${point(68, 172)} L${point(68, 172, 5)}`} stroke="#36554a" strokeWidth="1.2" />
    <path d={`M${point(131, 149)} L${point(131, 149, 20)} l5 2`} fill="none" stroke="#667c64" strokeWidth="1.2" strokeLinecap="round" />
    <circle cx={project(131, 149, 20)[0] + 5} cy={project(131, 149, 20)[1] + 2} r="1.6" fill="#f4f3ed" />
    <Person u={99} v={141} copper />
    <Person u={132} v={141} />
    <Person u={55} v={183} />
    <Person u={210} v={116} copper />

    {/* All four scenes keep the same place; only the story's focus changes. */}
    {step === 1 && <g>
      <path d={path} fill="none" stroke="#f4f3ed" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d={path} fill="none" stroke="#c68560" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {[[114, 142], [114, 84], [160, 84], [160, 74]].map(([u, v], index) => <ellipse key={index} cx={project(u!, v!, 1)[0]} cy={project(u!, v!, 1)[1]} rx="4" ry="2.4" fill="#edac83" stroke="#f4f3ed" strokeWidth="1.2" />)}
    </g>}
    {step === 2 && <g>
      <ellipse cx={officeX} cy={officeY + 7} rx="19" ry="6" fill="#edac83" fillOpacity=".17" />
      <circle cx={officeX + 24} cy={officeY - 60} r="11" fill="#142725" stroke="#edac83" strokeWidth="1.1" />
      <path d={`M${officeX + 19} ${officeY - 59} h10 M${officeX + 20} ${officeY - 60} v-5 M${officeX + 24} ${officeY - 60} v-5 M${officeX + 28} ${officeY - 60} v-5 M${officeX + 18} ${officeY - 66} l6-3 6 3 Z`} fill="none" stroke="#edac83" strokeWidth=".9" strokeLinejoin="round" />
    </g>}
    {(step === 0 || step === 1) && <g transform={`translate(${pinX} ${pinY})`}>
      <ellipse rx={step === 0 ? 20 : 12} ry={step === 0 ? 7 : 4.5} fill="#edac83" fillOpacity=".2" />
      <ellipse rx={step === 0 ? 13 : 7} ry={step === 0 ? 4.5 : 2.7} fill="none" stroke="#bc805f" strokeOpacity=".65" strokeWidth="1" />
      <g transform={step === 1 ? "scale(.68)" : undefined} filter={`url(#${uid}-paper)`}>
        <path d="M0-3 C-4-12-16-22-16-33 A16 16 0 0 1 16-33 C16-22 4-12 0-3Z" fill="#edac83" stroke="#f4c7a6" strokeWidth="1" />
        <circle cy="-33" r="6" fill="#f4f3ed" /><circle cy="-33" r="2" fill="#bf805c" />
      </g>
    </g>}
    {step === 3 && <g>
      <path d={`M${point(160, 83)} L${point(114, 83)} L${point(114, 142)}`} fill="none" stroke="#36554a" strokeWidth="1.4" strokeDasharray="3 4" strokeOpacity=".5" />
      <ellipse cx={pinX} cy={pinY} rx="16" ry="5.5" fill="#edac83" fillOpacity=".25" />
      <path d={`M${pinX} ${pinY - 2} v23 q0 9 11 9 h18`} fill="none" stroke="#bd815c" strokeWidth="1.1" />
      <g transform={`translate(${pinX + 14} ${pinY + 20})`} filter={`url(#${uid}-paper)`}>
        <path d="M0 0 H93 Q100 0 100 7 V46 Q100 53 93 53 H7 Q0 53 0 46 V19 L-9 13 H0Z" fill="#f4f3ed" stroke="#d7ddce" strokeWidth="1" />
        <path d="M13 14 H56 M13 23 H79 M13 32 H49" fill="none" stroke="#36554a" strokeOpacity=".35" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="78" cy="37" r="14" fill="#1d3932" />
        <path d="m72 37 4 4 8-9" fill="none" stroke="#edac83" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </g>}
  </svg>;
}
