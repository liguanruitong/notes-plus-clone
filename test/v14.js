// v1.4.0 自测：截图笔 / 复制后选中新副本 / 批量编辑笔 / 笔盒自定义
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

  // ── 1. 截图笔：先画一笔留内容，选截图笔框选→底部出预览→点击插入→再截一张→×删除 ──
  R.shot = JSON.parse(await cdp.eval(`(async function(){
    const ink=document.querySelector('#ink'); const r=ink.getBoundingClientRect();
    const pe=(t,x,y)=>ink.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pressure:.5,isPrimary:true}));
    // 用画笔画点东西
    document.querySelector('#toolGrid') && document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,80));
    document.querySelector('#toolGrid .tool-cell[data-tool="pen"]').click(); await new Promise(r=>setTimeout(r,80));
    let x0=r.left+r.width*0.3,y0=r.top+r.height*0.3;
    pe('pointerdown',x0,y0); for(let i=1;i<=8;i++) pe('pointermove',x0+i*10,y0+i*6); pe('pointerup',x0+80,y0+48);
    await new Promise(r=>setTimeout(r,120));
    // 选截图笔
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,80));
    document.querySelector('#toolGrid .tool-cell[data-tool="shot"]').click(); await new Promise(r=>setTimeout(r,100));
    const toolIsShot = window.__np_tool ? window.__np_tool()==='shot' : true;
    // 框选一块
    let sx=r.left+r.width*0.25,sy=r.top+r.height*0.25,ex=r.left+r.width*0.6,ey=r.top+r.height*0.5;
    pe('pointerdown',sx,sy); pe('pointermove',ex,ey); pe('pointerup',ex,ey);
    await new Promise(r=>setTimeout(r,200));
    const tray=document.querySelector('#shotTray');
    const trayShown = !tray.classList.contains('hidden');
    const count1 = document.querySelectorAll('#shotTray .shot-item').length;
    // 点第一个预览插入
    const first=document.querySelector('#shotTray .shot-item'); if(first) first.click();
    await new Promise(r=>setTimeout(r,200));
    const imgs1 = document.querySelectorAll('#imageLayer .img-obj').length;
    // 再截一张（连续）
    pe('pointerdown',sx,sy+20); pe('pointermove',ex,ey+20); pe('pointerup',ex,ey+20);
    await new Promise(r=>setTimeout(r,180));
    const count2 = document.querySelectorAll('#shotTray .shot-item').length;
    // ×删除一个预览
    const del=document.querySelector('#shotTray .shot-item .shot-del'); if(del) del.click();
    await new Promise(r=>setTimeout(r,120));
    const count3 = document.querySelectorAll('#shotTray .shot-item').length;
    return JSON.stringify({toolIsShot, trayShown, count1, imgs1, count2, count3});
  })()`));

  // ── 2. 复制后选中新副本：套索选中→复制→sel 应指向新副本 ──
  R.dup = JSON.parse(await cdp.eval(`(async function(){
    const ink=document.querySelector('#ink'); const r=ink.getBoundingClientRect();
    const pe=(t,x,y)=>ink.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pressure:.5,isPrimary:true}));
    const before = window.__np_strokes().length;
    // 套索工具
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,80));
    document.querySelector('#toolGrid .tool-cell[data-tool="lasso"]').click(); await new Promise(r=>setTimeout(r,100));
    // 圈住刚才画笔那笔（左上区域）
    const cx=r.left+r.width*0.42, cy=r.top+r.height*0.36, rad=r.width*0.28;
    pe('pointerdown',cx-rad,cy-rad);
    for(let a=0;a<=Math.PI*2+0.1;a+=Math.PI/8) pe('pointermove',cx+Math.cos(a)*rad,cy+Math.sin(a)*rad);
    pe('pointerup',cx-rad,cy-rad);
    await new Promise(r=>setTimeout(r,150));
    const selectedBefore = window.__np_selInfo();
    // 点“复制”
    const dupBtn=document.querySelector('#selDup'); const barShown=!document.querySelector('#selBar').classList.contains('hidden');
    if(dupBtn) dupBtn.click();
    await new Promise(r=>setTimeout(r,180));
    const after = window.__np_strokes().length;
    const selAfter = window.__np_selInfo();
    // 新副本应偏移 +24；selAfter 的首笔第一个点应比 selBefore 大约 +24
    return JSON.stringify({before, after, barShown, selBefore:selectedBefore, selAfter, grew: after>before, selIsNew: selAfter && selectedBefore && Math.abs(selAfter.x0 - (selectedBefore.x0+24))<3 });
  })()`));

  // ── 3. 批量编辑笔：打开面板→全选→改色/粗细→应用 ──
  R.multi = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,80));
    document.querySelector('#btnMultiEdit').click(); await new Promise(r=>setTimeout(r,120));
    const open=!document.querySelector('#penMultiEditor').classList.contains('hidden');
    const penCount=document.querySelectorAll('#pmePens .pme-pen').length;
    document.querySelector('#pmeSelAll').click(); await new Promise(r=>setTimeout(r,60));
    const selCount=document.querySelectorAll('#pmePens .pme-pen.sel').length;
    // 设颜色红、粗细 9
    const ci=document.querySelector('#pmeColor'); ci.value='#e2453b'; ci.dispatchEvent(new Event('input',{bubbles:true}));
    const sr=document.querySelector('#pmeSize'); sr.value='9'; sr.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#pmeApply').click(); await new Promise(r=>setTimeout(r,120));
    const applied = window.__np_pens();
    document.querySelector('#pmeDone').click();
    const allRed = applied.every(p=>p.color.toLowerCase()==='#e2453b' && p.size===9);
    return JSON.stringify({open, penCount, selCount, applied, allRed});
  })()`));

  // ── 4. 笔盒自定义：打开→切换一个开关→完成→dock 变化 ──
  R.dock = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,80));
    document.querySelector('#btnEditDock').click(); await new Promise(r=>setTimeout(r,120));
    const open=!document.querySelector('#dockEditor').classList.contains('hidden');
    const rows=document.querySelectorAll('#deList .de-row').length;
    const dockBefore=document.querySelectorAll('#dockTools .tool').length;
    // 找到“计算器”那行，打开开关（放进笔盒）
    let toggled=false;
    document.querySelectorAll('#deList .de-row').forEach(row=>{
      if(row.querySelector('.de-name').textContent==='计算器'){ const t=row.querySelector('.de-toggle'); if(!t.classList.contains('on')){ t.click(); toggled=true; } }
    });
    await new Promise(r=>setTimeout(r,80));
    document.querySelector('#deSave').click(); await new Promise(r=>setTimeout(r,120));
    const dockAfter=document.querySelectorAll('#dockTools .tool').length;
    const hasCalc = !!document.querySelector('#dockTools .tool[data-tool="calc"]');
    return JSON.stringify({open, rows, dockBefore, toggled, dockAfter, hasCalc});
  })()`));

  console.log("V14 RESULTS:", JSON.stringify(R, null, 2));
  const pass =
    R.shot.trayShown && R.shot.count1===1 && R.shot.imgs1>=1 && R.shot.count2===2 && R.shot.count3===1 &&
    R.dup.grew && R.dup.selIsNew &&
    R.multi.open && R.multi.penCount>=2 && R.multi.selCount===R.multi.penCount && R.multi.allRed &&
    R.dock.open && R.dock.rows>=10 && R.dock.hasCalc && R.dock.dockAfter>R.dock.dockBefore;
  console.log("V14_PASS=", pass);
  return pass;
};
