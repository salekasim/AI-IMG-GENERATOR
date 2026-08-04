export type PortDataType =
  | 'model'
  | 'route'
  | 'artifact.image'
  | 'artifact.video'
  | 'artifact.audio'
  | 'artifact.file'
  | 'text'
  | 'data';

export interface PortDef {
  id: string;
  label: string;
  dataType: PortDataType;
  required?: boolean;
  /** Extra dataTypes this port accepts (e.g. model port accepting a route). */
  accepts?: PortDataType[];
}

export interface ToolParamField {
  key: string;
  label: string;
  type:
    | 'text' | 'number' | 'select' | 'toggle' | 'slider' | 'textarea' | 'file';
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
  inputPorts?: PortDef[];
  outputPorts?: PortDef[];
  defaults?: Record<string, unknown>;
  hasRuntime?: boolean;
  defaultChain: Array<{ provider: string; model: string }>;
}

/**
 * Shared port groups used across capability seeds.
 */
const MODEL_IN: PortDef[] = [
  {
    id: 'model',
    label: 'AI Model',
    dataType: 'model',
    required: true,
    accepts: ['route'],
  },
];
const PROMPT_IN: PortDef[] = [
  { id: 'prompt', label: 'Prompt', dataType: 'text' },
];
const IMAGE_IN: PortDef[] = [
  { id: 'input', label: 'Image', dataType: 'artifact.image' },
];
const VIDEO_IN: PortDef[] = [
  { id: 'input', label: 'Video', dataType: 'artifact.video' },
];
const AUDIO_IN: PortDef[] = [
  { id: 'input', label: 'Audio', dataType: 'artifact.audio' },
];
const IMAGE_OUT: PortDef[] = [
  { id: 'artifact', label: 'Image', dataType: 'artifact.image' },
  { id: 'data', label: 'Metadata', dataType: 'data' },
];
const VIDEO_OUT: PortDef[] = [
  { id: 'artifact', label: 'Video', dataType: 'artifact.video' },
  { id: 'data', label: 'Metadata', dataType: 'data' },
];
const AUDIO_OUT: PortDef[] = [
  { id: 'artifact', label: 'Audio', dataType: 'artifact.audio' },
  { id: 'data', label: 'Metadata', dataType: 'data' },
];
const TEXT_OUT: PortDef[] = [{ id: 'text', label: 'Text', dataType: 'text' }];

/**
 * The pluggable capability registry. Each entry maps to a node type the
 * execution engine understands. `defaultChain` is the admin-configurable
 * fallback provider/model chain used when a node has no model connection.
 * `hasRuntime: false` marks registered capabilities without a runtime
 * handler yet — they appear in the Node Library but cannot run.
 */
