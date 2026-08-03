// v1.9.4 橡皮不卡验收：满页 150 条笔，模拟真实橡皮拖动（onDown→多次 eraseAt→onUp）。
// 拖动中每次 eraseAt(含命中删除)应恒定小成本(<16ms,不再 670ms)；抬笔一次性重建可慢。
// 并验正确性：被擦的笔抬笔后消失、没擦的仍在。
module.exports = async (cdp) => {
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 800));
  const res = await cdp.eval(`(function(){
    const pg=curPage();
    function mk(k){const y=60+(k%40)*40,x0=60+Math.floor(k/40)*260,pts=[];for(let i=0;i<25;i++){const t=i/24;pts.push({x:x0+t*240,y:y,p:0.5});}return {tool:'pen',color:'#222222',size:6,opacity:1,pWidth:true,pWidthAmt:0.5,pAlpha:true,pAlphaAmt:0.5,points:pts};}
    pg.strokes.length=0; for(let k=0;k<150;k++) pg.strokes.push(mk(k));
    _inkCacheDirty=true; renderInk();               // 满页烘焙
    // 记录第 50 条(k=50)所在行 y，等下横扫这一行把它擦掉
    const kTarget=50, ty=60+(kTarget%40)*40, tx0=60+Math.floor(kTarget/40)*260;
    const before=ictx.getImageData(tx0+120, ty, 1,1).data[3];   // 该笔中点墨迹

    // 切橡皮，模拟拖动：onDown 在该行起点，然后沿该行 eraseAt 多次
    tool='eraser'; eraserMode='whole'; drawing=true; _erasing=true; erasedThisStroke=false;
    let maxFrame=0, frames=0, sum=0;
    for(let x=tx0-20; x<=tx0+260; x+=12){
      const pt={x, y:ty};
      const t0=performance.now(); eraseAt(pt); const dt=performance.now()-t0;
      maxFrame=Math.max(maxFrame,dt); sum+=dt; frames++;
    }
    const avgFrame=sum/frames;
    // 抬笔：一次性重建
    _erasing=false; if(typeof _eraseRAF!=='undefined'&&_eraseRAF){cancelAnimationFrame(_eraseRAF);_eraseRAF=0;}
    if(erasedThisStroke) _inkCacheDirty=true;
    const tUp0=performance.now(); renderInk(); const upMs=performance.now()-tUp0;
    const afterTarget=ictx.getImageData(tx0+120, ty, 1,1).data[3];       // 被擦的笔→应≈0
    // 另一条没擦的笔(k=0)应还在
    const other=ictx.getImageData(60+120, 60, 1,1).data[3];
    drawing=false; erasedThisStroke=false; tool='pen';
    pg.strokes.length=0; _inkCacheDirty=true; renderInk();
    return JSON.stringify({before, maxFrame, avgFrame, frames, upMs, afterTarget, other});
  })()`);
  console.log("DIAG:", res);
  const d=JSON.parse(res);
  console.log("满页橡皮拖动 "+d.frames+" 帧: 每帧最大", d.maxFrame.toFixed(2), "ms 平均", d.avgFrame.toFixed(2), "ms");
  console.log("抬笔一次性重建:", d.upMs.toFixed(1), "ms");
  console.log("被擦笔 alpha:", d.before, "→", d.afterTarget, " | 没擦的笔 alpha:", d.other);
  const checks=[
    ["拖动中每帧<16ms(不卡)", d.maxFrame < 16],
    ["被擦的笔消失(alpha<30)", d.before>40 && d.afterTarget<30],
    ["没擦的笔还在(alpha>40)", d.other>40],
  ];
  let pass=true; for(const [n,ok] of checks){console.log((ok?"PASS ":"FAIL ")+n); if(!ok)pass=false;}
  console.log("PASS="+pass);
  return pass;
};
