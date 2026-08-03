import { IsBoolean, IsDefined, IsObject, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsObject()
  graph?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  webhookUrl?: string;

  @IsOptional()
  webhookUrlClear?: boolean;
}

export class DuplicateWorkflowDto {
  @IsDefined()
  @IsString()
  @MaxLength(120)
  name: string;
}
