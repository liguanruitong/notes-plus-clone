// v1.9.1 验证：coalesced 采样、轻量实时预览、橡皮帧合并、字号浮条、卡片手写图层。
module.exports = async (cdp) => {
  const results = {};
  // 进编辑器
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 700));
  results.editorVisible = await cdp.eval("!document.querySelector('#editor').classList.contains('hidden')");

  // 1. coalescedLogical 函数存在
  results.hasCoalesced = await cdp.eval("typeof coalescedLogical === 'function'");
  // 2. 轻量实时预览函数存在
  results.hasLive = await cdp.eval("typeof strokePathLive === 'function'");
  // 3. 橡皮帧合并调度器存在
  results.hasEraseRAF = await cdp.eval("typeof scheduleEraseRedraw === 'function'");
  // 4. 字号浮条 API 存在
  results.hasFontBar = await cdp.eval("typeof showFontBar==='function' && typeof bumpFont==='function' && !!document.querySelector('#fontBar')");

  // 5. 模拟画一笔（多点）→ 存进 strokes，验证不折线（点数应等于喂入点数）
  await cdp.eval("selectTool('pen')");
  const strokeTest = await cdp.eval(`(function(){
    drawing=true; cur={tool:'pen',color:'#111',size:3,points:[],opacity:1,pWidth:true,pWidthAmt:0.5,pAlpha:false,pAlphaAmt:0.5};
    for(let i=0;i<20;i++){ cur.points.push({x:100+i*5,y:100+Math.sin(i)*10,p:0.5}); }
    const n=cur.points.length; onUp();
    const strokes=curPage().strokes; const last=strokes[strokes.length-1];
    return JSON.stringify({fed:n, saved:last?last.points.length:0});
  })()`);
  results.stroke = strokeTest;

  // 6. 卡片：添加卡片 → 卡片层 interactive 逻辑（切到 pen 时 cardLayer 非 interactive、ink passthru 关）
  await cdp.eval("selectTool('text')");
  const cardCreate = await cdp.eval(`(async function(){
    await addCard();
    await new Promise(r=>setTimeout(r,100));
    return (curPage().cards||[]).length;
  })()`);
  results.cardCount = cardCreate;
  // 切到 text：cardLayer 应 interactive，ink 应 passthru
  await cdp.eval("selectTool('text')");
  results.textMode = await cdp.eval("JSON.stringify({cardInteractive:document.querySelector('#cardLayer').classList.contains('interactive'), inkPassthru:document.querySelector('#ink').classList.contains('passthru')})");
  // 切到 pen：cardLayer 非 interactive，ink 非 passthru（可在卡片上手写）
  await cdp.eval("selectTool('pen')");
  results.penMode = await cdp.eval("JSON.stringify({cardInteractive:document.querySelector('#cardLayer').classList.contains('interactive'), inkPassthru:document.querySelector('#ink').classList.contains('passthru')})");
  // z-index：ink 应高于 cardLayer（墨迹显示在卡片上方）
  results.zorder = await cdp.eval("JSON.stringify({ink:getComputedStyle(document.querySelector('#ink')).zIndex, card:getComputedStyle(document.querySelector('#cardLayer')).zIndex, cover:getComputedStyle(document.querySelector('#coverLayer')).zIndex})");

  // 7. 卡片字号：给卡片 body 聚焦→bumpFont→fontSize 改变
  const cardFont = await cdp.eval(`(function(){
    const body=document.querySelector('#cardLayer .card-body'); if(!body) return 'no-body';
    body.focus();
    const before=_fontTarget?_fontTarget.size():null;
    bumpFont(4);
    const after=_fontTarget?_fontTarget.size():null;
    const px=body.style.fontSize;
    return JSON.stringify({before,after,px, barShown:!document.querySelector('#fontBar').classList.contains('hidden')});
  })()`);
  results.cardFont = cardFont;

  console.log(JSON.stringify(results, null, 2));
  const st = JSON.parse(results.stroke);
  const tm = JSON.parse(results.textMode), pm = JSON.parse(results.penMode), zo = JSON.parse(results.zorder);
  const cf = JSON.parse(results.cardFont);
  const pass = results.editorVisible && results.hasCoalesced && results.hasLive && results.hasEraseRAF && results.hasFontBar
    && st.fed === st.saved && st.saved === 20
    && results.cardCount >= 1
    && tm.cardInteractive === true && tm.inkPassthru === true
    && pm.cardInteractive === false && pm.inkPassthru === false
    && (+zo.ink > +zo.card) && (+zo.cover > +zo.ink)
    && cf.after === cf.before + 4 && cf.barShown === true;
  console.log("PASS=", pass);
  return pass;
};
