export const SUPPORTED_RATIOS = [
  '1:1',
  '4:5',
  '5:4',
  '3:4',
  '4:3',
  '16:9',
  '9:16',
  '2:3',
  '3:2',
  '21:9',
] as const;

export type Ratio = (typeof SUPPORTED_RATIOS)[number];

export interface Size {
  width: number;
  height: number;
}

/** Square-ish generation sizes (fits most diffusion models). */
export const RATIO_SIZES: Record<Ratio, Size> = {
  '1:1': { width: 1024, height: 1024 },
  '4:5': { width: 832, height: 1040 },
  '5:4': { width: 1040, height: 832 },
  '3:4': { width: 896, height: 1152 },
  '4:3': { width: 1152, height: 896 },
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '2:3': { width: 832, height: 1248 },
  '3:2': { width: 1248, height: 832 },
  '21:9': { width: 1344, height: 576 },
};

export function sizeFor(ratio: string | undefined): Size {
  const key = SUPPORTED_RATIOS.includes(ratio as Ratio)
    ? (ratio as Ratio)
    : '1:1';
  return RATIO_SIZES[key];
}
