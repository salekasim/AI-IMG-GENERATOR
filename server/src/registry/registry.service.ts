import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PortDef } from '../tools/tool-registry';
import {
  CAPABILITY_NODE_TYPES,
  TOOL_NODE_TYPES,
  TOOL_SEEDS,
} from '../tools/tool-registry';
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from '../orchestrator/execution/graph.types';

interface NodeSeed {
  key: string;
  kind: string;
  category: string;
  name: string;
  description?: string;
  icon: string;
  color: string;
  inputPorts?: PortDef[];
  outputPorts?: PortDef[];
  paramSchema?: Array<Record<string, unknown>>;
  defaults?: Record<string, unknown>;
}

const DATA_IN: PortDef[] = [
  { id: 'input', label: 'Input', dataType: 'data', required: true },
];
const DATA_OUT: PortDef[] = [{ id: 'output', label: 'Output', dataType: 'data' }];
const MODEL_OUT: PortDef[] = [
  { id: 'model', label: 'AI Model', dataType: 'model' },
  { id: 'route', label: 'Route', dataType: 'route' },
];

const NODE_SEEDS: NodeSeed[] = [
  {
    key: 'trigger',
    kind: 'trigger',
    category: 'Triggers',
    name: 'User Request',
    description: 'Entry point — receives the workflow input (prompt, ratio, count, …).',
    icon: '⚡',
    color: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    outputPorts: [{ id: 'payload', label: 'Payload', dataType: 'data' }],
    paramSchema: [{ key: 'name', label: 'Name', type: 'text' }],
    defaults: { name: 'User Request' },
  },
  {
    key: 'subscriptionCheck',
    kind: 'logic',
    category: 'Triggers',
    name: 'Plan Gate',
    description: 'Passes when the requester is on a paid plan.',
    icon: '💳',
    color: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    inputPorts: DATA_IN,
    outputPorts: [
      { id: 'true', label: 'Paid', dataType: 'data' },
      { id: 'false', label: 'Free', dataType: 'data' },
    ],
    paramSchema: [{ key: 'name', label: 'Name', type: 'text' }],
    defaults: { name: 'Plan Gate' },
  },
  {
    key: 'retry',
    kind: 'logic',
    category: 'Logic',
    name: 'Retry',
    description: 'Retries the connected step with backoff before failing.',
    icon: '🔁',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    inputPorts: DATA_IN,
    outputPorts: DATA_OUT,
    paramSchema: [
      { key: 'attempts', label: 'Max attempts', type: 'number', min: 1, max: 10, step: 1 },
      { key: 'delayMs', label: 'Retry delay (ms)', type: 'number', min: 0, max: 60000, step: 100 },
      { key: 'backoff', label: 'Exponential backoff', type: 'toggle' },
      { key: 'retryableErrors', label: 'Retryable errors', type: 'text', placeholder: '429, timeout, 5xx …' },
      { key: 'onError', label: 'On final failure', type: 'select', options: ['next', 'stop'] },
    ],
    defaults: { attempts: 2, delayMs: 500, backoff: true, onError: 'next' },
  },
  {
    key: 'if',
    kind: 'logic',
    category: 'Logic',
    name: 'Condition',
    description: 'Routes by a payload field comparison.',
    icon: '🔀',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    inputPorts: DATA_IN,
    outputPorts: [
      { id: 'true', label: 'True', dataType: 'data' },
      { id: 'false', label: 'False', dataType: 'data' },
    ],
    paramSchema: [
      { key: 'field', label: 'Payload field', type: 'text' },
      { key: 'condition', label: 'Condition', type: 'select', options: ['equals', 'contains', 'greaterThan', 'lessThan', 'isSet'] },
      { key: 'value', label: 'Value', type: 'text' },
    ],
    defaults: { field: 'plan', condition: 'equals', value: 'premium' },
  },
  {
    key: 'switch',
    kind: 'logic',
    category: 'Logic',
    name: 'Switch',
    description: 'Routes by a payload field value (one outgoing edge per case).',
    icon: '⚖️',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    inputPorts: DATA_IN,
    outputPorts: [{ id: 'case', label: 'Cases', dataType: 'data' }],
    paramSchema: [{ key: 'field', label: 'Payload field', type: 'text' }],
    defaults: { field: 'tier' },
  },
  {
    key: 'wait',
    kind: 'logic',
    category: 'Logic',
    name: 'Wait',
    description: 'Pauses the flow for a fixed number of seconds.',
    icon: '⏱️',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    inputPorts: DATA_IN,
    outputPorts: DATA_OUT,
    paramSchema: [{ key: 'seconds', label: 'Seconds', type: 'number', min: 0, max: 5, step: 1 }],
    defaults: { seconds: 2 },
  },
  {
    key: 'delay',
    kind: 'logic',
    category: 'Logic',
    name: 'Delay',
    description: 'Pauses the flow for a number of milliseconds.',
    icon: '🕐',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    inputPorts: DATA_IN,
    outputPorts: DATA_OUT,
    paramSchema: [{ key: 'ms', label: 'Milliseconds', type: 'number', min: 0, max: 5000, step: 100 }],
    defaults: { ms: 300 },
  },
  {
    key: 'loop',
    kind: 'logic',
    category: 'Logic',
    name: 'Loop',
    description: 'Repeats the downstream branch up to maxIterations times.',
    icon: '🔄',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    inputPorts: DATA_IN,
    outputPorts: DATA_OUT,
    paramSchema: [{ key: 'maxIterations', label: 'Max iterations', type: 'number', min: 1, max: 20, step: 1 }],
    defaults: { maxIterations: 3 },
  },
  {
    key: 'parallel',
    kind: 'logic',
    category: 'Logic',
    name: 'Parallel',
    description: 'Fans out to all connected branches.',
    icon: '🧵',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    inputPorts: DATA_IN,
    outputPorts: [{ id: 'branch', label: 'Branches', dataType: 'data' }],
    paramSchema: [{ key: 'name', label: 'Name', type: 'text' }],
    defaults: { name: 'Parallel' },
  },
  {
    key: 'merge',
    kind: 'logic',
    category: 'Logic',
    name: 'Merge',
    description: 'Joins multiple branches into one stream.',
    icon: '🧩',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    inputPorts: [{ id: 'input', label: 'Inputs', dataType: 'data' }],
    outputPorts: DATA_OUT,
    paramSchema: [{ key: 'name', label: 'Name', type: 'text' }],
    defaults: { name: 'Merge' },
  },
  {
    key: 'logger',
    kind: 'system',
    category: 'System',
    name: 'Logger',
    description: 'Writes a console line during execution.',
    icon: '📝',
    color: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    inputPorts: DATA_IN,
    outputPorts: DATA_OUT,
    paramSchema: [
      { key: 'level', label: 'Level', type: 'select', options: ['info', 'warn', 'error'] },
      { key: 'message', label: 'Message', type: 'text' },
    ],
    defaults: { level: 'info', message: '' },
  },
  {
    key: 'analytics',
    kind: 'system',
    category: 'System',
    name: 'Analytics',
    description: 'Records an analytics event for the run.',
    icon: '📊',
    color: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    inputPorts: DATA_IN,
    outputPorts: DATA_OUT,
    paramSchema: [{ key: 'track', label: 'Track', type: 'select', options: ['request', 'generation', 'error'] }],
    defaults: { track: 'request' },
  },
  {
    key: 'errorHandler',
    kind: 'system',
    category: 'System',
    name: 'Error Handler',
    description: 'Defines behavior when an upstream step fails.',
    icon: '🚨',
    color: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    inputPorts: DATA_IN,
    outputPorts: DATA_OUT,
    paramSchema: [{ key: 'action', label: 'Action', type: 'select', options: ['stop', 'continue', 'webhook'] }],
    defaults: { action: 'stop' },
  },
  {
    key: 'notification',
    kind: 'system',
    category: 'System',
    name: 'Notification',
    description: 'Sends a webhook / channel notification when reached.',
    icon: '🔔',
    color: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    inputPorts: DATA_IN,
    outputPorts: DATA_OUT,
    paramSchema: [
      { key: 'channel', label: 'Channel', type: 'select', options: ['webhook', 'discord', 'slack'] },
      { key: 'target', label: 'Target URL', type: 'text' },
    ],
    defaults: { channel: 'webhook', target: '' },
  },
  {
    key: 'rateLimiter',
    kind: 'system',
    category: 'System',
    name: 'Rate Limiter',
    description: 'Throttles requests through this node.',
    icon: '🚦',
    color: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    inputPorts: DATA_IN,
    outputPorts: DATA_OUT,
    paramSchema: [
      { key: 'rpm', label: 'Requests / minute', type: 'number', min: 1, max: 60, step: 1 },
    ],
    defaults: { rpm: 10 },
  },
  {
    key: 'storageNode',
    kind: 'storage',
    category: 'Storage',
    name: 'Storage',
    description: 'Persists connected artifacts to the active storage provider.',
    icon: '🗄️',
    color: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
    inputPorts: [
      { id: 'image', label: 'Image', dataType: 'artifact.image' },
      { id: 'video', label: 'Video', dataType: 'artifact.video' },
      { id: 'audio', label: 'Audio', dataType: 'artifact.audio' },
      { id: 'file', label: 'File', dataType: 'artifact.file' },
      { id: 'data', label: 'Metadata', dataType: 'data' },
    ],
    outputPorts: [{ id: 'output', label: 'Stored', dataType: 'data' }],
    paramSchema: [
      { key: 'storage', label: 'Storage route', type: 'text', placeholder: 'default = active provider' },
      { key: 'path', label: 'Folder / path', type: 'text' },
      { key: 'visibility', label: 'Visibility', type: 'select', options: ['private', 'public'] },
      { key: 'retention', label: 'Retention (days)', type: 'number', min: 0, max: 3650, step: 1 },
    ],
    defaults: { storage: '', path: '', visibility: 'public', retention: 0 },
  },
  {
    key: 'modelNode',
    kind: 'provider',
    category: 'Provider',
    name: 'AI Model',
    description: 'Selects one provider/model. Drop from the AI Models library.',
    icon: '🤖',
    color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    outputPorts: MODEL_OUT,
    paramSchema: [
      { key: 'provider', label: 'Provider', type: 'text' },
      { key: 'model', label: 'Model', type: 'text' },
      { key: 'timeoutMs', label: 'Timeout (ms)', type: 'number', min: 1000, max: 600000, step: 1000 },
    ],
    defaults: { provider: '', model: '', timeoutMs: 120000 },
  },
  {
    key: 'modelRoute',
    kind: 'provider',
    category: 'Provider',
    name: 'Model Route',
    description: 'Fallback group — tries providers/models by priority, retries, then fails over.',
    icon: '🛣️',
    color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    outputPorts: [
      { id: 'route', label: 'Route', dataType: 'route' },
      { id: 'model', label: 'AI Model', dataType: 'model' },
    ],
    paramSchema: [
      { key: 'routeId', label: 'Global route', type: 'text', placeholder: 'optional named route from Admin → Model Routes' },
      { key: 'attempts', label: 'Retry per step', type: 'number', min: 0, max: 5, step: 1 },
      { key: 'delayMs', label: 'Retry delay (ms)', type: 'number', min: 0, max: 60000, step: 100 },
    ],
    defaults: { routeId: '', attempts: 1, delayMs: 1000 },
  },
  {
    key: 'note',
    kind: 'canvas',
    category: 'Canvas',
    name: 'Note',
    description: 'Sticky note for documentation.',
    icon: '📌',
    color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    paramSchema: [{ key: 'text', label: 'Text', type: 'textarea' }],
    defaults: { text: '' },
  },
  {
    key: 'group',
    kind: 'canvas',
    category: 'Canvas',
    name: 'Group',
    description: 'Visual grouping frame.',
    icon: '📦',
    color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    paramSchema: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'width', label: 'Width', type: 'number', min: 200, max: 2000, step: 10 },
      { key: 'height', label: 'Height', type: 'number', min: 100, max: 2000, step: 10 },
    ],
    defaults: { title: 'Group', width: 480, height: 320 },
  },
];

