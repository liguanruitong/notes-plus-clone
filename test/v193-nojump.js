// 关键验证：用户真实体验的"抬笔瞬间不跳变"——
// 逐帧增量画到抬笔前的实时结果，对比抬笔后 onUp 走 strokePathGradient(一次性,最终保存态)。
// 两者若逐列接近(差<=6/255,肉眼不可辨)，则用户看不到"抬笔一下变了"。
module.exports = async (cdp) => {
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 700));
  const res = await cdp.eval(`(function(){
    function colAlpha(ctx,xc,y0,y1){let s=0,n=0;for(let y=y0;y<y1;y++){const d=ctx.getImageData(xc,y,1,1).data;if(d[3]>0){s+=d[3];n++;}}return n?Math.round(s/n):0;}
    const Y=300, cols=[160,340,540,740,940];
    function mk(){const N=60,a=[];for(let i=0;i<N;i++){const t=i/(N-1);a.push({x:100+t*900,y:Y,p:0.1+0.8*t});}return {tool:'pen',color:'#000000',size:6,opacity:1,pWidth:true,pWidthAmt:0.5,pAlpha:true,pAlphaAmt:0.5,points:a};}
    const s = mk();
    // (A) 逐帧增量实时到抬笔前
    cur = {...s, points:[]}; _inkCacheDirty=true;
    for(let i=0;i<s.points.length;i++){cur.points.push(s.points[i]); if(i%3===0||i===s.points.length-1) renderLiveNow();}
    const live = cols.map(x=>colAlpha(ictx,x,Y-40,Y+40));
    // (B) 抬笔：真正提交到 strokes 并 renderInk（=最终保存渲染，一次性 strokePathGradient）
    cur=null;
    const fresh = mk();
    curPage().strokes.push(fresh); renderInk();
    const finalR = cols.map(x=>colAlpha(ictx,x,Y-40,Y+40));
    // 清理，别污染文档
    curPage().strokes.pop(); renderInk(); _inkCacheDirty=true;
    return JSON.stringify({live, finalR});
  })()`);
  console.log("DIAG:", res);
  const d = JSON.parse(res);
  console.log("抬笔前(实时增量):", d.live.join(","));
  console.log("抬笔后(最终保存):", d.finalR.join(","));
  let maxDiff=0; for(let i=0;i<d.live.length;i++) maxDiff=Math.max(maxDiff,Math.abs(d.live[i]-d.finalR[i]));
  console.log("抬笔前后最大列差:", maxDiff, "(/255)");
  const ok = maxDiff <= 6;   // <=6/255 ≈ 2.3%，肉眼不可辨，抬笔不跳变
  console.log((ok?"PASS ":"FAIL ")+"抬笔前后视觉一致(差<=6/255)");
  console.log("PASS="+ok);
  return ok;
};
