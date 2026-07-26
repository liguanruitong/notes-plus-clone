module.exports = async (cdp) => {
  await new Promise((r) => setTimeout(r, 400));
  // 新建文件夹（modalInput 出现→填名→确定）
  const r = await cdp.eval(`(async function(){
    document.querySelector('#btnNewFolder').click();
    await new Promise(r=>setTimeout(r,150));
    const inp = document.querySelector('#modalInput');
    const visible = !inp.classList.contains('hidden');
    inp.value = '工作';
    document.querySelector('#modalOk').click();
    await new Promise(r=>setTimeout(r,250));
    const folderCards = document.querySelectorAll('#shelfGrid .folder-card').length;
    // 进入文件夹
    document.querySelector('#shelfGrid .folder-card').click();
    await new Promise(r=>setTimeout(r,150));
    const backVisible = !document.querySelector('#btnFolderBack').classList.contains('hidden');
    const title = document.querySelector('#shelfTitle').textContent;
    // 返回
    document.querySelector('#btnFolderBack').click();
    await new Promise(r=>setTimeout(r,120));
    return JSON.stringify({modalWasVisible:visible, folderCards, backVisible, title});
  })()`);
  console.log("FOLDER DIAG:", r);
  const p = JSON.parse(r);
  const ok = p.modalWasVisible && p.folderCards >= 1 && p.backVisible && p.title === "工作";
  console.log("FOLDER_OK=", ok);
  return ok;
};
