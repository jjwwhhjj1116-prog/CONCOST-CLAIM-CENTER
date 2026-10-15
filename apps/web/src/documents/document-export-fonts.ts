const availability=new WeakMap<Document,Map<string,Promise<boolean>>>();
const unquote=(family:string)=>family.trim().replace(/^(["'])(.*)\1$/u,'$2');

export async function prepareDocumentExportFonts(document:Document):Promise<void>{
  await document.fonts.ready;
  availability.set(document,new Map());
}

export async function resolveDocumentExportFontFamily(list:string,document:Document):Promise<string>{
  const families=(list.match(/(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,])+/gu)||[]).map(unquote);
  const cache=availability.get(document)!;
  for(const family of families){
    // Generic families and per-character fallback have no portable native font
    // name. Resolve existing named CSS fallbacks without guessing a new font.
    if(/^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-.+|emoji|math|fangsong)$/iu.test(family))break;
    let available=cache.get(family);
    if(!available){
      available=(async()=>{
        if([...document.fonts].some(face=>unquote(face.family)===family&&face.status==='loaded'))return true;
        try{await new (document.defaultView!.FontFace)('document-export-font-probe',`local(${JSON.stringify(family)})`).load();return true;}catch{return false;}
      })();
      cache.set(family,available);
    }
    if(await available)return family;
  }
  return families[0]||list;
}
