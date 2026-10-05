export async function hwpSvgPageForUpload(svg:string,fileName:string):Promise<File>{
  const parsed=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;
  const viewBox=(parsed.getAttribute('viewBox')??'').split(/[ ,]+/u).map(Number);
  const sourceWidth=viewBox.length===4&&viewBox[2]>0?viewBox[2]:Number.parseFloat(parsed.getAttribute('width')??'794')||794;
  const sourceHeight=viewBox.length===4&&viewBox[3]>0?viewBox[3]:Number.parseFloat(parsed.getAttribute('height')??'1123')||1123;
  const width=Math.min(2400,Math.max(1200,Math.round(sourceWidth*2)));
  const height=Math.max(1,Math.round(width*sourceHeight/sourceWidth));
  const sourceUrl=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const next=new Image();next.onload=()=>resolve(next);next.onerror=()=>reject(new Error('HWP 페이지 모양을 이미지로 변환하지 못했습니다.'));next.src=sourceUrl;});
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');if(!context)throw new Error('HWP 페이지 변환용 캔버스를 만들지 못했습니다.');
    context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob((value)=>value?resolve(value):reject(new Error('HWP 페이지 이미지를 압축하지 못했습니다.')),'image/jpeg',.94));
    return new File([blob],fileName,{type:'image/jpeg',lastModified:Date.now()});
  }finally{URL.revokeObjectURL(sourceUrl);}
}