/**
 * Static node-type registry + dynamic node library endpoint. Seeded once;
 * the frontend Node Library is generated from `listNodes()` so new node
 * types / capabilities / providers appear without frontend code changes.
 */

interface TypedNodePorts {
  input: PortDef[];
  output: PortDef[];
}

/**
 * Node type → port map used by `validateGraph`. Built from the static seeds:
 * node definitions, capability seeds and their legacy/capability aliases, so
 * validation matches what the execution engine can actually run.
 */
const NODE_TYPE_PORTS: Record<string, TypedNodePorts> = (() => {
  const map: Record<string, TypedNodePorts> = {};
  for (const seed of NODE_SEEDS) {
    map[seed.key] = {
      input: seed.inputPorts ?? [],
      output: seed.outputPorts ?? [],
    };
  }
  // legacy canvas alias handled by the engine
  map['storage'] = map['storageNode'];
  for (const seed of TOOL_SEEDS) {
    const ports: TypedNodePorts = {
      input: seed.inputPorts ?? [],
      output: seed.outputPorts ?? [],
    };
    map[seed.key] = ports;
    for (const [nodeType, capabilityKey] of [
      ...Object.entries(TOOL_NODE_TYPES),
      ...Object.entries(CAPABILITY_NODE_TYPES),
    ]) {
      if (capabilityKey === seed.key) map[nodeType] = ports;
    }
  }
  return map;
})();

