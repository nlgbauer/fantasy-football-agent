import { hash } from './store.js';

const normalize = value => String(value||'').replace(/\s+/g,' ').trim();
const storyHeading = heading => /(?:stories|anecdotes|running jokes)/i.test(heading);

export function storyCandidates(documents) {
  const candidates=[];
  const seen=new Set();
  for(const document of documents.filter(doc=>doc.path.startsWith('members/')||doc.path==='creighton/stories.md'||doc.path==='creighton/gamma_history.md')){
    let eligible=false;
    for(const line of document.text.split(/\r?\n/)){
      const heading=line.match(/^#{2,6}\s+(.+)$/);
      if(heading){eligible=storyHeading(heading[1]);continue;}
      if(!eligible)continue;
      const item=line.match(/^\s*[-*]\s+(?:\[story:([^\]]+)\]\s*)?(.+)$/i);
      if(!item)continue;
      const text=normalize(item[2]);
      if(!text||/^(?:none|no |todo|not supplied)/i.test(text))continue;
      const textHash=hash(text.toLowerCase());
      if(seen.has(textHash))continue;
      seen.add(textHash);
      candidates.push({id:item[1]?.trim()||`${document.path}:${textHash.slice(0,12)}`,text,path:document.path,textHash});
    }
  }
  return candidates.sort((a,b)=>a.id.localeCompare(b.id));
}

export function planWeeklyStories(documents,previousPublications,{season,week,count=4}){
  const candidates=storyCandidates(documents);
  const usedSelections=previousPublications.filter(publication=>publication.status==='published').flatMap(publication=>publication.storySelections||[]);
  const usedHashes=new Set(usedSelections.map(item=>item.textHash));
  const unused=candidates.filter(item=>!usedHashes.has(item.textHash));
  if(!unused.length)return {selected:[],used:usedSelections.map(({id,text,path,textHash})=>({id,text,path,textHash}))};
  const start=(Number(season)+Number(week))%unused.length;
  const ordered=[...unused.slice(start),...unused.slice(0,start)];
  return {selected:ordered.slice(0,Math.max(0,Number(count)||0)),used:usedSelections.map(({id,text,path,textHash})=>({id,text,path,textHash}))};
}

export function assertNoUsedStoryRepeated(text,used){
  const output=normalize(text).toLowerCase();
  for(const story of used||[]){
    const exact=normalize(story.text).toLowerCase();
    if(exact.length>=24&&output.includes(exact))throw new Error(`Generated recap repeated previously published story ${story.id}`);
  }
}



