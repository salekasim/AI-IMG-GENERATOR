export interface TemplateNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  config?: Record<string, unknown>;
}

export interface TemplateEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowTemplate {
  name: string;
  description: string;
  graph: { nodes: TemplateNode[]; edges: TemplateEdge[] };
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    name: 'Premium routing',
    description:
      'Subscription check routes premium users to the best model and everyone else to the fast free tier.',
    graph: {
      nodes: [
        {
          id: 'start',
          type: 'trigger',
          position: { x: 40, y: 220 },
          config: { name: 'User Request' },
        },
        {
          id: 'check',
          type: 'subscriptionCheck',
          position: { x: 320, y: 220 },
          config: { field: 'plan' },
        },
        {
          id: 'premium',
          type: 'if',
          position: { x: 600, y: 120 },
          config: { condition: 'equals', value: 'premium' },
        },
        {
          id: 'gpt5',
          type: 'chatModel',
          position: { x: 900, y: 60 },
          config: {
            provider: 'OpenAI',
            model: 'GPT-5',
            temperature: 0.7,
            maxTokens: 4096,
          },
        },
        {
          id: 'gemini',
          type: 'chatModel',
          position: { x: 900, y: 220 },
          config: {
            provider: 'Google Gemini',
            model: 'Gemini Flash',
            temperature: 0.9,
            maxTokens: 2048,
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'check' },
        { id: 'e2', source: 'check', target: 'premium' },
        { id: 'e3', source: 'premium', target: 'gpt5' },
        { id: 'e4', source: 'premium', target: 'gemini' },
      ],
    },
  },
  {
    name: 'Image failover chain',
    description:
      'Generates an image with the first healthy provider and falls back down the chain on failure.',
    graph: {
      nodes: [
        {
          id: 'start',
          type: 'trigger',
          position: { x: 40, y: 300 },
          config: { name: 'Generate Image' },
        },
        {
          id: 'flux',
          type: 'imageModel',
          position: { x: 320, y: 300 },
          config: { name: 'Image Tools · Flux', provider: 'Flux', model: 'flux', size: '1:1', count: 1 },
        },
        {
          id: 'retry1',
          type: 'retry',
          position: { x: 620, y: 300 },
          config: { attempts: 2, delayMs: 1000, onError: 'next' },
        },
        {
          id: 'ideogram',
          type: 'imageModel',
          position: { x: 920, y: 300 },
          config: { name: 'Image Tools · Ideogram', provider: 'Ideogram', model: 'V2', size: '1:1', count: 1 },
        },
        {
          id: 'retry2',
          type: 'retry',
          position: { x: 1220, y: 300 },
          config: { attempts: 2, delayMs: 1000, onError: 'next' },
        },
        {
          id: 'gptimage',
          type: 'imageModel',
          position: { x: 1520, y: 300 },
          config: {
            name: 'Image Tools · GPT Image',
            provider: 'OpenAI',
            model: 'gpt-image-1',
            size: '1:1',
            count: 1,
          },
        },
        {
          id: 'save',
          type: 'storageNode',
          position: { x: 1820, y: 300 },
          config: { name: 'Save · Local', storage: 'Local', path: 'Pictures/Intellix AI/' },
        },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'flux' },
        { id: 'e2', source: 'flux', target: 'retry1' },
        { id: 'e3', source: 'retry1', target: 'ideogram' },
        { id: 'e4', source: 'ideogram', target: 'retry2' },
        { id: 'e5', source: 'retry2', target: 'gptimage' },
        { id: 'e6', source: 'gptimage', target: 'save' },
      ],
    },
  },
  {
    name: 'Cost optimization',
    description:
      'Free users get the cheap model, premium users the best model, ultra users the flagship.',
    graph: {
      nodes: [
        {
          id: 'start',
          type: 'trigger',
          position: { x: 40, y: 260 },
          config: { name: 'AI Request' },
        },
        {
          id: 'tier',
          type: 'switch',
          position: { x: 320, y: 260 },
          config: { field: 'tier' },
        },
        {
          id: 'free',
          type: 'chatModel',
          position: { x: 640, y: 60 },
          config: {
            provider: 'Groq',
            model: 'Llama 3.3 70B',
            temperature: 0.8,
            maxTokens: 1024,
          },
        },
        {
          id: 'premium',
          type: 'chatModel',
          position: { x: 640, y: 260 },
          config: {
            provider: 'Anthropic',
            model: 'Claude Sonnet',
            temperature: 0.7,
            maxTokens: 2048,
          },
        },
        {
          id: 'ultra',
          type: 'chatModel',
          position: { x: 640, y: 460 },
          config: {
            provider: 'OpenAI',
            model: 'GPT-5',
            temperature: 0.6,
            maxTokens: 8192,
          },
        },
        {
          id: 'log',
          type: 'logger',
          position: { x: 940, y: 260 },
          config: { level: 'info' },
        },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'tier' },
        { id: 'e2', source: 'tier', target: 'free' },
        { id: 'e3', source: 'tier', target: 'premium' },
        { id: 'e4', source: 'tier', target: 'ultra' },
        { id: 'e5', source: 'free', target: 'log' },
        { id: 'e6', source: 'premium', target: 'log' },
        { id: 'e7', source: 'ultra', target: 'log' },
      ],
    },
  },
];
