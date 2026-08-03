import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { UsersService } from '../../users/users.service';
import { AuthUser } from '../auth.types';

interface TokenPayload {
  sub: string;
  role?: string;
}

/**
 * Guards the SSE stream endpoint. EventSource cannot set headers, so the
 * token may arrive either as `Authorization: Bearer <token>` (preferred) or
 * as a `?token=` query param (legacy clients). The query-param path still
 * works but is discouraged: it leaks the token into URL logs.
 */
@Injectable()
export class SseTokenGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      query: Record<string, string | string[] | undefined>;
    }>();

    const authHeader = request.headers['authorization'];
    const queryToken =
      typeof request.query?.['token'] === 'string'
        ? request.query['token']
        : undefined;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : queryToken;

    if (!token) throw new UnauthorizedException('Missing token');

    let payload: TokenPayload;
    try {
      payload = this.jwt.verify<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (payload.role !== Role.ADMIN) {
      throw new UnauthorizedException('ADMIN role required');
    }

    const user = await this.users.findById(payload.sub);
    if (!user || user.banned) {
      throw new UnauthorizedException('Account unavailable');
    }

    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    req.user = { userId: user.id, email: user.email, role: user.role };
    return true;
  }
}
