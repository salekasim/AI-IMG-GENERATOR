import { IsDefined, IsObject, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateWorkflowDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  webhookUrl?: string;

  @IsDefined()
  @IsObject()
  graph: Record<string, unknown>;
}
