import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SUPPORTED_RATIOS } from '../ratio';

export const RESOLUTION_TIERS = ['high', 'medium', 'low'] as const;
export type ResolutionTier = (typeof RESOLUTION_TIERS)[number];

export class GenerateDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  prompt: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  negativePrompt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  imageCount = 2;

  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_RATIOS)
  ratio: string = '1:1';

  @IsOptional()
  @IsString()
  @IsIn(RESOLUTION_TIERS)
  resolution?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999999)
  seed?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}
