// 诊断：拆分 strokePathGradient 长笔画的耗时来源（densify+stamp vs getImageData+像素循环）。
module.exports = async (cdp) => {
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 700));
  const res = await cdp.eval(`(function(){
    const N=800,a=[]; for(let i=0;i<N;i++){const t=i/(N-1); const x=100+Math.abs(((t*4)%2)-1)*1000; a.push({x:x,y:200+t*1200,p:0.1+0.8*((i%20)/20)});}
    const s={tool:'pen',color:'#000000',size:6,opacity:1,pWidth:true,pWidthAmt:0.5,pAlpha:true,pAlphaAmt:0.5,points:a};
    const step = Math.max(0.35, widthAt(s,0.5)*0.15);
    const dp = densifyStroke(a, step);
    // bbox
    let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9,pad=0;
    for(const q of a){const r=widthAt(s,q.p??0.5)/2+2; pad=Math.max(pad,r); if(q.x<minX)minX=q.x; if(q.y<minY)minY=q.y; if(q.x>maxX)maxX=q.x; if(q.y>maxY)maxY=q.y;}
    const bw=Math.ceil(maxX+pad)-Math.floor(minX-pad), bh=Math.ceil(maxY+pad)-Math.floor(minY-pad);
    return JSON.stringify({ densifiedPts: dp.length, step:step, bbox:[bw,bh], bboxPx:bw*bh });
  })()`);
  console.log("LONGSTROKE:", res);
  return true;
};
