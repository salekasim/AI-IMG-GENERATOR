import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Prisma, Role } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/auth.types';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { SseTokenGuard } from '../../auth/guards/sse-token.guard';
import { clampInt } from '../../common/num.util';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionEngine } from './execution-engine.service';
import { SseService, SseEvent } from '../sse.service';
import { ExecuteWorkflowDto } from '../dto/execute-workflow.dto';

@Controller('orchestrator')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ExecutionController {
  constructor(
    private readonly engine: ExecutionEngine,
    private readonly prisma: PrismaService,
    private readonly sse: SseService,
  ) {}

  @Post('workflows/:id/execute')
  execute(
    @Param('id') id: string,
    @Body() dto: ExecuteWorkflowDto,
    @CurrentUser() user: AuthUser,
  ) {
    const payload = dto?.payload;
    if (
      payload !== undefined &&
      (typeof payload !== 'object' ||
        payload === null ||
        Array.isArray(payload))
    ) {
      throw new BadRequestException('payload must be an object');
    }
    return this.engine.start(id, payload, {
      source: 'admin',
      createdBy: user.userId,
    });
  }

  @Get('executions')
  async list(
    @Query('status') status?: string,
    @Query('workflowId') workflowId?: string,
    @Query('source') source?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const validStatus = ['pending', 'running', 'success', 'error'];
    const where: Prisma.WorkflowExecutionWhereInput = {};
    if (status && validStatus.includes(status)) where.status = status;
    if (workflowId) where.workflowId = workflowId;
    if (source === 'admin' || source === 'client') where.source = source;
    if (q && q.trim()) {
      where.workflow = {
        is: { name: { contains: q.trim(), mode: 'insensitive' } },
      };
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.workflowExecution.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: clampInt(offset, 0, 0, 100000),
        take: clampInt(limit, 30, 1, 100),
        include: {
          workflow: { select: { id: true, name: true, enabled: true } },
        },
      }),
      this.prisma.workflowExecution.count({ where }),
    ]);
    const userIds = [
      ...new Set(rows.map((r) => r.createdBy).filter(Boolean)),
    ] as string[];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    return {
      total,
      rows: rows.map(({ input, output, logs, attempts, ...rest }) => ({
        ...rest,
        attempts: Array.isArray(attempts) ? attempts : [],
        user: rest.createdBy ? (userMap.get(rest.createdBy) ?? null) : null,
      })),
    };
  }

  @Post('executions/:id/retry')
  async retry(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id },
    });
    if (!execution) throw new NotFoundException('Execution not found');
    if (!execution.input || typeof execution.input !== 'object') {
      throw new BadRequestException('Execution has no stored input to replay');
    }
    return this.engine.start(
      execution.workflowId,
      execution.input as Record<string, unknown>,
      {
        source: 'admin',
        createdBy: user.userId,
      },
    );
  }

  @Get('executions/:id')
  async detail(@Param('id') id: string) {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id },
    });
    if (!execution) throw new NotFoundException('Execution not found');
    return execution;
  }

  @Get('workflows/:id/executions')
  history(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.prisma.workflowExecution.findMany({
      where: { workflowId: id },
      orderBy: { startedAt: 'desc' },
      take: clampInt(limit, 20, 1, 50),
    });
  }

  @Sse('executions/:id/stream')
  @UseGuards(SseTokenGuard)
  stream(@Param('id') id: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const handler = (event: SseEvent) => {
        subscriber.next({ data: JSON.stringify(event) } as MessageEvent);
      };
      if (this.sse.isDone(id)) {
        subscriber.next({
          data: JSON.stringify({ type: 'done', ts: new Date().toISOString() }),
        } as MessageEvent);
        subscriber.complete();
        return;
      }
      this.sse.on(id, handler);
      const doneHandler = () => {
        this.sse.off(id, handler);
        subscriber.complete();
      };
      this.sse.onDone(id, doneHandler);
      return () => {
        this.sse.off(id, handler);
      };
    });
  }
}
