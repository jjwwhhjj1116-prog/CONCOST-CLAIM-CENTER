/** Native double/triple strokes, centered on the measured cell grid (HWP SDK formulas). */
export function hwpTableBorderDecoration(layout:Record<string,string|number>):string {
 const images:string[]=[],sizes:string[]=[],positions:string[]=[];
 for(const side of ['Top','Bottom','Left','Right']){
  const pattern=layout[`border${side}Pattern`];
  if(!['DOUBLE_SLIM','SLIM_THICK_SLIM'].includes(String(pattern)))continue;
  const border=String(layout[`border${side}`]??'').match(/^([\d.]+)px solid (#[0-9a-f]{6})$/iu);
  if(!border)continue;
  const w=Number(border[1]),color=border[2],double=pattern==='DOUBLE_SLIM',t=Math.max(w,double?3:4),thin=Math.max(t*(double?.3:.15),.4);
  const middle=Math.max(t*.3,.6),gap=Math.max(t*(double?.4:.15),double?1:.8),offset=double?(gap+thin)/2:middle/2+gap+thin/2;
  const strokes=double?[[-offset,thin],[offset,thin]]:[[-offset,thin],[0,middle],[offset,thin]];
  for(const [at,stroke]of strokes){const horizontal=side==='Top'||side==='Bottom',far=side==='Right'||side==='Bottom';
   images.push(`linear-gradient(${color},${color})`);
   sizes.push(horizontal?`calc(100% - 16px) ${stroke}px`:`${stroke}px calc(100% - 16px)`);
   const coordinate=far?`calc(100% - 8px + ${at+stroke/2}px)`:`${8+at-stroke/2}px`;
   positions.push(horizontal?`8px ${coordinate}`:`${coordinate} 8px`);
  }
 }
 if(!images.length)return '';
 // Percentages change only segment length. Stroke thickness/gaps stay fixed on row/column edits.
 return `--hwp-cell-border-image:${images.join(',')};--hwp-cell-border-size:${sizes.join(',')};--hwp-cell-border-position:${positions.join(',')}`;
}
