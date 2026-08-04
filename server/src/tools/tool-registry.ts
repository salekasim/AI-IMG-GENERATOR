export interface ToolParamField {
  key: string;
  label: string;
  type:
    'text' | 'number' | 'select' | 'toggle' | 'slider' | 'textarea' | 'file';
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

export interface ToolSeed {
  key: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  color: string;
  capability: 'image' | 'video' | 'text' | 'mask' | 'audio';
  requiresInput?: boolean;
  params: ToolParamField[];
  defaultBinding: Array<{ provider: string; model: string }>;
}

/**
 * The pluggable tool registry. Each entry maps to a node type the execution
 * engine understands. `defaultBinding` is the admin-configurable fallback
 * provider/model chain used when a node has no explicit chain.
 */
export const TOOL_SEEDS: ToolSeed[] = [
  {
    key: 'image',
    name: 'Image Model',
    category: 'AI',
    description:
      'Generate images from a prompt using any configured image-capable provider.',
    icon: '🎨',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    capability: 'image',
    params: [
      { key: 'count', label: 'Count', type: 'number', min: 1, max: 4, step: 1 },
      { key: 'negativePrompt', label: 'Negative prompt', type: 'textarea' },
    ],
    // pollinations is keyless so it stays usable out-of-the-box
    defaultBinding: [{ provider: 'pollinations', model: 'flux' }],
  },
  {
    key: 'icon',
    name: 'Icon',
    category: 'AI',
    description:
      'Generate flat app icons. Same provider pool as image, with icon-specific prompting.',
    icon: '🖼️',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    capability: 'image',
    params: [
      { key: 'count', label: 'Count', type: 'number', min: 1, max: 4, step: 1 },
    ],
    defaultBinding: [{ provider: 'pollinations', model: 'flux' }],
  },
  {
    key: 'logo',
    name: 'Logo',
    category: 'AI',
    description: 'Generate a clean logo mark via any image-capable provider.',
    icon: '🏷️',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    capability: 'image',
    params: [
      { key: 'count', label: 'Count', type: 'number', min: 1, max: 4, step: 1 },
    ],
    defaultBinding: [{ provider: 'pollinations', model: 'flux' }],
  },
  {
    key: 'object3d',
    name: '3D',
    category: 'AI',
    description: 'Render a 3D product-view from a prompt.',
    icon: '🧊',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    capability: 'image',
    params: [
      { key: 'count', label: 'Count', type: 'number', min: 1, max: 4, step: 1 },
    ],
    defaultBinding: [{ provider: 'pollinations', model: 'flux' }],
  },
  {
    key: 'video',
    name: 'Video',
    category: 'AI',
    description:
      'Generate a short video clip. Requires a video-capable provider (e.g. fal.ai).',
    icon: '🎬',
    color: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
    capability: 'video',
    params: [
      {
        key: 'duration',
        label: 'Duration (s)',
        type: 'number',
        min: 2,
        max: 20,
        step: 1,
      },
    ],
    defaultBinding: [],
  },
  {
    key: 'backgroundRemover',
    name: 'Background Remover',
    category: 'AI',
    description:
      'Remove the background from an input image. Requires a mask-capable provider/model.',
    icon: '✂️',
    color: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
    capability: 'mask',
    requiresInput: true,
    params: [],
    defaultBinding: [],
  },
  {
    key: 'upscaler',
    name: 'Upscaler',
    category: 'AI',
    description: 'Upscale an input image to a higher resolution.',
    icon: '🔍',
    color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    capability: 'image',
    requiresInput: true,
    params: [],
    defaultBinding: [],
  },
];

export const TOOL_NODE_TYPES: Record<string, string> = {
  imageModel: 'image',
  iconModel: 'icon',
  logoModel: 'logo',
  object3dModel: 'object3d',
  videoModel: 'video',
  backgroundRemover: 'backgroundRemover',
  upscaler: 'upscaler',
};

export function toolKeyForNodeType(nodeType: string): string | null {
  return TOOL_NODE_TYPES[nodeType] ?? null;
}
