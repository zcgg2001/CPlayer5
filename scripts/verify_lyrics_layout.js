// Playwright CLI run-code callback. Uses an isolated context and closes it.
async(original) => {
  const page = await original.context().browser().newContext({serviceWorkers:'block',viewport:{width:390,height:844}}).then(c=>c.newPage());
  await page.goto('http://127.0.0.1:8788/');
  const result=await page.evaluate(async()=>{
    const [{createStage},{normalizeStudio},{RENDERERS},{parseText,normalizeDocument}]=await Promise.all([import('/js/lyrics/renderers/stage.js'),import('/js/lyrics/settings.js'),import('/js/lyrics/registry.js'),import('/js/lyrics/document.js')]);
    const host=document.createElement('div'); host.className='lyric-surface'; Object.assign(host.style,{position:'fixed',width:'342px',height:'480px',top:'80px',left:'24px',zIndex:'10000'});document.body.append(host);
    const stage=createStage(host);stage.element.hidden=false;
    const doc=normalizeDocument({lines:[{start:0,end:4000,text:'前一句'},{start:5000,end:16000,text:'在很长很长的旅途中我们依旧听见彼此的声音，We keep the light alive, ずっと一緒に歩いていこう 🌙🎵',translation:'Even through a very long journey, we can still hear each other. 一起走下去。',romanization:'Zutto issho ni aruite ikou'},{start:17000,end:23000,text:'下一句'}]});
    stage.setDocument(doc);
    const results=[];
    for(const mode of RENDERERS){
      stage.setSettings({...normalizeStudio(),mode:mode.id,fontSize:60,romanization:true,motion:0});stage.update(8000);
      await new Promise(requestAnimationFrame);stage.update(8000);
      const line=stage.element.querySelector('[data-state=active]'),box=line.getBoundingClientRect(),surface=stage.element.getBoundingClientRect();
      results.push({mode:mode.id,overflow:line.scrollWidth>line.clientWidth+2,clipped:box.top<surface.top||box.bottom>surface.bottom,box:[box.width,box.height],font:getComputedStyle(stage.element).fontSize});
    }
    stage.setDocument(normalizeDocument({lines:[{start:0,end:20000,text:'长句需要完整可读。'.repeat(120)}]}));
    stage.setSettings({...normalizeStudio(),mode:'glow',fontSize:60,motion:0});stage.update(8000);await new Promise(requestAnimationFrame);stage.update(8000);
    const long=stage.element.querySelector('[data-state=active]');
    const longVerse=getComputedStyle(long).overflowY==='auto'&&long.scrollHeight>long.clientHeight;
    if(!longVerse) throw Error('Very long verse must remain scrollable');
    stage.destroy();host.remove();
    const nested=normalizeDocument(parseText('<tt xmlns="http://www.w3.org/ns/ttml"><body begin="2s"><div begin="3s"><p begin="1s" dur="4s"><span begin="0s" dur="2s"><span begin="0s" dur="1s">你</span><span begin="1s" dur="1s">好</span></span></p></div></body></tt>','ttml'));
    const multiline=normalizeDocument(parseText('<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="5s">Hello<br/>世界</p></div></body></tt>','ttml'));
    if(nested.lines[0].start!==6000||nested.lines[0].words.length!==2||nested.lines[0].words[1].start!==7000||multiline.lines[0].text!=='Hello\n世界') throw Error('Nested TTML timing or line break regression');
    return {layouts:results,nestedTTML:true,multilineTTML:true,longVerse};
  });
  await page.context().close();return result;
}
