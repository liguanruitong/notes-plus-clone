// 综合自测 v1.3.0：两种笔 / 文件夹透明底 / 像素局部擦除 / 新功能 / 模板 / 套索
module.exports = async (cdp) => {
  const R = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 书架：建文件夹 + 文件夹底透明
  R.folder = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnNewFolder').click(); await new Promise(r=>setTimeout(r,150));
    document.querySelector('#modalInput').value='工作'; document.querySelector('#modalOk').click(); await new Promise(r=>setTimeout(r,200));
    const cards=document.querySelectorAll('#shelfGrid .folder-card').length;
    const ico=document.querySelector('#shelfGrid .folder-ico');
    const bg=getComputedStyle(ico).backgroundColor;
    const transparent = bg==='rgba(0, 0, 0, 0)' || bg==='transparent';
    document.querySelector('#shelfGrid .folder-card').click(); await new Promise(r=>setTimeout(r,120));
    const back=!document.querySelector('#btnFolderBack').classList.contains('hidden');
    document.querySelector('#btnFolderBack').click(); await new Promise(r=>setTimeout(r,100));
    return JSON.stringify({cards, back, transparent});
  })()`));

  // 打开笔记本
  await cdp.eval("document.querySelector('#shelfGrid .nb-card').click()");
  await sleep(600);

  // 笔槽：只剩 2 支笔（笔 / 荧光笔）
  R.pens = JSON.parse(await cdp.eval(`(function(){
    const pens=[...document.querySelectorAll('#penRack .pen')];
    const vis=pens.filter(p=>{const r=p.querySelector('svg').getBoundingClientRect(); return r.width>5&&r.height>20;}).length;
    return JSON.stringify({count:pens.length, visible:vis});
  })()`));

  // 更多面板：笔类型只剩 2 个按钮
  R.penKinds = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,120));
    const kinds=[...document.querySelectorAll('#penKind .kind')].map(k=>k.dataset.kind);
    document.querySelector('#btnMore').click();
    return JSON.stringify({kinds});
  })()`));

  // 工具盘：含新增工具 挖空笔/卡片/激光笔
  R.tools = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,120));
    const tools=[...document.querySelectorAll('#toolGrid .tool-cell')].map(c=>c.dataset.tool);
    document.querySelector('#btnMore').click();
    return JSON.stringify({tools, cells:tools.length});
  })()`));

  // ★重点：像素局部擦除——画一条横线，用小橡皮擦中间一点点，两头应保留、中间断开
  R.pixel = JSON.parse(await cdp.eval(`(async function(){
    const ink=document.querySelector('#ink'); const r=ink.getBoundingClientRect();
    const pe=(t,x,y)=>ink.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pressure:.5,isPrimary:true}));
    // 选笔（第一支=普通笔）
    document.querySelector('#penRack .pen').click(); await new Promise(r=>setTimeout(r,60));
    // 画一条水平长线（页面逻辑坐标 y≈中线）
    const y=r.top+r.height*0.5, x0=r.left+r.width*0.2, x1=r.left+r.width*0.8;
    pe('pointerdown',x0,y); for(let i=1;i<=40;i++) pe('pointermove',x0+(x1-x0)*i/40,y); pe('pointerup',x1,y);
    await new Promise(r=>setTimeout(r,150));
    const before=(window.__np_strokes?window.__np_strokes():null);
    // 切像素擦除 + 小橡皮
    document.querySelector('#dock .tool[data-tool="eraser"]').click(); await new Promise(r=>setTimeout(r,60));
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,100));
    document.querySelector('#eraserMode .seg-btn[data-mode="pixel"]').click();
    const sz=document.querySelector('#eraserSize'); sz.value=12; sz.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,80));
    // 在线正中间擦一个小点
    const mx=r.left+r.width*0.5;
    pe('pointerdown',mx,y); pe('pointermove',mx+1,y); pe('pointerup',mx+1,y);
    await new Promise(r=>setTimeout(r,150));
    return JSON.stringify(window.__np_eraseProbe(mx,x0,x1,y,r));
  })()`));

  console.log("FULL RESULTS:", JSON.stringify(R, null, 2));
  const pass =
    R.folder.cards >= 1 && R.folder.back && R.folder.transparent &&
    R.pens.count === 2 && R.pens.visible === 2 &&
    R.penKinds.kinds.length === 2 && R.penKinds.kinds.includes('pen') && R.penKinds.kinds.includes('highlighter') &&
    R.tools.tools.includes('cover') && R.tools.tools.includes('card') && R.tools.tools.includes('laser') &&
    R.pixel.segments >= 2 && R.pixel.leftKept && R.pixel.rightKept && R.pixel.middleGone;
  console.log("FULL_PASS=", pass);
  return pass;
};
