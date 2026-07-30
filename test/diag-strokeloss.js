// 回归测试：复现「笔画随机丢失」bug（单窗口下同步兜底拉取旧磁盘数据覆盖内存新笔画）。
// 步骤：打开一本笔记 → 直接往内存 curPage().strokes 推入若干笔画（模拟刚写完还没落盘）→
//       触发 pullAndRefresh（模拟主进程回声/BroadcastChannel/定时兜底）→ 断言笔画没被清掉。
// 修复前：pullAndRefresh 无条件用磁盘旧数据覆盖 nb → 未落盘的笔画消失，count 归零。
// 修复后：单窗口 syncActive()=false 直接 return + dirty 守卫 → 笔画保留。
module.exports = async (cdp) => {
  // 打开第一本笔记
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 700));

  // 1) 记录初始笔画数
  const before = await cdp.eval("(function(){return (window.curPageStrokesCount && window.curPageStrokesCount()) || (nb && nb.pages[pageIdx] ? nb.pages[pageIdx].strokes.length : -1);})()");

  // 2) 直接往内存推 3 笔（模拟刚写下、save() 400ms 防抖还没落盘），并置 dirty
  const injected = await cdp.eval(`(function(){
    if(!nb) return -1;
    const p = nb.pages[pageIdx];
    const base = p.strokes.length;
    for(let i=0;i<3;i++){ p.strokes.push({ tool:'pen', color:'#f00', size:3, points:[{x:10+i,y:10+i},{x:50+i,y:50+i}] }); }
    // 触发脏状态（等价于用户书写后 save() 被调用但落盘未完成）
    if(typeof save==='function') save();
    return p.strokes.length - base; // 应为 3
  })()`);

  // 3) 立刻触发同步兜底拉取（bug 就发生在这一步：拿磁盘旧数据盖内存）
  const afterPull = await cdp.eval(`(async function(){
    if(typeof pullAndRefresh==='function'){ await pullAndRefresh(nb.id); }
    return nb.pages[pageIdx].strokes.length;
  })()`);

  console.log("STROKE-LOSS DIAG: before=", before, "injected=", injected, "afterPull=", afterPull);
  // 断言：注入 3 笔后，即使触发 pullAndRefresh，笔画数不应回退到低于 before+3
  const ok = injected === 3 && afterPull >= before + 3;
  console.log("STROKES_PRESERVED=", ok);
  return ok;
};
