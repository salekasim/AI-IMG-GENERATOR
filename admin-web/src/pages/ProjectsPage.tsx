import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchProjects,
  createProject,
  updateProject,
  regenerateProjectKey,
  deleteProject,
  linkWorkflows,
  unlinkWorkflow,
} from '../api/admin';
import { fetchWorkflows } from '../api/workflows';
import { errorMessage } from '../api/client';
import { Spinner, ConfirmDialog } from '../components/ui';

function WorkflowPicker({
  candidates,
  selected,
  onToggle,
  excludeIds,
}: {
  candidates: { id: string; name: string; projectId?: string | null }[];
  selected: string[];
  onToggle: (id: string) => void;
  excludeIds?: Set<string>;
}) {
  const list = useMemo(
    () => candidates.filter((w) => !excludeIds?.has(w.id)),
    [candidates, excludeIds],
  );
  return (
    <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-line bg-ink p-1.5">
      {list.length === 0 && (
        <p className="px-2 py-3 text-center text-[11px] text-faint">No workflows available to link.</p>
      )}
      {list.map((w) => {
        const checked = selected.includes(w.id);
        return (
          <label
            key={w.id}
            className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-elevated ${
              checked ? 'bg-blue/10 text-inktext' : 'text-muted'
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(w.id)}
              className="accent-blue-500"
            />
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            {w.projectId && !checked && (
              <span className="shrink-0 text-[9px] text-amber-300/80">linked elsewhere</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  });
  const { data: workflows } = useQuery({
    queryKey: ['workflows'],
    queryFn: fetchWorkflows,
  });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>([]);
  const [keyBanner, setKeyBanner] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['workflows'] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        workflowIds: selectedWorkflowIds,
      }),
    onSuccess: (project) => {
      setKeyBanner('Project created — key shown once');
      setRevealedKey(project.secretKey);
      setCreating(false);
      setName('');
      setDescription('');
      setSelectedWorkflowIds([]);
      invalidate();
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: (id: string) => regenerateProjectKey(id),
    onSuccess: ({ secretKey }) => {
      setKeyBanner('Key regenerated — copy it now');
      setRevealedKey(secretKey);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateProject(id, { enabled }),
    onSuccess: () => invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: () => invalidate(),
  });

  const linkMutation = useMutation({
    mutationFn: ({ id, ids }: { id: string; ids: string[] }) => linkWorkflows(id, ids),
    onSuccess: () => {
      invalidate();
      setLinkOpen(null);
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: ({ id, workflowId }: { id: string; workflowId: string }) => unlinkWorkflow(id, workflowId),
    onSuccess: () => invalidate(),
  });

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
    } catch {
      // clipboard unavailable
    }
  };

  const linkedIds = new Set((data ?? []).flatMap((p) => p.workflows.map((w) => w.id)));

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-ink">
      <header className="flex items-center justify-between border-b border-line bg-elevated/60 px-5 py-3.5">
        <div>
          <h2 className="text-sm font-bold text-inktext">Projects</h2>
          <p className="text-[11px] text-faint">
            Client API keys for Flutter / web apps — pick the workflows each key may run
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-blue-500 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-400"
        >
          + New project
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {revealedKey && (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <p className="text-xs font-semibold text-emerald-300">{keyBanner}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg border border-line bg-ink px-2.5 py-1.5 font-mono text-xs text-emerald-200">
                {revealedKey}
              </code>
              <button
                onClick={() => copyKey(revealedKey)}
                className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:border-blue/40 hover:text-inktext"
              >
                Copy
              </button>
              <button
                onClick={() => {
                  setRevealedKey(null);
                  setKeyBanner(null);
                }}
                className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-faint hover:text-inktext"
              >
                ✕
              </button>
            </div>
            <p className="mt-2 font-mono text-[10px] text-faint">
              POST /v1/client/{'{secretKey}'}/workflows/{'{id}'}/run&nbsp;·&nbsp;GET /v1/client/{'{secretKey}'}/executions/{'{id}'}/stream
            </p>
          </div>
        )}

        {creating && (
          <div className="mb-4 rounded-xl border border-line bg-elevated p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name (e.g. Flutter app)"
                autoFocus
                className="rounded-lg border border-line bg-ink px-3 py-2 text-xs text-inktext outline-none placeholder:text-faint focus:border-blue"
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                className="rounded-lg border border-line bg-ink px-3 py-2 text-xs text-inktext outline-none placeholder:text-faint focus:border-blue"
              />
            </div>
            <div className="mt-3">
              <span className="mb-1.5 block text-[11px] text-muted">
                Link workflows <span className="text-faint">({selectedWorkflowIds.length} selected — key will only run these)</span>
              </span>
              <WorkflowPicker
                candidates={workflows ?? []}
                selected={selectedWorkflowIds}
                onToggle={(id) =>
                  setSelectedWorkflowIds((cur) =>
                    cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
                  )
                }
              />
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => createMutation.mutate()}
                disabled={!name.trim() || createMutation.isPending}
                className="rounded-lg bg-blue-500 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-400 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </button>
              <button
                onClick={() => setCreating(false)}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-ink"
              >
                Cancel
              </button>
              {createMutation.isError && (
                <span className="self-center text-[11px] text-red-400">{errorMessage(createMutation.error)}</span>
              )}
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-red/30 bg-red/10 p-4 text-center text-xs text-red">
            {errorMessage(error)}
          </div>
        ) : !data?.length ? (
          <div className="flex flex-col items-center gap-2 py-20 text-center">
            <span className="text-3xl opacity-40">🗝️</span>
            <p className="text-xs text-faint">No projects yet. Create one to get a client API key.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {data.map((project) => (
              <div
                key={project.id}
                className={`rounded-xl border p-4 transition-all ${project.enabled ? 'border-line bg-elevated/50' : 'border-line bg-ink opacity-70'}`}
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-inktext">{project.name}</h3>
                      {!project.enabled && (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300">
                          disabled
                        </span>
                      )}
                    </div>
                    {project.description && (
                      <p className="mt-0.5 truncate text-[11px] text-muted">{project.description}</p>
                    )}
                    <p className="mt-1 font-mono text-[10px] text-faint">key …{project.secretKeyLast4}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <span className="rounded-lg border border-line bg-ink px-2 py-1 text-[10px] text-muted">
                      {project.workflowCount} workflows
                    </span>
                    <span className="rounded-lg border border-line bg-ink px-2 py-1 text-[10px] text-muted">
                      {project.executionCount} runs
                    </span>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {project.workflows.length === 0 && (
                      <span className="text-[11px] text-faint">No workflows linked — key can run nothing yet.</span>
                    )}
                    {project.workflows.map((w) => (
                      <span
                        key={w.id}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${w.enabled ? 'border-line bg-ink text-muted' : 'border-line bg-ink text-faint line-through'}`}
                      >
                        {w.enabled ? '✓' : '✕'} {w.name}
                        <button
                          onClick={() => unlinkMutation.mutate({ id: project.id, workflowId: w.id })}
                          className="text-faint transition-colors hover:text-red"
                          title="Unlink workflow"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    {linkOpen === project.id && (
                      <div className="w-full">
                        <WorkflowPicker
                          candidates={workflows ?? []}
                          selected={[]}
                          excludeIds={linkedIds}
                          onToggle={(id) => linkMutation.mutate({ id: project.id, ids: [id] })}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => setLinkOpen(linkOpen === project.id ? null : project.id)}
                    className="rounded-lg border border-blue/40 bg-blue/10 px-2.5 py-1 text-[11px] text-blue-300 hover:bg-blue/20"
                  >
                    + Link workflow
                  </button>
                  <button
                    onClick={() => regenerateMutation.mutate(project.id)}
                    className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-muted hover:border-blue/40 hover:text-inktext"
                  >
                    ⟳ Regenerate key
                  </button>
                  <button
                    onClick={() => toggleMutation.mutate({ id: project.id, enabled: !project.enabled })}
                    className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-muted hover:border-blue/40 hover:text-inktext"
                  >
                    {project.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete({ id: project.id, name: project.name })}
                    className="ml-auto rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-400 hover:bg-red-500/20"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete project"
        description={
          <span>
            Delete project '<span className="font-semibold text-inktext">{confirmDelete?.name}</span>'? Its
            workflows stay, only the project key dies. This cannot be undone.
          </span>
        }
        confirmLabel="Yes, delete"
        onConfirm={() => {
          if (confirmDelete) {
            deleteMutation.mutate(confirmDelete.id);
            setConfirmDelete(null);
          }
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}
