import { IsObject, IsOptional } from 'class-validator';

export class ExecuteWorkflowDto {
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
