// v1.8.2 验证：同一笔画内压感实时变化 —— 真机渲染到画布后采样像素。
// 造一条水平笔画，压感从低(0.1)线性升到高(1.0)，开启"压感控粗细"+"压感控透明度"，
// 断言：①左端(低压)线更细、右端(高压)线更粗（宽度沿笔画变化）
//      ②左端(低压)更透明、右端(高压)更不透明（alpha 沿笔画变化）
// 通过在离屏 canvas 上直接跑 strokePath，再逐列统计"着色像素高度(宽度)"与"平均不透明度"。
module.exports = async (cdp) => {
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 700));

  const res = await cdp.eval(`(function(){
    const W=900,H=200;
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    const cx=cv.getContext('2d');
    cx.clearRect(0,0,W,H);
    // 水平笔画，y居中，x从50到850；压感线性 0.1→1.0
    const N=40, pts=[];
    for(let i=0;i<N;i++){ const t=i/(N-1); pts.push({x:50+t*800, y:100, p:0.1+0.9*t}); }
    const s={ tool:'pen', color:'#000000', size:6, opacity:1,
              pWidth:true, pWidthAmt:1, pAlpha:true, pAlphaAmt:1, points:pts };
    strokePath(cx, s);
    // 采样两个 x 列：左端 x=120(低压) 与 右端 x=780(高压)
    function colStat(xc){
      let minY=H, maxY=-1, aSum=0, aCnt=0;
      for(let y=0;y<H;y++){
        const d=cx.getImageData(xc,y,1,1).data; // rgba
        if(d[3]>0){ if(y<minY)minY=y; if(y>maxY)maxY=y; aSum+=d[3]; aCnt++; }
      }
      return { width: maxY<0?0:(maxY-minY+1), avgAlpha: aCnt? aSum/aCnt : 0 };
    }
    const L=colStat(120), R=colStat(780);
    return JSON.stringify({L,R});
  })()`);
  console.log("PRESSURE DIAG:", res);
  const { L, R } = JSON.parse(res);
  const widthVaries = R.width > L.width + 1;          // 高压端更粗
  const alphaVaries = R.avgAlpha > L.avgAlpha + 10;   // 高压端更不透明(0-255)
  console.log("WIDTH_VARIES_WITHIN_STROKE=", widthVaries, `(L=${L.width} R=${R.width})`);
  console.log("ALPHA_VARIES_WITHIN_STROKE=", alphaVaries, `(L=${Math.round(L.avgAlpha)} R=${Math.round(R.avgAlpha)})`);
  const ok = widthVaries && alphaVaries;
  console.log("PER_POINT_PRESSURE_OK=", ok);
  return ok;
};
