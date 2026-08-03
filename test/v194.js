// v1.9.4 验收：增量墨迹缓存——满页提交新笔的成本与笔数解耦、增量==全量、删除自动触发重建、橡皮空拖不卡。
module.exports = async (cdp) => {
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 800));
  const res = await cdp.eval(`(function(){
    const pg = curPage();
    function mkStroke(k){
      const y=60+(k%40)*40, x0=60+Math.floor(k/40)*260, pts=[];
      for(let i=0;i<25;i++){const t=i/24; pts.push({x:x0+t*240,y:y+Math.sin(t*6)*8,p:0.15+0.7*Math.abs(Math.sin(t*3))});}
      return {tool:'pen',color:'#222222',size:5,opacity:1,pWidth:true,pWidthAmt:0.5,pAlpha:true,pAlphaAmt:0.5,points:pts};
    }
    // ① 性能：满页 150 条 → 提交第 151 条 → renderInk 单次耗时（增量应只画这一条，远小于全量）
    pg.strokes.length=0; for(let k=0;k<150;k++) pg.strokes.push(mkStroke(k));
    _inkCacheDirty=true; buildInkCache();               // 先全量烘焙好 150 条
    pg.strokes.push(mkStroke(150));                      // 第 151 条新笔
    let t0=performance.now(); renderInk(); const incrMs=performance.now()-t0;
    // 对照：强制全量重建一次的耗时
    t0=performance.now(); _inkCacheDirty=true; renderInk(); const fullMs=performance.now()-t0;

    // ② applyTransform 回归确认（本来就快）
    let ta=0; for(let i=0;i<5;i++){const s=performance.now(); applyTransform(); ta+=performance.now()-s;} const applyMs=ta/5;

    // ③ 正确性：增量缓存 vs 全量重建，逐点像素 alpha 比较（采样 400 点）
    function samplePts(){ const a=[]; for(let i=0;i<400;i++) a.push([(i*131)%PW,(i*197)%PH]); return a; }
    const SP=samplePts();
    function sample(){ return SP.map(([x,y])=>ictx.getImageData(x,y,1,1).data[3]); }
    pg.strokes.length=0; for(let k=0;k<151;k++) pg.strokes.push(mkStroke(k));
    _inkCacheDirty=true; renderInk(); const full=sample();     // 全量
    // 增量路径：清空重来，一条条 push+renderInk 累积（走 commitNewStrokesToCache 增量分支）
    const all=pg.strokes.slice();
    pg.strokes.length=0; _inkCacheDirty=true; renderInk();
    for(const s of all){ pg.strokes.push(s); renderInk(); }
    const incr=sample();
    let pixMax=0; for(let i=0;i<full.length;i++) pixMax=Math.max(pixMax,Math.abs(full[i]-incr[i]));

    // ④ 删除【自动】触发重建：删掉中间某条(splice) 后【不手动标脏】，靠 count>length 兜底重建，墨迹应消失
    pg.strokes.length=0; for(let k=0;k<10;k++) pg.strokes.push(mkStroke(k));
    _inkCacheDirty=true; renderInk();
    function maxAround(cx,cy){ let m=0; for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const d=ictx.getImageData(cx+dx,cy+dy,1,1).data[3]; if(d>m)m=d;} return m; }
    const vx=180, vy=60+4*40;                            // 第5条(k=4)中段位置
    const before=maxAround(vx,vy);
    pg.strokes.splice(4,1); renderInk();                 // 关键：不手动 _inkCacheDirty，验证渲染层自动兜底
    const after=maxAround(vx,vy);

    // ⑤ 橡皮空拖不卡：满页 150 条，橡皮在大片留白处拖 20 帧（碰不到笔）→ strokes 不变、每帧成本低
    pg.strokes.length=0; for(let k=0;k<150;k++) pg.strokes.push(mkStroke(k));
    _inkCacheDirty=true; buildInkCache();
    erasedThisStroke=false;
    const blank={x:PW-15,y:PH-15};
    const sBefore=pg.strokes.length; let eraseTotal=0;
    for(let f=0;f<20;f++){ const s=performance.now(); eraseAt(blank); eraseTotal+=performance.now()-s; }
    const sAfter=pg.strokes.length, eraseAvg=eraseTotal/20;

    pg.strokes.length=0; _inkCacheDirty=true; renderInk();
    return JSON.stringify({incrMs, fullMs, applyMs, pixMax, before, after, sBefore, sAfter, eraseAvg});
  })()`);
  console.log("DIAG:", res);
  const d=JSON.parse(res);
  console.log("满页(150)提交新笔 renderInk 增量:", d.incrMs.toFixed(1), "ms  |  强制全量:", d.fullMs.toFixed(1), "ms");
  console.log("applyTransform:", d.applyMs.toFixed(2), "ms");
  console.log("增量 vs 全量 像素alpha最大差:", d.pixMax);
  console.log("删除前该位置maxAlpha:", d.before, " 删除后:", d.after, "(未手动标脏,靠渲染层自动重建)");
  console.log("橡皮空拖 20 帧: strokes", d.sBefore, "->", d.sAfter, " 平均每帧", d.eraseAvg.toFixed(2), "ms");
  const checks=[
    ["满页提交新笔 <30ms(增量)", d.incrMs < 30],
    ["增量确实比全量快(<全量一半)", d.incrMs < d.fullMs*0.5],
    ["applyTransform <5ms", d.applyMs < 5],
    ["增量==全量(像素差<=2)", d.pixMax <= 2],
    ["删除后墨迹消失(前>40 后<10)", d.before > 40 && d.after < 10],
    ["橡皮空拖不改strokes", d.sAfter === d.sBefore],
    ["橡皮空拖每帧<5ms", d.eraseAvg < 5],
  ];
  let pass=true; for(const [n,ok] of checks){ console.log((ok?"PASS ":"FAIL ")+n); if(!ok) pass=false; }
  console.log("PASS="+pass);
  return pass;
};
