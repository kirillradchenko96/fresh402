import fs from 'node:fs';import {pathToFileURL} from 'node:url';import {enhancedInputs} from './enhanced-inputs.mjs';
/** Interpret only a retained complete original API review. Unknown/skipped is CI2. */
export function ciDecision(result){
 const supplied=result?.workflow==='api_compatibility_review'&&result?.summary?.comparison==='supplied';
 const review=result?.review??result?.evidence?.api?.review;
 const verdict=review?.verdict??(supplied?result?.summary?.findings?.verdict:undefined);
 if(review&&(review.schema!=='fresh402-contract-review-v1'||review.comparison_performed!==true)||!verdict||!['breaking','review_required','no_breaking_change_observed'].includes(verdict.status))return{status:'review_required',ci_exit_code:2,reason:'No accepted original comparison verdict'};
 const code=verdict.status==='breaking'?1:verdict.status==='no_breaking_change_observed'?0:2;
 if(verdict.ci_exit_code!==code)return{status:'review_required',ci_exit_code:2,reason:'Inconsistent verdict'};
 return{status:verdict.status,ci_exit_code:code,scope:'supported static rules; caller decides deployment policy'};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const at=process.argv.indexOf('--result');let decision;
 if(at>=0){const file=process.argv[at+1];if(!file||fs.statSync(file).size>131072)throw Error('Use one retained original result <=131072 bytes');decision=ciDecision(JSON.parse(fs.readFileSync(file,'utf8')));}
 else{const response=await fetch('https://api.fresh402.com/v4/workflows/api-compatibility-review',{method:'POST',headers:{'content-type':'application/json','x-fresh402-purpose':'probe'},body:JSON.stringify(enhancedInputs[1][1]),redirect:'error',signal:AbortSignal.timeout(20000)});if(response.status!==402)throw Error('Unsigned demonstration expected HTTP402, received '+response.status);await response.body?.cancel();decision={status:'unpaid_quote_only',ci_exit_code:2,reason:'No compatibility comparison purchased or performed'};}
 console.log(JSON.stringify(decision));process.exitCode=decision.ci_exit_code;
}
