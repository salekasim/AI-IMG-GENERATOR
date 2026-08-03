import { api } from './client';
import type {
  AdminExecutionList,
  ProviderAdmin,
  RoutingVariable,
  WorkflowExecution,
} from './types';

export async function fetchAdminProviders(): Promise<ProviderAdmin[]> {
  const { data } = await api.get('/admin/providers');
  return data;
}

export async function fetchRoutingVariables(): Promise<RoutingVariable[]> {
  const { data } = await api.get('/admin/routing-variables');
  return data;
}

export async function fetchAdminExecutions(params: {
  status?: string;
  workflowId?: string;
  source?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminExecutionList> {
  const { data } = await api.get('/orchestrator/executions', { params });
  return data;
}

export async function fetchAdminExecution(id: string): Promise<WorkflowExecution> {
  const { data } = await api.get(`/orchestrator/executions/${id}`);
  return data;
}

export async function retryAdminExecution(id: string): Promise<{ id: string }> {
  const { data } = await api.post(`/orchestrator/executions/${id}/retry`);
  return data;
}

export interface ProjectWorkflow {
  id: string;
  name: string;
  enabled: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  secretKeyLast4: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  workflows: ProjectWorkflow[];
  workflowCount: number;
  executionCount: number;
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const { data } = await api.get('/projects');
  return data;
}

export async function clearAuditLogs(): Promise<{ removed: number }> {
  const { data } = await api.delete('/admin/audit');
  return data;
}

export async function createProject(payload: {
  name: string;
  description?: string;
  workflowIds?: string[];
}): Promise<ProjectSummary & { secretKey: string }> {
  const { data } = await api.post('/projects', payload);
  return data;
}

export async function updateProject(
  id: string,
  payload: { name?: string; description?: string; enabled?: boolean },
): Promise<ProjectSummary> {
  const { data } = await api.patch(`/projects/${id}`, payload);
  return data;
}

export async function linkWorkflows(id: string, workflowIds: string[]): Promise<{ linked: number }> {
  const { data } = await api.post(`/projects/${id}/workflows`, { workflowIds });
  return data;
}

export async function unlinkWorkflow(id: string, workflowId: string): Promise<unknown> {
  const { data } = await api.delete(`/projects/${id}/workflows/${workflowId}`);
  return data;
}

export async function regenerateProjectKey(id: string): Promise<{ id: string; secretKey: string }> {
  const { data } = await api.post(`/projects/${id}/regenerate-key`);
  return data;
}

export async function deleteProject(id: string): Promise<{ id: string }> {
  const { data } = await api.delete(`/projects/${id}`);
  return data;
}
