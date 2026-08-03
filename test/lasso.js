// 套索修复验收(v1.9.1 回归):套索工具下 #ink 必须能收指针(不能 passthru),否则点了没反应。
// 并验:真实 pointerdown 派发到 ink 能起套索;卡片/图片层在套索下提到 ink 上方(.lassoTop)。
module.exports = async (cdp) => {
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 800));
  const res = await cdp.eval(`(function(){
    const pg=curPage(); pg.strokes.length=0;
    function mk(x0,y0){const pts=[];for(let i=0;i<10;i++){const t=i/9;pts.push({x:x0+t*80,y:y0+t*20,p:0.5});}return {tool:'pen',color:'#222',size:5,opacity:1,points:pts};}
    pg.strokes.push(mk(100,100), mk(120,140), mk(600,600));
    _inkCacheDirty=true; renderInk();

    // 切套索
    selectTool('lasso');
    const inkPassthru = ink.classList.contains('passthru');       // 必须 false
    const inkPE = getComputedStyle(ink).pointerEvents;            // 必须 != none
    const cardTop = ($('#cardLayer')||{classList:{contains:()=>false}}).classList.contains('lassoTop');
    const imgTop  = ($('#imageLayer')||{classList:{contains:()=>false}}).classList.contains('lassoTop');

    // 真实事件：用 ink 的屏幕坐标反推一个 clientX/Y,dispatch pointerdown/move/up 走真实链路
    clearSelection();
    const rect = ink.getBoundingClientRect();
    // 逻辑坐标→屏幕坐标: 需经 zoom/pan。用现成 toLogical 反过来难;改为直接在 ink 上 dispatch 几个点,
    // 由 onDown/onMove 内部 toLogical 转;我们框一个大圈覆盖左上两条笔(逻辑80~260),
    // 屏幕坐标≈ rect.left + logical*zoom + panX。读取变量:
    const z=(typeof zoom!=='undefined')?zoom:1;
    function scr(lx,ly){ return { cx: rect.left + lx*z, cy: rect.top + ly*z }; }
    function ev(type,lx,ly){ const s=scr(lx,ly); return new PointerEvent(type,{clientX:s.cx,clientY:s.cy,button:0,pointerId:1,pointerType:'pen',isPrimary:true,bubbles:true}); }
    ink.dispatchEvent(ev('pointerdown',80,80));
    const startedLasso = !!lassoPts;
    [[260,80],[260,220],[80,220],[80,80]].forEach(([x,y])=>ink.dispatchEvent(ev('pointermove',x,y)));
    ink.dispatchEvent(new PointerEvent('pointerup',{button:0,pointerId:1,pointerType:'pen',isPrimary:true,bubbles:true}));
    const selCount = sel ? sel.strokes.length : 0;

    tool='pen'; clearSelection(); pg.strokes.length=0; _inkCacheDirty=true; renderInk();
    return JSON.stringify({inkPassthru, inkPE, cardTop, imgTop, startedLasso, selCount});
  })()`);
  console.log("DIAG:", res);
  const d=JSON.parse(res);
  console.log("套索下 ink.passthru:", d.inkPassthru, " pointer-events:", d.inkPE);
  console.log("卡片层 lassoTop:", d.cardTop, " 图片层 lassoTop:", d.imgTop);
  console.log("真实事件起套索:", d.startedLasso, " 框选选中笔数:", d.selCount, "(期望2)");
  const checks=[
    ["套索下 ink 不 passthru", d.inkPassthru===false],
    ["套索下 ink 能收指针(pointer-events!=none)", d.inkPE!=='none'],
    ["卡片层提到 ink 上方", d.cardTop===true],
    ["图片层提到 ink 上方", d.imgTop===true],
    ["真实 pointerdown 能起套索", d.startedLasso===true],
    ["框选选中正确笔数(2)", d.selCount===2],
  ];
  let pass=true; for(const [n,ok] of checks){console.log((ok?"PASS ":"FAIL ")+n); if(!ok)pass=false;}
  console.log("PASS="+pass);
  return pass;
};
