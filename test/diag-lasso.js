// 测试套索变换框：程序化派发 pointer 事件到 #ink，画笔迹→套索圈选→检查 selBar 与手柄出现
module.exports = async (cdp) => {
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 700));

  const script = `(async function(){
    const ink = document.querySelector('#ink');
    const r = ink.getBoundingClientRect();
    function pe(type, cx, cy){
      const ev = new PointerEvent(type, {bubbles:true, cancelable:true, clientX:cx, clientY:cy, pointerId:1, pressure:0.5, isPrimary:true});
      ink.dispatchEvent(ev);
    }
    // 1) 选钢笔画一条横线（用第一支笔，默认已选）
    const cx0 = r.left + r.width*0.4, cy0 = r.top + r.height*0.4;
    pe('pointerdown', cx0, cy0);
    for(let i=1;i<=10;i++) pe('pointermove', cx0 + i*6, cy0 + (i%2?3:-3));
    pe('pointerup', cx0+60, cy0);
    await new Promise(r=>setTimeout(r,150));
    const strokeCount = (window.__np_strokeCount && window.__np_strokeCount()) || null;
    // 2) 切换套索：点 dock 里 data-tool=lasso
    document.querySelector('#dock .tool[data-tool="lasso"]').click();
    await new Promise(r=>setTimeout(r,80));
    // 3) 画一个包住笔迹的套索圈
    const path = [[0.30,0.30],[0.75,0.30],[0.75,0.55],[0.30,0.55],[0.30,0.30]];
    const P = path.map(([fx,fy])=>[r.left+r.width*fx, r.top+r.height*fy]);
    pe('pointerdown', P[0][0], P[0][1]);
    for(const [x,y] of P) { pe('pointermove', x, y); }
    // 多插点让 lasso 平滑
    pe('pointerup', P[P.length-1][0], P[P.length-1][1]);
    await new Promise(r=>setTimeout(r,200));
    const selBar = !document.querySelector('#selBar').classList.contains('hidden');
    // overlay 是否有非空绘制：检查像素
    const ov = document.querySelector('#overlay');
    const octx = ov.getContext('2d');
    const data = octx.getImageData(0,0,ov.width,ov.height).data;
    let painted=0; for(let i=3;i<data.length;i+=4*997) if(data[i]>0) painted++;
    return JSON.stringify({strokeCount, selBar, overlayPainted: painted>0});
  })()`;
  const res = await cdp.eval(script);
  console.log("LASSO DIAG:", res);
  const p = JSON.parse(res);
  const ok = p.selBar === true && p.overlayPainted === true;
  console.log("LASSO_OK=", ok);
  return ok;
};