/** A `data` port is the generic passthrough — compatible with anything. */
function portsCompatible(source: PortDef, target: PortDef): boolean {
  if (source.dataType === 'data' || target.dataType === 'data') return true;
  if (target.accepts?.includes(source.dataType)) return true;
  return source.dataType === target.dataType;
}

export interface GraphValidationResult {
  valid: boolean;
  errors: string[];
}

@Injectable()
export class RegistryService implements OnModuleInit {
  private readonly logger = new Logger(RegistryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedNodeDefinitions();
  }

  private async seedNodeDefinitions() {
    for (const seed of NODE_SEEDS) {
      await this.prisma.nodeDefinition.upsert({
        where: { key: seed.key },
        update: {
          kind: seed.kind,
          category: seed.category,
          name: seed.name,
          description: seed.description ?? null,
          icon: seed.icon,
          color: seed.color,
          inputPorts: (seed.inputPorts ?? []) as unknown as Prisma.InputJsonValue,
          outputPorts: (seed.outputPorts ?? []) as unknown as Prisma.InputJsonValue,
          paramSchema: (seed.paramSchema ?? []) as unknown as Prisma.InputJsonValue,
          defaults: (seed.defaults ?? {}) as unknown as Prisma.InputJsonValue,
        },
        create: {
          key: seed.key,
          kind: seed.kind,
          category: seed.category,
          name: seed.name,
          description: seed.description ?? null,
          icon: seed.icon,
          color: seed.color,
          inputPorts: (seed.inputPorts ?? []) as unknown as Prisma.InputJsonValue,
          outputPorts: (seed.outputPorts ?? []) as unknown as Prisma.InputJsonValue,
          paramSchema: (seed.paramSchema ?? []) as unknown as Prisma.InputJsonValue,
          defaults: (seed.defaults ?? {}) as unknown as Prisma.InputJsonValue,
          enabled: true,
        },
      });
    }
    this.logger.log(`Seeded ${NODE_SEEDS.length} node definitions`);
  }

