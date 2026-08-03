import { IsObject, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class ClientRunDto {
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  webhookUrl?: string;
}
