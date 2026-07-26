module.exports = async (cdp) => {
  const title = await cdp.eval("document.title");
  console.log("title=", title);
  const hasShelf = await cdp.eval("!!document.querySelector('#shelf')");
  console.log("hasShelf=", hasShelf);
  // 打开第一个笔记本
  await cdp.eval("(function(){const c=document.querySelector('#shelfGrid .nb-card'); if(c) c.click();})()");
  await new Promise((r) => setTimeout(r, 600));
  const editorVisible = await cdp.eval("!document.querySelector('#editor').classList.contains('hidden')");
  console.log("editorVisible=", editorVisible);
  const penCount = await cdp.eval("document.querySelectorAll('#penRack .pen').length");
  console.log("penRack pen count=", penCount);
  return title === "手写笔记" && hasShelf;
};
