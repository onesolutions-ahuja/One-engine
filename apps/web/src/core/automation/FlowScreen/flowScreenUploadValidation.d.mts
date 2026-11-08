export interface FlowScreenUploadFile {
  name: string;
  type?: string;
  size: number;
}
export interface FlowScreenUploadLimits {
  maxFiles: number;
  maxFileSize: number;
  allowedTypes: string[];
}
export function validateFlowScreenUpload(
  selectedFiles: FlowScreenUploadFile[],
  existingFiles: FlowScreenUploadFile[],
  limits: FlowScreenUploadLimits
): void;
