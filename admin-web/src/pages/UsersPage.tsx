import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api/client';
import type { AdminUser } from '../api/types';
import {
  ActionButton,
  Avatar,
  Badge,
  ConfirmDialog,
  ErrorBlock,
  formatDate,
  InlineMessage,
  LoadingBlock,
} from '../components/ui';

const usersKey = ['admin', 'users'] as const;

interface UpdatePayload {
  role?: 'USER' | 'ADMIN';
  banned?: boolean;
  dailyQuota?: number;
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [confirmBan, setConfirmBan] = useState<AdminUser | null>(null);
  const [confirmRole, setConfirmRole] = useState<{
    user: AdminUser;
    role: 'USER' | 'ADMIN';
  } | null>(null);
  const [debounced, setDebounced] = useState('');
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'success' }>({
    text: '',
    tone: 'error',
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const users = useQuery({
    queryKey: [...usersKey, debounced],
    queryFn: async () =>
      (
        await api.get<AdminUser[]>('/admin/users', {
          params: { limit: 100, q: debounced || undefined },
        })
      ).data,
  });

  const update = useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: UpdatePayload;
    }) => (await api.patch(`/admin/users/${id}`, payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersKey });
      setMessage({ text: 'User updated', tone: 'success' });
    },
    onError: (error) =>
      setMessage({ text: errorMessage(error), tone: 'error' }),
  });

  if (users.isPending) return <LoadingBlock label="Loading users…" />;
  if (users.isError)
    return <ErrorBlock message="Failed to load users" onRetry={() => users.refetch()} />;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted">
            {users.data.length} shown · role, ban status and daily quota
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search email or name…"
          className="w-64 rounded-lg border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-blue"
        />
      </div>
      <InlineMessage
        message={message.text}
        tone={message.tone}
      />
      <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-4 py-3 font-semibold">User</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Quota</th>
              <th className="px-4 py-3 font-semibold">Used today</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Last login</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.data.map((user) => (
              <tr key={user.id} className="hover:bg-elevated/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar email={user.email} name={user.name} />
                    <div className="min-w-0">
                      <div className="truncate font-semibold">
                        {user.name || '—'}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {user.email}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={user.role === 'ADMIN' ? 'blue' : 'neutral'}>
                    {user.role}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      className="h-6 w-6 rounded-md border border-line text-muted hover:bg-elevated"
                      onClick={() =>
                        update.mutate({
                          id: user.id,
                          payload: {
                            dailyQuota: Math.max(1, user.dailyQuota - 5),
                          },
                        })
                      }
                      title="Decrease quota"
                    >
                      −
                    </button>
                    <span className="w-8 text-center font-bold">
                      {user.dailyQuota}
                    </span>
                    <button
                      className="h-6 w-6 rounded-md border border-line text-muted hover:bg-elevated"
                      onClick={() =>
                        update.mutate({
                          id: user.id,
                          payload: { dailyQuota: user.dailyQuota + 5 },
                        })
                      }
                      title="Increase quota"
                    >
                      +
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted">{user.usedToday}</td>
                <td className="px-4 py-3">
                  <Badge tone={user.banned ? 'red' : 'emerald'}>
                    {user.banned ? 'banned' : 'active'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted">
                  {formatDate(user.lastLoginAt)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {user.role === 'ADMIN' ? (
                      <ActionButton
                        onClick={() => setConfirmRole({ user, role: 'USER' })}
                      >
                        Demote
                      </ActionButton>
                    ) : (
                      <ActionButton
                        tone="primary"
                        onClick={() => setConfirmRole({ user, role: 'ADMIN' })}
                      >
                        Make admin
                      </ActionButton>
                    )}
                    {user.banned ? (
                      <ActionButton
                        tone="success"
                        onClick={() =>
                          update.mutate({ id: user.id, payload: { banned: false } })
                        }
                      >
                        Unban
                      </ActionButton>
                    ) : (
                      <ActionButton
                        tone="danger"
                        onClick={() => setConfirmBan(user)}
                      >
                        Ban
                      </ActionButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.data.length === 0 && (
          <div className="py-10 text-center text-sm text-faint">
            No users match “{debounced}”.
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmBan}
        title="Ban user"
        description={
          <span>
            Ban{' '}
            <span className="font-semibold text-inktext">{confirmBan?.email}</span>? Banned
            users can no longer log in, but their data is kept.
          </span>
        }
        confirmLabel="Yes, ban user"
        onConfirm={() => {
          if (confirmBan) {
            update.mutate({ id: confirmBan.id, payload: { banned: true } });
            setConfirmBan(null);
          }
        }}
        onClose={() => setConfirmBan(null)}
        pending={update.isPending}
      />

      <ConfirmDialog
        open={!!confirmRole}
        title={confirmRole?.role === 'ADMIN' ? 'Promote to admin' : 'Demote user'}
        description={
          <span>
            {confirmRole?.role === 'ADMIN'
              ? `Give ${confirmRole?.user.email} admin privileges?`
              : `Remove admin privileges from ${confirmRole?.user.email}?`}{' '}
            They will lose admin access immediately.
          </span>
        }
        confirmLabel={confirmRole?.role === 'ADMIN' ? 'Yes, make admin' : 'Yes, demote'}
        onConfirm={() => {
          if (confirmRole) {
            update.mutate({ id: confirmRole.user.id, payload: { role: confirmRole.role } });
            setConfirmRole(null);
          }
        }}
        onClose={() => setConfirmRole(null)}
        pending={update.isPending}
      />
    </div>
  );
}
