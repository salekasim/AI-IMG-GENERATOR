import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Project } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async resolveProject(secretKey: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({
      where: { secretKey },
    });
    if (!project) throw new UnauthorizedException('Invalid project key');
    if (!project.enabled)
      throw new UnauthorizedException('Project is disabled');
    return project;
  }

  signStreamToken(projectId: string): string {
    return this.jwt.sign({ scope: 'client', projectId }, { expiresIn: '2h' });
  }

  verifyStreamToken(token: string, projectId: string): boolean {
    try {
      const payload = this.jwt.verify(token);
      return payload.scope === 'client' && payload.projectId === projectId;
    } catch {
      return false;
    }
  }
}
