// v1.6.0 自测：曲线平滑 / 透明度+压感 UI / 扩展纸张（笔迹不动）/ 主题色
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

  // ── 需求1：曲线平滑 —— strokePath 渲染必须用 quadraticCurveTo，且不再用 lineTo 拼折线（≥3点时）
  R.smooth = JSON.parse(await cdp.eval(`JSON.stringify(window.__np_smoothProbe())`));

  // 画一条多采样点连笔，确认采样点未被改动/丢弃（质感不变）
  R.stroke = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,100));
    // 选普通笔
    const cell=document.querySelector('#toolGrid .tool-cell[data-tool="pen"]'); if(cell) cell.click();
    document.querySelector('#morePanel').classList.add('hidden');
    const ink=document.querySelector('#ink'); const r=ink.getBoundingClientRect();
    const pe=(t,x,y)=>ink.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pressure:.5,isPrimary:true}));
    const bx=r.left+r.width*0.3, by=r.top+r.height*0.3;
    pe('pointerdown',bx,by);
    for(let i=1;i<=12;i++) pe('pointermove', bx+Math.cos(i)*30+i*4, by+Math.sin(i)*30);
    pe('pointerup', bx+60, by);
    await new Promise(r=>setTimeout(r,120));
    const s=window.__np_strokes();
    return JSON.stringify({strokes:s.length, pts:s[s.length-1]});
  })()`));

  // ── 需求2：透明度滑块 + 压感强度控件存在，且可操作
  R.penfx = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,120));
    // 打开笔编辑面板
    const mp=document.querySelector('#myPens .pen'); if(mp) mp.click();
    await new Promise(r=>setTimeout(r,120));
    const has=(id)=>!!document.querySelector(id);
    const ui={ opacity:has('#opacityRange'), pWidthToggle:has('#pWidthToggle'), pWidthAmt:has('#pWidthAmt'), pAlphaToggle:has('#pAlphaToggle'), pAlphaAmt:has('#pAlphaAmt') };
    // 操作：透明度设 50%，开启透明度压感，强度 80%
    const or=document.querySelector('#opacityRange'); or.value=50; or.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#pAlphaToggle').click();
    const aa=document.querySelector('#pAlphaAmt'); aa.value=80; aa.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#morePanel').classList.add('hidden');
    const fx=window.__np_penFx();
    return JSON.stringify({ui, fx});
  })()`));

  // ── 需求3：扩展纸张 —— 记录首笔坐标，向下+向右扩展应不动；向上/向左扩展内容整体平移，纸变大
  R.expand = JSON.parse(await cdp.eval(`(async function(){
    const before=window.__np_pageSize(); const beforeXY=window.__np_firstStrokeXY();
    // 向下扩展 500、向右扩展 300：笔迹坐标应完全不变
    window.__np_expandDownRight = 1;
    expandPaper(0,500,0,300);
    await new Promise(r=>setTimeout(r,120));
    const afterD=window.__np_pageSize(); const afterDXY=window.__np_firstStrokeXY();
    // 再向上扩展 200、向左 100：内容应整体 +100x,+200y（纸上位置不变）
    expandPaper(200,0,100,0);
    await new Promise(r=>setTimeout(r,120));
    const afterU=window.__np_pageSize(); const afterUXY=window.__np_firstStrokeXY();
    return JSON.stringify({before, beforeXY, afterD, afterDXY, afterU, afterUXY});
  })()`));

  // ── 需求5：主题色 —— 改成橙色，--theme-color / --accent 跟随
  R.theme = JSON.parse(await cdp.eval(`(async function(){
    setThemeColor('#FF9500');
    await new Promise(r=>setTimeout(r,60));
    return JSON.stringify(window.__np_themeColor());
  })()`));

  console.log("V16 RESULTS:", JSON.stringify(R, null, 2));

  const smoothOK = R.smooth.usedQuadratic && !R.smooth.usedLineTo;
  const strokeOK = R.stroke.strokes >= 1 && R.stroke.pts >= 12;   // 采样点全部保留（未被平均/抽稀）
  const penfxOK = R.penfx.ui.opacity && R.penfx.ui.pWidthToggle && R.penfx.ui.pWidthAmt && R.penfx.ui.pAlphaToggle && R.penfx.ui.pAlphaAmt
    && Math.abs(R.penfx.fx.opacity - 0.5) < 0.01 && R.penfx.fx.pAlphaOn === true && Math.abs(R.penfx.fx.pAlphaAmt - 0.8) < 0.01;
  // 向下/右扩展：尺寸变大，画布随之变大，笔迹坐标不动
  const downOK = R.expand.afterD.w === R.expand.before.w + 300 && R.expand.afterD.h === R.expand.before.h + 500
    && R.expand.afterD.cw === R.expand.afterD.w && R.expand.afterD.ch === R.expand.afterD.h
    && Math.abs(R.expand.afterDXY.x - R.expand.beforeXY.x) < 0.5 && Math.abs(R.expand.afterDXY.y - R.expand.beforeXY.y) < 0.5;
  // 向上/左扩展：尺寸再变大，内容整体平移 +100x/+200y（纸上视觉位置不变）
  const upOK = R.expand.afterU.w === R.expand.afterD.w + 100 && R.expand.afterU.h === R.expand.afterD.h + 200
    && Math.abs(R.expand.afterUXY.x - (R.expand.afterDXY.x + 100)) < 0.5 && Math.abs(R.expand.afterUXY.y - (R.expand.afterDXY.y + 200)) < 0.5;
  const themeOK = R.theme.css.toLowerCase() === "#ff9500" && R.theme.accent.toLowerCase() === "#ff9500";

  const pass = smoothOK && strokeOK && penfxOK && downOK && upOK && themeOK;
  console.log("CHECKS:", JSON.stringify({smoothOK, strokeOK, penfxOK, downOK, upOK, themeOK}));
  console.log("V16_PASS=", pass);
  return pass;
};
