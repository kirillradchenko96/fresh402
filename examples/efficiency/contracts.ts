import {createHash} from 'node:crypto';
type Change={classification:'definitely_breaking'|'potentially_breaking'|'additive'|'unclassified';rule:string;path:string;before?:string;after?:string};
export type UsedOperation={path:string;method:'get'|'put'|'post'|'delete'|'options'|'head'|'patch'|'trace'};
type ContractEvidence={changed:boolean;changes:Change[];changes_truncated:boolean;warnings:string[];counts:Record<Change['classification'],number>;rules_version:number;[key:string]:unknown};
const methods=new Set(['get','put','post','delete','options','head','patch','trace']),classes=['definitely_breaking','potentially_breaking','additive','unclassified'] as const;
export function validateUsedOperations(usedOperations:UsedOperation[]){
 if(!Array.isArray(usedOperations)||!usedOperations.length||usedOperations.length>64||usedOperations.some(o=>!o||typeof o.path!=='string'||!o.path.startsWith('/')||o.path.length>512||!methods.has(o.method)))throw Error('Supply1–64 exact OpenAPI path templates and lowercase HTTP methods');
 return [...new Map(usedOperations.map(o=>[o.method+' '+o.path,{method:o.method,path:o.path}])).values()];
}
/** Compact client view of an ORIGINAL saved OpenAPI Contract Diff, scoped to the
 * caller's exact OpenAPI path templates/methods. Does no fetch, model or payment.
 * Shared/unrecognized pointers, warnings and truncated evidence require review;
 * excluding another operation never certifies deployment compatibility.
 */
export function summarizeContractImpact(result:ContractEvidence,usedOperations:UsedOperation[]){
 const scope=validateUsedOperations(usedOperations);
 if(!result||typeof result.changed!=='boolean'||typeof result.changes_truncated!=='boolean'||!Array.isArray(result.changes)||result.changes.length>200||!Array.isArray(result.warnings)||result.warnings.length>64||result.warnings.some(w=>typeof w!=='string'||w.length>256)||!Number.isSafeInteger(result.rules_version)||!result.counts)throw Error('Original complete bounded contract comparison required');
 const seen={definitely_breaking:0,potentially_breaking:0,additive:0,unclassified:0};
 for(const c of result.changes){if(!c||!classes.includes(c.classification)||typeof c.rule!=='string'||c.rule.length>128||typeof c.path!=='string'||c.path.length>1024||[c.before,c.after].some(x=>x!==undefined&&(typeof x!=='string'||x.length>240)))throw Error('Invalid original change evidence');seen[c.classification]++;}
 for(const key of classes)if(!Number.isSafeInteger(result.counts[key])||result.counts[key]<seen[key]||!result.changes_truncated&&result.counts[key]!==seen[key])throw Error('Change counts and completeness disagree');
 const json=JSON.stringify(result);if(Buffer.byteLength(json)>131072)throw Error('Original contract result exceeds128KiB');
 const changes:Array<Change&{evidence_index:number;scope:'selected_operation'|'shared_or_unknown'}>=[];let excluded=0;
 result.changes.forEach((c,evidence_index)=>{
  // RFC6901 tokens only; never use prefix matching (/items is not /items-old).
  const parts=c.path.split('/').slice(1);if(parts.some(p=>/~(?:[^01]|$)/.test(p))){changes.push({...c,evidence_index,scope:'shared_or_unknown'});return;}
  const decoded=parts.map(p=>p.replaceAll('~1','/').replaceAll('~0','~'));
  if(decoded[0]==='paths'&&decoded.length>=2&&decoded[1].startsWith('/')){
   const method=methods.has(decoded[2])?decoded[2]:null;
   if(scope.some(o=>o.path===decoded[1]&&(!method||o.method===method)))changes.push({...c,evidence_index,scope:'selected_operation'});else excluded++;
  }else changes.push({...c,evidence_index,scope:'shared_or_unknown'});
 });
 const breaking=changes.some(c=>c.classification==='definitely_breaking'),uncertain=result.changes_truncated||result.warnings.length>0||changes.some(c=>c.scope==='shared_or_unknown'||['potentially_breaking','unclassified'].includes(c.classification));
 return{status:breaking?'breaking':uncertain?'review_required':'no_breaking_change_observed',used_operations:scope,document_changed:result.changed,changes,excluded_operation_changes:excluded,changes_truncated:result.changes_truncated,warnings:[...result.warnings],evidence:{sha256:createHash('sha256').update(json).digest('hex'),rules_version:result.rules_version,...Object.fromEntries(['watch_id','hash','previous_hash','fetched_at','algorithm'].filter(k=>typeof result[k]==='string').map(k=>[k,result[k]]))},limitation:'Static supported-contract evidence only. Retain the full original result and its assumptions privately; this view is not a guarantee about deployed behavior or unobserved changes.'};
}
