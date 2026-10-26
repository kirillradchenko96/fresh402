type Entry={id:string;content_hash:string;identity_source:string};
export type FeedSnapshot={parser_version:1;source_url:string;format:'rss2'|'atom';id:string;entries:Entry[]};
/** Pure client comparison of two retained, same-source feed projections. Empty
 * after does not prove deletion at origin; a feed may have aged entries out.
 */
export function compareFeedEntries(before:FeedSnapshot,after:FeedSnapshot){
 function checked(feed:FeedSnapshot){
  if(!feed||feed.parser_version!==1||!['rss2','atom'].includes(feed.format)||typeof feed.source_url!=='string'||typeof feed.id!=='string'||!Array.isArray(feed.entries)||feed.entries.length>100)throw Error('Complete bounded feed projection required');
  const entries=new Map<string,Entry>();for(const entry of feed.entries){if(!entry||typeof entry.id!=='string'||!entry.id||entry.id.length>16384||!/^[a-f0-9]{64}$/.test(entry.content_hash)||!['declared','link','content_hash'].includes(entry.identity_source)||entries.has(entry.id))throw Error('Unique original feed entry IDs/fingerprints required');entries.set(entry.id,entry);}return entries;
 }
 const old=checked(before),current=checked(after);if(before.source_url!==after.source_url||before.id!==after.id||before.format!==after.format)throw Error('Feed comparison source/identity differs');
 const added:string[]=[],removed:string[]=[],modified:string[]=[];let derivedIdentity=false;
 for(const[id,entry]of current){if(!old.has(id))added.push(id);else if(old.get(id)!.content_hash!==entry.content_hash)modified.push(id);if(entry.identity_source==='content_hash')derivedIdentity=true;}
 for(const[id,entry]of old){if(!current.has(id))removed.push(id);if(entry.identity_source==='content_hash')derivedIdentity=true;}
 return{changed:added.length+removed.length+modified.length>0,added,removed,modified,counts:{added:added.length,removed:removed.length,modified:modified.length},warnings:['Removal means absent from this observed feed window, not proven deletion.',...(derivedIdentity?['Content-derived identity can express edits as removal plus addition.']:[])]};
}
