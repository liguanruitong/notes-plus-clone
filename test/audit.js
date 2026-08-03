// 全功能回归审计 v1.9.4：重点查 z-order/passthru/增量缓存改动可能波及的交互。
module.exports = async (cdp) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await cdp.eval(`(async function(){ if(!document.querySelector('#shelfGrid .nb-card')){ document.querySelector('#btnNewNotebook').click(); await new Promise(r=>setTimeout(r,150)); document.querySelector('#modalOk')&&document.querySelector('#modalOk').click(); await new Promise(r=>setTimeout(r,300)); } })()`);
  await sleep(300);
  await cdp.eval(`(function(){ const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click(); })()`);
  await sleep(600);

  const res = await cdp.eval(`(async function(){
    const R={};
    const ink=document.querySelector('#ink'); const rect=ink.getBoundingClientRect();
    const z=(typeof zoom!=='undefined')?zoom:1;
    function ev(el,type,lx,ly,extra){ return el.dispatchEvent(new PointerEvent(type,Object.assign({clientX:rect.left+lx*z,clientY:rect.top+ly*z,button:0,pointerId:1,pointerType:'pen',pressure:0.5,isPrimary:true,bubbles:true,cancelable:true},extra||{}))); }
    function strokeGesture(pts){ tool='pen'; selectTool('pen'); ev(ink,'pointerdown',pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++) ev(ink,'pointermove',pts[i][0],pts[i][1]); ev(ink,'pointerup',pts[pts.length-1][0],pts[pts.length-1][1]); }

    // ① 普通笔书写→进 strokes
    const pg=curPage(); pg.strokes.length=0; _inkCacheDirty=true; renderInk();
    strokeGesture([[100,100],[140,120],[180,110],[220,130]]);
    R.penDraw = pg.strokes.length;   // 期望>=1

    // ② 荧光笔
    selectTool('highlighter'); tool='highlighter';
    ev(ink,'pointerdown',300,100); ev(ink,'pointermove',360,110); ev(ink,'pointerup',360,110);
    R.hlDraw = pg.strokes.filter(s=>s.tool==='highlighter').length;   // 期望>=1

    // ③ undo/redo 与增量缓存一致：撤销后条数-1，重做后+1，且像素一致
    const nBefore=pg.strokes.length;
    undo(); const nAfterUndo=pg.strokes.length;
    redo(); const nAfterRedo=pg.strokes.length;
    R.undo = (nAfterUndo===nBefore-1); R.redo=(nAfterRedo===nBefore);

    // ④ 图形识别：画一个近似矩形闭合，shape 工具应识别
    selectTool('shape'); tool='shape';
    ev(ink,'pointerdown',400,400); ev(ink,'pointermove',600,400); ev(ink,'pointermove',600,520); ev(ink,'pointermove',400,520); ev(ink,'pointermove',400,400); ev(ink,'pointerup',400,400);
    R.shape = pg.strokes.length; R.shapeLast = pg.strokes.length?(pg.strokes[pg.strokes.length-1].shape||pg.strokes[pg.strokes.length-1].tool):null;

    // ⑤ 卡片：添加卡片
    const cardsBefore=document.querySelectorAll('#cardLayer .card-note').length;
    if (typeof addCard==='function') addCard(); else { document.querySelector('#btnMore')&&document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,100)); const cc=document.querySelector('#toolGrid .tool-cell[data-tool=card]'); cc&&cc.click(); }
    await new Promise(r=>setTimeout(r,200));
    const cardsAfter=document.querySelectorAll('#cardLayer .card-note').length;
    R.cardAdd = cardsAfter>cardsBefore;

    // ⑥ 卡片手写(v1.9.1功能)：pen 工具下卡片不拦指针→ink 能收；卡片层非 lassoTop、ink 非 passthru
    selectTool('pen'); tool='pen';
    R.penInkNotPassthru = !ink.classList.contains('passthru');
    R.penCardNotTop = !((document.querySelector('#cardLayer')||{classList:{contains:()=>false}}).classList.contains('lassoTop'));
    // 在卡片区域上书写应落进 strokes
    const cardEl=document.querySelector('#cardLayer .card-note');
    let onCardDrew=false;
    if(cardEl){ const cr=cardEl.getBoundingClientRect(); const lx=(cr.left+cr.width/2-rect.left)/z, ly=(cr.top+cr.height/2-rect.top)/z; const n0=pg.strokes.length; ev(ink,'pointerdown',lx,ly); ev(ink,'pointermove',lx+30,ly+10); ev(ink,'pointerup',lx+30,ly+10); onCardDrew=pg.strokes.length>n0; }
    R.cardHandwrite = onCardDrew;

    // ⑦ 套索下卡片可拖(卡片提到 ink 上方且 pointer-events auto)
    selectTool('lasso'); tool='lasso';
    R.lassoCardTop = (document.querySelector('#cardLayer')||{classList:{contains:()=>false}}).classList.contains('lassoTop');
    const cardEl2=document.querySelector('#cardLayer .card-note');
    R.lassoCardPE = cardEl2 ? getComputedStyle(cardEl2).pointerEvents!=='none' : 'nocard';

    // ⑧ 文本工具：ink 应 passthru（让文本层收事件）
    selectTool('text'); tool='text';
    R.textInkPassthru = ink.classList.contains('passthru');
    R.textLayerPE = getComputedStyle(document.querySelector('#textLayer')).pointerEvents;

    // ⑨ 清页 + 切页缓存正确（切回来墨迹在）
    selectTool('pen'); tool='pen'; pg.strokes.length=0; _inkCacheDirty=true; renderInk();
    strokeGesture([[150,150],[250,160]]);
    const cntP0=pg.strokes.length;
    if (typeof addPage==='function'){ addPage(); } // 新页
    await new Promise(r=>setTimeout(r,150));
    const onNewPageCount=curPage().strokes.length;   // 新页应为空
    // 切回第1页
    if (typeof setActivePage==='function'){ setActivePage(0); await new Promise(r=>setTimeout(r,150)); }
    const backCount=curPage().strokes.length;
    R.pageSwitch = (onNewPageCount===0 && backCount===cntP0);

    // 复位
    tool='pen'; selectTool('pen'); curPage().strokes.length=0; _inkCacheDirty=true; renderInk();
    return JSON.stringify(R);
  })()`);
  console.log("AUDIT:", res);
  const d=JSON.parse(res);
  const checks=[
    ["普通笔书写进strokes", d.penDraw>=1],
    ["荧光笔书写", d.hlDraw>=1],
    ["撤销-1", d.undo===true],
    ["重做+1", d.redo===true],
    ["图形工具产生笔", d.shape>=1],
    ["卡片添加", d.cardAdd===true],
    ["笔模式ink不passthru", d.penInkNotPassthru===true],
    ["笔模式卡片不在ink上方", d.penCardNotTop===true],
    ["卡片上能手写(v191功能)", d.cardHandwrite===true],
    ["套索下卡片提到ink上方", d.lassoCardTop===true],
    ["套索下卡片可点(pointer-events)", d.lassoCardPE===true || d.lassoCardPE==='nocard'],
    ["文本工具ink passthru", d.textInkPassthru===true],
    ["文本层能收事件", d.textLayerPE!=='none'],
    ["切页缓存正确(新页空/切回墨迹在)", d.pageSwitch===true],
  ];
  let pass=true; for(const [n,ok] of checks){console.log((ok?"PASS ":"FAIL ")+n, (ok?"":JSON.stringify(d))); if(!ok)pass=false;}
  console.log("AUDIT_PASS="+pass);
  return pass;
};
