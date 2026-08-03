import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { PlatformConfigService } from '../common/platform-config.service';
import { UsersService } from '../users/users.service';
import { JwtPayload } from './auth.types';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly googleClient: OAuth2Client | null;
  private readonly googleClientId: string | null;
  private readonly failedLogins = new Map<
    string,
    { count: number; lockedUntil: number }
  >();
  private static readonly MAX_FAILED = 5;
  private static readonly LOCK_MS = 15 * 60 * 1000;

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: PlatformConfigService,
    configService: ConfigService,
  ) {
    this.googleClientId = configService.get<string>('GOOGLE_CLIENT_ID') || null;
    this.googleClient = this.googleClientId
      ? new OAuth2Client(this.googleClientId)
      : null;
  }

  private lockStateFor(email: string): { count: number; lockedUntil: number } {
    let state = this.failedLogins.get(email);
    if (!state) {
      state = { count: 0, lockedUntil: 0 };
      this.failedLogins.set(email, state);
    }
    return state;
  }

  private adminEmails(): string[] {
    return (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }

  private roleFor(email: string): Role {
    return this.adminEmails().includes(email.toLowerCase())
      ? Role.ADMIN
      : Role.USER;
  }

  private issueToken(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return this.jwt.sign(payload);
  }

  private sanitize(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
    };
  }

  private ensureNotBanned(user: User) {
    if (user.banned) {
      throw new UnauthorizedException('Account banned');
    }
  }

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const passwordHash = await hash(dto.password, 10);
    const dailyQuota = await this.config.getNumber(
      'users.defaultDailyQuota',
      20,
    );
    const user = await this.users.create({
      email,
      name: dto.name ?? null,
      passwordHash,
      provider: 'email',
      role: this.roleFor(email),
      dailyQuota,
    });
    await this.users.touchLastLogin(user.id);
    return { accessToken: this.issueToken(user), user: this.sanitize(user) };
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    const state = this.lockStateFor(email);
    const now = Date.now();

    if (state.lockedUntil > now) {
      const minutes = Math.ceil((state.lockedUntil - now) / 60_000);
      throw new UnauthorizedException(
        `Too many failed attempts — account locked for ${minutes} more minute(s)`,
      );
    }

    const user = await this.users.findByEmail(email);
    const ok =
      !!user?.passwordHash && (await compare(dto.password, user.passwordHash));

    if (!ok) {
      state.count += 1;
      if (state.count >= AuthService.MAX_FAILED) {
        state.lockedUntil = now + AuthService.LOCK_MS;
        state.count = 0;
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    this.failedLogins.delete(email);
    this.ensureNotBanned(user);
    await this.users.touchLastLogin(user.id);
    return { accessToken: this.issueToken(user), user: this.sanitize(user) };
  }

  async google(dto: GoogleLoginDto) {
    if (!this.googleClient || !this.googleClientId) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured on the server',
      );
    }
    const ticket = await this.googleClient.verifyIdToken({
      idToken: dto.idToken,
      audience: this.googleClientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      throw new UnauthorizedException('Invalid Google token');
    }
    const email = payload.email.toLowerCase();
    let user = await this.users.findByEmail(email);
    if (!user) {
      const dailyQuota = await this.config.getNumber(
        'users.defaultDailyQuota',
        20,
      );
      user = await this.users.create({
        email,
        name: payload.name ?? null,
        avatarUrl: payload.picture ?? null,
        provider: 'google',
        role: this.roleFor(email),
        dailyQuota,
      });
    }
    this.ensureNotBanned(user);
    await this.users.touchLastLogin(user.id);
    return { accessToken: this.issueToken(user), user: this.sanitize(user) };
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Account not found');
    }
    return { user: this.sanitize(user) };
  }
}
