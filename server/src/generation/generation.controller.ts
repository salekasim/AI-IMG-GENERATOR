import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '../common/throttle.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GenerateDto } from './dto/generate.dto';
import { GenerationService } from './generation.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class GenerationController {
  constructor(private readonly generation: GenerationService) {}

  @Post('generate')
  @Throttle({ limit: 30, windowMs: 60 * 1000, key: 'user' })
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateDto) {
    return this.generation.generate(user.userId, dto);
  }

  @Get('generation/models')
  models() {
    return this.generation.availableModels();
  }

  @Get('generation/history')
  history(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.generation.history(user.userId, Number(limit ?? 30), Number(offset ?? 0));
  }

  @Delete('generation/history/:id')
  deleteHistory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.generation.deleteHistoryEntry(user.userId, id);
  }
}
