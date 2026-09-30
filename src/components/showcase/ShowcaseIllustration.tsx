import type { CategoryCode } from "@/contracts";

function Tree({ x, y = 98 }: { x: number; y?: number }) {
  return <g transform={`translate(${x} ${y})`}><path d="M0 14v37" stroke="#6f7c65" strokeWidth="3" /><ellipse cy="8" rx="19" ry="25" fill="#b7c4a6" /><ellipse cx="-8" cy="9" rx="11" ry="19" fill="#8fa986" /></g>;
}

function Building({ x, width = 94, school = false, health = false }: { x: number; width?: number; school?: boolean; health?: boolean }) {
  return <g transform={`translate(${x} 72)`}><path d={`M0 14 ${width} 0v77H0Z`} fill="#efe8da" stroke="#c4beae" /><path d={`m${width} 0 23 12v77l-23-12Z`} fill="#bcb7a7" /><path d={`M0 14 23-3 ${width + 23}-13 ${width} 0Z`} fill="#8a9690" /><path d={`M0 14 ${width} 0`} stroke="#e2ab87" strokeWidth="5" />{[18, 42, 66].filter((n) => n < width - 12).map((n) => <g key={n}><path d={`M${n} 30h13v15H${n}zM${n} 53h13v15H${n}z`} fill="#657b79" /><path d={`M${n + 3} 32v11M${n + 3} 55v11`} stroke="#b6cecc" /></g>)}{school && <path d="M34 5v-19l22 5-22 7" fill="#b56d4f" stroke="#8b604e" />}{health && <path d="M46 19v18M37 28h18" stroke="#b36550" strokeWidth="5" />}</g>;
}

/** Decorative category artwork: illustrative infrastructure, never a site photo. */
export function ShowcaseIllustration({ category }: { category: CategoryCode }) {
  const transport = category === "TRANSPORT";
  const safety = category === "SAFETY";
  const ecology = category === "ECOLOGY";
  const utilities = category === "UTILITIES";
  const accessibility = category === "ACCESSIBILITY";
  const tourism = category === "TOURISM";
  return <svg className="showcase-illustration" viewBox="0 0 600 180" fill="none" aria-hidden="true" focusable="false">
    <path d="M0 42h600M0 82h600M0 122h600M0 162h600M42 0v180M122 0v180M202 0v180M282 0v180M362 0v180M442 0v180M522 0v180" stroke="currentColor" opacity=".055" />
    <path d="m105 160 147-78 258 66-149 76Z" fill={ecology ? "#d8e1cb" : "#e6e3d8"} />
    <path d="m88 155 310-19 121 27-304 19Z" fill="#c8d1c7" />
    <path d="m102 164 299-18" stroke="#fffefa" strokeWidth="2" strokeDasharray="13 12" />
    {ecology ? <>
      <path d="m300 106 60-26 213 55-71 32Z" fill="#a8c8ca" /><path d="m322 106 196 48M350 101l191 47" stroke="#d6e3df" strokeWidth="2" />
      <path d="m183 124 94-37 60 16-97 38Z" fill="#bccbad" /><Tree x={235} y={73} /><Tree x={288} y={92} /><Tree x={399} y={106} />
      <path d="m191 137 40-17M191 143l40-17M199 146v9M224 135v9" stroke="#8f6f55" strokeWidth="4" />
    </> : tourism ? <>
      <path d="m210 105 61-41 88 26-66 35Z" fill="#899990" /><path d="m210 105 83 20v38l-83-22Z" fill="#ede6d6" /><path d="m293 125 66-35v39l-66 34Z" fill="#b4b6a4" /><path d="m245 117 29 8v24l-29-7Z" fill="#8fa6a0" />
      <Tree x={390} y={92} /><path d="M432 115v39M416 116h46l-7-13h-39Z" stroke="#8a7b69" strokeWidth="3" fill="#e2ba95" />
    </> : <>
      <Building x={transport || safety ? 296 : 215} school={category === "EDUCATION"} health={category === "HEALTH"} width={category === "EDUCATION" ? 118 : 94} />
      <Tree x={450} y={93} />
      {transport ? <>
        <path d="M176 106h104v38H176Z" fill="#d2a27f" stroke="#947b66" /><path d="m176 106 15-9h102l-13 9Z" fill="#ead6bb" /><path d="m280 106 13-9v38l-13 9Z" fill="#b78968" /><path d="M186 112h20v17h-20zm26 0h20v17h-20zm26 0h20v17h-20Z" fill="#698480" /><path d="M264 110v32" stroke="#8a725f" /><circle cx="198" cy="144" r="7" fill="#51625c" /><circle cx="261" cy="144" r="7" fill="#51625c" />
        <path d="M145 108v35M145 107h29v5h-29Z" stroke="#758d83" strokeWidth="3" /><path d="M137 109h10v17h-10Z" fill="#bed0bf" />
      </> : safety ? <>
        <path d="m165 163 53-3 34-15-52 3Z" fill="#faf8ec" /><path d="m175 164 29-17M188 165l29-17M201 165l29-17M214 165l29-17" stroke="#bac1b6" strokeWidth="5" />
        <path d="M213 127V76h26M405 131V91h-25" stroke="#778b80" strokeWidth="3" /><path d="M230 76h16M371 91h17" stroke="#dcae81" strokeWidth="5" /><path d="M170 131V90" stroke="#788578" strokeWidth="3" /><rect x="165" y="86" width="12" height="29" rx="3" fill="#5e7065" /><circle cx="171" cy="106" r="3" fill="#c4d9a6" />
      </> : utilities ? <>
        <path d="M184 140v-26h-24V87M185 140h153v-16h31v18h38" stroke="#ac896b" strokeWidth="8" strokeLinejoin="round" /><path d="M184 140v-26h-24V87M185 140h153v-16h31v18h38" stroke="#dec0a0" strokeWidth="3" strokeLinejoin="round" /><path d="m386 142 31 9-27 12-30-9Z" fill="#7e9993" /><path d="M406 121v-28h28" stroke="#799084" strokeWidth="3" /><path d="M427 93h17" stroke="#dac495" strokeWidth="5" />
      </> : accessibility ? <>
        <path d="m327 134 82 15-8 12-90-19Z" fill="#b4c8bd" /><path d="m332 123 78 17v10m-81-24v14m39-7v14" stroke="#748f82" strokeWidth="3" /><path d="m178 147 53 5m-40-10 47 4" stroke="#d4b18a" strokeWidth="4" /><circle cx="388" cy="151" r="8" stroke="#597569" strokeWidth="3" /><path d="M386 141v-12h8m-8 8h15l5 11M386 122v1" stroke="#597569" strokeWidth="3" strokeLinecap="round" />
      </> : <><Tree x={174} y={91} /><path d="m351 146 32-11 27 6-33 12Z" fill="#adbc9d" /><path d="M372 127v12M367 130h11" stroke="#8ea879" strokeWidth="3" /></>}
    </>}
    <path d="M100 59h28M114 45v28M491 84h20M501 74v20" stroke="#afbaa8" opacity=".65" />
  </svg>;
}
