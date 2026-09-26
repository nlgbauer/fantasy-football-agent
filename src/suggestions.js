// Raw suggestions are outside the canonical corpus and cannot be approved as file replacements.
// Persist before sending; ambiguous provider failures are never retried automatically.
export async function forwardSuggestions(store,client,recipient){
  if(!recipient || !/^\d+@(?:c\.us|lid)$/.test(recipient))return;
  for(const item of store.list('suggestion').filter(s=>s.notification==='pending')){
    const claimed=store.tx(()=>{if(store.get(item.id).notification!=='pending')return false;item.notification='sending';item.notificationRecipient=recipient;store.put('suggestion',item);return true;});
    if(!claimed)continue;
    try{
      const sent=await client.sendMessage(recipient,`ChatPDT — suggestion for your review\n\nFrom: ${item.submitter}\nReference: ${item.id}\n\n${item.text}\n\nThis is a member submission, not a verified fact. Canonical memory is unchanged.`);
      item.notification='sent';item.notificationMessageId=sent.id._serialized;
      store.put('suggestion',item);store.audit('suggestion.forwarded',item.id,{recipient,messageId:item.notificationMessageId});
    }catch{
      item.notification='unknown';store.put('suggestion',item);store.audit('suggestion.forward_failed',item.id);
    }
  }
}



