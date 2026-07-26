// 新功能自测：挖空笔 / 卡片 / 激光笔 / 计算器 / 计时器
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

  // 计算器：12+3*4=24? （表达式求值 12+3*4=24）
  R.calc = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,120));
    document.querySelector('#btnCalc').click(); await new Promise(r=>setTimeout(r,120));
    const open=!document.querySelector('#calcPanel').classList.contains('hidden');
    const k=(kk)=>document.querySelector('#calcKeys .ck[data-k="'+kk+'"]').click();
    ['1','2','+','3','*','4','='].forEach(k);
    const val=document.querySelector('#calcScreen').textContent;
    document.querySelector('#calcClose').click();
    return JSON.stringify({open, val});
  })()`));

  // 计时器：倒计时+1分=60s，开始后应递减
  R.timer = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,120));
    document.querySelector('#btnTimer').click(); await new Promise(r=>setTimeout(r,120));
    const open=!document.querySelector('#timerPanel').classList.contains('hidden');
    document.querySelector('#timerModeSeg .seg-btn[data-tm="countdown"]').click(); await new Promise(r=>setTimeout(r,60));
    document.querySelector('#timerSet .mini-btn[data-add="60"]').click();
    const set=document.querySelector('#timerDisplay').textContent;
    document.querySelector('#timerStart').click(); await new Promise(r=>setTimeout(r,1200));
    const after=document.querySelector('#timerDisplay').textContent;
    document.querySelector('#timerReset').click(); document.querySelector('#timerClose').click();
    return JSON.stringify({open, set, after});
  })()`));

  // 卡片：添加一张卡片
  R.card = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,120));
    document.querySelector('#toolGrid .tool-cell[data-tool="card"]').click(); await new Promise(r=>setTimeout(r,200));
    const cards=document.querySelectorAll('#cardLayer .card-note').length;
    return JSON.stringify({cards});
  })()`));

  // 挖空笔：画一个遮挡块，点击开合
  R.cover = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,120));
    document.querySelector('#toolGrid .tool-cell[data-tool="cover"]').click(); await new Promise(r=>setTimeout(r,120));
    const ink=document.querySelector('#ink'); const r=ink.getBoundingClientRect();
    const pe=(t,x,y)=>ink.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pressure:.5,isPrimary:true}));
    const x0=r.left+r.width*0.3, y0=r.top+r.height*0.3, x1=r.left+r.width*0.6, y1=r.top+r.height*0.45;
    pe('pointerdown',x0,y0); pe('pointermove',x1,y1); pe('pointerup',x1,y1);
    await new Promise(r=>setTimeout(r,150));
    const box=document.querySelector('#coverLayer .cover-box');
    const created=!!box; const closed = box && !box.classList.contains('open');
    if(box) box.click(); await new Promise(r=>setTimeout(r,80));
    const opened = box && box.classList.contains('open');
    return JSON.stringify({created, closed, opened});
  })()`));

  // 激光笔：画一笔，应产生淡出轨迹但不进 strokes（不留存）
  R.laser = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,120));
    document.querySelector('#toolGrid .tool-cell[data-tool="laser"]').click(); await new Promise(r=>setTimeout(r,120));
    const before=window.__np_strokes().length;
    const ink=document.querySelector('#ink'); const r=ink.getBoundingClientRect();
    const pe=(t,x,y)=>ink.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pressure:.5,isPrimary:true}));
    const x0=r.left+r.width*0.4, y=r.top+r.height*0.6;
    pe('pointerdown',x0,y); for(let i=1;i<=10;i++) pe('pointermove',x0+i*8,y); pe('pointerup',x0+80,y);
    const ov=document.querySelector('#overlay'); const oc=ov.getContext('2d');
    const d=oc.getImageData(0,0,ov.width,ov.height).data; let painted=0;
    for(let i=3;i<d.length;i+=4*397) if(d[i]>0) painted++;
    const after=window.__np_strokes().length;
    return JSON.stringify({painted:painted>0, notPersisted: after===before});
  })()`));

  console.log("FEATURE RESULTS:", JSON.stringify(R, null, 2));
  const pass =
    R.calc.open && R.calc.val === "24" &&
    R.timer.open && R.timer.set === "01:00" && R.timer.after !== "01:00" &&
    R.card.cards >= 1 &&
    R.cover.created && R.cover.closed && R.cover.opened &&
    R.laser.painted && R.laser.notPersisted;
  console.log("FEATURE_PASS=", pass);
  return pass;
};
