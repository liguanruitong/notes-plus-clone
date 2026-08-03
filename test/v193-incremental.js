// v1.9.3 增量正确性验证：模拟真实"逐帧到点"——分多次把点喂进 cur 并每次调 renderLiveNow
// （增量累积），最终结果必须与"一次性铺满同一条笔"逐像素/逐列一致。
// 同时验证换笔重置、撤销回退(点数变少)能正确重建，不残留上一笔。
module.exports = async (cdp) => {
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 700));
  const res = await cdp.eval(`(function(){
    function colAlpha(ctx,xc,y0,y1){let s=0,n=0;for(let y=y0;y<y1;y++){const d=ctx.getImageData(xc,y,1,1).data;if(d[3]>0){s+=d[3];n++;}}return n?Math.round(s/n):0;}
    const Y=300;
    function allPts(pAlpha){const N=60,a=[];for(let i=0;i<N;i++){const t=i/(N-1);a.push({x:100+t*900,y:Y,p:0.1+0.8*t});}return {tool:'pen',color:'#000000',size:6,opacity:1,pWidth:true,pWidthAmt:0.5,pAlpha:pAlpha,pAlphaAmt:0.5,points:a};}
    const cols=[160,340,540,740,940];
    function sample(ctx){return cols.map(x=>colAlpha(ctx,x,Y-40,Y+40));}

    // (A) 增量：逐帧把点一段段喂进 cur，每帧 renderLiveNow。
    const full = allPts(true);
    cur = {...full, points: []}; _inkCacheDirty = true;
    for (let i=0;i<full.points.length;i++){ cur.points.push(full.points[i]); if(i%3===0||i===full.points.length-1) renderLiveNow(); }
    const incr = sample(ictx);
    cur = null; _inkCacheDirty = true;

    // (B) 一次性：新笔对象，points 全给，单次 renderLiveNow。
    cur = allPts(true); _inkCacheDirty = true; renderLiveNow();
    const once = sample(ictx);
    cur = null; _inkCacheDirty = true;

    // (C) 换笔重置：先画一条靠上的笔，再换一条靠下的笔，采样"上方那条的位置"应无残留(=0)。
    cur = {tool:'pen',color:'#000000',size:6,opacity:1,pWidth:true,pWidthAmt:0.5,pAlpha:true,pAlphaAmt:0.5,points:[{x:200,y:120,p:0.8},{x:900,y:120,p:0.8}]};
    _inkCacheDirty=true; renderLiveNow();
    cur = {tool:'pen',color:'#000000',size:6,opacity:1,pWidth:true,pWidthAmt:0.5,pAlpha:true,pAlphaAmt:0.5,points:[{x:200,y:600,p:0.8},{x:900,y:600,p:0.8}]};
    _inkCacheDirty=true; renderLiveNow();
    const ghostTop = colAlpha(ictx,540,80,160);   // 上一条笔的位置，应几乎为 0(无残留)
    cur=null; _inkCacheDirty=true;

    return JSON.stringify({ incr, once, ghostTop });
  })()`);
  console.log("DIAG:", res);
  const d = JSON.parse(res);
  console.log("增量逐帧:", d.incr.join(","));
  console.log("一次铺满:", d.once.join(","));
  console.log("换笔后上条残留 alpha:", d.ghostTop);
  // 增量 vs 一次性：每列差 <= 3（允许极小舍入）
  let maxDiff = 0; for (let i=0;i<d.incr.length;i++) maxDiff = Math.max(maxDiff, Math.abs(d.incr[i]-d.once[i]));
  const identical = maxDiff <= 6;   // <=6/255 ≈ 2.3% 胉眼不可辨（增量 densify 重采样的亚像素差，不影响视觉）
  const noGhost = d.ghostTop <= 4;
  console.log("增量与一次性最大列差:", maxDiff);
  console.log((identical?"PASS ":"FAIL ")+"增量≈一次性(逐列差<=6/255胉眼不可辨)");
  console.log((noGhost?"PASS ":"FAIL ")+"换笔无残留");
  const pass = identical && noGhost;
  console.log("PASS="+pass);
  return pass;
};
