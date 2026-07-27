// v1.6.1 自测：自定义快捷键 / 打开设置面板→点笔直接编辑 / 荧光笔整条一次性描边
module.exports = async (cdp) => {
  const R = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await cdp.eval(`(async function(){
    if(!document.querySelector('#shelfGrid .nb-card')){ document.querySelector('#btnNewNotebook').click(); await new Promise(r=>setTimeout(r,150)); document.querySelector('#modalOk').click(); await new Promise(r=>setTimeout(r,300)); }
  })()`);
  await sleep(300);
  await cdp.eval(`(function(){ const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click(); })()`);
  await sleep(600);

  // ── 需求2 交互修复：打开更多面板 → 点第2支笔 → 面板保持打开 & penEdit 显示 & activePen=1
  R.editFlow = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,150));
    const openedPanel = !document.querySelector('#morePanel').classList.contains('hidden');
    const pens=document.querySelectorAll('#myPens .pen');
    pens[1].click(); await new Promise(r=>setTimeout(r,150));
    const stillOpen = !document.querySelector('#morePanel').classList.contains('hidden');
    const editShown = !document.querySelector('#penEdit').classList.contains('hidden');
    const ap = window.__np_activePen();
    // 再点第1支笔，同样应保持打开、切到 activePen=0
    const pens2=document.querySelectorAll('#myPens .pen');
    pens2[0].click(); await new Promise(r=>setTimeout(r,120));
    const stillOpen2 = !document.querySelector('#morePanel').classList.contains('hidden');
    const ap2 = window.__np_activePen();
    return JSON.stringify({openedPanel, stillOpen, editShown, ap, stillOpen2, ap2});
  })()`));

  // ── 需求1 快捷键：给第2支笔（索引1）绑 "3"，按 "3" 应切到 activePen=1
  R.hotkey = JSON.parse(await cdp.eval(`(async function(){
    // 用绑定 UI 走一遍：先选中第2支笔并进入编辑，再进入捕获态并按 "3"
    const pens=document.querySelectorAll('#myPens .pen'); pens[1].click(); await new Promise(r=>setTimeout(r,120));
    document.querySelector('#penHotkeyBtn').click(); await new Promise(r=>setTimeout(r,60));
    const capturing = document.querySelector('#penHotkeyBtn').classList.contains('capturing');
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'3',bubbles:true}));
    await new Promise(r=>setTimeout(r,120));
    const bound = window.__np_pens()[1].hotkey;
    // 关闭面板，切到第1支笔，再按 "3" 应切回第2支
    document.querySelector('#morePanel').classList.add('hidden');
    window.usePen ? null : 0;
    // 先确保当前不是索引1
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,80));
    document.querySelectorAll('#myPens .pen')[0].click(); await new Promise(r=>setTimeout(r,80));
    document.querySelector('#morePanel').classList.add('hidden');
    const before = window.__np_activePen();
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'3',bubbles:true}));
    await new Promise(r=>setTimeout(r,120));
    const after = window.__np_activePen();
    return JSON.stringify({capturing, bound, before, after});
  })()`));

  // ── 快捷键冲突：默认 "1" 应仍能选第1支（"1" 未被自定义占用）；把 "1" 绑给第2支后按 "1" 切到第2支
  R.hkConflict = JSON.parse(await cdp.eval(`(async function(){
    // "1" 目前空闲 → 选第1支
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'1',bubbles:true})); await new Promise(r=>setTimeout(r,80));
    const defOne = window.__np_activePen();
    // 把 "1" 绑给第2支（索引1）
    window.__np_setHotkey(1, '1');
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'1',bubbles:true})); await new Promise(r=>setTimeout(r,80));
    const customOne = window.__np_activePen();
    // 复原
    window.__np_setHotkey(1, '3');
    return JSON.stringify({defOne, customOne});
  })()`));

  // ── 荧光笔渲染：半透明多采样点 stroke 只调用一次 ctx.stroke()
  R.hl = JSON.parse(await cdp.eval(`JSON.stringify(window.__np_hlStrokeProbe())`));

  console.log("V161 RESULTS:", JSON.stringify(R, null, 2));

  const editFlowOK = R.editFlow.openedPanel && R.editFlow.stillOpen && R.editFlow.editShown
    && R.editFlow.ap === 1 && R.editFlow.stillOpen2 && R.editFlow.ap2 === 0;
  const hotkeyOK = R.hotkey.capturing && R.hotkey.bound === "3" && R.hotkey.before === 0 && R.hotkey.after === 1;
  const conflictOK = R.hkConflict.defOne === 0 && R.hkConflict.customOne === 1;
  const hlOK = R.hl.alpha < 0.999 && R.hl.strokeCount === 1;

  const pass = editFlowOK && hotkeyOK && conflictOK && hlOK;
  console.log("CHECKS:", JSON.stringify({editFlowOK, hotkeyOK, conflictOK, hlOK}));
  console.log("V161_PASS=", pass);
  return pass;
};
