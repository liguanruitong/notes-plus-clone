module.exports = async (cdp) => {
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 600));
  const info = await cdp.eval(`(function(){
    const rack = document.querySelector('#penRack');
    const pens = [...document.querySelectorAll('#penRack .pen')];
    const vis = pens.map(pen => {
      const svg = pen.querySelector('svg');
      const r = svg.getBoundingClientRect();
      const cs = getComputedStyle(svg);
      return { w: Math.round(r.width), h: Math.round(r.height), display: cs.display, on: pen.classList.contains('on') };
    });
    return JSON.stringify({ count: pens.length, pens: vis });
  })()`);
  console.log("PEN DIAG:", info);
  const parsed = JSON.parse(info);
  const allVisible = parsed.count === 5 && parsed.pens.every(p => p.w > 5 && p.h > 20);
  console.log("ALL_PENS_VISIBLE=", allVisible);
  return allVisible;
};
