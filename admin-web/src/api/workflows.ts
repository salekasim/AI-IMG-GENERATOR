import { api } from './client';
import type { WorkflowDetail, WorkflowExecution, WorkflowGraph, WorkflowSummary } from './types';

export async function fetchWorkflows(): Promise<WorkflowSummary[]> {
  const { data } = await api.get('/orchestrator/workflows');
  return data;
}

export async function fetchWorkflow(id: string): Promise<WorkflowDetail> {
  const { data } = await api.get(`/orchestrator/workflows/${id}`);
  return data;
}

export async function createWorkflow(payload: {
  name: string;
  description?: string;
  graph?: WorkflowGraph;
}): Promise<WorkflowDetail> {
  const { data } = await api.post('/orchestrator/workflows', payload);
  return data;
}

export async function updateWorkflow(
  id: string,
  payload: {
    name?: string;
    description?: string;
    graph?: WorkflowGraph;
    enabled?: boolean;
    webhookUrl?: string | null;
  },
): Promise<WorkflowDetail> {
  const { data } = await api.patch(`/orchestrator/workflows/${id}`, payload);
  return data;
}

export async function deleteWorkflow(id: string): Promise<{ success: true }> {
  const { data } = await api.delete(`/orchestrator/workflows/${id}`);
  return data;
}

export async function duplicateWorkflow(id: string, name: string): Promise<WorkflowDetail> {
  const { data } = await api.post(`/orchestrator/workflows/${id}/duplicate`, { name });
  return data;
}

export async function startExecution(
  workflowId: string,
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  const { data } = await api.post(`/orchestrator/workflows/${workflowId}/execute`, { payload });
  return data;
}

export async function fetchExecutions(workflowId: string, limit = 25): Promise<WorkflowExecution[]> {
  const { data } = await api.get(`/orchestrator/workflows/${workflowId}/executions`, {
    params: { limit },
  });
  return data;
}

export async function fetchExecution(id: string): Promise<WorkflowExecution> {
  const { data } = await api.get(`/orchestrator/executions/${id}`);
  return data;
}
