// Public client contracts only. Prices and eligibility come from authenticated server quotes.
export const SERVER_WORKFLOWS=['website_change_intelligence','api_compatibility_review','onchain_evidence_brief','cross_domain_release_evidence'] as const;
export type ServerWorkflow=typeof SERVER_WORKFLOWS[number];
export const isServerWorkflow=(id:string):id is ServerWorkflow=>(SERVER_WORKFLOWS as readonly string[]).includes(id);
export const serverWorkflowPath=(id:ServerWorkflow)=>'/v4/workflows/'+id.replaceAll('_','-');
export const serverWorkflowPrepaidPath=(id:ServerWorkflow)=>'/v4/prepaid/workflows/'+id.replaceAll('_','-');
export interface WorkflowScope {selector?:string;ignore_selectors?:string[];ignore_json_paths?:string[];html_attributes?:Array<'href'|'title'|'alt'|'aria-label'>}
type Selection={url:string;observation_id?:never;scope?:WorkflowScope}|{observation_id:string;url?:never;scope?:never};
type Comparison={compare_to?:'previous'|'baseline';detail?:'compact'|'expanded'};
export interface WorkflowChainSelection {chain_id:8453;contract_address:string;wallet_address:string}
export interface ServerWorkflowInputs {
 website_change_intelligence:Selection&Comparison;
 api_compatibility_review:({url:string;observation_id?:never}|{observation_id:string;url?:never})&Comparison;
 onchain_evidence_brief:WorkflowChainSelection&{previous_contract_snapshot?:string;detail?:'compact'|'expanded'};
 cross_domain_release_evidence:Comparison&{release_label:string}&({url:string;scope?:WorkflowScope;api_url?:string;onchain:WorkflowChainSelection;observation_id?:never}|{observation_id:string;url?:never;scope?:never;api_url?:never;onchain?:never});
}
export interface ServerWorkflowResult {workflow:ServerWorkflow;version:1;status:string;observed_at:string;summary:Record<string,unknown>;evidence:Record<string,unknown>;provenance:Record<string,unknown>;completeness:Record<string,unknown>;warnings:string[];accounting:Record<string,unknown>;billing:{one_financial_operation:true;internal_charges:0;tariff_version:5;credits:number;atomic_usdc:string};observation_id?:string;state_expires_at?:string;workflow_state_saved?:boolean;persistence_error?:string}
