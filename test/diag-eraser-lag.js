// 橡皮拖动成本：满页 150 条笔，模拟橡皮划过。没擦到笔的帧应几乎零成本(不重画)；
// 擦到笔的帧会触发一次全量重建(752ms 级)——测出真实每帧成本，判断橡皮拖动是否卡。
module.exports = async (cdp) => {
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 800));
  const res = await cdp.eval(`(function(){
    const pg=curPage();
    function mk(k){const y=60+(k%40)*40,x0=60+Math.floor(k/40)*260,pts=[];for(let i=0;i<25;i++){const t=i/24;pts.push({x:x0+t*240,y:y+Math.sin(t*6)*8,p:0.4});}return {tool:'pen',color:'#222',size:5,opacity:1,pWidth:true,pWidthAmt:0.5,pAlpha:true,pAlphaAmt:0.5,points:pts};}
    pg.strokes.length=0; for(let k=0;k<150;k++) pg.strokes.push(mk(k));
    _inkCacheDirty=true; buildInkCache();
    // 观察：没擦到笔时，renderInk 是否零成本(增量：无新笔、无删除→直接贴位图)
    let t0=performance.now(); renderInk(); const idleMs=performance.now()-t0;
    // 擦到一条时的成本（删除→标脏→全量重建）
    _inkCacheDirty=true; // 模拟 eraseAt changed 后标脏
    pg.strokes.splice(70,1);
    t0=performance.now(); renderInk(); const eraseHitMs=performance.now()-t0;
    pg.strokes.length=0; _inkCacheDirty=true; renderInk();
    return JSON.stringify({idleMs, eraseHitMs, n:150});
  })()`);
  console.log("DIAG:", res);
  const d=JSON.parse(res);
  console.log("橡皮划过没擦到笔的帧 renderInk:", d.idleMs.toFixed(2), "ms (应≈0,只贴位图)");
  console.log("橡皮真擦掉一条笔的帧 renderInk:", d.eraseHitMs.toFixed(1), "ms (全量重建,笔越多越贵)");
  return true;
};
