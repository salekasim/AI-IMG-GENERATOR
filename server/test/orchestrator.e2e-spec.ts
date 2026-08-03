import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Orchestrator Workflows (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  const email = `orch-test-${Date.now()}@test.dev`;

  const graph = {
    nodes: [
      { id: 'a', type: 'trigger', position: { x: 0, y: 0 }, config: {} },
      { id: 'b', type: 'chatModel', position: { x: 200, y: 0 }, config: {} },
    ],
    edges: [{ id: 'e1', source: 'a', target: 'b' }],
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
    prisma = app.get(PrismaService);

    await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email, password: 'pass-1234', name: 'Orch Test' })
      .expect(201);
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password: 'pass-1234' })
      .expect(201);
    adminToken = login.body.accessToken;
  });

  afterAll(async () => {
    await prisma.workflow
      .deleteMany({
        where: {
          OR: [{ name: { startsWith: 'Test flow' } }, { name: 'Bad edges' }],
        },
      })
      .catch(() => {});
    await prisma.user.deleteMany({ where: { email } }).catch(() => {});
    await app.close();
  });

  it('seeds the sample templates on first boot', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/orchestrator/workflows')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const names = response.body.map(
      (w: { name: string }) => w.name,
    );
    expect(names).toContain('Premium routing');
    expect(names).toContain('Image failover chain');
    expect(names).toContain('Cost optimization');
  });

  it('blocks non-admin users', async () => {
    const other = `orch-user-${Date.now()}@test.dev`;
    await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: other, password: 'pass-1234' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: other, password: 'pass-1234' })
      .expect(201);

    await request(app.getHttpServer())
      .get('/v1/orchestrator/workflows')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(403);
  });

  it('creates, updates, duplicates and deletes a workflow', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/orchestrator/workflows')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test flow', description: 'from e2e', graph })
      .expect(201);
    expect(created.body.id).toBeDefined();
    expect(created.body.version).toBe(1);

    const updated = await request(app.getHttpServer())
      .patch(`/v1/orchestrator/workflows/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test flow v2', graph })
      .expect(200);
    expect(updated.body.name).toBe('Test flow v2');
    expect(updated.body.version).toBe(2);

    const duplicated = await request(app.getHttpServer())
      .post(`/v1/orchestrator/workflows/${created.body.id}/duplicate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test flow copy' })
      .expect(201);
    expect(duplicated.body.id).not.toBe(created.body.id);
    expect(duplicated.body.enabled).toBe(false);

    await request(app.getHttpServer())
      .delete(`/v1/orchestrator/workflows/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/v1/orchestrator/workflows/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('rejects invalid graphs but allows a blank canvas', async () => {
    const blank = await request(app.getHttpServer())
      .post('/v1/orchestrator/workflows')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Blank', graph: { nodes: [], edges: [] } })
      .expect(201);
    expect(blank.body.id).toBeDefined();
    await request(app.getHttpServer())
      .delete(`/v1/orchestrator/workflows/${blank.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/v1/orchestrator/workflows')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Bad edges',
        graph: {
          nodes: [{ id: 'a', type: 'x', position: { x: 0, y: 0 } }],
          edges: [{ id: 'e1', source: 'a', target: 'missing' }],
        },
      })
      .expect(400);
  });
});
