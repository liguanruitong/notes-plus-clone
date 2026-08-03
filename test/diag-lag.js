// 复现全局卡顿：一页塞很多压感笔(alphaOn)，测 renderInk / buildInkCache / applyTransform 耗时。
// renderInk 对每条笔都走 strokePathGradient(离屏+densify+getImageData+逐像素) → 笔一多就全局卡。
module.exports = async (cdp) => {
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 800));
  const res = await cdp.eval(`(function(){
    const pg = curPage();
    pg.strokes.length = 0;
    // 造 150 条压感笔，每条 25 点，铺满页面（模拟写满一页笔记）
    for (let k=0;k<150;k++){
      const y = 60 + (k%40)*40, x0 = 60 + Math.floor(k/40)*260;
      const pts=[]; for(let i=0;i<25;i++){const t=i/24; pts.push({x:x0+t*240,y:y+Math.sin(t*6)*8,p:0.15+0.7*Math.abs(Math.sin(t*3))});}
      pg.strokes.push({tool:'pen',color:'#222222',size:5,opacity:1,pWidth:true,pWidthAmt:0.5,pAlpha:true,pAlphaAmt:0.5,points:pts});
    }
    function timed(fn,n){const t0=performance.now();for(let i=0;i<n;i++)fn();return (performance.now()-t0)/n;}
    const tRenderInk = timed(()=>renderInk(), 3);
    _inkCacheDirty=true;
    const tBuildCache = timed(()=>{ _inkCacheDirty=true; buildInkCache(); }, 3);
    const tApply = timed(()=>applyTransform(), 5);
    pg.strokes.length=0; renderInk();
    return JSON.stringify({strokes:150, renderInk:tRenderInk, buildCache:tBuildCache, applyTransform:tApply});
  })()`);
  console.log("PERF:", res);
  const d=JSON.parse(res);
  console.log("150条压感笔 renderInk 单次:", d.renderInk.toFixed(1), "ms");
  console.log("            buildInkCache 单次:", d.buildCache.toFixed(1), "ms");
  console.log("            applyTransform 单次:", d.applyTransform.toFixed(2), "ms");
  return true;
};
