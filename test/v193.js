// v1.9.3 断言：pAlpha 开时「实时预览」现在走和最终一致的印章渐变 → 所见即所得。
//  - 实时(live=renderLiveNow 渲染到 ictx)在起/中/末 alpha 跨度明显(>40)，中段不饱和(<250)；
//  - 实时 ≈ 最终(grad) 每处差<30；
//  - pAlpha 关时实时三处基本一致；
//  - 长笔画(800点)实时单帧渲染 <~16ms。
module.exports = async (cdp) => {
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 700));
  const res = await cdp.eval(`(function(){
    // 采样某一列在 ictx 上的平均 alpha（有墨处）。
    function colAlpha(ctx, xc, y0, y1){ let s=0,n=0; for(let y=y0;y<y1;y++){const d=ctx.getImageData(xc,y,1,1).data; if(d[3]>0){s+=d[3];n++;}} return n?Math.round(s/n):0; }
    const Y=300, X0=140, X1=500, X2=860;
    function mkStroke(pAlpha){
      const N=40,a=[]; for(let i=0;i<N;i++){const t=i/(N-1); a.push({x:100+t*800,y:Y,p:0.1+0.8*t});}
      return {tool:'pen',color:'#000000',size:6,opacity:1,pWidth:true,pWidthAmt:0.5,pAlpha:pAlpha,pAlphaAmt:0.5,points:a};
    }
    // 实时：设置 cur，跑真实的 renderLiveNow → 渲染到 ictx，再采样。
    function liveMeasure(pAlpha){
      cur = mkStroke(pAlpha); _inkCacheDirty = true; renderLiveNow(); cur = null; _inkCacheDirty = true;
      return { L:colAlpha(ictx,X0,Y-40,Y+40), M:colAlpha(ictx,X1,Y-40,Y+40), R:colAlpha(ictx,X2,Y-40,Y+40) };
    }
    // 最终：strokePathGradient 到独立离屏，采样同列。
    function gradMeasure(){
      const cv=document.createElement('canvas'); cv.width=1240; cv.height=1754;
      const cx=cv.getContext('2d',{willReadFrequently:true});
      strokePathGradient(cx, mkStroke(true));
      return { L:colAlpha(cx,X0,Y-40,Y+40), M:colAlpha(cx,X1,Y-40,Y+40), R:colAlpha(cx,X2,Y-40,Y+40) };
    }
    // 性能：800 点长笔画，连跑 10 次实时渲染，取平均。
    function perf(){
      const N=800,a=[]; for(let i=0;i<N;i++){const t=i/(N-1); const x=100+Math.abs(((t*4)%2)-1)*1000; a.push({x:x,y:200+t*1200,p:0.1+0.8*((i%20)/20)});}
      cur={tool:'pen',color:'#000000',size:6,opacity:1,pWidth:true,pWidthAmt:0.5,pAlpha:true,pAlphaAmt:0.5,points:a};
      _inkCacheDirty=true;
      const t0=performance.now(); for(let k=0;k<10;k++){ renderLiveNow(); } const t1=performance.now();
      cur=null; _inkCacheDirty=true;
      return (t1-t0)/10;
    }
    return JSON.stringify({ liveOn:liveMeasure(true), gradOn:gradMeasure(), liveOff:liveMeasure(false), ms:perf() });
  })()`);
  console.log("DIAG:", res);
  const d = JSON.parse(res);
  const lon = d.liveOn, g = d.gradOn, loff = d.liveOff;
  console.log("实时 pAlpha开: 起", lon.L, "中", lon.M, "末", lon.R, " 跨度", lon.R - lon.L);
  console.log("最终 grad    : 起", g.L, "中", g.M, "末", g.R, " 跨度", g.R - g.L);
  console.log("实时 pAlpha关: 起", loff.L, "中", loff.M, "末", loff.R);
  console.log("LIVE_LONG_STROKE_MS=", d.ms.toFixed(2));

  const span = lon.R - lon.L;
  const midNotSat = lon.M < 250;
  const close = Math.abs(lon.L - g.L) < 30 && Math.abs(lon.M - g.M) < 30 && Math.abs(lon.R - g.R) < 30;
  const offFlat = Math.abs(loff.R - loff.L) < 20 && Math.abs(loff.M - loff.L) < 20;
  const fast = d.ms < 16;

  const checks = [
    ["实时跨度>40", span > 40],
    ["实时中段不饱和(<250)", midNotSat],
    ["实时≈最终(各处差<30)", close],
    ["pAlpha关实时三处一致", offFlat],
    ["长笔画单帧<16ms", fast],
  ];
  let pass = true;
  for (const [name, ok] of checks) { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) pass = false; }
  console.log("PASS=" + pass);
  return pass;
};
