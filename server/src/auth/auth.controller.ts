import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '../common/throttle.decorator';
import type { AuthUser } from './auth.types';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle({ limit: 5, windowMs: 60 * 60 * 1000, key: 'ip' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @Throttle({ limit: 10, windowMs: 60 * 1000, key: 'ip' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('google')
  @Throttle({ limit: 5, windowMs: 60 * 60 * 1000, key: 'ip' })
  google(@Body() dto: GoogleLoginDto) {
    return this.auth.google(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }
}
