// v1.9.2 验证：实时预览(strokePathLive)在 pAlpha 开启时逐段浓淡（回归修复）。
// 造一条水平笔画，压感从低(0.1)线性升到高(0.9)，在“实时预览”阶段（cur 未 onUp）
// 调 strokePathLive 画到离屏 canvas，再采样起点段与末端段像素 alpha：
//   ①pAlpha 开：起点淡、末端浓，两处 alpha 明显不同（差值 > 20/255）；
//   ②对照 pAlpha 关：两处 alpha 基本一致。
module.exports = async (cdp) => {
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 700));

  const res = await cdp.eval(`(function(){
    const W=900,H=200;
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    const cx=cv.getContext('2d');
    function pts(){ const N=40,a=[]; for(let i=0;i<N;i++){const t=i/(N-1); a.push({x:50+t*800,y:100,p:0.1+0.8*t});} return a; }
    // 某 x 列的平均不透明度（实时预览渲染结果）
    function colAlpha(xc){
      let aSum=0,aCnt=0;
      for(let y=0;y<H;y++){ const d=cx.getImageData(xc,y,1,1).data; if(d[3]>0){aSum+=d[3];aCnt++;} }
      return aCnt? aSum/aCnt : 0;
    }
    function run(pAlpha){
      cx.clearRect(0,0,W,H);
      const s={ tool:'pen', color:'#000000', size:6, opacity:1,
                pWidth:true, pWidthAmt:1, pAlpha:pAlpha, pAlphaAmt:1, points:pts() };
      strokePathLive(cx, s);         // 实时预览路径（未抬笔）
      return { L: colAlpha(120), R: colAlpha(780) };
    }
    return JSON.stringify({ on: run(true), off: run(false) });
  })()`);
  console.log("LIVE PRESSURE-ALPHA DIAG:", res);
  const { on, off } = JSON.parse(res);
  const onVaries = on.R > on.L + 20;                 // pAlpha 开：末端明显更浓
  const offSame  = Math.abs(off.R - off.L) < 8;      // pAlpha 关：两处基本一致
  console.log("LIVE_ALPHA_VARIES_ON=", onVaries, `(L=${Math.round(on.L)} R=${Math.round(on.R)})`);
  console.log("LIVE_ALPHA_SAME_OFF=", offSame, `(L=${Math.round(off.L)} R=${Math.round(off.R)})`);
  const ok = onVaries && offSame;
  console.log("PASS=", ok);
  return ok;
};
