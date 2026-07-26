// 综合自测：笔槽可见 / 橡皮模式切换 / 模板编辑器 / 套索变换框 / 文件夹 / 工具盘
module.exports = async (cdp) => {
  const R = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 书架：建文件夹
  R.folder = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnNewFolder').click(); await new Promise(r=>setTimeout(r,150));
    document.querySelector('#modalInput').value='工作'; document.querySelector('#modalOk').click(); await new Promise(r=>setTimeout(r,200));
    const cards=document.querySelectorAll('#shelfGrid .folder-card').length;
    document.querySelector('#shelfGrid .folder-card').click(); await new Promise(r=>setTimeout(r,120));
    const back=!document.querySelector('#btnFolderBack').classList.contains('hidden');
    document.querySelector('#btnFolderBack').click(); await new Promise(r=>setTimeout(r,100));
    return JSON.stringify({cards, back});
  })()`));

  // 打开笔记本
  await cdp.eval("document.querySelector('#shelfGrid .nb-card').click()");
  await sleep(600);

  // 笔槽：5 支笔可见 + 选中上抬
  R.pens = JSON.parse(await cdp.eval(`(function(){
    const pens=[...document.querySelectorAll('#penRack .pen')];
    const vis=pens.filter(p=>{const r=p.querySelector('svg').getBoundingClientRect(); return r.width>5&&r.height>20;}).length;
    const on=pens.filter(p=>p.classList.contains('on')).length;
    return JSON.stringify({count:pens.length, visible:vis, raised:on});
  })()`));

  // 工具盘
  R.tools = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,120));
    const cells=document.querySelectorAll('#toolGrid .tool-cell').length;
    document.querySelector('#btnMore').click();
    return JSON.stringify({cells});
  })()`));

  // 橡皮模式切换
  R.eraser = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#dock .tool[data-tool="eraser"]').click(); await new Promise(r=>setTimeout(r,80));
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,120));
    const secVisible=!document.querySelector('#eraserSec').classList.contains('hidden');
    const pixelBtn=document.querySelector('#eraserMode .seg-btn[data-mode="pixel"]');
    pixelBtn.click(); await new Promise(r=>setTimeout(r,60));
    const pixelOn=pixelBtn.classList.contains('on');
    document.querySelector('#eraserMode .seg-btn[data-mode="stroke"]').click();
    document.querySelector('#btnMore').click();
    return JSON.stringify({secVisible, pixelOn});
  })()`));

  // 模板编辑器
  R.tpl = JSON.parse(await cdp.eval(`(async function(){
    document.querySelector('#btnMore').click(); await new Promise(r=>setTimeout(r,100));
    document.querySelector('#btnNewTpl').click(); await new Promise(r=>setTimeout(r,150));
    const open=!document.querySelector('#tplEditor').classList.contains('hidden');
    const hasSpacing=!!document.querySelector('#teSpacing');
    const hasPaper=!!document.querySelector('#tePaper');
    // 加一条参考线
    document.querySelector('#teAddH').click(); await new Promise(r=>setTimeout(r,60));
    const guides=document.querySelectorAll('#teGuideList .te-guide-row').length;
    document.querySelector('#teCancel').click();
    return JSON.stringify({open, hasSpacing, hasPaper, guides});
  })()`));

  // 套索变换框
  R.lasso = JSON.parse(await cdp.eval(`(async function(){
    const ink=document.querySelector('#ink'); const r=ink.getBoundingClientRect();
    const pe=(t,x,y)=>ink.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pressure:.5,isPrimary:true}));
    // 选钢笔
    document.querySelector('#penRack .pen').click(); await new Promise(r=>setTimeout(r,60));
    const x0=r.left+r.width*0.4, y0=r.top+r.height*0.4;
    pe('pointerdown',x0,y0); for(let i=1;i<=10;i++) pe('pointermove',x0+i*6,y0+(i%2?3:-3)); pe('pointerup',x0+60,y0);
    await new Promise(r=>setTimeout(r,120));
    document.querySelector('#dock .tool[data-tool="lasso"]').click(); await new Promise(r=>setTimeout(r,60));
    const path=[[0.30,0.30],[0.75,0.30],[0.75,0.55],[0.30,0.55],[0.30,0.30]].map(([fx,fy])=>[r.left+r.width*fx,r.top+r.height*fy]);
    pe('pointerdown',path[0][0],path[0][1]); for(const [x,y] of path) pe('pointermove',x,y); pe('pointerup',path[4][0],path[4][1]);
    await new Promise(r=>setTimeout(r,180));
    const selBar=!document.querySelector('#selBar').classList.contains('hidden');
    const ov=document.querySelector('#overlay'); const oc=ov.getContext('2d');
    const d=oc.getImageData(0,0,ov.width,ov.height).data; let painted=0;
    for(let i=3;i<d.length;i+=4*997) if(d[i]>0) painted++;
    return JSON.stringify({selBar, boxPainted:painted>0});
  })()`));

  console.log("FULL RESULTS:", JSON.stringify(R, null, 2));
  const pass =
    R.folder.cards >= 1 && R.folder.back &&
    R.pens.count === 5 && R.pens.visible === 5 && R.pens.raised === 1 &&
    R.tools.cells === 8 &&
    R.eraser.secVisible && R.eraser.pixelOn &&
    R.tpl.open && R.tpl.hasSpacing && R.tpl.hasPaper && R.tpl.guides === 1 &&
    R.lasso.selBar && R.lasso.boxPainted;
  console.log("FULL_PASS=", pass);
  return pass;
};
