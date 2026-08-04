import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateRouteDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  steps?: Array<{
    provider: string;
    model: string;
    priority?: number;
  }>;

  @IsOptional()
  @IsObject()
  retryPolicy?: Record<string, unknown>;
}

export class UpdateRouteDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsArray()
  steps?: Array<{
    provider: string;
    model: string;
    priority?: number;
  }>;

  @IsOptional()
  @IsObject()
  retryPolicy?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CreateCredentialDto {
  @IsString()
  label!: string;

  @IsString()
  apiKey!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