  /**
   * The dynamic node library: static node definitions + capabilities + live
   * providers/models (apiKeyEnc stripped, key presence boolean kept).
   */
  async listNodes() {
    const [definitions, capabilities, providers, storageProviders, modelRoutes] =
      await Promise.all([
        this.prisma.nodeDefinition.findMany({ orderBy: { key: 'asc' } }),
        this.prisma.capability.findMany({ orderBy: { key: 'asc' } }),
        this.prisma.aiProvider.findMany({
          include: {
            models: {
              where: { enabled: true, hidden: false },
              orderBy: { priority: 'asc' },
            },
          },
          orderBy: [{ enabled: 'desc' }, { priority: 'asc' }],
        }),
        this.prisma.storageProvider.findMany({
          orderBy: [{ isActive: 'desc' }, { priority: 'asc' }],
        }),
        this.prisma.modelRoute.findMany({
          where: { enabled: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, enabled: true },
        }),
      ]);
    return {
      definitions,
      capabilities,
      providers: providers.map((p) => ({
        ...p,
        apiKeyEnc: undefined,
        apiKeyConfigured: Boolean(p.apiKeyEnc),
      })),
      storageProviders: storageProviders.map((p) => ({
        id: p.id,
        name: p.name,
        driver: p.driver,
        enabled: p.enabled,
        isActive: p.isActive,
        priority: p.priority,
        configConfigured: Boolean(p.configEnc),
      })),
      modelRoutes,
    };
  }

  /**
   * Typed-port graph validation (Phase 4):
   *  - node types must be in the registry (definitions / capabilities / aliases)
   *  - edges must reference existing nodes
   *  - handle-qualified edges must reference existing ports with compatible
   *    dataTypes; unqualified (legacy) edges must have at least one compatible
   *    input/output pair on their endpoints
   *  - unknown node types are a hard error
   */
  validateGraph(graph: WorkflowGraph): GraphValidationResult {
    const errors: string[] = [];
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph?.edges) ? graph.edges : [];

