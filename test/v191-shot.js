const fs = require("fs");
module.exports = async (cdp) => {
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 700));
  // 画一笔普通线 + 一笔在卡片上手写
  await cdp.eval("selectTool('pen')");
  await cdp.eval(`(function(){
    for(const pts of [
      [[120,140],[180,120],[240,150],[300,110],[360,160]],
    ]){
      drawing=true; cur={tool:'pen',color:'#1a56db',size:3,points:pts.map(p=>({x:p[0],y:p[1],p:0.6})),opacity:1,pWidth:true,pWidthAmt:0.5,pAlpha:false,pAlphaAmt:0.5};
      onUp();
    }
  })()`);
  // 加一张卡片，放到固定位置，并在其上手写
  await cdp.eval("selectTool('text')");
  await cdp.eval(`(async function(){ await addCard(); await new Promise(r=>setTimeout(r,80));
    const c=curPage().cards[curPage().cards.length-1]; c.x=200; c.y=250; c.w=260; c.h=150; c.content='卡片可写字，字号可调'; c.fontSize=20;
    renderCards();
  })()`);
  await cdp.eval("selectTool('pen')");
  await cdp.eval(`(function(){
    drawing=true; cur={tool:'pen',color:'#e11',size:4,points:[{x:220,y:300,p:0.7},{x:280,y:330,p:0.7},{x:340,y:300,p:0.7},{x:400,y:340,p:0.7}],opacity:1,pWidth:true,pWidthAmt:0.5,pAlpha:false,pAlphaAmt:0.5};
    onUp();
  })()`);
  // 聚焦卡片显示字号浮条
  await cdp.eval("selectTool('text')");
  await cdp.eval("(function(){const b=document.querySelector('#cardLayer .card-body'); if(b){b.focus();}})()");
  await new Promise((r) => setTimeout(r, 300));
  const data = await cdp.shot();
  if (data) { fs.writeFileSync("/tmp/v191-shot.png", Buffer.from(data, "base64")); console.log("SHOT_SAVED /tmp/v191-shot.png"); }
  return !!data;
};
