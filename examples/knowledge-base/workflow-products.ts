// Public client contracts only. Prices and eligibility come from authenticated server quotes.
export const SERVER_WORKFLOWS=['website_change_intelligence','api_compatibility_review','onchain_evidence_brief','cross_domain_release_evidence'] as const;
export type ServerWorkflow=typeof SERVER_WORKFLOWS[number];
export const isServerWorkflow=(id:string):id is ServerWorkflow=>(SERVER_WORKFLOWS as readonly string[]).includes(id);
export const serverWorkflowPath=(id:ServerWorkflow)=>'/v4/workflows/'+id.replaceAll('_','-');
export const serverWorkflowPrepaidPath=(id:ServerWorkflow)=>'/v4/prepaid/workflows/'+id.replaceAll('_','-');
export interface WorkflowScope {selector?:string;ignore_selectors?:string[];ignore_json_paths?:string[];html_attributes?:Array<'href'|'title'|'alt'|'aria-label'>}
type Selection={url:string;source_watch_id?:never;observation_id?:never;baseline_snapshot?:never;scope?:WorkflowScope}|{source_watch_id:string;url?:never;observation_id?:never;baseline_snapshot?:never;scope?:never}|{observation_id:string;url?:never;source_watch_id?:never;baseline_snapshot?:never;scope?:never};
type PortableSelection={baseline_snapshot:string;url?:never;source_watch_id?:never;observation_id?:never;scope?:never;compare_to?:'previous'};
type RecordIdentity={json_array_keys?:Array<{path:string;key:string}>};
type Comparison={compare_to?:'previous'|'baseline';detail?:'compact'|'expanded'};
export interface WorkflowChainSelection {chain_id:8453;contract_address:string;wallet_address:string}
export type WebsiteConditionFact = `website:${string}`;
export type BaseConditionFact = `base:${'contract_address'|'code_present'|'code_hash'|'implementation_slot'|'admin_slot'|'token_symbol'|'token_decimals'|'token_total_supply'|'wallet_balance_wei'}`;
export type ConsumerOperation = `${'GET'|'PUT'|'POST'|'DELETE'|'OPTIONS'|'HEAD'|'PATCH'|'TRACE'} /${string}`;
export type CrossConditionFact = WebsiteConditionFact | BaseConditionFact | 'api:version' | `api:${ConsumerOperation}`;
type LiteralComparison = {type:'text';operator:'equals'|'not_equals';expected:string} |
 {type:'boolean';operator:'equals'|'not_equals';expected:boolean} |
 {type:'decimal';operator:'equals'|'not_equals'|'greater_than'|'less_than';expected:string};
type Condition<F> = {id:string;fact:F} & LiteralComparison;
type WebsiteChangeCondition = {id:string;fact:WebsiteConditionFact;type:'text'|'boolean'|'decimal';operator:'changed'|'unchanged'};
export type WebsiteCondition = Condition<WebsiteConditionFact> | WebsiteChangeCondition;
export type BaseCondition = Condition<BaseConditionFact>;
export type CrossCondition = Condition<CrossConditionFact> | WebsiteChangeCondition |
 ({id:string;fact:CrossConditionFact;with_fact:CrossConditionFact;expected?:never} &
 ({type:'text'|'boolean';operator:'equals'|'not_equals'}|{type:'decimal';operator:'equals'|'not_equals'|'greater_than'|'less_than'}));
export interface ServerWorkflowInputs {
 website_change_intelligence:((Selection&Comparison)|PortableSelection)&RecordIdentity&{detail?:'compact'|'expanded';export_snapshot?:boolean;conditions?:WebsiteCondition[]};
 api_compatibility_review:({contracts:{before:string;after:string};url?:never;source_watch_id?:never;observation_id?:never;baseline_snapshot?:never;compare_to?:'previous';export_snapshot?:false;consumer_operations?:ConsumerOperation[]}|((Selection&Comparison)|PortableSelection)&{contracts?:never;consumer_operations?:never;export_snapshot?:boolean})&{detail?:'compact'|'expanded'};
 onchain_evidence_brief:WorkflowChainSelection&{previous_contract_snapshot?:string;detail?:'compact'|'expanded';conditions?:BaseCondition[]};
 cross_domain_release_evidence:Comparison&RecordIdentity&{release_label:string;conditions?:CrossCondition[]}&({url:string;source_watch_id?:never;scope?:WorkflowScope;api_url?:string;onchain:WorkflowChainSelection;observation_id?:never}|{source_watch_id:string;url?:never;scope?:never;api_url?:string;onchain:WorkflowChainSelection;observation_id?:never}|{observation_id:string;url?:never;source_watch_id?:never;scope?:never;api_url?:never;onchain?:never});
}
export type DecisionStatus = 'pass'|'fail'|'unknown';
interface DecisionValue {value:string|boolean;source:{provenance_pointer:string;observed_at:string;source_pointer?:string;evidence_pointer?:string;sha256?:string}}
export interface WorkflowAssessment {
 status:DecisionStatus;
 conditions:Array<CrossCondition & {status:DecisionStatus;reason:'condition_satisfied'|'condition_false'|'fact_unavailable'|'comparison_unavailable';observed?:DecisionValue;compared?:DecisionValue}>;
}
export interface ConsumerReview {
 status:DecisionStatus;
 operations:Array<{operation:ConsumerOperation;status:DecisionStatus;reason:'operation_removed'|'scoped_breaking_change'|'analysis_incomplete'|'operation_unverified'|'no_scoped_break_observed';next_action:'review_migration'|'review_contracts'|'check_again_on_contract_change';witness?:{rule:string;before_pointer:string|null;after_pointer:string|null}}>;
 outside_scope_breaking_findings:number;
 incomplete_scope_mapping:boolean;
}
export interface ServerWorkflowResult {workflow:ServerWorkflow;version:1;status:string;observed_at:string;summary:Record<string,unknown>;evidence:Record<string,unknown>;provenance:Record<string,unknown>;completeness:Record<string,unknown>;warnings:string[];accounting:Record<string,unknown>;billing:{one_financial_operation:true;internal_charges:0;tariff_version:5;credits:number;atomic_usdc:string};observation_id?:string;state_expires_at?:string;workflow_state_saved?:boolean;persistence_error?:string;assessment?:WorkflowAssessment;consumer_review?:ConsumerReview}