export const TOOL_SEEDS: ToolSeed[] = [
  {
    key: 'image',
    name: 'Image Generation',
    category: 'AI',
    description:
      'Generate images from a prompt. Model selection comes from a connected AI Model / Model Route node.',
    icon: '🎨',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    capability: 'image',
    inputPorts: [...MODEL_IN, ...PROMPT_IN],
    outputPorts: IMAGE_OUT,
    params: [
      { key: 'count', label: 'Count', type: 'number', min: 1, max: 4, step: 1 },
      {
        key: 'aspectRatio',
        label: 'Aspect ratio',
        type: 'select',
        options: ['1:1', '16:9', '9:16', '4:3', '3:2', '2:3'],
      },
      { key: 'negativePrompt', label: 'Negative prompt', type: 'textarea' },
      { key: 'quality', label: 'Quality', type: 'select', options: ['low', 'medium', 'high'] },
      { key: 'seed', label: 'Seed', type: 'number', min: 0, max: 2147483647, step: 1 },
    ],
    defaults: { count: 1, aspectRatio: '1:1', quality: 'medium' },
    hasRuntime: true,
    // primary binding is fal.ai (quality), pollinations stays as a keyless fallback
    defaultChain: [
      { provider: 'fal-image', model: 'flux-pro' },
      { provider: 'pollinations', model: 'flux' },
    ],
  },
  {
    key: 'icon',
    name: 'Icon Generation',
    category: 'AI',
    description:
      'Generate flat app icons. Same provider pool as image, with icon-specific prompting.',
    icon: '🖼️',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    capability: 'image',
    inputPorts: [...MODEL_IN, ...PROMPT_IN],
    outputPorts: IMAGE_OUT,
    params: [
      { key: 'count', label: 'Count', type: 'number', min: 1, max: 4, step: 1 },
      {
        key: 'aspectRatio',
        label: 'Aspect ratio',
        type: 'select',
        options: ['1:1', '4:3', '16:9'],
      },
    ],
    defaults: { count: 1, aspectRatio: '1:1' },
    hasRuntime: true,
    defaultChain: [
      { provider: 'fal-image', model: 'flux-pro' },
      { provider: 'pollinations', model: 'flux' },
    ],
  },
  {
    key: 'logo',
    name: 'Logo Generation',
    category: 'AI',
    description: 'Generate a clean logo mark via any image-capable provider.',
    icon: '🏷️',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    capability: 'image',
    inputPorts: [...MODEL_IN, ...PROMPT_IN],
    outputPorts: IMAGE_OUT,
    params: [
      { key: 'count', label: 'Count', type: 'number', min: 1, max: 4, step: 1 },
      { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', options: ['1:1', '4:3', '16:9'] },
    ],
    defaults: { count: 1, aspectRatio: '1:1' },
    hasRuntime: true,
    defaultChain: [
      { provider: 'fal-image', model: 'flux-pro' },
      { provider: 'pollinations', model: 'flux' },
    ],
  },
  {
    key: 'object3d',
    name: '3D Generation',
    category: 'AI',
    description: 'Render a 3D product-view from a prompt.',
    icon: '🧊',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    capability: 'image',
    inputPorts: [...MODEL_IN, ...PROMPT_IN],
    outputPorts: IMAGE_OUT,
    params: [
      { key: 'count', label: 'Count', type: 'number', min: 1, max: 4, step: 1 },
    ],
    defaults: { count: 1 },
    hasRuntime: true,
    defaultChain: [
      { provider: 'fal-image', model: 'flux-pro' },
      { provider: 'pollinations', model: 'flux' },
    ],
  },
  {
    key: 'video',
    name: 'Video Generation',
    category: 'AI',
    description:
      'Generate a short video clip. Requires a video-capable provider/model route.',
    icon: '🎬',
    color: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
    capability: 'video',
    inputPorts: [...MODEL_IN, ...PROMPT_IN, IMAGE_IN[0]],
    outputPorts: VIDEO_OUT,
    params: [
      {
        key: 'duration',
        label: 'Duration (s)',
        type: 'number',
        min: 2,
        max: 20,
        step: 1,
      },
      { key: 'aspectRatio', label: 'Aspect ratio', type: 'select', options: ['16:9', '9:16', '1:1'] },
    ],
    defaults: { duration: 5, aspectRatio: '16:9' },
    hasRuntime: true,
    defaultChain: [{ provider: 'fal-video', model: 'minimax-video-01' }],
  },
  {
    key: 'backgroundRemover',
    name: 'Background Removal',
    category: 'AI',
    description:
      'Remove the background from an input image. Requires a mask-capable provider/model.',
    icon: '✂️',
    color: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
    capability: 'mask',
    requiresInput: true,
    inputPorts: [...MODEL_IN, ...IMAGE_IN],
    outputPorts: IMAGE_OUT,
    params: [],
    defaults: {},
    hasRuntime: true,
    defaultChain: [],
  },
  {
    key: 'upscaler',
    name: 'Image Upscaling',
    category: 'AI',
    description: 'Upscale an input image to a higher resolution.',
    icon: '🔍',
    color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    capability: 'image',
    requiresInput: true,
    inputPorts: [...MODEL_IN, ...IMAGE_IN],
    outputPorts: IMAGE_OUT,
    params: [],
    defaults: {},
    hasRuntime: true,
    defaultChain: [],
  },
  {
    key: 'textGeneration',
    name: 'Text Generation',
    category: 'AI',
    description: 'Generate / complete text with a connected AI model route.',
    icon: '💬',
    color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    capability: 'text',
    inputPorts: [...MODEL_IN, ...PROMPT_IN],
    outputPorts: TEXT_OUT,
    params: [
      { key: 'temperature', label: 'Temperature', type: 'slider', min: 0, max: 2, step: 0.1 },
      { key: 'maxTokens', label: 'Max tokens', type: 'number', min: 1, max: 32768, step: 1 },
      { key: 'systemPrompt', label: 'System prompt', type: 'textarea' },
    ],
    defaults: { temperature: 0.7, maxTokens: 1024 },
    hasRuntime: true,
    defaultChain: [],
  },
  {
    key: 'imageEditing',
    name: 'Image Editing',
    category: 'AI',
    description: 'Edit an input image guided by a prompt (inpainting / instruction edit).',
    icon: '🖌️',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    capability: 'image',
    requiresInput: true,
    inputPorts: [...MODEL_IN, ...IMAGE_IN, ...PROMPT_IN],
    outputPorts: IMAGE_OUT,
    params: [{ key: 'negativePrompt', label: 'Negative prompt', type: 'textarea' }],
    defaults: {},
    hasRuntime: false,
    defaultChain: [],
  },
  {
    key: 'imageVariation',
    name: 'Image Variation',
    category: 'AI',
    description: 'Create variations of an input image.',
    icon: '🎭',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    capability: 'image',
    requiresInput: true,
    inputPorts: [...MODEL_IN, ...IMAGE_IN],
    outputPorts: IMAGE_OUT,
    params: [{ key: 'count', label: 'Count', type: 'number', min: 1, max: 4, step: 1 }],
    defaults: { count: 1 },
    hasRuntime: false,
    defaultChain: [],
  },
  {
    key: 'imageToImage',
    name: 'Image-to-Image',
    category: 'AI',
    description: 'Transform an image into another image via prompt + style.',
    icon: '🔁',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    capability: 'image',
    requiresInput: true,
    inputPorts: [...MODEL_IN, ...IMAGE_IN, ...PROMPT_IN],
    outputPorts: IMAGE_OUT,
    params: [{ key: 'strength', label: 'Strength', type: 'slider', min: 0, max: 1, step: 0.05 }],
    defaults: { strength: 0.7 },
    hasRuntime: false,
    defaultChain: [],
  },
  {
    key: 'imageEnhancement',
    name: 'Image Enhancement',
    category: 'AI',
    description: 'Enhance image quality, lighting and sharpness.',
    icon: '✨',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    capability: 'image',
    requiresInput: true,
    inputPorts: [...MODEL_IN, ...IMAGE_IN],
    outputPorts: IMAGE_OUT,
    params: [],
    defaults: {},
    hasRuntime: false,
    defaultChain: [],
  },
  {
    key: 'imageToVideo',
    name: 'Image-to-Video',
    category: 'AI',
    description: 'Animate a still image into a short video clip.',
    icon: '📽️',
    color: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
    capability: 'video',
    requiresInput: true,
    inputPorts: [...MODEL_IN, ...IMAGE_IN, ...PROMPT_IN],
    outputPorts: VIDEO_OUT,
    params: [{ key: 'duration', label: 'Duration (s)', type: 'number', min: 2, max: 20, step: 1 }],
    defaults: { duration: 5 },
    hasRuntime: false,
    defaultChain: [],
  },
  {
    key: 'videoEnhancement',
    name: 'Video Enhancement',
    category: 'AI',
    description: 'Upscale / enhance an input video.',
    icon: '🌟',
    color: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
    capability: 'video',
    requiresInput: true,
    inputPorts: [...MODEL_IN, ...VIDEO_IN],
    outputPorts: VIDEO_OUT,
    params: [],
    defaults: {},
    hasRuntime: false,
    defaultChain: [],
  },
  {
    key: 'videoToVideo',
    name: 'Video-to-Video',
    category: 'AI',
    description: 'Restyle an input video via prompt.',
    icon: '🎞️',
    color: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
    capability: 'video',
    requiresInput: true,
    inputPorts: [...MODEL_IN, ...VIDEO_IN, ...PROMPT_IN],
    outputPorts: VIDEO_OUT,
    params: [],
    defaults: {},
    hasRuntime: false,
    defaultChain: [],
  },
  {
    key: 'textToSpeech',
    name: 'Text to Speech',
    category: 'AI',
    description: 'Synthesize speech from text with a connected audio model.',
    icon: '🗣️',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    capability: 'audio',
    inputPorts: [...MODEL_IN, ...PROMPT_IN],
    outputPorts: AUDIO_OUT,
    params: [{ key: 'voice', label: 'Voice', type: 'text' }],
    defaults: {},
    hasRuntime: false,
    defaultChain: [],
  },
  {
    key: 'speechToText',
    name: 'Speech to Text',
    category: 'AI',
    description: 'Transcribe audio into text.',
    icon: '🎙️',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    capability: 'audio',
    requiresInput: true,
    inputPorts: [...MODEL_IN, ...AUDIO_IN],
    outputPorts: TEXT_OUT,
    params: [],
    defaults: {},
    hasRuntime: false,
    defaultChain: [],
  },
  {
    key: 'musicGeneration',
    name: 'Music Generation',
    category: 'AI',
    description: 'Generate a music track from a prompt.',
    icon: '🎵',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    capability: 'audio',
    inputPorts: [...MODEL_IN, ...PROMPT_IN],
    outputPorts: AUDIO_OUT,
    params: [{ key: 'duration', label: 'Duration (s)', type: 'number', min: 5, max: 60, step: 5 }],
    defaults: { duration: 15 },
    hasRuntime: false,
    defaultChain: [],
  },
  {
    key: 'audioEnhancement',
    name: 'Audio Enhancement',
    category: 'AI',
    description: 'Clean and enhance an input audio track.',
    icon: '🎚️',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    capability: 'audio',
    requiresInput: true,
    inputPorts: [...MODEL_IN, ...AUDIO_IN],
    outputPorts: AUDIO_OUT,
    params: [],
    defaults: {},
    hasRuntime: false,
    defaultChain: [],
  },
  {
    key: 'summarization',
    name: 'Summarization',
    category: 'AI',
    description: 'Summarize long text via a connected text model.',
    icon: '📄',
    color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    capability: 'text',
    inputPorts: [...MODEL_IN, ...PROMPT_IN],
    outputPorts: TEXT_OUT,
    params: [{ key: 'maxLength', label: 'Max length', type: 'number', min: 10, max: 1000, step: 10 }],
    defaults: { maxLength: 150 },
    hasRuntime: true,
    defaultChain: [],
  },
  {
    key: 'translation',
    name: 'Translation',
    category: 'AI',
    description: 'Translate text between languages via a connected text model.',
    icon: '🌐',
    color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    capability: 'text',
    inputPorts: [...MODEL_IN, ...PROMPT_IN],
    outputPorts: TEXT_OUT,
    params: [{ key: 'targetLanguage', label: 'Target language', type: 'text' }],
    defaults: { targetLanguage: 'English' },
    hasRuntime: true,
    defaultChain: [],
  },
  {
    key: 'embeddings',
    name: 'Embeddings',
    category: 'AI',
    description: 'Compute vector embeddings from text.',
    icon: '🧮',
    color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    capability: 'text',
    inputPorts: [...MODEL_IN, ...PROMPT_IN],
    outputPorts: [{ id: 'data', label: 'Embeddings', dataType: 'data' }],
    params: [],
    defaults: {},
    hasRuntime: false,
    defaultChain: [],
  },
  {
    key: 'ocr',
    name: 'OCR',
    category: 'AI',
    description: 'Extract text from an input image.',
    icon: '🔤',
    color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    capability: 'text',
    requiresInput: true,
    inputPorts: [...MODEL_IN, ...IMAGE_IN],
    outputPorts: TEXT_OUT,
    params: [],
    defaults: {},
    hasRuntime: false,
    defaultChain: [],
  },
];

/** Legacy canvas node type → capability key mapping. */
export const TOOL_NODE_TYPES: Record<string, string> = {
  imageModel: 'image',
  iconModel: 'icon',
  logoModel: 'logo',
  object3dModel: 'object3d',
  videoModel: 'video',
  backgroundRemover: 'backgroundRemover',
  upscaler: 'upscaler',
  chatModel: 'textGeneration',
};

/** New capability-focused node type names (Phase 4/5 aliases). */
export const CAPABILITY_NODE_TYPES: Record<string, string> = {
  imageGeneration: 'image',
  iconGeneration: 'icon',
  logoGeneration: 'logo',
  object3dGeneration: 'object3d',
  videoGeneration: 'video',
  backgroundRemoval: 'backgroundRemover',
  imageUpscaling: 'upscaler',
  textGeneration: 'textGeneration',
};

export function toolKeyForNodeType(nodeType: string): string | null {
  return TOOL_NODE_TYPES[nodeType] ?? CAPABILITY_NODE_TYPES[nodeType] ?? null;
}
