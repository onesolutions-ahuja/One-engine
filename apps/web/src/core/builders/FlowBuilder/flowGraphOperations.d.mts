import type {FlowDefinitionMetadata} from '../../metadata/Definitions/metadata';
export function canBypassFlowElement(flow:FlowDefinitionMetadata,id:number):boolean;
export function removeFlowGraphElement(flow:FlowDefinitionMetadata,id:number):FlowDefinitionMetadata;
export function duplicateFlowGraphElement(
 flow:FlowDefinitionMetadata,id:number,connectorId:string|undefined,
 newId:number,newConnectorId:string):FlowDefinitionMetadata;
export function retargetFlowGraphConnector(
 flow:FlowDefinitionMetadata,connectorId:string,targetId:number):FlowDefinitionMetadata;
export function flowGraphDiagnostics(flow:FlowDefinitionMetadata):Array<{
 nodeId?:number;description:string
}>;
