// v1.5.0 自测：截图插入后立即选中 / 竖向连续滚动多页 / 页间间隔开关
module.exports = async (cdp) => {
  const R = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 建/进笔记本
  await cdp.eval(`(async function(){
    if(!document.querySelector('#shelfGrid .nb-card')){ document.querySelector('#btnNewNotebook').click(); await new Promise(r=>setTimeout(r,150)); document.querySelector('#modalOk').click(); await new Promise(r=>setTimeout(r,300)); }
  })()`);
  await sleep(300);
  await cdp.eval(`(function(){ const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click(); })()`);
  await sleep(600);

  // ── 1. 截图笔：框选→底部预览→点击插入→应立刻选中（套索工具 + .img-obj.selected） ──
  R.shotSelect = JSON.parse(await cdp.eval(`(async function(){
    const ink=document.querySelector('#ink'); const r=ink.getBoundingClientRect();
    const pe=(t,x,y)=>ink.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pressure:.5,isPrimary:true}));
    // 画一笔留内容
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,80));
    document.querySelector('#toolGrid .tool-cell[data-tool="pen"]').click(); await new Promise(r=>setTimeout(r,80));
    let x0=r.left+r.width*0.3,y0=r.top+r.height*0.3;
    pe('pointerdown',x0,y0); for(let i=1;i<=8;i++) pe('pointermove',x0+i*10,y0+i*6); pe('pointerup',x0+80,y0+48);
    await new Promise(r=>setTimeout(r,100));
    // 截图笔框选
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,80));
    document.querySelector('#toolGrid .tool-cell[data-tool="shot"]').click(); await new Promise(r=>setTimeout(r,100));
    let sx=r.left+r.width*0.25,sy=r.top+r.height*0.25,ex=r.left+r.width*0.6,ey=r.top+r.height*0.5;
    pe('pointerdown',sx,sy); pe('pointermove',ex,ey); pe('pointerup',ex,ey);
    await new Promise(r=>setTimeout(r,200));
    // 点预览插入
    const first=document.querySelector('#shotTray .shot-item'); if(first) first.click();
    await new Promise(r=>setTimeout(r,250));
    const imgs = document.querySelectorAll('#imageLayer .img-obj').length;
    const toolNow = window.__np_tool ? window.__np_tool() : null;
    const selected = !!document.querySelector('#imageLayer .img-obj.selected');
    const interactive = document.querySelector('#imageLayer').classList.contains('interactive');
    // 选中后应有可见的缩放/删除手柄
    const selEl = document.querySelector('#imageLayer .img-obj.selected');
    const hasHandles = selEl && getComputedStyle(selEl.querySelector('.img-resize')).display !== 'none';
    return JSON.stringify({imgs, toolNow, selected, interactive, hasHandles});
  })()`));

  // ── 2. 竖向连续滚动多页：新增几页→主区域应有多个 page-slot→滚动改变活动页 ──
  R.scroll = JSON.parse(await cdp.eval(`(async function(){
    // 加到至少 4 页
    for(let i=0;i<3;i++){ document.querySelector('#btnAddPage').click(); await new Promise(r=>setTimeout(r,120)); }
    const slots = document.querySelectorAll('#pagesColumn .page-slot').length;
    const stage=document.querySelector('#stage');
    // 回到顶部，活动页应为第1页
    document.querySelector('#pagesColumn .page-slot[data-i="0"]').scrollIntoView();
    stage.scrollTop = 0; stage.dispatchEvent(new Event('scroll')); await new Promise(r=>setTimeout(r,120));
    const activeTop = window.__np_activePage ? window.__np_activePage() : null;
    // 滚到底部，活动页应变成最后一页
    stage.scrollTop = stage.scrollHeight; stage.dispatchEvent(new Event('scroll')); await new Promise(r=>setTimeout(r,250));
    const activeBottom = window.__np_activePage ? window.__np_activePage() : null;
    // 画布栈应对齐到活动页槽（top 匹配）
    const wrap=document.querySelector('#canvasWrap');
    const slot=document.querySelector('#pagesColumn .page-slot[data-i="'+activeBottom+'"]');
    const aligned = slot && Math.abs(wrap.offsetTop - slot.offsetTop) < 2;
    return JSON.stringify({slots, activeTop, activeBottom, scrollable: stage.scrollHeight > stage.clientHeight, aligned});
  })()`));

  // ── 3. 页间间隔开关：切「无间隔」相邻页 margin=0；切「大间隔」应变大 ──
  R.gap = JSON.parse(await cdp.eval(`(async function(){
    const seg=(g)=>{ document.querySelector('#btnMore').click(); return new Promise(res=>setTimeout(()=>{ document.querySelector('#pageGapSeg .seg-btn[data-gap="'+g+'"]').click(); document.querySelector('#btnMore').click(); setTimeout(res,120);},80)); };
    const marginOf = ()=>{ const s=document.querySelector('#pagesColumn .page-slot[data-i="1"]'); return parseFloat(getComputedStyle(s).marginTop); };
    await seg('0'); const m0=marginOf();
    await seg('60'); const mBig=marginOf();
    await seg('24'); const mMid=marginOf();
    return JSON.stringify({m0, mBig, mMid, ok: m0===0 && mBig>mMid && mMid>0});
  })()`));

  console.log("V15 RESULTS:", JSON.stringify(R, null, 2));
  const pass =
    R.shotSelect.imgs >= 1 && R.shotSelect.toolNow === 'lasso' && R.shotSelect.selected && R.shotSelect.interactive && R.shotSelect.hasHandles &&
    R.scroll.slots >= 4 && R.scroll.scrollable && R.scroll.activeTop === 0 && R.scroll.activeBottom === R.scroll.slots - 1 && R.scroll.aligned &&
    R.gap.ok;
  console.log("V15_PASS=", pass);
  return pass;
};
