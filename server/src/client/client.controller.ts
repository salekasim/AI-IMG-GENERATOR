import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Sse,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Throttle } from '../common/throttle.decorator';
import { ExecutionEngine } from '../orchestrator/execution/execution-engine.service';
import { SseService, SseEvent } from '../orchestrator/sse.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClientService } from './client.service';
import { ClientRunDto } from './dto/client-run.dto';

@Controller('client')
export class ClientController {
  constructor(
    private readonly client: ClientService,
    private readonly engine: ExecutionEngine,
    private readonly sse: SseService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':secretKey/workflows/:workflowId/run')
  @Throttle({ limit: 60, windowMs: 60 * 1000, key: 'ip' })
  async run(
    @Param('secretKey') secretKey: string,
    @Param('workflowId') workflowId: string,
    @Body() dto: ClientRunDto,
  ) {
    const project = await this.client.resolveProject(secretKey);
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true, name: true, enabled: true, projectId: true, webhookUrl: true },
    });
    if (!workflow) throw new NotFoundException('Workflow not found');
    if (!workflow.enabled) {
      throw new ForbiddenException(`Workflow '${workflow.name}' is disabled`);
    }
    if (!workflow.projectId) {
      throw new ForbiddenException(
        `Workflow '${workflow.name}' is not linked to any project — link it in the admin dashboard`,
      );
    }
    if (workflow.projectId !== project.id) {
      throw new ForbiddenException(
        `Workflow '${workflow.name}' is not linked to this project`,
      );
    }
    const execution = await this.engine.start(workflowId, dto.payload, {
      source: 'client',
      projectId: project.id,
      createdBy: project.ownerId,
      webhookUrl: dto.webhookUrl ?? null,
    });
    return {
      executionId: execution.id,
      workflowId,
      projectId: project.id,
      streamToken: this.client.signStreamToken(project.id),
    };
  }

  @Get(':secretKey/executions/:id')
  async detail(@Param('secretKey') secretKey: string, @Param('id') id: string) {
    const project = await this.client.resolveProject(secretKey);
    const execution = await this.prisma.workflowExecution.findFirst({
      where: { id, projectId: project.id },
    });
    if (!execution) throw new NotFoundException('Execution not found');
    return execution;
  }

  @Sse(':secretKey/executions/:id/stream')
  async stream(
    @Param('secretKey') secretKey: string,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Observable<MessageEvent>> {
    const project = await this.client.resolveProject(secretKey);
    const token = (req as unknown as { query: Record<string, string> }).query?.['token'];
    if (!token || !this.client.verifyStreamToken(token, project.id)) {
      throw new UnauthorizedException('Invalid stream token');
    }
    const execution = await this.prisma.workflowExecution.findFirst({
      where: { id, projectId: project.id },
    });
    if (!execution) throw new NotFoundException('Execution not found');

    return new Observable<MessageEvent>((subscriber) => {
      const handler = (event: SseEvent) => {
        subscriber.next({ data: JSON.stringify(event) } as MessageEvent);
      };
      if (this.sse.isDone(id)) {
        subscriber.next({ data: JSON.stringify({ type: 'done', ts: new Date().toISOString() }) } as MessageEvent);
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
