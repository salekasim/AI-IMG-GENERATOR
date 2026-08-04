import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Admin (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let email: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = app.get(PrismaService);
    email = `admin-test-${Date.now()}@test.dev`;
  });

  afterAll(async () => {
    await prisma.auditLog
      .deleteMany({ where: { actorId: null } })
      .catch(() => {});
    await app.close();
  });

  it('blocks regular users and allows admins', async () => {
    const register = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email, password: 'pass-1234', name: 'Admin Test' })
      .expect(201);
    const userToken = register.body.accessToken;
    expect(userToken).toBeDefined();

    await request(app.getHttpServer())
      .get('/v1/admin/stats')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    await prisma.user.update({
      where: { email },
      data: { role: 'ADMIN' },
    });

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password: 'pass-1234' })
      .expect(201);
    const adminToken = login.body.accessToken;

    const stats = await request(app.getHttpServer())
      .get('/v1/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(stats.body.totalUsers).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(stats.body.last7Days)).toBe(true);
    expect(stats.body.last7Days).toHaveLength(7);
    expect(Array.isArray(stats.body.perProvider)).toBe(true);

    const users = await request(app.getHttpServer())
      .get('/v1/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(users.body.length).toBeGreaterThanOrEqual(1);
    expect(users.body[0].passwordHash).toBeUndefined();
    expect(typeof users.body[0].usedToday).toBe('number');

    const providers = await request(app.getHttpServer())
      .get('/v1/admin/providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(providers.body.length).toBeGreaterThanOrEqual(1);
    expect(providers.body[0].apiKeyEnc).toBeUndefined();
  });

  it('allows quota updates but protects self role/ban changes', async () => {
    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password: 'pass-1234' })
      .expect(201);
    const token = login.body.accessToken;
    const me = login.body.user;

    const patch = await request(app.getHttpServer())
      .patch(`/v1/admin/users/${me.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dailyQuota: 25 })
      .expect(200);
    expect(patch.body.dailyQuota).toBe(25);

    await request(app.getHttpServer())
      .patch(`/v1/admin/users/${me.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ banned: true })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/v1/admin/users/${me.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'USER' })
      .expect(403);
  });

  it('records audit entries for admin mutations', async () => {
    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password: 'pass-1234' })
      .expect(201);
    const token = login.body.accessToken;

    const audit = await request(app.getHttpServer())
      .get('/v1/admin/audit')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const actions = audit.body.map((e: { action: string }) => e.action);
    expect(actions).toContain('users.update');
    expect(audit.body[0].actorEmail).toBe(email);
  });

  it('tests provider connectivity', async () => {
    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password: 'pass-1234' })
      .expect(201);
    const token = login.body.accessToken;

    const providers = await request(app.getHttpServer())
      .get('/v1/admin/providers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const target = providers.body.find(
      (p: { name: string }) => p.name === 'pollinations',
    );
    expect(target).toBeDefined();

    const test = await request(app.getHttpServer())
      .post(`/v1/admin/providers/${target.id}/test`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(typeof test.body.ok).toBe('boolean');
    expect(typeof test.body.latencyMs).toBe('number');
  });
});
