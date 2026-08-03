import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsInt()
  @Min(1)
  dailyQuota?: number;

  @IsOptional()
  @IsBoolean()
  banned?: boolean;
}
