import type { PerfWindowReport } from './PerfSampler';

export interface MemoryStabilityResult {
  status: 'pass' | 'fail' | 'incomplete';
  reason: string | null;
  heapGrowthPercent: number | null;
  geometryGrowthPercent: number | null;
  textureGrowthPercent: number | null;
  heapEndpointGrowthPercent: number | null;
  geometryEndpointGrowthPercent: number | null;
  textureEndpointGrowthPercent: number | null;
  heapTrendGrowthPercent: number | null;
  geometryTrendGrowthPercent: number | null;
  textureTrendGrowthPercent: number | null;
  monotonicHeapGrowth: boolean;
  monotonicGeometryGrowth: boolean;
  monotonicTextureGrowth: boolean;
}

const round = (value: number): number => Math.round(value * 100) / 100;

const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const growthPercent = (values: number[]): number => {
  const middle = Math.floor(values.length / 2);
  const early = median(values.slice(0, middle));
  const late = median(values.slice(middle));
  if (early === 0) return late === 0 ? 0 : Number.POSITIVE_INFINITY;
  return round(((late - early) / early) * 100);
};

const isSustainedMonotonicGrowth = (values: number[]): boolean => {
  if (values.length < 4) return false;
  const strictlyIncreasing = values.every((value, index) => index === 0 || value > values[index - 1]);
  if (!strictlyIncreasing || values[0] === 0) return false;
  return ((values[values.length - 1] - values[0]) / values[0]) * 100 > 2;
};

const endpointGrowthPercent = (values: number[]): number => {
  if (values[0] === 0) return values[values.length - 1] === 0 ? 0 : Number.POSITIVE_INFINITY;
  return round(((values[values.length - 1] - values[0]) / values[0]) * 100);
};

const trendGrowthPercent = (values: number[]): number => {
  const meanIndex = (values.length - 1) / 2;
  const meanValue = values.reduce((sum, value) => sum + value, 0) / values.length;
  let covariance = 0;
  let indexVariance = 0;
  for (let index = 0; index < values.length; index++) {
    covariance += (index - meanIndex) * (values[index] - meanValue);
    indexVariance += (index - meanIndex) ** 2;
  }
  const slope = indexVariance === 0 ? 0 : covariance / indexVariance;
  if (values[0] === 0) return slope <= 0 ? 0 : Number.POSITIVE_INFINITY;
  return round(((slope * (values.length - 1)) / values[0]) * 100);
};

/** Evaluate post-warm sampler windows against the locked ten-percent memory gate. */
export function evaluateMemoryStability(reports: PerfWindowReport[]): MemoryStabilityResult {
  const usable = reports.filter((report) => report.jsHeapMB !== null);
  if (usable.length < 4) {
    return {
      status: 'incomplete',
      reason: 'at least four heap-bearing reports are required',
      heapGrowthPercent: null,
      geometryGrowthPercent: null,
      textureGrowthPercent: null,
      heapEndpointGrowthPercent: null,
      geometryEndpointGrowthPercent: null,
      textureEndpointGrowthPercent: null,
      heapTrendGrowthPercent: null,
      geometryTrendGrowthPercent: null,
      textureTrendGrowthPercent: null,
      monotonicHeapGrowth: false,
      monotonicGeometryGrowth: false,
      monotonicTextureGrowth: false,
    };
  }
  if (usable.reduce((duration, report) => duration + report.durationSec, 0) < 600) {
    return {
      status: 'incomplete',
      reason: 'reports must cover at least ten minutes',
      heapGrowthPercent: null,
      geometryGrowthPercent: null,
      textureGrowthPercent: null,
      heapEndpointGrowthPercent: null,
      geometryEndpointGrowthPercent: null,
      textureEndpointGrowthPercent: null,
      heapTrendGrowthPercent: null,
      geometryTrendGrowthPercent: null,
      textureTrendGrowthPercent: null,
      monotonicHeapGrowth: false,
      monotonicGeometryGrowth: false,
      monotonicTextureGrowth: false,
    };
  }

  const heaps = usable.map((report) => report.jsHeapMB as number);
  const geometries = usable.map((report) => report.memory.geometries);
  const textures = usable.map((report) => report.memory.textures);
  const heapGrowthPercent = growthPercent(heaps);
  const geometryGrowthPercent = growthPercent(geometries);
  const textureGrowthPercent = growthPercent(textures);
  const heapEndpointGrowthPercent = endpointGrowthPercent(heaps);
  const geometryEndpointGrowthPercent = endpointGrowthPercent(geometries);
  const textureEndpointGrowthPercent = endpointGrowthPercent(textures);
  const heapTrendGrowthPercent = trendGrowthPercent(heaps);
  const geometryTrendGrowthPercent = trendGrowthPercent(geometries);
  const textureTrendGrowthPercent = trendGrowthPercent(textures);
  const monotonicHeapGrowth = isSustainedMonotonicGrowth(heaps);
  const monotonicGeometryGrowth = isSustainedMonotonicGrowth(geometries);
  const monotonicTextureGrowth = isSustainedMonotonicGrowth(textures);
  const failed =
    heapGrowthPercent > 10 ||
    geometryGrowthPercent > 10 ||
    textureGrowthPercent > 10 ||
    heapEndpointGrowthPercent > 10 ||
    geometryEndpointGrowthPercent > 10 ||
    textureEndpointGrowthPercent > 10 ||
    heapTrendGrowthPercent > 5 ||
    geometryTrendGrowthPercent > 5 ||
    textureTrendGrowthPercent > 5 ||
    monotonicHeapGrowth ||
    monotonicGeometryGrowth ||
    monotonicTextureGrowth;

  return {
    status: failed ? 'fail' : 'pass',
    reason: failed ? 'memory did not return to a stable post-warm plateau' : null,
    heapGrowthPercent,
    geometryGrowthPercent,
    textureGrowthPercent,
    heapEndpointGrowthPercent,
    geometryEndpointGrowthPercent,
    textureEndpointGrowthPercent,
    heapTrendGrowthPercent,
    geometryTrendGrowthPercent,
    textureTrendGrowthPercent,
    monotonicHeapGrowth,
    monotonicGeometryGrowth,
    monotonicTextureGrowth,
  };
}