    const byId = new Map<string, WorkflowNode>();
    const seenIds = new Set<string>();
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || !node.id) {
        errors.push(`node missing 'id'`);
        continue;
      }
      if (seenIds.has(node.id)) {
        errors.push(`duplicate node id '${node.id}'`);
        continue;
      }
      seenIds.add(node.id);
      byId.set(node.id, node);
      const ports = NODE_TYPE_PORTS[node.type];
      if (!ports) {
        errors.push(
          `node '${node.id}' has unknown type '${node.type}' — not in the node library`,
        );
        continue;
      }
    }

    const portOf = (node: WorkflowNode, handle: string | null | undefined, side: 'input' | 'output') => {
      const ports = NODE_TYPE_PORTS[node.type];
      if (!ports) return undefined;
      return ports[side].find((p) => p.id === handle);
    };

    for (const edge of edges) {
      if (!edge || !edge.id) {
        errors.push(`edge missing 'id'`);
        continue;
      }
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source) {
        errors.push(`edge '${edge.id}' references missing source node '${edge.source}'`);
        continue;
      }
      if (!target) {
        errors.push(`edge '${edge.id}' references missing target node '${edge.target}'`);
        continue;
      }
      if (edge.source === edge.target) {
        errors.push(`edge '${edge.id}' is a self-loop on '${edge.source}'`);
        continue;
      }

      const sourcePort = portOf(source, edge.sourceHandle, 'output');
      const targetPort = portOf(target, edge.targetHandle, 'input');

      if (edge.sourceHandle && !sourcePort) {
        errors.push(
          `edge '${edge.id}': '${source.id}' (${source.type}) has no output port '${edge.sourceHandle}'`,
        );
        continue;
      }
      if (edge.targetHandle && !targetPort) {
        errors.push(
          `edge '${edge.id}': '${target.id}' (${target.type}) has no input port '${edge.targetHandle}'`,
        );
        continue;
      }

      // Handle-qualified edge → exact port compatibility.
      if (edge.sourceHandle || edge.targetHandle) {
        if (!sourcePort || !targetPort) {
          errors.push(
            `edge '${edge.id}': cannot resolve ports ${edge.sourceHandle ?? '(auto)'} → ${edge.targetHandle ?? '(auto)'}`,
          );
          continue;
        }
        if (!portsCompatible(sourcePort, targetPort)) {
          errors.push(
            `edge '${edge.id}': '${source.id}' output '${sourcePort.id}' (${sourcePort.dataType}) is not compatible with '${target.id}' input '${targetPort.id}' (${targetPort.dataType})`,
          );
        }
        continue;
      }

      // Unqualified legacy edge → at least one compatible port pair.
      const sourcePorts = NODE_TYPE_PORTS[source.type]?.output ?? [];
      const targetPorts = NODE_TYPE_PORTS[target.type]?.input ?? [];
      if (!sourcePorts.length || !targetPorts.length) {
        errors.push(
          `edge '${edge.id}': '${source.type}' has no output ports or '${target.type}' has no input ports — connect explicit handles`,
        );
        continue;
      }
      const compatible = sourcePorts.some((sp) =>
        targetPorts.some((tp) => portsCompatible(sp, tp)),
      );
      if (!compatible) {
        errors.push(
          `edge '${edge.id}': no compatible data type between '${source.id}' (${source.type}: ${sourcePorts.map((p) => p.dataType).join(', ')}) and '${target.id}' (${target.type}: ${targetPorts.map((p) => p.dataType).join(', ')})`,
        );
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Derive ModelCapability rows from provider/model capability flags:
   *   supportsImages  → image / icon / logo / object3d generation
   *   supportsVideo   → video generation
   *   supportsAudio   → music / tts / stt
   *   otherwise       → text generation
   *   transform models (rembg/upscaler patterns) → background removal / upscaling
   */
  async syncModelCapabilities() {
    const models = await this.prisma.aiModel.findMany();
    let written = 0;
    for (const model of models) {
      const keys: string[] = [];
      if (model.supportsImages) {
        keys.push('image', 'icon', 'logo', 'object3d');
      }
      if (model.supportsVideo) {
        keys.push('video');
      }
      if (model.supportsAudio) {
        keys.push('musicGeneration', 'textToSpeech', 'speechToText');
      }
      if (!model.supportsImages && !model.supportsVideo && !model.supportsAudio) {
        keys.push('textGeneration');
      }
      const name = model.internalName.toLowerCase();
      if (model.supportsImages) {
        if (/rembg|remove[_-]?background|background[_-]?remov|deeplab/i.test(name)) {
          keys.push('backgroundRemover');
        }
        if (/esrgan|upscal|realesrgan|srmd|gfpgan/i.test(name)) {
          keys.push('upscaler');
        }
      }
      for (const key of keys) {
        await this.prisma.modelCapability.upsert({
          where: {
            modelId_capabilityKey: { modelId: model.id, capabilityKey: key },
          },
          update: {},
          create: { modelId: model.id, capabilityKey: key, supported: true },
        });
        written += 1;
      }
    }
    this.logger.log(`Synced ${written} model-capability links`);
    return written;
  }
}
