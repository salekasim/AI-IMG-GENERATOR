import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { useWorkflowStore, statusColor } from '../store/workflowStore';

export const StatusEdge = memo(function StatusEdge(props: EdgeProps) {
  const { id, source, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected } = props;
  const status = useWorkflowStore((s) => s.nodeStatuses[source]);
  const color = status ? statusColor[status.status] : '#1e2633';

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.2 : 1.8,
          strokeDasharray: status?.status === 'running' ? '6 4' : undefined,
        }}
      />
    </>
  );
});
